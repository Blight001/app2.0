'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runChatConversation } = require('../../../src/app/main/features/ai-chat/chat-conversation-runner');

function createRequest(responses, overrides = {}) {
  const executed = [];
  let requestCount = 0;
  const tools = [{ name: 'software_window', input_schema: { type: 'object' } }];
  return {
    executed,
    request: {
      bridge: { dispatch: async () => { throw new Error('不应调用插件工具'); } },
      connections: [],
      deviceId: 'device',
      emit() {},
      httpClient: {
        sendAIControlMessage: async () => responses[Math.min(requestCount++, responses.length - 1)],
      },
      key: 'key',
      modelId: 'model',
      toolContext: {
        describeConnections: () => '',
        findConnectionByRef: () => null,
        modelMessages: [{ role: 'user', content: '开始' }],
        tools,
      },
      useCustomApi: false,
      useStream: false,
      windowTools: {
        has: (name) => name === 'software_window',
        execute: async (name, args) => {
          executed.push({ name, args });
          return { success: true };
        },
      },
      ...overrides,
    },
  };
}

test('识别文本 mcp-call，执行后继续取得模型最终答复', async () => {
  const fixture = createRequest([
    {
      ok: true,
      message: {
        content: '<mcp-call>{"tool":"software_window","arguments":{"action":"list"}}',
      },
    },
    { ok: true, message: { content: '窗口列表已取得' } },
  ]);
  const result = await runChatConversation(fixture.request, () => ({}));
  assert.deepEqual(fixture.executed, [{ name: 'software_window', args: { action: 'list' } }]);
  assert.equal(result.message.content, '窗口列表已取得');
  assert.equal(result.messages.some((message) => /<mcp-call>/.test(message.content || '')), false);
});

test('文本 mcp-call 格式错误时直接返回诊断，不执行工具', async () => {
  const fixture = createRequest([
    { ok: true, message: { content: '<mcp-call>{bad json}</mcp-call>' } },
  ]);
  const result = await runChatConversation(fixture.request, () => ({}));
  assert.equal(fixture.executed.length, 0);
  assert.match(result.message.content, /MCP 调用格式错误/);
});

test('不存在的 MCP 工具即时返回暂无该调用', async () => {
  const fixture = createRequest([
    { ok: true, message: { content: '<mcp-call>{"tool":"missing_tool","arguments":{}}</mcp-call>' } },
  ]);
  const result = await runChatConversation(fixture.request, () => ({}));
  assert.equal(fixture.executed.length, 0);
  assert.match(result.message.content, /暂无该 MCP 调用：missing_tool/);
});
