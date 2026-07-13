const { createAnnouncementPoller } = require('../lib/announcement-poller');
const { removeDirectoryWithRetries } = require('../utils/fs-cleanup');

// 创建/初始化：createAppShell的具体业务逻辑。
function createAppShell(deps = {}) {
  const {
    app,
    fs,
    path,
    BrowserWindow,
    BrowserView,
    dialog,
    isDevMode = false,
    Menu,
    logger = console,
    FIXED_ICON_RELATIVE_PATH,
    APP_DISPLAY_NAME,
    state,
    auth,
    createAuthCookie,
    createHttpClient,
    loadTranslateExtension,
    attachContextMenu,
    initDownloadPrefs,
    injectZoomWheelListener,
    checkDesktopShortcutAndPrompt,
    initializeAccountCleanup,
    refreshAllowedPlatformsAndNotify,
    resetRuntimeTutorialUrlState,
    registerIPC,
    stopClashMiniProcess,
    getStorePath,
    getServerBase,
    getSideUrl,
    getTcpConfig,
    setRuntimeTcpConfig,
    setRuntimeServerBase,
    getDreamTargetUrl,
    setDreamTargetUrl,
    DREAM_TARGET_URL,
    getCurrentPlatformLabel,
    appendLicenseRecord,
    readStoreConfigSafe,
    writeStoreConfigSafe,
    applyPluginSettings,
    computeDeviceId,
    getAuth,
    setAuth,
    getAddTab,
    getSwitchTab,
    getCloseTab,
    getReorderTab,
    getSetTabAccountId,
    getSetTabBrowserProxyMode,
    getSetTabBrowserSettings,
    getSetZoom,
    getRefreshActiveTabToUrl,
    getRefreshActiveTab,
    getRefreshTab,
    getOpenExtensionPopup,
    getOpenExtensionOptions,
    extensionManager,
    updateTabs,
    getActiveWC,
    toggleSidebar,
    sendToSide,
    startAppUpdate,
    getAppVersion,
    getTabs,
    getMainWindow,
    setMainWindow,
    resolveAppIconPath,
    getSideView,
    setSideView,
    getConsoleWindow,
    setConsoleWindow,
    getControlPanelWindow,
    setControlPanelWindow,
    getLicenseWindow,
    setLicenseWindow,
    getActiveTabId,
    setActiveTabId,
    getExtPopupWin,
    setExtPopupWin,
    getIsSidebarVisible,
    setIsSidebarVisible,
    getIsMainBootstrapped,
    setIsMainBootstrapped,
    getIsSwitchingToLicense,
    setIsSwitchingToLicense,
    getLatestAllowedPlatforms,
    setLatestAllowedPlatforms,
    licenseCache,
    getGlobalHttpClient,
    setGlobalHttpClient,
    cleanupBrowserSessionData,
    purgeBrowserSessionData,
    buildManagedTabPartitionName,
    cleanupAllBrowserSessionData,
    cleanupBrowserPartitionsRootDir,
    accountStorage,
    shortcutManager,
    extIdBySession,
    clearInjectionRecord,
    getAppConsoleHistory,
    statePluginGetter = () => state?.pluginSettings || {},
  } = deps;

  let controlPanelWindow = null;
  let announcementPoller = null;
  let sideAnnouncementReady = false;
  let hasFinishedInitialSidebarLoad = false;

  // 公告只投递到已完成加载的侧边栏。若页面仍在加载则返回 false，
  // 让轮询器保留为未送达，避免启动轮询与 did-finish-load 竞态造成重复弹窗。
  const sendAnnouncementToSide = (channel, payload) => {
    try {
      const sideView = typeof getSideView === 'function' ? getSideView() : null;
      const webContents = sideView?.webContents;
      if (!sideAnnouncementReady || !webContents || webContents.isDestroyed()) return false;
      if (typeof webContents.isLoadingMainFrame === 'function' && webContents.isLoadingMainFrame()) {
        return false;
      }
      webContents.send(channel, payload);
      return true;
    } catch (_) {
      return false;
    }
  };

  const canPollAnnouncements = () => {
    try {
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : null;
      return snapshot?.validated === true;
    } catch (_) {
      return false;
    }
  };

  const ensureAnnouncementPoller = () => {
    if (!announcementPoller) {
      announcementPoller = createAnnouncementPoller({
        getJson: deps.getJson,
        postJson: deps.postJson,
        getServerBase,
        getClientIdentity: () => {
          const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
            ? licenseCache.getSnapshot()
            : null;
          return {
            key: snapshot?.key || '',
            deviceId: snapshot?.deviceId || '',
          };
        },
        shouldPoll: canPollAnnouncements,
        sendToSide: sendAnnouncementToSide,
        logger,
      });
    }
    return announcementPoller;
  };

// 获取/读取/解析：resolveMainWindow的具体业务逻辑。
  const resolveMainWindow = () => (typeof getMainWindow === 'function' ? getMainWindow() : null);
// 获取/读取/解析：resolveSideView的具体业务逻辑。
  const resolveSideView = () => (typeof getSideView === 'function' ? getSideView() : null);
// 获取/读取/解析：resolveControlPanelWindow的具体业务逻辑。
  const resolveControlPanelWindow = () => {
    if (typeof getControlPanelWindow === 'function') {
      return getControlPanelWindow();
    }
    return controlPanelWindow;
  };
  const resolveSidebarRemoteUrl = () => {
    const raw = typeof getSideUrl === 'function' ? getSideUrl() : '';
    const normalized = String(raw || '').trim();
    return normalized || 'http://127.0.0.1:8787/control-panel/';
  };
// 格式化/规范化：isControlPanelModeEnabled的具体业务逻辑。
  const isControlPanelModeEnabled = () => (
    process.argv.some((arg) => ['--control-panel', '--control-panel-only'].includes(String(arg || '').trim().toLowerCase()))
    || String(process.env.APP_BOOT_MODE || '').trim().toLowerCase() === 'control-panel'
    || String(process.env.APP_BOOT_MODE || '').trim().toLowerCase() === 'control-panel-only'
    || String(process.env.CONTROL_PANEL_MODE || '').trim().toLowerCase() === '1'
    || String(process.env.CONTROL_PANEL_MODE || '').trim().toLowerCase() === 'true'
  );
// 格式化/规范化：isControlPanelOnlyModeEnabled的具体业务逻辑。
  const isControlPanelOnlyModeEnabled = () => (
    process.argv.some((arg) => String(arg || '').trim().toLowerCase() === '--control-panel-only')
    || String(process.env.APP_BOOT_MODE || '').trim().toLowerCase() === 'control-panel-only'
    || String(process.env.CONTROL_PANEL_ONLY || '').trim().toLowerCase() === '1'
    || String(process.env.CONTROL_PANEL_ONLY || '').trim().toLowerCase() === 'true'
  );
// 获取/读取/解析：resolveControlPanelHtmlPath的具体业务逻辑。
// 侧边栏页面现内置于 src/app/sidebar/（随 src/** 一起打包），不再依赖顶层 control-panel 目录/端口服务。
  const resolveControlPanelHtmlPath = () => {
    const candidates = [
      path.join(__dirname, '../../sidebar/index.html'),
      path.join(app.getAppPath ? app.getAppPath() : '', 'src', 'app', 'sidebar', 'index.html'),
      path.join(process.cwd(), 'src', 'app', 'sidebar', 'index.html'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (_) {}
    }
    return null;
  };
// 获取/读取/解析：resolveLicenseWindow的具体业务逻辑。
  const resolveLicenseWindow = () => (typeof getLicenseWindow === 'function' ? getLicenseWindow() : null);
// 获取/读取/解析：resolveExtPopupWin的具体业务逻辑。
  const resolveExtPopupWin = () => (typeof getExtPopupWin === 'function' ? getExtPopupWin() : null);
// 获取/读取/解析：resolveTabs的具体业务逻辑。
  const resolveTabs = () => (typeof getTabs === 'function' ? getTabs() : new Map());
// 获取/读取/解析：resolveActiveTabId的具体业务逻辑。
  const resolveActiveTabId = () => (typeof getActiveTabId === 'function' ? getActiveTabId() : null);
// 获取/读取/解析：resolveAddTab的具体业务逻辑。
  const resolveAddTab = () => (typeof getAddTab === 'function' ? getAddTab() : null);
// 获取/读取/解析：resolveSwitchTab的具体业务逻辑。
  const resolveSwitchTab = () => (typeof getSwitchTab === 'function' ? getSwitchTab() : null);
// 获取/读取/解析：resolveCloseTab的具体业务逻辑。
  const resolveCloseTab = () => (typeof getCloseTab === 'function' ? getCloseTab() : null);
// 获取/读取/解析：resolveReorderTab的具体业务逻辑。
  const resolveReorderTab = () => (typeof getReorderTab === 'function' ? getReorderTab() : null);
// 获取/读取/解析：resolveSetTabAccountId的具体业务逻辑。
  const resolveSetTabAccountId = () => (typeof getSetTabAccountId === 'function' ? getSetTabAccountId() : null);
// 获取/读取/解析：resolveSetTabBrowserProxyMode的具体业务逻辑。
  const resolveSetTabBrowserProxyMode = () => (typeof getSetTabBrowserProxyMode === 'function' ? getSetTabBrowserProxyMode() : null);
  const resolveSetTabBrowserSettings = () => (typeof getSetTabBrowserSettings === 'function' ? getSetTabBrowserSettings() : null);
// 获取/读取/解析：resolveSetZoom的具体业务逻辑。
  const resolveSetZoom = () => (typeof getSetZoom === 'function' ? getSetZoom() : null);
// 获取/读取/解析：resolveRefreshActiveTabToUrl的具体业务逻辑。
  const resolveRefreshActiveTabToUrl = () => (typeof getRefreshActiveTabToUrl === 'function' ? getRefreshActiveTabToUrl() : null);
// 获取/读取/解析：resolveRefreshActiveTab的具体业务逻辑。
  const resolveRefreshActiveTab = () => (typeof getRefreshActiveTab === 'function' ? getRefreshActiveTab() : null);
// 获取/读取/解析：resolveRefreshTab的具体业务逻辑。
  const resolveRefreshTab = () => (typeof getRefreshTab === 'function' ? getRefreshTab() : null);
// 获取/读取/解析：resolveOpenExtensionPopup的具体业务逻辑。
  const resolveOpenExtensionPopup = () => (typeof getOpenExtensionPopup === 'function' ? getOpenExtensionPopup() : null);
// 获取/读取/解析：resolveOpenExtensionOptions的具体业务逻辑。
  const resolveOpenExtensionOptions = () => (typeof getOpenExtensionOptions === 'function' ? getOpenExtensionOptions() : null);
// 获取/读取/解析：resolveAuth的具体业务逻辑。
  const resolveAuth = () => (typeof getAuth === 'function' ? getAuth() : auth);
  const resolveGlobalHttpClient = () => (typeof getGlobalHttpClient === 'function' ? getGlobalHttpClient() : null);
// 获取/读取/解析：resolveIsMainBootstrapped的具体业务逻辑。
  const resolveIsMainBootstrapped = () => (typeof getIsMainBootstrapped === 'function' ? getIsMainBootstrapped() : false);
// 获取/读取/解析：resolveIsSwitchingToLicense的具体业务逻辑。
  const resolveIsSwitchingToLicense = () => (typeof getIsSwitchingToLicense === 'function' ? getIsSwitchingToLicense() : false);
// 获取/读取/解析：resolveLatestAllowedPlatforms的具体业务逻辑。
  const resolveLatestAllowedPlatforms = () => (typeof getLatestAllowedPlatforms === 'function' ? getLatestAllowedPlatforms() : []);
// 停止/关闭/清理：clearLicenseCacheValidation的具体业务逻辑。
  const clearLicenseCacheValidation = () => {
    try {
      if (deps.licenseCache && typeof deps.licenseCache.clearValidationState === 'function') {
        deps.licenseCache.clearValidationState();
      }
    } catch (e) {
      logger.warn?.('[启动] 清理卡密缓存失败:', e?.message || e);
    }
  };

// 处理：sleep的具体业务逻辑。
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 创建/初始化：createLicenseWindow的具体业务逻辑。
  function createLicenseWindow() {
    const iconPath = typeof resolveAppIconPath === 'function'
      ? resolveAppIconPath()
      : path.join(__dirname, '../../../', FIXED_ICON_RELATIVE_PATH);

    const licenseWindow = new BrowserWindow({
      width: 1120,
      height: 760,
      resizable: false,
      title: `${APP_DISPLAY_NAME} - 卡密搜索`,
      icon: iconPath,
      backgroundColor: '#050807',
      show: false,
      frame: true,
      titleBarStyle: 'default',
      autoHideMenuBar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    setLicenseWindow?.(licenseWindow);
    licenseWindow.setMenu(null);
    licenseWindow.loadFile(path.join(__dirname, '../../views/license.html'));
    licenseWindow.once('ready-to-show', () => {
      try {
        if (licenseWindow.isDestroyed()) return;
        licenseWindow.show();
      } catch (e) {
        logger.warn?.('[启动] 首屏卡密窗口显示失败:', e?.message || e);
      }
    });
    licenseWindow.on('closed', () => {
      if (typeof setLicenseWindow === 'function') {
        setLicenseWindow(null);
      }

      // 调试窗口是独立顶层窗口；未验证时直接关闭卡密窗口后，它会阻止
      // window-all-closed 触发。此时主动退出，让 before-quit 统一关闭调试
      // 窗口并执行其余清理。验证成功进入主界面后的程序化关闭不退出应用。
      if (!resolveIsMainBootstrapped()) {
        try {
          app.quit();
        } catch (e) {
          logger.warn?.('[启动] 关闭卡密窗口后退出应用失败:', e?.message || e);
        }
      }
    });

    return licenseWindow;
  }

// 创建/初始化：createDevConsoleWindow的具体业务逻辑。
  function createDevConsoleWindow() {
    if (!isDevMode) {
      return null;
    }

    const existing = typeof getConsoleWindow === 'function' ? getConsoleWindow() : null;
    if (existing && !existing.isDestroyed()) {
      return existing;
    }

    const iconPath = typeof resolveAppIconPath === 'function'
      ? resolveAppIconPath()
      : path.join(__dirname, '../../../', FIXED_ICON_RELATIVE_PATH);

    const consoleWindow = new BrowserWindow({
      width: 760,
      height: 860,
      title: `${APP_DISPLAY_NAME} - 调试控制台`,
      icon: iconPath,
      backgroundColor: '#0e1116',
      show: false,
      frame: true,
      titleBarStyle: 'default',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    if (typeof setConsoleWindow === 'function') {
      setConsoleWindow(consoleWindow);
    }

    try {
      consoleWindow.setMenu(null);
      consoleWindow.setMenuBarVisibility(false);
    } catch (e) {
      logger.warn?.('[启动] 控制台窗口菜单清理失败:', e?.message || e);
    }

    consoleWindow.loadFile(path.join(__dirname, '../views/dev-console.html'));
    consoleWindow.once('ready-to-show', () => {
      try {
        if (!consoleWindow.isDestroyed()) {
          consoleWindow.show();
        }
      } catch (e) {
        logger.warn?.('[启动] 调试控制台窗口显示失败:', e?.message || e);
      }
    });
    consoleWindow.on('closed', () => {
      if (typeof setConsoleWindow === 'function') {
        setConsoleWindow(null);
      }
    });
    consoleWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      logger.warn?.('[启动] 调试控制台加载失败:', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });

    return consoleWindow;
  }

// 创建/初始化：createControlPanelWindow的具体业务逻辑。
  function createControlPanelWindow() {
    if (!isControlPanelModeEnabled()) {
      return null;
    }

    const existing = resolveControlPanelWindow();
    if (existing && !existing.isDestroyed()) {
      try {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      } catch (_) {}
      return existing;
    }

    const iconPath = typeof resolveAppIconPath === 'function'
      ? resolveAppIconPath()
      : path.join(__dirname, '../../../', FIXED_ICON_RELATIVE_PATH);

    const panelWindow = new BrowserWindow({
      width: 1460,
      height: 1040,
      minWidth: 1200,
      minHeight: 800,
      title: `${APP_DISPLAY_NAME} - 控制页`,
      icon: iconPath,
      backgroundColor: '#0c1016',
      show: false,
      frame: true,
      titleBarStyle: 'default',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    controlPanelWindow = panelWindow;
    if (typeof setControlPanelWindow === 'function') {
      setControlPanelWindow(panelWindow);
    }

    try {
      panelWindow.setMenu(null);
      panelWindow.setMenuBarVisibility(false);
    } catch (e) {
      logger.warn?.('[启动] 控制页窗口菜单清理失败:', e?.message || e);
    }

    const controlPanelPath = resolveControlPanelHtmlPath();
    if (!controlPanelPath) {
      logger.warn?.('[启动] 未找到本地 src/app/sidebar/index.html，跳过控制页窗口加载');
      try {
        panelWindow.close();
      } catch (_) {}
      return null;
    }

    panelWindow.loadFile(controlPanelPath);
    panelWindow.once('ready-to-show', () => {
      try {
        if (!panelWindow.isDestroyed()) {
          panelWindow.show();
          panelWindow.focus();
        }
      } catch (e) {
        logger.warn?.('[启动] 控制页窗口显示失败:', e?.message || e);
      }
    });
    panelWindow.on('closed', () => {
      controlPanelWindow = null;
      if (typeof setControlPanelWindow === 'function') {
        setControlPanelWindow(null);
      }
    });
    panelWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      logger.warn?.('[启动] 控制页加载失败:', {
        errorCode,
        errorDescription,
        validatedURL,
        controlPanelPath,
      });
    });

    return panelWindow;
  }

// 停止/关闭/清理：closeDevConsoleWindow的具体业务逻辑。
  function closeDevConsoleWindow() {
    try {
      const consoleWindow = typeof getConsoleWindow === 'function' ? getConsoleWindow() : null;
      if (consoleWindow && !consoleWindow.isDestroyed()) {
        consoleWindow.close();
      }
    } catch (e) {
      logger.warn?.('[启动] 关闭调试控制台失败:', e?.message || e);
    } finally {
      if (typeof setConsoleWindow === 'function') {
        setConsoleWindow(null);
      }
    }
  }

// 处理：backToLicenseWindow的具体业务逻辑。
  async function backToLicenseWindow() {
    try {
      if (typeof setIsSwitchingToLicense === 'function') {
        setIsSwitchingToLicense(true);
      }

      try {
        if (typeof stopClashMiniProcess === 'function') {
          await stopClashMiniProcess({ sendToSide });
        }
      } catch (clashErr) {
        logger.warn?.('[启动] 返回首页时关闭 Clash Mini 失败:', clashErr?.message || clashErr);
      }

      try {
        await deps.browserRuntimeManager?.stopAll({ timeoutMs: 4000 });
      } catch (runtimeError) {
        logger.warn?.('[ChromiumRuntime] 返回首页时关闭 Profile 失败:', runtimeError?.message || runtimeError);
      }

      resetMainRuntimeForRelicense();
      const licenseWindow = resolveLicenseWindow();
      if (!licenseWindow || licenseWindow.isDestroyed()) {
        createLicenseWindow();
      } else {
        if (licenseWindow.isMinimized()) licenseWindow.restore();
        licenseWindow.show();
        licenseWindow.focus();
      }

      const extPopupWin = resolveExtPopupWin();
      if (extPopupWin && !extPopupWin.isDestroyed()) {
        try { extPopupWin.close(); } catch (_) {}
        if (typeof setExtPopupWin === 'function') {
          setExtPopupWin(null);
        }
      }

      const mainWindow = resolveMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        closeDevConsoleWindow();
        try { mainWindow.close(); } catch (_) {}
      }
      if (typeof setMainWindow === 'function') {
        setMainWindow(null);
      }

      if (typeof setSideView === 'function') setSideView(null);
      if (typeof setActiveTabId === 'function') setActiveTabId(null);
      resolveTabs().clear();

      setTimeout(() => {
        if (typeof setIsSwitchingToLicense === 'function') {
          setIsSwitchingToLicense(false);
        }
      }, 300);

      return { ok: true };
    } catch (e) {
      if (typeof setIsSwitchingToLicense === 'function') {
        setIsSwitchingToLicense(false);
      }
      return { ok: false, message: e?.message || String(e) };
    }
  }

// 创建/初始化：bootstrapMainApp的具体业务逻辑。
  async function bootstrapMainApp() {
    if (resolveIsMainBootstrapped()) {
      if (!resolveMainWindow() || resolveMainWindow().isDestroyed()) {
        createMainWindow();
        revealMainWindow();
      }
      return;
    }
    if (typeof setIsMainBootstrapped === 'function') {
      setIsMainBootstrapped(true);
    }

    try {
      if (!resolveGlobalHttpClient()) {
        const nextClient = createHttpClient({ mainWindow: null });
        if (typeof setGlobalHttpClient === 'function') {
          setGlobalHttpClient(nextClient);
        }
      }
      const httpClient = resolveGlobalHttpClient();
      if (typeof setAuth === 'function') {
        setAuth(createAuthCookie({ serverBase: getServerBase(), httpClient, sendToSide, licenseCache: deps.licenseCache }));
      }
    } catch (e) {
      logger.warn?.('[启动] 初始化HTTP客户端/鉴权失败:', e?.message || e);
    }

    try {
      const runtimeConfig = deps.licenseCache && typeof deps.licenseCache.getRuntimeConfig === 'function'
        ? deps.licenseCache.getRuntimeConfig()
        : {};
      let initialTargetUrl = runtimeConfig.targetUrl || DREAM_TARGET_URL;

      registerIPC({
        app,
        dialog: deps.dialog,
        DREAM_TARGET_URL: initialTargetUrl,
        getDreamTargetUrl: () => getDreamTargetUrl(),
        http: { postJson: deps.postJson, getJson: deps.getJson, httpGetUniversal: deps.httpGetUniversal },
        httpClient: resolveGlobalHttpClient(),
        extensionManager,
        loadTranslateExtension,
        ui: {
          addTab: resolveAddTab(),
          switchTab: resolveSwitchTab(),
          closeTab: resolveCloseTab(),
          setTabAccountId: resolveSetTabAccountId(),
          setTabBrowserProxyMode: resolveSetTabBrowserProxyMode(),
          setTabBrowserSettings: resolveSetTabBrowserSettings(),
          getTabs: () => resolveTabs(),
          getActiveTabId: () => resolveActiveTabId(),
          getActiveWC,
          refreshTab: resolveRefreshTab(),
          reorderTab: resolveReorderTab(),
          setZoom: resolveSetZoom(),
          refreshActiveTabToUrl: resolveRefreshActiveTabToUrl(),
          refreshActiveTab: resolveRefreshActiveTab(),
          toggleSidebar,
          sendToSide,
          startAppUpdate,
          getAppVersion,
          getMainWindow: () => resolveMainWindow(),
          openExtensionPopup: resolveOpenExtensionPopup(),
          openExtensionOptions: resolveOpenExtensionOptions(),
          backToLicenseWindow,
          applyPluginSettings,
          extensionManager,
          statePluginGetter,
          setRuntimeTcpConfig,
          setRuntimeServerBase,
          getTabs: () => resolveTabs(),
          getAppConsoleHistory: () => (typeof getAppConsoleHistory === 'function' ? getAppConsoleHistory() : []),
          ensureSidebarVisible: () => {
            if (!deps.getIsSidebarVisible?.()) {
              toggleSidebar();
            }
          },
          ensureSidebarCollapsed: () => {
            if (deps.getIsSidebarVisible?.()) {
              toggleSidebar();
            }
          },
          purgeBrowserSessionData: typeof purgeBrowserSessionData === 'function'
            ? purgeBrowserSessionData
            : null,
          buildManagedTabPartitionName: typeof buildManagedTabPartitionName === 'function'
            ? buildManagedTabPartitionName
            : null,
          applyClashMiniBrowserProxy: typeof deps.applyClashMiniBrowserProxy === 'function'
            ? deps.applyClashMiniBrowserProxy
            : null,
          browserRuntimeManager: deps.browserRuntimeManager || null,
        },
        auth: resolveAuth(),
        log: deps.log,
        state,
        licenseCache,
        appendLicenseRecord: typeof appendLicenseRecord === 'function' ? appendLicenseRecord : null,
        refreshAllowedPlatformsAndNotify: typeof refreshAllowedPlatformsAndNotify === 'function' ? refreshAllowedPlatformsAndNotify : null,
        refreshAnnouncements: (options = {}) => ensureAnnouncementPoller().refreshNow(options),
        getCurrentPlatformLabel,
      });
      logger.log?.('[启动] IPC handlers 已注册');
    } catch (e) {
      logger.error?.('[启动] 注册 IPC 失败:', e?.message || e);
    }

    // IPC 必须先于渲染进程就绪；主窗口则不再等待扩展扫描和磁盘清理。
    try {
      createMainWindow();
      if (!isControlPanelOnlyModeEnabled()) {
        revealMainWindow();
      }
    } catch (e) {
      logger.warn?.('[启动] 创建主窗口失败:', e?.message || e);
    }

    try {
      if (isDevMode) {
        createDevConsoleWindow();
      }
    } catch (e) {
      logger.warn?.('[启动] 创建调试控制台窗口失败:', e?.message || e);
    }

    void (async () => {
      let runtimeUrlRefreshInFlight = false;

// 渲染/刷新：刷新平台名称与运行时 URL 配置（改为 HTTP，不再依赖 TCP 连接事件）。
      const refreshRuntimeUrls = async () => {
        if (runtimeUrlRefreshInFlight) {
          return;
        }
        runtimeUrlRefreshInFlight = true;
        try {
          if (typeof refreshAllowedPlatformsAndNotify === 'function') {
            await refreshAllowedPlatformsAndNotify();
          }
        } finally {
          runtimeUrlRefreshInFlight = false;
        }
      };

      try {
        // 先让 BrowserWindow 完成首轮绘制，再启动首屏数据同步。
        await new Promise((resolve) => setImmediate(resolve));

        // 必须在创建首个网页标签（尤其是 Chromium Fork 进程）前完成插件扫描。
        // Chromium 只能在进程启动时通过 --load-extension 注册插件；Electron
        // 也只有在首次导航前加载扩展，document_start 内容脚本才会立即注入。
        try {
          if (extensionManager && typeof extensionManager.initialize === 'function') {
            await extensionManager.initialize({ emit: true });
            if (typeof extensionManager.ensureEnabledPluginsLoadedInCurrentSessions === 'function') {
              await extensionManager.ensureEnabledPluginsLoadedInCurrentSessions('启动预加载');
            }
          } else {
            applyPluginSettings({ translateExtEnabled: false });
          }
        } catch (e) {
          logger.warn?.('[启动] 初始化插件开关失败，使用默认值:', e?.message || e);
          applyPluginSettings({ translateExtEnabled: false });
        }

        // 账号回收定时器：卡密已验证时启动。
        try {
          const validationSnapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
            ? licenseCache.getSnapshot()
            : null;
          if (typeof initializeAccountCleanup === 'function' && validationSnapshot && validationSnapshot.validated === true) {
            initializeAccountCleanup(accountStorage, { sendToSide });
          }
        } catch (e) {
          logger.warn?.('[启动] 刷新账号回收定时器失败:', e?.message || e);
        }

        // 插件就绪后再同步运行配置并创建教程标签页，确保首次导航即可注入。
        try {
          await refreshRuntimeUrls();
        } catch (e) {
          logger.warn?.('[启动] 获取URL配置失败:', e?.message || e);
        }

        // 启动公告轮询（替代原 TCP 推送公告）。
        try {
          ensureAnnouncementPoller().start();
        } catch (e) {
          logger.warn?.('[启动] 启动公告轮询失败:', e?.message || e);
        }

        // 磁盘清理放到首屏和教程页启动之后，避免阻塞验证后的窗口切换。
        try {
          const userDataDir = app.getPath('userData');
          const entries = await fs.promises.readdir(userDataDir).catch(() => []);
          const partitionPattern = /^tab-\d+$/;
          const inUsePartitions = new Set(
            Array.from(resolveTabs().values())
              .map((t) => String((t && t.partition) || '').replace(/^persist:/, ''))
              .filter(Boolean),
          );
          for (const name of entries) {
            try {
              if (!partitionPattern.test(name)) continue;
              if (inUsePartitions.has(name)) continue;
              const dirPath = path.join(userDataDir, name);
              const stat = await fs.promises.stat(dirPath).catch(() => null);
              if (!stat || !stat.isDirectory()) continue;
              const deleted = await removeDirectoryWithRetries(fs, dirPath);
              if (!deleted) {
                logger.warn?.('[启动] 删除残留分区最终失败（跳过）:', dirPath);
              }
            } catch (_) {}
          }
        } catch (e) {
          logger.warn?.('[启动] 启动时清理残留分区失败:', e?.message || e);
        }
      } catch (e) {
        logger.warn?.('[启动] 初始化后台任务失败:', e?.message || e);
      }
    })().catch((e) => {
      logger.warn?.('[启动] 后台初始化任务失败:', e?.message || e);
    });

    initDownloadPrefs();

    const httpClient = resolveGlobalHttpClient();
    if (httpClient) {
      httpClient.mainWindow = resolveMainWindow();
    }

  }

// 创建/初始化：createMainWindow的具体业务逻辑。
  function createMainWindow() {
    const iconPath = typeof resolveAppIconPath === 'function'
      ? resolveAppIconPath()
      : path.join(__dirname, '../../../', FIXED_ICON_RELATIVE_PATH);
    const windowTitle = APP_DISPLAY_NAME;
    const mainWindow = new BrowserWindow({
      width: 1280,
      height: 850,
      title: windowTitle,
      icon: iconPath,
      show: false,
      frame: true,
      titleBarStyle: 'default',
      autoHideMenuBar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    setMainWindow?.(mainWindow);
    mainWindow.loadFile(path.join(__dirname, '../../views/app-shell.html'));
    try {
      Menu.setApplicationMenu(null);
      mainWindow.setMenu(null);
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setAutoHideMenuBar(true);
    } catch (e) {
      logger.warn?.('[WindowMenu] 清理菜单栏失败:', e?.message || e);
    }
    mainWindow.setTitle(windowTitle);

    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => updateTabs(true), 0);
      mainWindow.setTitle(windowTitle);
      logger.log?.('[WindowTitle] did-finish-load, set title:', windowTitle);
    });

    mainWindow.on('focus', () => {
      setTimeout(() => updateTabs(true), 0);
    });

    const sideView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        preload: path.join(__dirname, '../preload.js'),
      },
    });
    if (typeof setSideView === 'function') setSideView(sideView);
    mainWindow.addBrowserView(sideView);
    attachContextMenu(sideView.webContents, { addTab: resolveAddTab(), downloadOrSaveMedia: deps.downloadOrSaveMedia, tabs: resolveTabs(), activeTabId: resolveActiveTabId(), refreshPage: resolveRefreshActiveTab() });

    try { auth.applyZhHantRequestPrefs(sideView.webContents.session, sideView.webContents); } catch (_) {}

    sideView.webContents.on('console-message', (details) => {
      if (!details || typeof details !== 'object') return;
      const message = typeof details.message === 'string' ? details.message : '';
      const level = details.level;
      if (level === 'debug' || level === 'info') logger.log?.(message);
      else if (level === 'warning') logger.warn?.(message);
      else if (level === 'error') logger.error?.(message);
      else logger.log?.(message);
    });

    // 优先加载本地内置的侧边栏页面（file:// 直接嵌入，无需端口/远程服务），
    // 仅当本地文件缺失或加载失败时才回退到远程地址，避免网络波动导致侧边栏加载不出来。
    const loadSidebarRemoteFallback = (reason) => {
      const sidebarRemoteUrl = resolveSidebarRemoteUrl();
      logger.warn?.('[启动] 回退加载远程侧边栏:', reason || '', '->', sidebarRemoteUrl);
      sideView.webContents.loadURL(sidebarRemoteUrl).catch((error) => {
        logger.warn?.('[启动] 远程侧边栏加载失败:', error?.message || error);
      });
    };

    const forceRemoteSidebar = String(process.env.SIDEBAR_MODE || '').trim().toLowerCase() === 'remote';
    const sidebarLocalPath = forceRemoteSidebar ? null : resolveControlPanelHtmlPath();
    if (sidebarLocalPath) {
      logger.log?.('[启动] 加载本地侧边栏:', sidebarLocalPath);
      sideView.webContents.loadFile(sidebarLocalPath).catch((error) => {
        loadSidebarRemoteFallback(`本地侧边栏加载失败: ${error?.message || error}`);
      });
    } else {
      loadSidebarRemoteFallback(forceRemoteSidebar ? 'SIDEBAR_MODE=remote' : '未找到本地 src/app/sidebar/index.html');
    }
    sideView.webContents.on('did-start-loading', () => {
      sideAnnouncementReady = false;
    });
    sideView.webContents.on('did-finish-load', async () => {
      sideAnnouncementReady = true;
      const shouldRestoreAnnouncements = hasFinishedInitialSidebarLoad;
      hasFinishedInitialSidebarLoad = true;
      const id = await computeDeviceId();
      sendToSide('update-device-id', id);
      try {
        sendToSide('app-console-history', typeof getAppConsoleHistory === 'function' ? getAppConsoleHistory() : []);
      } catch (_) {}
      try { sendToSide('app-version', app.getVersion()); } catch (_) {}
      try {
        if (canPollAnnouncements()) {
          // 首次加载时保留轮询器的投递记录，避免与启动轮询竞态而重复弹窗；
          // 只有页面真正重新加载后，才恢复当前有效公告到新页面。
          await ensureAnnouncementPoller().refreshNow({ resetDelivery: shouldRestoreAnnouncements });
        }
      } catch (e) {
        logger.warn?.('[公告轮询] 侧边栏加载完成后刷新失败:', e?.message || e);
      }
      setTimeout(async () => {
        try {
          await checkDesktopShortcutAndPrompt(mainWindow, sendToSide);
        } catch (e) {
          logger.warn?.('[Startup] 桌面快捷方式检查失败:', e?.message || e);
        }
      }, 1000);
    });
    sideView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      logger.warn?.('[启动] 远程侧边栏加载失败:', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });

    if (isControlPanelModeEnabled()) {
      setTimeout(() => {
        try {
          createControlPanelWindow();
        } catch (e) {
          logger.warn?.('[启动] 创建控制页窗口失败:', e?.message || e);
        }
      }, 0);
    }

