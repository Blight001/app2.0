const { BrowserWindow, ipcMain } = require('electron');

function registerExtensionsIPC(ctx = {}) {
  const extensionManager = ctx.extensionManager || ctx.ui?.extensionManager || null;

  function ensureManager() {
    if (!extensionManager) {
      return { ok: false, message: '插件管理器不可用', state: { developerModeEnabled: false, plugins: [] } };
    }
    return null;
  }

  ipcMain.handle('get-extension-manager-state', async () => {
    const missing = ensureManager();
    if (missing) return missing;
    return { ok: true, state: extensionManager.getPublicState() };
  });

  ipcMain.handle('set-extension-developer-mode', async (_event, payload = {}) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      const state = await extensionManager.setDeveloperModeEnabled(payload?.enabled === true);
      return { ok: true, state };
    } catch (error) {
      return { ok: false, message: error?.message || String(error), state: extensionManager.getPublicState() };
    }
  });

  ipcMain.handle('import-extension-directory', async (_event) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      const parentWindow = BrowserWindow.fromWebContents(_event.sender);
      return await extensionManager.importExtensionWithDialog(parentWindow);
    } catch (error) {
      return { ok: false, message: error?.message || String(error), state: extensionManager.getPublicState() };
    }
  });

  ipcMain.handle('set-extension-enabled', async (_event, payload = {}) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      return await extensionManager.setPluginEnabled(payload?.id, payload?.enabled === true);
    } catch (error) {
      return { ok: false, message: error?.message || String(error), state: extensionManager.getPublicState() };
    }
  });

  ipcMain.handle('remove-extension-plugin', async (_event, payload = {}) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      return await extensionManager.removePlugin(payload?.id);
    } catch (error) {
      return { ok: false, message: error?.message || String(error), state: extensionManager.getPublicState() };
    }
  });

  ipcMain.handle('open-extension-popup-by-id', async (_event, payload = {}) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      return await extensionManager.openExtensionPopup(payload?.id);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.handle('open-extension-options-by-id', async (_event, payload = {}) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      return await extensionManager.openExtensionOptions(payload?.id);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });
}

module.exports = { registerExtensionsIPC };
