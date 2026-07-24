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
    limit: 1000, keyword: '登录', selector: '', tag: '', filter: '', includeText: true, includeMedia: false,
    showHighlights: true, highlightDurationMs: 5000,
  });
  const hiddenMarks = normalizeRuntimeAutomation('observe-page', {
    mark: false, highlight_duration_ms: 999999,
  });
  assert.equal(hiddenMarks.showHighlights, false);
  assert.equal(hiddenMarks.highlightDurationMs, 30000);
  assert.equal(normalizeRuntimeAutomation('perform-action', {
    action: 'type', selector: '#email', text: 'a@example.com', timeout: 1,
  }).timeoutMs, 100);
  const selectorClick = normalizeRuntimeAutomation('perform-action', {
    action: 'click', selector: '#submit',
  });
  assert.equal(Object.hasOwn(selectorClick, 'x'), false);
  assert.equal(Object.hasOwn(selectorClick, 'y'), false);
  assert.deepEqual(
    normalizeRuntimeAutomation('perform-action', { action: 'click', x: 25, y: 40 }),
    { ...selectorClick, selector: '', x: 25, y: 40 },
  );
  assert.deepEqual(normalizeRuntimeAutomation('capture-screenshot', {
    format: 'webp', quality: 101, text: '订单', clip: { x: 2, y: 3, width: 40, height: 50 },
  }), {
    format: 'webp', quality: 100, x: 2, y: 3, width: 40, height: 50,
    selector: '', text: '订单', margin: 0, fullPage: false,
  });
  assert.equal(normalizeRuntimeAutomation('observe-page', {
    query: '提交', tags: ['button', 'a'], filter: ['interactive', 'text'],
  }).tag, 'button,a');
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

test('fork automation commands are allowlisted without a browser automation extension', () => {
  for (const command of [
    'observe-page', 'capture-screenshot', 'perform-action', 'get-session-data',
    'manage-tabs', 'clear-site-data',
  ]) {
    assert.equal(ALLOWED_COMMANDS.has(command), true);
  }
  assert.equal(fs.existsSync(path.join(
    __dirname, '../../../src/assets/extensions/browser_automation',
  )), false);
});

test('fork mouse actions retain native input while the cursor display layer is removed', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const inputPatch = fs.readFileSync(
    path.join(patchDirectory, '0021-ai-free-native-mouse-input.patch'), 'utf8',
  );
  const targetingPatch = fs.readFileSync(
    path.join(patchDirectory, '0029-ai-free-click-target-and-failure.patch'), 'utf8',
  );
  const frameCoordinatePatch = fs.readFileSync(
    path.join(patchDirectory, '0030-ai-free-frame-element-coordinates.patch'), 'utf8',
  );

  assert.match(inputPatch, /DispatchAiFreeMouseInput/);
  assert.match(inputPatch, /ForwardMouseEvent/);
  assert.match(inputPatch, /inputMode", "chromium-native-input/);
  assert.doesNotMatch(inputPatch, /^\+.*(?:PointerOverlay|AnimatedCursor|SetPaintToLayer)/m);
  assert.match(series, /0020-ai-free-page-automation\.patch\s+0021-ai-free-native-mouse-input\.patch/);
  assert.match(series, /0027-ai-free-native-screenshot-and-input-parity\.patch\s+0029-ai-free-click-target-and-failure\.patch/);
  assert.match(targetingPatch, /bounds\.IsEmpty\(\)/);
  assert.match(targetingPatch, /COORDINATE_OUT_OF_VIEWPORT/);
  assert.match(series, /0029-ai-free-click-target-and-failure\.patch\s+0030-ai-free-frame-element-coordinates\.patch/);
  assert.match(frameCoordinatePatch, /rectInTop/);
  assert.match(frameCoordinatePatch, /frame\.clientLeft/);
  assert.match(frameCoordinatePatch, /frame\.offsetWidth/);
  assert.doesNotMatch(inputPatch, /^\+.*(?:document\.body\.append|createElement\(['"](?:div|img))/m);
});

test('fork observe patch returns structured download links', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0022-ai-free-observe-download-links.patch'), 'utf8',
  );
  assert.match(series, /0021-ai-free-native-mouse-input\.patch\s+0022-ai-free-observe-download-links\.patch/);
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

test('fork observe highlights stay in the native event-transparent UI layer', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0024-ai-free-native-observe-highlights.patch'), 'utf8',
  );
  assert.match(series, /0023-ai-free-native-keyboard-wheel\.patch\s+0024-ai-free-native-observe-highlights\.patch/);
  assert.match(patch, /SetCanProcessEventsWithinSubtree\(false\)/);
  assert.match(patch, /kMaximumHighlightCount = 120/);
  assert.match(patch, /chromium-native-overlay/);
  assert.match(patch, /OnVisibilityChanged/);
  assert.doesNotMatch(patch, /^\+.*(?:document\.body\.append|createElement)/m);
});

test('fork native card support manages tabs and limits site clearing to the current origin', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0025-ai-free-native-tab-and-site-data.patch'), 'utf8',
  );
  assert.match(series, /0024-ai-free-native-observe-highlights\.patch\s+0025-ai-free-native-tab-and-site-data\.patch/);
  assert.match(patch, /ClearDataForOrigin/);
  assert.match(patch, /ManageTabs/);
  assert.doesNotMatch(patch, /ClearBrowsingData/);
});

