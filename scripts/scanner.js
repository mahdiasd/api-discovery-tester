import fs from 'node:fs';
import path from 'node:path';
import { getRiskLevelForMethod, sortEndpoints, isAuthLoginEndpoint } from './dependency-sorter.js';
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
  '.gradle',
  '.idea',
  'coverage'
]);

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.kt', '.java']);

const EXCLUDED_HOST_PATTERNS = [
  'w3.org', 'xml.org', 'xmlpull.org', 'adobe.com', 'apache.org', 'schema.org',
  'myket.ir', 'jitpack.io', 'maven', 'gradle', 'github.com', 'gitlab', 'google.com',
  'android.com', 'picsum.photos', 'xsgames.co', 'soft98.ir', 'salamdonya.com',
  'xmlns', 'localhost/sax'
];

const EXCLUDED_PATH_EXTENSIONS = [
  '.html', '.htm', '.xml', '.dtd', '.xsd', '.png', '.jpg', '.jpeg', '.gif',
  '.svg', '.ico', '.css', '.map', '.txt', '.json'
];

/**
 * Validates whether a path is a genuine API endpoint and not an XML schema/file asset.
 */
export function isValidApiEndpoint(epPath) {
  if (!epPath || typeof epPath !== 'string') return false;
  const lower = epPath.toLowerCase().trim();

  if (lower.length < 3) return false;
  if (/^\/[a-zA-Z0-9]$/.test(lower)) return false;
  if (/\s/.test(lower)) return false;
  if (lower.includes('/sax/') || lower.includes('/features/') || lower.includes('/properties/')) return false;
  if (lower.includes('xmlpull') || lower.includes('xmlns') || lower.includes('doctype')) return false;

  for (const ext of EXCLUDED_PATH_EXTENSIONS) {
    if (lower.endsWith(ext)) return false;
  }

  return true;
}

/**
 * Validates whether a URL represents an actual backend API host.
 */
export function isValidBaseUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const host = parsed.hostname.toLowerCase();
    for (const bad of EXCLUDED_HOST_PATTERNS) {
      if (host.includes(bad)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

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
 * Extracts environment variables and backend URLs from .env* and .properties files.
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

          // Check if key represents an API URL
          if (/API|BASE_URL|SERVER|BACKEND|URL|ENDPOINT|ONLINE/i.test(key) && /^https?:\/\//i.test(val)) {
            const cleanUrl = val.replace(/\/+$/, '');
            if (isValidBaseUrl(cleanUrl)) {
              urls.add(cleanUrl);
            }
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
 * Parses build and config files for proxy/API targets.
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

        // Proxy targets
        const targetMatches = content.matchAll(/target\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/gi);
        for (const match of targetMatches) {
          if (match[1] && isValidBaseUrl(match[1])) {
            urls.add(match[1].replace(/\/+$/, ''));
          }
        }

        // buildConfigField with URLs
        const bcfMatches = content.matchAll(/buildConfigField\s*\(\s*["']String["']\s*,\s*["'](?:BaseUrl|AgentUrl|ApiUrl|OnlineBaseUrl)["']\s*,\s*(?:secretProps\.getProperty\([^)]+,\s*)?["']([^"')\r\n]+)["']/gi);
        for (const m of bcfMatches) {
          if (m[1] && isValidBaseUrl(m[1])) {
            urls.add(m[1].replace(/\/+$/, ''));
          }
        }

        // Explicit OnlineBaseUrl in gradle
        const onlineBaseMatches = content.matchAll(/OnlineBaseUrl["']?\s*,\s*["']\\?"(https?:\/\/[^"'\\]+)/gi);
        for (const m of onlineBaseMatches) {
          if (m[1] && isValidBaseUrl(m[1])) {
            urls.add(m[1].replace(/\/+$/, ''));
          }
        }
      } catch (err) {}
    }
  }

  return Array.from(urls);
}

