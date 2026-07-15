const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('tab context menu exposes restart and clear-data actions in packaged builds', () => {
  const mainSource = read('src/app/main/ipc/register/ui.js');
  const rendererSource = read('src/app/renderer/controllers/pages/app-shell/tabs.js');
  const messageModalSource = read('src/app/sidebar/client/app/side/controllers/shared/message-modal.js');

  assert.match(mainSource, /重启浏览器/);
  assert.match(mainSource, /清空浏览器数据/);
  assert.match(mainSource, /clear-browser-runtime-data/);
  assert.match(mainSource, /ensureSidebarVisible/);
  assert.match(mainSource, /browser-data-clear-confirm-request/);
  assert.match(mainSource, /只能从侧边栏确认清空操作/);
  assert.doesNotMatch(mainSource, /dialog\.showMessageBox/);
  assert.match(rendererSource, /show-tab-context-menu/);
  assert.match(messageModalSource, /resolve-browser-data-clear-confirm/);
  assert.match(messageModalSource, /title: '清空浏览器数据'/);
  assert.match(messageModalSource, /confirmText: '确认清空'/);
  assert.doesNotMatch(mainSource, /set-tab-browser-proxy-mode/);
  assert.doesNotMatch(mainSource, /正式版未启用标签代理切换菜单/);
  assert.doesNotMatch(mainSource, /if \(!isDevMode\)/);
  assert.doesNotMatch(rendererSource, /browserProxyMode/);
});
