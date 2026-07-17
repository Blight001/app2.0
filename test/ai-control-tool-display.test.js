const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(
  path.join(root, 'src/app/sidebar/client/app/side/controllers/pages/ai-control.js'),
  'utf8',
);
const styles = fs.readFileSync(
  path.join(root, 'src/app/sidebar/client/app/side/styles/modules/ai-control.css'),
  'utf8',
);

test('AI 工具折叠栏使用中文类型、中文名称与 SVG 眼睛图标', () => {
  assert.match(renderer, /class="ai-chat-tool-kind">工具<\/span>/);
  assert.doesNotMatch(renderer, /class="ai-chat-tool-kind">MCP<\/span>/);
  assert.match(renderer, /class="ai-chat-tool-icon"[^>]*><svg viewBox="0 0 24 24"/);
  assert.match(renderer, /browser_observe:\s*'观察页面'/);
  assert.match(renderer, /browser_action:\s*'操作页面'/);
  assert.match(renderer, /software_window_create:\s*'新建浏览器窗口'/);
  assert.match(renderer, /textContent = toolDisplayName\(tool\)/);
  assert.match(styles, /\.ai-chat-tool-icon svg\s*\{/);
});

test('未知英文工具名不会直接展示在折叠栏', () => {
  assert.match(renderer, /return '扩展工具';/);
  assert.doesNotMatch(renderer, /textContent = String\(tool\.name/);
});
