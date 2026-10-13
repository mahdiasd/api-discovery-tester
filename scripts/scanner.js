import fs from 'node:fs';
import path from 'node:path';
import { getRiskLevelForMethod, sortEndpoints } from './dependency-sorter.js';
import { createDefaultManifest } from './manifest-helper.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.nuxt',
  '.cache',
  '.specify',
  '.agents',
  '.api-tester',
  'coverage'
]);

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte']);

/**
 * Recursively collects file paths up to maxDepth.
 */
function walkDir(dir, fileList = [], depth = 0, maxDepth = 6) {
  if (depth > maxDepth || !fs.existsSync(dir)) return fileList;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walkDir(path.join(dir, entry.name), fileList, depth + 1, maxDepth);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext) || entry.name.startsWith('.env') || entry.name.includes('config')) {
          fileList.push(path.join(dir, entry.name));
        }
      }
    }
  } catch (err) {
    // Ignore read permission errors
  }
  return fileList;
}

/**
 * Extracts environment variables and URLs from .env* files.
 */
export function parseEnvFiles(projectRoot) {
  const urls = new Set();
  const envVars = {};

  try {
    const entries = fs.readdirSync(projectRoot);
    const envFiles = entries.filter(f => f.startsWith('.env'));

    for (const file of envFiles) {
      const fullPath = path.join(projectRoot, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          val = val.replace(/^["']|["']$/g, '');
          envVars[key] = val;

          // Check if key or value represents an API URL
          if (/API|BASE_URL|SERVER|BACKEND|URL|ENDPOINT/i.test(key) && /^https?:\/\//i.test(val)) {
            urls.add(val.replace(/\/+$/, ''));
          } else if (/^https?:\/\//i.test(val)) {
            urls.add(val.replace(/\/+$/, ''));
          }
        }
      }
    }
  } catch (err) {
    // ignore
  }

  return { urls: Array.from(urls), envVars };
}

/**
 * Parses config files like vite.config.*, next.config.*, webpack.config.* for proxy/API targets.
 */
export function parseConfigFiles(projectRoot) {
  const urls = new Set();
  const configNames = [
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'nuxt.config.ts', 'webpack.config.js'
  ];

  for (const name of configNames) {
    const filePath = path.join(projectRoot, name);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Match target: 'http://...' or target: "http://..."
        const targetMatches = content.matchAll(/target\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/gi);
        for (const match of targetMatches) {
          if (match[1]) urls.add(match[1].replace(/\/+$/, ''));
        }
      } catch (err) {}
    }
  }

  return Array.from(urls);
}

/**
 * Scans code files for network client calls (Axios, Fetch, Ky, RTK Query) and auth headers.
 */
