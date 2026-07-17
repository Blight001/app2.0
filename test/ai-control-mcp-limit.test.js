const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_AI_CONTROL_MCP_CALL_LIMIT,
  getAiControlMcpCallLimit,
  normalizeAiControlMcpCallLimit,
} = require('../src/app/main/utils/ai-control-settings');

test('AI 控制 MCP 调用上限默认值为 100 并限制到安全范围', () => {
  assert.equal(DEFAULT_AI_CONTROL_MCP_CALL_LIMIT, 100);
  assert.equal(getAiControlMcpCallLimit({}), 100);
  assert.equal(getAiControlMcpCallLimit({ aiControlSettings: { mcpCallLimit: 250 } }), 250);
  assert.equal(normalizeAiControlMcpCallLimit(0), 1);
  assert.equal(normalizeAiControlMcpCallLimit(1001), 1000);
  assert.equal(normalizeAiControlMcpCallLimit('12.8'), 12);
});

test('连接浏览器齿轮菜单提供 MCP 调用上限并通过本地 IPC 持久化', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/app/sidebar/index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/ai-control.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(__dirname, '../src/app/main/ipc/register/settings.js'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(__dirname, '../src/app/main/services/app-lifecycle.js'), 'utf8');

  assert.match(html, /<span>浏览器配置<\/span>/);
  assert.doesNotMatch(html, /ai-control-runtime-settings/);
  assert.match(renderer, /appendBrowserMcpSetting\(menu\)/);
  assert.match(renderer, /input\.id = 'ai-browser-mcp-call-limit'/);
  assert.match(renderer, /invoke\('get-ai-control-settings'\)/);
  assert.match(renderer, /invoke\('set-ai-control-settings'/);
  assert.match(ipc, /ipc.handle\('get-ai-control-settings'/);
  assert.match(ipc, /ipc.handle\('set-ai-control-settings'/);
  assert.match(lifecycle, /mcpCallCount \+ toolCalls\.length > mcpCallLimit/);
  assert.doesNotMatch(lifecycle, /round < 12/);
});
