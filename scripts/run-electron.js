const path = require('path');
const { spawn } = require('child_process');

function createElectronEnv(baseEnv = process.env) {
  const nextEnv = { ...baseEnv };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  nextEnv.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  return nextEnv;
}

function main() {
  let cliPath = '';
  try {
    cliPath = require.resolve('electron/cli.js');
  } catch (error) {
    console.error('[electron-runner] 无法解析 electron/cli.js:', error?.message || error);
    process.exit(1);
    return;
  }

  const args = process.argv.slice(2);
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: createElectronEnv(),
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (error) => {
    console.error('[electron-runner] 启动 Electron 失败:', error?.message || error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main();
