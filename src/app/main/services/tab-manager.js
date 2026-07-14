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

function buildBrowserStatusPageUrl(title, message, tone = 'loading') {
  const safeTitle = String(title || '新建窗口').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const safeMessage = String(message || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const isError = tone === 'error';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>
    :root{color-scheme:dark}html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0f1115;color:#e6e8ee;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{text-align:center;padding:28px}.spinner{width:34px;height:34px;margin:0 auto 18px;border:3px solid rgba(77,163,255,.2);border-top-color:${isError ? '#e06666' : '#4da3ff'};border-radius:50%;animation:spin .8s linear infinite}.error .spinner{animation:none;border-color:#e06666}.title{font-size:18px;font-weight:700}.message{margin-top:8px;color:#9aa3b2;font-size:13px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="card${isError ? ' error' : ''}"><div class="spinner"></div><div class="title">${safeTitle}</div><div class="message">${safeMessage}</div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// 创建/初始化：createTabManager的具体业务逻辑。
function createTabManager(deps = {}) {
  const DEFAULT_TUTORIAL_URL = 'https://www.baidu.com/';
  const TUTORIAL_TAB_TITLE = '使用教程[AI-FREE]';
  const {
    browserRuntimeManager,
    fs,
    logger = console,
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
    licenseCache,
    sendToSide,
    updateTabs,
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
// 获取/读取/解析：resolveIsSidebarVisible的具体业务逻辑。
  const resolveIsSidebarVisible = () => (typeof getIsSidebarVisible === 'function' ? getIsSidebarVisible() : true);
  const isChromiumTab = (tab) => String(tab?.runtimeType || '') === 'chromium';

  function refreshBrowserProfileInBackground(tabId, browserSettings) {
    if (typeof resolveTabBrowserProfile !== 'function') return;
    void resolveTabBrowserProfile({
      browserSettings,
      httpGetUniversal: deps.httpGetUniversal,
      logger,
    }).then(async (resolvedProfile) => {
      const tab = resolveTabs().get(String(tabId || ''));
      if (!tab || !resolvedProfile) return;
      tab.browserProfile = resolvedProfile;
      resolveTabs().set(tab.id, tab);
      if (isChromiumTab(tab)) {
        const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
        if (instance?.profile) {
          instance.profile.locale = resolvedProfile.locale || instance.profile.locale;
          instance.profile.userAgent = resolvedProfile.userAgent || instance.profile.userAgent;
        }
      }
      updateTabs(true);
    }).catch((error) => {
      logger.warn?.('[BrowserMask] 后台更新浏览器地区参数失败:', error?.message || error);
    });
  }

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
    fixedTitle: TUTORIAL_TAB_TITLE,
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
      const tabProxy = resolveTabBrowserProxy(tab, browserProxy, enabled === true);
      const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
      if (!instance?.profile) return false;
      instance.profile.proxyServer = tabProxy?.enabled ? String(tabProxy.server || '') : '';
      instance.profile.proxyBypassList = tabProxy?.enabled ? String(tabProxy.bypassRules || '') : '';
      const runtimeState = await browserRuntimeManager.restart(tab.id);
      tab.runtimeStatus = runtimeState?.status || tab.runtimeStatus;
      return true;
    }));

    return {
      ok: true,
      enabled: !!enabled,
      updated: results.filter(Boolean).length,
      total: entries.length,
    };
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
    const browserHistoryId = String(options.browserHistoryId || '').trim();
    const browserProxyMode = normalizeTabBrowserProxyMode(options.browserProxyMode || 'inherit');
    const existingTab = accountId
      ? Array.from(resolveTabs().values()).find((tab) => String(tab?.accountId || '').trim() === accountId)
      : null;
    if (existingTab && existingTab.id) {
      switchTab(existingTab.id);
      return existingTab.id;
    }

    const newTabId = String(options.tabId || accountId || Date.now().toString());
    const partitionName = accountId
      ? buildManagedTabPartitionName(accountId)
      : buildDefaultManagedTabPartitionName();
    const partition = options.partition || `persist:${partitionName}`;
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
          skipGeoLookup: options.resolveProfileInBackground === true,
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
    // 主网页标签只允许走编译好的 AI-FREE Chromium Fork，不接受其他网页运行时。
    const requestedRuntimeType = 'chromium';
    if (requestedRuntimeType === 'chromium') {
      const chromiumExtensionPaths = resolveChromiumExtensionPaths(browserSettings, extensionManager);
      const targetInitialUrl = options.deferChromiumNavigation === true
        ? 'about:blank'
        : (url || resolveConfiguredHomepage(browserSettings, resolveDefaultTabUrl()));
      const initialUrl = options.showLoadingPage === true
        ? buildBrowserStatusPageUrl(fixedTitle || '新建窗口', '正在启动独立浏览器…')
        : targetInitialUrl;
      const effectiveProxy = configuredBrowserProxy || resolveTabBrowserProxy({ browserProxyMode }, browserProxy, true);
      const [contentWidth, contentHeight] = mainWindow.getContentSize();
      const sidebarWidth = resolveIsSidebarVisible() ? Math.floor(contentWidth * 0.3) : 0;
      const bounds = { x: 0, y: 41, width: contentWidth - sidebarWidth, height: Math.max(0, contentHeight - 41) };
      const chromiumTab = {
        id: newTabId,
        zoomFactor: 1,
        partition,
        accountId,
        browserHistoryId,
        fixedTitle,
        runtimeTitle: fixedTitle || 'AI-FREE',
        runtimeType: 'chromium',
        runtimeStatus: 'starting',
        browserProxyMode,
        browserProfile,
        browserSettings,
      };
      resolveTabs().set(newTabId, chromiumTab);
      updateTabs(true);
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
        if (options.showLoadingPage === true && targetInitialUrl && targetInitialUrl !== initialUrl) {
          void browserRuntimeManager.navigate(newTabId, 'chromium', targetInitialUrl).catch((error) => {
            logger.warn?.('[ChromiumRuntime] 新浏览器导航失败:', error?.message || error);
            return browserRuntimeManager.navigate(
              newTabId,
              'chromium',
              buildBrowserStatusPageUrl(fixedTitle || '新建窗口', '页面打开失败，请稍后刷新重试。', 'error'),
            ).catch(() => {});
          });
        }
        if (options.resolveProfileInBackground === true) {
          refreshBrowserProfileInBackground(newTabId, browserSettings);
        }
        return newTabId;
      } catch (error) {
        resolveTabs().delete(newTabId);
        logger.error?.('[ChromiumRuntime] 内置 AI-FREE Chromium 启动失败，禁止回退到其他网页运行时:', error?.message || error);
        throw error;
      }
    }
    throw new Error('AI-FREE Chromium 运行时未能创建浏览器窗口');
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

      const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
      if (instance?.profile) {
        const tabProxy = resolveTabBrowserProxy(tab, getBrowserProxyEndpoint(), true);
        instance.profile.proxyServer = tabProxy?.enabled ? String(tabProxy.server || '') : '';
        instance.profile.proxyBypassList = tabProxy?.enabled ? String(tabProxy.bypassRules || '') : '';
        const runtimeState = await browserRuntimeManager.restart(tab.id);
        tab.runtimeStatus = runtimeState?.status || tab.runtimeStatus;
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
      void browserRuntimeManager?.hide(previousTab.id, 'chromium');
    }

    if (typeof setActiveTabId === 'function') {
      setActiveTabId(tabId);
    }

    const activeTab = tabs.get(tabId);
    void browserRuntimeManager?.show(activeTab.id, 'chromium').then(() => browserRuntimeManager.focus(activeTab.id, 'chromium')).catch((error) => {
      logger.warn?.('[ChromiumRuntime] 显示环境失败:', error?.message || error);
    });
    mainWindow.emit('resize');
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
    const closedAccountId = String(tabToClose?.accountId || '').trim();
    try { await browserRuntimeManager?.stop(tabToClose.id, 'chromium', { timeoutMs: 4000 }); } catch (error) { logger.warn?.('[ChromiumRuntime] 关闭失败:', error?.message || error); }
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
        session: null,
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
      activeTab.zoomFactor = zoomFactor;
    }
    try { sendToSide('active-zoom', zoomFactor); } catch (_) {}
  }

