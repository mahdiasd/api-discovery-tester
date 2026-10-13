#!/usr/bin/env node

import path from 'node:path';
import { scanProject } from '../scripts/scanner.js';
import { saveManifest, saveApisMarkdown } from '../scripts/manifest-helper.js';
import { createPanelServer } from '../panel/server.js';

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

console.log('⚡ در حال اسکن پروژه فرانت‌اند در مسیر:', targetDir);

try {
  const manifest = scanProject(targetDir);
  console.log(`✔ پروژه "${manifest.projectName}" اسکن شد (${manifest.endpoints.length} وب‌سرویس کشف گردید).`);

  const manifestPath = saveManifest(manifest, targetDir);
  const apisMdPath = saveApisMarkdown(manifest, targetDir);
  console.log('✔ مانیفست کشف در:', manifestPath);
  console.log('✔ مستندات وب‌سرویس‌ها در:', apisMdPath);

  const server = createPanelServer({
    projectRoot: targetDir,
    port: 3456,
    autoOpen: true
  });

  server.start().then(({ url }) => {
    console.log(`\n🚀 پنل وب با موفقیت اجرا شد: ${url}`);
    console.log('مرورگر شما به صورت خودکار باز شد. برای بستن سرور کلیدهای Ctrl+C را فشار دهید.\n');
  }).catch(err => {
    console.error('خطا در اجرای وب‌سرور پنل:', err);
  });

} catch (err) {
  console.error('خطا در فرایند کشف پروژه:', err.message);
  process.exit(1);
}
