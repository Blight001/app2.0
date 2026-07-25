// 主进程 composition root（阶段 2D-3 收缩后）：
// 只负责创建依赖、装配服务与生命周期注册；具体装配细节在 composition/ 下：
//   electron-runtime-tuning  —— ready 前的 GPU/节流/防挂起调优
//   create-core-services     —— appRuntime/浏览器运行时/更新器等服务创建
//   create-refresh-platforms —— 平台/目标地址/教程地址运行时刷新
//   build-app-shell-deps     —— createAppShell 依赖装配
//   build-lifecycle-deps     —— registerAppLifecycle 依赖装配
const { app, BrowserWindow, WebContentsView, dialog, ipcMain, Menu, Tray, powerSaveBlocker, safeStorage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { acquireSingleInstance, applyWindowsAppUserModelId } = require('./composition/startup-guards');
const { tuneElectronRuntime } = require('./composition/electron-runtime-tuning');
const { createCoreServices } = require('./composition/create-core-services');
const { createRefreshAllowedPlatformsAndNotify } = require('./composition/create-refresh-platforms');
const { buildAppShellDeps } = require('./composition/build-app-shell-deps');
const { buildLifecycleDeps } = require('./composition/build-lifecycle-deps');
const {
  createSoftwareWorkspaceComposition,
} = require('./composition/build-software-workspace');
const { createAppShell } = require('./services/app-shell');
const { createTabManager } = require('./services/tab-manager');
const { registerAppLifecycle } = require('./services/app-lifecycle');
const { createWorkspaceShell } = require('./workspace/workspace-shell');
const { setDreamTargetUrl, getStorePath } = require('./config');
const { resolveTabBrowserProfile } = require('./utils/browser-profile');
const { httpGetUniversal } = require('./lib/http');
const {
  resolveSoftwareAutomationCardCacheDir,
  resolveSoftwareAiHistoryDir,
} = require('./config/paths');

// 启动/打开/显示：startMainApp的具体业务逻辑。
function startMainApp() {
  applyWindowsAppUserModelId();
  tuneElectronRuntime({ app, fs, powerSaveBlocker, getStorePath });
  let workspaceShell = null;
  let softwareWorkspace = null;

  // ---- 单例应用 ----
  const isPrimaryInstance = acquireSingleInstance({
    onSecondInstance: () => {
      if (workspaceShell?.revealHome?.()) return;
      if (appShell?.revealMainWindow?.()) return;
      const targetWin = services.appRuntime.getMainWindow() || services.appRuntime.getLicenseWindow();
      if (targetWin) {
        if (targetWin.isMinimized()) targetWin.restore();
        targetWin.show?.();
        targetWin.focus();
      }
    },
  });
  if (!isPrimaryInstance) return;

  // ---- 核心服务 ----
  let tabManager;
  const services = createCoreServices({
    app,
    fs,
    path,
    BrowserWindow,
    safeStorage,
    getTabManager: () => tabManager,
  });
  const { appRuntime, tabs, sendToSide, licenseCache } = services;

  // ---- 晚绑定（tabManager/auth/appShell 创建后回填）----
  let auth;
  let addTab;
  let openTutorialTab;
  let syncTutorialTabUrl;
  let applyClashMiniBrowserProxy;
  let applyNetworkMagicToTab;
  let switchTab;
  let closeTab;
  let reorderTab;
  let renameTab;
  let setTabAccountId;
  let setTabBrowserSettings;
  let setZoom;
  let refreshActiveTabToUrl;
  let refreshActiveTab;
  let refreshTab;
  let addExternalApp;
  let appShell = null;

  const late = {
    getAuth: () => auth,
    setAuth: (next) => { auth = next; },
    getAddTab: () => addTab,
    getOpenTutorialTab: () => openTutorialTab,
    getSyncTutorialTabUrl: () => syncTutorialTabUrl,
    getSwitchTab: () => switchTab,
    getCloseTab: () => closeTab,
    getReorderTab: () => reorderTab,
    getRenameTab: () => renameTab,
    getSetTabBrowserSettings: () => setTabBrowserSettings,
    getSetZoom: () => setZoom,
    getRefreshActiveTabToUrl: () => refreshActiveTabToUrl,
    getRefreshActiveTab: () => refreshActiveTab,
    getRefreshTab: () => refreshTab,
    getAddExternalApp: () => addExternalApp,
    getApplyClashMiniBrowserProxy: () => applyClashMiniBrowserProxy,
    getApplyNetworkMagicToTab: () => applyNetworkMagicToTab,
  };

  // 每个会话(session) -> 扩展ID 映射，用于后续打开 popup/options
  const extIdBySession = new WeakMap();

  // 停止/关闭/清理：resetRuntimeTutorialUrlState的具体业务逻辑。
  function resetRuntimeTutorialUrlState() {
    // 教程只在应用启动阶段自动打开一次；登录后的配置刷新不重置该行为。
  }

  const refreshAllowedPlatformsAndNotify = createRefreshAllowedPlatformsAndNotify({
    licenseCache,
    appRuntime,
    sendToSide,
    setDreamTargetUrl,
    getSyncTutorialTabUrl: late.getSyncTutorialTabUrl,
    updateLicenseRecordPlatform: services.licenseStore.updateLicenseRecordPlatform,
    normalizeValidationRuntimeConfig: services.normalizeValidationRuntimeConfig,
  });

  // ---- 应用外壳 ----
  const appShellDeps = buildAppShellDeps({
    electron: { app, fs, path, BrowserWindow, WebContentsView, dialog, Menu, Tray, screen },
    services,
    refreshAllowedPlatformsAndNotify,
    resetRuntimeTutorialUrlState,
    extIdBySession,
    late,
    getAppShell: () => appShell,
    getWorkspaceShell: () => workspaceShell,
    getSoftwareWorkspace: () => softwareWorkspace,
  });
  appShell = createAppShell(appShellDeps);

  // ---- 标签管理 ----
  tabManager = createTabManager({
    browserRuntimeManager: services.browserRuntimeManager,
    cursorSidecarService: services.cursorSidecarService,
    fs,
    logger: console,
    extensionManager: services.extensionManager,
    cleanupBrowserSessionData: services.browserPartitionCleaner.cleanupBrowserSessionData,
    getStorePath,
    getTabs: () => tabs,
    getMainWindow: appRuntime.getBrowserWindow,
    setMainWindow: appRuntime.setBrowserWindow,
    getSideView: appRuntime.getSideView,
    setSideView: appRuntime.setSideView,
    getActiveTabId: appRuntime.getActiveTabId,
    setActiveTabId: appRuntime.setActiveTabId,
    getIsSidebarVisible: appRuntime.getIsSidebarVisible,
    setIsSidebarVisible: appRuntime.setIsSidebarVisible,
    getSetTabAccountId: () => setTabAccountId,
    getAuth: late.getAuth,
    licenseCache,
    sendToSide,
    updateTabs: services.tabHelpers.updateTabs,
    httpGetUniversal,
    resolveTabBrowserProfile,
    extIdBySession,
  });

  ({
    addTab,
    openTutorialTab,
    syncTutorialTabUrl,
    applyClashMiniBrowserProxy,
    applyNetworkMagicToTab,
    switchTab,
    closeTab,
    reorderTab,
    renameTab,
    setTabAccountId,
    setTabBrowserSettings,
    setZoom,
    refreshActiveTabToUrl,
    refreshActiveTab,
    refreshTab,
  } = tabManager);

  softwareWorkspace = createSoftwareWorkspaceComposition({
    fs,
    logger: console,
    getStorePath,
    browserRuntimeManager: services.browserRuntimeManager,
    softwareCatalog: services.softwareCatalog,
    licenseCache,
    automationCardCacheDir: resolveSoftwareAutomationCardCacheDir(app),
    aiHistoryDirectory: resolveSoftwareAiHistoryDir(app),
  });
  addExternalApp = softwareWorkspace.openExternalApp;
  workspaceShell = createWorkspaceShell({
    app,
    BrowserWindow,
    ipcMain,
    path,
    setMainWindow: services.appRuntime.setMainWindow,
    createBrowserWindow: appShell.createMainWindow,
    revealBrowserWindow: appShell.revealMainWindow,
    getBrowserWindow: services.appRuntime.getBrowserWindow,
    getBrowserSideView: services.appRuntime.getSideView,
    clearBrowserWindow: () => {
      services.appRuntime.setBrowserWindow(null);
      services.appRuntime.setSideView(null);
    },
    initializeBrowserWorkspace: async () => {
      if (tabs.size > 0) {
        services.tabHelpers.updateTabs(true);
        return;
      }
      const openTutorial = late.getOpenTutorialTab();
      if (typeof openTutorial !== 'function') return;
      await openTutorial('', {
        auto: true,
        focusBrowser: false,
        restoreSideFocus: true,
      });
    },
    softwareShellDeps: {
      BrowserWindow,
      WebContentsView,
      state: softwareWorkspace.state,
      browserRuntimeManager: services.browserRuntimeManager,
      updateTabs: softwareWorkspace.updateTabs,
      startDomain: softwareWorkspace.start,
      disposeDomain: softwareWorkspace.dispose,
      path,
      icon: appShellDeps.resolveAppIconPath(),
      preloadPath: path.join(__dirname, 'preload/software-preload.js'),
      mainHtmlPath: path.join(__dirname, 'views/app-shell.html'),
      sidebarHtmlPath: path.join(__dirname, '../sidebar/index.html'),
      logger: console,
    },
    logger: console,
  });
  // ---- 生命周期 ----
  const lifecycleRegistration = registerAppLifecycle(buildLifecycleDeps({
    app,
    fs,
    services,
    appShell,
    workspaceShell,
    softwareWorkspace,
    refreshAllowedPlatformsAndNotify,
    late,
  }));
  app.once('will-quit', () => {
    lifecycleRegistration.dispose();
    void workspaceShell?.dispose?.();
  });
}

module.exports = {
  startMainApp,
};
