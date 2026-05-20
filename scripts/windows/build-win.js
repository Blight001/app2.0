const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const appExePath = path.join(repoRoot, 'appbuild', 'win-unpacked', 'AI-FREE.exe');
const appIconPath = path.join(repoRoot, 'src', 'assets', 'seedance2.0.ico');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const { resolveRceditPath } = require('./rcedit-path');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 0;
}

function patchIcon() {
  const rceditPath = resolveRceditPath();

  if (!rceditPath || !fs.existsSync(rceditPath) || !fs.existsSync(appExePath) || !fs.existsSync(appIconPath)) {
    return { ok: false, skipped: true };
  }

  const result = spawnSync(rceditPath, [appExePath, '--set-icon', appIconPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    return { ok: false, error: result.error.message || String(result.error) };
  }

  return {
    ok: result.status === 0,
    skipped: false,
    status: result.status ?? 0,
  };
}

function cleanupStaleArtifacts() {
  const outputDir = path.join(repoRoot, 'appbuild');
  if (!fs.existsSync(outputDir)) {
    return;
  }

  const patterns = [
    /\.nsis\.7z$/i,
    /\.nsis\.7z\.blockmap$/i,
  ];

  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (!patterns.some((pattern) => pattern.test(entry.name))) {
      continue;
    }

    try {
      fs.unlinkSync(path.join(outputDir, entry.name));
    } catch (_) {}
  }
}

function main() {
  console.log('==========================================');
  console.log('  AI-FREE 安装程序打包工具');
  console.log('==========================================');
  console.log('');
  console.log('正在生成 Windows 安装程序（NSIS）...');
  console.log('');

  cleanupStaleArtifacts();

  const buildStatus = runCommand(npmCommand, ['run', 'build:win']);
  if (buildStatus !== 0) {
    console.log('');
    console.log(`打包失败，错误码: ${buildStatus}`);
    process.exit(buildStatus);
  }

  const iconResult = patchIcon();
  if (!iconResult.skipped) {
    console.log('');
    console.log('正在补写 Windows 程序图标...');
  }
  if (iconResult.ok) {
    console.log('图标补写完成');
  } else if (!iconResult.skipped) {
    console.log(`图标补写失败，但安装包已生成: ${iconResult.error || iconResult.status || 'unknown'}`);
  }

  console.log('');
  console.log('打包完成，安装程序已输出到 appbuild 目录');
}

try {
  main();
} catch (error) {
  console.log('');
  console.log(`打包失败，错误码: 1`);
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
