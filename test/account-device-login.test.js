const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const hardware = source('src/app/main/utils/hardware-js.js');
const lifecycle = source('src/app/main/services/app-lifecycle.js');
const appShell = source('src/app/main/services/app-shell.js');
const resolver = source('src/app/main/services/server-resolver.js');
const clash = source('src/app/main/ipc/register/clash.js');
const sidebar = source('src/app/sidebar/index.html');
const accountController = source(
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js',
);

test('账号认证仅使用封装的系统 machine-id，不接受渲染层伪造设备号', () => {
  assert.match(hardware, /node-machine-id/);
  assert.match(hardware, /machineIdSync\(\{ original: true \}\)/);
  assert.doesNotMatch(hardware, /networkInterfaces|macAddress|diskserial/i);

  const start = lifecycle.indexOf("ipcMain.handle('account-authenticate'");
  const end = lifecycle.indexOf("ipcMain.handle('account-logout'", start);
  const handler = lifecycle.slice(start, end);
  assert.match(handler, /const deviceId = String\(await computeDeviceId\(\)/);
  assert.doesNotMatch(handler, /input\.deviceId/);
});

test('设备号登录走独立服务端入口并在个人中心提供找回按钮', () => {
  assert.match(resolver, /mode === 'device' \? 'device-login'/);
  assert.match(sidebar, /id="sidebar-device-login"/);
  assert.match(accountController, /invokeSidebarAccountAuth\(\{ mode: 'device' \}\)/);
  assert.match(accountController, /sidebar-device-login[^\n]*addEventListener/);
});

test('四类客户端兑换均在请求前重新读取本机封装设备号', () => {
  for (const channel of [
    'ai-control-redeem-gift-code',
    'redeem-vip-gift-code',
    'redeem-wool-gift-code',
  ]) {
    const start = lifecycle.indexOf(`ipcMain.handle('${channel}'`);
    const end = lifecycle.indexOf('\n    });', start);
    assert.match(lifecycle.slice(start, end), /await computeDeviceId\(\)/, channel);
  }
  const trafficStart = clash.indexOf("ipcMain.handle('redeem-proxy-traffic-gift-code'");
  const trafficEnd = clash.indexOf('\n  });', trafficStart);
  assert.match(clash.slice(trafficStart, trafficEnd), /await computeDeviceId\(\)/);
});

test('流量 IPC 注册时接入主进程设备号计算函数', () => {
  const start = appShell.indexOf('registerIPC({');
  const end = appShell.indexOf("logger.log?.('[启动] IPC handlers 已注册')", start);
  assert.match(appShell.slice(start, end), /computeDeviceId/);
});
