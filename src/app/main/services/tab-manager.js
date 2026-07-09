const {
  getClashMiniStatus,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
} = require('../ipc/register/clash-mini-core');
const { normalizeTabBrowserProxyMode } = require('../utils/normalizers');
const {
  buildManagedTabPartitionName,
  getActiveTabWebContents,
  toggleSidebarVisibility,
} = require('./tab-common');

// 创建/初始化：createTabManager的具体业务逻辑。
function createTabManager(deps = {}) {
  const DEFAULT_TUTORIAL_URL = 'https://www.baidu.com/';
  const {
    BrowserWindow,
    BrowserView,
    path,
    fs,
    logger = console,
    state,
    injectZoomWheelListener,
    clearInjectionRecord,
    attachContextMenu,
    downloadOrSaveMedia,
    loadTranslateExtension,
    extensionManager,
    cleanupBrowserSessionData,
    getStorePath,
    getTabs,
    getMainWindow,
    setMainWindow,
    getSideView,
    setSideView,
    getActiveTabId,
    setActiveTabId,
    getIsSidebarVisible,
    setIsSidebarVisible,
    getExtPopupWin,
    setExtPopupWin,
    getAuth,
    licenseCache,
    sendToSide,
    updateTabs,
    computeDeviceId,
    buildTabBrowserPreferences,
    applyTabBrowserProxy,
    configureTabBrowserView,
    resolveTabBrowserProfile,
  } = deps;

// 获取/读取/解析：resolveTabs的具体业务逻辑。
  const resolveTabs = () => (typeof getTabs === 'function' ? getTabs() : new Map());
// 获取/读取/解析：resolveMainWindow的具体业务逻辑。
  const resolveMainWindow = () => (typeof getMainWindow === 'function' ? getMainWindow() : null);
// 获取/读取/解析：resolveSideView的具体业务逻辑。
  const resolveSideView = () => (typeof getSideView === 'function' ? getSideView() : null);
// 获取/读取/解析：resolveActiveTabId的具体业务逻辑。
  const resolveActiveTabId = () => (typeof getActiveTabId === 'function' ? getActiveTabId() : null);
// 获取/读取/解析：resolveExtPopupWin的具体业务逻辑。
  const resolveExtPopupWin = () => (typeof getExtPopupWin === 'function' ? getExtPopupWin() : null);
// 获取/读取/解析：resolveAuth的具体业务逻辑。
  const resolveAuth = () => (typeof getAuth === 'function' ? getAuth() : null);
// 获取/读取/解析：resolveIsSidebarVisible的具体业务逻辑。
  const resolveIsSidebarVisible = () => (typeof getIsSidebarVisible === 'function' ? getIsSidebarVisible() : true);
// 校验/保护：ensureManagedExtensionsLoaded的具体业务逻辑。
  const ensureManagedExtensionsLoaded = async (wc, label = '') => {
    if (!wc || wc.isDestroyed()) {
      return false;
    }
    if (extensionManager && typeof extensionManager.loadEnabledIntoSession === 'function') {
      await extensionManager.loadEnabledIntoSession(wc.session, label);
      return true;
    }
    if (!state?.pluginSettings?.translateExtEnabled) {
      logger.log?.('[TranslateExt] 翻译功能已关闭，跳过扩展加载');
      return false;
    }
    await loadTranslateExtension(wc.session, label);
    return true;
  };
// 获取/读取/解析：resolveDefaultTabUrl的具体业务逻辑。
  const resolveDefaultTabUrl = () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const tutorialUrl = String(runtimeConfig.tutorialUrl || '').trim();
      if (tutorialUrl) return tutorialUrl;
    } catch (_) {}
    return DEFAULT_TUTORIAL_URL;
  };

// 获取/读取/解析：resolveFixedTabTitle的具体业务逻辑。
  const resolveFixedTabTitle = (tab = {}) => String(tab?.fixedTitle || tab?.tabTitle || '').trim();

