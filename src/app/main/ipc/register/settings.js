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

const DEFAULT_BROWSER_WINDOW_NAME = '新建窗口';
const DEFAULT_BROWSER_WINDOW_URL = 'https://www.baidu.com/';

function readBrowserHistorySafe() {
  const store = readStoreConfigSafe();
  const source = Array.isArray(store?.browserHistory) ? store.browserHistory : [];
  const history = source.map((item) => ({
    ...(item && typeof item === 'object' ? item : {}),
    id: String(item?.id || '').trim(),
    name: String(item?.name || DEFAULT_BROWSER_WINDOW_NAME).trim() || DEFAULT_BROWSER_WINDOW_NAME,
    url: String(item?.url || '').trim(),
    partition: String(item?.partition || '').trim(),
    runtimeType: 'chromium',
    lastError: String(item?.lastError || '').trim(),
    settings: normalizeAiFreeBrowserSettings(item?.settings || {}),
    createdAt: Number(item?.createdAt || 0) || Date.now(),
    lastOpenedAt: Number(item?.lastOpenedAt || 0) || Number(item?.createdAt || 0) || Date.now(),
  })).filter((item) => item.id);
  if (source.some((item) => String(item?.runtimeType || '').trim() !== 'chromium')) {
    writeStoreConfigSafe({
      ...(store && typeof store === 'object' ? store : {}),
      browserHistory: history,
    });
  }
  return history;
}

function writeBrowserHistorySafe(history) {
  const currentStore = readStoreConfigSafe();
  return writeStoreConfigSafe({
    ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
    browserHistory: Array.isArray(history) ? history : [],
  });
}

