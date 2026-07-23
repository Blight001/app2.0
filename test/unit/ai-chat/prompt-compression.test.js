'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BROWSER_SETTINGS_PATCH_SCHEMA,
  SOFTWARE_WINDOW_MODEL_SCHEMA,
} = require('../../../src/app/main/services/ai-browser-window-tool-schema');
const { buildChatToolContext } = require(
  '../../../src/app/main/features/ai-chat/chat-tool-context',
);

test('模型只接收精简软件窗口 schema，运行时仍保留完整校验 schema', () => {
  const modelSize = JSON.stringify(SOFTWARE_WINDOW_MODEL_SCHEMA).length;
  const validationSize = JSON.stringify(BROWSER_SETTINGS_PATCH_SCHEMA).length;
  assert.ok(modelSize < validationSize * 0.3, {
    modelSize,
    validationSize,
  });
  assert.equal(BROWSER_SETTINGS_PATCH_SCHEMA.additionalProperties, false);
});

test('软件 UI 提示按需注入且保持短提示', () => {
  const context = buildChatToolContext({
    connections: [],
    initialMessages: [{ role: 'user', content: '点击保存' }],
    softwareTarget: { name: '记事本' },
    windowTools: {
      has: (name) => ['software_window', 'software_ui'].includes(name),
      tools: [
        { name: 'software_window', input_schema: SOFTWARE_WINDOW_MODEL_SCHEMA },
        { name: 'software_ui', input_schema: { type: 'object' } },
      ],
    },
  });
  const prompt = context.modelMessages[0].content;
  assert.match(prompt, /software_ui 已绑定“记事本”/);
  assert.ok(prompt.length < 500, `软件 UI 前置提示过长：${prompt.length}`);
});