test('fork native card targeting supports selector filters, text, nth and hidden waits', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0026-ai-free-native-card-targeting.patch'), 'utf8',
  );
  assert.match(series, /0025-ai-free-native-tab-and-site-data\.patch\s+0026-ai-free-native-card-targeting\.patch/);
  assert.match(patch, /selectorFilter/);
  assert.match(patch, /targetText/);
  assert.match(patch, /const nth=/);
  assert.match(patch, /a\.hidden/);
});

test('fork native screenshot and input parity supports precise capture and modifiers', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0027-ai-free-native-screenshot-and-input-parity.patch'), 'utf8',
  );
  assert.match(series, /0026-ai-free-native-card-targeting\.patch\s+0027-ai-free-native-screenshot-and-input-parity\.patch/);
  assert.match(patch, /PageContentScreenshotService/);
  assert.match(patch, /JPEGCodec/);
  assert.match(patch, /WebpCodec/);
  assert.match(patch, /kMaximumScreenshotArea/);
  assert.match(patch, /kControlKey/);
  assert.match(patch, /UsLayoutKeyboardCodeToDomCode/);
  assert.match(patch, /scrollHeight/);
  assert.match(patch, /a\.clearFirst/);
});

test('fork cursor actions resolve physical coordinates before committing input', () => {
  const patchDirectory = path.join(__dirname, '../../../native/chromium-fork/patches');
  const patch = fs.readFileSync(
    path.join(patchDirectory, '0031-ai-free-cursor-two-phase-actions.patch'),
    'utf8',
  );
  assert.match(patch, /resolve-action-target/);
  assert.match(patch, /commit-resolved-action/);
  assert.match(patch, /targetPhysical/);
  assert.match(patch, /TransformPointToRootCoordSpaceF/);
  assert.match(patch, /DIPToScreenRectInWindow/);
  assert.match(patch, /deleted file mode 100644[\s\S]*ai_free_automation_pointer/);
  assert.match(patch, /ai_free_mouse_input\.cc/);
  assert.doesNotMatch(patch, /^\+.*(?:PointerOverlay|chromium-visible-pointer)/m);
  const series = fs.readFileSync(path.join(patchDirectory, 'series'), 'utf8');
  assert.match(
    series,
    /0030-ai-free-frame-element-coordinates\.patch\s+0031-ai-free-cursor-two-phase-actions\.patch/,
  );
});
