import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { loadManifest } from './manifest-helper.js';

let abortRequested = false;

/**
 * Requests abort of any currently running test sequence.
 */
export function abortCurrentTest() {
  abortRequested = true;
}

/**
 * Diagnoses response error and returns a diagnostic object or null.
 * @param {number} status 
 * @param {string|null} errMessage 
 * @param {object} ep 
 */
export function diagnoseError(status, errMessage = null, ep = {}) {
  if (status >= 200 && status < 300) {
    return null;
  }

  if (status === 0 || errMessage) {
    return {
      category: 'NETWORK_FAILURE',
      message: 'برقراری ارتباط با وب‌سرویس با خطا مواجه شد (عدم پاسخگویی سرور یا قطعی شبکه).',
      suggestedFix: 'بررسی کنید که سرور بک‌اند در حال اجرا باشد و آدرس Base URL در پنل به درستی وارد شده باشد.'
    };
  }

  if (status === 401 || status === 403) {
    return {
      category: 'AUTH_ERROR',
      message: `خطای دسترسی یا عدم احراز هویت (کد وضعیت ${status}).`,
      suggestedFix: 'توکن دسترسی منقضی شده یا دسترسی نامعتبر است. لطفاً توکن جدید یا اطلاعات ورود را در پنل بازبینی کنید.'
    };
  }

  if (status === 404) {
    return {
      category: 'NOT_FOUND',
      message: `مسیر مورد نظر یافت نشد (کد وضعیت 404): ${ep.path || ''}`,
      suggestedFix: 'آدرس مسیر و پیشوند Base URL را بررسی کنید؛ ممکن است نسخه API یا ساختار مسیر تغییر کرده باشد.'
    };
  }

  if (status === 422 || status === 400) {
    return {
      category: 'VALIDATION_ERROR',
      message: `داده‌های ارسالی توسط سرور پذیرفته نشد (کد وضعیت ${status}).`,
      suggestedFix: 'بدنه درخواست (Body) یا پارامترهای ارسالی الزامی هستند یا قالب آن‌ها اشتباه است.'
    };
  }

  if (status >= 500) {
    return {
      category: 'SERVER_FAULT',
      message: `سرور با خطای داخلی مواجه شد (کد وضعیت ${status}).`,
      suggestedFix: 'لاگ‌های سمت سرور بک‌اند را بررسی نمایید تا ریشه خطای داخلی مشخص شود.'
    };
  }

  return {
    category: 'SERVER_FAULT',
    message: `پاسخ ناموفق از سرور با کد وضعیت ${status}.`,
    suggestedFix: 'پاسخ ذخیره‌شده را در پوشه responses بررسی کنید.'
  };
}

/**
 * Executes a single HTTP/HTTPS request.
 */
export function executeHttpRequest({ url, method, headers = {}, body = null, timeout = 15000 }) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions = {
        method: (method || 'GET').toUpperCase(),
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: { ...headers },
        timeout
      };

      let bodyData = null;
      if (body) {
        bodyData = typeof body === 'string' ? body : JSON.stringify(body);
        reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
        if (!reqOptions.headers['Content-Type']) {
          reqOptions.headers['Content-Type'] = 'application/json';
        }
      }

      const req = client.request(reqOptions, (res) => {
        let rawData = '';
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          let parsedBody = rawData;
          try {
            parsedBody = JSON.parse(rawData);
          } catch {}

          const respHeaders = {};
          for (const [k, v] of Object.entries(res.headers)) {
            respHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
          }

          resolve({
            httpStatus: res.statusCode || 0,
            latencyMs,
            success: (res.statusCode >= 200 && res.statusCode < 300),
            responseHeaders: respHeaders,
            responseBody: parsedBody,
            error: null
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          httpStatus: 0,
          latencyMs: Date.now() - startTime,
          success: false,
          responseHeaders: {},
          responseBody: null,
          error: 'Request timed out'
        });
      });

      req.on('error', (err) => {
        resolve({
          httpStatus: 0,
          latencyMs: Date.now() - startTime,
          success: false,
          responseHeaders: {},
          responseBody: null,
          error: err.message
        });
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();

    } catch (err) {
      resolve({
        httpStatus: 0,
        latencyMs: Date.now() - startTime,
        success: false,
        responseHeaders: {},
        responseBody: null,
        error: err.message
      });
    }
  });
}