/**
 * Scans code files for network client calls and auth headers.
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

  function registerEndpoint(method, rawPath, fnName = null) {
    let epPath = rawPath.trim();
    if (!epPath) return;

    // If path is a full URL, split into BaseUrl and Path
    if (/^https?:\/\//i.test(epPath)) {
      try {
        const u = new URL(epPath);
        if (isValidBaseUrl(`${u.protocol}//${u.host}`)) {
          detectedBaseUrls.add(`${u.protocol}//${u.host}`);
        }
        epPath = u.pathname;
      } catch {
        return;
      }
    }

    // Clean leading/trailing tokens
    epPath = epPath.replace(/^(\$\{BuildConfig\.[a-zA-Z0-9_]+\}|BuildConfig\.[a-zA-Z0-9_]+\s*\+\s*)/, '');
    epPath = epPath.replace(/^["']|["']$/g, '').trim();

    if (!epPath.startsWith('/') && !epPath.startsWith('http')) {
      epPath = '/' + epPath;
    }

    if (!isValidApiEndpoint(epPath)) return;

    const cleanMethod = (method || 'GET').toUpperCase();
    const key = `${cleanMethod}:${epPath}`;

    if (!endpointSeen.has(key)) {
      endpointSeen.add(key);
      foundEndpoints.push(createEndpointDescriptor(cleanMethod, epPath, fnName));
    }
  }

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // 1. Detect Axios baseURL
    const baseMatch = content.matchAll(/baseURL\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/gi);
    for (const m of baseMatch) {
      if (m[1] && isValidBaseUrl(m[1])) {
        detectedBaseUrls.add(m[1].replace(/\/+$/, ''));
      }
    }

    // 2. Detect Auth / OTP indicators
    if (/otp|2fa|two_factor|verification.*code/i.test(content)) {
      authInfo.requiresOtp = true;
    }

    const apiKeyMatch = content.match(/headers?\.(?:append|put|header)?\s*\(\s*["']X-API-Key["']\s*,\s*["']([^"']+)["']/i);
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

    // 3. Kotlin / Ktor Extraction
    // Match function declaration with method and url
    const ktorMethodRegex = /(?:override\s+suspend\s+fun|suspend\s+fun|fun)\s+([a-zA-Z0-9_]+)[\s\S]*?(?:provider\.httpClient|\bclient|httpClient)?\.(get|post|put|patch|delete)[\s\S]*?url\s*\(\s*(?:BuildConfig\.[a-zA-Z0-9_]+\s*\+\s*|\$\{BuildConfig\.[a-zA-Z0-9_]+\}|")?['"]([^'"]+)['"]/g;
    let ktorMatch;
    while ((ktorMatch = ktorMethodRegex.exec(content)) !== null) {
      const fnName = ktorMatch[1];
      const method = ktorMatch[2].toUpperCase();
      const rawPath = ktorMatch[3];
      registerEndpoint(method, rawPath, fnName);
    }

    // Match Ktor builder url("/path") or url(BuildConfig.BaseUrl + "/path")
    const ktorUrlRegex = /\burl\s*\(\s*(?:(?:BuildConfig\.[a-zA-Z0-9_]+|["'\w]+)\s*\+\s*)?['"](\/[a-zA-Z0-9_/{}:.-]+)['"]/g;
    let genMatch;
    while ((genMatch = ktorUrlRegex.exec(content)) !== null) {
      const rawPath = genMatch[1];
      let inferredMethod = 'GET';
      if (/login|logout|replace|create|submit|join|avatar|upload|register|post/i.test(rawPath)) {
        inferredMethod = 'POST';
      } else if (/delete|remove|cancel/i.test(rawPath)) {
        inferredMethod = 'DELETE';
      }
      registerEndpoint(inferredMethod, rawPath);
    }

    // Direct HTTP client call in Ktor: client.get("/path"), httpClient.post("/path")
    const ktorClientCallRegex = /(?:client|httpClient|provider\.httpClient)\.(get|post|put|patch|delete)\s*\(\s*['"](\/[^'"]+)['"]/gi;
    let ktorCallMatch;
    while ((ktorCallMatch = ktorClientCallRegex.exec(content)) !== null) {
      registerEndpoint(ktorCallMatch[1].toUpperCase(), ktorCallMatch[2]);
    }

    // 4. Retrofit Extraction
    const retrofitRegex = /@(GET|POST|PUT|PATCH|DELETE)\s*\(\s*["']([^"']+)["']\s*\)(?:\s*(?:suspend\s+)?fun\s+([a-zA-Z0-9_]+))?/gi;
    let retroMatch;
    while ((retroMatch = retrofitRegex.exec(content)) !== null) {
      const method = retroMatch[1].toUpperCase();
      const rawPath = retroMatch[2];
      const fnName = retroMatch[3] || null;
      registerEndpoint(method, rawPath, fnName);
    }

    // 5. JavaScript / TypeScript: Axios, Ky, Fetch
    if (ext !== '.kt' && ext !== '.java') {
      const clientCallRegex = /(?:axios|api|client|http|request|ky)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^\s'"`]+)['"`]/gi;
      let clientMatch;
      while ((clientMatch = clientCallRegex.exec(content)) !== null) {
        registerEndpoint(clientMatch[1].toUpperCase(), clientMatch[2]);
      }
    }

    const fetchRegex = /fetch\s*\(\s*['"`]([^\s'"`]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`]([a-zA-Z]+)['"`])?/gi;
    let fetchMatch;
    while ((fetchMatch = fetchRegex.exec(content)) !== null) {
      const method = (fetchMatch[2] || 'GET').toUpperCase();
      registerEndpoint(method, fetchMatch[1]);
    }

    // 6. RTK Query
    const rtkQueryRegex = /query\s*:\s*\([^)]*\)\s*=>\s*(?:\{[^}]*url\s*:\s*['"`]([^\s'"`]+)['"`]|['"`]([^\s'"`]+)['"`])/gi;
    let rtkQMatch;
    while ((rtkQMatch = rtkQueryRegex.exec(content)) !== null) {
      registerEndpoint('GET', rtkQMatch[1] || rtkQMatch[2]);
    }

    const rtkMutationRegex = /url\s*:\s*['"`]([^\s'"`]+)['"`]\s*,\s*method\s*:\s*['"`]([a-zA-Z]+)['"`]/gi;
    let rtkMMatch;
    while ((rtkMMatch = rtkMutationRegex.exec(content)) !== null) {
      registerEndpoint(rtkMMatch[2].toUpperCase(), rtkMMatch[1]);
    }
  }

  return {
    endpoints: foundEndpoints,
    detectedBaseUrls: Array.from(detectedBaseUrls),
    authInfo
  };
}

/**
 * Creates a clean, English descriptor for each endpoint.
 */
