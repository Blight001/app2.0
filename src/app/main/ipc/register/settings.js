const path = require('path');
const { BrowserWindow, ipcMain, net, screen, session: electronSession } = require('electron');
const fs = require('fs');
const { getStorePath } = require('../../config');
const accountStorage = require('../../lib/account-storage');
const { buildManagedTabPartitionName } = require('../../services/tab-common');
const { resolveRecycleTimestamp } = require('../../utils/accountCleanup');
const {
  getCurrentAccountTypeLabel,
  resolveCurrentAccountType,
} = require('../../utils/normalizers');
const {
  readStoreConfigSafe,
  saveLicenseCredentialsSafe,
  toFiniteNumber,
  writeStoreConfigSafe,
} = require('./store-utils');
const {
  DEFAULT_AI_FREE_BROWSER_SETTINGS,
  normalizeAiFreeBrowserSettings,
} = require('../../utils/ai-free-browser-settings');
const {
  DEFAULT_AI_CONTROL_MCP_CALL_LIMIT,
  MIN_AI_CONTROL_MCP_CALL_LIMIT,
  MAX_AI_CONTROL_MCP_CALL_LIMIT,
  getCustomAiApiConfig,
  getAiControlMcpCallLimit,
  normalizeCustomAiApiConfig,
  normalizeAiControlMcpCallLimit,
  toPublicCustomAiApiConfig,
} = require('../../utils/ai-control-settings');
const { FREE_BROWSER_WINDOW_LIMIT, createVipRequiredResult, resolveVipAccess } = require('../../utils/vip-access');

const getBrowserRuntimeInfo = () => ({
  chromiumVersion: String(process.versions?.chrome || ''),
  electronVersion: String(process.versions?.electron || ''),
});

const DEFAULT_BROWSER_WINDOW_NAME = '新建窗口';
const DEFAULT_BROWSER_WINDOW_URL = 'chrome://newtab/';

