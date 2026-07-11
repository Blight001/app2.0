const { ipcMain } = require('electron');

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
      if (payload?.collapseSidebar === true && typeof ctx.ui?.ensureSidebarCollapsed === 'function') {
        ctx.ui.ensureSidebarCollapsed();
      }
      return await extensionManager.openExtensionPopup(payload?.id);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.handle('open-extension-options-by-id', async (_event, payload = {}) => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      if (payload?.collapseSidebar === true && typeof ctx.ui?.ensureSidebarCollapsed === 'function') {
        ctx.ui.ensureSidebarCollapsed();
      }
      return await extensionManager.openExtensionOptions(payload?.id);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.handle('close-extension-web-panel', async () => {
    const missing = ensureManager();
    if (missing) return missing;
    try {
      return extensionManager.closeWebPanel();
    } catch (error) {
      return { ok: false, message: error?.message || String(error), state: extensionManager.getPublicState() };
    }
  });
}

module.exports = { registerExtensionsIPC };
