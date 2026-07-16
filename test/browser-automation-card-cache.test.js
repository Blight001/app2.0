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
} = require('../src/app/main/services/browser-automation-bridge');
const {
  resolveCardCacheDeleteTarget,
} = require('../src/assets/extensions/browser_automation/background/04_cache');

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

test('AI control card selector is wired through UI, IPC, chat context, and history', () => {
  const root = path.join(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'src/app/sidebar/client/app/side/controllers/pages/ai-control.js'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(root, 'src/app/main/services/app-lifecycle.js'), 'utf8');
  const history = fs.readFileSync(path.join(root, 'src/app/main/lib/ai-chat-history.js'), 'utf8');

  assert.match(ui, /ai-select-option ai-browser-card-option/);
  assert.doesNotMatch(ui, /ai-browser-card-select/);
  assert.doesNotMatch(ui, /`当前：\$\{selectedAutomationCard\(\)\.name\}`/);
  assert.match(ui, /ai-control-get-automation-cards/);
  assert.match(ui, /ai-control-select-automation-card/);
  assert.match(ui, /automationCardId: state\.currentCardId/);
  assert.match(lifecycle, /ai-control-get-automation-cards/);
  assert.match(lifecycle, /ai-control-select-automation-card/);
  assert.match(lifecycle, /ai_free_card_context/);
  assert.match(lifecycle, /importLegacyCardsFromConnectedBrowsers/);
  assert.match(lifecycle, /bridge\.dispatch\(connection\.id, 'manage_card', \{ action: 'list' \}/);
  assert.match(lifecycle, /isCardRun \? 900000 : 180000/);
  assert.match(history, /automationCardId/);

  const selectUiStart = ui.indexOf('function syncSelectUi');
  const selectUiEnd = ui.indexOf('function bindSelectShell', selectUiStart);
  const selectUi = ui.slice(selectUiStart, selectUiEnd);
  assert.ok(selectUi.indexOf('appendBrowserMcpSetting(menu)') < selectUi.indexOf("browserLabel.textContent = '目标浏览器'"));
  assert.ok(selectUi.indexOf("browserLabel.textContent = '目标浏览器'") < selectUi.indexOf('options.forEach'));
  assert.ok(selectUi.indexOf('options.forEach') < selectUi.indexOf('appendAutomationCardSetting(menu)'));

  const css = fs.readFileSync(path.join(root, 'src/app/sidebar/client/app/side/styles/modules/ai-control.css'), 'utf8');
  assert.match(css, /max-height: var\(--ai-browser-menu-available-height, none\)/);
  assert.match(ui, /getBoundingClientRect\(\)\.top - viewportTop - 10/);
});

test('card persistence does not wait for agent registration and never hides a failed write', () => {
  const root = path.join(__dirname, '..');
  const bridge = fs.readFileSync(path.join(root, 'src/app/main/services/browser-automation-bridge.js'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'src/assets/extensions/browser_automation/popup/automation-workbench.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src/assets/extensions/browser_automation/background/07_events.js'), 'utf8');
  const socket = fs.readFileSync(path.join(root, 'src/assets/extensions/browser_automation/background/09_agent_socket.js'), 'utf8');

  const cardRouteIndex = bridge.indexOf("url.pathname === '/v1/card-cache'");
  const authorizationIndex = bridge.indexOf('const connection = getAuthorizedConnection');
  assert.ok(cardRouteIndex >= 0 && cardRouteIndex < authorizationIndex);
  assert.match(popup, /response\.persisted !== true/);
  assert.match(popup, /尚未完成跨窗口保存/);
  assert.match(background, /success: state\.persisted === true/);
  assert.match(socket, /migrateLegacyCardCacheOnStartup/);
  assert.match(socket, /\[0, 1000, 3000\]/);
});

test('card import falls back to the software bridge and AI selection follows external changes', () => {
  const root = path.join(__dirname, '..');
  const popup = fs.readFileSync(path.join(root, 'src/assets/extensions/browser_automation/popup/automation-workbench.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/app/sidebar/client/app/side/controllers/pages/ai-control.js'), 'utf8');

  assert.match(popup, /requestSoftwareCardCacheDirect\('\/v1\/card-cache'/);
  assert.match(popup, /method: 'PUT'/);
  assert.match(popup, /response\.state\?\.persisted === false/);
  assert.match(ui, /sharedSelectionChanged/);
  assert.match(ui, /sharedAutomationCardId/);
  assert.match(ui, /automationCardsRefreshQueued/);
  assert.match(ui, /window\.setInterval\(loadAutomationCards, 1000\)/);
});
