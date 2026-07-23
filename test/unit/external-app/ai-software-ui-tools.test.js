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
});

test('软件 UI MCP 忽略调用方伪造窗口并限制观察结果规模', async () => {
  const calls = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      observeExternalWindowUi: (options) => {
        calls.push(options);
        return { success: true, items: [] };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  const result = await tools.execute('software_ui', {
    action: 'observe',
    childHwnd: '999',
    childPid: 999,
    limit: 10000,
    max_depth: 100,
    mode: 'accessibility',
  });
  assert.deepEqual(calls, [{
    childHwnd: '100',
    childPid: 321,
    limit: 80,
    maxDepth: 10,
  }]);
  assert.equal(result.target.profile_id, 'software-1');
});

test('软件 UI MCP 对不支持 ValuePattern 的编辑器聚焦后使用绑定键盘输入', async () => {
  const calls = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      observeExternalWindowUi: () => ({
        success: true,
        items: [{ ref: 'uia:1,2,3', actions: ['focus'] }],
      }),
      performExternalWindowUiAction: (options) => {
        calls.push(options);
        return { success: true };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  await assert.rejects(
    tools.execute('software_ui', { action: 'click' }),
    /需要 observe 返回的控件 ref/,
  );
  await tools.execute('software_ui', { action: 'observe', mode: 'accessibility' });
  await tools.execute('software_ui', {
    action: 'type',
    ref: 'uia:1,2,3',
    text: 'hello',
    childHwnd: '999',
    refresh: false,
  });
  assert.deepEqual(calls, [
    {
      childHwnd: '100',
      childPid: 321,
      action: 'focus',
      ref: 'uia:1,2,3',
      text: '',
    },
    {
      childHwnd: '100',
      childPid: 321,
      action: 'type',
      ref: 'uia:1,2,3',
      text: 'hello',
      directInput: true,
    },
  ]);
});

test('软件 UI MCP 提供自动和强制鼠标点击动作', async () => {
  const calls = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      observeExternalWindowUi: () => ({
        success: true,
        items: [{ ref: 'uia:1', click_x: 120, click_y: 240 }],
      }),
      performExternalWindowUiAction: (options) => {
        calls.push(options);
        return { success: true, method: 'mouse' };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  await tools.execute('software_ui', { action: 'observe' });
  for (const action of ['click', 'mouse_click', 'double_click', 'right_click']) {
    await tools.execute('software_ui', { action: 'observe' });
    assert.equal((await tools.execute(
      'software_ui', { action, ref: 'uia:1', refresh: false },
    )).success, true);
  }
  assert.deepEqual(calls.map((item) => item.action), [
    'click', 'mouse_click', 'double_click', 'right_click',
  ]);
  assert.ok(calls.every((item) => item.x === 120 && item.y === 240));
});

test('UIA 内容不足时自动返回截图并用 observation_id 映射坐标', async () => {
  const actions = [];
  let captureCount = 0;
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      observeExternalWindowUi: () => ({
        success: true,
        items: [{ ref: 'uia:root', type: 'window', actions: [] }],
      }),
      captureExternalWindow: () => {
        captureCount += 1;
        return {
          success: true,
          dataUrl: `data:image/png;base64,SHOT${captureCount}`,
          width: 800,
          height: 500,
          sourceWidth: 1600,
          sourceHeight: 1000,
          originX: 100,
          originY: 200,
        };
      },
      performExternalWindowUiAction: (options) => {
        actions.push(options);
        return { success: true, method: 'mouse' };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: 'SCode' },
  });
  const observed = await tools.execute('software_ui', { action: 'observe' });
  assert.equal(observed.observation_mode, 'visual');
  assert.equal(observed.dataUrl, 'data:image/png;base64,SHOT1');
  const acted = await tools.execute('software_ui', {
    action: 'click',
    observation_id: observed.observation_id,
    x: 400,
    y: 250,
  });
  assert.equal(actions[0].x, 900);
  assert.equal(actions[0].y, 700);
  assert.equal(acted.action_result.success, true);
  assert.notEqual(acted.observation_id, observed.observation_id);
  assert.equal(acted.dataUrl, 'data:image/png;base64,SHOT2');
  await assert.rejects(
    tools.execute('software_ui', {
      action: 'click',
      observation_id: observed.observation_id,
      x: 400,
      y: 250,
    }),
    /observation_id 无效/,
  );
});

test('视觉观察支持焦点后的直接文字和按键输入', async () => {
  const actions = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      captureExternalWindow: () => ({
        success: true,
        dataUrl: 'data:image/png;base64,SHOT',
        width: 800,
        height: 500,
        sourceWidth: 800,
        sourceHeight: 500,
        originX: 0,
        originY: 0,
      }),
      performExternalWindowUiAction: (options) => {
        actions.push(options);
        return { success: true };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: 'SCode' },
  });
  const observed = await tools.execute('software_ui', { action: 'screenshot' });
  await tools.execute('software_ui', {
    action: 'type',
    observation_id: observed.observation_id,
    text: 'hello',
    refresh: false,
  });
  const next = await tools.execute('software_ui', { action: 'screenshot' });
  await tools.execute('software_ui', {
    action: 'press_key',
    observation_id: next.observation_id,
    key: 'Enter',
    refresh: false,
  });
  assert.deepEqual(actions.map((item) => [item.action, item.directInput, item.text]), [
    ['type', true, 'hello'],
    ['press_key', true, 'Enter'],
  ]);
});

test('AI 对话按显式选择绑定软件窗口，并兼容当前活动栏目', () => {
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
  const bound = provider();
  assert.equal(bound.has('software_ui'), true);
  const selected = provider({
    softwareTarget: {
      hwnd: '200',
      pid: 456,
      profileId: 'selected-tab',
      name: '计算器',
    },
  });
  assert.equal(selected.has('software_ui'), true);
  assert.equal(provider({ softwareTarget: null }).has('software_ui'), false);
  activeTarget = null;
  assert.equal(provider().has('software_ui'), false);
  assert.equal(bound.has('software_ui'), true, '已开始的请求继续绑定原 HWND，不能随活动栏目漂移');
});

test('外部 MCP 的活动软件实例跨 observe/action 调用保留引用状态', async () => {
  const actions = [];
  const target = {
    hwnd: '100',
    pid: 321,
    profileId: 'active-tab',
    name: 'Notepad3',
  };
  const provider = createWindowToolProvider({
    aiSandboxDir: 'C:/AI-Workspace',
    getActiveTabId: () => target.profileId,
    browserRuntimeManager: {
      windowBridge: {
        observeExternalWindowUi: () => ({
          success: true,
          items: [{ ref: 'uia:editor', actions: ['focus'] }],
        }),
        performExternalWindowUiAction: (options) => {
          actions.push(options);
          return { success: true };
        },
      },
      externalApp: { getAutomationTarget: () => target },
    },
  }, null, { warn() {} });

  const observed = await provider().execute('software_ui', {
    action: 'observe',
    mode: 'accessibility',
  });
  await provider().execute('software_ui', {
    action: 'type',
    ref: 'uia:editor',
    observation_id: observed.observation_id,
    text: '',
    refresh: false,
  });

  assert.deepEqual(actions.map((item) => [item.action, item.directInput]), [
    ['focus', undefined],
    ['type', true],
  ]);
});
