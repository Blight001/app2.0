const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sidebarRoot = path.join(
  __dirname,
  '../src/app/sidebar/client/app/side/controllers/pages/side-panel',
);

function read(relativePath) {
  return fs.readFileSync(path.join(sidebarRoot, relativePath), 'utf8');
}

test('羊毛资源在调用主进程前执行未登录门禁', () => {
  const source = read('dream-opener.js');
  const gateIndex = source.indexOf('window.redirectToSidebarAccountLogin?.()');
  const requestIndex = source.indexOf('window.electron.openDreamPage', gateIndex);

  assert.notEqual(gateIndex, -1);
  assert.notEqual(requestIndex, -1);
  assert.ok(gateIndex < requestIndex, '登录门禁必须先于 openDreamPage 调用');
  assert.ok(source.includes('if (window.redirectToSidebarAccountLogin?.()) return;'));
});

test('网络魔法在进入启停流程前执行未登录门禁', () => {
  const source = read('modules/vpn.js');
  const clickHandlerIndex = source.indexOf("vpnBtn.addEventListener('click'");
  const gateIndex = source.indexOf('window.redirectToSidebarAccountLogin?.()', clickHandlerIndex);
  const toggleIndex = source.indexOf('toggleClashMini({ startBtn, vpnBtn })', clickHandlerIndex);

  assert.notEqual(clickHandlerIndex, -1);
  assert.notEqual(gateIndex, -1);
  assert.notEqual(toggleIndex, -1);
  assert.ok(gateIndex < toggleIndex, '登录门禁必须先于网络魔法启停流程');
  assert.ok(source.includes('if (window.redirectToSidebarAccountLogin?.()) return;', clickHandlerIndex));
});

test('登录跳转复用头像的外部个人中心浮窗', () => {
  const source = read('modules/account-auth.js');
  const start = source.indexOf('function redirectToSidebarAccountLogin()');
  const end = source.indexOf('\n}', start) + 2;
  const helper = source.slice(start, end);

  assert.match(helper, /send\?\.\('open-account-center-popup'\)/);
  assert.doesNotMatch(helper, /openAccountCenterDialog|openSidebarAccountAuth|invoke|fetch|XMLHttpRequest/);
});
