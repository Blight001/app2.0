'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAiSoftwareUiTools,
} = require('../../../src/app/main/services/ai-software-ui-tools');
const {
  createWindowToolProvider,
} = require('../../../src/app/main/features/ai-chat/ai-chat-service');

test('软件 UI MCP 只在绑定目标存在时发布', () => {
  const unavailable = createAiSoftwareUiTools({ windowBridge: {}, target: null });
  assert.deepEqual(unavailable.tools, []);
  assert.equal(unavailable.has('software_ui'), false);

  const available = createAiSoftwareUiTools({
    windowBridge: {},
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  assert.deepEqual(available.tools.map((tool) => tool.name), ['software_ui']);
  assert.equal(available.has('software_ui'), true);
  assert.ok(!available.tools[0].input_schema.properties.mode);
  assert.ok(!available.tools[0].input_schema.properties.ref);
});

test('软件 UI observe 只走截图与视觉候选，不调用 UIA', async () => {
  const calls = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      observeExternalWindowUi: () => {
        throw new Error('UIA 不应再被调用');
      },
      captureExternalWindow: (options) => {
        calls.push(options);
        return {
          success: true,
          dataUrl: 'data:image/png;base64,SHOT',
          width: 400,
          height: 200,
          sourceWidth: 800,
          sourceHeight: 400,
          originX: 10,
          originY: 20,
          visual_candidates: [
            { vref: 'v:0', x: 40, y: 50, width: 20, height: 10, cx: 50, cy: 55 },
          ],
        };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  const observed = await tools.execute('software_ui', {
    action: 'observe',
    childHwnd: '999',
    mode: 'accessibility',
    keyword: 'ignored',
  });
  assert.deepEqual(calls, [{
    childHwnd: '100',
    childPid: 321,
    maxWidth: 1600,
    maxHeight: 1000,
    includeVisualCandidates: true,
    candidateLimit: 24,
  }]);
  assert.equal(observed.observation_mode, 'visual');
  assert.equal(observed.items[0].vref, 'v:0');
  assert.equal(observed.count, 1);
});

test('vref 点击映射到屏幕坐标并调用 performExternalWindowAction', async () => {
  const actions = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      captureExternalWindow: () => ({
        success: true,
        dataUrl: 'data:image/png;base64,SHOT',
        width: 400,
        height: 200,
        sourceWidth: 800,
        sourceHeight: 400,
        originX: 10,
        originY: 20,
        visual_candidates: [
          { vref: 'v:0', x: 40, y: 50, width: 20, height: 10, cx: 50, cy: 55 },
        ],
      }),
      performExternalWindowAction: (options) => {
        actions.push(options);
        return { success: true, method: 'mouse' };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  const observed = await tools.execute('software_ui', { action: 'observe' });
  await tools.execute('software_ui', {
    action: 'click',
    observation_id: observed.observation_id,
    vref: 'v:0',
    refresh: false,
  });
  assert.equal(actions[0].action, 'click');
  assert.equal(actions[0].x, 10 + Math.round(50 * 800 / 400));
  assert.equal(actions[0].y, 20 + Math.round(55 * 400 / 200));
});

test('type 先 focus 再键盘输入', async () => {
  const actions = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      captureExternalWindow: () => ({
        success: true,
        dataUrl: 'data:image/png;base64,SHOT',
        width: 100,
        height: 100,
        sourceWidth: 100,
        sourceHeight: 100,
        originX: 0,
        originY: 0,
        visual_candidates: [],
      }),
      performExternalWindowAction: (options) => {
        actions.push(options);
        return { success: true };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  const observed = await tools.execute('software_ui', { action: 'observe' });
  await tools.execute('software_ui', {
    action: 'type',
    observation_id: observed.observation_id,
    text: 'hello',
    refresh: false,
  });
  assert.deepEqual(actions.map((item) => item.action), ['focus', 'type']);
  assert.equal(actions[1].text, 'hello');
});

test('缺少坐标时拒绝点击', async () => {
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      captureExternalWindow: () => ({
        success: true,
        dataUrl: 'data:image/png;base64,SHOT',
        width: 100,
        height: 100,
        sourceWidth: 100,
        sourceHeight: 100,
        originX: 0,
        originY: 0,
        visual_candidates: [],
      }),
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  const observed = await tools.execute('software_ui', { action: 'observe' });
  await assert.rejects(
    tools.execute('software_ui', {
      action: 'click',
      observation_id: observed.observation_id,
    }),
    /vref 或 observation_id/,
  );
});

test('软件鼠标先等待统一 Sidecar，再用同一物理坐标提交输入', async () => {
  const actions = [];
  const cursorCalls = [];
  const tools = createAiSoftwareUiTools({
    target: { hwnd: '88', pid: 99, profileId: 'software-one', name: 'Demo' },
    cursorSidecarService: {
      async moveAndWait(tabId, point) {
        cursorCalls.push(['move', tabId, point]);
        return { displayed: true, sequenceId: 7 };
      },
      feedback(tabId, sequenceId, button) {
        cursorCalls.push(['feedback', tabId, sequenceId, button]);
      },
    },
    windowBridge: {
      async captureExternalWindow() {
        return {
          originX: 100, originY: 200,
          sourceWidth: 800, sourceHeight: 600,
          width: 800, height: 600,
          visual_candidates: [],
        };
      },
      async performExternalWindowActionAsync(options) {
        actions.push(options);
        return { success: true };
      },
    },
  });
  const observed = await tools.execute('software_ui', { action: 'observe' });
  await tools.execute('software_ui', {
    action: 'click',
    observation_id: observed.observation_id,
    x: 25,
    y: 30,
    refresh: false,
  });
  assert.deepEqual(cursorCalls, [
    ['move', 'software-one', { x: 125, y: 230 }],
    ['feedback', 'software-one', 7, 'left'],
  ]);
  assert.equal(actions[0].x, 125);
  assert.equal(actions[0].y, 230);
});

test('软件右键与拖拽映射为独立 UI 光标 API', async () => {
  const cursorCalls = [];
  const tools = createAiSoftwareUiTools({
    target: { hwnd: '88', pid: 99, profileId: 'software-one', name: 'Demo' },
    cursorSidecarService: {
      async moveAndWait() {
        return { displayed: true, sequenceId: 8 };
      },
      feedback(_tabId, _sequenceId, button) {
        cursorCalls.push(['effect', button]);
      },
      async dragAndWait(tabId, start, end) {
        cursorCalls.push(['drag', tabId, start, end]);
        return { displayed: true, sequenceId: 9 };
      },
    },
    windowBridge: {
      async captureExternalWindow() {
        return {
          originX: 100, originY: 200,
          sourceWidth: 800, sourceHeight: 600,
          width: 800, height: 600,
          visual_candidates: [],
        };
      },
      async performExternalWindowActionAsync() {
        return { success: true };
      },
    },
  });
  let observed = await tools.execute('software_ui', { action: 'observe' });
  await tools.execute('software_ui', {
    action: 'right_click',
    observation_id: observed.observation_id,
    x: 10,
    y: 20,
    refresh: false,
  });
  observed = await tools.execute('software_ui', { action: 'observe' });
  await tools.execute('software_ui', {
    action: 'drag',
    observation_id: observed.observation_id,
    x: 10,
    y: 20,
    end_x: 50,
    end_y: 60,
    refresh: false,
  });
  assert.deepEqual(cursorCalls, [
    ['effect', 'right'],
    [
      'drag',
      'software-one',
      { x: 110, y: 220 },
      { x: 150, y: 260 },
    ],
  ]);
});

test('AI 对话按显式选择绑定软件窗口', () => {
  let activeTarget = null;
  const provider = createWindowToolProvider({
    aiSandboxDir: 'C:/AI-Workspace',
    getActiveTabId: () => 'active-tab',
    browserRuntimeManager: {
      windowBridge: {},
      externalApp: { getAutomationTarget: () => activeTarget },
    },
  }, null, { warn() {} });

  assert.equal(provider().has('software_ui'), false);
  activeTarget = {
    hwnd: '100',
    pid: 321,
    profileId: 'active-tab',
    name: '记事本',
  };
  assert.equal(provider().has('software_ui'), true);
});
