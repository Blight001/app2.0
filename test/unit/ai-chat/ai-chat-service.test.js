'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiChatService } = require('../../../src/app/main/features/ai-chat/ai-chat-service');

function eventFixture(id = 1) {
  const sent = [];
  return {
    sent,
    event: {
      sender: {
        id,
        isDestroyed: () => false,
        send: (channel, payload) => sent.push({ channel, payload }),
      },
    },
  };
}

function createService(client) {
  return createAiChatService({
    readStoreConfigSafe: () => ({ userCredentials: { key: 'key', deviceId: 'device' } }),
    getGlobalHttpClient: () => client,
    licenseCache: { getSnapshot: () => ({}) },
    logger: { warn() {} },
  });
}

test('内置模型正常返回完整消息链并发布流式完成事件', async () => {
  const client = {
    sendAIControlMessage: async () => ({ ok: true, quota: { remaining: 9 }, message: { role: 'assistant', content: '完成' } }),
  };
  const service = createService(client);
  const fixture = eventFixture();
  const result = await service.chat(fixture.event, {
    modelId: 'builtin',
    messages: [{ role: 'user', content: '开始' }],
    disableTools: true,
    stream: true,
    requestId: 'request-1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.messages.at(-1).content, '完成');
  assert.equal(result.quota.remaining, 9);
  assert.equal(fixture.sent.at(-1).payload.type, 'done');
});

test('额度耗尽时不调用模型服务', async () => {
  let calls = 0;
  const service = createService({ sendAIControlMessage: async () => { calls += 1; return { ok: true }; } });
  const result = await service.chat(eventFixture().event, {
    modelId: 'builtin',
    quota: { quota: 1, used: 1 },
    messages: [{ role: 'user', content: '开始' }],
    disableTools: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /额度已用尽/);
  assert.equal(calls, 0);
});

test('流式输出可停止并保留已到达的部分内容，完成后连续停止幂等', async () => {
  const client = {
    sendAIControlMessage: async () => ({ ok: true }),
    streamAIControlMessage: async (_key, _device, _model, _messages, options, onEvent) => {
      onEvent({ type: 'content_delta', delta: '部分结果' });
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('stopped');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  };
  const service = createService(client);
  const fixture = eventFixture(8);
  const pending = service.chat(fixture.event, {
    modelId: 'builtin', messages: [{ role: 'user', content: '开始' }],
    disableTools: true, stream: true, requestId: 'stop-me',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await service.stop(fixture.event, { requestId: 'stop-me' }), { ok: true, stopped: true });
  const result = await pending;
  assert.equal(result.stopped, true);
  assert.equal(result.message.content, '部分结果');
  assert.deepEqual(await service.stop(fixture.event, { requestId: 'stop-me' }), { ok: true, stopped: false });
});
