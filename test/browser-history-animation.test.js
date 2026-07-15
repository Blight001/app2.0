const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('浏览器记录操作提供加载、选择和删除动画反馈', () => {
  const controller = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/browser-settings.js');
  const styles = read('src/app/sidebar/client/app/side/styles/modules/browser-settings.css');

  assert.match(controller, /classList\.toggle\('is-refreshing', active\)/);
  assert.match(controller, /classList\.toggle\('is-entering', options\.animate === true\)/);
  assert.match(controller, /classList\.toggle\('is-selection-changing'/);
  assert.match(controller, /animateBrowserHistoryRemoval\(item\.id\)/);
  assert.match(controller, /classList\.add\('is-processing'\)/);

  assert.match(styles, /@keyframes browser-history-item-in/);
  assert.match(styles, /@keyframes browser-history-item-out/);
  assert.match(styles, /\.browser-history-context-menu\.is-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
