'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyStreamedContent,
  runChatConversation,
} = require('../../../src/app/main/features/ai-chat/chat-conversation-runner');

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

test('五类文本工具外壳在流式阶段均被抑制', () => {
  for (const content of [
    '<mcp-call>{', '<mcp_call>{', '<invoke name="tool">', '<tool_call>{',
    '<xai:function_call name="tool">', '```json\n{"tool":',
  ]) {
    assert.equal(classifyStreamedContent(content), 'suppressed');
  }
  assert.equal(classifyStreamedContent('<mc'), 'pending');
  assert.equal(classifyStreamedContent('正常答复'), 'visible');
});

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

test('文本 MCP 工具回传遇到旧服务端会话失效时无 run_id 重试', async () => {
  const responses = [
    {
      ok: true,
      run_id: 'completed-text-run',
      message: { content: '<mcp-call>{"tool":"software_window","arguments":{"action":"list"}}</mcp-call>' },
    },
    { ok: false, status: 409, message: 'AI 工具调用会话已失效，请重新发送消息' },
    { ok: true, run_id: 'replacement-run', message: { content: '窗口列表已取得' } },
  ];
  const seenRunIds = [];
  const fixture = createRequest(responses);
  fixture.request.httpClient.sendAIControlMessage = async (_key, _device, _model, _messages, options) => {
    seenRunIds.push(options.runId);
    return responses.shift();
  };
  const result = await runChatConversation(fixture.request, () => ({}));
  assert.deepEqual(seenRunIds, ['', 'completed-text-run', '']);
  assert.deepEqual(fixture.executed, [{ name: 'software_window', args: { action: 'list' } }]);
  assert.equal(result.message.content, '窗口列表已取得');
});

test('流式文本 MCP 调用不向界面发送原始外壳并在工具卡前清理内容', async () => {
  const events = [];
  let round = 0;
  const fixture = createRequest([], { emit: (event) => events.push(event), useStream: true });
  fixture.request.httpClient.streamAIControlMessage = async (
    _key, _device, _model, _messages, _options, onEvent,
  ) => {
    if (round++ === 0) {
      onEvent({ type: 'content_delta', delta: '<mcp' });
      onEvent({ type: 'content_delta', delta: '-call>{"tool":"software_window","arguments":{"action":"list"}}</mcp-call>' });
      return {
        ok: true,
        run_id: 'text-run',
        message: { content: '<mcp-call>{"tool":"software_window","arguments":{"action":"list"}}</mcp-call>' },
      };
    }
    onEvent({ type: 'content_delta', delta: '窗口列表已取得' });
    return { ok: true, message: { content: '窗口列表已取得' } };
  };
  const result = await runChatConversation(fixture.request, () => ({}));
  const visibleDeltas = events.filter((event) => event.type === 'content_delta');
  assert.deepEqual(visibleDeltas.map((event) => event.delta), ['窗口列表已取得']);
  const replaceIndex = events.findIndex((event) => event.type === 'content_replace');
  const toolIndex = events.findIndex((event) => event.type === 'tool_start');
  assert.ok(replaceIndex >= 0 && replaceIndex < toolIndex);
  assert.equal(events[replaceIndex].content, '');
  assert.equal(result.message.content, '窗口列表已取得');
});
