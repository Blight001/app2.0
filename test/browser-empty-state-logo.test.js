const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shellHtml = fs.readFileSync(
  path.join(__dirname, '../src/app/views/app-shell.html'),
  'utf8',
);
const shellStyles = fs.readFileSync(
  path.join(__dirname, '../src/app/renderer/styles/app-shell.css'),
  'utf8',
);
const shellController = fs.readFileSync(
  path.join(__dirname, '../src/app/renderer/controllers/pages/app-shell/tabs.js'),
  'utf8',
);

test('浏览器未打开时在浏览器区域居中显示应用 Logo', () => {
  assert.match(shellHtml, /id="browser-empty-state"[\s\S]*data-app-logo/);
  assert.match(shellStyles, /#browser-empty-state\s*{[\s\S]*inset:\s*0 30% 0 0;[\s\S]*place-items:\s*center;/);
  assert.match(shellStyles, /html\.sidebar-collapsed #browser-empty-state\s*{[\s\S]*right:\s*0;/);
});

test('浏览器就绪后隐藏 Logo，占位状态跟随侧栏宽度', () => {
  assert.match(shellController, /emptyState\.hidden = runtimeStatus === 'ready' \|\| runtimeStatus === 'hidden'/);
  assert.match(shellController, /sidebar-collapse[\s\S]*setBrowserEmptyStateSidebarVisible\(false\)/);
  assert.match(shellController, /sidebar-expand[\s\S]*setBrowserEmptyStateSidebarVisible\(true\)/);
});
