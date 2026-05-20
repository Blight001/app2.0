const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const { getStorePath } = require('../../config');
const {
  readStoreConfigSafe,
  persistSavedLicenseKeySafe,
  toFiniteNumber,
  writeStoreConfigSafe,
} = require('./store-utils');
const { detectNetworkMagicStatus } = require('./clash-mini-core');

// 获取/读取/解析：getNetworkMagicAutoStartEnabledSafe的具体业务逻辑。
function getNetworkMagicAutoStartEnabledSafe() {
  try {
    const storeConfig = readStoreConfigSafe();
    if (Object.prototype.hasOwnProperty.call(storeConfig || {}, 'networkMagicAutoStartEnabled')) {
      return storeConfig.networkMagicAutoStartEnabled !== false;
    }
  } catch (_) {}
  return true;
}

// 设置/更新/持久化：setNetworkMagicAutoStartEnabledSafe的具体业务逻辑。
function setNetworkMagicAutoStartEnabledSafe(enabled) {
  try {
    const currentStore = readStoreConfigSafe();
    const nextStore = {
      ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
      networkMagicAutoStartEnabled: enabled === false ? false : true,
    };
    return writeStoreConfigSafe(nextStore);
  } catch (_) {
    return false;
  }
}

// 监听/绑定：registerSettingsIPC的具体业务逻辑。
function registerSettingsIPC(ctx) {
  const { ui, computeDeviceId, licenseCache } = ctx;

  ipcMain.handle('get-plugin-settings', async () => {
    try {
      const pluginState = typeof ui?.statePluginGetter === 'function'
        ? ui.statePluginGetter()
        : {};
      return {
        ok: true,
        settings: {
          removeWatermarkEnabled: pluginState.removeWatermarkEnabled === true,
          translateExtEnabled: pluginState.translateExtEnabled !== false,
        },
      };
    } catch (error) {
      console.error('[IPC] 获取插件开关失败:', error);
      return {
        ok: false,
        error: error.message,
        settings: { removeWatermarkEnabled: false, translateExtEnabled: false },
      };
    }
  });

  ipcMain.handle('set-plugin-settings', async (_event, payload = {}) => {
    try {
      const nextSettings = {
        removeWatermarkEnabled: payload.removeWatermarkEnabled === true,
        translateExtEnabled: payload.translateExtEnabled === true,
      };

      try {
        if (ui && typeof ui.applyPluginSettings === 'function') {
          ui.applyPluginSettings(nextSettings);
        }
      } catch (e) {
        console.warn('[IPC] 应用插件开关到运行时失败:', e?.message || e);
      }

      if (nextSettings.translateExtEnabled === true && typeof ctx.loadTranslateExtension === 'function') {
        try {
          const tabs = typeof ctx.getTabs === 'function' ? ctx.getTabs() : null;
          const entries = tabs && typeof tabs.values === 'function' ? Array.from(tabs.values()) : [];
          await Promise.all(entries.map(async (tab, index) => {
            const wc = tab?.view?.webContents;
            if (!wc || typeof wc.isDestroyed === 'function' && wc.isDestroyed()) {
              return;
            }
            await ctx.loadTranslateExtension(wc.session, `标签 ${tab?.id || index}`);
          }));
        } catch (e) {
          console.warn('[IPC] 翻译扩展加载到现有标签页失败:', e?.message || e);
        }
      }

      if (nextSettings.removeWatermarkEnabled === true && ctx.ui && typeof ctx.ui.forceRemoveWatermark === 'function') {
        try {
          const tabs = typeof ctx.ui.getTabs === 'function' ? ctx.ui.getTabs() : null;
          const entries = tabs && typeof tabs.values === 'function' ? Array.from(tabs.values()) : [];
          await Promise.all(entries.map(async (tab) => {
            const wc = tab?.view?.webContents;
            if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
              return;
            }
            await ctx.ui.forceRemoveWatermark(wc, true);
          }));
        } catch (e) {
          console.warn('[IPC] 去水印脚本加载到现有标签页失败:', e?.message || e);
        }
      }

      return { ok: true, settings: nextSettings };
    } catch (error) {
      console.error('[IPC] 更新插件开关失败:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('get-user-credentials', async () => {
    try {
      const deviceId = typeof computeDeviceId === 'function' ? await computeDeviceId() : '';
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : { key: '', validated: false };
      return {
        ok: true,
        credentials: {
          ...snapshot,
          deviceId,
          key: snapshot.key || '',
          bound: snapshot.bound === true,
          validated: snapshot.validated === true,
          licenseValidated: snapshot.licenseValidated === true,
        },
      };
    } catch (error) {
      console.error('[IPC] 获取用户凭证失败:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('consume-auto-validate-flag', async () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : { key: '', deviceId: '' };
      const pending = runtimeConfig.autoValidatePending === true;

      if (pending && licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
        licenseCache.setRuntimeConfig({ autoValidatePending: false });
      }

      return {
        ok: true,
        pending,
        key: String(snapshot.key || '').trim(),
        deviceId: String(snapshot.deviceId || '').trim(),
      };
    } catch (error) {
      console.error('[IPC] 消费自动验证标记失败:', error);
      return { ok: false, error: error.message, pending: false, key: '', deviceId: '' };
    }
  });

  ipcMain.handle('save-user-credentials', async (_event, { key, deviceId }) => {
    try {
      if (licenseCache && typeof licenseCache.setCredentials === 'function') {
        licenseCache.setCredentials({ key, deviceId });
      }
      persistSavedLicenseKeySafe({
        readStoreConfigSafe,
        writeStoreConfigSafe,
        licenseCache,
      }, key, deviceId);
      console.log('[IPC] 用户凭证已保存到运行时缓存');
      return { ok: true };
    } catch (error) {
      console.error('[IPC] 保存用户凭证失败:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('update-system-proxy-enabled', async (_event, { enabled }) => {
    try {
      if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
        licenseCache.setRuntimeConfig({ systemProxyEnabled: enabled });
      }
      console.log('[IPC] 系统代理状态已更新:', enabled, '模式:', 'clash');
      return { ok: true, enabled, mode: 'clash' };
    } catch (error) {
      console.error('[IPC] 更新系统代理状态失败:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('get-system-proxy-enabled', async () => {
    try {
      const status = await detectNetworkMagicStatus();
      return {
        ok: true,
        enabled: status.enabled === true,
        mode: 'clash',
        source: status.source || 'store',
        systemProxyEnabled: status.systemProxyEnabled === true,
        externalClashRunning: status.externalClashRunning === true,
        vergeMihomoRunning: status.vergeMihomoRunning === true,
        clashServiceRunning: status.clashServiceRunning === true,
        runningClashClient: status.runningClashClient === true,
        anyClashProcessRunning: status.anyClashProcessRunning === true,
        appManagedClashRunning: status.appManagedClashRunning === true,
        matchedProcesses: Array.isArray(status.matchedProcesses) ? status.matchedProcesses : [],
        networkReachable: status.networkReachable === true,
        probe: status.probe || null,
        profile: status.profile || null,
        detectedEnabled: status.detectedEnabled === true,
      };
    } catch (error) {
      console.error('[IPC] 获取系统代理状态失败:', error);
      return { ok: true, enabled: true, mode: 'clash' };
    }
  });

  ipcMain.handle('get-network-magic-auto-start-enabled', async () => {
    try {
      return {
        ok: true,
        enabled: getNetworkMagicAutoStartEnabledSafe(),
      };
    } catch (error) {
      console.error('[IPC] 获取网络魔法自动开启状态失败:', error);
      return { ok: false, error: error.message, enabled: true };
    }
  });

  ipcMain.handle('set-network-magic-auto-start-enabled', async (_event, { enabled } = {}) => {
    try {
      const nextEnabled = enabled !== false;
      const wrote = setNetworkMagicAutoStartEnabledSafe(nextEnabled);
      if (!wrote) {
        return { ok: false, error: '保存网络魔法自动开启状态失败', enabled: nextEnabled };
      }
      return { ok: true, enabled: nextEnabled };
    } catch (error) {
      console.error('[IPC] 更新网络魔法自动开启状态失败:', error);
      return { ok: false, error: error.message, enabled: enabled !== false };
    }
  });

  ipcMain.handle('get-vpn-status', async () => {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          const result = await win.webContents.executeJavaScript(`
            new Promise((resolve) => {
              if (typeof window !== 'undefined' && window.sidePanelVPNStatus !== undefined) {
                resolve({ ok: true, enabled: window.sidePanelVPNStatus });
              } else if (typeof isVpnEnabled !== 'undefined') {
                resolve({ ok: true, enabled: isVpnEnabled });
              } else {
                const vpnBtn = document.getElementById('VPN-switch');
                if (vpnBtn && vpnBtn.textContent) {
                  const isEnabled = vpnBtn.textContent.includes('关闭');
                  resolve({ ok: true, enabled: isEnabled });
                } else {
                  resolve({ ok: true, enabled: true });
                }
              }
            })
          `);
          if (result && result.ok) {
            console.log('[IPC] 获取到渲染进程 VPN 状态:', result.enabled);
            return result;
          }
        }
      }
      return { ok: true, enabled: true };
    } catch (error) {
      console.error('[IPC] 获取 VPN 状态失败:', error);
      return { ok: true, enabled: true };
    }
  });

  ipcMain.on('server-account-cookie-received', (_event, data) => {
    try {
      console.log('[IPC] 收到来自渲染进程的账号cookie消息，转发到侧边栏:', data);
      if (ui && ui.sendToSide) {
        ui.sendToSide('server-account-cookie-received', data);
        console.log('[IPC] 已转发账号cookie消息到侧边栏');
      } else {
        console.error('[IPC] ui.sendToSide不可用，无法转发账号cookie消息');
      }
    } catch (error) {
      console.error('[IPC] 转发账号cookie消息失败:', error);
    }
  });
}

module.exports = { registerSettingsIPC };
