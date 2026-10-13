import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const ALLOWED_RISK_LEVELS = ['SAFE', 'MUTATING', 'DESTRUCTIVE'];
const ALLOWED_AUTH_MODES = ['none', 'bearer_token', 'login_credentials', 'two_factor_otp', 'custom_header'];

/**
 * Validates a discovery manifest object against the schema and data-model rules.
 * @param {object} manifest 
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  if (!manifest.projectName || typeof manifest.projectName !== 'string') {
    errors.push('Missing or invalid "projectName"');
  }

  if (!manifest.scannedAt || typeof manifest.scannedAt !== 'string') {
    errors.push('Missing or invalid "scannedAt"');
  }

  if (!Array.isArray(manifest.baseUrls)) {
    errors.push('Field "baseUrls" must be an array of strings');
  }

  if (typeof manifest.defaultBaseUrl !== 'string') {
    errors.push('Missing or invalid "defaultBaseUrl"');
  }

  if (!manifest.auth || typeof manifest.auth !== 'object') {
    errors.push('Missing "auth" object');
  } else {
    if (!ALLOWED_AUTH_MODES.includes(manifest.auth.mode)) {
      errors.push(`Invalid auth mode: ${manifest.auth.mode}. Allowed: ${ALLOWED_AUTH_MODES.join(', ')}`);
    }
    if (typeof manifest.auth.headerName !== 'string') {
      errors.push('Auth object must contain string "headerName"');
    }
    if (typeof manifest.auth.requiresOtp !== 'boolean') {
      errors.push('Auth object must contain boolean "requiresOtp"');
    }
  }

  if (!Array.isArray(manifest.endpoints)) {
    errors.push('Field "endpoints" must be an array');
  } else {
    manifest.endpoints.forEach((ep, index) => {
      const prefix = `Endpoint[${index}] (${ep?.id || 'unknown'})`;
      if (!ep.id || typeof ep.id !== 'string') {
        errors.push(`${prefix}: Missing or invalid "id"`);
      }
      if (!ep.name || typeof ep.name !== 'string') {
        errors.push(`${prefix}: Missing or invalid "name"`);
      }
      if (!ep.path || typeof ep.path !== 'string') {
        errors.push(`${prefix}: Missing or invalid "path"`);
      } else if (!ep.path.startsWith('/') && !/^https?:\/\//i.test(ep.path)) {
        errors.push(`${prefix}: Path must start with "/" or be a valid URL`);
      }
      if (!ALLOWED_METHODS.includes(ep.method)) {
        errors.push(`${prefix}: Invalid HTTP method "${ep.method}"`);
      }
      if (!ALLOWED_RISK_LEVELS.includes(ep.riskLevel)) {
        errors.push(`${prefix}: Invalid riskLevel "${ep.riskLevel}"`);
      }
      if (typeof ep.executionOrder !== 'number' || !Number.isInteger(ep.executionOrder)) {
        errors.push(`${prefix}: "executionOrder" must be an integer`);
      }
      if (typeof ep.defaultSelected !== 'boolean') {
        errors.push(`${prefix}: "defaultSelected" must be a boolean`);
      } else if (['MUTATING', 'DESTRUCTIVE'].includes(ep.riskLevel) && ep.defaultSelected === true) {
        errors.push(`${prefix}: Mutating or destructive endpoints must have defaultSelected = false`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Creates a default manifest template.
 */
export function createDefaultManifest(overrides = {}) {
  return {
    projectName: overrides.projectName || 'frontend-app',
    scannedAt: overrides.scannedAt || new Date().toISOString(),
    baseUrls: overrides.baseUrls || ['http://localhost:3000'],
    defaultBaseUrl: overrides.defaultBaseUrl || 'http://localhost:3000',
    auth: {
      mode: 'bearer_token',
      token: '',
      headerName: 'Authorization',
      headerPrefix: 'Bearer ',
      loginEndpoint: '',
      requiresOtp: false,
      ...(overrides.auth || {})
    },
    endpoints: overrides.endpoints || [],
    outputDirectory: overrides.outputDirectory || '.api-tester/'
  };
}

/**
 * Saves manifest to .api-tester/discovery.json under projectRoot.
 */
