'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dispatchPluginTool,
  executeToolCalls,
  resolvePluginTarget,
} = require('../../../src/app/main/features/ai-chat/chat-tool-executor');

test('多浏览器工具要求明确路由，名称歧义和未知连接返回可恢复诊断', () => {
  const connections = [{ id: 'a' }, { id: 'b' }];
  const describe = () => 'A(a), B(b)';
  assert.match(resolvePluginTarget({}, connections, () => null, describe).error, /当前选择了 2 个浏览器/);
  assert.match(resolvePluginTarget({ browser_id: 'same' }, connections, () => ({ ambiguous: true }), describe).error, /改用 browser_id/);
  assert.match(resolvePluginTarget({ browser_id: 'missing' }, connections, () => null, describe).error, /未找到/);
});

test('插件工具移除路由字段并限制超时，自动化卡片使用十五分钟默认值', async () => {
  const calls = [];
  const base = {
    connections: [{ id: 'browser-1' }],
    findConnectionByRef: (reference) => reference === 'browser-1' ? { id: 'browser-1' } : null,
    describeConnections: () => 'browser-1',
    waitForAbort: (promise) => promise,
    bridge: { dispatch: async (...args) => { calls.push(args); return { success: true }; } },
  };
  await dispatchPluginTool(base, 'open_page', { browser_id: 'browser-1', timeout_seconds: 9999, url: 'https://example.com' });
  assert.deepEqual(calls[0][2], { timeout_seconds: 9999, url: 'https://example.com' });
  assert.equal(calls[0][3].timeoutMs, 1800 * 1000);
  await dispatchPluginTool(base, 'manage_card', { action: 'run' });
  assert.equal(calls[1][3].timeoutMs, 15 * 60 * 1000);
});

test('本地窗口工具优先执行，插件失败被序列化为可恢复 tool 消息', async () => {
  const modelMessages = [];
  let pluginCalls = 0;
  const common = {
    compactToolValue: (value) => value,
    connections: [{ id: 'one' }],
    describeConnections: () => 'one',
    emit() {},
    findConnectionByRef: () => null,
    isStopped: () => false,
    modelMessages,
    round: 0,
    toolEvents: [],
    traceEvents: [],
    waitForAbort: (promise) => promise,
    bridge: { dispatch: async () => { pluginCalls += 1; return { success: false, error: 'offline' }; } },
  };
  await executeToolCalls({
    ...common,
    toolCalls: [{ id: 'local', function: { name: 'software_window_list', arguments: '{}' } }],
    windowTools: { has: () => true, execute: async () => ({ success: true, windows: [] }) },
  });
  assert.equal(pluginCalls, 0);
  const result = await executeToolCalls({
    ...common,
    toolCalls: [{ id: 'remote', function: { name: 'open_page', arguments: '{}' } }],
    windowTools: null,
  });
  assert.equal(result.unresolvedToolFailure, 'offline');
  const payload = JSON.parse(modelMessages.at(-1).content);
  assert.equal(payload.recoverable, true);
  assert.equal(payload.error, 'offline');
});
