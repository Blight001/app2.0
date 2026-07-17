const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/ai-control.js'),
  'utf8',
);
const sidebarRoutingSource = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/announcements.js'),
  'utf8',
);
const uiIpcSource = fs.readFileSync(
  path.join(__dirname, '../src/app/main/ipc/register/ui.js'),
  'utf8',
);

test('AI 控制的后台连接检查只在数据变化时重建菜单', () => {
  assert.match(source, /const snapshot = browserConnectionsSnapshot\(connections\);/);
  assert.match(source, /if \(!listChanged\) return;/);
});

test('自动化卡片轮询结果不变时不再重绘菜单', () => {
  assert.match(source, /const snapshot = automationCardsSnapshot\(cards, sharedId\);/);
  assert.match(source, /if \(uiChanged\) \{/);
});

test('中文输入法合成期间不刷新动态数据也不把 Enter 当成发送', () => {
  assert.match(source, /addEventListener\('compositionstart'/);
  assert.match(source, /addEventListener\('compositionend'/);
  assert.match(source, /!event\.isComposing/);
  assert.match(source, /event\.keyCode !== 229/);
  assert.match(source, /!state\.aiInputComposing/);
  assert.match(source, /compositionWasUnexpectedlyCleared/);
  assert.match(source, /chatInput\.value = state\.aiInputCompositionDraft/);
});

test('文本输入只执行一次无延迟的原生焦点交接', () => {
  assert.match(sidebarRoutingSource, /if \(textInput\) focusRequest\.interaction = 'text-input'/);
  assert.match(source, /invoke\('focus-sidebar-input', \{ interaction: 'text-input' \}\)/);
  assert.doesNotMatch(source, /chatInput\?\.addEventListener\('pointerdown'/);
  const stableBranch = uiIpcSource.indexOf('if (textInputInteraction)');
  const delayedRefocus = uiIpcSource.indexOf('await new Promise((resolve) => setImmediate(resolve))');
  assert.ok(stableBranch >= 0 && delayedRefocus > stableBranch);
});
