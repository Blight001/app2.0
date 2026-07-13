const path = require('path');
const { ipcMain, BrowserWindow, screen, nativeTheme } = require('electron');
const {
  getClashMiniStatus,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
} = require('./clash-mini-core');
const { normalizeTabBrowserProxyMode } = require('../../utils/normalizers');
const { resolveTabTitle } = require('../../services/tab-common');

// 监听/绑定：registerUiIPC的具体业务逻辑。
function registerUiIPC(ctx) {
  const { ui, getAppConsoleHistory, app, isDevMode: ctxIsDevMode } = ctx;
  const isDevMode = !!(
    ctxIsDevMode === true
    || (app && app.isPackaged === false)
    || (process.env.NODE_ENV && /^(dev|development)$/i.test(String(process.env.NODE_ENV || '')))
  );
  const PROXY_MODE_LABELS = {
    proxy: '单独走端口',
    direct: '直连',
  };
  let tabProxyMenuWindow = null;

  const getProxyModeLabel = (mode) => PROXY_MODE_LABELS[String(mode || '').trim()] || String(mode || '').trim() || '未知模式';
  let currentAppTheme = 'dark';

  const normalizeAppTheme = (theme) => (String(theme || '').trim() === 'light' ? 'light' : 'dark');

  ipcMain.handle('get-browser-runtime-state', async (_event, payload = {}) => {
    const manager = ui?.browserRuntimeManager;
    if (!manager) return { ok: false, message: 'Browser Runtime 不可用' };
    const profileId = String(payload?.profileId || '').trim();
    return {
      ok: true,
      nativeHostAvailable: manager.isChromiumAvailable(),
      state: profileId ? manager.getState(profileId) : null,
      states: manager.listStates(),
    };
  });

  ipcMain.handle('restart-browser-runtime', async (_event, payload = {}) => {
    const profileId = String(payload?.profileId || '').trim();
    if (!profileId || !ui?.browserRuntimeManager) return { ok: false, message: '缺少 Chromium Profile ID' };
    try {
      const state = await ui.browserRuntimeManager.restart(profileId);
      return { ok: true, state };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  const sendAppThemeToWebContents = (webContents, theme) => {
    try {
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('app-theme-changed', theme);
      }
    } catch (_) {}
  };

  const broadcastAppTheme = (theme) => {
    const nextTheme = normalizeAppTheme(theme);
    currentAppTheme = nextTheme;

    try {
      if (nativeTheme) {
        nativeTheme.themeSource = nextTheme;
      }
    } catch (_) {}

    try {
      const mainWindow = ui && typeof ui.getMainWindow === 'function' ? ui.getMainWindow() : null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(nextTheme === 'light' ? '#f6f9fd' : '#0f1115');
        sendAppThemeToWebContents(mainWindow.webContents, nextTheme);
      }
    } catch (_) {}

    try {
      if (ui && typeof ui.sendToSide === 'function') {
        ui.sendToSide('app-theme-changed', nextTheme);
      }
    } catch (_) {}
  };

  const resolveEffectiveBrowserProxyMode = (rawMode) => {
    const currentMode = normalizeTabBrowserProxyMode(rawMode);
    if (currentMode !== 'inherit') {
      return currentMode;
    }
    const clashMiniStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
    const coreDir = clashMiniStatus?.coreDir || (typeof getClashMiniRuntimeRoot === 'function' ? getClashMiniRuntimeRoot() : '');
    const endpoint = coreDir && typeof getClashMiniProxyEndpoint === 'function'
      ? getClashMiniProxyEndpoint(coreDir)
      : null;
    if (endpoint && Number.isFinite(Number(endpoint.port))) {
      return 'proxy';
    }
    return 'direct';
  };

  const resolveCurrentTabProxyMode = (tabId, fallbackMode = 'inherit') => {
    try {
      const tabs = ui && typeof ui.getTabs === 'function' ? ui.getTabs() : null;
      if (tabs && tabId) {
        const directTab = tabs.get(tabId);
        if (directTab) {
          return resolveEffectiveBrowserProxyMode(directTab.browserProxyMode);
        }
        for (const tab of tabs.values()) {
          if (String(tab?.id || '').trim() === String(tabId || '').trim()) {
            return resolveEffectiveBrowserProxyMode(tab?.browserProxyMode);
          }
        }
      }
    } catch (_) {}
    return normalizeTabBrowserProxyMode(fallbackMode);
  };

  const closeTabProxyMenuWindow = () => {
    if (tabProxyMenuWindow && !tabProxyMenuWindow.isDestroyed()) {
      try { tabProxyMenuWindow.close(); } catch (_) {}
    }
    tabProxyMenuWindow = null;
  };

  const buildTabProxyMenuHtml = (tabId, currentMode = 'inherit') => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .menu {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px;
      min-width: 168px;
      box-sizing: border-box;
      background: rgba(17, 20, 28, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 8px;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.34);
      backdrop-filter: blur(10px);
    }
    button {
      appearance: none;
      border: 0;
      background: transparent;
      color: #e6e8ee;
      font-size: 12px;
      line-height: 1.2;
      min-height: 32px;
      padding: 0 10px;
      border-radius: 6px;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
      box-sizing: border-box;
    }
    button:hover { background: rgba(77, 163, 255, 0.18); }
    button:active { background: rgba(77, 163, 255, 0.28); }
    button.selected {
      background: rgba(77, 163, 255, 0.18);
      color: #ffffff;
      box-shadow: inset 0 0 0 1px rgba(77, 163, 255, 0.34);
    }
    button:not(.selected) {
      color: rgba(230, 232, 238, 0.82);
    }
    button:disabled {
      cursor: default;
      opacity: 0.72;
    }
    .error {
      display: none;
      color: #ffb4b4;
      font-size: 11px;
      line-height: 1.3;
      max-height: 28px;
      overflow: hidden;
      padding: 2px 4px 0;
    }
    .error.visible {
      display: block;
    }
  </style>
</head>
<body>
  <div class="menu">
    <button id="proxy-btn" type="button">走代理</button>
    <button id="direct-btn" type="button">直连</button>
    <div id="error" class="error"></div>
  </div>
  <script>
    const tabId = ${JSON.stringify(String(tabId || ''))};
    const currentMode = ${JSON.stringify(normalizeTabBrowserProxyMode(currentMode))};
    const api = window.electronAPI;
    const proxyBtn = document.getElementById('proxy-btn');
    const directBtn = document.getElementById('direct-btn');
    const errorEl = document.getElementById('error');
    const proxyText = proxyBtn.textContent;
    const directText = directBtn.textContent;

    const applyCurrentMode = (mode) => {
      const nextMode = mode === 'direct' ? 'direct' : mode === 'proxy' ? 'proxy' : 'inherit';
      proxyBtn.classList.toggle('selected', nextMode === 'proxy');
      directBtn.classList.toggle('selected', nextMode === 'direct');
      proxyBtn.setAttribute('aria-pressed', nextMode === 'proxy' ? 'true' : 'false');
      directBtn.setAttribute('aria-pressed', nextMode === 'direct' ? 'true' : 'false');
    };

    const setLoading = (loading) => {
      proxyBtn.disabled = loading;
      directBtn.disabled = loading;
      if (!loading) {
        proxyBtn.textContent = proxyText;
        directBtn.textContent = directText;
      }
    };

    const showError = (message) => {
      errorEl.textContent = message || '切换代理失败';
      errorEl.classList.add('visible');
    };

    const showClickFeedback = (mode) => {
      const targetBtn = mode === 'proxy' ? proxyBtn : directBtn;
      targetBtn.textContent = '切换中...';
      setLoading(true);
    };

    const invoke = async (mode) => {
      try {
        errorEl.classList.remove('visible');
        errorEl.textContent = '';
        showClickFeedback(mode);
        if (!api || typeof api.invoke !== 'function') {
          throw new Error('当前窗口不可用');
        }
        const resp = await api.invoke('set-tab-browser-proxy-mode', { tabId, mode });
        if (!resp || resp.ok !== true) {
          throw new Error((resp && (resp.message || resp.error)) || '切换代理失败');
        }
        const refreshResp = await api.invoke('refresh-tab', tabId);
        if (!refreshResp || refreshResp.ok !== true) {
          throw new Error((refreshResp && (refreshResp.message || refreshResp.error)) || '刷新失败');
        }
        window.close();
      } catch (error) {
        setLoading(false);
        showError(error && (error.message || String(error)));
      }
    };

    document.getElementById('proxy-btn').addEventListener('click', () => invoke('proxy'));
    document.getElementById('direct-btn').addEventListener('click', () => invoke('direct'));
    window.addEventListener('blur', () => window.close());
    applyCurrentMode(currentMode);
  </script>
</body>
</html>`;

  const openTabProxyMenuWindow = ({ tabId, x = 0, y = 0, parentWindow = null, browserProxyMode = 'inherit' } = {}) => {
    if (!isDevMode) {
      return false;
    }
    try {
      closeTabProxyMenuWindow();
      const parent = parentWindow && !parentWindow.isDestroyed() ? parentWindow : null;
      if (!parent) return false;

      const currentMode = resolveCurrentTabProxyMode(tabId, browserProxyMode);

      const popupWidth = 168;
      const popupHeight = 92;
      const parentBounds = typeof parent.getBounds === 'function' ? parent.getBounds() : { x: 0, y: 0, width: popupWidth, height: popupHeight };
      const display = screen.getDisplayNearestPoint
        ? screen.getDisplayNearestPoint({ x: parentBounds.x + Number(x || 0), y: parentBounds.y + Number(y || 0) })
        : screen.getPrimaryDisplay();
      const workArea = display && display.workArea ? display.workArea : { x: 0, y: 0, width: 1920, height: 1080 };
      const anchorX = parentBounds.x + Number(x || 0);
      const anchorY = parentBounds.y + Number(y || 0);
      const left = Math.min(Math.max(anchorX - 12, workArea.x + 8), workArea.x + workArea.width - popupWidth - 8);
      const top = Math.min(Math.max(anchorY + 8, workArea.y + 8), workArea.y + workArea.height - popupHeight - 8);

      tabProxyMenuWindow = new BrowserWindow({
        x: Math.round(left),
        y: Math.round(top),
        width: popupWidth,
        height: popupHeight,
        frame: false,
        resizable: false,
        movable: false,
        maximizable: false,
        minimizable: false,
        skipTaskbar: true,
        show: false,
        alwaysOnTop: true,
        backgroundColor: '#11141c',
        transparent: true,
        parent,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          devTools: false,
          preload: path.join(__dirname, '../../preload.js'),
        },
      });

      tabProxyMenuWindow.on('closed', () => {
        tabProxyMenuWindow = null;
      });
      tabProxyMenuWindow.on('blur', () => closeTabProxyMenuWindow());

      tabProxyMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildTabProxyMenuHtml(tabId, currentMode))}`);
      tabProxyMenuWindow.once('ready-to-show', () => {
        try { tabProxyMenuWindow.show(); } catch (_) {}
      });
      return true;
    } catch (error) {
      console.warn('[UI] 打开代理菜单窗口失败:', error?.message || error);
      closeTabProxyMenuWindow();
      return false;
    }
  };

  async function setTabProxyModeAndPromptRefresh(tabId, mode) {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    if (!['proxy', 'direct'].includes(normalizedMode)) {
      return { ok: false, message: '当前菜单不支持该代理模式' };
    }

    if (!ui || typeof ui.setTabBrowserProxyMode !== 'function') {
      return { ok: false, message: '标签代理模式功能不可用' };
    }

    console.log('[UI] 开始切换标签代理模式', { tabId, mode: normalizedMode });
    const result = await ui.setTabBrowserProxyMode(tabId, normalizedMode);
    if (!result || result.ok !== true) {
      console.warn('[UI] 切换标签代理模式失败', { tabId, mode: normalizedMode, result });
      return result || { ok: false, message: '切换代理模式失败' };
    }
    return {
      ...result,
      refreshed: false,
      refreshPromptShown: false,
    };
  }

  ipcMain.on('app-theme-changed', (_e, theme) => {
    broadcastAppTheme(theme);
  });

  ipcMain.handle('get-app-theme', async () => ({
    ok: true,
    theme: currentAppTheme,
  }));

  ipcMain.on('add-tab', (_e, url) => ui.addTab(url));
  ipcMain.on('switch-tab', (_e, tabId) => ui.switchTab(tabId));
  ipcMain.on('close-tab', (_e, tabId) => { void ui.closeTab(tabId); });

  ipcMain.handle('set-tab-browser-proxy-mode', async (_e, payload = {}) => {
    try {
      if (!isDevMode) {
        return { ok: false, disabled: true, message: '正式版未启用标签代理切换菜单' };
      }
      const tabId = String(payload?.tabId || '').trim();
      const mode = String(payload?.mode || 'inherit').trim();
      if (!tabId) {
        return { ok: false, message: '缺少标签 ID' };
      }
      return await setTabProxyModeAndPromptRefresh(tabId, mode, _e.sender);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.handle('show-tab-context-menu', async (_e, payload = {}) => {
    try {
      if (!isDevMode) {
        return { ok: true, disabled: true };
      }
      const tabId = String(payload?.tabId || '').trim();
      if (!tabId) {
        return { ok: false, message: '缺少标签 ID' };
      }
      const x = Number(payload?.x ?? 0);
      const y = Number(payload?.y ?? 0);
      const opened = openTabProxyMenuWindow({
        tabId,
        x,
        y,
        browserProxyMode: payload?.browserProxyMode,
        parentWindow: BrowserWindow.fromWebContents(_e.sender),
      });
      return opened ? { ok: true } : { ok: false, message: '打开代理菜单失败' };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.handle('get-tabs-state', async () => {
    try {
      const tabs = ui.getTabs && typeof ui.getTabs === 'function' ? ui.getTabs() : new Map();
      const activeTabId = ui.getActiveTabId && typeof ui.getActiveTabId === 'function'
        ? ui.getActiveTabId()
        : null;
      const tabData = Array.from(tabs.values()).map((tab) => ({
        id: tab.id,
        title: resolveTabTitle(tab),
        isActive: tab.id === activeTabId,
        accountId: String(tab.accountId || '').trim(),
        browserProxyMode: String(tab.browserProxyMode || 'inherit').trim(),
      }));
      return { ok: true, tabs: tabData };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), tabs: [] };
    }
  });

  const getManagedTabs = () => (
    ui && typeof ui.getTabs === 'function' ? ui.getTabs() : new Map()
  );

  const getManagedActiveTabId = () => (
    ui && typeof ui.getActiveTabId === 'function' ? ui.getActiveTabId() : null
  );

  const findManagedTabBySender = (sender) => {
    const senderId = Number(sender?.id);
    if (!Number.isFinite(senderId)) return null;
    try {
      for (const tab of getManagedTabs().values()) {
        const wc = tab?.view?.webContents;
        if (wc && Number(wc.id) === senderId) return tab;
      }
    } catch (_) {}
    return null;
  };

  const findManagedTabById = (tabId) => {
    const raw = String(tabId || '').trim();
    if (!raw) return null;
    const tabs = getManagedTabs();
    if (tabs && typeof tabs.get === 'function' && tabs.has(raw)) return tabs.get(raw);
    try {
      for (const tab of tabs.values()) {
        if (String(tab?.id || '').trim() === raw) return tab;
      }
    } catch (_) {}
    return null;
  };

  const serializeManagedTab = (tab) => {
    if (!tab) return null;
    const wc = tab?.view?.webContents || null;
    const activeTabId = getManagedActiveTabId();
    return {
      id: String(tab.id || ''),
      appTabId: String(tab.id || ''),
      title: resolveTabTitle(tab),
      url: typeof wc?.getURL === 'function' ? wc.getURL() : '',
      active: String(tab.id || '') === String(activeTabId || ''),
      accountId: String(tab.accountId || '').trim(),
      partition: String(tab.partition || '').trim(),
      browserProxyMode: String(tab.browserProxyMode || 'inherit').trim(),
      webContentsId: Number(wc?.id || 0) || null,
      canGoBack: typeof wc?.canGoBack === 'function' ? wc.canGoBack() : false,
      canGoForward: typeof wc?.canGoForward === 'function' ? wc.canGoForward() : false,
    };
  };

  const listManagedTabs = () => {
    const tabs = Array.from(getManagedTabs().values()).map(serializeManagedTab).filter(Boolean);
    return {
      ok: true,
      activeTabId: String(getManagedActiveTabId() || ''),
      tabs,
      activeTab: tabs.find((tab) => tab.active) || null,
    };
  };

  const normalizeBridgeUrl = (raw) => {
    const value = String(raw || '').trim();
    if (!value) throw new Error('缺少 URL');
    if (value === 'about:blank') return value;
    try {
      return new URL(value).href;
    } catch (_) {
      return new URL(`https://${value}`).href;
    }
  };

  const normalizeCaptureRect = (rect) => {
    if (!rect || typeof rect !== 'object') return undefined;
    const x = Math.max(0, Math.floor(Number(rect.x) || 0));
    const y = Math.max(0, Math.floor(Number(rect.y) || 0));
    const width = Math.max(1, Math.floor(Number(rect.width) || 0));
    const height = Math.max(1, Math.floor(Number(rect.height) || 0));
    if (!width || !height) return undefined;
    return { x, y, width, height };
  };

  ipcMain.handle('browser-mcp-bridge', async (_event, payload = {}) => {
    try {
      const command = String(payload?.command || payload?.action || '').trim();
      const senderTab = findManagedTabBySender(_event.sender);
      const targetTab = findManagedTabById(payload?.appTabId || payload?.tabId) || senderTab;
      const targetWc = targetTab?.view?.webContents || null;

      if (command === 'tab:identify') {
        return { ok: true, tab: serializeManagedTab(senderTab), tabs: listManagedTabs().tabs };
      }

      if (command === 'tab:list') {
        return listManagedTabs();
      }

      if (command === 'tab:switch') {
        if (!targetTab?.id || typeof ui.switchTab !== 'function') {
          return { ok: false, message: '目标标签不存在或无法切换' };
        }
        ui.switchTab(targetTab.id);
        return { ok: true, action: 'switch', tab: serializeManagedTab(targetTab), tabs: listManagedTabs().tabs };
      }

      if (command === 'tab:close') {
        if (!targetTab?.id || typeof ui.closeTab !== 'function') {
          return { ok: false, message: '目标标签不存在或无法关闭' };
        }
        const closing = serializeManagedTab(targetTab);
        await ui.closeTab(targetTab.id);
        return { ok: true, action: 'close', tab: closing, tabs: listManagedTabs().tabs };
      }

      if (command === 'tab:open') {
        if (typeof ui.addTab !== 'function') {
          return { ok: false, message: '打开标签功能不可用' };
        }
        const url = normalizeBridgeUrl(payload?.url);
        const openedId = await ui.addTab(url, {
          partition: senderTab?.partition,
          browserSettings: senderTab?.browserSettings,
        });
        const opened = findManagedTabById(openedId);
        return { ok: true, action: 'open', tab: serializeManagedTab(opened), tabs: listManagedTabs().tabs };
      }

      if (command === 'tab:replace') {
        if (!targetWc || targetWc.isDestroyed?.()) {
          return { ok: false, message: '目标网页不可用' };
        }
        const url = normalizeBridgeUrl(payload?.url);
        if (typeof ui.switchTab === 'function' && targetTab?.id) {
          ui.switchTab(targetTab.id);
        }
        await targetWc.loadURL(url);
        return { ok: true, action: 'replace', tab: serializeManagedTab(targetTab), tabs: listManagedTabs().tabs };
      }

      if (command === 'tab:history') {
        if (!targetWc || targetWc.isDestroyed?.()) {
          return { ok: false, message: '目标网页不可用' };
        }
        const direction = String(payload?.direction || '').trim();
        if (direction === 'back') {
          if (typeof targetWc.canGoBack === 'function' && !targetWc.canGoBack()) {
            return { ok: false, message: '当前标签没有后退历史', tab: serializeManagedTab(targetTab) };
          }
          targetWc.goBack();
        } else if (direction === 'forward') {
          if (typeof targetWc.canGoForward === 'function' && !targetWc.canGoForward()) {
            return { ok: false, message: '当前标签没有前进历史', tab: serializeManagedTab(targetTab) };
          }
          targetWc.goForward();
        } else {
          return { ok: false, message: '未知历史动作' };
        }
        return { ok: true, action: direction, tab: serializeManagedTab(targetTab) };
      }

      if (command === 'tab:reload') {
        if (!targetWc || targetWc.isDestroyed?.()) {
          return { ok: false, message: '目标网页不可用' };
        }
        targetWc.reloadIgnoringCache();
        return { ok: true, action: 'reload', tab: serializeManagedTab(targetTab) };
      }

      if (command === 'tab:capture') {
        if (!targetWc || targetWc.isDestroyed?.()) {
          return { ok: false, message: '目标网页不可用' };
        }
        const image = await targetWc.capturePage(normalizeCaptureRect(payload?.rect));
        const dataUrl = image && typeof image.toDataURL === 'function' ? image.toDataURL() : '';
        if (!dataUrl) {
          return { ok: false, message: '截图结果为空' };
        }
        return {
          ok: true,
          action: 'capture',
          dataUrl,
          tab: serializeManagedTab(targetTab),
          warning: payload?.fullPage ? 'Electron bridge fallback captures the visible BrowserView viewport.' : '',
        };
      }

      return { ok: false, message: `未知 MCP 浏览器桥接命令: ${command || '(empty)'}` };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.handle('refresh-tab', async (_e, tabId) => {
    try {
      if (!ui.refreshTab) {
        return { ok: false, message: '刷新功能不可用' };
      }
      return ui.refreshTab(tabId);
    } catch (error) {
      console.warn('[IPC] 刷新标签失败:', error?.message || error);
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipcMain.on('reorder-tab', (_e, payload = {}) => {
    try {
      ui.reorderTab && ui.reorderTab(payload.tabId, payload.targetTabId, payload.position);
    } catch (error) {
      console.warn('[IPC] 重排标签失败:', error?.message || error);
    }
  });
  ipcMain.on('toggle-sidebar', () => ui.toggleSidebar());
  ipcMain.on('ensure-sidebar-visible', () => ui.ensureSidebarVisible && ui.ensureSidebarVisible());

  ipcMain.handle('open-active-web-console', async () => {
    try {
      const wc = ui.getActiveWC && ui.getActiveWC();
      if (!wc || (wc.isDestroyed && wc.isDestroyed())) {
        return { ok: false, message: '当前没有可查看控制台的网页' };
      }

      if (typeof wc.isDevToolsOpened === 'function' && wc.isDevToolsOpened()) {
        try {
          if (wc.devToolsWebContents && typeof wc.devToolsWebContents.focus === 'function') {
            wc.devToolsWebContents.focus();
          }
        } catch (_) {}
        return { ok: true, opened: true, alreadyOpen: true };
      }

      wc.openDevTools({ mode: 'detach' });
      return { ok: true, opened: true, alreadyOpen: false };
    } catch (e) {
      return { ok: false, message: e?.message || String(e) };
    }
  });

  ipcMain.handle('get-app-console-history', async () => {
    try {
      const history = typeof getAppConsoleHistory === 'function' ? getAppConsoleHistory() : [];
      return { ok: true, history: Array.isArray(history) ? history : [] };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), history: [] };
    }
  });

  ipcMain.on('reveal-cookie-import', () => {
    try {
      console.log('[IPC] 收到 Cookie 导入解锁请求');
      if (ui && ui.sendToSide) {
        ui.sendToSide('cookie-import-unlock');
      }
      if (ui && typeof ui.ensureSidebarVisible === 'function') {
        ui.ensureSidebarVisible();
      }
    } catch (e) {
      console.error('[IPC] 处理 Cookie 导入解锁请求失败:', e?.message || e);
    }
  });

  ipcMain.on('set-zoom', (_e, zoomFactor) => ui.setZoom(zoomFactor));
  ipcMain.on('refresh-active-tab-to-url', (_e, url) => ui.refreshActiveTabToUrl(url));
  ipcMain.on('refresh-active-tab', () => ui.refreshActiveTab());

  ipcMain.handle('back-to-license-window', async () => {
    try {
      if (ui && typeof ui.backToLicenseWindow === 'function') {
        return await ui.backToLicenseWindow();
      }
      return { ok: false, message: '回退验证界面功能不可用' };
    } catch (e) {
      return { ok: false, message: e?.message || String(e) };
    }
  });

  ipcMain.on('smart-refresh-active-tab', async () => {
    try {
      const wc = ui.getActiveWC && ui.getActiveWC();
      if (!wc || (wc.isDestroyed && wc.isDestroyed())) return;
// 处理：url的具体业务逻辑。
      const url = (wc.getURL && wc.getURL()) || '';
      if (typeof url === 'string' && url.startsWith('https://dreamina.capcut.com/ai-tool/')) {
        const targetUrl = typeof ctx.getDreamTargetUrl === 'function' ? ctx.getDreamTargetUrl() : ctx.DREAM_TARGET_URL;
        console.log('[智能刷新] 检测到Dreamina页面，刷新到统一入口:', targetUrl);
        ui.refreshActiveTabToUrl(targetUrl);
      } else {
        console.log('[智能刷新] 普通页面刷新，当前URL:', url);
        ui.refreshActiveTab();
      }
    } catch (_) {}
  });

  ipcMain.on('open-extension-popup', (_event, payload = {}) => {
    try { ui.openExtensionPopup && void ui.openExtensionPopup(payload?.id || payload); } catch (_) {}
  });
  ipcMain.on('open-extension-options', (_event, payload = {}) => {
    try { ui.openExtensionOptions && void ui.openExtensionOptions(payload?.id || payload); } catch (_) {}
  });

  ipcMain.on('open-tutorial', (event, url) => {
    ui.addTab(url, {
      browserProxyMode: 'direct',
    });
  });
}

module.exports = { registerUiIPC };
