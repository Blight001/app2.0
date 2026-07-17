const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('浏览器记录将重命名、参数和删除合并到编辑弹窗', () => {
  const html = read('src/app/sidebar/index.html');
  const controller = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/browser-settings.js');

  assert.match(html, /id="browser-record-name"/);
  assert.match(html, /id="delete-browser-record"/);
  assert.match(controller, /edit\.textContent = '编辑'/);
  assert.match(controller, /edit\.title = '编辑名称、参数或删除浏览器'/);
  assert.doesNotMatch(controller, /rename\.textContent = '重命名'/);
  assert.doesNotMatch(controller, /configure\.textContent = '参数'/);
  assert.match(controller, /invoke\('rename-browser-history'/);
  assert.match(controller, /deleteBrowserHistory\(item, \{ closeDialogOnSuccess: true \}\)/);
});
