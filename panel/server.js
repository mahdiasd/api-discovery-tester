import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { loadManifest, saveManifest, createDefaultManifest } from '../scripts/manifest-helper.js';
import { scanProject } from '../scripts/scanner.js';
import { runTests, abortCurrentTest } from '../scripts/test-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

/**
 * Creates and configures the Panel Web Server.
 */
export function createPanelServer(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const preferredPort = options.port || 3456;
  const autoOpen = options.autoOpen ?? false;

  let activeSession = null;
  const sseClients = new Set();

  function broadcastEvent(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  const server = http.createServer((req, res) => {
    // Enable CORS for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. GET /api/config
    if (req.method === 'GET' && pathname === '/api/config') {
      try {
        let manifest = loadManifest(projectRoot);
        if (!manifest) {
          manifest = scanProject(projectRoot);
          saveManifest(manifest, projectRoot);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(manifest));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 2. GET /api/test/events (SSE)
    if (req.method === 'GET' && pathname === '/api/test/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(': connected\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // 3. POST /api/test/start
    if (req.method === 'POST' && pathname === '/api/test/start') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (!payload.baseUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Field "baseUrl" is required' }));
            return;
          }

          const selectedIds = payload.selectedEndpointIds || [];
          if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Must select at least one endpoint' }));
            return;
          }

          const runId = `run_${Date.now()}`;
          activeSession = {
            runId,
            status: 'running',
            startedAt: new Date().toISOString(),
            activeBaseUrl: payload.baseUrl,
            totalEndpoints: selectedIds.length,
            completedCount: 0,
            successCount: 0,
            errorCount: 0
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            runId,
            status: 'started',
            total: selectedIds.length
          }));

          // Trigger execution asynchronously
          runTests({
            projectRoot,
            runId,
            baseUrl: payload.baseUrl,
            auth: payload.auth,
            selectedEndpointIds: selectedIds,
            onEvent: (type, data) => {
              if (type === 'step_finish') {
                activeSession.completedCount++;
                if (data.success) {
                  activeSession.successCount++;
                } else {
                  activeSession.errorCount++;
                }
              } else if (type === 'run_complete') {
                activeSession.status = 'completed';
                activeSession.finishedAt = new Date().toISOString();
              }
              broadcastEvent(type, data);
            }
          }).catch(err => {
            broadcastEvent('run_complete', {
              runId,
              status: 'failed',
              error: err.message
            });
          });

        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    // 4. POST /api/test/stop
    if (req.method === 'POST' && pathname === '/api/test/stop') {
      abortCurrentTest();
      if (activeSession) {
        activeSession.status = 'aborted';
      }
      broadcastEvent('run_complete', {
        status: 'aborted',
        message: 'تست توسط کاربر متوقف شد.'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'aborted' }));
      return;
    }

    // 5. Static files (index.html, style.css, app.js)
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(__dirname, safePath);

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(fullPath).pipe(res);
      return;
    }

    // Fallback: 404
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('یافت نشد (404 Not Found)');
  });

  function start() {
    return new Promise((resolve, reject) => {
      let currentPort = preferredPort;

      const tryListen = () => {
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            currentPort++;
            tryListen();
          } else {
            reject(err);
          }
        });

        server.listen(currentPort, () => {
          const url = `http://localhost:${currentPort}`;
          if (autoOpen) {
            launchBrowser(url);
          }
          resolve({ port: currentPort, url });
        });
      };

      tryListen();
    });
  }

  function stop() {
    return new Promise((resolve) => {
      for (const client of sseClients) {
        try { client.end(); } catch {}
      }
      sseClients.clear();
      server.close(() => resolve());
    });
  }

  return {
    server,
    start,
    stop,
    broadcastEvent,
    getSession: () => activeSession
  };
}

/**
 * Opens the URL in the system's default browser.
 */
export function launchBrowser(url) {
  const platform = process.platform;
  let cmd = '';
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  try {
    exec(cmd, (err) => {
      if (err) {
        // Silently ignore if headless/non-interactive
      }
    });
  } catch {}
}
