'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dispatchPluginTool,
  executeToolCalls,
  resolvePluginTarget,
} = require('../../../src/app/main/features/ai-chat/chat-tool-executor');
const {
  buildChatToolContext,
  withBrowserRouteParam,
} = require('../../../src/app/main/features/ai-chat/chat-tool-context');

test('多浏览器工具 schema 将 browser_id 标记为必填且保留原必填参数', () => {
  const tool = withBrowserRouteParam({
    name: 'browser_action',
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string' } },
      required: ['action'],
    },
  });
  assert.deepEqual(tool.input_schema.required, ['action', 'browser_id']);
  assert.equal(tool.input_schema.properties.browser_id.type, 'string');
});

test('AI MCP prompt 按可用工具注入准确的多浏览器路由和页面操作策略', () => {
  const context = buildChatToolContext({
    connections: [
      { id: 'one', name: '工作窗口', tools: [
        { name: 'browser_tab', input_schema: { type: 'object' } },
        { name: 'browser_observe', input_schema: { type: 'object' } },
        { name: 'browser_action', input_schema: { type: 'object' } },
      ] },
      { id: 'two', name: '资料窗口', tools: [{ name: 'browser_observe', input_schema: { type: 'object' } }] },
    ],
    initialMessages: [{ role: 'user', content: '继续操作' }],
    windowTools: {
      has: (name) => name === 'software_window',
      tools: [{ name: 'software_window', input_schema: { type: 'object' } }],
    },
  });
  const prompt = context.modelMessages[0].content;
  assert.match(prompt, /browser_tab、browser_observe、browser_action/);
  assert.match(prompt, /每一个浏览器工具时都必须传 browser_id/);
  assert.match(prompt, /页面明显变化后重新 observe/);
  assert.match(prompt, /禁止跨浏览器或跨页面复用旧 ref/);
  assert.match(prompt, /history_id、tab_id 和 name 不能直接当作 browser_id/);
  assert.match(prompt, /要聚焦已打开窗口，调用 software_window 的 open/);
  assert.match(prompt, /窗口已打开不等于其 MCP 已连接/);
  assert.match(prompt, /未收到成功结果前不得声称操作完成/);
  assert.equal(context.tools.find((tool) => tool.name === 'browser_tab').input_schema.required.includes('browser_id'), true);
});

test('没有浏览器连接时 prompt 不会诱导 AI 虚构浏览器 MCP', () => {
  const context = buildChatToolContext({
    connections: [],
    initialMessages: [{ role: 'user', content: '打开窗口' }],
    windowTools: {
      has: (name) => name === 'software_window',
      tools: [{ name: 'software_window', input_schema: { type: 'object' } }],
    },
  });
  assert.match(context.modelMessages[0].content, /没有可用的浏览器自动化连接/);
  assert.doesNotMatch(context.modelMessages[0].content, /网页操作应先用 browser_tab/);
});

test('多浏览器工具要求明确路由，名称歧义和未知连接返回可恢复诊断', () => {
  const connections = [{ id: 'a' }, { id: 'b' }];
  const describe = () => 'A(a), B(b)';
  assert.match(resolvePluginTarget({}, connections, () => null, describe).error, /当前选择了 2 个浏览器/);
  assert.match(resolvePluginTarget({ browser_id: 'same' }, connections, () => ({ ambiguous: true }), describe).error, /改用 browser_id/);
  const missing = resolvePluginTarget({ browser_id: 'missing' }, connections, () => null, describe).error;
  assert.match(missing, /当前 AI 已选且在线/);
  assert.match(missing, /history_id\/tab_id 不能代替 browser_id/);
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
    toolCalls: [{ id: 'local', function: { name: 'software_window', arguments: '{"action":"list"}' } }],
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

test('工具参数 JSON 错误时返回格式诊断且不执行工具', async () => {
  const modelMessages = [];
  let executions = 0;
  const result = await executeToolCalls({
    compactToolValue: (value) => value,
    connections: [],
    describeConnections: () => '',
    emit() {},
    findConnectionByRef: () => null,
    isStopped: () => false,
    modelMessages,
    round: 0,
    toolCalls: [{ id: 'bad-json', function: { name: 'software_window', arguments: '{bad}' } }],
    toolEvents: [],
    traceEvents: [],
    waitForAbort: (promise) => promise,
    windowTools: {
      has: () => true,
      execute: async () => { executions += 1; return { success: true }; },
    },
  });
  assert.equal(executions, 0);
  assert.match(result.unresolvedToolFailure, /MCP 调用格式错误/);
  const payload = JSON.parse(modelMessages.at(-1).content);
  assert.equal(payload.errorCode, 'MCP_ARGUMENTS_INVALID');
  assert.equal(payload.phase, 'tool_parse');
});
