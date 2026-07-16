const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../src/app/main/ipc/register/ui.js'),
  'utf8',
);
const styleSource = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/styles/modules/account-auth.css'),
  'utf8',
);
const appShellSource = fs.readFileSync(
  path.join(__dirname, '../src/app/renderer/controllers/pages/app-shell/tabs.js'),
  'utf8',
);
const accountControllerSource = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js'),
  'utf8',
);

test('个人中心浮窗失焦后自动关闭', () => {
  const blurHandlerStart = source.indexOf("popup.on('blur'");
  const blurHandlerEnd = source.indexOf('\n    });', blurHandlerStart);
  const blurHandler = source.slice(blurHandlerStart, blurHandlerEnd);

  assert.notEqual(blurHandlerStart, -1);
  assert.match(blurHandler, /!accountCenterPopupBlurArmed \|\| !accountCenterPopupDismissOnBlur/);
  assert.match(blurHandler, /dismissAccountCenterPopupWindow\(\)/);
});

test('VIP 门禁浮窗不因原生浏览器抢焦点而关闭', () => {
  assert.match(source, /accountCenterPopupDismissOnBlur = payload\?\.dismissOnBlur !== false/);
  assert.match(accountControllerSource, /open-account-center-popup', \{ dismissOnBlur: false, showVipPlans: true \}/);

  const focusHandlerStart = source.indexOf('accountCenterPopupWindowFocusHandler = (_event, focusedWindow) =>');
  const focusHandlerEnd = source.indexOf('\n    };', focusHandlerStart);
  const focusHandler = source.slice(focusHandlerStart, focusHandlerEnd);
  assert.match(focusHandler, /!accountCenterPopupDismissOnBlur/);
});

test('浮窗启动期焦点抖动不会被误判为外部点击', () => {
  const showStart = source.indexOf('const showPopup = () =>');
  const closedHandler = source.indexOf("popup.on('closed'", showStart);
  const showHelper = source.slice(showStart, closedHandler);

  assert.match(showHelper, /accountCenterPopupBlurArmed = false/);
  assert.match(showHelper, /setTimeout/);
  assert.match(showHelper, /popup\.focus\(\)/);
  assert.match(showHelper, /accountCenterPopupBlurArmed = true/);
});

test('浮窗先通知渲染层播放动画，再延迟关闭原生窗口', () => {
  const dismissStart = source.indexOf('const dismissAccountCenterPopupWindow');
  const resizeStart = source.indexOf('const resizeAccountCenterPopupWindow', dismissStart);
  const dismissHelper = source.slice(dismissStart, resizeStart);

  assert.match(dismissHelper, /send\('account-popup-dismiss'\)/);
  assert.match(dismissHelper, /setTimeout/);
  assert.match(dismissHelper, /closeAccountCenterPopupWindow\(\)/);
});

test('消失动画以头像方向为原点缩小并淡出', () => {
  assert.match(styleSource, /transform-origin:\s*calc\(100% - 18px\) -12px/);
  assert.match(styleSource, /account-center-popup-closing[\s\S]*accountCenterPopupOut/);
  assert.match(styleSource, /opacity:\s*0;[\s\S]*translateY\(-12px\) scale\(\.08\)/);
});

test('主窗口和侧边栏点击其它区域时显式通知浮窗收起', () => {
  assert.match(appShellSource, /pointerdown[\s\S]*dismiss-account-center-popup/);
  assert.match(accountControllerSource, /!isStandaloneAccountCenterPopup[\s\S]*pointerdown[\s\S]*dismiss-account-center-popup/);
  assert.match(source, /ipcMain\.on\('dismiss-account-center-popup'/);
  assert.match(source, /browser-window-focus/);
});
