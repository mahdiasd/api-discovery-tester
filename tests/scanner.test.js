import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseEnvFiles, parseConfigFiles, scanCodeFiles, scanProject } from '../scripts/scanner.js';
import { validateManifest } from '../scripts/manifest-helper.js';

test('parseEnvFiles extracts base URLs from .env files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'VITE_API_URL=https://api.test.example.com\nPORT=3000\n');
    fs.writeFileSync(path.join(tmpDir, '.env.local'), 'REACT_APP_API_URL="http://localhost:8080"\n');

    const result = parseEnvFiles(tmpDir);
    assert.ok(result.urls.includes('https://api.test.example.com'));
    assert.ok(result.urls.includes('http://localhost:8080'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseConfigFiles extracts proxy target URLs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  try {
    const viteContent = `
      export default {
        server: {
          proxy: {
            '/api': {
              target: 'https://backend.internal.net',
              changeOrigin: true
            }
          }
        }
      }
    `;
    fs.writeFileSync(path.join(tmpDir, 'vite.config.js'), viteContent);

    const urls = parseConfigFiles(tmpDir);
    assert.ok(urls.includes('https://backend.internal.net'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanCodeFiles detects Axios, Fetch, and RTK Query endpoints', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-test-'));
  try {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);

    const apiCode = `
      import axios from 'axios';
      const api = axios.create({ baseURL: 'https://api.service.io' });

      export const getUsers = () => api.get('/api/v1/users');
      export const createUser = (data) => api.post('/api/v1/users', data);
      export const deleteUser = (id) => fetch(\`/api/v1/users/\${id}\`, { method: 'DELETE' });
    `;
    fs.writeFileSync(path.join(srcDir, 'api.js'), apiCode);

    const { endpoints, detectedBaseUrls } = scanCodeFiles(tmpDir);

    assert.ok(detectedBaseUrls.includes('https://api.service.io'));

    const paths = endpoints.map(e => `${e.method} ${e.path}`);
    assert.ok(paths.includes('GET /api/v1/users'));
    assert.ok(paths.includes('POST /api/v1/users'));
    assert.ok(paths.some(p => p.startsWith('DELETE /api/v1/users')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanProject generates a fully valid DiscoveryManifest', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-scan-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-test-app' }));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'API_URL=https://api.live.com');

    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'services.js'), `
      export const loadFeed = () => fetch('/api/feed');
    `);

    const manifest = scanProject(tmpDir);
    const validation = validateManifest(manifest);

    assert.strictEqual(validation.valid, true, `Validation errors: ${validation.errors.join(', ')}`);
    assert.strictEqual(manifest.projectName, 'my-test-app');
    assert.strictEqual(manifest.defaultBaseUrl, 'https://api.live.com');
    assert.strictEqual(manifest.endpoints.length, 1);
    assert.strictEqual(manifest.endpoints[0].method, 'GET');
    assert.strictEqual(manifest.endpoints[0].path, '/api/feed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
