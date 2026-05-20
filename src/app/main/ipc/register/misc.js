const { app, ipcMain } = require('electron');
const { createTcpClient } = require('../../lib/tcp-client');
const { getStorePath } = require('../../config');

const DEFAULT_TUTORIAL_URL = '';

// 监听/绑定：registerMiscIPC的具体业务逻辑。
function registerMiscIPC(ctx) {
  const { tcp, licenseCache } = ctx;

  ipcMain.handle('create-desktop-shortcut', async (_event, { createShortcut }) => {
    try {
      if (!createShortcut) {
        console.log('[Shortcut] 用户选择不创建桌面快捷方式');
        return { ok: true };
      }

      const { createDesktopShortcut } = require('../../utils/shortcut');
      const result = await createDesktopShortcut();
      return result;
    } catch (e) {
      console.error('[Shortcut] 创建桌面快捷方式失败:', e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('network:diagnose', async () => {
    try {
      console.log('[IPC] 开始网络连接诊断...');
      const tcpClient = createTcpClient();
      const result = await tcpClient.diagnoseConnection();

      console.log('[IPC] 网络诊断完成:', result);
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      console.error('[IPC] 网络诊断失败:', error);
      return {
        ok: false,
        error: error.message,
        message: '网络诊断执行失败',
      };
    }
  });

  ipcMain.handle('get-platform-name', async () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      if (runtimeConfig.platformName) {
        return runtimeConfig.platformName;
      }
      const allowedPlatforms = Array.isArray(runtimeConfig.allowedPlatforms) ? runtimeConfig.allowedPlatforms : [];
      if (allowedPlatforms.length > 0) {
        return allowedPlatforms[0];
      }
      return 'AI-FREE';
    } catch (error) {
      console.error('[IPC] 获取平台名字失败:', error);
      return 'AI-FREE';
    }
  });

  ipcMain.handle('get-tutorial-url', async () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      if (runtimeConfig.tutorialUrl) {
        return runtimeConfig.tutorialUrl;
      }
      return DEFAULT_TUTORIAL_URL;
    } catch (error) {
      console.error('[IPC] 获取教程链接失败:', error);
      return DEFAULT_TUTORIAL_URL;
    }
  });

  ipcMain.handle('get-target-url', async () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      if (runtimeConfig.targetUrl) {
        return runtimeConfig.targetUrl;
      }
      return 'https://dreamina.capcut.com/ai-tool/home?';
    } catch (error) {
      console.error('[IPC] 获取目标链接失败:', error);
      return 'https://dreamina.capcut.com/ai-tool/home?';
    }
  });

  ipcMain.handle('get-app-session-id', async () => {
    try {
      return {
        ok: true,
        sessionId: global.__APP_SESSION_ID__ || '',
      };
    } catch (error) {
      console.error('[IPC] 获取启动会话ID失败:', error);
      return { ok: false, error: error.message || String(error), sessionId: '' };
    }
  });

  ipcMain.handle('get-app-version', async () => {
    try {
      return { ok: true, version: app.getVersion() };
    } catch (error) {
      console.error('[IPC] 获取应用版本失败:', error);
      return { ok: false, error: error.message || String(error), version: '' };
    }
  });

  ipcMain.handle('start-app-update', async (_event, payload = {}) => {
    try {
      const startAppUpdate = typeof ctx.startAppUpdate === 'function'
        ? ctx.startAppUpdate
        : (ctx.ui && typeof ctx.ui.startAppUpdate === 'function' ? ctx.ui.startAppUpdate : null);
      console.warn('[IPC] start-app-update 函数来源', JSON.stringify({
        fromRoot: typeof ctx.startAppUpdate === 'function',
        fromUi: !!(ctx.ui && typeof ctx.ui.startAppUpdate === 'function'),
      }));
      console.warn('[IPC] start-app-update 被调用', JSON.stringify({
        type: payload?.type,
        message_type: payload?.message_type,
        messageType: payload?.messageType,
        version: payload?.version || payload?.latest_version || payload?.latestVersion || payload?.update_version || payload?.updateVersion,
        downloadUrl: payload?.downloadUrl || payload?.download_url || payload?.update_link || payload?.updateLink,
        openUrl: payload?.openUrl || payload?.open_url || payload?.subscription_url || payload?.subscriptionUrl,
      }));
      if (typeof startAppUpdate !== 'function') {
        return { ok: false, message: '更新功能不可用' };
      }
      const result = await startAppUpdate(payload);
      console.warn('[IPC] start-app-update 返回', JSON.stringify(result));
      return result;
    } catch (error) {
      console.error('[IPC] 启动应用更新失败:', error);
      return { ok: false, error: error.message || String(error) };
    }
  });
}

module.exports = { registerMiscIPC };