// 设置/更新/持久化：updateLayout的具体业务逻辑。
    function updateLayout() {
      const [width, height] = mainWindow.getContentSize();
      const tabBarHeight = 41;
      const tabContentHeight = height - tabBarHeight;
      const isSidebarVisible = deps.getIsSidebarVisible ? deps.getIsSidebarVisible() : true;
      const sideViewWidth = isSidebarVisible ? Math.floor(width * 0.3) : 0;
      const mainViewWidth = width - sideViewWidth;
      const activeTab = resolveTabs().get(resolveActiveTabId());
      if (activeTab) {
        const bounds = { x: 0, y: tabBarHeight, width: mainViewWidth, height: tabContentHeight };
        if (activeTab.runtimeType === 'chromium') {
          void deps.browserRuntimeManager?.resize(activeTab.id, 'chromium', bounds).catch((error) => {
            logger.warn?.('[ChromiumRuntime] 同步窗口尺寸失败:', error?.message || error);
          });
        } else if (activeTab.view) {
          activeTab.view.setBounds(bounds);
          mainWindow.setTopBrowserView(activeTab.view);
        }
      }
      if (getSideView?.()) {
        getSideView().setBounds({ x: mainViewWidth, y: tabBarHeight, width: sideViewWidth, height: tabContentHeight });
      }
      if (extensionManager && typeof extensionManager.syncWebPanelBounds === 'function') {
        extensionManager.syncWebPanelBounds();
      }
    }

    mainWindow.on('resize', updateLayout);
    mainWindow.on('ready-to-show', updateLayout);
    mainWindow.on('closed', () => {
      closeDevConsoleWindow();
      try {
        const panel = resolveControlPanelWindow();
        if (panel && !panel.isDestroyed()) {
          panel.close();
        }
      } catch (_) {}
      if (extensionManager && typeof extensionManager.closeWebPanel === 'function') {
        extensionManager.closeWebPanel({ notify: false });
      }
      if (typeof setMainWindow === 'function') {
        setMainWindow(null);
      }
    });
    return mainWindow;
  }

