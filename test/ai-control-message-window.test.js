'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AI_CONTEXT_SUMMARY_PREFIX,
  MAX_AI_CONTROL_CHARS,
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
  assert.match(limited[0].content, new RegExp(`^${AI_CONTEXT_SUMMARY_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(limited[1].content, 'message-16');
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

test('内容超过后端字符限制时自动摘要并保留最新请求原文', () => {
  const messages = [
    { role: 'user', content: `最初目标-${'甲'.repeat(18000)}` },
    { role: 'assistant', content: `较早回复-${'乙'.repeat(18000)}` },
    { role: 'user', content: `中间补充-${'丙'.repeat(18000)}` },
    { role: 'assistant', content: '最近回复' },
    { role: 'user', content: '请继续完成最新任务' },
  ];
  const limited = limitAiControlMessages(messages);
  const totalChars = limited.reduce((sum, item) => sum + String(item.content || '').length, 0);

  assert.ok(totalChars <= MAX_AI_CONTROL_CHARS);
  assert.ok(limited.some((item) => String(item.content || '').startsWith(AI_CONTEXT_SUMMARY_PREFIX)));
  assert.equal(limited.at(-1).content, '请继续完成最新任务');
  assert.equal(limited.at(-2).content, '最近回复');
});

test('超大的最新工具结果会压缩但不会拆散工具调用链', () => {
  const limited = limitAiControlMessages([
    { role: 'user', content: '检查网页' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call-large', function: { name: 'observe', arguments: '{}' } }],
    },
    { role: 'tool', name: 'observe', tool_call_id: 'call-large', content: '结果'.repeat(30000) },
  ]);
  const totalChars = limited.reduce((sum, item) => sum + String(item.content || '').length, 0);

  assert.ok(totalChars <= MAX_AI_CONTROL_CHARS);
  assert.deepEqual(limited.slice(-2).map((item) => item.role), ['assistant', 'tool']);
  assert.match(limited.at(-1).content, /内容已自动压缩/);
});

test('超限时优先压缩较早工具返回值，再保留普通对话原文', () => {
  const latestUserContent = `根据前面的结果继续分析-${'用户上下文'.repeat(2500)}`;
  const limited = limitAiControlMessages([
    { role: 'user', content: '读取网页' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call-old', function: { name: 'observe', arguments: '{}' } }],
    },
    { role: 'tool', name: 'observe', tool_call_id: 'call-old', content: '旧工具结果'.repeat(6000) },
    { role: 'assistant', content: '已经读取网页。' },
    { role: 'user', content: latestUserContent },
  ]);

  const oldToolResult = limited.find((item) => item.role === 'tool');
  assert.ok(oldToolResult);
  assert.match(oldToolResult.content, /^\[较早的工具返回值已自动压缩/);
  assert.ok(oldToolResult.content.length <= 600);
  assert.equal(limited.at(-1).content, latestUserContent);
  assert.ok(!limited.some((item) => String(item.content || '').startsWith(AI_CONTEXT_SUMMARY_PREFIX)));
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
