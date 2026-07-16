'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const axios = require('axios');

const {
  CUSTOM_AI_MODEL_ID,
  getCustomAiApiConfig,
  isCustomAiApiConfigured,
  isCustomAiModelId,
  toPublicCustomAiApiConfig,
} = require('../src/app/main/utils/ai-control-settings');
const {
  resolveChatCompletionsUrl,
  sendCustomAIControlMessage,
} = require('../src/app/main/services/custom-ai-api');

test('自定义 API 配置可识别且公开配置不会泄露 API Key', () => {
  const config = getCustomAiApiConfig({
    aiControlSettings: {
      customApi: {
        enabled: true,
        name: '本地模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'secret',
        model: 'qwen3',
      },
    },
  });
  assert.equal(isCustomAiApiConfigured(config), true);
  assert.equal(isCustomAiModelId(CUSTOM_AI_MODEL_ID), true);
  assert.deepEqual(toPublicCustomAiApiConfig(config), {
    enabled: true,
    name: '本地模型',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3',
    hasApiKey: true,
  });
});

test('自定义 API 地址兼容 Base URL 与完整 Chat Completions URL', () => {
  assert.equal(
    resolveChatCompletionsUrl('https://api.openai.com/v1'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    resolveChatCompletionsUrl('http://127.0.0.1:11434'),
    'http://127.0.0.1:11434/v1/chat/completions',
  );
  assert.equal(
    resolveChatCompletionsUrl('https://example.com/api/v1/chat/completions'),
    'https://example.com/api/v1/chat/completions',
  );
});

test('自定义 API 请求使用 OpenAI 兼容协议并保留工具调用', async (t) => {
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  let captured;
  axios.post = async (url, payload, options) => {
    captured = { url, payload, options };
    return {
      status: 200,
      data: {
        choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'open_page', arguments: '{}' } }] } }],
      },
    };
  };
  const result = await sendCustomAIControlMessage({
    enabled: true,
    baseUrl: 'https://example.com/v1',
    apiKey: 'token',
    model: 'demo-model',
  }, [{ role: 'user', content: '打开网页', private_field: true }], {
    tools: [{ type: 'function', function: { name: 'open_page', parameters: { type: 'object' } } }],
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, 'https://example.com/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer token');
  assert.equal(captured.payload.model, 'demo-model');
  assert.equal(captured.payload.messages[0].private_field, undefined);
  assert.equal(result.message.tool_calls[0].function.name, 'open_page');
});

test('AI 控制界面和 IPC 已接入自定义 API', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/app/sidebar/index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src/app/sidebar/client/app/side/controllers/pages/ai-control.js'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/app/main/ipc/register/settings.js'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(root, 'src/app/main/services/app-lifecycle.js'), 'utf8');
  assert.doesNotMatch(html, /id="ai-chat-custom-api-open"/);
  assert.match(html, /id="ai-custom-api-dialog"/);
  assert.match(renderer, /action\.textContent = '添加自定义模型'/);
  assert.match(renderer, /set-ai-control-custom-api/);
  assert.match(settings, /ipcMain\.handle\('get-ai-control-custom-api'/);
  assert.match(settings, /ipcMain\.handle\('set-ai-control-custom-api'/);
  assert.match(lifecycle, /sendCustomAIControlMessage/);
});
