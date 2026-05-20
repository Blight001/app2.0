const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const { resolveRceditPath } = require('./rcedit-path');
const { resolveAppIconPath } = require(path.join(repoRoot, 'src', 'app', 'main', 'utils', 'app-icon'));

function findPackagedExe(context) {
  const productFilename = context?.packager?.appInfo?.productFilename || 'AI-FREE';
  const candidates = [
    path.join(context?.appOutDir || '', `${productFilename}.exe`),
    path.join(context?.appOutDir || '', 'AI-FREE.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

module.exports = async function afterPack(context) {
  if (process.platform !== 'win32') {
    return;
  }

  const appExePath = findPackagedExe(context);
  const appIconPath = resolveAppIconPath();
  const rceditPath = resolveRceditPath();

  if (!appExePath || !rceditPath || !fs.existsSync(rceditPath) || !fs.existsSync(appIconPath)) {
    console.log('[afterPack] 跳过图标补写', {
      appExePath: appExePath || '',
      hasRcedit: Boolean(rceditPath) && fs.existsSync(rceditPath),
      hasIcon: fs.existsSync(appIconPath),
    });
    return;
  }

  const result = spawnSync(rceditPath, [appExePath, '--set-icon', appIconPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`rcedit set-icon failed with status ${result.status}`);
  }

  console.log('[afterPack] Windows 程序图标已写入:', path.relative(repoRoot, appExePath));
};
