const path = require('path');
const { spawnSync } = require('child_process');

const preparedChromiumSandboxDirs = new Set();

function writeLog(logger, level, ...args) {
  const output = logger && typeof logger[level] === 'function' ? logger[level] : null;
  if (output) output.call(logger, ...args);
}

function describeFailure(result) {
  if (!result) return 'icacls 未返回执行结果';
  if (result.error) return String(result.error.message || result.error);
  return String(result.stderr || '').trim() || `icacls exit ${result.status}`;
}

// Chromium 的 Windows 沙箱会用 AppContainer 身份重新读取 exe、DLL 和 pak。
// 部分按用户安装的 NSIS 目录只授权当前用户，导致浏览器主进程能启动，
// Network Service 却因“拒绝访问”崩溃，最终可见页停在 about:blank。
function ensureChromiumSandboxAccess(executablePath, logger = console, {
  platform = process.platform,
  env = process.env,
  spawnSync: run = spawnSync,
} = {}) {
  if (platform !== 'win32') return { ok: true, skipped: true };

  const chromiumDir = path.dirname(path.resolve(String(executablePath || '')));
  if (preparedChromiumSandboxDirs.has(chromiumDir)) return { ok: true, cached: true };

  const systemRoot = String(env.SystemRoot || env.WINDIR || 'C:\\Windows');
  const result = run(path.join(systemRoot, 'System32', 'icacls.exe'), [
    chromiumDir,
    '/grant',
    '*S-1-15-2-1:(OI)(CI)(RX)',
    '*S-1-15-2-2:(OI)(CI)(RX)',
    '/T',
    '/C',
    '/Q',
  ], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (!result || result.error || result.status !== 0) {
    const detail = describeFailure(result);
    writeLog(logger, 'warn', '[ChromiumRuntime] 修复 Chromium 沙箱读取权限失败:', detail);
    return { ok: false, error: detail, status: result?.status };
  }

  preparedChromiumSandboxDirs.add(chromiumDir);
  writeLog(logger, 'info', '[ChromiumRuntime] Chromium 沙箱读取权限已确认:', chromiumDir);
  return { ok: true };
}

module.exports = { ensureChromiumSandboxAccess };
