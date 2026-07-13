const { BrowserWindow, ipcMain, net, session: electronSession } = require('electron');
const fs = require('fs');
const { getStorePath } = require('../../config');
const {
  readStoreConfigSafe,
  saveLicenseCredentialsSafe,
  toFiniteNumber,
  writeStoreConfigSafe,
} = require('./store-utils');
const { detectNetworkMagicStatus } = require('./clash-mini-core');
const {
  DEFAULT_AI_FREE_BROWSER_SETTINGS,
  normalizeAiFreeBrowserSettings,
} = require('../../utils/ai-free-browser-settings');

const getBrowserRuntimeInfo = () => ({
  chromiumVersion: String(process.versions?.chrome || ''),
  electronVersion: String(process.versions?.electron || ''),
});

function validateBrowserSettingsPayload(input = {}) {
  const rawCookies = input?.cookies;
  if (rawCookies !== undefined && !Array.isArray(rawCookies)) {
    let parsed;
    try { parsed = JSON.parse(String(rawCookies || '[]')); } catch (_) { throw new Error('Cookie 必须是有效的 JSON 数组'); }
    if (!Array.isArray(parsed)) throw new Error('Cookie 顶层必须是数组');
  }
  if (input?.secChUa?.mode === 'custom' && !Array.isArray(input?.secChUa?.brands)) throw new Error('Sec-CH-UA 必须是数组');
  if (input?.homepage?.mode === 'custom') {
    const parsed = new URL(String(input.homepage.url || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('启动主页仅支持 HTTP/HTTPS');
  }
}

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
  const extensionManager = ctx.extensionManager || ui?.extensionManager || null;

  ipcMain.handle('get-ai-free-browser-settings', async () => {
    try {
      const store = readStoreConfigSafe();
      const saved = store?.aiFreeBrowserSettings && typeof store.aiFreeBrowserSettings === 'object'
        ? store.aiFreeBrowserSettings
        : DEFAULT_AI_FREE_BROWSER_SETTINGS;
      const settings = normalizeAiFreeBrowserSettings(saved);
      const activeTabId = typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() : null;
      const activeTab = typeof ui?.getTabs === 'function' ? ui.getTabs()?.get?.(activeTabId) : null;
      return {
        ok: true,
        settings,
        runtimeInfo: getBrowserRuntimeInfo(),
        activeTab: activeTab ? {
          id: String(activeTab.id || ''),
          title: String(activeTab.fixedTitle || activeTab.runtimeTitle || activeTab.view?.webContents?.getTitle?.() || '当前环境'),
          runtimeType: String(activeTab.runtimeType || 'electron'),
        } : null,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), settings: normalizeAiFreeBrowserSettings({}) };
    }
  });

  ipcMain.handle('test-ai-free-proxy', async (_event, payload = {}) => {
    const proxy = normalizeAiFreeBrowserSettings({ proxy: payload?.proxy }).proxy;
    if (proxy.mode !== 'custom' || !proxy.host || !proxy.port) return { ok: false, error: '请先填写代理主机和端口' };
    const startedAt = Date.now();
    try {
      const testSession = electronSession.fromPartition(`ai-free-proxy-test-${Date.now()}`, { cache: false });
      const scheme = proxy.protocol;
      await testSession.setProxy({ proxyRules: `${scheme}://${proxy.host}:${proxy.port}` });
      const result = await new Promise((resolve, reject) => {
        const request = net.request({ method: 'GET', url: 'https://api.ipify.org?format=json', session: testSession });
        const timer = setTimeout(() => { request.abort(); reject(new Error('代理检测超时')); }, 12000);
        request.on('login', (_authInfo, callback) => callback(proxy.username || '', proxy.password || ''));
        request.on('response', (response) => {
          let body = '';
          response.on('data', (chunk) => { body += String(chunk); });
          response.on('end', () => { clearTimeout(timer); resolve({ statusCode: response.statusCode, body }); });
        });
        request.on('error', (error) => { clearTimeout(timer); reject(error); });
        request.end();
      });
      if (Number(result.statusCode) < 200 || Number(result.statusCode) >= 400) throw new Error(`代理返回 HTTP ${result.statusCode}`);
      let ip = ''; try { ip = JSON.parse(result.body)?.ip || ''; } catch (_) { ip = result.body.trim(); }
      return { ok: true, ip, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), elapsedMs: Date.now() - startedAt };
    }
  });

  ipcMain.handle('extract-ai-free-proxy', async (_event, payload = {}) => {
    try {
      const apiUrl = String(payload?.apiUrl || '').trim();
      const parsedUrl = new URL(apiUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('API 链接仅支持 HTTP/HTTPS');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const response = await net.fetch(parsedUrl.href, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`API 返回 HTTP ${response.status}`);
      const raw = (await response.text()).trim();
      let source = raw;
      try {
        const json = JSON.parse(raw);
        source = json?.data?.proxy || json?.proxy || json?.data || json;
        if (source && typeof source === 'object') {
          const normalized = normalizeAiFreeBrowserSettings({ proxy: {
            mode: 'custom', protocol: source.protocol || source.type || 'http',
            host: source.host || source.ip || source.hostname, port: source.port,
            username: source.username || source.user, password: source.password || source.pass,
          }}).proxy;
          if (!normalized.host || !normalized.port) throw new Error('API 返回中没有代理主机或端口');
          return { ok: true, proxy: normalized };
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const match = String(source).match(/(?:(https?|socks[45]):\/\/)?(?:([^:@\s]+):([^@\s]+)@)?([^:\s]+):(\d+)(?::([^:\s]+):([^\s]+))?/i);
      if (!match) throw new Error('无法识别 API 返回的代理格式');
      const normalized = normalizeAiFreeBrowserSettings({ proxy: {
        mode: 'custom', protocol: match[1] || 'http', host: match[4], port: match[5],
        username: match[2] || match[6] || '', password: match[3] || match[7] || '',
      }}).proxy;
      return { ok: true, proxy: normalized };
    } catch (error) {
      return { ok: false, error: error?.name === 'AbortError' ? '代理 API 请求超时' : (error?.message || String(error)) };
    }
  });

  ipcMain.handle('set-ai-free-browser-settings', async (_event, payload = {}) => {
    try {
      const rawSettings = payload?.settings || payload;
      validateBrowserSettingsPayload(rawSettings);
      const settings = normalizeAiFreeBrowserSettings(rawSettings);
      const currentStore = readStoreConfigSafe();
      const wrote = writeStoreConfigSafe({
        ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
        aiFreeBrowserSettings: settings,
      });
      if (!wrote) return { ok: false, error: '参数未能写入本地配置' };
      if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
        licenseCache.setRuntimeConfig({ browserSettings: settings });
      }

      let activeResult = null;
      const activeTabId = typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() : null;
      if (payload?.applyToActive !== false && activeTabId && typeof ui?.setTabBrowserSettings === 'function') {
        activeResult = await ui.setTabBrowserSettings(activeTabId, settings, {
          restartChromium: payload?.restartChromium === true,
        });
      }
      return { ok: true, settings, activeResult, runtimeInfo: getBrowserRuntimeInfo() };
    } catch (error) {
      console.error('[IPC] 保存 AI-FREE 浏览器参数失败:', error);
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('reset-ai-free-browser-settings', async (_event, payload = {}) => {
    try {
      const settings = normalizeAiFreeBrowserSettings({});
      const currentStore = readStoreConfigSafe();
      const wrote = writeStoreConfigSafe({
        ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
        aiFreeBrowserSettings: settings,
      });
      if (!wrote) return { ok: false, error: '默认参数未能写入本地配置' };
      licenseCache?.setRuntimeConfig?.({ browserSettings: settings });
      let activeResult = null;
      const activeTabId = typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() : null;
      if (payload?.applyToActive !== false && activeTabId && typeof ui?.setTabBrowserSettings === 'function') {
        activeResult = await ui.setTabBrowserSettings(activeTabId, settings, {
          restartChromium: payload?.restartChromium === true,
        });
      }
      return { ok: true, settings, activeResult, runtimeInfo: getBrowserRuntimeInfo() };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('get-plugin-settings', async () => {
    try {
      const pluginState = typeof ui?.statePluginGetter === 'function'
        ? ui.statePluginGetter()
        : {};
      const translateExtEnabled = extensionManager && typeof extensionManager.isPluginEnabled === 'function'
        ? extensionManager.isPluginEnabled(extensionManager.BUILTIN_TRANSLATE_ID)
        : pluginState.translateExtEnabled === true;
      return {
        ok: true,
        settings: {
          removeWatermarkEnabled: pluginState.removeWatermarkEnabled === true,
          translateExtEnabled,
        },
      };
    } catch (error) {
      console.error('[IPC] 获取插件开关失败:', error);
      return {
        ok: false,
        error: error.message,
        settings: { removeWatermarkEnabled: true, translateExtEnabled: false },
      };
    }
  });

  ipcMain.handle('set-plugin-settings', async (_event, payload = {}) => {
    try {
      const currentSettings = typeof ui?.statePluginGetter === 'function'
        ? ui.statePluginGetter()
        : {};
      const hasRemoveWatermark = Object.prototype.hasOwnProperty.call(payload || {}, 'removeWatermarkEnabled');
      const hasTranslateExt = Object.prototype.hasOwnProperty.call(payload || {}, 'translateExtEnabled');
      const nextSettings = {
        removeWatermarkEnabled: hasRemoveWatermark
          ? payload.removeWatermarkEnabled === true
          : currentSettings.removeWatermarkEnabled === true,
        translateExtEnabled: hasTranslateExt
          ? payload.translateExtEnabled === true
          : currentSettings.translateExtEnabled === true,
      };

      try {
        if (ui && typeof ui.applyPluginSettings === 'function') {
          ui.applyPluginSettings(nextSettings);
        }
      } catch (e) {
        console.warn('[IPC] 应用插件开关到运行时失败:', e?.message || e);
      }

      if (hasTranslateExt && extensionManager && typeof extensionManager.setPluginEnabled === 'function') {
        try {
          await extensionManager.setPluginEnabled(extensionManager.BUILTIN_TRANSLATE_ID, nextSettings.translateExtEnabled === true);
        } catch (e) {
          console.warn('[IPC] 更新翻译插件开关失败:', e?.message || e);
        }
      } else if (nextSettings.translateExtEnabled === true && typeof ctx.loadTranslateExtension === 'function') {
        try {
          const tabs = typeof ui?.getTabs === 'function' ? ui.getTabs() : null;
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
        validated: snapshot.validated === true || snapshot.licenseValidated === true,
        bound: snapshot.bound === true,
        validation: snapshot,
      };
    } catch (error) {
      console.error('[IPC] 消费自动验证标记失败:', error);
      return { ok: false, error: error.message, pending: false, key: '', deviceId: '' };
    }
  });

  ipcMain.handle('save-user-credentials', async (_event, { key, deviceId }) => {
    try {
      saveLicenseCredentialsSafe({
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
