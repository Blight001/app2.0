const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ensureChromiumSandboxAccess } = require('../src/app/main/browser-runtime/chromium-launcher');

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

test('NSIS 安装后为 Chromium 写入相同的 AppContainer 权限', () => {
  const packageJson = require('../package.json');
  const include = packageJson.build?.nsis?.include;
  const script = fs.readFileSync(path.join(__dirname, '..', include), 'utf8');

  assert.equal(include, 'scripts/installer.nsh');
  assert.match(script, /S-1-15-2-1:\(OI\)\(CI\)\(RX\)/);
  assert.match(script, /S-1-15-2-2:\(OI\)\(CI\)\(RX\)/);
});