// 获取/读取/解析：getBrowserProxyEndpoint的具体业务逻辑。
  function getBrowserProxyEndpoint() {
    const clashMiniStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
    const coreDir = clashMiniStatus?.coreDir || (typeof getClashMiniRuntimeRoot === 'function' ? getClashMiniRuntimeRoot() : '');
    if (!coreDir) {
      return null;
    }

    const endpoint = typeof getClashMiniProxyEndpoint === 'function'
      ? getClashMiniProxyEndpoint(coreDir)
      : null;
    if (!endpoint || !Number.isFinite(Number(endpoint.port))) {
      return null;
    }

    const host = String(endpoint.host || '127.0.0.1').trim() || '127.0.0.1';
    return {
      enabled: true,
      server: `http://${host}:${Number(endpoint.port)}`,
      bypassRules: '<local>;127.0.0.1;localhost;::1',
    };
  }

// 获取/读取/解析：resolveTabBrowserProxyMode的具体业务逻辑。
  function resolveTabBrowserProxyMode(tab = {}) {
    return normalizeTabBrowserProxyMode(tab?.browserProxyMode || 'inherit');
  }

// 获取/读取/解析：resolveTabBrowserProxy的具体业务逻辑。
  function resolveTabBrowserProxy(tab = {}, browserProxy = null, globalEnabled = false) {
    const mode = resolveTabBrowserProxyMode(tab);
    if (mode === 'direct') {
      return { enabled: false };
    }
    if (mode === 'proxy') {
      return browserProxy || { enabled: false };
    }
    return globalEnabled ? (browserProxy || { enabled: false }) : { enabled: false };
  }

// 设置/更新/持久化：applyClashMiniBrowserProxy的具体业务逻辑。
  async function applyClashMiniBrowserProxy(enabled = true) {
    const entries = Array.from(resolveTabs().values());
    const browserProxy = getBrowserProxyEndpoint();

    const results = await Promise.all(entries.map(async (tab) => {
      const webContents = tab?.view?.webContents;
      if (!webContents || typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
        return false;
      }
      if (typeof applyTabBrowserProxy !== 'function') {
        return false;
      }
      const tabProxy = resolveTabBrowserProxy(tab, browserProxy, enabled === true);
      return await applyTabBrowserProxy(webContents, tabProxy, logger);
    }));

    return {
      ok: true,
      enabled: !!enabled,
      updated: results.filter(Boolean).length,
      total: entries.length,
    };
  }

// 获取/读取/解析：getActiveWC的具体业务逻辑。
  function getActiveWC() {
    return getActiveTabWebContents(resolveTabs(), resolveActiveTabId());
  }

// 设置/更新/持久化：toggleSidebar的具体业务逻辑。
  function toggleSidebar() {
    return toggleSidebarVisibility({
      getIsSidebarVisible: resolveIsSidebarVisible,
      setIsSidebarVisible,
      getMainWindow: resolveMainWindow,
      getSideView: resolveSideView,
    });
  }