function readBrowserHistorySafe() {
  const store = readStoreConfigSafe();
  const source = Array.isArray(store?.browserHistory) ? store.browserHistory : [];
  const history = source.map((item) => ({
    ...(item && typeof item === 'object' ? item : {}),
    id: String(item?.id || '').trim(),
    name: String(item?.name || DEFAULT_BROWSER_WINDOW_NAME).trim() || DEFAULT_BROWSER_WINDOW_NAME,
    url: String(item?.url || '').trim(),
    profileId: String(item?.profileId || '').trim(),
    accountId: String(item?.accountId || '').trim(),
    ...(String(item?.partition || '').trim()
      ? { partition: String(item.partition).trim() }
      : {}),
    runtimeType: 'chromium',
    lastError: String(item?.lastError || '').trim(),
    settings: normalizeAiFreeBrowserSettings(item?.settings || {}),
    createdAt: Number(item?.createdAt || 0) || Date.now(),
    lastOpenedAt: Number(item?.lastOpenedAt || 0) || Number(item?.createdAt || 0) || Date.now(),
  })).filter((item) => item.id);
  let changed = source.some((item) => String(item?.runtimeType || '').trim() !== 'chromium');
  try {
    const summaries = typeof accountStorage.getAllAccounts === 'function'
      ? accountStorage.getAllAccounts()
      : [];
    const accountByLegacyPartition = new Map(summaries.map((summary) => [
      `persist:${buildManagedTabPartitionName(summary?.id)}`,
      summary,
    ]));
    const accountById = new Map(summaries.map((summary) => [
      String(summary?.id || '').trim(),
      summary,
    ]));
    for (const record of history) {
      if (!record.accountId) {
        // partition 只用于把旧索引迁移到 accountId，迁移完成后立即移除。
        const summary = accountById.get(record.profileId)
          || accountByLegacyPartition.get(record.partition);
        const accountId = String(summary?.id || '').trim();
        if (accountId) {
          const accountResult = accountStorage.getAccount(accountId);
          const account = accountResult?.ok ? accountResult.account : null;
          if (!record.profileId) record.profileId = accountId;
          record.accountId = accountId;
          if (!record.url && account?.currentUrl) record.url = String(account.currentUrl).trim();
          changed = true;
        }
      }
      if (record.partition) {
        delete record.partition;
        changed = true;
      }
    }
  } catch (_) {}
  if (changed) {
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
  const runtimeUrl = String(tab?.runtimeUrl || '').trim();
  if (runtimeUrl && runtimeUrl !== 'about:blank' && !runtimeUrl.startsWith('data:text/html')) {
    return runtimeUrl;
  }
  return String(tab?.requestedUrl || '').trim();
}

function syncOpenTabsToBrowserHistory(ui) {
  const history = readBrowserHistorySafe();
  const tabs = typeof ui?.getTabs === 'function' ? ui.getTabs() : new Map();
  let changed = false;
  for (const tab of tabs?.values?.() || []) {
    let historyId = String(tab?.browserHistoryId || '').trim();
    let record = history.find((item) => item.id === historyId);
    const accountId = String(tab?.accountId || '').trim();
    const profileId = String(tab?.id || '').trim();
    // 账号浏览器以 accountId/profileId 绑定历史，避免继续依赖旧 Electron
    // partition，也避免重开同一账号时生成第二条记录。
    if (!record && accountId) {
      record = history.find((item) => (
        String(item?.accountId || '').trim() === accountId
        || String(item?.profileId || '').trim() === profileId
      )) || null;
      if (record) historyId = record.id;
    }
    if (!record) {
      historyId = createBrowserHistoryId();
      const resolvedTitle = String(tab?.fixedTitle || tab?.runtimeTitle || '').trim();
      record = {
        id: historyId,
        name: makeUniqueBrowserName(resolvedTitle || DEFAULT_BROWSER_WINDOW_NAME, history),
        kind: tab?.isTutorialTab === true ? 'tutorial' : '',
        url: getManagedTabUrl(tab),
        profileId,
        accountId,
        runtimeType: 'chromium',
        settings: normalizeAiFreeBrowserSettings(tab?.browserSettings || {}),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      history.push(record);
      tab.browserHistoryId = historyId;
      changed = true;
    } else {
      const liveUrl = getManagedTabUrl(tab);
      const updates = {
        profileId,
        accountId,
        ...(liveUrl ? { url: liveUrl } : {}),
        ...(tab?.isTutorialTab === true ? { kind: 'tutorial' } : {}),
      };
      for (const [field, value] of Object.entries(updates)) {
        if (record[field] === value) continue;
        record[field] = value;
        changed = true;
      }
      if (tab.browserHistoryId !== historyId) {
        tab.browserHistoryId = historyId;
        changed = true;
      }
    }
  }
  if (changed) {
    writeBrowserHistorySafe(history);
    ui?.updateTabs?.(true);
  }
  return history;
}

function buildBrowserHistoryAccountMeta(account = {}) {
  const accountId = String(account?.id || '').trim();
  if (!accountId) return null;
  const accountType = resolveCurrentAccountType(
    account?.currentAccountType || account?.current_account_type,
    account?.currentAccountTypeLabel || account?.current_account_type_label,
  );
  const accountTypeLabel = String(
    account?.currentAccountTypeLabel
    || account?.current_account_type_label
    || getCurrentAccountTypeLabel(accountType)
    || '',
  ).trim();
  return {
    accountDisplayName: String(account?.displayName || account?.accountName || accountId).trim() || accountId,
    accountPlatform: String(account?.platform || account?.platformName || '').trim(),
    accountType,
    accountTypeLabel,
    autoDeleteAt: accountType === 'shared' ? resolveRecycleTimestamp(account) : null,
  };
}

function serializeBrowserHistory(history, ui) {
  const activeTabId = String(typeof ui?.getActiveTabId === 'function' ? ui.getActiveTabId() || '' : '');
  const tabs = Array.from((typeof ui?.getTabs === 'function' ? ui.getTabs() : new Map()).values());
  const accountMetaById = new Map(
    (typeof accountStorage.getAllAccounts === 'function' ? accountStorage.getAllAccounts() : [])
      .map((account) => [String(account?.id || '').trim(), buildBrowserHistoryAccountMeta(account)])
      .filter(([accountId, meta]) => accountId && meta),
  );
  return history
    .map((record) => {
      const openTab = tabs.find((tab) => String(tab?.browserHistoryId || '') === record.id) || null;
      const liveUrl = openTab ? getManagedTabUrl(openTab) : '';
      return {
        ...record,
        ...(accountMetaById.get(String(record.accountId || '').trim()) || {}),
        url: liveUrl || record.url,
        tabId: openTab ? String(openTab.id || '') : '',
        isOpen: !!openTab,
        isActive: !!openTab && String(openTab.id || '') === activeTabId,
      };
    })
    .sort((left, right) => Number(right.lastOpenedAt || 0) - Number(left.lastOpenedAt || 0));
}

// 打开一条浏览器窗口记录（已打开则切换激活）。被 open-browser-history IPC
// 和 AI 默认窗口工具（services/ai-browser-window-tools）共用，改动需两边兼容。
async function openBrowserHistoryRecord(ui, historyIdInput) {
  const history = syncOpenTabsToBrowserHistory(ui);
  const historyId = String(historyIdInput || '').trim();
  const record = history.find((item) => item.id === historyId);
  if (!record) throw new Error('浏览器历史不存在');
  const openTab = Array.from(ui?.getTabs?.().values?.() || [])
    .find((tab) => (
      String(tab?.browserHistoryId || '') === historyId
      || (!!record.profileId && String(tab?.id || '') === record.profileId)
      || (!!record.accountId && String(tab?.accountId || '') === record.accountId)
    ));
  let tabId = openTab?.id;
  if (tabId) {
    ui.switchTab?.(tabId);
  } else {
    tabId = record.profileId
      || record.accountId
      || `browser-tab-${record.id.replace(/[^a-z0-9_-]/gi, '_')}`;
    const openUrl = record.url || (record.accountId ? 'about:blank' : DEFAULT_BROWSER_WINDOW_URL);
    tabId = await ui.addTab(openUrl, {
      tabId,
      accountId: record.accountId,
      fixedTitle: record.name,
      browserHistoryId: record.id,
      runtimeType: 'chromium',
      browserSettings: record.settings,
      resolveProfileInBackground: true,
      showLoadingPage: true,
      restoreLastSession: true,
    });
  }
  record.lastOpenedAt = Date.now();
  writeBrowserHistorySafe(history);
  ui.sendToSide?.('browser-history-changed');
  return {
    ok: true,
    tabId: String(tabId || ''),
    historyId,
    name: record.name,
    alreadyOpen: !!openTab?.id,
  };
}

// 重命名一条浏览器窗口记录（同时同步已打开标签页标题）。与 rename-browser-history IPC 共用。
function renameBrowserHistoryRecord(ui, historyIdInput, requestedName) {
  const history = syncOpenTabsToBrowserHistory(ui);
  const historyId = String(historyIdInput || '').trim();
  const record = history.find((item) => item.id === historyId);
  if (!record) throw new Error('浏览器历史不存在');
  const name = makeUniqueBrowserName(requestedName, history, historyId);
  record.name = name;
  if (!writeBrowserHistorySafe(history)) throw new Error('浏览器名称未能保存');
  const openTab = Array.from(ui?.getTabs?.().values?.() || [])
    .find((tab) => String(tab?.browserHistoryId || '') === historyId);
  if (openTab?.id && typeof ui?.renameTab === 'function') ui.renameTab(openTab.id, name);
  ui.sendToSide?.('browser-history-changed');
  return { ok: true, historyId, name, tabId: String(openTab?.id || '') };
}

function collectBrowserProfileReferences(history = [], ui = null) {
  const references = new Set();
  const remember = (value) => {
    const id = String(value || '').trim();
    if (id) references.add(id);
  };
  for (const record of history) {
    remember(record?.profileId);
    remember(record?.accountId);
  }
  for (const tab of ui?.getTabs?.()?.values?.() || []) {
    remember(tab?.id);
    remember(tab?.accountId);
  }
  try {
    for (const account of accountStorage.getAllAccounts?.() || []) remember(account?.id);
  } catch (_) {}
  return Array.from(references);
}

function auditBrowserProfiles(history = [], ui = null) {
  const store = ui?.browserRuntimeManager?.store;
  if (!store || typeof store.auditProfiles !== 'function') return null;
  return store.auditProfiles(collectBrowserProfileReferences(history, ui));
}

function cleanupOrphanBrowserProfiles(history = [], ui = null, storageIds = []) {
  const audit = auditBrowserProfiles(history, ui);
  if (!audit) return null;
  const requestedStorageIds = new Set((Array.isArray(storageIds) ? storageIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean));
  const targets = audit.orphanProfiles.filter((profile) => (
    requestedStorageIds.size === 0 || requestedStorageIds.has(profile.storageId)
  ));
  const deleted = [];
  const failed = [];
  for (const profile of targets) {
    const deleteId = profile.profileId || profile.storageId;
    try {
      ui.browserRuntimeManager.deleteProfile(deleteId);
      deleted.push(profile.storageId);
    } catch (error) {
      failed.push({ storageId: profile.storageId, error: error?.message || String(error) });
    }
  }
  return {
    ok: failed.length === 0,
    deletedCount: deleted.length,
    failedCount: failed.length,
    deleted,
    failed,
    profileAudit: auditBrowserProfiles(history, ui),
  };
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
  let independentBrowserCreation = null;
  let browserHistoryGestureWindow = null;
  let browserHistoryGestureSelectedId = '';

  const closeBrowserHistoryGestureWindow = () => {
    const popup = browserHistoryGestureWindow;
    browserHistoryGestureWindow = null;
    browserHistoryGestureSelectedId = '';
    if (!popup || popup.isDestroyed()) return;
    try { popup.close(); } catch (_) {}
  };

  const buildBrowserHistoryGestureHtml = (history = [], theme = 'dark') => {
    const safeHistoryJson = JSON.stringify(Array.isArray(history) ? history : []).replace(/</g, '\\u003c');
    const lightTheme = String(theme || '').trim() === 'light';
    return `<!DOCTYPE html>
<html class="${lightTheme ? 'light' : 'dark'}">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .panel { width: 100%; height: 100%; padding: 7px; border: 1px solid rgba(90,164,255,.42); border-radius: 10px; background: rgba(17,22,32,.98); color: #e6e8ee; box-shadow: 0 18px 46px rgba(0,0,0,.48), inset 0 0 0 1px rgba(255,255,255,.04); }
    .light .panel { border-color: rgba(47,127,230,.28); background: rgba(255,255,255,.98); color: #1f3044; box-shadow: 0 18px 42px rgba(45,79,122,.20), inset 0 0 0 1px rgba(255,255,255,.72); }
    .title { height: 27px; padding: 3px 8px 8px; color: #9aa3b2; font-size: 11px; line-height: 16px; }
    .light .title, .light .url, .light .state { color: #6a7c91; }
    .item { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 3px 10px; width: 100%; height: 48px; padding: 7px 9px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: inherit; text-align: left; }
    .item + .item { margin-top: 3px; }
    .item.selected { border-color: rgba(77,163,255,.56); background: rgba(77,163,255,.22); box-shadow: 0 5px 16px rgba(25,102,196,.16); }
    .light .item.selected { border-color: rgba(47,127,230,.38); background: rgba(47,127,230,.12); }
    .name, .url { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name { align-self: end; font-size: 13px; font-weight: 600; }
    .url { grid-column: 1 / -1; color: #9aa3b2; font-size: 10px; }
    .state { align-self: end; color: #9aa3b2; font-size: 10px; }
    .state.open { color: #43bd70; }
    .message { padding: 20px 12px; color: #9aa3b2; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="panel">
    <div class="title">拖到浏览器上，松开即可打开</div>
    <div id="items"></div>
  </div>
  <script>
    const history = ${safeHistoryJson};
    const items = document.getElementById('items');
    if (!history.length) {
      const message = document.createElement('div');
      message.className = 'message';
      message.textContent = '暂无可打开的浏览器历史';
      items.appendChild(message);
    } else {
      for (const record of history) {
        const item = document.createElement('div');
        item.className = 'item';
        item.dataset.historyId = String(record.id || '');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = String(record.name || '新建窗口');
        const state = document.createElement('span');
        state.className = 'state' + (record.isOpen ? ' open' : '');
        state.textContent = record.isActive ? '当前' : (record.isOpen ? '已打开' : '历史');
        const url = document.createElement('span');
        url.className = 'url';
        url.textContent = String(record.url || 'chrome://newtab/');
        item.append(name, state, url);
        items.appendChild(item);
      }
    }
    window.electronAPI?.on('browser-history-gesture-selection', (historyId) => {
      document.querySelectorAll('.item').forEach((item) => item.classList.toggle('selected', item.dataset.historyId === String(historyId || '')));
    });
  </script>
</body>
</html>`;
  };

  const showBrowserHistoryGestureWindow = (payload = {}) => {
    closeBrowserHistoryGestureWindow();
    const mainWindow = ui?.getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed?.()) return { ok: false, error: '主窗口不可用' };

    const contentBounds = mainWindow.getContentBounds();
    const anchor = payload?.anchor && typeof payload.anchor === 'object' ? payload.anchor : {};
    const sourceHistory = Array.isArray(payload?.history) ? payload.history.filter((item) => item?.id) : [];
    const popupWidth = Math.max(220, Math.min(320, contentBounds.width - 16));
    const anchorLeft = Number.isFinite(Number(anchor.left)) ? Number(anchor.left) : 8;
    const anchorRight = Number.isFinite(Number(anchor.right)) ? Number(anchor.right) : anchorLeft + 30;
    const anchorBottom = Number.isFinite(Number(anchor.bottom)) ? Number(anchor.bottom) : 35;
    const anchorCenterX = (anchorLeft + anchorRight) / 2;
    const desiredX = contentBounds.x + anchorCenterX - popupWidth / 2;
    const desiredY = contentBounds.y + anchorBottom + 6;
    const display = screen.getDisplayNearestPoint({ x: desiredX, y: desiredY });
    const maxBottom = Math.min(contentBounds.y + contentBounds.height - 8, display.workArea.y + display.workArea.height - 8);
    const availableHeight = Math.max(86, maxBottom - desiredY);
    const maxRows = Math.max(1, Math.floor((availableHeight - 48) / 51));
    const visibleHistory = sourceHistory.slice(0, maxRows);
    const popupHeight = visibleHistory.length
      ? Math.min(availableHeight, 48 + visibleHistory.length * 48 + Math.max(0, visibleHistory.length - 1) * 3)
      : Math.min(availableHeight, 92);
    const workAreaLeft = display.workArea.x + 8;
    const workAreaRight = display.workArea.x + display.workArea.width - 8;
    const x = Math.max(workAreaLeft, Math.min(desiredX, workAreaRight - popupWidth));
    const y = desiredY;
    const layout = {
      x: x - contentBounds.x,
      y: y - contentBounds.y,
      width: popupWidth,
      height: popupHeight,
      rows: visibleHistory.map((item, index) => ({
        id: String(item.id || ''),
        top: 34 + index * 51,
        bottom: 34 + index * 51 + 48,
      })),
    };

    const popup = new BrowserWindow({
      parent: mainWindow,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(popupWidth),
      height: Math.round(popupHeight),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        devTools: false,
        preload: path.join(__dirname, '../../preload.js'),
      },
    });
    browserHistoryGestureWindow = popup;
    popup.setIgnoreMouseEvents(true);
    popup.on('closed', () => {
      if (browserHistoryGestureWindow === popup) browserHistoryGestureWindow = null;
    });
    popup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildBrowserHistoryGestureHtml(visibleHistory, payload?.theme))}`);
    popup.once('ready-to-show', () => {
      if (browserHistoryGestureWindow !== popup || popup.isDestroyed()) return;
      try {
        popup.showInactive();
        popup.webContents.send('browser-history-gesture-selection', browserHistoryGestureSelectedId);
      } catch (_) {}
    });
    return { ok: true, layout };
  };

  try {
    const startupCleanupResult = cleanupOrphanBrowserProfiles(readBrowserHistorySafe(), ui);
    if (startupCleanupResult?.failedCount > 0) {
      console.warn('[IPC] 启动时自动清理孤立 Chromium 环境失败:', startupCleanupResult.failed);
    }
  } catch (error) {
    console.warn('[IPC] 启动时无法自动清理孤立 Chromium 环境:', error?.message || error);
  }

  ipcMain.handle('get-ai-control-settings', async () => {
    try {
      return {
        ok: true,
        settings: {
          mcpCallLimit: getAiControlMcpCallLimit(readStoreConfigSafe()),
        },
        defaults: {
          mcpCallLimit: DEFAULT_AI_CONTROL_MCP_CALL_LIMIT,
        },
        limits: {
          mcpCallLimit: {
            min: MIN_AI_CONTROL_MCP_CALL_LIMIT,
            max: MAX_AI_CONTROL_MCP_CALL_LIMIT,
          },
        },
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('set-ai-control-settings', async (_event, payload = {}) => {
    try {
      const rawLimit = payload?.mcpCallLimit;
      if (!Number.isFinite(Number(rawLimit))) throw new Error('MCP 调用上限必须是有效数字');
      const mcpCallLimit = normalizeAiControlMcpCallLimit(rawLimit);
      const currentStore = readStoreConfigSafe();
      const wrote = writeStoreConfigSafe({
        ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
        aiControlSettings: {
          ...(currentStore?.aiControlSettings && typeof currentStore.aiControlSettings === 'object'
            ? currentStore.aiControlSettings
            : {}),
          mcpCallLimit,
        },
      });
      if (!wrote) throw new Error('AI 控制设置未能写入本地配置');
      return { ok: true, settings: { mcpCallLimit } };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('get-ai-control-custom-api', async () => {
    try {
      if (!resolveVipAccess(licenseCache?.getSnapshot?.() || {}).isVip) {
        return createVipRequiredResult('自定义模型');
      }
      const config = getCustomAiApiConfig(readStoreConfigSafe());
      return { ok: true, config: toPublicCustomAiApiConfig(config) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('set-ai-control-custom-api', async (_event, payload = {}) => {
    try {
      if (payload?.clear !== true && !resolveVipAccess(licenseCache?.getSnapshot?.() || {}).isVip) {
        return createVipRequiredResult('自定义模型');
      }
      const currentStore = readStoreConfigSafe();
      const previous = getCustomAiApiConfig(currentStore);
      const clear = payload?.clear === true;
      const next = normalizeCustomAiApiConfig(clear ? {} : {
        enabled: payload?.enabled !== false,
        name: payload?.name,
        baseUrl: payload?.baseUrl,
        model: payload?.model,
        apiKey: Object.prototype.hasOwnProperty.call(payload, 'apiKey')
          ? payload.apiKey
          : previous.apiKey,
      });
      if (!clear) {
        if (!next.baseUrl) throw new Error('请输入自定义 API 地址');
        if (!/^https?:\/\//i.test(next.baseUrl)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
        if (!next.model) throw new Error('请输入模型名称');
      }
      const wrote = writeStoreConfigSafe({
        ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
        aiControlSettings: {
          ...(currentStore?.aiControlSettings && typeof currentStore.aiControlSettings === 'object'
            ? currentStore.aiControlSettings
            : {}),
          customApi: next,
        },
      });
      if (!wrote) throw new Error('自定义 API 未能写入本地配置');
      return { ok: true, config: toPublicCustomAiApiConfig(next) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

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
      const cleanupResult = cleanupOrphanBrowserProfiles(history, ui);
      if (cleanupResult?.failedCount > 0) {
        console.warn('[IPC] 自动清理孤立 Chromium 环境失败:', cleanupResult.failed);
      }
      const profileAudit = cleanupResult?.profileAudit || auditBrowserProfiles(history, ui);
      return {
        ok: true,
        history: serialized,
        profileAudit: profileAudit ? {
          totalCount: profileAudit.totalCount,
          referencedCount: profileAudit.referencedCount,
          orphanCount: profileAudit.orphanCount,
        } : null,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), history: [] };
    }
  });

  ipcMain.handle('show-browser-history-gesture-popup', async (_event, payload = {}) => {
    try {
      return showBrowserHistoryGestureWindow(payload);
    } catch (error) {
      closeBrowserHistoryGestureWindow();
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.on('update-browser-history-gesture-popup-selection', (_event, payload = {}) => {
    browserHistoryGestureSelectedId = String(payload?.historyId || '');
    const popup = browserHistoryGestureWindow;
    if (!popup || popup.isDestroyed()) return;
    try { popup.webContents.send('browser-history-gesture-selection', browserHistoryGestureSelectedId); } catch (_) {}
  });

  ipcMain.on('close-browser-history-gesture-popup', () => closeBrowserHistoryGestureWindow());

  ipcMain.handle('cleanup-orphan-browser-profiles', async (_event, payload = {}) => {
    try {
      if (payload?.confirm !== true) throw new Error('清理孤儿 Profile 需要明确确认');
      const history = syncOpenTabsToBrowserHistory(ui);
      const result = cleanupOrphanBrowserProfiles(history, ui, payload?.storageIds);
      if (!result) throw new Error('Chromium Profile 管理器不可用');
      return result;
    } catch (error) {
      return { ok: false, error: error?.message || String(error), deletedCount: 0 };
    }
  });

  ipcMain.handle('create-independent-browser', async (_event, payload = {}) => {
    if (!resolveVipAccess(licenseCache?.getSnapshot?.() || {}).isVip
      && Number(ui?.getTabs?.()?.size || 0) >= FREE_BROWSER_WINDOW_LIMIT) {
      ui?.sendToSide?.('vip-access-required', { feature: '更多独立浏览器窗口', limit: FREE_BROWSER_WINDOW_LIMIT });
      return {
        ...createVipRequiredResult('更多独立浏览器窗口'),
        error: `普通用户最多同时打开 ${FREE_BROWSER_WINDOW_LIMIT} 个独立浏览器窗口，请前往个人中心开通 VIP`,
      };
    }
    if (independentBrowserCreation) {
      return {
        ...independentBrowserCreation.response,
        deduplicated: true,
      };
    }
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
        runtimeType: 'chromium',
        browserSettings: record.settings,
        resolveProfileInBackground: true,
        showLoadingPage: true,
        // 新建后标签栏立即进入重命名状态。浏览器就绪时只切换画面，
        // 不得把键盘焦点从名称编辑框/侧栏交给 Chromium。
        focusBrowser: false,
      });
      const response = {
        ok: true,
        pending: true,
        tabId,
        historyId: record.id,
        name: record.name,
      };
      const creationToken = {};
      independentBrowserCreation = { response, token: creationToken };
      void Promise.resolve(creation).then((createdTabId) => {
        if (!createdTabId) throw new Error('新建浏览器窗口失败');
        const latestHistory = readBrowserHistorySafe();
        const createdRecord = latestHistory.find((item) => item.id === record.id);
        if (createdRecord?.lastError) {
          createdRecord.lastError = '';
          writeBrowserHistorySafe(latestHistory);
        }
        ui.sendToSide?.('browser-history-changed');
        const mainWindow = ui.getMainWindow?.();
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed?.()) {
          mainWindow.webContents.send('independent-browser-create-complete', {
            tabId,
            historyId: record.id,
          });
        }
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
      }).finally(() => {
        if (independentBrowserCreation?.token === creationToken) {
          independentBrowserCreation = null;
        }
      });
      ui.sendToSide?.('browser-history-changed');
      return response;
    } catch (error) {
      if (record) writeBrowserHistorySafe(history.filter((item) => item.id !== record.id));
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('open-browser-history', async (_event, payload = {}) => {
    try {
      return await openBrowserHistoryRecord(ui, payload?.historyId);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('rename-browser-history', async (_event, payload = {}) => {
    try {
      return renameBrowserHistoryRecord(ui, payload?.historyId, payload?.name);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('rename-browser-history-batch', async (_event, payload = {}) => {
    try {
      const history = syncOpenTabsToBrowserHistory(ui);
      const historyIds = [...new Set((Array.isArray(payload?.historyIds) ? payload.historyIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))];
      if (!historyIds.length) throw new Error('请先选择浏览器记录');
      const selectedRecords = historyIds.map((historyId) => {
        const record = history.find((item) => item.id === historyId);
        if (!record) throw new Error('部分浏览器历史已不存在，请刷新后重试');
        return record;
      });
      const baseName = String(payload?.baseName || '').trim() || DEFAULT_BROWSER_WINDOW_NAME;
      const selectedIdSet = new Set(historyIds);
      const occupied = new Set(history
        .filter((item) => !selectedIdSet.has(item.id))
        .map((item) => String(item?.name || '').trim().toLocaleLowerCase())
        .filter(Boolean));
      const nextNames = selectedRecords.map((_record, index) => (
        selectedRecords.length === 1 ? baseName : `${baseName}[${index + 1}]`
      ));
      const conflictedName = nextNames.find((name) => occupied.has(name.toLocaleLowerCase()));
      if (conflictedName) throw new Error(`名称“${conflictedName}”已存在，请换一个名称前缀`);

      selectedRecords.forEach((record, index) => { record.name = nextNames[index]; });
      if (!writeBrowserHistorySafe(history)) throw new Error('浏览器名称未能保存');
      const openTabs = Array.from(ui?.getTabs?.().values?.() || []);
      selectedRecords.forEach((record, index) => {
        const openTab = openTabs.find((tab) => String(tab?.browserHistoryId || '') === record.id);
        if (openTab?.id && typeof ui?.renameTab === 'function') ui.renameTab(openTab.id, nextNames[index]);
      });
      ui.sendToSide?.('browser-history-changed');
      return {
        ok: true,
        renamed: selectedRecords.map((record, index) => ({ historyId: record.id, name: nextNames[index] })),
      };
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

      const profileId = String(record.profileId || openTab?.id || '').trim();
      let profileDeleted = false;
      if (profileId && ui?.browserRuntimeManager?.deleteProfile) {
        try {
          profileDeleted = ui.browserRuntimeManager.deleteProfile(profileId) === true;
        } catch (error) {
          // 索引已删除但 Profile 删除失败时必须显式报错，不能继续制造无主目录。
          writeBrowserHistorySafe(latestHistory);
          throw new Error(`Chromium Profile 删除失败: ${error?.message || error}`);
        }
      }

      ui.sendToSide?.('browser-history-changed');
      return {
        ok: true,
        historyId,
        name: record.name,
        closed: !!openTab?.id,
        profileDeleted,
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
      console.log('[IPC] 收到账号 Cookie 消息，正在转发到侧边栏');
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
  DEFAULT_BROWSER_WINDOW_NAME,
  DEFAULT_BROWSER_WINDOW_URL,
  buildBrowserHistoryAccountMeta,
  cleanupOrphanBrowserProfiles,
  createBrowserHistoryId,
  makeUniqueBrowserName,
  openBrowserHistoryRecord,
  readBrowserHistorySafe,
  registerSettingsIPC,
  renameBrowserHistoryRecord,
  serializeBrowserHistory,
  syncOpenTabsToBrowserHistory,
  writeBrowserHistorySafe,
};
