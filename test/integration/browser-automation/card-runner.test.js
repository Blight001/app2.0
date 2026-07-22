'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const backgroundRoot = path.join(root, 'src/assets/extensions/browser_automation/background');
const runnerFiles = [
  '06_automation_run.js',
  '06_run_context.js',
  '06_run_step_handlers.js',
  '06_run_action_handlers.js',
  '06_run_loop.js',
  '06_run_capture.js',
  '06_run_lifecycle.js',
];
const plain = (value) => JSON.parse(JSON.stringify(value));

function createRunner(cardData, options = {}) {
  const progress = [];
  const sessions = new Map();
  const stopped = new Set();
  const tab = { id: 42, url: options.currentUrl || 'https://example.com/' };
  const calls = { created: [], updated: [], waited: [], remembered: [] };
  const chrome = {
    storage: { local: { async set() {} } },
    runtime: { async sendMessage(message) { progress.push(message); return { success: true }; } },
    tabs: {
      async create(value) { calls.created.push(value); return tab; },
      async get() { return tab; },
      async update(id, value) { calls.updated.push({ id, value }); tab.url = value.url; return tab; },
      async captureVisibleTab() { return 'data:image/png;base64,AA=='; },
    },
    scripting: { async executeScript() { return [{ result: true }]; } },
    downloads: { async download() { return 1; } },
    windows: { WINDOW_ID_CURRENT: -2 },
  };
  const context = vm.createContext({
    console,
    chrome,
    Date,
    Error,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Math,
    Promise,
    AbortSignal,
    URL,
    STANDALONE_LAST_CARD_KEY: 'last-card',
    requireBrowserScriptCompatibility: async () => true,
    stoppedTabs: stopped,
    standaloneSessions: sessions,
    loadCardCache: async () => null,
    normalizeStandaloneSteps: (value) => value,
    normalizeRunInputs: () => ({}),
    getOrFindActiveTab: async () => options.noExistingTab ? null : tab,
    resolveAutomationTargetTab: async () => tab,
    resolveCardEntryNavigation: () => ({ url: 'https://entry.example/', timeoutMs: 15000 }),
    rememberAutomationTargetTab: async (id) => { calls.remembered.push(id); },
    waitForTabComplete: async (id, timeoutMs) => { calls.waited.push({ id, timeoutMs }); },
    saveStandaloneProgressState: async () => {},
    loadStandaloneProgressState: async () => null,
    saveCardCacheState: async () => {},
    isTabStopped: (id) => stopped.has(id),
    createStopError: () => Object.assign(new Error('stopped'), { code: 'STOPPED' }),
    isStopError: (error) => error?.code === 'STOPPED',
    buildRunFlowPlan: () => ({ enabled: false, startIndex: 0 }),
    getRunStepId: (_step, index) => `step-${index}`,
    resolveRunFlowNextIndex: (_plan, steps, index) => Math.min(steps.length, index + 1),
    formatRunFlowNextStepNames: () => '',
    formatStepProgressLabel: (index, total, name) => `${index}/${total} ${name}`,
    resolveTemplate: (value) => String(value || ''),
    normalizeTargetUrl: (value) => String(value || ''),
    resolveStepVariableKey: (_step, ordinal) => `var${ordinal}`,
    normalizeSelectorCandidates: (_by, selector) => [selector],
    executePageAction: async () => ({ success: true }),
    executeNavigationAwareWait: async () => ({ success: true }),
    evaluateConditionStep: async () => ({ value: true, detail: '' }),
    clearCurrentPageCache: async () => ({}),
    collectTabCookieSnapshot: async () => ({ cookies: [], browserStorage: [] }),
    buildCaptureFileName: () => 'capture.json',
    buildDetailedFailureReason: ({ reason }) => reason,
    captureCardFailureSnapshot: async () => null,
    pauseAtStep: async () => {},
    sleep: async () => {},
  });
  for (const file of runnerFiles) {
    vm.runInContext(fs.readFileSync(path.join(backgroundRoot, file), 'utf8'), context, { filename: file });
  }
  return { context, calls, progress, sessions, cardData };
}

test('card runner completes an empty card and releases its session', async () => {
  const runner = createRunner({ name: '空卡片', steps: [] });
  const result = await runner.context.runStandaloneCard({ cardData: runner.cardData });
  assert.equal(result.success, true);
  assert.equal(result.cardName, '空卡片');
  assert.equal(result.execution.stepsExecuted, 0);
  assert.equal(runner.sessions.size, 0);
  assert.deepEqual(runner.progress.map((item) => item.phase), ['start', 'inputs_ready', 'finished']);
});

test('card runner creates and remembers an entry tab when none is controllable', async () => {
  const runner = createRunner({ name: '入口卡片', website: 'https://entry.example/', steps: [] }, { noExistingTab: true });
  const result = await runner.context.runStandaloneCard({ cardData: runner.cardData });
  assert.equal(result.success, true);
  assert.deepEqual(plain(runner.calls.created), [{ url: 'https://entry.example/', active: true }]);
  assert.deepEqual(runner.calls.remembered, [42]);
  assert.deepEqual(runner.calls.waited, [{ id: 42, timeoutMs: 15000 }]);
});

test('navigate step updates the page and reports a successful step trace', async () => {
  const card = { name: '导航卡片', steps: [{ type: 'navigate', name: '打开目标页', url: 'https://target.example/' }] };
  const runner = createRunner(card);
  const result = await runner.context.runStandaloneCard({ cardData: card });
  assert.equal(result.success, true);
  assert.deepEqual(plain(runner.calls.updated), [{ id: 42, value: { url: 'https://target.example/' } }]);
  assert.equal(result.execution.succeeded, 1);
  assert.equal(result.execution.steps[0].status, 'success');
});

test('flow plan discards invalid edges and selects true/false branches deterministically', () => {
  const runner = createRunner({ steps: [] });
  const steps = [
    { id: 'condition', type: 'condition' },
    { id: 'yes', type: 'click' },
    { id: 'no', type: 'click' },
  ];
  const plan = runner.context.buildRunFlowPlan({
    steps,
    flow: {
      start: 'condition',
      edges: [
        { from: 'condition', to: 'yes', label: 'true' },
        { from: 'condition', to: 'no', label: 'false' },
        { from: 'missing', to: 'yes', label: 'next' },
      ],
    },
  });

  assert.equal(plan.startIndex, 0);
  assert.equal(runner.context.resolveRunFlowNextIndex(plan, steps, 0, 'true'), 1);
  assert.equal(runner.context.resolveRunFlowNextIndex(plan, steps, 0, 'false'), 2);
  assert.equal(plan.edgesByFrom.get('condition').length, 2);
});

test('condition evaluator handles URL, missing text and script failures as public outcomes', async () => {
  const runner = createRunner({ steps: [] }, { currentUrl: 'https://example.com/orders/42' });
  assert.deepEqual(plain(await runner.context.evaluateConditionStep(42, {
    condition_mode: 'url_matches',
    text: '/orders/',
  })), { value: true, detail: 'URL 包含 /orders/' });

  runner.context.executePageAction = async () => ({ success: false });
  assert.deepEqual(plain(await runner.context.evaluateConditionStep(42, {
    condition_mode: 'text_missing',
    text: '已售罄',
  })), { value: true, detail: '文本 已售罄 不存在' });

  runner.context.chrome.scripting.executeScript = async () => [{ result: {
    success: false,
    error: 'expression rejected',
  } }];
  await assert.rejects(
    runner.context.evaluateConditionStep(42, { condition_mode: 'js', expression: 'bad()' }),
    /expression rejected/,
  );
});
