'use strict';

const { spawnSync } = require('child_process');

try {
  require.resolve('express');
  process.exit(0);
} catch {
  console.log('\nلم أجد اعتماديات NOVA. سأثبتها الآن لأول مرة...\n');
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['install', '--omit=dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(`تعذّر تشغيل npm: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error('فشل تثبيت الاعتماديات. تحقق من اتصال الإنترنت ثم أعد تشغيل npm start.');
  process.exit(result.status || 1);
}