/**
 * Recursively extracts parameter values (such as id, token, uuid, etc.) from response body.
 */
export function extractParamsFromBody(body, context = {}) {
  if (!body || typeof body !== 'object') return context;

  if (Array.isArray(body)) {
    if (body.length > 0 && typeof body[0] === 'object') {
      extractParamsFromBody(body[0], context);
    }
    return context;
  }

  for (const [key, value] of Object.entries(body)) {
    if (value !== null && typeof value !== 'object') {
      const lowerKey = key.toLowerCase();
      const strippedKey = lowerKey.replace(/[_-]/g, '');
      if (lowerKey === 'id' || lowerKey.endsWith('id') || lowerKey.includes('token') || strippedKey === 'jwt') {
        context[key] = value;
        context[lowerKey] = value;
        context[strippedKey] = value;
      }
    } else if (typeof value === 'object') {
      extractParamsFromBody(value, context);
    }
  }

  return context;
}

/**
 * Replaces parameters like :id, {id}, :userId in path using context map.
 */
export function injectParameters(urlPath, context = {}) {
  let result = urlPath;

  // 1. Direct matches with context keys
  for (const [key, val] of Object.entries(context)) {
    const stringVal = encodeURIComponent(String(val));
    result = result.replace(new RegExp(`:${key}\\b`, 'gi'), stringVal);
    result = result.replace(new RegExp(`\\{${key}\\}`, 'gi'), stringVal);
  }

  // 2. Fallback resolution for common id/param suffixes if generic id exists in context
  const fallbackId = context['id'] || context['orderid'] || context['userid'] || context['itemid'];
  if (fallbackId !== undefined) {
    const stringId = encodeURIComponent(String(fallbackId));
    result = result.replace(/:([a-zA-Z0-9_-]*id)\b/gi, stringId);
    result = result.replace(/\{([a-zA-Z0-9_-]*id)\}/gi, stringId);
    result = result.replace(/:param\b/gi, stringId);
    result = result.replace(/\{param\}/gi, stringId);
  }

  // 3. Fallback for remaining unresolved params
  result = result.replace(/:([a-zA-Z0-9_-]+)/g, '1');
  result = result.replace(/\{([a-zA-Z0-9_-]+)\}/g, '1');

  return result;
}

/**
 * Saves execution result to .api-tester/responses/{step}_{method}_{slug}.json.
 */
