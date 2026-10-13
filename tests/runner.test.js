import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runTests, injectParameters, extractParamsFromBody, diagnoseError } from '../scripts/test-runner.js';
import { saveManifest, createDefaultManifest } from '../scripts/manifest-helper.js';

test('injectParameters and extractParamsFromBody handle dynamic parameter propagation', () => {
  const context = {};
  const responseBody = {
    data: {
      userId: 42,
      profile: {
        token: 'auth-token-abc'
      }
    }
  };

  extractParamsFromBody(responseBody, context);
  assert.strictEqual(context['userid'], 42);
  assert.strictEqual(context['token'], 'auth-token-abc');

  const resolvedPath = injectParameters('/api/users/:userId/items/{token}', context);
  assert.strictEqual(resolvedPath, '/api/users/42/items/auth-token-abc');
});

test('diagnoseError categorizes HTTP status codes with Persian explanations', () => {
  const authDiag = diagnoseError(401, null, { path: '/api/secure' });
  assert.strictEqual(authDiag.category, 'AUTH_ERROR');
  assert.ok(authDiag.message.includes('401'));
  assert.ok(authDiag.suggestedFix.includes('توکن'));

  const notFoundDiag = diagnoseError(404, null, { path: '/api/missing' });
  assert.strictEqual(notFoundDiag.category, 'NOT_FOUND');

  const netDiag = diagnoseError(0, 'Connection refused', { path: '/api/test' });
  assert.strictEqual(netDiag.category, 'NETWORK_FAILURE');
});

test('runTests executes chained endpoints and saves isolated JSON response files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-e2e-'));

  // 1. Create Mock Server
  const receivedRequests = [];
  const mockServer = http.createServer((req, res) => {
    receivedRequests.push({ method: req.method, url: req.url, headers: req.headers });

    if (req.method === 'POST' && req.url === '/api/items') {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'item-888', name: 'Widget' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/items/item-888') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'item-888', status: 'ready' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise(res => mockServer.listen(0, res));
  const port = mockServer.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 2. Set up DiscoveryManifest
    const manifest = createDefaultManifest({
      projectName: 'e2e-project',
      defaultBaseUrl: baseUrl,
      endpoints: [
        {
          id: 'post-item',
          name: 'ایجاد آیتم',
          path: '/api/items',
          method: 'POST',
          riskLevel: 'MUTATING',
          executionOrder: 1,
          defaultSelected: false,
          defaultBody: { name: 'Widget' }
        },
        {
          id: 'get-item',
          name: 'دریافت آیتم',
          path: '/api/items/:id',
          method: 'GET',
          riskLevel: 'SAFE',
          executionOrder: 2,
          defaultSelected: true,
          dependsOn: ['post-item']
        }
      ]
    });
    saveManifest(manifest, tmpDir);

    const emittedEvents = [];
    await runTests({
      projectRoot: tmpDir,
      runId: 'test-run-1',
      baseUrl,
      auth: { mode: 'bearer_token', token: 'mock-token' },
      selectedEndpointIds: ['post-item', 'get-item'],
      onEvent: (type, data) => emittedEvents.push({ type, data })
    });

    // 3. Verify chained calls occurred
    assert.strictEqual(receivedRequests.length, 2);
    assert.strictEqual(receivedRequests[0].url, '/api/items');
    assert.strictEqual(receivedRequests[1].url, '/api/items/item-888');

    // 4. Verify SSE events
    const stepFinishes = emittedEvents.filter(e => e.type === 'step_finish');
    assert.strictEqual(stepFinishes.length, 2);
    assert.strictEqual(stepFinishes[0].data.httpStatus, 201);
    assert.strictEqual(stepFinishes[1].data.httpStatus, 200);

    // 5. Verify isolated JSON response files
    const responsesDir = path.join(tmpDir, '.api-tester', 'responses');
    assert.ok(fs.existsSync(responsesDir), 'Responses directory must be created');
    const savedFiles = fs.readdirSync(responsesDir);
    assert.strictEqual(savedFiles.length, 2);

    const firstFileContent = JSON.parse(fs.readFileSync(path.join(responsesDir, savedFiles[0]), 'utf-8'));
    assert.strictEqual(firstFileContent.endpointId, 'post-item');
    assert.strictEqual(firstFileContent.httpStatus, 201);
    assert.strictEqual(firstFileContent.success, true);
    assert.ok(firstFileContent.latencyMs >= 0);

  } finally {
    mockServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
