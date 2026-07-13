const {
  getClashMiniStatus,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
} = require('../ipc/register/clash-mini-core');
const { normalizeTabBrowserProxyMode } = require('../utils/normalizers');
const {
  normalizeAiFreeBrowserSettings,
  parseCookieJson,
  parseLaunchArgs,
} = require('../utils/ai-free-browser-settings');
const {
  buildDefaultManagedTabPartitionName,
  buildManagedTabPartitionName,
  getActiveTabWebContents,
  toggleSidebarVisibility,
} = require('./tab-common');

function resolveChromiumExtensionPaths(browserSettings = {}, extensionManager = null) {
  const configuredExtensionPaths = Array.isArray(browserSettings.chromiumExtensionPaths)
    ? browserSettings.chromiumExtensionPaths
    : [];
  const managedExtensionPaths = extensionManager
    && typeof extensionManager.getEnabledExtensionPaths === 'function'
    ? extensionManager.getEnabledExtensionPaths()
    : [];
  return Array.from(new Set(
    [...managedExtensionPaths, ...configuredExtensionPaths]
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  ));
}

function resolveConfiguredBrowserProxy(browserSettings = {}) {
  const proxy = browserSettings.proxy && typeof browserSettings.proxy === 'object' ? browserSettings.proxy : {};
  if (proxy.mode === 'default') return null;
  if (proxy.mode === 'none') return { enabled: false };
  const host = String(proxy.host || '').trim();
  const port = Number(proxy.port);
  if (proxy.mode !== 'custom' || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { enabled: false };
  }
  const protocol = String(proxy.protocol || 'http').toLowerCase();
  return {
    enabled: true,
    protocol,
    server: `${protocol}://${host}:${port}`,
    bypassRules: '<local>;127.0.0.1;localhost;::1',
    username: String(proxy.username || ''),
    password: String(proxy.password || ''),
  };
}

function resolveConfiguredHomepage(browserSettings = {}, fallback = '') {
  const homepage = browserSettings.homepage && typeof browserSettings.homepage === 'object' ? browserSettings.homepage : {};
  return homepage.mode === 'custom' && String(homepage.url || '').trim()
    ? String(homepage.url).trim()
    : fallback;
}

function resolveChromiumExtraArgs(browserSettings = {}) {
  const args = parseLaunchArgs(browserSettings);
  if (browserSettings.hardwareAcceleration === false && !args.includes('--disable-gpu')) args.push('--disable-gpu');
  return args;
}