// 处理：revealMainWindow的具体业务逻辑。
  function revealMainWindow() {
    try {
      const mainWindow = resolveMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch (e) {
      logger.warn?.('[启动] 显示主窗口失败:', e?.message || e);
    }
  }

// 停止/关闭/清理：resetMainRuntimeForRelicense的具体业务逻辑。
  function resetMainRuntimeForRelicense() {
    try {
      if (typeof setIsMainBootstrapped === 'function') setIsMainBootstrapped(false);
      if (typeof setAuth === 'function') setAuth(null);
      if (typeof setLatestAllowedPlatforms === 'function') setLatestAllowedPlatforms([]);
      if (deps.licenseCache && typeof deps.licenseCache.setRuntimeConfig === 'function') {
        deps.licenseCache.setRuntimeConfig({
          platformName: '',
          allowedPlatforms: [],
          targetUrl: '',
          tutorialUrl: '',
        });
      }
      if (typeof setDreamTargetUrl === 'function') {
        setDreamTargetUrl(DREAM_TARGET_URL);
      }
      if (typeof resetRuntimeTutorialUrlState === 'function') {
        resetRuntimeTutorialUrlState();
      }
      const client = resolveGlobalHttpClient();
      if (client && typeof client.close === 'function') {
        try { client.close(); } catch (_) {}
      }
      if (typeof setGlobalHttpClient === 'function') setGlobalHttpClient(null);
      clearLicenseCacheValidation();
    } catch (e) {
      logger.warn?.('[启动] 重置运行态失败:', e?.message || e);
    }
  }

  return {
    createLicenseWindow,
    createDevConsoleWindow,
    backToLicenseWindow,
    bootstrapMainApp,
    createMainWindow,
    revealMainWindow,
    resetMainRuntimeForRelicense,
  };
}

module.exports = {
  createAppShell,
};