// 处理：addTab的具体业务逻辑。
  async function addTab(url, options = {}) {
    const mainWindow = resolveMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return null;

    const accountId = String(options.accountId || '').trim();
    const fixedTitle = String(options.fixedTitle || options.tabTitle || '').trim();
    const browserProxyMode = normalizeTabBrowserProxyMode(options.browserProxyMode || 'inherit');
    const existingTab = accountId
      ? Array.from(resolveTabs().values()).find((tab) => String(tab?.accountId || '').trim() === accountId)
      : null;
    if (existingTab && existingTab.id) {
      switchTab(existingTab.id);
      return existingTab.id;
    }

    const newTabId = accountId || Date.now().toString();
    const partition = options.partition || `persist:${buildManagedTabPartitionName(newTabId)}`;
    const refreshAfterLoad = options.refreshAfterLoad === true;
    const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
      ? licenseCache.getRuntimeConfig()
      : {};
    const browserSettings = {
      ...(runtimeConfig && typeof runtimeConfig.browserSettings === 'object' ? runtimeConfig.browserSettings : {}),
      ...(options.browserSettings && typeof options.browserSettings === 'object' ? options.browserSettings : {}),
    };
    const browserProfile = typeof resolveTabBrowserProfile === 'function'
      ? await resolveTabBrowserProfile({
          browserSettings,
          httpGetUniversal: deps.httpGetUniversal,
          logger,
        })
      : null;
    const clashMiniStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
    const shouldApplyClashMiniProxy = clashMiniStatus && clashMiniStatus.running === true;
    const clashMiniProxy = shouldApplyClashMiniProxy && typeof getClashMiniProxyEndpoint === 'function'
      ? getClashMiniProxyEndpoint(clashMiniStatus.coreDir || (typeof getClashMiniRuntimeRoot === 'function' ? getClashMiniRuntimeRoot() : ''))
      : null;
    const browserProxy = clashMiniProxy && Number.isFinite(Number(clashMiniProxy.port))
      ? {
          enabled: true,
          server: `http://${String(clashMiniProxy.host || '127.0.0.1').trim() || '127.0.0.1'}:${Number(clashMiniProxy.port)}`,
          bypassRules: '<local>;127.0.0.1;localhost;::1',
        }
      : null;
    const newView = new BrowserView({
      webPreferences: typeof buildTabBrowserPreferences === 'function'
        ? buildTabBrowserPreferences(partition)
        : {
            partition,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload.js'),
          },
    });

    mainWindow.addBrowserView(newView);
    resolveTabs().set(newTabId, {
      id: newTabId,
      view: newView,
      zoomFactor: 1,
      partition,
      accountId,
      fixedTitle,
      browserProxyMode,
      browserProfile: browserProfile ? {
        browserBrand: browserProfile.browserBrand || '',
        browserType: browserProfile.browserType || '',
        region: browserProfile.region || '',
        regionLabel: browserProfile.regionLabel || '',
        sourceIp: browserProfile.sourceIp || '',
        sourceCountryCode: browserProfile.sourceCountryCode || '',
        sourceCountry: browserProfile.sourceCountry || '',
        locale: browserProfile.locale || '',
        timezoneId: browserProfile.timezoneId || '',
        acceptLanguage: browserProfile.acceptLanguage || '',
        userAgent: browserProfile.userAgent || '',
      } : null,
      loadState: {
        didStartLoadingAt: null,
        domReadyAt: null,
        didFinishLoadAt: null,
        didFailLoadAt: null,
        lastUrl: '',
      },
    });
    attachContextMenu(newView.webContents, { addTab, downloadOrSaveMedia, tabs: resolveTabs(), activeTabId: resolveActiveTabId(), refreshPage: refreshActiveTab });
    if (typeof configureTabBrowserView === 'function') {
      await configureTabBrowserView(newView.webContents, {
        logger,
        browserProfile,
        browserSettings,
        browserProxy: resolveTabBrowserProxy({ browserProxyMode }, browserProxy, true),
      });
    }

// 设置/更新/持久化：updateTabLoadState的具体业务逻辑。
    const updateTabLoadState = (patch = {}) => {
      try {
        const tabs = resolveTabs();
        const tab = tabs.get(newTabId);
        if (!tab) return;
        tab.loadState = {
          ...(tab.loadState || {}),
          ...patch,
        };
        tabs.set(newTabId, tab);
      } catch (_) {}
    };

    try { resolveAuth()?.applyZhHantRequestPrefs(newView.webContents.session, newView.webContents); } catch (_) {}

    try {
      await ensureManagedExtensionsLoaded(newView.webContents, `标签 ${newTabId}`);
    } catch (_) {}

    newView.webContents.setWindowOpenHandler(({ url: childUrl }) => {
      addTab(childUrl, { partition, browserSettings });
      return { action: 'deny' };
    });

    newView.webContents.on('did-start-loading', () => {
      updateTabLoadState({
        didStartLoadingAt: Date.now(),
        domReadyAt: null,
        didFinishLoadAt: null,
        didFailLoadAt: null,
        lastUrl: newView.webContents.getURL(),
      });
      clearInjectionRecord(newView.webContents);
    });

    newView.webContents.on('dom-ready', () => {
      updateTabLoadState({
        domReadyAt: Date.now(),
        lastUrl: newView.webContents.getURL(),
      });
      newView.webContents.insertCSS('::-webkit-scrollbar { display: none; }');
      injectZoomWheelListener(newView.webContents);
    });

    newView.webContents.on('did-finish-load', () => {
      updateTabLoadState({
        didFinishLoadAt: Date.now(),
        lastUrl: newView.webContents.getURL(),
      });
      if (fixedTitle) {
        try { newView.webContents.setTitle(fixedTitle); } catch (_) {}
      }
    });

    newView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      updateTabLoadState({
        didFailLoadAt: Date.now(),
        lastUrl: validatedURL || newView.webContents.getURL(),
        errorCode,
        errorDescription,
      });
    });

    newView.webContents.on('did-navigate-in-page', () => {
      updateTabLoadState({
        lastUrl: newView.webContents.getURL(),
      });
      injectZoomWheelListener(newView.webContents);
      if (fixedTitle) {
        try { newView.webContents.setTitle(fixedTitle); } catch (_) {}
      }
    });

    newView.webContents.on('focus', () => {
      if (resolveIsSidebarVisible()) {
        if (typeof setIsSidebarVisible === 'function') {
          setIsSidebarVisible(false);
        }
        const sideView = resolveSideView();
        const mainWindow = resolveMainWindow();
        if (sideView && sideView.webContents && !sideView.webContents.isDestroyed()) {
          sideView.webContents.send('sidebar-collapse');
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sidebar-collapse');
          setTimeout(() => {
            const win = resolveMainWindow();
            if (win && !win.isDestroyed()) {
              win.emit('resize');
            }
          }, 400);
        }
      }
    });

    if (Array.isArray(options.cookies) && options.cookies.length) {
      try { await resolveAuth()?.setCookiesToSession(newView.webContents.session, options.cookies); } catch (e) { logger.warn?.('Cookie 注入失败:', e?.message || e); }
    }

    if (Array.isArray(options.browserStorage) && options.browserStorage.length) {
      try { resolveAuth()?.applyBrowserStorageToPage(newView.webContents, options.browserStorage); } catch (e) { logger.warn?.('BrowserStorage 注入失败:', e?.message || e); }
    }

    let initialUrl = url;
    if (!initialUrl) {
      try {
        initialUrl = resolveDefaultTabUrl();
      } catch (error) {
        logger.error?.('[main] 获取默认打开地址失败，使用教程页默认值:', error);
        initialUrl = DEFAULT_TUTORIAL_URL;
      }
    }

    if (refreshAfterLoad) {
      let refreshedOnce = false;
      newView.webContents.once('did-finish-load', () => {
        if (refreshedOnce) return;
        refreshedOnce = true;
        setTimeout(() => {
          try {
            if (newView.webContents && !newView.webContents.isDestroyed()) {
              newView.webContents.reloadIgnoringCache();
            }
          } catch (_) {}
        }, 250);
      });
    }

    if (fixedTitle) {
      try { newView.webContents.setTitle(fixedTitle); } catch (_) {}
    }

    try { newView.webContents.loadURL(initialUrl); } catch (_) {}
    switchTab(newTabId);
    newView.webContents.on('page-title-updated', (event) => {
      if (fixedTitle) {
        try { event.preventDefault(); } catch (_) {}
        try { newView.webContents.setTitle(fixedTitle); } catch (_) {}
      }
      updateTabs(true);
    });
    return newTabId;
  }

