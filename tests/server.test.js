import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPanelServer } from '../panel/server.js';
import { validateManifest } from '../scripts/manifest-helper.js';

function fetchGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on('error', reject);
  });
}

test('Panel server serves static assets correctly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
  const serverInstance = createPanelServer({ projectRoot: tmpDir, port: 4500, autoOpen: false });

  try {
    const { url } = await serverInstance.start();

    // 1. GET / (index.html)
    const indexRes = await fetchGet(`${url}/`);
    assert.strictEqual(indexRes.statusCode, 200);
    assert.ok(indexRes.headers['content-type'].includes('text/html'));
    assert.ok(indexRes.body.includes('API Tester'));

    // 2. GET /style.css
    const cssRes = await fetchGet(`${url}/style.css`);
    assert.strictEqual(cssRes.statusCode, 200);
    assert.ok(cssRes.headers['content-type'].includes('text/css'));

    // 3. GET /app.js
    const jsRes = await fetchGet(`${url}/app.js`);
    assert.strictEqual(jsRes.statusCode, 200);
    assert.ok(jsRes.headers['content-type'].includes('javascript'));
  } finally {
    await serverInstance.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Panel server /api/config returns discovery manifest adhering to schema', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-api-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'sample-project' }));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'VITE_API_URL=https://api.mycorp.org');

    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'client.js'), `
      export const getProfile = () => fetch('/api/v1/profile');
    `);

    const serverInstance = createPanelServer({ projectRoot: tmpDir, port: 4600, autoOpen: false });
    const { url } = await serverInstance.start();

    try {
      const configRes = await fetchGet(`${url}/api/config`);
      assert.strictEqual(configRes.statusCode, 200);
      assert.ok(configRes.headers['content-type'].includes('application/json'));

      const manifest = JSON.parse(configRes.body);
      const validation = validateManifest(manifest);
      assert.strictEqual(validation.valid, true, `Validation failed: ${validation.errors.join(', ')}`);
      assert.strictEqual(manifest.projectName, 'sample-project');
      assert.strictEqual(manifest.defaultBaseUrl, 'https://api.mycorp.org');
      assert.ok(manifest.endpoints.length >= 1);
    } finally {
      await serverInstance.stop();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function fetchPost(url, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

test('Panel server POST /api/test/start validates payload and starts run', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'api-app' }));
    const serverInstance = createPanelServer({ projectRoot: tmpDir, port: 4700, autoOpen: false });
    const { url } = await serverInstance.start();

    try {
      // 1. Missing baseUrl -> 400
      const errRes1 = await fetchPost(`${url}/api/test/start`, { selectedEndpointIds: ['ep-1'] });
      assert.strictEqual(errRes1.statusCode, 400);

      // 2. Empty endpoints -> 400
      const errRes2 = await fetchPost(`${url}/api/test/start`, { baseUrl: 'https://api.dev.com', selectedEndpointIds: [] });
      assert.strictEqual(errRes2.statusCode, 400);

      // 3. Valid -> 200
      const okRes = await fetchPost(`${url}/api/test/start`, {
        baseUrl: 'https://api.dev.com',
        auth: { mode: 'bearer_token', token: 'token-123' },
        selectedEndpointIds: ['ep-1']
      });
      assert.strictEqual(okRes.statusCode, 200);
      const okBody = JSON.parse(okRes.body);
      assert.strictEqual(okBody.status, 'started');
      assert.strictEqual(okBody.total, 1);
      assert.ok(okBody.runId.startsWith('run_'));
    } finally {
      await serverInstance.stop();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Panel server GET /api/test/events streams SSE frames correctly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sse-test-'));
  const serverInstance = createPanelServer({ projectRoot: tmpDir, port: 4800, autoOpen: false });
  const { url } = await serverInstance.start();

  try {
    const ssePromise = new Promise((resolve, reject) => {
      const parsed = new URL(`${url}/api/test/events`);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'GET'
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('text/event-stream'));

        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk.toString();
          if (buffer.includes('event: step_start')) {
            req.destroy();
            resolve(buffer);
          }
        });
      });

      req.on('error', (err) => {
        if (err.code !== 'ECONNRESET') reject(err);
      });
      req.end();
    });

    // Give SSE connection a moment to establish, then broadcast an event
    await new Promise(r => setTimeout(r, 60));
    serverInstance.broadcastEvent('step_start', { endpointId: 'ep-test', stepIndex: 1 });

    const received = await ssePromise;
    assert.ok(received.includes(': connected'));
    assert.ok(received.includes('event: step_start'));
    assert.ok(received.includes('"endpointId":"ep-test"'));

  } finally {
    await serverInstance.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


