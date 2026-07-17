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

test('AI 控制首次加载时默认勾选全部可用浏览器', () => {
  assert.match(source, /const initialBrowserIds = state\.browserSelectionTouched && survivingIds\.length/);
  assert.match(source, /: allConnectionIds;/);
});

test('AI 控制自动勾选刚打开的浏览器并保留旧浏览器的手动选择', () => {
  assert.match(source, /const newlyConnectedIds = state\.browserConnectionsInitialized/);
  assert.match(source, /allConnectionIds\.filter\(\(id\) => !previouslyAvailableIds\.has\(id\)\)/);
  assert.match(source, /normalizeBrowserIds\(\[\.\.\.survivingIds, \.\.\.newlyConnectedIds\]\)/);
});

test('用户仍可手动选择不连接浏览器', () => {
  assert.match(source, /state\.browserSelectionExplicitlyDisabled = !state\.currentBrowserIds\.length/);
  assert.match(source, /const nextBrowserIds = state\.browserSelectionExplicitlyDisabled\s*\? \[\]/);
  assert.match(source, /<option value="">不连接浏览器<\/option>/);
});

test('浏览器列表加载前不把不连接浏览器显示为默认值', () => {
  assert.match(html, /<option value="">正在查找可用浏览器\.\.\.<\/option>/);
  assert.match(html, /ai-browser-gear-value">正在查找可用浏览器\.\.\.<\/span>/);
});
