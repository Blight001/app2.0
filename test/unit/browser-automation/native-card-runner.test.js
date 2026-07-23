'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { runNativeCard } = require('../../../src/app/main/features/browser-automation/native-card-runner');

function card(steps, flow = {}) {
  return {
    name: '流程',
    website: 'https://example.com',
    steps,
    flow: { nodes: [], edges: [], start: steps[0]?.id || '', ...flow },
  };
}

test('native runner follows condition edges, templates and automatic session saving', async () => {
  const calls = [];
  const runtime = {
    navigate: async (...args) => calls.push(['navigate', ...args]),
    dispatchAutomation: async (_profile, command, input) => {
      calls.push([command, input]);
      if (command === 'observe-page') return { result: { items: [{ text: '42' }], url: 'https://example.com' } };
      return { result: { success: true } };
    },
    sendCommand: async (_profile, command) => {
      calls.push([command]);
      return { result: { pageUrl: 'https://example.com', cookies: [] } };
    },
    saveSession: async (input) => ({ saved: true, action: input.action }),
  };
  const result = await runNativeCard(runtime, 'profile-a', card([
    { id: 'open', name: '打开', type: 'navigate', url: 'https://example.com/{{path}}' },
    { id: 'condition', name: '判断', type: 'condition', condition_mode: 'url_matches', text: 'example.com' },
    { id: 'skip', name: '跳过', type: 'click', selector: '#wrong' },
    { id: 'points', name: '积分', type: 'get_credits', variable: 'credits' },
    { id: 'session', name: '保存', type: 'save_cookies' },
  ], {
    edges: [
      { from: 'open', to: 'condition', label: 'next' },
      { from: 'condition', to: 'points', label: 'true' },
      { from: 'condition', to: 'skip', label: 'false' },
      { from: 'points', to: 'session', label: 'next' },
    ],
  }), { inputs: { path: 'login' } });
  assert.equal(result.success, true);
  assert.equal(result.context.credits, '42');
  assert.equal(result.savedSession.saved, true);
  assert.deepEqual(calls[0], ['navigate', 'profile-a', 'https://example.com/login']);
  assert.equal(calls.some((entry) => entry[1]?.selector === '#wrong'), false);
});

test('native runner stops fixed waits and uses origin-scoped site clearing', async () => {
  const controller = new AbortController();
  const commands = [];
  const runtime = {
    dispatchAutomation: async () => ({ result: {} }),
    navigate: async () => ({}),
    saveSession: async () => ({}),
    sendCommand: async (_profile, command) => { commands.push(command); return { result: {} }; },
  };
  const clearing = await runNativeCard(runtime, 'profile-a', card([
    { id: 'clear', name: '清理', type: 'clear_current_page_cache' },
  ]));
  assert.equal(clearing.success, true);
  assert.deepEqual(commands, ['clear-site-data']);

  const running = runNativeCard(runtime, 'profile-a', card([
    { id: 'wait', name: '等待', type: 'wait', wait_ms: 30000 },
  ]), { signal: controller.signal });
  controller.abort();
  const stopped = await running;
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.errorCode, 'CARD_RUN_STOPPED');
});

test('native runner emits live progress and carries text, nth and hidden targeting', async () => {
  const actions = [];
  const progress = [];
  const runtime = {
    dispatchAutomation: async (_profile, command, input) => {
      if (command === 'perform-action') actions.push(input);
      return { result: { success: true } };
    },
    navigate: async () => ({}),
    saveSession: async () => ({}),
    sendCommand: async () => ({ result: {} }),
  };
  const result = await runNativeCard(runtime, 'profile-a', card([
    {
      id: 'wait', name: '等待消失', type: 'wait',
      wait_for_text_hidden: '加载中', timeout: 1000,
    },
    {
      id: 'type', name: '输入', type: 'type', by: 'text',
      selector: '邮箱', text: 'demo@example.com', nth: 2,
      click_before_type: true, submit: true,
    },
  ]), { onProgress: (event) => progress.push(event) });
  assert.equal(result.success, true);
  assert.deepEqual(actions.map((action) => action.action), ['wait', 'click', 'type', 'press_key']);
  assert.equal(actions[0].hidden, true);
  assert.equal(actions[1].target_text, '邮箱');
  assert.equal(actions[1].nth, 2);
  assert.deepEqual(progress.map((event) => event.phase), [
    'step_start', 'step_complete', 'step_start', 'step_complete', 'completed',
  ]);
});
