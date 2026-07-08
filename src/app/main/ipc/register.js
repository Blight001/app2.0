const { ipcMain } = require('electron');
const { registerAccountIPC } = require('./account_remember');
const { registerClashIPC } = require('./register/clash');
const { registerLicenseIPC } = require('./register/license');
const { registerMiscIPC } = require('./register/misc');
const { registerSettingsIPC } = require('./register/settings');
const { registerUiIPC } = require('./register/ui');
const { registerExtensionsIPC } = require('./register/extensions');

// 同步/连接：patchUniqueIpcRegistration的具体业务逻辑。
function patchUniqueIpcRegistration() {
  if (ipcMain.__uniqueRegistrationPatched) {
    return;
  }

  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalOn = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    try { ipcMain.removeHandler(channel); } catch (_) {}
    return originalHandle(channel, listener);
  };
  ipcMain.on = (channel, listener) => {
    try { ipcMain.removeAllListeners(channel); } catch (_) {}
    return originalOn(channel, listener);
  };
  ipcMain.__uniqueRegistrationPatched = true;
}

// 监听/绑定：registerIPC的具体业务逻辑。
function registerIPC(ctx) {
  patchUniqueIpcRegistration();

  registerLicenseIPC(ctx);
  registerUiIPC(ctx);
  registerExtensionsIPC(ctx);
  registerMiscIPC(ctx);
  registerSettingsIPC(ctx);
  registerClashIPC(ctx);
  registerAccountIPC(ctx);
}

module.exports = { registerIPC };
