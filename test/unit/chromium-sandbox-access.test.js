const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureChromiumSandboxAccess } = require('../../src/app/main/browser-runtime/chromium-launcher');

test('Windows Chromium 目录授予 AppContainer 只读执行权限', () => {
  let invocation = null;
  const result = ensureChromiumSandboxAccess('C:\\AI-FREE\\chromium\\ai-free-browser.exe', console, {
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    spawnSync(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(invocation.command, 'C:\\Windows\\System32\\icacls.exe');
  assert.deepEqual(invocation.args.slice(1, 4), [
    '/grant',
    '*S-1-15-2-1:(OI)(CI)(RX)',
    '*S-1-15-2-2:(OI)(CI)(RX)',
  ]);
  assert.ok(invocation.args.includes('/T'));
  assert.equal(invocation.options.windowsHide, true);
});

test('非 Windows 平台不调用 icacls', () => {
  let called = false;
  const result = ensureChromiumSandboxAccess('/opt/ai-free/chromium', console, {
    platform: 'linux',
    spawnSync() {
      called = true;
    },
  });

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(called, false);
});
