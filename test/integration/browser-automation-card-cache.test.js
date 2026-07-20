'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CARD_CACHE_FILE_NAME,
  createBrowserAutomationBridge,
  createCardCacheStore,
  normalizeBrowserToolOutcome,
} = require('../../src/app/main/services/browser-automation-bridge');
const {
  resolveCardCacheDeleteTarget,
} = require('../../src/assets/extensions/browser_automation/background/04_cache');
const {
  executeNavigationAwareWait,
} = require('../../src/assets/extensions/browser_automation/background/02_sidebar_wait');

test('automation cards persist in the software extension directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-card-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const firstBrowser = createCardCacheStore({ dataDir: root });
  assert.equal(firstBrowser.read().exists, false);

  const saved = firstBrowser.write({
    items: [{
      id: 'shared-card',
      cardName: '共享卡片',
      cardData: { name: '共享卡片', steps: [{ type: 'navigate', url: 'https://example.com' }] },
      savedAt: '2026-07-16T00:00:00.000Z',
    }],
    selectedId: 'shared-card',
  });
  assert.equal(saved.selectedId, 'shared-card');
  assert.equal(fs.existsSync(path.join(root, CARD_CACHE_FILE_NAME)), true);

  // A newly injected browser gets a fresh extension storage area, but reads the
  // same software-level card file through the local bridge.
  const newlyInjectedBrowser = createCardCacheStore({ dataDir: root });
  const reloaded = newlyInjectedBrowser.read();
  assert.equal(reloaded.exists, true);
  assert.equal(reloaded.state.items.length, 1);
  assert.equal(reloaded.state.items[0].cardData.name, '共享卡片');
});

test('an explicitly emptied shared card library stays present', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-card-cache-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createCardCacheStore({ dataDir: root });
  store.write({ items: [], selectedId: 'stale-card' });

  const reloaded = store.read();
  assert.equal(reloaded.exists, true);
  assert.deepEqual(reloaded.state, { items: [], selectedId: '' });
});

test('AI card deletion resolves the selected card, id, and card name safely', () => {
  const state = {
    items: [
      { id: 'generated-id-1', cardName: '登录卡片', cardData: { name: '登录卡片' } },
      { id: 'generated-id-2', cardName: '注册卡片', cardData: { name: '注册卡片' } },
    ],
    selectedId: 'generated-id-2',
  };

  assert.equal(resolveCardCacheDeleteTarget(state).id, 'generated-id-2');
  assert.equal(resolveCardCacheDeleteTarget(state, 'generated-id-1').id, 'generated-id-1');
  assert.equal(resolveCardCacheDeleteTarget(state, '注册卡片').id, 'generated-id-2');
  assert.throws(
    () => resolveCardCacheDeleteTarget({
      items: [
        { id: 'same-1', cardName: '同名' },
        { id: 'same-2', cardData: { name: '同名' } },
      ],
      selectedId: 'same-1',
    }, '同名'),
    /存在多张同名自动化卡片/,
  );
});

test('failed browser tool results retain structured diagnostics across the local bridge', () => {
  const result = normalizeBrowserToolOutcome({
    success: false,
    result: {
      success: false,
      error: '等待元素超时: #submit',
      errorCode: 'WAIT_TIMEOUT',
      stepIndex: 4,
      stepName: '等待提交按钮',
      selector: '#submit',
      failureSnapshot: { url: 'https://example.com/login', title: 'Login' },
      execution: { stepsExecuted: 4, failed: 1 },
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error, '等待元素超时: #submit');
  assert.equal(result.errorReason, '等待元素超时: #submit');
  assert.equal(result.errorCode, 'WAIT_TIMEOUT');
  assert.equal(result.stepIndex, 4);
  assert.equal(result.failureSnapshot.url, 'https://example.com/login');
  assert.equal(result.execution.failed, 1);
});

test('automation card element waits survive cross-document navigation', async () => {
  let probeCount = 0;
  const result = await executeNavigationAwareWait(42, {
    type: 'wait',
    selector: '#identifierId',
    timeoutMs: 1000,
    intervalMs: 50,
  }, {
    getTab: async () => ({ id: 42, url: 'https://accounts.google.com/' }),
    executePageAction: async () => {
      probeCount += 1;
      if (probeCount === 1) throw new Error('The frame was removed during navigation');
      return { success: true };
    },
    sleep: async () => {},
  });

  assert.equal(result.success, true);
  assert.equal(probeCount, 2);

  let delayedMs = -1;
  const delayResult = await executeNavigationAwareWait(42, {
    type: 'wait',
    timeoutMs: 1500,
  }, {
    sleep: async (ms) => { delayedMs = ms; },
  });
  assert.deepEqual(delayResult, { success: true, waitedMs: 1500 });
  assert.equal(delayedMs, 1500);
});

test('AI control can select a shared automation card', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-card-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  createCardCacheStore({ dataDir: root }).write({
    items: [
      { id: 'first', cardName: '卡片一', cardData: { name: '卡片一', steps: [] } },
      { id: 'second', cardName: '卡片二', cardData: { name: '卡片二', steps: [] } },
    ],
    selectedId: 'first',
  });
  const bridge = createBrowserAutomationBridge({ cardCacheDir: root, logger: { log() {} } });
  const selected = bridge.selectCard('second');

  assert.equal(selected.item.cardName, '卡片二');
  assert.equal(bridge.getCardCacheState().state.selectedId, 'second');
  assert.throws(() => bridge.selectCard('missing'), /不存在或已被删除/);
});