export function saveManifest(manifest, projectRoot = process.cwd()) {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Cannot save invalid manifest: ${validation.errors.join('; ')}`);
  }

  const outDir = path.resolve(projectRoot, manifest.outputDirectory || '.api-tester');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const targetPath = path.join(outDir, 'discovery.json');
  fs.writeFileSync(targetPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return targetPath;
}

/**
 * Loads manifest from .api-tester/discovery.json under projectRoot.
 */
export function loadManifest(projectRoot = process.cwd(), outputDir = '.api-tester') {
  const targetPath = path.resolve(projectRoot, outputDir, 'discovery.json');
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  const raw = fs.readFileSync(targetPath, 'utf-8');
  const data = JSON.parse(raw);
  const validation = validateManifest(data);
  if (!validation.valid) {
    throw new Error(`Corrupted discovery.json: ${validation.errors.join('; ')}`);
  }
  return data;
}

/**
 * Generates apis.md markdown content based on manifest.
 */
export function generateApisMarkdown(manifest, templateContent = '') {
  const endpoints = [...(manifest.endpoints || [])].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0));

  const tableRows = endpoints.map(ep => {
    const deps = (ep.dependsOn && ep.dependsOn.length > 0) ? ep.dependsOn.map(d => `\`${d}\``).join(', ') : '-';
    return `| ${ep.executionOrder} | ${ep.name} | \`${ep.method}\` | \`${ep.path}\` | \`${ep.riskLevel}\` | ${deps} |`;
  }).join('\n');

  const detailsSections = endpoints.map(ep => {
    const deps = (ep.dependsOn && ep.dependsOn.length > 0) ? ep.dependsOn.map(d => `\`${d}\``).join(', ') : 'ندارد';
    const headerLines = ep.defaultHeaders
      ? Object.entries(ep.defaultHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')
      : 'Content-Type: application/json';

    let bodyBlock = '';
    if (ep.defaultBody && Object.keys(ep.defaultBody).length > 0) {
      bodyBlock = `\n**بدنه نمونه درخواست**:\n\`\`\`json\n${JSON.stringify(ep.defaultBody, null, 2)}\n\`\`\`\n`;
    }

    return `### ${ep.executionOrder}. ${ep.name} (\`${ep.id}\`)

- **متد**: \`${ep.method}\`
- **مسیر**: \`${ep.path}\`
- **سطح ریسک**: \`${ep.riskLevel}\`
- **پیش‌نیازها**: ${deps}

\`\`\`http
${ep.method} ${ep.path} HTTP/1.1
${headerLines}
\`\`\`
${bodyBlock}
---`;
  }).join('\n\n');

  if (templateContent) {
    let output = templateContent
      .replace(/{{projectName}}/g, manifest.projectName || 'پروژه فرانت‌اند')
      .replace(/{{scannedAt}}/g, manifest.scannedAt || new Date().toISOString())
      .replace(/{{defaultBaseUrl}}/g, manifest.defaultBaseUrl || '')
      .replace(/{{authMode}}/g, manifest.auth?.mode || 'none')
      .replace(/{{authHeader}}/g, manifest.auth?.headerName || 'Authorization')
      .replace(/{{totalEndpoints}}/g, String(endpoints.length));

    // Replace table section
    output = output.replace(/{{#endpointsTable}}[\s\S]*?{{\/endpointsTable}}/, tableRows);
    // Replace details section
    output = output.replace(/{{#endpointsDetails}}[\s\S]*?{{\/endpointsDetails}}/, detailsSections);
    return output;
  }

  // Fallback markdown if template not provided
  return `# مستندات وب‌سرویس‌های پروژه: ${manifest.projectName}

- **زمان اسکن**: ${manifest.scannedAt}
- **آدرس پایه پیش‌فرض**: \`${manifest.defaultBaseUrl}\`
- **روش احراز هویت**: \`${manifest.auth?.mode}\` (هدر: \`${manifest.auth?.headerName}\`)
- **تعداد وب‌سرویس‌ها**: ${endpoints.length}

---

## فهرست وب‌سرویس‌ها (به ترتیب اولویت وابستگی)

| ردیف | نام سرویس | متد | مسیر | سطح ریسک | وابستگی‌ها |
| :---: | :--- | :---: | :--- | :---: | :--- |
${tableRows}

---

## جزییات وب‌سرویس‌ها

${detailsSections}
`;
}

/**
 * Saves apis.md in project root based on template and manifest.
 */
export function saveApisMarkdown(manifest, projectRoot = process.cwd(), templatePath = null) {
  let templateContent = '';
  const defaultTemplate = templatePath || path.resolve(__dirname || '.', '../templates/apis-template.md');
  if (fs.existsSync(defaultTemplate)) {
    try {
      templateContent = fs.readFileSync(defaultTemplate, 'utf-8');
    } catch {}
  }

  const markdown = generateApisMarkdown(manifest, templateContent);
  const targetPath = path.resolve(projectRoot, 'apis.md');
  fs.writeFileSync(targetPath, markdown, 'utf-8');
  return targetPath;
}

