const { app, ipcMain } = require('electron');
const { createHttpClient } = require('../../lib/http-client');
const { getStorePath } = require('../../config');
const { summarizeUpdatePayload } = require('../../utils/update-payload');

const DEFAULT_TUTORIAL_URL = 'https://www.yuque.com/kelingaishipindian/tx5gwq/xbsl692ls9xope0e?singleDoc#';

// 监听/绑定：registerMiscIPC的具体业务逻辑。
function registerMiscIPC(ctx) {
  const { licenseCache } = ctx;

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
      const httpClient = createHttpClient();
      const result = await httpClient.diagnoseConnection();

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

  ipcMain.handle('get-wool-platforms', async () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const woolPlatforms = (Array.isArray(runtimeConfig.woolPlatforms) ? runtimeConfig.woolPlatforms : [])
        .map((item) => ({
          name: String(item?.name || item?.platform || item?.platform_name || '').trim(),
          platform: String(item?.platform || item?.name || item?.platform_name || '').trim(),
          targetUrl: String(item?.targetUrl || item?.target_url || '').trim(),
          quota: item?.quota && typeof item.quota === 'object' ? { ...item.quota } : null,
        }))
        .filter((item) => item.name && item.targetUrl);
      return woolPlatforms;
    } catch (error) {
      console.error('[IPC] 获取羊毛平台列表失败:', error);
      return [];
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
      console.warn('[IPC] start-app-update 被调用', JSON.stringify(summarizeUpdatePayload(payload)));
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
