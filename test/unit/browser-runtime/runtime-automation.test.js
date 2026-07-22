'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  dispatchRuntimeAutomationByProcessId,
  normalizeRuntimeAutomation,
} = require('../../../src/app/main/browser-runtime/runtime-automation');
const { ALLOWED_COMMANDS } = require('../../../src/app/main/browser-runtime/chromium-command-client');

test('normalizes bounded native observe and action payloads', () => {
  assert.deepEqual(normalizeRuntimeAutomation('observe-page', {
    max_items: 5000, keyword: '登录', include_media: false,
  }), {
    limit: 1000, keyword: '登录', tag: '', filter: '', includeText: true, includeMedia: false,
  });
  assert.equal(normalizeRuntimeAutomation('perform-action', {
    action: 'type', selector: '#email', text: 'a@example.com', timeout: 1,
  }).timeoutMs, 100);
});

test('rejects unknown native commands and actions', () => {
  assert.throws(() => normalizeRuntimeAutomation('execute-script', {}), /不支持的 Chromium 自动化命令/);
  assert.throws(() => normalizeRuntimeAutomation('perform-action', { action: 'eval' }), /不支持的原生页面动作/);
});

test('routes native automation only to a live managed Chromium process', async () => {
  const sent = [];
  const runtime = {
    instances: new Map([['profile-a', { child: { pid: 42, exitCode: null } }]]),
    enqueueProfileOperation: (_id, operation) => operation(),
    getReadyInstance: () => ({
      commandClient: { send: async (...args) => { sent.push(args); return { ok: true }; } },
    }),
  };
  await dispatchRuntimeAutomationByProcessId(runtime, 42, 'capture-screenshot', {});
  assert.equal(sent[0][0], 'capture-screenshot');
  await assert.rejects(
    dispatchRuntimeAutomationByProcessId(runtime, 41, 'observe-page', {}),
    /不属于当前受管 Profile/,
  );
});

test('fork automation commands are allowlisted and the extension no longer injects on every page', () => {
  for (const command of ['observe-page', 'capture-screenshot', 'perform-action', 'get-session-data']) {
    assert.equal(ALLOWED_COMMANDS.has(command), true);
  }
  const manifestPath = path.join(
    __dirname, '../../../src/assets/extensions/browser_automation/manifest.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'content_scripts'), false);
});

test('fork click patch uses an event-transparent visible Chromium pointer', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0021-ai-free-visible-pointer.patch'), 'utf8',
  );

  assert.match(series, /0020-ai-free-page-automation\.patch\s+0021-ai-free-visible-pointer\.patch/);
  assert.match(patch, /SetCanProcessEventsWithinSubtree\(false\)/);
  assert.match(patch, /kViewIgnoredByLayoutKey/);
  assert.match(patch, /ForwardMouseEvent/);
  assert.match(patch, /inputMode", "chromium-visible-pointer/);
  assert.doesNotMatch(patch, /document\.body\.append|createElement\(['"](?:div|img)/);
});

test('fork observe patch returns structured download links', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0022-ai-free-observe-download-links.patch'), 'utf8',
  );
  assert.match(series, /0021-ai-free-visible-pointer\.patch\s+0022-ai-free-observe-download-links\.patch/);
  assert.match(patch, /downloadUrl/);
  assert.match(patch, /downloadLinks/);
  assert.match(patch, /downloadLinkCount/);
});

test('fork keyboard and scroll actions use fixed native input events', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0023-ai-free-native-keyboard-wheel.patch'), 'utf8',
  );
  assert.match(series, /0022-ai-free-observe-download-links\.patch\s+0023-ai-free-native-keyboard-wheel\.patch/);
  assert.match(patch, /NativeWebKeyboardEvent/);
  assert.match(patch, /ForwardKeyboardEvent/);
  assert.match(patch, /ForwardWheelEvent/);
  assert.doesNotMatch(patch, /^\+.*dispatchEvent\(new (?:InputEvent|KeyboardEvent)/m);
});
