const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/ai-control.js'),
  'utf8',
);
const html = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/index.html'),
  'utf8',
);

test('AI 控制在有可用浏览器时默认选择第一个连接', () => {
  assert.match(source, /const firstConnectionId = String\(connections\[0\]\?\.id \|\| ''\)/);
  assert.match(
    source,
    /state\.browserSelectionExplicitlyDisabled \? '' : firstConnectionId/,
  );
});

test('用户仍可手动选择不连接浏览器', () => {
  assert.match(source, /state\.browserSelectionExplicitlyDisabled = !state\.currentBrowserId/);
  assert.match(source, /<option value="">不连接浏览器<\/option>/);
});

test('浏览器列表加载前不把不连接浏览器显示为默认值', () => {
  assert.match(html, /<option value="">正在查找可用浏览器\.\.\.<\/option>/);
  assert.match(html, /ai-browser-gear-value">正在查找可用浏览器\.\.\.<\/span>/);
});
