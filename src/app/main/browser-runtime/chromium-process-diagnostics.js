'use strict';

const MAX_DIAGNOSTIC_LINES = 20;
const MAX_DIAGNOSTIC_LINE_LENGTH = 500;

const WINDOWS_EXIT_HINTS = new Map([
  [0xC0000135, '系统缺少 Chromium 依赖的 DLL，请检查安装包内核文件是否完整以及 VC++ 运行库。'],
  [0xC000007B, 'Chromium 或其 DLL 的 32/64 位架构不匹配，或依赖文件已损坏。'],
  [0xC0000005, 'Chromium 发生访问冲突，请检查安全软件拦截、驱动兼容性和损坏的内核文件。'],
  [0xC000001D, '当前 CPU 不支持该 Chromium 构建使用的指令集。'],
  [0xC0000409, 'Chromium 被系统快速终止，请检查安全软件拦截、运行库和内核文件完整性。'],
]);

function normalizeDiagnosticLine(source, value) {
  const line = String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (!line) return '';
  const shortened = line.length > MAX_DIAGNOSTIC_LINE_LENGTH
    ? `${line.slice(0, MAX_DIAGNOSTIC_LINE_LENGTH)}…`
    : line;
  return `[${source}] ${shortened}`;
}

function createChromiumLaunchDiagnostics() {
  const lines = [];
  return {
    record(source, value) {
      const line = normalizeDiagnosticLine(source, value);
      if (!line) return;
      lines.push(line);
      if (lines.length > MAX_DIAGNOSTIC_LINES) lines.shift();
    },
    summarize() {
      return lines.join(' | ');
    },
  };
}

function formatWindowsExitCode(exitCode) {
  if (!Number.isInteger(exitCode)) return '';
  const unsigned = exitCode >>> 0;
  return `${exitCode} / 0x${unsigned.toString(16).toUpperCase().padStart(8, '0')}`;
}

function createChromiumProcessFailure(diagnostics, details = {}) {
  const spawnError = details.spawnError;
  const formattedCode = formatWindowsExitCode(details.exitCode);
  const hint = Number.isInteger(details.exitCode) ? WINDOWS_EXIT_HINTS.get(details.exitCode >>> 0) : '';
  const summary = diagnostics?.summarize?.() || '';
  const reason = spawnError
    ? `Chromium 进程启动失败: ${spawnError.message || spawnError}`
    : `Chromium 在完成窗口握手前退出${formattedCode ? `（退出码 ${formattedCode}）` : ''}`;
  const suffix = [hint, summary ? `内核输出: ${summary}` : '未捕获到 Chromium 内核输出'].filter(Boolean).join(' ');
  const error = /** @type {Error & {code?: string, exitCode?: number|null, diagnostic?: string}} */ (
    new Error(`${reason}。${suffix}`)
  );
  error.code = spawnError ? 'CHROMIUM_PROCESS_ERROR' : 'CHROMIUM_PROCESS_EXITED';
  error.exitCode = Number.isInteger(details.exitCode) ? details.exitCode : null;
  error.diagnostic = summary;
  return error;
}

function bindChromiumProcessFailure(instance, onFailure) {
  instance.child.once('error', (spawnError) => {
    instance.launchFailure = createChromiumProcessFailure(instance.diagnostics, { spawnError });
    onFailure(instance.launchFailure);
  });
  instance.child.once('exit', (exitCode, signal) => {
    if (instance.expectedExit) return;
    instance.launchFailure ||= createChromiumProcessFailure(instance.diagnostics, { exitCode, signal });
    onFailure(instance.launchFailure);
  });
}

module.exports = {
  bindChromiumProcessFailure,
  createChromiumLaunchDiagnostics,
  createChromiumProcessFailure,
  formatWindowsExitCode,
};