export function saveExecutionResult({ projectRoot, outputDir = '.api-tester/responses', stepIndex, method, epPath, resultData }) {
  const dirPath = path.resolve(projectRoot, outputDir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const slug = epPath
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'root';

  const fileName = `${stepIndex}_${method.toUpperCase()}_${slug}.json`;
  const fullPath = path.join(dirPath, fileName);

  fs.writeFileSync(fullPath, JSON.stringify(resultData, null, 2), 'utf-8');
  return path.relative(projectRoot, fullPath).replace(/\\/g, '/');
}

/**
 * Runs the chain of selected tests and emits SSE events.
 */
export async function runTests({
  projectRoot = process.cwd(),
  runId,
  baseUrl,
  auth = {},
  selectedEndpointIds = [],
  onEvent = () => {}
}) {
  abortRequested = false;

  const manifest = loadManifest(projectRoot);
  const allEndpoints = manifest?.endpoints || [];
  const endpointMap = new Map(allEndpoints.map(ep => [ep.id, ep]));

  const endpointsToRun = selectedEndpointIds
    .map(id => endpointMap.get(id))
    .filter(Boolean)
    .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0));

  const propagationContext = {};
  const currentAuth = { ...(auth || {}) };
  const cleanBaseUrl = (baseUrl || '').replace(/\/+$/, '');

  for (let i = 0; i < endpointsToRun.length; i++) {
    if (abortRequested) {
      break;
    }

    const ep = endpointsToRun[i];
    const stepIndex = i + 1;

    onEvent('step_start', {
      runId,
      endpointId: ep.id,
      stepIndex,
      total: endpointsToRun.length,
      method: ep.method,
      path: ep.path
    });

    // Prepare URL with injected parameters
    const resolvedPath = injectParameters(ep.path, propagationContext);
    const finalUrl = resolvedPath.startsWith('http') ? resolvedPath : `${cleanBaseUrl}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;

    // Prepare Headers
    const headers = {
      'Accept': 'application/json',
      ...(ep.defaultHeaders || {})
    };

    // Apply authentication headers (using currentAuth which holds initial token OR dynamically extracted token from prior steps)
    if (currentAuth.token) {
      if (currentAuth.mode === 'custom_header') {
        headers[currentAuth.headerName || 'X-API-Key'] = currentAuth.token;
      } else {
        const prefix = currentAuth.headerPrefix !== undefined ? currentAuth.headerPrefix : 'Bearer ';
        const tokenVal = currentAuth.token.startsWith(prefix) ? currentAuth.token : `${prefix}${currentAuth.token}`;
        headers[currentAuth.headerName || 'Authorization'] = tokenVal;
      }
    } else if (currentAuth.mode === 'login_credentials') {
      if (currentAuth.username && currentAuth.password) {
        const encoded = Buffer.from(`${currentAuth.username}:${currentAuth.password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
      }
    }

    if (currentAuth.mode === 'two_factor_otp' && currentAuth.otpCode) {
      headers['X-OTP-Code'] = currentAuth.otpCode;
      headers['X-2FA-Code'] = currentAuth.otpCode;
    }

    // Determine request body (if login endpoint and credentials mode, populate body if empty)
    let requestBody = ep.defaultBody || null;
    const isLoginEndpoint = /login|auth|signin/i.test(ep.path) || /login|auth|signin/i.test(ep.name);
    if (isLoginEndpoint && currentAuth.mode === 'login_credentials' && (!requestBody || Object.keys(requestBody).length === 0)) {
      if (currentAuth.username && currentAuth.password) {
        requestBody = {
          username: currentAuth.username,
          password: currentAuth.password
        };
      }
    }

    // Execute Request
    const response = await executeHttpRequest({
      url: finalUrl,
      method: ep.method,
      headers,
      body: requestBody
    });

    // Extract dynamic params for downstream requests
    if (response.responseBody) {
      extractParamsFromBody(response.responseBody, propagationContext);
    }

    // Dynamic token propagation: inspect response body and headers for newly issued tokens
    const candidateTokens = [
      propagationContext['token'],
      propagationContext['accesstoken'],
      propagationContext['access_token'],
      propagationContext['jwt'],
      propagationContext['authtoken'],
      propagationContext['idtoken'],
      (response.responseHeaders && response.responseHeaders['authorization']),
      (response.responseHeaders && response.responseHeaders['x-auth-token'])
    ];

    const detectedToken = candidateTokens.find(t => typeof t === 'string' && t.trim().length > 0);
    if (detectedToken) {
      const cleanToken = detectedToken.replace(/^Bearer\s+/i, '').trim();
      currentAuth.token = cleanToken;
      if (currentAuth.mode === 'login_credentials' || currentAuth.mode === 'none') {
        currentAuth.mode = 'bearer_token';
      }
    }

    // Diagnose error
    const diagnostics = diagnoseError(response.httpStatus, response.error, ep);

    // Build Execution Result adhering to execution-result-schema
    const executionResult = {
      endpointId: ep.id,
      stepIndex,
      timestamp: new Date().toISOString(),
      url: finalUrl,
      method: ep.method,
      httpStatus: response.httpStatus,
      latencyMs: response.latencyMs,
      success: response.success,
      requestHeaders: headers,
      requestBody: requestBody,
      responseHeaders: response.responseHeaders,
      responseBody: response.responseBody,
      propagatedToken: currentAuth.token || null,
      diagnostics
    };

    // Save to disk
    const savedFilePath = saveExecutionResult({
      projectRoot,
      outputDir: '.api-tester/responses',
      stepIndex,
      method: ep.method,
      epPath: ep.path,
      resultData: executionResult
    });

    executionResult.savedFilePath = savedFilePath;

    onEvent('step_finish', executionResult);
  }

  onEvent('run_complete', {
    runId,
    status: abortRequested ? 'aborted' : 'completed',
    totalExecuted: endpointsToRun.length
  });
}
