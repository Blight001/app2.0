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

test('软件 UI MCP 忽略调用方伪造窗口并限制观察结果规模', () => {
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
  const result = tools.execute('software_ui', {
    action: 'observe',
    childHwnd: '999',
    childPid: 999,
    limit: 10000,
    max_depth: 100,
  });
  assert.deepEqual(calls, [{
    childHwnd: '100',
    childPid: 321,
    limit: 80,
    maxDepth: 10,
  }]);
  assert.equal(result.target.profile_id, 'software-1');
});

test('软件 UI MCP 使用 observe ref 操作且绑定 HWND/PID 不可替换', () => {
  const calls = [];
  const tools = createAiSoftwareUiTools({
    windowBridge: {
      performExternalWindowUiAction: (options) => {
        calls.push(options);
        return { success: true };
      },
    },
    target: { hwnd: '100', pid: 321, profileId: 'software-1', name: '记事本' },
  });
  assert.throws(
    () => tools.execute('software_ui', { action: 'click' }),
    /需要 observe 返回的控件 ref/,
  );
  tools.execute('software_ui', {
    action: 'type',
    ref: 'uia:1,2,3',
    text: 'hello',
    childHwnd: '999',
  });
  assert.deepEqual(calls[0], {
    childHwnd: '100',
    childPid: 321,
    action: 'type',
    ref: 'uia:1,2,3',
    text: 'hello',
  });
});

test('软件 UI MCP 提供自动和强制鼠标点击动作', () => {
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
  tools.execute('software_ui', { action: 'observe' });
  for (const action of ['click', 'mouse_click', 'double_click', 'right_click']) {
    assert.equal(tools.execute('software_ui', { action, ref: 'uia:1' }).success, true);
  }
  assert.deepEqual(calls.map((item) => item.action), [
    'click', 'mouse_click', 'double_click', 'right_click',
  ]);
  assert.ok(calls.every((item) => item.x === 120 && item.y === 240));
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