// 创建/初始化：createTabManager的具体业务逻辑。
function createTabManager(deps = {}) {
  const DEFAULT_TUTORIAL_URL = 'https://www.baidu.com/';
  const {
    BrowserWindow,
    BrowserView,
    browserRuntimeManager,
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
  const isChromiumTab = (tab) => String(tab?.runtimeType || '') === 'chromium';

  function readPersistedBrowserSettings() {
    try {
      const storePath = typeof getStorePath === 'function' ? getStorePath() : '';
      if (!storePath || !fs?.existsSync?.(storePath)) return {};
      const store = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
      return store.aiFreeBrowserSettings && typeof store.aiFreeBrowserSettings === 'object'
        ? store.aiFreeBrowserSettings
        : {};
    } catch (_) {
      return {};
    }
  }

  if (browserRuntimeManager?.chromium?.on) {
    browserRuntimeManager.chromium.on('state-changed', (runtimeState) => {
      const tab = resolveTabs().get(String(runtimeState?.profileId || ''));
      if (!tab) return;
      tab.runtimeStatus = runtimeState.status;
      tab.runtimeError = runtimeState.lastError || null;
      updateTabs(true);
    });
    browserRuntimeManager.chromium.on('crashed', (runtimeState) => {
      const tab = resolveTabs().get(String(runtimeState?.profileId || ''));
      if (!tab) return;
      tab.runtimeStatus = 'crashed';
      tab.runtimeError = runtimeState.lastError || null;
      updateTabs(true);
    });
    browserRuntimeManager.chromium.on('runtime-event', (event) => {
      const tab = resolveTabs().get(String(event?.profileId || ''));
      if (!tab) return;
      if (event.type === 'title-changed') tab.runtimeTitle = String(event.title || '').trim();
      if (event.type === 'url-changed') tab.runtimeUrl = String(event.url || '').trim();
      updateTabs();
    });
  }
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

// 启动/打开/显示：openTutorialTab 的具体业务逻辑。
  const openTutorialTab = () => addTab(resolveDefaultTabUrl(), {
    browserProxyMode: 'direct',
    browserSettings: {
      region: 'cn',
      locale: 'zh-CN',
      acceptLanguage: 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

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
    const partitionName = accountId
      ? buildManagedTabPartitionName(accountId)
      : buildDefaultManagedTabPartitionName();
    const partition = options.partition || `persist:${partitionName}`;
    const refreshAfterLoad = options.refreshAfterLoad === true;
    const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
      ? licenseCache.getRuntimeConfig()
      : {};
    const rawBrowserSettings = {
      ...(runtimeConfig && typeof runtimeConfig.browserSettings === 'object' ? runtimeConfig.browserSettings : {}),
      ...readPersistedBrowserSettings(),
      ...(options.browserSettings && typeof options.browserSettings === 'object' ? options.browserSettings : {}),
    };
    const browserSettings = { ...rawBrowserSettings, ...normalizeAiFreeBrowserSettings(rawBrowserSettings) };
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
    const configuredBrowserProxy = resolveConfiguredBrowserProxy(browserSettings);
    const requestedRuntimeType = browserRuntimeManager
      ? browserRuntimeManager.resolveType({ runtimeType: options.runtimeType || browserSettings.runtimeType })
      : 'electron';
    if (requestedRuntimeType === 'chromium') {
      const chromiumExtensionPaths = resolveChromiumExtensionPaths(browserSettings, extensionManager);
      let initialUrl = options.deferChromiumNavigation === true
        ? 'about:blank'
        : (url || resolveConfiguredHomepage(browserSettings, resolveDefaultTabUrl()));
      const effectiveProxy = configuredBrowserProxy || resolveTabBrowserProxy({ browserProxyMode }, browserProxy, true);
      const [contentWidth, contentHeight] = mainWindow.getContentSize();
      const sidebarWidth = resolveIsSidebarVisible() ? Math.floor(contentWidth * 0.3) : 0;
      const bounds = { x: 0, y: 41, width: contentWidth - sidebarWidth, height: Math.max(0, contentHeight - 41) };
      const chromiumTab = {
        id: newTabId,
        view: null,
        zoomFactor: 1,
        partition,
        accountId,
        fixedTitle,
        runtimeTitle: fixedTitle || 'AI-FREE',
        runtimeType: 'chromium',
        runtimeStatus: 'starting',
        browserProxyMode,
        browserProfile,
        browserSettings,
      };
      resolveTabs().set(newTabId, chromiumTab);
      try {
        const runtimeState = await browserRuntimeManager.launchProfile({
          profileId: newTabId,
          runtimeType: 'chromium',
          displayName: fixedTitle,
          initialUrl,
          locale: browserProfile?.locale,
          userAgent: browserProfile?.userAgent,
          proxyServer: effectiveProxy?.enabled ? effectiveProxy.server : '',
          proxyBypassList: effectiveProxy?.bypassRules || '',
          extraArgs: resolveChromiumExtraArgs(browserSettings),
          executablePath: browserSettings.chromiumExecutablePath,
          extensionPaths: chromiumExtensionPaths,
          allowPrototypeWindowDiscovery: browserSettings.allowPrototypeWindowDiscovery === true,
          remoteDebuggingPipe: browserSettings.remoteDebuggingPipe === true,
        }, bounds);
        chromiumTab.runtimeStatus = runtimeState.status;
        const configuredCookies = parseCookieJson(browserSettings);
        if (configuredCookies.length && typeof browserRuntimeManager.setCookies === 'function') {
          try { await browserRuntimeManager.setCookies(newTabId, configuredCookies); } catch (error) { logger.warn?.('[ChromiumRuntime] AI-FREE Cookie 注入失败:', error?.message || error); }
        }
        switchTab(newTabId);
        return newTabId;
      } catch (error) {
        resolveTabs().delete(newTabId);
        const prototypeMode = String(process.env.AI_FREE_CHROMIUM_HANDSHAKE || '').trim().toLowerCase() === 'prototype';
        const runtimeRequiredByEnv = /^(1|true|yes|on)$/i.test(String(process.env.AI_FREE_CHROMIUM_REQUIRED || '').trim());
        if (!prototypeMode || options.runtimeRequired === true || browserSettings.runtimeRequired === true || runtimeRequiredByEnv) {
          logger.error?.('[ChromiumRuntime] 正式 Fork 启动失败，禁止回退到 Electron/System Chrome:', error?.message || error);
          throw error;
        }
        logger.warn?.('[ChromiumRuntime] prototype 启动失败，回退到 Electron BrowserView:', error?.message || error);
      }
    }
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
      runtimeType: 'electron',
      runtimeStatus: 'ready',
      browserProxyMode,
      browserSettings,
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
        browserProxy: configuredBrowserProxy || resolveTabBrowserProxy({ browserProxyMode }, browserProxy, true),
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
      const currentSourceTab = resolveTabs().get(newTabId);
      addTab(childUrl, { partition, browserSettings: currentSourceTab?.browserSettings || browserSettings });
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
    const configuredCookies = parseCookieJson(browserSettings);
    if (configuredCookies.length) {
      try { await resolveAuth()?.setCookiesToSession(newView.webContents.session, configuredCookies); } catch (e) { logger.warn?.('AI-FREE Cookie 注入失败:', e?.message || e); }
    }

    if (Array.isArray(options.browserStorage) && options.browserStorage.length) {
      try { resolveAuth()?.applyBrowserStorageToPage(newView.webContents, options.browserStorage); } catch (e) { logger.warn?.('BrowserStorage 注入失败:', e?.message || e); }
    }

    let initialUrl = url;
    if (!initialUrl) {
      try {
        initialUrl = resolveConfiguredHomepage(browserSettings, resolveDefaultTabUrl());
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
      const previousTab = tabs.get(activeTabId);
      if (isChromiumTab(previousTab)) {
        void browserRuntimeManager?.hide(previousTab.id, 'chromium');
      } else {
        try { mainWindow.removeBrowserView(previousTab.view); } catch (_) {}
      }
    }

    if (typeof setActiveTabId === 'function') {
      setActiveTabId(tabId);
    }

    const activeTab = tabs.get(tabId);
    if (isChromiumTab(activeTab)) {
      void browserRuntimeManager?.show(activeTab.id, 'chromium').then(() => browserRuntimeManager.focus(activeTab.id, 'chromium')).catch((error) => {
        logger.warn?.('[ChromiumRuntime] 显示环境失败:', error?.message || error);
      });
      mainWindow.emit('resize');
      updateTabs(true);
      return;
    }
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
    if (isChromiumTab(tabToClose)) {
      try { await browserRuntimeManager?.stop(tabToClose.id, 'chromium', { timeoutMs: 4000 }); } catch (error) { logger.warn?.('[ChromiumRuntime] 关闭失败:', error?.message || error); }
    }
    try { if (tabToClose?.view?.webContents && !tabToClose.view.webContents.isDestroyed()) tabToClose.view.webContents.destroy(); } catch (_) {}
    try { mainWindow.removeBrowserView(tabToClose.view); } catch (_) {}
    tabs.delete(tabId);
    if (closedAccountId) {
      try {
        sendToSide('tab-closed', { tabId, accountId: closedAccountId });
      } catch (_) {}
    }

    const remaining = Array.from(tabs.keys());
    if (remaining.length === 0) {
      // 以实际标签数量为准，不依赖可能尚未同步的 activeTabId。
      // 这样无论通过关闭按钮、中键还是其它 IPC 路径关闭最后一页，
      // 主窗口都会立即恢复为教程页，不会留下空白内容区。
      if (typeof setActiveTabId === 'function') {
        setActiveTabId(null);
      }
      await openTutorialTab();
    } else if (resolveActiveTabId() === tabId) {
      const preferredLeftId = orderedTabIds[closeIndex - 1];
      const preferredRightId = orderedTabIds[closeIndex + 1];
      const nextTabId = remaining.includes(preferredLeftId) ? preferredLeftId : (remaining.includes(preferredRightId) ? preferredRightId : remaining[0]);
      switchTab(nextTabId);
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
    if (activeTab && !isChromiumTab(activeTab)) {
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
      const activeTab = resolveTabs().get(resolveActiveTabId());
      if (isChromiumTab(activeTab)) {
        await browserRuntimeManager.navigate(activeTab.id, 'chromium', url);
        sendToSide('active-tab-refreshed', { ok: true, url, runtimeType: 'chromium' });
        return;
      }
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
      const activeTab = resolveTabs().get(resolveActiveTabId());
      if (isChromiumTab(activeTab)) {
        await browserRuntimeManager.reload(activeTab.id, 'chromium');
        sendToSide('active-tab-refreshed', { ok: true, runtimeType: 'chromium' });
        return;
      }
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
      if (isChromiumTab(targetTab)) {
        await browserRuntimeManager.reload(targetTab.id, 'chromium');
        return { ok: true };
      }
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

// 设置/更新/持久化：把可视化指纹设置应用到指定标签页。
  async function setTabBrowserSettings(tabId, settings, options = {}) {
    try {
      const tabs = resolveTabs();
      const tab = tabs.get(String(tabId || ''));
      if (!tab) return { ok: false, message: '当前没有可配置的浏览器标签页' };
      const normalized = normalizeAiFreeBrowserSettings(settings);
      const hardwareRestartRequired = tab.browserSettings?.hardwareAcceleration !== undefined
        && tab.browserSettings.hardwareAcceleration !== normalized.hardwareAcceleration;
      const browserProfile = await resolveTabBrowserProfile({
        browserSettings: normalized,
        httpGetUniversal: deps.httpGetUniversal,
        logger,
      });
      tab.browserSettings = { ...(tab.browserSettings || {}), ...normalized };
      tab.browserProfile = browserProfile;
      tabs.set(tab.id, tab);

      if (isChromiumTab(tab)) {
        const configuredProxy = resolveConfiguredBrowserProxy(normalized);
        const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
        if (instance?.profile) {
          instance.profile.locale = browserProfile?.locale || '';
          instance.profile.userAgent = browserProfile?.userAgent || '';
          if (configuredProxy !== null) {
            instance.profile.proxyServer = configuredProxy?.enabled ? configuredProxy.server : '';
            instance.profile.proxyBypassList = configuredProxy?.bypassRules || '';
          }
          instance.profile.extraArgs = resolveChromiumExtraArgs(normalized);
        }
        const configuredCookies = parseCookieJson(normalized);
        if (configuredCookies.length && typeof browserRuntimeManager?.setCookies === 'function') {
          try { await browserRuntimeManager.setCookies(tab.id, configuredCookies); } catch (error) { logger.warn?.('[ChromiumRuntime] AI-FREE Cookie 更新失败:', error?.message || error); }
        }
        if (options.restartChromium === true && browserRuntimeManager) {
          const state = await browserRuntimeManager.restart(tab.id);
          tab.runtimeStatus = state?.status || tab.runtimeStatus;
          updateTabs(true);
          return { ok: true, applied: true, restarted: true, runtimeType: 'chromium' };
        }
        updateTabs(true);
        return { ok: true, applied: false, restartRequired: true, runtimeType: 'chromium' };
      }

      const wc = tab?.view?.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
        return { ok: false, message: '当前标签页已经关闭' };
      }
      const configuredProxy = resolveConfiguredBrowserProxy(normalized);
      const configureOptions = {
        logger,
        browserProfile,
        browserSettings: normalized,
      };
      if (configuredProxy !== null) configureOptions.browserProxy = configuredProxy;
      await configureTabBrowserView(wc, configureOptions);
      const configuredCookies = parseCookieJson(normalized);
      if (configuredCookies.length) await resolveAuth()?.setCookiesToSession(wc.session, configuredCookies);
      updateTabs(true);
      return { ok: true, applied: true, restarted: false, restartRequired: hardwareRestartRequired, runtimeType: 'electron' };
    } catch (error) {
      logger.warn?.('[BrowserSettings] 应用标签参数失败:', error?.message || error);
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
    setTabBrowserSettings,
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
  resolveChromiumExtensionPaths,
};