// 设置/更新/持久化：setTabAccountId的具体业务逻辑。
  function setTabAccountId(tabId, accountId) {
    try {
      const tabs = resolveTabs();
      if (!tabs.has(tabId)) return false;
      const tab = tabs.get(tabId);
      tab.accountId = String(accountId || '').trim();
      tabs.set(tabId, tab);
      updateTabs(true);
      return true;
    } catch (_) {
      return false;
    }
  }

// 设置/更新/持久化：setTabBrowserProxyMode的具体业务逻辑。
  async function setTabBrowserProxyMode(tabId, mode) {
    try {
      const tabs = resolveTabs();
      if (!tabs.has(tabId)) return { ok: false, message: '标签页不存在' };
      const tab = tabs.get(tabId);
      const nextMode = normalizeTabBrowserProxyMode(mode);
      tab.browserProxyMode = nextMode;
      tabs.set(tabId, tab);

      const wc = tab?.view?.webContents;
      if (wc && !(typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
        const browserProxy = getBrowserProxyEndpoint();
        const applied = await applyTabBrowserProxy(
          wc,
          resolveTabBrowserProxy(tab, browserProxy, true),
          logger,
        );
        if (!applied) {
          return { ok: false, message: '切换标签代理模式失败' };
        }
      }

      updateTabs(true);
      return { ok: true, tabId, browserProxyMode: nextMode };
    } catch (error) {
      logger.warn?.('[BrowserProxy] 设置标签代理模式失败:', error?.message || error);
      return { ok: false, message: error?.message || String(error) };
    }
  }

// 处理：switchTab的具体业务逻辑。
  function switchTab(tabId) {
    const tabs = resolveTabs();
    const mainWindow = resolveMainWindow();
    if (!mainWindow || !tabs.has(tabId)) return;

    const activeTabId = resolveActiveTabId();
    if (activeTabId && tabs.has(activeTabId)) {
      try { mainWindow.removeBrowserView(tabs.get(activeTabId).view); } catch (_) {}
    }

    if (typeof setActiveTabId === 'function') {
      setActiveTabId(tabId);
    }

    const activeTab = tabs.get(tabId);
    const activeTabView = activeTab.view;
    mainWindow.addBrowserView(activeTabView);
    mainWindow.setTopBrowserView(activeTabView);

    if (activeTab.zoomFactor) {
      activeTabView.webContents.setZoomFactor(activeTab.zoomFactor);
    }

    mainWindow.emit('resize');
    sendToSide('active-zoom', activeTab.zoomFactor);
    updateTabs(true);
  }

// 停止/关闭/清理：closeTab的具体业务逻辑。
  async function closeTab(tabId) {
    const tabs = resolveTabs();
    const mainWindow = resolveMainWindow();
    if (!tabs.has(tabId) || !mainWindow) return;

    const orderedTabIds = Array.from(tabs.keys());
    const closeIndex = orderedTabIds.indexOf(tabId);
    const tabToClose = tabs.get(tabId);
    const closePartition = tabToClose?.partition || '';
    const closeSession = tabToClose?.view?.webContents?.session || null;
    const closedAccountId = String(tabToClose?.accountId || '').trim();
    try { if (tabToClose?.view?.webContents && !tabToClose.view.webContents.isDestroyed()) tabToClose.view.webContents.destroy(); } catch (_) {}
    try { mainWindow.removeBrowserView(tabToClose.view); } catch (_) {}
    tabs.delete(tabId);
    if (closedAccountId) {
      try {
        sendToSide('tab-closed', { tabId, accountId: closedAccountId });
      } catch (_) {}
    }

    if (resolveActiveTabId() === tabId) {
      const remaining = Array.from(tabs.keys());
      if (remaining.length > 0) {
        const preferredLeftId = orderedTabIds[closeIndex - 1];
        const preferredRightId = orderedTabIds[closeIndex + 1];
        const nextTabId = remaining.includes(preferredLeftId) ? preferredLeftId : (remaining.includes(preferredRightId) ? preferredRightId : remaining[0]);
        switchTab(nextTabId);
      } else {
        await addTab();
      }
    }
    updateTabs(true);

    try {
      await cleanupBrowserSessionData({
        partition: closePartition,
        session: closeSession,
        excludedTabId: tabId,
        source: '标签页关闭',
      });
    } catch (e) {
      logger.warn?.('[缓存清理] 标签页关闭后清理失败:', e?.message || e);
    }
  }

// 处理：reorderTab的具体业务逻辑。
  function reorderTab(tabId, targetTabId, position = 'before') {
    const tabs = resolveTabs();
    if (!tabId || !targetTabId || tabId === targetTabId) return false;
    if (!tabs.has(tabId) || !tabs.has(targetTabId)) return false;

    const entries = Array.from(tabs.entries()).filter(([id]) => id !== tabId);
    const movedEntry = tabs.get(tabId);
    const targetIndex = entries.findIndex(([id]) => id === targetTabId);
    if (targetIndex === -1) return false;

    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    entries.splice(insertIndex, 0, [tabId, movedEntry]);

    tabs.clear();
    for (const [id, tab] of entries) {
      tabs.set(id, tab);
    }

    updateTabs(true);
    return true;
  }

// 设置/更新/持久化：setZoom的具体业务逻辑。
  function setZoom(zoomFactor) {
    const activeTab = resolveTabs().get(resolveActiveTabId());
    if (activeTab) {
      activeTab.view.webContents.setZoomFactor(zoomFactor);
      activeTab.zoomFactor = zoomFactor;
      try {
        activeTab.view.webContents.send('active-zoom', zoomFactor);
      } catch (_) {}
    }
    try { sendToSide('active-zoom', zoomFactor); } catch (_) {}
  }

// 渲染/刷新：refreshActiveTabToUrl的具体业务逻辑。
  async function refreshActiveTabToUrl(url) {
    try {
      const wc = getActiveWC();
      if (wc) {
        const targetUrl = url;
        logger.log?.('刷新', `将当前激活标签页强制刷新到 -> ${targetUrl}`);
        await ensureManagedExtensionsLoaded(wc, `刷新到URL`);
        wc.loadURL(targetUrl);
        sendToSide('active-tab-refreshed', { ok: true, url: targetUrl });
      } else {
        logger.log?.('刷新', '没有激活标签页可刷新');
        sendToSide('active-tab-refreshed', { ok: false, reason: 'no_active_tab' });
      }
    } catch (e) {
      logger.log?.('刷新错误', e);
      sendToSide('active-tab-refreshed', { ok: false, reason: e.message });
    }
  }

// 渲染/刷新：refreshActiveTab的具体业务逻辑。
  async function refreshActiveTab() {
    try {
      const wc = getActiveWC();
      if (wc) {
        const rawUrl = String(wc.getURL() || '');
        const currentUrl = rawUrl;
        logger.log?.('刷新', '刷新当前激活标签页 (忽略缓存) ->', currentUrl);
        await ensureManagedExtensionsLoaded(wc, '刷新当前标签页');
        if (currentUrl && currentUrl !== rawUrl) {
          wc.loadURL(currentUrl);
        } else {
          wc.reloadIgnoringCache();
        }
        sendToSide('active-tab-refreshed', { ok: true, url: currentUrl });
      } else {
        logger.log?.('刷新', '没有激活标签页可刷新');
        sendToSide('active-tab-refreshed', { ok: false, reason: 'no_active_tab' });
      }
    } catch (e) {
      logger.log?.('刷新错误', e);
      sendToSide('active-tab-refreshed', { ok: false, reason: e.message });
    }
  }

// 渲染/刷新：refreshTab的具体业务逻辑。
  async function refreshTab(tabId) {
    try {
      const tabs = resolveTabs();
      if (!tabs.has(tabId)) {
        return { ok: false, message: '标签页不存在' };
      }
      const targetTab = tabs.get(tabId);
      const wc = targetTab?.view?.webContents;
      if (!wc || wc.isDestroyed()) {
        return { ok: false, message: '网页不可用' };
      }
      logger.log?.('刷新', `刷新指定标签页 -> ${tabId}`);
      await ensureManagedExtensionsLoaded(wc, `刷新标签 ${tabId}`);
      const rawUrl = String(wc.getURL() || '');
      const currentUrl = (rawUrl);
      if (currentUrl && currentUrl !== rawUrl) {
        wc.loadURL(currentUrl);
      } else {
        wc.reloadIgnoringCache();
      }
      if (tabId === resolveActiveTabId()) {
        try { sendToSide('active-tab-refreshed', { ok: true, url: currentUrl || rawUrl }); } catch (_) {}
      }
      return { ok: true };
    } catch (e) {
      logger.log?.('刷新错误', e);
      return { ok: false, message: e?.message || String(e) };
    }
  }

// 启动/打开/显示：openExtensionPopup的具体业务逻辑。
  async function openExtensionPopup(pluginId) {
    try {
      if (extensionManager && typeof extensionManager.openExtensionPopup === 'function') {
        return await extensionManager.openExtensionPopup(pluginId);
      }
      return { ok: false, message: '插件管理器不可用' };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  }

// 启动/打开/显示：openExtensionOptions的具体业务逻辑。
  async function openExtensionOptions(pluginId) {
    try {
      if (extensionManager && typeof extensionManager.openExtensionOptions === 'function') {
        return await extensionManager.openExtensionOptions(pluginId);
      }
      return { ok: false, message: '插件管理器不可用' };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  }

  return {
    addTab,
    applyClashMiniBrowserProxy,
    setTabBrowserProxyMode,
    switchTab,
    closeTab,
    reorderTab,
    setTabAccountId,
    setZoom,
    refreshActiveTabToUrl,
    refreshActiveTab,
    refreshTab,
    openExtensionPopup,
    openExtensionOptions,
    getActiveWC,
    toggleSidebar,
  };
}

module.exports = {
  createTabManager,
};
