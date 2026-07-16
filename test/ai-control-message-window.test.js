'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_AI_CONTROL_MESSAGES,
  limitAiControlMessages,
} = require('../src/app/main/lib/ai-control-message-window');

test('AI 控制单次最多携带 40 条消息并保留最新上下文', () => {
  const messages = Array.from({ length: 55 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message-${index}`,
  }));
  const limited = limitAiControlMessages(messages);
  assert.equal(MAX_AI_CONTROL_MESSAGES, 40);
  assert.equal(limited.length, 40);
  assert.equal(limited[0].content, 'message-15');
  assert.equal(limited.at(-1).content, 'message-54');
});

test('消息裁剪保留系统上下文且不会拆散工具调用和工具结果', () => {
  const messages = [
    { role: 'system', content: '当前卡片' },
    ...Array.from({ length: 45 }, (_, index) => ({ role: 'user', content: `old-${index}` })),
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call-1', function: { name: 'click', arguments: '{}' } },
        { id: 'call-2', function: { name: 'observe', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call-1', content: '{"success":false}' },
    { role: 'tool', tool_call_id: 'call-2', content: '{"success":true}' },
  ];
  const limited = limitAiControlMessages(messages);
  assert.ok(limited.length <= 40);
  assert.equal(limited[0].role, 'system');
  assert.deepEqual(limited.slice(-3).map((item) => item.role), ['assistant', 'tool', 'tool']);
});

test('孤立工具结果不会被发送，插件错误可恢复为正常对话结果', () => {
  const limited = limitAiControlMessages([
    { role: 'tool', tool_call_id: 'missing', content: '{"success":false}' },
    { role: 'user', content: '继续' },
  ]);
  assert.deepEqual(limited, [{ role: 'user', content: '继续' }]);

  const lifecycle = fs.readFileSync(
    path.join(__dirname, '../src/app/main/services/app-lifecycle.js'),
    'utf8',
  );
  assert.match(lifecycle, /recoveredFromToolError: true/);
  assert.match(lifecycle, /recoverable: true/);
  assert.match(lifecycle, /不要终止整个对话/);
  assert.match(lifecycle, /modelMessages = limitAiControlMessages\(modelMessages\)/);
});
