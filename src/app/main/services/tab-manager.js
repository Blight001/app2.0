const {
  getClashMiniStatus,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
} = require('../ipc/register/clash-mini-core');
const {
  normalizeAiFreeBrowserSettings,
  parseCookieJson,
  parseLaunchArgs,
} = require('../utils/ai-free-browser-settings');
const {
  toggleSidebarVisibility,
} = require('./tab-common');
const { FREE_BROWSER_WINDOW_LIMIT, resolveVipAccess } = require('../utils/vip-access');

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

function buildAppliedBrowserEnvironment(profile = {}) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    browserBrand: String(profile.browserBrand || '').trim(),
    browserType: String(profile.browserType || '').trim(),
    browserVersion: String(profile.browserVersion || '').trim(),
    majorVersion: String(profile.majorVersion || '').trim(),
    region: String(profile.region || '').trim(),
    regionLabel: String(profile.regionLabel || '').trim(),
    sourceIp: String(profile.sourceIp || '').trim(),
    sourceCountryCode: String(profile.sourceCountryCode || '').trim(),
    sourceCountry: String(profile.sourceCountry || '').trim(),
    sourceRegion: String(profile.sourceRegion || '').trim(),
    sourceCity: String(profile.sourceCity || '').trim(),
    locale: String(profile.locale || '').trim(),
    timezoneId: String(profile.timezoneId || '').trim(),
    acceptLanguage: String(profile.acceptLanguage || '').trim(),
    userAgent: String(profile.userAgent || '').trim(),
    uaBrands: Array.isArray(profile.uaBrands)
      ? profile.uaBrands.map((item) => ({
        brand: String(item?.brand || '').trim(),
        version: String(item?.version || '').trim(),
      })).filter((item) => item.brand)
      : [],
  };
}

