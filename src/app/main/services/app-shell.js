// 创建/初始化：createAppShell的具体业务逻辑。
function createAppShell(deps = {}) {
  const {
    app,
    fs,
    path,
    BrowserWindow,
    BrowserView,
    shell,
    dialog,
    isDevMode = false,
    Menu,
    logger = console,
    FIXED_ICON_RELATIVE_PATH,
    APP_DISPLAY_NAME,
    EXT_DIR,
    EXT_CORE_PATH,
    state,
    auth,
    createAuthCookie,
    createTcpClient,
    initializeTcpConnection,
    loadTranslateExtension,
    attachContextMenu,
    initDownloadPrefs,
    injectRemoveWatermarkCore,
    ensureRemoveWmCoreLoaded,
    injectZoomWheelListener,
    checkDesktopShortcutAndPrompt,
    initializeAccountCleanup,
    handleServerShutdownCommand,
    handleServerUpdateCommand,
    handleServerPushMessage,
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
    getSetZoom,
    getRefreshActiveTabToUrl,
    getRefreshActiveTab,
    getRefreshTab,
    getOpenExtensionPopup,
    getOpenExtensionOptions,
    getForceRemoveWatermark,
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
    getGlobalTcpClient,
    setGlobalTcpClient,
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
  const resolveControlPanelHtmlPath = () => {
    const candidates = [
      path.join(process.cwd(), 'control-panel', 'index.html'),
      path.join(app.getAppPath ? app.getAppPath() : '', 'control-panel', 'index.html'),
      path.join(__dirname, '../../../../control-panel/index.html'),
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
// 获取/读取/解析：resolveForceRemoveWatermark的具体业务逻辑。
  const resolveForceRemoveWatermark = () => (typeof getForceRemoveWatermark === 'function' ? getForceRemoveWatermark() : null);
// 获取/读取/解析：resolveAuth的具体业务逻辑。
  const resolveAuth = () => (typeof getAuth === 'function' ? getAuth() : auth);
// 获取/读取/解析：resolveGlobalTcpClient的具体业务逻辑。
  const resolveGlobalTcpClient = () => (typeof getGlobalTcpClient === 'function' ? getGlobalTcpClient() : null);
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
      logger.warn?.('[启动] 未找到本地 control-panel/index.html，跳过控制页窗口加载');
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
      if (!resolveGlobalTcpClient()) {
        const nextClient = createTcpClient({ mainWindow: null });
        if (typeof setGlobalTcpClient === 'function') {
          setGlobalTcpClient(nextClient);
        }
      }
      const tcpClient = resolveGlobalTcpClient();
      if (typeof setAuth === 'function') {
        setAuth(createAuthCookie({ serverBase: getServerBase(), tcp: tcpClient, sendToSide, licenseCache: deps.licenseCache }));
      }
    } catch (e) {
      logger.warn?.('[启动] 初始化TCP/鉴权失败:', e?.message || e);
    }

    try {
      if (isDevMode) {
        createDevConsoleWindow();
      }
    } catch (e) {
      logger.warn?.('[启动] 预创建调试控制台失败:', e?.message || e);
    }

    try {
      // 翻译插件默认保持开启，避免每次启动都要手动重新点开。
      applyPluginSettings({ translateExtEnabled: true });
    } catch (e) {
      logger.warn?.('[启动] 初始化插件开关失败，使用默认值:', e?.message || e);
      applyPluginSettings({ translateExtEnabled: true });
    }

    try {
      createMainWindow();
      if (!isControlPanelOnlyModeEnabled()) {
        revealMainWindow();
      }
    } catch (e) {
      logger.warn?.('[启动] 创建主窗口失败:', e?.message || e);
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
        tcp: resolveGlobalTcpClient(),
        ui: {
          addTab: resolveAddTab(),
          switchTab: resolveSwitchTab(),
          closeTab: resolveCloseTab(),
          setTabAccountId: resolveSetTabAccountId(),
          setTabBrowserProxyMode: resolveSetTabBrowserProxyMode(),
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
          forceRemoveWatermark: resolveForceRemoveWatermark(),
          backToLicenseWindow,
          applyPluginSettings,
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
          purgeBrowserSessionData: typeof purgeBrowserSessionData === 'function'
            ? purgeBrowserSessionData
            : null,
          buildManagedTabPartitionName: typeof buildManagedTabPartitionName === 'function'
            ? buildManagedTabPartitionName
            : null,
          applyClashMiniBrowserProxy: typeof deps.applyClashMiniBrowserProxy === 'function'
            ? deps.applyClashMiniBrowserProxy
            : null,
        },
        auth: resolveAuth(),
        log: deps.log,
        state,
        licenseCache,
        appendLicenseRecord: typeof appendLicenseRecord === 'function' ? appendLicenseRecord : null,
        refreshAllowedPlatformsAndNotify: typeof refreshAllowedPlatformsAndNotify === 'function' ? refreshAllowedPlatformsAndNotify : null,
        getCurrentPlatformLabel,
      });
      logger.log?.('[启动] IPC handlers 已注册');
    } catch (e) {
      logger.error?.('[启动] 注册 IPC 失败:', e?.message || e);
    }

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
          let deleted = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              if (fs.promises.rm) {
                await fs.promises.rm(dirPath, { recursive: true, force: true });
              } else {
                await fs.promises.rmdir(dirPath, { recursive: true });
              }
              deleted = true;
              break;
            } catch (_) {
              await new Promise((res) => setTimeout(res, 200));
            }
          }
          if (!deleted) {
            logger.warn?.('[启动] 删除残留分区最终失败（跳过）:', dirPath);
          }
        } catch (_) {}
      }
    } catch (e) {
      logger.warn?.('[启动] 启动时清理残留分区失败:', e?.message || e);
    }

    void (async () => {
      let runtimeUrlRefreshInFlight = false;

// 渲染/刷新：refreshRuntimeUrlsFromTcp的具体业务逻辑。
      const refreshRuntimeUrlsFromTcp = async () => {
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
// 监听/绑定：onConnectionStatusChange的具体业务逻辑。
        const onConnectionStatusChange = (status, message) => {
          sendToSide('connection-status', { status, message });
          if (status === 'connected' || status === 'http') {
            refreshAllowedPlatformsAndNotify().catch(() => {});
            refreshRuntimeUrlsFromTcp().catch((e) => {
              logger.warn?.('[启动] 连接恢复后刷新URL配置失败:', e?.message || e);
            });
          }
        };
// 监听/绑定：onServerMessage的具体业务逻辑。
        const onServerMessage = (messageData) => {
          try {
            logger.warn?.('[TCP] 收到服务器推送', {
              type: messageData?.type,
              message_type: messageData?.message_type,
              messageType: messageData?.messageType,
              keys: messageData && typeof messageData === 'object' ? Object.keys(messageData) : [],
            });
            const pushHandler = typeof handleServerPushMessage === 'function'
              ? handleServerPushMessage
              : async (payload) => {
                  const updateHandled = typeof handleServerUpdateCommand === 'function'
                    ? await handleServerUpdateCommand(payload)
                    : false;
                  if (updateHandled) return true;
                  return handleServerShutdownCommand(payload);
                };
            pushHandler(messageData).then((handled) => {
              if (!handled) sendToSide('server-message', messageData);
            }).catch(() => {
              sendToSide('server-message', messageData);
            });
          } catch (_) {}
        };

        const connectionSuccess = await initializeTcpConnection(onConnectionStatusChange, onServerMessage);
        const tcpClient = createTcpClient();
        const isHttpCompatMode = !!(tcpClient && (tcpClient.httpFallbackActive || String(tcpClient.transportMode || '').toLowerCase() === 'http'));

        if (!connectionSuccess && !isHttpCompatMode) {
          const isMaintenance = tcpClient && tcpClient.lastKnownStatus === 'maintenance';
          if (isMaintenance) {
            sendToSide('connection-status', { status: 'disconnected', message: '服务器维护中，请稍后再试' });
          } else {
            sendToSide('connection-status', { status: 'disconnected', message: '服务器已断开' });
          }
        } else {
          sendToSide('connection-status', {
            status: isHttpCompatMode ? 'http' : 'connected',
            message: isHttpCompatMode ? '网络兼容模式' : '网络状态良好',
          });
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
          try {
            await refreshRuntimeUrlsFromTcp();
          } catch (e) {
            logger.warn?.('[启动] 获取URL配置失败:', e?.message || e);
          }
        }
      } catch (e) {
        logger.warn?.('[启动] 初始化TCP连接失败:', e?.message || e);
      }


    })().catch((e) => {
      logger.warn?.('[启动] 后台TCP初始化任务失败:', e?.message || e);
    });

    ensureRemoveWmCoreLoaded().catch(() => {});
    initDownloadPrefs();

    const tcpClient = resolveGlobalTcpClient();
    if (tcpClient) {
      tcpClient.mainWindow = resolveMainWindow();
        tcpClient.onServerMessage = (messageData) => {
          logger.warn?.('[TCP] 全局 TCP 客户端收到服务器推送', {
            type: messageData?.type,
            message_type: messageData?.message_type,
            messageType: messageData?.messageType,
            keys: messageData && typeof messageData === 'object' ? Object.keys(messageData) : [],
          });
          const pushHandler = typeof handleServerPushMessage === 'function'
            ? handleServerPushMessage
            : async (payload) => {
              const updateHandled = typeof handleServerUpdateCommand === 'function'
                ? await handleServerUpdateCommand(payload)
                : false;
              if (updateHandled) return true;
              return handleServerShutdownCommand(payload);
            };
        pushHandler(messageData).then((handled) => {
          if (!handled) {
            sendToSide('server-message', messageData);
          }
        }).catch(() => {
          sendToSide('server-message', messageData);
        });
      };
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
        preload: path.join(__dirname, '../preload.js'),
      },
    });
    if (typeof setSideView === 'function') setSideView(sideView);
    mainWindow.addBrowserView(sideView);
    attachContextMenu(sideView.webContents, { addTab: resolveAddTab(), downloadOrSaveMedia: deps.downloadOrSaveMedia, tabs: resolveTabs(), activeTabId: resolveActiveTabId(), refreshPage: resolveRefreshActiveTab() });

    try { auth.applyZhHantRequestPrefs(sideView.webContents.session, sideView.webContents); } catch (_) {}
    if (statePluginGetter().removeWatermarkEnabled) {
      try {
        sideView.webContents.session.extensions.loadExtension(EXT_DIR, { allowFileAccess: true })
          .then((ext) => {
            try { extIdBySession.set(sideView.webContents.session, ext && ext.id); } catch (_) {}
            logger.log?.('扩展已加载到侧栏会话:', ext && ext.name, ext && ext.id);
          })
          .catch((err) => logger.warn?.('扩展加载失败(侧栏):', err && (err.message || err)));
      } catch (_) {}
    } else {
      logger.log?.('[RemoveWM] 去水印功能已关闭，跳过侧栏扩展加载');
    }

    sideView.webContents.on('console-message', (details) => {
      if (!details || typeof details !== 'object') return;
      const message = typeof details.message === 'string' ? details.message : '';
      const level = details.level;
      if (level === 'debug' || level === 'info') logger.log?.(message);
      else if (level === 'warning') logger.warn?.(message);
      else if (level === 'error') logger.error?.(message);
      else logger.log?.(message);
    });

    const sidebarRemoteUrl = resolveSidebarRemoteUrl();
    sideView.webContents.loadURL(sidebarRemoteUrl).catch((error) => {
      logger.warn?.('[启动] 远程侧边栏加载失败:', error?.message || error);
    });
    sideView.webContents.on('did-finish-load', async () => {
      const id = await computeDeviceId();
      sendToSide('update-device-id', id);
      try {
        sendToSide('app-console-history', typeof getAppConsoleHistory === 'function' ? getAppConsoleHistory() : []);
      } catch (_) {}
      try { sendToSide('app-version', app.getVersion()); } catch (_) {}
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
        activeTab.view.setBounds({ x: 0, y: tabBarHeight, width: mainViewWidth, height: tabContentHeight });
        mainWindow.setTopBrowserView(activeTab.view);
      }
      if (getSideView?.()) {
        getSideView().setBounds({ x: mainViewWidth, y: tabBarHeight, width: sideViewWidth, height: tabContentHeight });
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
      if (typeof setMainWindow === 'function') {
        setMainWindow(null);
      }
    });
    if (isDevMode) {
      try {
        createDevConsoleWindow();
      } catch (e) {
        logger.warn?.('[启动] 创建调试控制台窗口失败:', e?.message || e);
      }
    }
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
      const client = resolveGlobalTcpClient();
      if (client && typeof client.close === 'function') {
        try { client.close(); } catch (_) {}
      }
      if (typeof setGlobalTcpClient === 'function') setGlobalTcpClient(null);
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