// 渲染/刷新：refreshActiveTabToUrl的具体业务逻辑。
  async function refreshActiveTabToUrl(url) {
    try {
      const activeTab = resolveTabs().get(resolveActiveTabId());
      if (activeTab) {
        await browserRuntimeManager.navigate(activeTab.id, 'chromium', url);
        sendToSide('active-tab-refreshed', { ok: true, url, runtimeType: 'chromium' });
        return;
      }
      logger.log?.('刷新', '没有激活标签页可刷新');
      sendToSide('active-tab-refreshed', { ok: false, reason: 'no_active_tab' });
    } catch (e) {
      logger.log?.('刷新错误', e);
      sendToSide('active-tab-refreshed', { ok: false, reason: e.message });
    }
  }

// 渲染/刷新：refreshActiveTab的具体业务逻辑。
  async function refreshActiveTab() {
    try {
      const activeTab = resolveTabs().get(resolveActiveTabId());
      if (activeTab) {
        await browserRuntimeManager.reload(activeTab.id, 'chromium');
        sendToSide('active-tab-refreshed', { ok: true, runtimeType: 'chromium' });
        return;
      }
      logger.log?.('刷新', '没有激活标签页可刷新');
      sendToSide('active-tab-refreshed', { ok: false, reason: 'no_active_tab' });
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
      await browserRuntimeManager.reload(targetTab.id, 'chromium');
      if (tabId === resolveActiveTabId()) {
        try { sendToSide('active-tab-refreshed', { ok: true, runtimeType: 'chromium' }); } catch (_) {}
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

// 设置/更新/持久化：更新独立浏览器窗口名称。
  function renameTab(tabId, title) {
    try {
      const normalizedTabId = String(tabId || '').trim();
      const normalizedTitle = String(title || '').trim();
      if (!normalizedTabId || !normalizedTitle) {
        return { ok: false, message: '浏览器名称不能为空' };
      }
      const tabs = resolveTabs();
      const tab = tabs.get(normalizedTabId);
      if (!tab) return { ok: false, message: '浏览器窗口不存在' };
      tab.fixedTitle = normalizedTitle;
      tab.runtimeTitle = normalizedTitle;
      tabs.set(normalizedTabId, tab);
      updateTabs(true);
      return { ok: true, tabId: normalizedTabId, title: normalizedTitle };
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
      const browserProfile = await resolveTabBrowserProfile({
        browserSettings: normalized,
        httpGetUniversal: deps.httpGetUniversal,
        logger,
      });
      tab.browserSettings = { ...(tab.browserSettings || {}), ...normalized };
      tab.browserProfile = browserProfile;
      tabs.set(tab.id, tab);

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
    } catch (error) {
      logger.warn?.('[BrowserSettings] 应用标签参数失败:', error?.message || error);
      return { ok: false, message: error?.message || String(error) };
    }
  }

// Chromium Fork 的扩展清单来自启动参数，因此必须带着新清单重启 Profile。
  async function refreshBrowsersAfterExtensionChange(change = {}) {
    const entries = Array.from(resolveTabs().values());
    let chromiumRestarted = 0;
    const failures = [];

    for (const tab of entries) {
      try {
        const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
        if (!instance?.profile) continue;
        instance.profile.extensionPaths = resolveChromiumExtensionPaths(tab.browserSettings || {}, extensionManager);
        const runtimeState = await browserRuntimeManager.restart(tab.id);
        tab.runtimeStatus = runtimeState?.status || tab.runtimeStatus;
        chromiumRestarted += 1;
      } catch (error) {
        failures.push({ tabId: String(tab.id || ''), runtimeType: 'chromium', message: error?.message || String(error) });
        logger.warn?.(`[Extensions] Chromium 环境 ${tab.id} 刷新失败:`, error?.message || error);
      }
    }

    const result = {
      ok: failures.length === 0,
      pluginId: String(change?.plugin?.id || ''),
      enabled: change?.enabled === true,
      chromiumRestarted,
      total: chromiumRestarted,
      failures,
    };
    updateTabs(true);
    try { sendToSide('extension-browsers-refreshed', result); } catch (_) {}
    return result;
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
    refreshBrowsersAfterExtensionChange,
    switchTab,
    closeTab,
    reorderTab,
    renameTab,
    setTabAccountId,
    setZoom,
    refreshActiveTabToUrl,
    refreshActiveTab,
    refreshTab,
    openExtensionPopup,
    openExtensionOptions,
    toggleSidebar,
  };
}

module.exports = {
  createTabManager,
  resolveChromiumExtensionPaths,
};