function buildAppliedBrowserSettings(settings = {}) {
  if (!settings || typeof settings !== 'object') return null;
  let cookieCount = 0;
  try {
    const cookies = JSON.parse(String(settings.cookies || '[]'));
    cookieCount = Array.isArray(cookies) ? cookies.length : 0;
  } catch (_) {}
  const copyMode = (value, fallback = '') => String(value || fallback).trim();
  return {
    os: copyMode(settings.os, 'win11'),
    browserVersion: copyMode(settings.browserVersion),
    kernelVersion: copyMode(settings.kernelVersion, 'auto'),
    proxy: {
      mode: copyMode(settings.proxy?.mode, 'default'),
      protocol: copyMode(settings.proxy?.protocol, 'http'),
      host: copyMode(settings.proxy?.host),
      port: settings.proxy?.port === '' || settings.proxy?.port == null ? '' : Number(settings.proxy.port),
      authenticationConfigured: !!String(settings.proxy?.username || settings.proxy?.password || '').trim(),
      apiConfigured: !!String(settings.proxy?.apiUrl || '').trim(),
    },
    cookieCount,
    homepage: { mode: copyMode(settings.homepage?.mode, 'default'), url: copyMode(settings.homepage?.url) },
    ua: { mode: copyMode(settings.ua?.mode, 'default') },
    secChUa: {
      mode: copyMode(settings.secChUa?.mode, 'default'),
      brands: Array.isArray(settings.secChUa?.brands)
        ? settings.secChUa.brands.map((item) => ({
          brand: String(item?.brand || '').trim(),
          version: String(item?.version || '').trim(),
        })).filter((item) => item.brand)
        : [],
    },
    language: { mode: copyMode(settings.language?.mode, 'ip'), value: copyMode(settings.language?.value) },
    timezone: { mode: copyMode(settings.timezone?.mode, 'ip'), value: copyMode(settings.timezone?.value) },
    webrtc: { mode: copyMode(settings.webrtc?.mode, 'replace') },
    geolocation: {
      permission: copyMode(settings.geolocation?.permission, 'ask'),
      mode: copyMode(settings.geolocation?.mode, 'ip'),
      longitude: Number(settings.geolocation?.longitude) || 0,
      latitude: Number(settings.geolocation?.latitude) || 0,
      accuracy: Math.max(1, Number(settings.geolocation?.accuracy) || 100),
    },
    resolution: {
      mode: copyMode(settings.resolution?.mode, 'follow'),
      width: Math.max(0, Number(settings.resolution?.width) || 0),
      height: Math.max(0, Number(settings.resolution?.height) || 0),
    },
    fonts: { mode: copyMode(settings.fonts?.mode, 'system') },
    canvas: { mode: copyMode(settings.canvas?.mode, 'default') },
    webglImage: { mode: copyMode(settings.webglImage?.mode, 'default') },
    webglMetadata: {
      mode: copyMode(settings.webglMetadata?.mode, 'default'),
      vendor: copyMode(settings.webglMetadata?.vendor),
      renderer: copyMode(settings.webglMetadata?.renderer),
    },
    webgpu: { mode: copyMode(settings.webgpu?.mode, 'default') },
    audioContext: { mode: copyMode(settings.audioContext?.mode, 'default') },
    clientRects: { mode: copyMode(settings.clientRects?.mode, 'default') },
    speechVoices: { mode: copyMode(settings.speechVoices?.mode, 'default') },
    cpu: Math.max(1, Number(settings.cpu) || 1),
    memory: Math.max(1, Number(settings.memory) || 1),
    deviceName: { mode: copyMode(settings.deviceName?.mode, 'default'), value: copyMode(settings.deviceName?.value) },
    macAddress: { mode: copyMode(settings.macAddress?.mode, 'default'), value: copyMode(settings.macAddress?.value) },
    doNotTrack: settings.doNotTrack === true,
    sslEnabled: settings.sslEnabled === true,
    portScanProtection: {
      enabled: settings.portScanProtection?.enabled === true,
      allowList: Array.isArray(settings.portScanProtection?.allowList)
        ? settings.portScanProtection.allowList.map((item) => Number(item)).filter(Number.isFinite)
        : [],
    },
    hardwareAcceleration: settings.hardwareAcceleration !== false,
    launchArgs: {
      mode: copyMode(settings.launchArgs?.mode, 'default'),
      value: copyMode(settings.launchArgs?.value),
    },
  };
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
  const DEFAULT_TUTORIAL_URL = 'https://www.yuque.com/kelingaishipindian/tx5gwq/xbsl692ls9xope0e?singleDoc#';
  const DEFAULT_BROWSER_TAB_URL = 'chrome://newtab/';
  const TUTORIAL_TAB_TITLE = '使用教程[AI-FREE]';
  const MINIMUM_BROWSER_TAB_ID = '1';
  const {
    browserRuntimeManager,
    fs,
    logger = console,
    extensionManager,
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
  let tutorialTabOpeningPromise = null;
  let minimumBrowserOpeningPromise = null;
  const closingTabIds = new Set();

// 获取/读取/解析：resolveTabs的具体业务逻辑。
  const resolveTabs = () => (typeof getTabs === 'function' ? getTabs() : new Map());
// 获取/读取/解析：resolveMainWindow的具体业务逻辑。
  const resolveMainWindow = () => (typeof getMainWindow === 'function' ? getMainWindow() : null);
// 获取/读取/解析：resolveSideView的具体业务逻辑。
  const resolveSideView = () => (typeof getSideView === 'function' ? getSideView() : null);
  const isSideViewFocused = () => {
    const webContents = resolveSideView()?.webContents;
    return !!(webContents && !webContents.isDestroyed?.() && webContents.isFocused?.());
  };
  const restoreSideViewFocus = () => {
    const mainWindow = resolveMainWindow();
    const webContents = resolveSideView()?.webContents;
    if (!webContents || webContents.isDestroyed?.()) return false;
    try {
      if (mainWindow && !mainWindow.isDestroyed?.() && !mainWindow.isFocused?.()) {
        mainWindow.focus?.();
      }
      // The external Chromium HWND is outside Electron's WebContents focus
      // bookkeeping. Even when the sidebar is reported as focused, reset the
      // native input target through the shell before returning to the side view.
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed?.()) {
        mainWindow.webContents.focus?.();
      }
      webContents.focus();
      return true;
    } catch (_) {
      return false;
    }
  };
// 获取/读取/解析：resolveActiveTabId的具体业务逻辑。
  const resolveActiveTabId = () => (typeof getActiveTabId === 'function' ? getActiveTabId() : null);
// 获取/读取/解析：resolveIsSidebarVisible的具体业务逻辑。
  const resolveIsSidebarVisible = () => (typeof getIsSidebarVisible === 'function' ? getIsSidebarVisible() : true);

  // 只有已经落盘过的 Chromium Profile 才能恢复上次会话。首次创建时仍打开
  // 调用方给出的首页，避免 --restore-last-session 把首屏变成空白新标签页。
  function hasPersistedChromiumProfile(profileId) {
    try {
      const runtimeStore = browserRuntimeManager?.store;
      if (!runtimeStore || typeof runtimeStore.readProfile !== 'function') return false;
      const profile = runtimeStore.readProfile(String(profileId || ''));
      return !!(profile && typeof profile === 'object' && profile.createdAt);
    } catch (_) {
      return false;
    }
  }
  const isChromiumTab = (tab) => String(tab?.runtimeType || '') === 'chromium';

  // 首探 + 最多 2 次重探；仅在“IP 跟随”模式且出口 IP 落空时重试。
  const MAX_PROFILE_REFRESH_ATTEMPTS = 3;
  const PROFILE_REFRESH_RETRY_DELAY_MS = 4000;
  function refreshBrowserProfileInBackground(tabId, browserSettings, attempt = 0) {
    if (typeof resolveTabBrowserProfile !== 'function') return;
    // 非 IP 跟随（固定地区）本就不带出口 IP，重探无意义，避免无谓请求。
    const wantsIpFollow = ['language', 'timezone', 'geolocation']
      .some((key) => browserSettings?.[key]?.mode === 'ip');
    const scheduleRetry = () => {
      if (!wantsIpFollow || attempt + 1 >= MAX_PROFILE_REFRESH_ATTEMPTS) return;
      setTimeout(
        () => refreshBrowserProfileInBackground(tabId, browserSettings, attempt + 1),
        PROFILE_REFRESH_RETRY_DELAY_MS,
      );
    };
    void resolveTabBrowserProfile({
      browserSettings,
      httpGetUniversal: deps.httpGetUniversal,
      logger,
      // 浏览器启动期间用户可能刚切换系统代理/VPN。即使没有软件内置代理，
      // 也必须绕过最多 5 分钟的旧出口缓存，首探就读取当前网络。
      forceGeoLookup: true,
    }).then(async (resolvedProfile) => {
      const tab = resolveTabs().get(String(tabId || ''));
      if (!tab || !resolvedProfile) return;
      tab.browserProfile = resolvedProfile;
      resolveTabs().set(tab.id, tab);
      if (isChromiumTab(tab)) {
        const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
        if (instance?.profile) {
          instance.profile.locale = resolvedProfile.locale || instance.profile.locale;
          instance.profile.acceptLanguage = resolvedProfile.acceptLanguage || instance.profile.acceptLanguage;
          instance.profile.timezoneId = resolvedProfile.timezoneId || instance.profile.timezoneId;
          instance.profile.userAgent = resolvedProfile.userAgent || instance.profile.userAgent;
        }
        // 后台探测不会重启 Chromium，只能更新真实网络出口；语言、时区、UA
        // 仍以 appliedProfile 中本次进程的启动快照为准。
        if (instance?.appliedProfile) {
          const previous = instance.appliedProfile.browserEnvironment || {};
          instance.appliedProfile.browserEnvironment = {
            ...previous,
            region: String(resolvedProfile.region || '').trim(),
            regionLabel: String(resolvedProfile.regionLabel || '').trim(),
            sourceIp: String(resolvedProfile.sourceIp || '').trim(),
            sourceCountryCode: String(resolvedProfile.sourceCountryCode || '').trim(),
            sourceCountry: String(resolvedProfile.sourceCountry || '').trim(),
            sourceRegion: String(resolvedProfile.sourceRegion || '').trim(),
            sourceCity: String(resolvedProfile.sourceCity || '').trim(),
          };
        }
      }
      updateTabs(true);
      // 直连出口探测可能瞬时超时导致来源 IP 落空，延时重探，避免整场会话停留在“自动”。
      if (!String(resolvedProfile.sourceIp || '').trim()) scheduleRetry();
    }).catch((error) => {
      logger.warn?.('[BrowserMask] 后台更新浏览器地区参数失败:', error?.message || error);
      scheduleRetry();
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
      const tabId = String(runtimeState?.profileId || '');
      const tab = resolveTabs().get(tabId);
      if (!tab) return;
      tab.runtimeStatus = 'crashed';
      tab.runtimeError = runtimeState.lastError || null;
      updateTabs(true);
      // Chromium 被用户关闭、进程异常退出或嵌入窗口失效时，
      // 应同步移除对应的软件栏目。延后到当前运行时事件返回后
      // 再清理，避免在 markCrashed 的同步 emit 过程中重入 stop。
      if (global._isShuttingDown === true) return;
      setImmediate(() => {
        if (global._isShuttingDown === true
          || !resolveTabs().has(tabId)
          || closingTabIds.has(tabId)) return;
        void closeTab(tabId).catch((error) => {
          logger.warn?.('[ChromiumRuntime] 浏览器退出后关闭栏目失败:', error?.message || error);
        });
      });
    });
    browserRuntimeManager.chromium.on('runtime-event', (event) => {
      const tab = resolveTabs().get(String(event?.profileId || ''));
      if (!tab) return;
      if (event.type === 'title-changed') tab.runtimeTitle = String(event.title || '').trim();
      if (event.type === 'url-changed') tab.runtimeUrl = String(event.url || '').trim();
      updateTabs();
    });
  }
// 获取/读取/解析：读取服务器下发的教程地址。
  const resolveConfiguredTutorialUrl = () => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const tutorialUrl = String(runtimeConfig.tutorialUrl || '').trim();
      if (tutorialUrl) return tutorialUrl;
    } catch (_) {}
    return '';
  };

  // 教程地址只能由 openTutorialTab() 显式使用。普通浏览器的 URL 为空时
  // 必须回到 Chromium 新标签页，不能把服务器教程地址当成通用主页。
  const resolveDefaultTabUrl = () => DEFAULT_BROWSER_TAB_URL;

  function readTutorialHistoryRecord() {
    try {
      const storePath = typeof getStorePath === 'function' ? getStorePath() : '';
      if (!storePath || !fs?.existsSync?.(storePath)) return null;
      const store = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
      const matches = (Array.isArray(store?.browserHistory) ? store.browserHistory : [])
        .filter((item) => item?.kind === 'tutorial' || String(item?.name || '').trim() === TUTORIAL_TAB_TITLE)
        .sort((left, right) => Number(right?.lastOpenedAt || 0) - Number(left?.lastOpenedAt || 0));
      const record = matches[0];
      if (!record?.id) return null;
      return {
        id: String(record.id).trim(),
        url: String(record.url || '').trim(),
        settings: normalizeAiFreeBrowserSettings(record.settings || {}),
      };
    } catch (_) {
      return null;
    }
  }