function createBrowserHistoryId() {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeUniqueBrowserName(requestedName, history = [], excludeId = '') {
  const base = String(requestedName || '').trim() || DEFAULT_BROWSER_WINDOW_NAME;
  const occupied = new Set(history
    .filter((item) => String(item?.id || '') !== String(excludeId || ''))
    .map((item) => String(item?.name || '').trim().toLocaleLowerCase())
    .filter(Boolean));
  if (!occupied.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (occupied.has(`${base}[${suffix}]`.toLocaleLowerCase())) suffix += 1;
  return `${base}[${suffix}]`;
}

function getManagedTabUrl(tab) {
  return String(tab?.runtimeUrl || '').trim();
}

function syncOpenTabsToBrowserHistory(ui) {
  const history = readBrowserHistorySafe();
  const tabs = typeof ui?.getTabs === 'function' ? ui.getTabs() : new Map();
  let changed = false;
  for (const tab of tabs?.values?.() || []) {
    let historyId = String(tab?.browserHistoryId || '').trim();
    let record = history.find((item) => item.id === historyId);
    if (!record) {
      historyId = createBrowserHistoryId();
      const resolvedTitle = String(tab?.fixedTitle || tab?.runtimeTitle || '').trim();
      record = {
        id: historyId,
        name: makeUniqueBrowserName(resolvedTitle || DEFAULT_BROWSER_WINDOW_NAME, history),
        kind: tab?.isTutorialTab === true ? 'tutorial' : '',
        url: getManagedTabUrl(tab),
        partition: String(tab?.partition || '').trim(),
        runtimeType: 'chromium',
        settings: normalizeAiFreeBrowserSettings(tab?.browserSettings || {}),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      history.push(record);
      tab.browserHistoryId = historyId;
      changed = true;
    } else if (tab?.isTutorialTab === true && record.kind !== 'tutorial') {
      record.kind = 'tutorial';
      changed = true;
    }
  }
  if (changed) {
    writeBrowserHistorySafe(history);
    ui?.updateTabs?.(true);
  }
  return history;
}

function serializeBrowserHistory(history, ui) {
  const activeTabId = String(typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() || '' : '');
  const tabs = Array.from((typeof ui?.getTabs === 'function' ? ui.getTabs() : new Map()).values());
  return history
    .map((record) => {
      const openTab = tabs.find((tab) => String(tab?.browserHistoryId || '') === record.id) || null;
      const liveUrl = openTab ? getManagedTabUrl(openTab) : '';
      return {
        ...record,
        url: liveUrl || record.url,
        tabId: openTab ? String(openTab.id || '') : '',
        isOpen: !!openTab,
        isActive: !!openTab && String(openTab.id || '') === activeTabId,
      };
    })
    .sort((left, right) => Number(right.lastOpenedAt || 0) - Number(left.lastOpenedAt || 0));
}

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

  ipcMain.handle('get-browser-history', async () => {
    try {
      const history = syncOpenTabsToBrowserHistory(ui);
      const serialized = serializeBrowserHistory(history, ui);
      let changed = false;
      for (const item of serialized) {
        const record = history.find((entry) => entry.id === item.id);
        if (record && item.url && record.url !== item.url) {
          record.url = item.url;
          changed = true;
        }
      }
      if (changed) writeBrowserHistorySafe(history);
      return { ok: true, history: serialized };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), history: [] };
    }
  });

  ipcMain.handle('create-independent-browser', async (_event, payload = {}) => {
    let history = [];
    let record = null;
    try {
      if (typeof ui?.addTab !== 'function') throw new Error('新建浏览器窗口功能不可用');
      history = syncOpenTabsToBrowserHistory(ui);
      const store = readStoreConfigSafe();
      const settings = normalizeAiFreeBrowserSettings(payload?.settings || store?.aiFreeBrowserSettings || {});
      const id = createBrowserHistoryId();
      const name = makeUniqueBrowserName(payload?.name || DEFAULT_BROWSER_WINDOW_NAME, history);
      const url = settings.homepage?.mode === 'custom' && settings.homepage?.url
        ? settings.homepage.url
        : DEFAULT_BROWSER_WINDOW_URL;
      record = {
        id,
        name,
        url,
        partition: `persist:browser-window-${id.replace(/[^a-z0-9_-]/gi, '_')}`,
        runtimeType: 'chromium',
        settings,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      history.push(record);
      if (!writeBrowserHistorySafe(history)) throw new Error('浏览器历史未能写入本地配置');
      const tabId = `browser-tab-${id.replace(/[^a-z0-9_-]/gi, '_')}`;
      const creation = ui.addTab(record.url, {
        tabId,
        fixedTitle: record.name,
        browserHistoryId: record.id,
        partition: record.partition,
        runtimeType: 'chromium',
        browserSettings: record.settings,
        resolveProfileInBackground: true,
        showLoadingPage: true,
        // 新建后标签栏立即进入重命名状态。浏览器就绪时只切换画面，
        // 不得把键盘焦点从名称编辑框/侧栏交给 Chromium。
        focusBrowser: false,
      });
      void Promise.resolve(creation).then((createdTabId) => {
        if (!createdTabId) throw new Error('新建浏览器窗口失败');
        const latestHistory = readBrowserHistorySafe();
        const createdRecord = latestHistory.find((item) => item.id === record.id);
        if (createdRecord?.lastError) {
          createdRecord.lastError = '';
          writeBrowserHistorySafe(latestHistory);
        }
        ui.sendToSide?.('browser-history-changed');
      }).catch((error) => {
        console.error('[BrowserWindow] 后台创建独立浏览器失败:', error?.message || error);
        const latestHistory = readBrowserHistorySafe();
        const failedRecord = latestHistory.find((item) => item.id === record.id);
        if (failedRecord) {
          failedRecord.lastError = error?.message || String(error);
          writeBrowserHistorySafe(latestHistory);
        }
        const mainWindow = ui.getMainWindow?.();
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed?.()) {
          mainWindow.webContents.send('independent-browser-create-failed', {
            tabId,
            historyId: record.id,
            error: error?.message || String(error),
          });
        }
        ui.sendToSide?.('browser-history-changed');
      });
      ui.sendToSide?.('browser-history-changed');
      return { ok: true, pending: true, tabId, historyId: record.id, name: record.name };
    } catch (error) {
      if (record) writeBrowserHistorySafe(history.filter((item) => item.id !== record.id));
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('open-browser-history', async (_event, payload = {}) => {
    try {
      const history = syncOpenTabsToBrowserHistory(ui);
      const historyId = String(payload?.historyId || '').trim();
      const record = history.find((item) => item.id === historyId);
      if (!record) throw new Error('浏览器历史不存在');
      const openTab = Array.from(ui?.getTabs?.().values?.() || [])
        .find((tab) => String(tab?.browserHistoryId || '') === historyId);
      let tabId = openTab?.id;
      if (tabId) {
        ui.switchTab?.(tabId);
      } else {
        tabId = await ui.addTab(record.url || DEFAULT_BROWSER_WINDOW_URL, {
          fixedTitle: record.name,
          browserHistoryId: record.id,
          partition: record.partition,
          runtimeType: 'chromium',
          browserSettings: record.settings,
          resolveProfileInBackground: true,
          showLoadingPage: true,
        });
      }
      record.lastOpenedAt = Date.now();
      writeBrowserHistorySafe(history);
      ui.sendToSide?.('browser-history-changed');
      return { ok: true, tabId: String(tabId || ''), historyId, name: record.name };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('rename-browser-history', async (_event, payload = {}) => {
    try {
      const history = syncOpenTabsToBrowserHistory(ui);
      const historyId = String(payload?.historyId || '').trim();
      const record = history.find((item) => item.id === historyId);
      if (!record) throw new Error('浏览器历史不存在');
      const name = makeUniqueBrowserName(payload?.name, history, historyId);
      record.name = name;
      if (!writeBrowserHistorySafe(history)) throw new Error('浏览器名称未能保存');
      const openTab = Array.from(ui?.getTabs?.().values?.() || [])
        .find((tab) => String(tab?.browserHistoryId || '') === historyId);
      if (openTab?.id && typeof ui?.renameTab === 'function') ui.renameTab(openTab.id, name);
      ui.sendToSide?.('browser-history-changed');
      return { ok: true, historyId, name, tabId: String(openTab?.id || '') };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('delete-browser-history', async (_event, payload = {}) => {
    try {
      const history = syncOpenTabsToBrowserHistory(ui);
      const historyId = String(payload?.historyId || '').trim();
      const record = history.find((item) => item.id === historyId);
      if (!record) throw new Error('浏览器历史不存在');

      const openTab = Array.from(ui?.getTabs?.().values?.() || [])
        .find((tab) => String(tab?.browserHistoryId || '') === historyId);
      if (openTab?.id) {
        if (typeof ui?.closeTab !== 'function') throw new Error('当前浏览器窗口无法关闭');
        await ui.closeTab(openTab.id);
      }

      const latestHistory = readBrowserHistorySafe();
      const nextHistory = latestHistory.filter((item) => item.id !== historyId);
      if (nextHistory.length === latestHistory.length) throw new Error('浏览器历史不存在');
      if (!writeBrowserHistorySafe(nextHistory)) throw new Error('浏览器历史未能删除');

      ui.sendToSide?.('browser-history-changed');
      return {
        ok: true,
        historyId,
        name: record.name,
        closed: !!openTab?.id,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('get-ai-free-browser-settings', async (_event, payload = {}) => {
    try {
      const store = readStoreConfigSafe();
      const historyId = String(payload?.historyId || '').trim();
      const history = historyId ? syncOpenTabsToBrowserHistory(ui) : [];
      const historyRecord = history.find((item) => item.id === historyId) || null;
      const saved = historyRecord?.settings || (store?.aiFreeBrowserSettings && typeof store.aiFreeBrowserSettings === 'object'
        ? store.aiFreeBrowserSettings
        : DEFAULT_AI_FREE_BROWSER_SETTINGS);
      const settings = normalizeAiFreeBrowserSettings(saved);
      const historyTab = historyRecord
        ? Array.from(ui?.getTabs?.().values?.() || []).find((tab) => String(tab?.browserHistoryId || '') === historyId)
        : null;
      const activeTabId = historyTab?.id || (typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() : null);
      const activeTab = typeof ui?.getTabs === 'function' ? ui.getTabs()?.get?.(activeTabId) : null;
      return {
        ok: true,
        settings,
        historyId: historyRecord?.id || '',
        runtimeInfo: getBrowserRuntimeInfo(),
        activeTab: activeTab ? {
          id: String(activeTab.id || ''),
          title: String(activeTab.fixedTitle || activeTab.runtimeTitle || '当前环境'),
          runtimeType: 'chromium',
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
      const historyId = String(payload?.historyId || '').trim();
      let targetTabId = null;
      if (historyId) {
        const history = syncOpenTabsToBrowserHistory(ui);
        const record = history.find((item) => item.id === historyId);
        if (!record) return { ok: false, error: '浏览器历史不存在' };
        record.settings = settings;
        if (!writeBrowserHistorySafe(history)) return { ok: false, error: '独立浏览器参数未能写入本地配置' };
        targetTabId = Array.from(ui?.getTabs?.().values?.() || [])
          .find((tab) => String(tab?.browserHistoryId || '') === historyId)?.id || null;
      } else {
        const currentStore = readStoreConfigSafe();
        const wrote = writeStoreConfigSafe({
          ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
          aiFreeBrowserSettings: settings,
        });
        if (!wrote) return { ok: false, error: '参数未能写入本地配置' };
        if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
          licenseCache.setRuntimeConfig({ browserSettings: settings });
        }
      }

      let activeResult = null;
      const activeTabId = historyId
        ? targetTabId
        : (typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() : null);
      if (payload?.applyToActive !== false && activeTabId && typeof ui?.setTabBrowserSettings === 'function') {
        activeResult = await ui.setTabBrowserSettings(activeTabId, settings, {
          restartChromium: payload?.restartChromium === true,
        });
      }
      ui.sendToSide?.('browser-history-changed');
      return { ok: true, settings, historyId, activeResult, runtimeInfo: getBrowserRuntimeInfo() };
    } catch (error) {
      console.error('[IPC] 保存 AI-FREE 浏览器参数失败:', error);
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('reset-ai-free-browser-settings', async (_event, payload = {}) => {
    try {
      const settings = normalizeAiFreeBrowserSettings({});
      const historyId = String(payload?.historyId || '').trim();
      let targetTabId = null;
      if (historyId) {
        const history = syncOpenTabsToBrowserHistory(ui);
        const record = history.find((item) => item.id === historyId);
        if (!record) return { ok: false, error: '浏览器历史不存在' };
        record.settings = settings;
        if (!writeBrowserHistorySafe(history)) return { ok: false, error: '独立浏览器默认参数未能写入本地配置' };
        targetTabId = Array.from(ui?.getTabs?.().values?.() || [])
          .find((tab) => String(tab?.browserHistoryId || '') === historyId)?.id || null;
      } else {
        const currentStore = readStoreConfigSafe();
        const wrote = writeStoreConfigSafe({
          ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
          aiFreeBrowserSettings: settings,
        });
        if (!wrote) return { ok: false, error: '默认参数未能写入本地配置' };
        licenseCache?.setRuntimeConfig?.({ browserSettings: settings });
      }
      let activeResult = null;
      const activeTabId = historyId
        ? targetTabId
        : (typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() : null);
      if (payload?.applyToActive !== false && activeTabId && typeof ui?.setTabBrowserSettings === 'function') {
        activeResult = await ui.setTabBrowserSettings(activeTabId, settings, {
          restartChromium: payload?.restartChromium === true,
        });
      }
      ui.sendToSide?.('browser-history-changed');
      return { ok: true, settings, historyId, activeResult, runtimeInfo: getBrowserRuntimeInfo() };
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

module.exports = {
  makeUniqueBrowserName,
  registerSettingsIPC,
};
