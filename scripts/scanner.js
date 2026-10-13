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

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.kt', '.java']);

/**
 * Recursively collects file paths up to maxDepth.
 */
function walkDir(dir, fileList = [], depth = 0, maxDepth = 16) {
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
        if (CODE_EXTENSIONS.has(ext) || entry.name.startsWith('.env') || entry.name.endsWith('.properties') || entry.name.includes('config')) {
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
 * Extracts environment variables and URLs from .env* and .properties files.
 */
export function parseEnvFiles(projectRoot) {
  const urls = new Set();
  const envVars = {};

  try {
    const entries = fs.readdirSync(projectRoot);
    const envFiles = entries.filter(f => f.startsWith('.env') || f.endsWith('.properties'));

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
 * Parses config files like vite.config.*, next.config.*, webpack.config.*, build.gradle* for proxy/API targets.
 */
export function parseConfigFiles(projectRoot) {
  const urls = new Set();
  const configNames = [
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'nuxt.config.ts', 'webpack.config.js',
    'build.gradle.kts', 'build.gradle', 'settings.gradle.kts'
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

        // Match buildConfigField or properties with URLs
        const urlMatches = content.matchAll(/['"`](https?:\/\/[^'"`\s]+)['"`]/gi);
        for (const match of urlMatches) {
          if (match[1] && !match[1].includes('schemas.') && !match[1].includes('w3.org')) {
            urls.add(match[1].replace(/\/+$/, ''));
          }
        }
      } catch (err) {}
    }
  }

  return Array.from(urls);
}

/**
 * Scans code files for network client calls (Axios, Fetch, Ky, RTK Query, Ktor, Retrofit) and auth headers.
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

    // Detect standalone URLs like "https://api..."
    const fullUrlMatch = content.matchAll(/['"`](https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[^'"`\s]*)?)['"`]/gi);
    for (const m of fullUrlMatch) {
      try {
        const parsed = new URL(m[1]);
        if (!parsed.hostname.includes('w3.org') && !parsed.hostname.includes('schema') && !parsed.hostname.includes('github') && !parsed.hostname.includes('google')) {
          detectedBaseUrls.add(`${parsed.protocol}//${parsed.host}`);
          if (parsed.pathname && parsed.pathname.length > 1) {
            const key = `GET:${parsed.pathname}`;
            if (!endpointSeen.has(key)) {
              endpointSeen.add(key);
              foundEndpoints.push(createEndpointDescriptor('GET', parsed.pathname));
            }
          }
        }
      } catch {}
    }

    // Detect Auth / OTP indicators
    if (/otp|2fa|two_factor|verification.*code/i.test(content)) {
      authInfo.requiresOtp = true;
    }
    const apiKeyMatch = content.match(/headers?\.(?:append|put)?\s*\(\s*["']X-API-Key["']\s*,\s*["']([^"']+)["']/i);
    if (apiKeyMatch) {
      authInfo.mode = 'custom_header';
      authInfo.headerName = 'X-API-Key';
      authInfo.headerPrefix = '';
      authInfo.token = apiKeyMatch[1];
    } else if (/x-api-key/i.test(content)) {
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

    // 5. Retrofit annotations: @GET("..."), @POST("...")
    const retrofitRegex = /@(GET|POST|PUT|PATCH|DELETE)\s*\(\s*["']([^"']+)["']\s*\)/gi;
    while ((match = retrofitRegex.exec(content)) !== null) {
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

    // 6. Ktor: url(BuildConfig.BaseUrl + "path") or httpClient.post("path") or url("path")
    const ktorUrlRegex = /(?:url\s*\(\s*(?:BuildConfig\.[a-zA-Z0-9_]+\s*\+\s*|\$\{BuildConfig\.[a-zA-Z0-9_]+\}|")|(?:\.httpClient|\bclient)\.(get|post|put|patch|delete)\s*\(\s*(?:BuildConfig\.[a-zA-Z0-9_]+\s*\+\s*|\$\{BuildConfig\.[a-zA-Z0-9_]+\}|")|url\s*\(\s*)["']?([^"')\r\n]+)["']?\)?/gi;
    let ktorMatch;
    while ((ktorMatch = ktorUrlRegex.exec(content)) !== null) {
      let rawPath = ktorMatch[2] || ktorMatch[0];
      const pathMatch = rawPath.match(/["']([a-zA-Z0-9_/:-]+)["']/);
      if (pathMatch) {
        let epPath = pathMatch[1];
        if (epPath.startsWith('http')) {
          try {
            const u = new URL(epPath);
            epPath = u.pathname;
            detectedBaseUrls.add(`${u.protocol}//${u.host}`);
          } catch {}
        }
        if (!epPath.startsWith('/')) epPath = '/' + epPath;
        if (epPath.length > 1 && !epPath.includes(' ') && !epPath.includes('=')) {
          // Determine method
          let method = 'GET';
          if (/post/i.test(ktorMatch[1] || '')) method = 'POST';
          else if (/delete/i.test(ktorMatch[1] || '')) method = 'DELETE';
          else if (/put/i.test(ktorMatch[1] || '')) method = 'PUT';
          else if (/logout|login|replace|join|avatar|register/i.test(epPath)) method = 'POST';
          else if (/delete|remove|cancel/i.test(epPath)) method = 'DELETE';

          const key = `${method}:${epPath}`;
          if (!endpointSeen.has(key)) {
            endpointSeen.add(key);
            foundEndpoints.push(createEndpointDescriptor(method, epPath));
          }
        }
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