function createEndpointDescriptor(method, epPath, fnName = null) {
  const cleanPath = epPath
    .replace(/\$\{([a-zA-Z0-9_.]+)\}/g, (_, varName) => `:${varName.split('.').pop()}`)
    .replace(/\$\{.*?\}/g, ':param')
    .replace(/\/+$/, '') || '/';

  const slug = cleanPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'root';
  const id = `${method.toLowerCase()}-${slug}`;

  // Form a readable English name
  let name = '';
  if (fnName) {
    name = fnName.replace(/([A-Z])/g, ' $1').trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);
  } else {
    const parts = cleanPath.split('/').filter(Boolean);
    const last = parts.length > 0 ? parts[parts.length - 1] : 'Root';
    const action = method === 'GET' ? 'Get' : method === 'POST' ? 'Create' : method === 'PUT' ? 'Update' : method === 'DELETE' ? 'Delete' : method;
    name = `${action} ${last.replace(/[-_:]/g, ' ')}`;
  }

  // Explicit Auth / Login naming
  if (cleanPath.includes('/auth/login') || cleanPath.endsWith('/login')) {
    name = 'User Login (Authenticate)';
  } else if (cleanPath.includes('/auth/logout')) {
    name = 'User Logout';
  }

  const riskLevel = getRiskLevelForMethod(method);
  const isLogin = isAuthLoginEndpoint({ path: cleanPath, id });

  // Dependencies
  const dependsOn = [];
  if (cleanPath.includes(':') || cleanPath.includes('{')) {
    const parentPath = cleanPath.split('/:')[0].split('/{')[0];
    if (parentPath && parentPath !== cleanPath) {
      const parentSlug = parentPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
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
    defaultSelected: (riskLevel === 'SAFE' || isLogin)
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

  const baseUrls = Array.from(baseUrlsSet).filter(isValidBaseUrl);
  if (baseUrls.length === 0) {
    baseUrls.push('http://localhost:3000');
  }

  // Choose default Base URL (prioritize staging-app or dev/api host if present)
  let defaultBaseUrl = baseUrls[0];
  const preferredUrl = baseUrls.find(u => /staging-app|api|backend/i.test(u));
  if (preferredUrl) {
    defaultBaseUrl = preferredUrl;
  }

  // Sort endpoints topologically with Login at #1
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
      token: authInfo.token || ''
    },
    endpoints: sorted
  });
}