export function scanCodeFiles(projectRoot) {
  const allFiles = walkDir(projectRoot);
  const foundEndpoints = [];
  const detectedBaseUrls = new Set();
  let authInfo = {
    mode: 'bearer_token',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    requiresOtp: false
  };

  const endpointSeen = new Set();

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Detect Axios baseURL: baseURL: '...'
    const baseMatch = content.matchAll(/baseURL\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/gi);
    for (const m of baseMatch) {
      if (m[1]) detectedBaseUrls.add(m[1].replace(/\/+$/, ''));
    }

    // Detect Auth / OTP indicators
    if (/otp|2fa|two_factor|verification.*code/i.test(content)) {
      authInfo.requiresOtp = true;
    }
    if (/x-api-key/i.test(content)) {
      authInfo.mode = 'custom_header';
      authInfo.headerName = 'X-API-Key';
      authInfo.headerPrefix = '';
    }

    // Regex extraction patterns for HTTP endpoints
    // 1. axios.get('path'), client.post('path'), etc.
    const clientCallRegex = /(?:axios|api|client|http|request|ky)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^\s'"`]+)['"`]/gi;
    let match;
    while ((match = clientCallRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      let epPath = match[2];
      if (!epPath.startsWith('/') && !/^https?:\/\//i.test(epPath)) {
        epPath = '/' + epPath;
      }
      const key = `${method}:${epPath}`;
      if (!endpointSeen.has(key)) {
        endpointSeen.add(key);
        foundEndpoints.push(createEndpointDescriptor(method, epPath));
      }
    }

    // 2. fetch('path', { method: 'POST' }) or fetch('path')
    const fetchRegex = /fetch\s*\(\s*['"`]([^\s'"`]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`]([a-zA-Z]+)['"`])?/gi;
    while ((match = fetchRegex.exec(content)) !== null) {
      let epPath = match[1];
      const method = (match[2] || 'GET').toUpperCase();
      if (!epPath.startsWith('/') && !/^https?:\/\//i.test(epPath)) {
        epPath = '/' + epPath;
      }
      const key = `${method}:${epPath}`;
      if (!endpointSeen.has(key)) {
        endpointSeen.add(key);
        foundEndpoints.push(createEndpointDescriptor(method, epPath));
      }
    }

    // 3. RTK Query: builder.query({ query: () => '/path' })
    const rtkQueryRegex = /query\s*:\s*\([^)]*\)\s*=>\s*(?:\{[^}]*url\s*:\s*['"`]([^\s'"`]+)['"`]|['"`]([^\s'"`]+)['"`])/gi;
    while ((match = rtkQueryRegex.exec(content)) !== null) {
      let epPath = match[1] || match[2];
      if (epPath) {
        if (!epPath.startsWith('/') && !/^https?:\/\//i.test(epPath)) {
          epPath = '/' + epPath;
        }
        const key = `GET:${epPath}`;
        if (!endpointSeen.has(key)) {
          endpointSeen.add(key);
          foundEndpoints.push(createEndpointDescriptor('GET', epPath));
        }
      }
    }

    // 4. RTK Query mutation: builder.mutation({ query: () => ({ url: '/path', method: 'POST' }) })
    const rtkMutationRegex = /url\s*:\s*['"`]([^\s'"`]+)['"`]\s*,\s*method\s*:\s*['"`]([a-zA-Z]+)['"`]/gi;
    while ((match = rtkMutationRegex.exec(content)) !== null) {
      let epPath = match[1];
      const method = match[2].toUpperCase();
      if (!epPath.startsWith('/') && !/^https?:\/\//i.test(epPath)) {
        epPath = '/' + epPath;
      }
      const key = `${method}:${epPath}`;
      if (!endpointSeen.has(key)) {
        endpointSeen.add(key);
        foundEndpoints.push(createEndpointDescriptor(method, epPath));
      }
    }
  }

  return {
    endpoints: foundEndpoints,
    detectedBaseUrls: Array.from(detectedBaseUrls),
    authInfo
  };
}

/**
 * Helper to build an ApiEndpoint descriptor.
 */
function createEndpointDescriptor(method, epPath) {
  const cleanPath = epPath
    .replace(/\$\{([a-zA-Z0-9_.]+)\}/g, (_, varName) => `:${varName.split('.').pop()}`)
    .replace(/\$\{.*?\}/g, ':param')
    .replace(/\/+$/, '') || '/';
  const slug = cleanPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'root';
  const id = `${method.toLowerCase()}-${slug}`;

  // Form a readable name
  const nameParts = cleanPath.split('/').filter(Boolean);
  const resourceName = nameParts.length > 0 ? nameParts[nameParts.length - 1] : 'root';
  const actionName = method === 'GET' ? 'دریافت' : method === 'POST' ? 'ایجاد' : method === 'PUT' ? 'ویرایش' : method === 'DELETE' ? 'حذف' : method;
  const name = `${actionName} ${resourceName}`;

  const riskLevel = getRiskLevelForMethod(method);

  // If path has path parameters like /users/:id, it likely depends on the collection endpoint /users
  const dependsOn = [];
  if (cleanPath.includes(':') || cleanPath.includes('{')) {
    const parentPath = cleanPath.split('/:')[0].split('/{')[0];
    if (parentPath && parentPath !== cleanPath) {
      const parentSlug = parentPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
      dependsOn.push(`get-${parentSlug}`);
    }
  }

  return {
    id,
    name,
    path: cleanPath,
    method,
    riskLevel,
    defaultHeaders: {
      'Content-Type': 'application/json'
    },
    defaultBody: ['POST', 'PUT', 'PATCH'].includes(method) ? {} : undefined,
    dependsOn,
    defaultSelected: riskLevel === 'SAFE'
  };
}

/**
 * Scans the entire project and produces a complete, sorted, validated DiscoveryManifest.
 */
export function scanProject(projectRoot = process.cwd()) {
  let projectName = path.basename(projectRoot);
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) projectName = pkg.name;
    } catch {}
  }

  const { urls: envUrls } = parseEnvFiles(projectRoot);
  const configUrls = parseConfigFiles(projectRoot);
  const { endpoints: rawEndpoints, detectedBaseUrls, authInfo } = scanCodeFiles(projectRoot);

  const baseUrlsSet = new Set([...envUrls, ...configUrls, ...detectedBaseUrls]);
  if (baseUrlsSet.size === 0) {
    baseUrlsSet.add('http://localhost:3000');
  }

  const baseUrls = Array.from(baseUrlsSet);
  const defaultBaseUrl = baseUrls[0] || 'http://localhost:3000';

  // Sort endpoints topologically
  const sorted = sortEndpoints(rawEndpoints);

  return createDefaultManifest({
    projectName,
    scannedAt: new Date().toISOString(),
    baseUrls,
    defaultBaseUrl,
    auth: {
      mode: authInfo.mode,
      headerName: authInfo.headerName,
      headerPrefix: authInfo.headerPrefix,
      requiresOtp: authInfo.requiresOtp,
      token: ''
    },
    endpoints: sorted
  });
}
