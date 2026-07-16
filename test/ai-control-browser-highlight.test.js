const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererSource = fs.readFileSync(
  path.join(__dirname, '../src/app/renderer/controllers/pages/app-shell/tabs.js'),
  'utf8',
);
const sidebarSource = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/ai-control.js'),
  'utf8',
);
const cssSource = fs.readFileSync(
  path.join(__dirname, '../src/app/renderer/styles/app-shell.css'),
  'utf8',
);

test('顶部标签不再显示 Chromium 的 C 徽标，仅在崩溃时显示重启入口', () => {
  assert.doesNotMatch(rendererSource, /runtimeBadge\.textContent\s*=.*'C'/);
  assert.match(rendererSource, /runtimeStatus === 'crashed'/);
  assert.match(rendererSource, /runtimeBadge\.textContent = '重启'/);
});

test('AI 栏目将当前连接对应的浏览器实例同步到顶部标签', () => {
  assert.match(sidebarSource, /ai-control-browser-selection-changed/);
  assert.match(sidebarSource, /connection\?\.profileId/);
  assert.match(rendererSource, /ai-browser-connected/);
  assert.match(rendererSource, /ai-control-browser-selection-changed/);
});

test('AI 当前浏览器标签使用低密度小方块和 AI 文字混合粒子', () => {
  assert.match(cssSource, /\.tab\.ai-browser-connected \{/);
  assert.match(cssSource, /border-color: rgba\(64, 158, 255/);
  assert.match(cssSource, /@keyframes aiBrowserParticleTravel/);
  assert.match(cssSource, /left: -14px/);
  assert.match(rendererSource, /for \(let index = 0; index < 10; index \+= 1\)/);
  assert.match(rendererSource, /: 3 \+ Math\.floor\(random\(\) \* 4\)/);
  assert.match(rendererSource, /particle\.textContent = 'AI'/);
  assert.match(cssSource, /\.ai-text-particle/);
  assert.match(rendererSource, /--particle-duration/);
});