// 启动/打开/显示：openTutorialTab 的具体业务逻辑。
  async function openTutorialTab(requestedUrl = '', options = {}) {
    const requestedTutorialUrl = String(requestedUrl || '').trim();
    const requestedTabId = String(options.tabId || '').trim();
    // Showing an embedded Chromium HWND must not imply keyboard focus. The
    // caller has to opt in explicitly; an actual click inside Chromium still
    // focuses it through the native child-window mouse activation path.
    const focusBrowser = options.focusBrowser === true;
    // Chromium 创建顶层窗口后再嵌入，启动瞬间也可能被 Windows 激活。
    // 仅在调用前侧栏确实持有焦点时恢复，避免打断正在操作网页的用户。
    const shouldRestoreSideFocus = !focusBrowser
      && (options.restoreSideFocus === true || isSideViewFocused());
    const restorePreviousFocus = () => {
      if (!shouldRestoreSideFocus) return;
      restoreSideViewFocus();
      setImmediate(restoreSideViewFocus);
    };
    const existingTab = Array.from(resolveTabs().values()).find(
      (tab) => tab?.isTutorialTab === true
        || String(tab?.fixedTitle || tab?.runtimeTitle || '').trim() === TUTORIAL_TAB_TITLE,
    );
    const navigateExistingTab = async (tabId) => {
      const targetUrl = requestedTutorialUrl || resolveConfiguredTutorialUrl();
      if (targetUrl) {
        try {
          await browserRuntimeManager.navigate(tabId, 'chromium', targetUrl);
        } catch (error) {
          logger.warn?.('[教程] 更新服务器下发地址失败:', error?.message || error);
        }
      }
      switchTab(tabId, { focusBrowser });
      restorePreviousFocus();
      return tabId;
    };

    if (existingTab?.id) return navigateExistingTab(existingTab.id);
    if (tutorialTabOpeningPromise) {
      const openingTabId = await tutorialTabOpeningPromise;
      return openingTabId ? navigateExistingTab(openingTabId) : null;
    }

    tutorialTabOpeningPromise = (async () => {
      const historyRecord = readTutorialHistoryRecord();
      const targetUrl = requestedTutorialUrl
        || resolveConfiguredTutorialUrl()
        || historyRecord?.url
        || DEFAULT_TUTORIAL_URL;
      const historyId = String(historyRecord?.id || '').trim();
      const tutorialTabId = requestedTabId || (historyId
        ? `browser-tab-${historyId.replace(/[^a-z0-9_-]/gi, '_')}`
        : 'browser-tab-tutorial-default');
      return addTab(targetUrl, {
        tabId: tutorialTabId,
        fixedTitle: TUTORIAL_TAB_TITLE,
        isTutorialTab: true,
        browserHistoryId: historyId,
        // 教程窗口每次启动都必须进入教程地址，不能恢复到上次关闭前的
        // 空白页、跳转页或其它浏览记录。
        restoreLastSession: false,
        focusBrowser,
        browserSettings: {
          ...(historyRecord?.settings || {}),
          region: 'cn',
          locale: 'zh-CN',
          acceptLanguage: 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
    })();

    try {
      const tabId = await tutorialTabOpeningPromise;
      restorePreviousFocus();
      return tabId;
    } finally {
      tutorialTabOpeningPromise = null;
    }
  }

  // 浏览器管理器始终保留至少一个窗口。关闭最后一个窗口后，
  // 固定使用 ID 1 重建默认浏览器；共享 Promise 避免并发关闭重复创建。
  async function ensureMinimumBrowserTab() {
    const tabs = resolveTabs();
    if (tabs.size > 0) return String(tabs.keys().next().value || '');
    if (minimumBrowserOpeningPromise) return minimumBrowserOpeningPromise;

    if (typeof setActiveTabId === 'function') setActiveTabId(null);
    minimumBrowserOpeningPromise = addTab(DEFAULT_BROWSER_TAB_URL, {
      tabId: MINIMUM_BROWSER_TAB_ID,
      fixedTitle: '新建窗口',
      focusBrowser: false,
      showLoadingPage: true,
      restoreLastSession: false,
    });
    try {
      return await minimumBrowserOpeningPromise;
    } finally {
      minimumBrowserOpeningPromise = null;
    }
  }

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

// 设置/更新/持久化：applyClashMiniBrowserProxy的具体业务逻辑。
  async function applyClashMiniBrowserProxy(enabled = true, options = {}) {
    const entries = Array.from(resolveTabs().values());
    const browserProxy = getBrowserProxyEndpoint();
    const failures = [];
    const forceProfileRefresh = options?.forceProfileRefresh === true;

    // 应用退出时由生命周期统一关闭 Chromium。此处若继续切换代理并重启实例，
    // 会和 stopAll 竞争，还可能让刚关闭的浏览器再次连到即将退出的 Mihomo。
    if (global._isShuttingDown === true) {
      return { ok: true, enabled: false, updated: 0, total: entries.length, failures, skipped: true };
    }

    const results = await Promise.all(entries.map(async (tab) => {
      try {
        // 网络魔法是全局开关：开启时所有 Chromium 统一走 Clash Mini，
        // 关闭时统一清空，不能被单标签模式或历史代理配置覆盖。
        const tabProxy = enabled === true ? (browserProxy || { enabled: false }) : { enabled: false };
        const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
        if (!instance?.profile) {
          tab.networkMagicApplied = false;
          return false;
        }
        const nextProxyServer = tabProxy?.enabled ? String(tabProxy.server || '') : '';
        const nextProxyBypassList = tabProxy?.enabled ? String(tabProxy.bypassRules || '') : '';
        const proxyChanged = String(instance.profile.proxyServer || '') !== nextProxyServer
          || String(instance.profile.proxyBypassList || '') !== nextProxyBypassList;
        let runtimeProfileChanged = false;
        if (typeof resolveTabBrowserProfile === 'function' && (proxyChanged || forceProfileRefresh)) {
          const previousProfile = tab.browserProfile && typeof tab.browserProfile === 'object'
            ? tab.browserProfile
            : {};
          const resolvedProfile = await resolveTabBrowserProfile({
            browserSettings: tab.browserSettings || {},
            httpGetUniversal: deps.httpGetUniversal,
            logger,
            geoProxyServer: tabProxy?.enabled ? String(tabProxy.server || '') : '',
            forceGeoLookup: true,
          });
          // 代理出口探测失败时 resolveTabBrowserProfile 会返回直连地区作为展示兜底。
          // 这个兜底不能覆盖当前已应用的代理环境，更不能在代理地址未变化时触发一次重启。
          const profileUsable = resolvedProfile
            && (!nextProxyServer || resolvedProfile.proxyExitVerified !== false);
          if (profileUsable) {
            // sourceIp 变化只更新状态展示，不影响 Chromium 的语言/时区环境，
            // 避免同一地区的出口 IP 轮换也造成整个浏览器重启。
            runtimeProfileChanged = [
              'region', 'locale', 'timezoneId', 'acceptLanguage',
            ].some((key) => String(previousProfile[key] || '') !== String(resolvedProfile[key] || ''));
            tab.browserProfile = resolvedProfile;
            instance.profile.locale = resolvedProfile.locale || instance.profile.locale;
            instance.profile.acceptLanguage = resolvedProfile.acceptLanguage || instance.profile.acceptLanguage;
            instance.profile.timezoneId = resolvedProfile.timezoneId || instance.profile.timezoneId;
            instance.profile.userAgent = resolvedProfile.userAgent || instance.profile.userAgent;
            instance.profile.browserEnvironment = buildAppliedBrowserEnvironment(resolvedProfile);
          } else if (resolvedProfile?.proxyExitVerified === false) {
            logger.warn?.(
              `[ChromiumRuntime] 标签 ${tab.id} 的代理出口地区探测失败，保留当前浏览器环境且不因本次探测重启`,
            );
          }
        }
        // 代理和地区都没有变化时不重启；自动/手动换节点导致出口变化时，
        // 即便代理地址仍是 127.0.0.1:7890，也要重启以应用新语言和时区。
        if (!proxyChanged && !runtimeProfileChanged) {
          tab.networkMagicApplied = enabled === true && !!nextProxyServer;
          return false;
        }
        instance.profile.proxyServer = nextProxyServer;
        instance.profile.proxyBypassList = nextProxyBypassList;
        if (global._isShuttingDown === true) return false;
        const runtimeState = await browserRuntimeManager.restart(tab.id);
        tab.runtimeStatus = runtimeState?.status || tab.runtimeStatus;
        tab.networkMagicApplied = enabled === true && !!nextProxyServer;
        return true;
      } catch (error) {
        tab.networkMagicApplied = false;
        const failure = { tabId: String(tab.id || ''), message: error?.message || String(error) };
        failures.push(failure);
        logger.warn?.(`[ChromiumRuntime] 网络魔法代理切换后重启失败 ${failure.tabId}:`, failure.message);
        return false;
      }
    }));

    updateTabs(true);

    return {
      ok: failures.length === 0,
      enabled: !!enabled,
      updated: results.filter(Boolean).length,
      total: entries.length,
      failures,
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
    const existingTab = accountId
      ? Array.from(resolveTabs().values()).find((tab) => String(tab?.accountId || '').trim() === accountId)
      : null;
    if (existingTab && existingTab.id) {
      switchTab(existingTab.id, { focusBrowser: options.focusBrowser === true });
      return existingTab.id;
    }

    const vipAccess = resolveVipAccess(licenseCache?.getSnapshot?.() || {});
    if (!vipAccess.isVip && resolveTabs().size >= FREE_BROWSER_WINDOW_LIMIT) {
      try {
        sendToSide?.('vip-access-required', {
          feature: '更多独立浏览器窗口',
          limit: FREE_BROWSER_WINDOW_LIMIT,
        });
      } catch (_) {}
      const error = new Error(`普通用户最多同时打开 ${FREE_BROWSER_WINDOW_LIMIT} 个独立浏览器窗口，请前往个人中心开通 VIP`);
      error.code = 'VIP_BROWSER_WINDOW_LIMIT';
      error.vipRequired = true;
      throw error;
    }

    const newTabId = String(options.tabId || accountId || Date.now().toString());
    const restoreLastSession = options.restoreLastSession === true
      && hasPersistedChromiumProfile(newTabId);
    const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
      ? licenseCache.getRuntimeConfig()
      : {};
    const rawBrowserSettings = {
      ...(runtimeConfig && typeof runtimeConfig.browserSettings === 'object' ? runtimeConfig.browserSettings : {}),
      ...readPersistedBrowserSettings(),
      ...(options.browserSettings && typeof options.browserSettings === 'object' ? options.browserSettings : {}),
    };
    const browserSettings = { ...rawBrowserSettings, ...normalizeAiFreeBrowserSettings(rawBrowserSettings) };
    const clashMiniStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
    const shouldApplyClashMiniProxy = clashMiniStatus?.running === true && clashMiniStatus?.enabled === true;
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
    const effectiveProxy = shouldApplyClashMiniProxy
      ? (browserProxy || { enabled: false })
      : (configuredBrowserProxy || { enabled: false });
    // 主网页标签只允许走编译好的 AI-FREE Chromium Fork，不接受其他网页运行时。
    const requestedRuntimeType = 'chromium';
    if (requestedRuntimeType === 'chromium') {
      const chromiumExtensionPaths = resolveChromiumExtensionPaths(browserSettings, extensionManager);
      const targetInitialUrl = restoreLastSession
        ? ''
        : options.deferChromiumNavigation === true
        ? 'about:blank'
        : (url || resolveConfiguredHomepage(browserSettings, resolveDefaultTabUrl()));
      // chrome://newtab/ 是“让 Chromium 自己新建标签页”的意图，
      // 不先打开 data:text/html 启动占位页。不传 URL 启动
      // Chromium 比启动后再导航到 chrome:// 内部页更可靠。
      const opensNativeNewTab = /^chrome:\/\/newtab\/?$/i.test(targetInitialUrl);
      const initialUrl = restoreLastSession
        ? ''
        : opensNativeNewTab
        ? ''
        : options.showLoadingPage === true
        ? buildBrowserStatusPageUrl(fixedTitle || '新建窗口', '正在启动独立浏览器…')
        : targetInitialUrl;
      const [contentWidth, contentHeight] = mainWindow.getContentSize();
      const sidebarWidth = resolveIsSidebarVisible() ? Math.floor(contentWidth * 0.3) : 0;
      const bounds = { x: 0, y: 41, width: contentWidth - sidebarWidth, height: Math.max(0, contentHeight - 41) };
      const chromiumTab = {
        id: newTabId,
        zoomFactor: 1,
        accountId,
        browserHistoryId,
        isTutorialTab: options.isTutorialTab === true,
        fixedTitle,
        runtimeTitle: fixedTitle || 'AI-FREE',
        requestedUrl: String(url || '').trim(),
        runtimeUrl: targetInitialUrl && targetInitialUrl !== 'about:blank' ? targetInitialUrl : '',
        runtimeType: 'chromium',
        runtimeStatus: 'starting',
        networkMagicApplied: shouldApplyClashMiniProxy && effectiveProxy?.enabled === true,
        browserProfile: null,
        browserSettings,
      };
      const previouslyActiveTabId = String(resolveActiveTabId() || '');
      const assertCreationStillActive = () => {
        if (resolveTabs().get(newTabId) === chromiumTab) return;
        const error = new Error('浏览器栏目已在创建过程中关闭');
        error.code = 'BROWSER_TAB_CREATION_CANCELLED';
        throw error;
      };
      // 先同步发布“正在启动”的栏目并切换选中状态，再做地区探测、进程
      // 启动等慢操作。这样 IPC 可立即返回，用户也能立刻看到创建反馈。
      resolveTabs().set(newTabId, chromiumTab);
      updateTabs(true);
      switchTab(newTabId, { focusBrowser: false });
      try {
        const browserProfile = typeof resolveTabBrowserProfile === 'function'
          ? await resolveTabBrowserProfile({
              browserSettings,
              httpGetUniversal: deps.httpGetUniversal,
              logger,
              skipGeoLookup: options.resolveProfileInBackground === true && effectiveProxy?.enabled !== true,
              geoProxyServer: effectiveProxy?.enabled ? effectiveProxy.server : '',
              forceGeoLookup: effectiveProxy?.enabled === true,
            })
          : null;
        assertCreationStillActive();
        chromiumTab.browserProfile = browserProfile;
        const runtimeState = await browserRuntimeManager.launchProfile({
          profileId: newTabId,
          runtimeType: 'chromium',
          displayName: fixedTitle,
          initialUrl,
          restoreLastSession,
          // Session 文件若被旧版内核写成“全部标签已关闭”，至少回退到该
          // 浏览器记录的网址，而不是向用户显示不可恢复的空白页。
          restoreFallbackUrl: String(url || '').trim(),
          locale: browserProfile?.locale,
          acceptLanguage: browserProfile?.acceptLanguage,
          timezoneId: browserProfile?.timezoneId,
          userAgent: browserProfile?.userAgent,
          browserEnvironment: buildAppliedBrowserEnvironment(browserProfile),
          browserSettingsSnapshot: buildAppliedBrowserSettings(browserSettings),
          proxyServer: effectiveProxy?.enabled ? effectiveProxy.server : '',
          proxyBypassList: effectiveProxy?.bypassRules || '',
          extraArgs: resolveChromiumExtraArgs(browserSettings),
          executablePath: browserSettings.chromiumExecutablePath,
          extensionPaths: chromiumExtensionPaths,
          allowPrototypeWindowDiscovery: browserSettings.allowPrototypeWindowDiscovery === true,
          remoteDebuggingPipe: browserSettings.remoteDebuggingPipe === true,
        }, bounds);
        if (resolveTabs().get(newTabId) !== chromiumTab) {
          try { await browserRuntimeManager.stop(newTabId, 'chromium', { timeoutMs: 4000 }); } catch (_) {}
          assertCreationStillActive();
        }
        chromiumTab.runtimeStatus = runtimeState.status;
        const configuredCookies = parseCookieJson(browserSettings);
        if (configuredCookies.length && typeof browserRuntimeManager.setCookies === 'function') {
          try { await browserRuntimeManager.setCookies(newTabId, configuredCookies); } catch (error) { logger.warn?.('[ChromiumRuntime] AI-FREE Cookie 注入失败:', error?.message || error); }
        }
        switchTab(newTabId, { focusBrowser: options.focusBrowser === true });
        if (options.showLoadingPage === true
          && !opensNativeNewTab
          && targetInitialUrl
          && targetInitialUrl !== initialUrl) {
          void browserRuntimeManager.navigate(newTabId, 'chromium', targetInitialUrl).catch((error) => {
            logger.warn?.('[ChromiumRuntime] 新浏览器导航失败:', error?.message || error);
            return browserRuntimeManager.navigate(
              newTabId,
              'chromium',
              buildBrowserStatusPageUrl(fixedTitle || '新建窗口', '页面打开失败，请稍后刷新重试。', 'error'),
            ).catch(() => {});
          });
        }
        if (options.resolveProfileInBackground === true && effectiveProxy?.enabled !== true) {
          refreshBrowserProfileInBackground(newTabId, browserSettings);
        }
        return newTabId;
      } catch (error) {
        const tabs = resolveTabs();
        if (tabs.get(newTabId) === chromiumTab) tabs.delete(newTabId);
        if (String(resolveActiveTabId() || '') === newTabId) {
          const fallbackTabId = tabs.has(previouslyActiveTabId)
            ? previouslyActiveTabId
            : String(tabs.keys().next().value || '');
          if (fallbackTabId) switchTab(fallbackTabId);
          else {
            if (typeof setActiveTabId === 'function') setActiveTabId(null);
            updateTabs(true);
          }
        } else {
          updateTabs(true);
        }
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

// 处理：switchTab的具体业务逻辑。
  function switchTab(tabId, options = {}) {
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
    // Do not turn a visibility/tab-selection change into a native Win32 focus
    // transfer. This keeps the shell and sidebar editable until the user
    // actually clicks the webpage (or a caller explicitly requests focus).
    const focusBrowser = options.focusBrowser === true;
    void browserRuntimeManager?.show(activeTab.id, 'chromium').then(() => {
      // 显示 Chromium 时不能把 Win32 键盘焦点从 shell/侧栏抢走；只有
      // 明确传入 focusBrowser: true 的调用方才允许聚焦网页。
      if (focusBrowser) return browserRuntimeManager.focus(activeTab.id, 'chromium');
      return false;
    }).catch((error) => {
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
    if (closingTabIds.has(tabId)) return;
    closingTabIds.add(tabId);

    try {
      const orderedTabIds = Array.from(tabs.keys());
      const closeIndex = orderedTabIds.indexOf(tabId);
      const tabToClose = tabs.get(tabId);
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
        await ensureMinimumBrowserTab();
      } else if (resolveActiveTabId() === tabId) {
        const preferredLeftId = orderedTabIds[closeIndex - 1];
        const preferredRightId = orderedTabIds[closeIndex + 1];
        const nextTabId = remaining.includes(preferredLeftId) ? preferredLeftId : (remaining.includes(preferredRightId) ? preferredRightId : remaining[0]);
        switchTab(nextTabId);
      }
      updateTabs(true);
    } finally {
      closingTabIds.delete(tabId);
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
      const configuredProxy = resolveConfiguredBrowserProxy(normalized);
      const clashStatus = typeof getClashMiniStatus === 'function' ? getClashMiniStatus() : null;
      const globalMagicEnabled = clashStatus?.running === true && clashStatus?.enabled === true;
      const effectiveProxy = globalMagicEnabled
        ? (getBrowserProxyEndpoint() || { enabled: false })
        : (configuredProxy || { enabled: false });
      const browserProfile = await resolveTabBrowserProfile({
        browserSettings: normalized,
        httpGetUniversal: deps.httpGetUniversal,
        logger,
        geoProxyServer: effectiveProxy?.enabled ? effectiveProxy.server : '',
        forceGeoLookup: true,
      });
      tab.browserSettings = { ...(tab.browserSettings || {}), ...normalized };
      tab.browserProfile = browserProfile;
      tabs.set(tab.id, tab);

      const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(tab.id));
      if (instance?.profile) {
        instance.profile.locale = browserProfile?.locale || '';
        instance.profile.acceptLanguage = browserProfile?.acceptLanguage || '';
        instance.profile.timezoneId = browserProfile?.timezoneId || '';
        instance.profile.userAgent = browserProfile?.userAgent || '';
        instance.profile.browserEnvironment = buildAppliedBrowserEnvironment(browserProfile);
        instance.profile.browserSettingsSnapshot = buildAppliedBrowserSettings(normalized);
        instance.profile.proxyServer = effectiveProxy?.enabled ? effectiveProxy.server : '';
        instance.profile.proxyBypassList = effectiveProxy?.enabled ? (effectiveProxy.bypassRules || '') : '';
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

  return {
    addTab,
    openTutorialTab,
    applyClashMiniBrowserProxy,
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
    toggleSidebar,
  };
}

module.exports = {
  createTabManager,
  resolveChromiumExtensionPaths,
};
