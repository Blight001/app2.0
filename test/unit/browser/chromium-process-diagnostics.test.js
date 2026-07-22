'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createChromiumLaunchDiagnostics,
  createChromiumProcessFailure,
  formatWindowsExitCode,
} = require('../../../src/app/main/browser-runtime/chromium-process-diagnostics');

test('Windows 有符号退出码同时显示十六进制 NTSTATUS', () => {
  assert.equal(formatWindowsExitCode(-1073741515), '-1073741515 / 0xC0000135');
});

test('Chromium 诊断仅保留最近的有限输出并附加到失败消息', () => {
  const diagnostics = createChromiumLaunchDiagnostics();
  for (let index = 0; index < 25; index += 1) diagnostics.record('stderr', `line-${index}`);

  const error = createChromiumProcessFailure(diagnostics, { exitCode: 1 });

  assert.equal(error.code, 'CHROMIUM_PROCESS_EXITED');
  assert.ok(!error.message.includes('line-0'));
  assert.ok(error.message.includes('line-24'));
});
