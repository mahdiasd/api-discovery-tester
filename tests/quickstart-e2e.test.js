import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanProject } from '../scripts/scanner.js';
import { saveManifest, saveApisMarkdown, loadManifest } from '../scripts/manifest-helper.js';
import { createPanelServer } from '../panel/server.js';
import { runTests } from '../scripts/test-runner.js';

test('Quickstart E2E Scenarios (Scenarios 1 through 4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-e2e-'));
  let serverInstance = null;
  let targetServer = null;

  try {
    // ----------------------------------------------------
    // Scenario 1: Zero-Config Start (Scan, apis.md, discovery.json, Panel Launch)
    // ----------------------------------------------------
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'quickstart-sample-app' }));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'VITE_API_URL=http://localhost:9000');

    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'api.js'), `
      import axios from 'axios';
      export const login = (creds) => axios.post('/api/auth/login', creds);
      export const getOrders = () => axios.get('/api/orders');
      export const getOrderDetails = (orderId) => axios.get(\`/api/orders/\${orderId}\`);
      export const cancelOrder = (orderId) => axios.delete(\`/api/orders/\${orderId}\`);
    `);

    // Perform scan & save artifacts
    const manifest = scanProject(tmpDir);
    assert.strictEqual(manifest.projectName, 'quickstart-sample-app');
    assert.strictEqual(manifest.endpoints.length, 4);

    const manifestPath = saveManifest(manifest, tmpDir);
    assert.ok(fs.existsSync(manifestPath), 'discovery.json must exist');

    const apisMdPath = saveApisMarkdown(manifest, tmpDir);
    assert.ok(fs.existsSync(apisMdPath), 'apis.md must exist');
    const apisMdContent = fs.readFileSync(apisMdPath, 'utf-8');
    assert.ok(apisMdContent.includes('quickstart-sample-app'));
    assert.ok(apisMdContent.includes('/api/orders'));

    // Start panel server
    serverInstance = createPanelServer({ projectRoot: tmpDir, port: 4900, autoOpen: false });
    const { url } = await serverInstance.start();
    assert.ok(url.startsWith('http://localhost:'));

    // ----------------------------------------------------
    // Scenario 2: Auth & 2FA Configuration
    // ----------------------------------------------------
    manifest.auth = {
      mode: 'two_factor_otp',
      token: 'temp-jwt-token',
      requiresOtp: true,
      otpCode: '852963',
      headerName: 'Authorization',
      headerPrefix: 'Bearer '
    };
    saveManifest(manifest, tmpDir);
    const reloaded = loadManifest(tmpDir);
    assert.strictEqual(reloaded.auth.mode, 'two_factor_otp');
    assert.strictEqual(reloaded.auth.requiresOtp, true);

    // ----------------------------------------------------
    // Mock Target Server for Scenarios 3 & 4
    // ----------------------------------------------------
    targetServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'jwt-session-xyz', userId: 101 }));
        return;
      }
      if (req.method === 'GET' && req.url === '/api/orders') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 'ORD-777', total: 1500 }]));
        return;
      }
      if (req.method === 'GET' && req.url === '/api/orders/ORD-777') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'ORD-777', status: 'shipped' }));
        return;
      }
      if (req.method === 'DELETE' && req.url === '/api/orders/ORD-777') {
        // Scenario 4: Error trigger (401 Unauthorized)
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized cancellation' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Route not found' }));
    });

    await new Promise(r => targetServer.listen(0, r));
    const targetPort = targetServer.address().port;
    const targetBaseUrl = `http://localhost:${targetPort}`;

    // ----------------------------------------------------
    // Scenario 3: Chained Execution, Live Monitoring, JSON Saving
    // ----------------------------------------------------
    const endpointIds = manifest.endpoints.map(e => e.id);
    const events = [];
    await runTests({
      projectRoot: tmpDir,
      runId: 'e2e-run',
      baseUrl: targetBaseUrl,
      auth: { mode: 'bearer_token', token: 'jwt-session-xyz' },
      selectedEndpointIds: endpointIds,
      onEvent: (type, data) => events.push({ type, data })
    });

    // Check responses folder
    const respDir = path.join(tmpDir, '.api-tester', 'responses');
    assert.ok(fs.existsSync(respDir));
    const savedFiles = fs.readdirSync(respDir);
    assert.strictEqual(savedFiles.length, 4, 'Must save 4 isolated JSON response files');

    // ----------------------------------------------------
    // Scenario 4: Error Diagnostics Validation
    // ----------------------------------------------------
    const deleteStepFinish = events.find(e => e.type === 'step_finish' && e.data.method === 'DELETE');
    assert.ok(deleteStepFinish, 'DELETE step must finish');
    assert.strictEqual(deleteStepFinish.data.success, false);
    assert.strictEqual(deleteStepFinish.data.httpStatus, 401);
    assert.ok(deleteStepFinish.data.diagnostics);
    assert.strictEqual(deleteStepFinish.data.diagnostics.category, 'AUTH_ERROR');
    assert.ok(deleteStepFinish.data.diagnostics.suggestedFix.includes('توکن'));

  } finally {
    if (serverInstance) {
      await serverInstance.stop();
    }
    if (targetServer) {
      targetServer.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
