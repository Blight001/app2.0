const { app, BrowserWindow, WebContentsView, dialog, ipcMain, Menu, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const { createAppState } = require('./runtime/app-state');
const { createLicenseCache } = require('./runtime/license-cache');
const { createUiBridge } = require('./composition/create-ui-bridge');
const { acquireSingleInstance, applyWindowsAppUserModelId } = require('./composition/startup-guards');
const { createAppUpdater } = require('./services/app-updater');
const { createBrowserRuntimeManager } = require('./browser-runtime');

// 启动/打开/显示：startMainApp的具体业务逻辑。
function startMainApp() {
  applyWindowsAppUserModelId();

// 内部模块（拆分后的小单元）
const { postJson, getJson, httpGetUniversal } = require('./lib/http');
const { createLogger } = require('./utils/logger');
const { DREAM_TARGET_URL, setDreamTargetUrl, getDreamTargetUrl, setRuntimeTcpConfig, setRuntimeServerBase, getCoreDir, getStorePath, initializeCoreDirectory, getServerBase, getSideUrl, getTcpConfig } = require('./config');
const {
  extractValidationState,
  getValidationFailureMessage,
} = require('./utils/license-response');
const { createAuthCookie } = require('./lib/auth-cookie');
const { registerIPC } = require('./ipc/register');
const { createHttpClient, normalizeValidationRuntimeConfig } = require('./lib/http-client');
const { getHardwareFingerprint } = require('./utils/hardware-js');
const accountStorage = require('./lib/account-storage');
const { stopClashMiniProcess } = require('./ipc/register/clash-mini-core');

// 功能模块
const { initDownloadPrefs, downloadOrSaveMedia } = require('./utils/download');
const { attachContextMenu, clearInjectionRecord, shortcutManager } = require('./utils/removeWatermark');
const { injectZoomWheelListener } = require('./utils/zoom');
const { checkDesktopShortcutAndPrompt } = require('./utils/shortcut');
const { resolveAppIconPath } = require('./utils/app-icon');
const { initializeAccountCleanup } = require('./utils/accountCleanup');
const { createBrowserPartitionCleaner } = require('./services/browser-partitions');
const { registerAppLifecycle } = require('./services/app-lifecycle');
const { createAppShell } = require('./services/app-shell');
const { createServerResolver } = require('./services/server-resolver');
const { createTabManager } = require('./services/tab-manager');
const { createLicenseStore } = require('./services/license-store');
const { createTabHelpers } = require('./services/tab-helpers');
const { createRuntimeHelpers } = require('./services/runtime-helpers');
const { createExtensionManager } = require('./services/extension-manager');
const { createBrowserAutomationBridge } = require('./services/browser-automation-bridge');
const { resolveTabBrowserProfile } = require('./utils/browser-profile');

// Electron 的 GPU 开关必须在 ready 之前设置；侧栏保存后会在下次应用启动时读取。
try {
  const storePath = getStorePath();
  if (storePath && fs.existsSync(storePath)) {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
    if (store?.aiFreeBrowserSettings?.hardwareAcceleration === false) app.disableHardwareAcceleration();
  }
} catch (error) {
  console.warn('[BrowserSettings] 读取硬件加速启动配置失败:', error?.message || error);
}

// 自动化任务必须与窗口可见性解耦。Chromium 默认会冻结最小化、被遮挡
// 或移出 BrowserWindow 的页面，导致扩展定时器、Socket 和脚本执行中断。
for (const switchName of [
  'disable-renderer-backgrounding',
  'disable-background-timer-throttling',
  'disable-backgrounding-occluded-windows',
]) {
  app.commandLine.appendSwitch(switchName);
}

let automationPowerBlockerId = null;
app.whenReady().then(() => {
  try {
    if (automationPowerBlockerId === null && powerSaveBlocker && typeof powerSaveBlocker.start === 'function') {
      automationPowerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } catch (error) {
    console.warn('[AutomationRuntime] 无法启用后台运行保护:', error?.message || error);
  }
});
app.once('will-quit', () => {
  try {
    if (
      automationPowerBlockerId !== null
      && powerSaveBlocker
      && typeof powerSaveBlocker.isStarted === 'function'
      && powerSaveBlocker.isStarted(automationPowerBlockerId)
    ) {
      powerSaveBlocker.stop(automationPowerBlockerId);
    }
  } catch (_) {}
  automationPowerBlockerId = null;
});

// ---- 单例应用 ----
acquireSingleInstance({
  onSecondInstance: () => {
    const targetWin = appRuntime.getMainWindow() || appRuntime.getLicenseWindow();
    if (targetWin) {
      if (targetWin.isMinimized()) targetWin.restore();
      targetWin.focus();
    }
  },
});

// ---- 全局状态 ----
const appRuntime = createAppState();
// In development, Electron's process.resourcesPath points at
// node_modules/electron/dist/resources rather than this application's resources
// directory. Packaged builds, however, stage the Chromium fork directly under
// process.resourcesPath/chromium.
const chromiumResourcesPath = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '../../..', 'resources');
const browserRuntimeManager = createBrowserRuntimeManager({
  userDataDir: app.getPath('userData'),
  resourcesPath: chromiumResourcesPath,
  getParentWindow: appRuntime.getMainWindow,
  logger: console,
});
try {
  if (process.platform === 'win32' && browserRuntimeManager.isChromiumAvailable()) {
    browserRuntimeManager.windowBridge.setPerMonitorDpiAwareness();
  }
} catch (error) {
  console.warn('[ChromiumRuntime] 无法初始化 Per-Monitor DPI V2:', error?.message || error);
}
const licenseCache = createLicenseCache();
  if (typeof accountStorage.setLicenseCache === 'function') {
    accountStorage.setLicenseCache(licenseCache);
  }
const tabs = appRuntime.tabs;
const APP_DISPLAY_NAME = 'AI-FREE';
const FIXED_ICON_RELATIVE_PATH = 'src/assets/logo.ico';
global.__APP_SESSION_ID__ = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

let addTab;
let openTutorialTab;
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
let tabManager;

// 每个会话(session) -> 扩展ID 映射，用于后续打开 popup/options
const extIdBySession = new WeakMap();

const browserPartitionCleaner = createBrowserPartitionCleaner({
  app,
  fs,
  path,
  BrowserWindow,
  getTabs: () => tabs,
  getMainWindow: appRuntime.getMainWindow,
  getSideView: appRuntime.getSideView,
  getLicenseWindow: appRuntime.getLicenseWindow,
  getActiveTabId: appRuntime.getActiveTabId,
  getExtPopupWin: appRuntime.getExtPopupWin,
  logger: console,
  licenseCache,
});

const cleanupBrowserSessionData = browserPartitionCleaner.cleanupBrowserSessionData;
const purgeBrowserSessionData = browserPartitionCleaner.purgeBrowserSessionData;
const cleanupAllBrowserSessionData = browserPartitionCleaner.cleanupAllBrowserSessionData;
const cleanupBrowserPartitionsRootDir = browserPartitionCleaner.cleanupBrowserPartitionsRootDir;

// 应用状态（统一通过 state 对象管理，便于注入到 IPC）
const state = {
  // 当用户选择"使用自定义代理"时置为 true，后续不再为网页强制挂本地端口代理
  manualProxyPreferred: false,
  pluginSettings: appRuntime.getPluginSettings(),
};

// 设置/更新/持久化：applyPluginSettings的具体业务逻辑。
function applyPluginSettings(partial = {}) {
  state.pluginSettings = appRuntime.applyPluginSettings(partial);
}

// 常量与认证（将在应用就绪时创建）
let auth;
// 日志封装（侧栏转发通过 sideView.webContents）
const logger = createLogger({ getSideWebContents: () => (appRuntime.getSideView() && appRuntime.getSideView().webContents) || null });
// 卡片库属于软件级数据，放在 userData/extensions 下，不随任一 Chromium Profile
// 或注入用的扩展副本一起删除。
const browserAutomationBridge = createBrowserAutomationBridge({
  logger: console,
  cardCacheDir: path.join(app.getPath('userData'), 'extensions', 'browser_automation'),
});
app.whenReady().then(() => browserAutomationBridge.start()).catch((error) => {
  console.error('[AutomationBridge] 启动失败:', error?.message || error);
});
const isDevMode = !!(
  (app && app.isPackaged === false)
  || (
    process.env.NODE_ENV
    && /^(dev|development)$/i.test(String(process.env.NODE_ENV || ''))
  )
);
const { sendToSide, getAppConsoleHistory, getDebugConsoleHistory } = createUiBridge({
  getSideView: appRuntime.getSideView,
  getControlPanelWindow: appRuntime.getControlPanelWindow,
  getConsoleWindow: appRuntime.getConsoleWindow,
});
const sendUpdateUiEvent = (channel, ...args) => {
  let delivered = sendToSide(channel, ...args);
  try {
    const mainWindow = appRuntime.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
      delivered = true;
    }
  } catch (_) {}
  return delivered;
};
const appUpdater = createAppUpdater({
  app,
  fs,
  path,
  logger: console,
  getMainWindow: appRuntime.getMainWindow,
  sendToSide: sendUpdateUiEvent,
  appName: APP_DISPLAY_NAME,
  isDevMode,
});

const licenseStore = createLicenseStore({
  fs,
  path,
  getStorePath,
  getLatestAllowedPlatforms: appRuntime.getLatestAllowedPlatforms,
  licenseCache,
  logger: console,
});

const serverResolver = createServerResolver({
  fs,
  path,
  postJson,
  getServerBase,
  extractValidationState,
  getValidationFailureMessage,
  readStoreConfigSafe: () => readStoreConfigSafe(),
  writeStoreConfigSafe: (store) => writeStoreConfigSafe(store),
  licenseCache,
  setRuntimeTcpConfig,
  setRuntimeServerBase,
  getCurrentPlatformLabel: () => getCurrentPlatformLabel(),
  logger: console,
});

const tabHelpers = createTabHelpers({
  logger: console,
  getTabs: () => tabs,
  getMainWindow: appRuntime.getMainWindow,
  getSideView: appRuntime.getSideView,
  getActiveTabId: appRuntime.getActiveTabId,
  getIsSidebarVisible: appRuntime.getIsSidebarVisible,
  setIsSidebarVisible: appRuntime.setIsSidebarVisible,
  sendToSide,
  browserRuntimeManager,
});

const runtimeHelpers = createRuntimeHelpers({
  app,
  fs,
  path,
  logger: console,
  getHardwareFingerprint,
});

const {
  readStoreConfigSafe,
  writeStoreConfigSafe,
  getCurrentPlatformLabel,
  readLicenseRecordsSafe,
  writeLicenseRecordsSafe,
  appendLicenseRecord,
  updateLicenseRecordPlatform,
} = licenseStore;

const {
  updateTabs,
  getActiveWC,
  toggleSidebar,
} = tabHelpers;

const {
  getTranslateExtDir,
  loadTranslateExtension,
  computeDeviceId,
} = runtimeHelpers;

const extensionManager = createExtensionManager({
  app,
  fs,
  path,
  logger: console,
  getStorePath,
  getTranslateExtDir,
  getTabs: () => tabs,
  getActiveTabId: appRuntime.getActiveTabId,
  applyPluginSettings,
  sendToSide,
  onPluginStateChanged: async (change) => {
    if (!tabManager || typeof tabManager.refreshBrowsersAfterExtensionChange !== 'function') {
      return { ok: true, total: 0, chromiumRestarted: 0 };
    }
    return tabManager.refreshBrowsersAfterExtensionChange(change);
  },
});

// 注意：服务器→客户端的 TCP 推送已移除（公告现由客户端轮询）。

let platformRefreshInFlight = false;
// 停止/关闭/清理：resetRuntimeTutorialUrlState的具体业务逻辑。
function resetRuntimeTutorialUrlState() {
  // 教程只在应用启动阶段自动打开一次；登录后的配置刷新不重置该行为。
}

// 渲染/刷新：refreshAllowedPlatformsAndNotify的具体业务逻辑。
async function refreshAllowedPlatformsAndNotify() {
  if (platformRefreshInFlight) return;
  platformRefreshInFlight = true;
  try {
    const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
      ? licenseCache.getRuntimeConfig()
      : {};
    const normalized = normalizeValidationRuntimeConfig(runtimeConfig);
    const allowedPlatforms = Array.isArray(normalized.allowedPlatforms) ? normalized.allowedPlatforms : [];
    const woolPlatforms = Array.isArray(normalized.woolPlatforms) ? normalized.woolPlatforms : [];
    const platformName = String(normalized.platformName || allowedPlatforms[0] || '').trim();
    const targetUrl = String(normalized.targetUrl || '').trim();
    const tutorialUrl = String(normalized.tutorialUrl || '').trim();
    if (!platformName && allowedPlatforms.length === 0 && !targetUrl && !tutorialUrl) {
      return;
    }
    appRuntime.setLatestAllowedPlatforms(allowedPlatforms);
    try {
      if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
        licenseCache.setRuntimeConfig({
          allowedPlatforms,
          woolPlatforms,
          platformName,
        });
      }
    } catch (e) {
      console.warn('[启动] 保存平台列表失败:', e?.message || e);
    }
    if (targetUrl) {
      try {
        setDreamTargetUrl(targetUrl);
        sendToSide('target-url-updated', { targetUrl });
      } catch (e) {
        console.warn('[启动] 同步目标地址失败:', e?.message || e);
      }
    }
    if (tutorialUrl) {
      try {
        sendToSide('tutorial-url-updated', { tutorialUrl });
      } catch (e) {
        console.warn('[启动] 同步教程地址失败:', e?.message || e);
      }
    }
    sendToSide('platform-name-updated', { platformName, allowedPlatforms, woolPlatforms });
    sendToSide('wool-platforms-updated', { woolPlatforms });
    try {
      const currentKey = String(licenseCache?.getCredentials?.().key || '').trim();
      if (currentKey && typeof updateLicenseRecordPlatform === 'function') {
        const recordUpdate = updateLicenseRecordPlatform({
          keyValue: currentKey,
          platformName,
        });
        if (recordUpdate) {
          const licenseWindow = appRuntime.getLicenseWindow();
          if (licenseWindow && !licenseWindow.isDestroyed()) {
            licenseWindow.webContents.send('license-records-updated', {
              keyValue: currentKey,
              platformName,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[启动] 回填卡密平台失败:', e?.message || e);
    }
    console.log('[启动] 平台名称已刷新并通知侧边栏:', platformName);
  } catch (e) {
    console.warn('[启动] 刷新平台名称失败:', e?.message || e);
  } finally {
    platformRefreshInFlight = false;
  }
}

const appShellDeps = {
  app,
  fs,
  path,
  BrowserWindow,
  WebContentsView,
  browserRuntimeManager,
  browserAutomationBridge,
  dialog,
  Menu,
  logger: console,
  FIXED_ICON_RELATIVE_PATH,
  resolveAppIconPath,
  APP_DISPLAY_NAME,
  state,
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
  getTcpConfig,
  getDreamTargetUrl,
  setDreamTargetUrl,
  DREAM_TARGET_URL,
  getCurrentPlatformLabel,
  readStoreConfigSafe,
  writeStoreConfigSafe,
  appendLicenseRecord,
  applyPluginSettings,
  computeDeviceId,
  getAuth: () => auth,
  setAuth: (next) => { auth = next; },
  getAddTab: () => addTab,
  getOpenTutorialTab: () => openTutorialTab,
  getSwitchTab: () => switchTab,
  getCloseTab: () => closeTab,
  getReorderTab: () => reorderTab,
  getRenameTab: () => renameTab,
  getSetTabBrowserSettings: () => setTabBrowserSettings,
  getSetZoom: () => setZoom,
  getRefreshActiveTabToUrl: () => refreshActiveTabToUrl,
  getRefreshActiveTab: () => refreshActiveTab,
  getRefreshTab: () => refreshTab,
  updateTabs,
  getActiveWC,
  toggleSidebar,
  sendToSide,
  startAppUpdate: appUpdater.startAppUpdate,
  handleServerUpdateCommand: appUpdater.handleServerUpdateCommand,
  cleanupUpdateStorageRoot: appUpdater.cleanupUpdateStorageRoot,
  getAppVersion: () => app.getVersion(),
  getTabs: () => tabs,
  getMainWindow: appRuntime.getMainWindow,
  setMainWindow: appRuntime.setMainWindow,
  getSideView: appRuntime.getSideView,
  setSideView: appRuntime.setSideView,
  getControlPanelWindow: appRuntime.getControlPanelWindow,
  setControlPanelWindow: appRuntime.setControlPanelWindow,
  getConsoleWindow: appRuntime.getConsoleWindow,
  setConsoleWindow: appRuntime.setConsoleWindow,
  getLicenseWindow: appRuntime.getLicenseWindow,
  setLicenseWindow: appRuntime.setLicenseWindow,
  getActiveTabId: appRuntime.getActiveTabId,
  setActiveTabId: appRuntime.setActiveTabId,
  getExtPopupWin: appRuntime.getExtPopupWin,
  setExtPopupWin: appRuntime.setExtPopupWin,
  getIsSidebarVisible: appRuntime.getIsSidebarVisible,
  setIsSidebarVisible: appRuntime.setIsSidebarVisible,
  getIsMainBootstrapped: appRuntime.getIsMainBootstrapped,
  setIsMainBootstrapped: appRuntime.setIsMainBootstrapped,
  getIsSwitchingToLicense: appRuntime.getIsSwitchingToLicense,
  setIsSwitchingToLicense: appRuntime.setIsSwitchingToLicense,
  getLatestAllowedPlatforms: appRuntime.getLatestAllowedPlatforms,
  setLatestAllowedPlatforms: appRuntime.setLatestAllowedPlatforms,
  licenseCache,
  getGlobalHttpClient: appRuntime.getGlobalHttpClient,
  setGlobalHttpClient: appRuntime.setGlobalHttpClient,
  cleanupBrowserSessionData,
  purgeBrowserSessionData,
  cleanupAllBrowserSessionData,
  cleanupBrowserPartitionsRootDir,
  accountStorage,
  shortcutManager,
  extIdBySession,
  clearInjectionRecord,
  getAppConsoleHistory,
  getDebugConsoleHistory,
  statePluginGetter: () => state.pluginSettings,
  getDreamTargetUrl,
  getSideUrl,
  setRuntimeTcpConfig,
  setRuntimeServerBase,
  httpGetUniversal,
  postJson,
  getJson,
  downloadOrSaveMedia,
  extensionManager,
  createDevConsoleWindow: () => appShell.createDevConsoleWindow?.(),
  isDevMode,
};
const appShell = createAppShell(appShellDeps);

const {
  bootstrapMainApp,
  createMainWindow,
  revealMainWindow,
} = appShell;

  tabManager = createTabManager({
  browserRuntimeManager,
  fs,
  logger: console,
  extensionManager,
  cleanupBrowserSessionData,
  getStorePath,
  getTabs: () => tabs,
  getMainWindow: appRuntime.getMainWindow,
  setMainWindow: appRuntime.setMainWindow,
  getSideView: appRuntime.getSideView,
  setSideView: appRuntime.setSideView,
  getActiveTabId: appRuntime.getActiveTabId,
  setActiveTabId: appRuntime.setActiveTabId,
  getIsSidebarVisible: appRuntime.getIsSidebarVisible,
  setIsSidebarVisible: appRuntime.setIsSidebarVisible,
  getSetTabAccountId: () => setTabAccountId,
  getAuth: () => auth,
  licenseCache,
  sendToSide,
  updateTabs,
  httpGetUniversal,
  resolveTabBrowserProfile,
  extIdBySession,
  });

({
  addTab,
  openTutorialTab,
  applyClashMiniBrowserProxy,
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

appShellDeps.applyClashMiniBrowserProxy = applyClashMiniBrowserProxy;

//////////////////////////////////////////////////////////////////////////////////////////启动逻辑
registerAppLifecycle({
  app,
  ipcMain,
  fs,
  getStorePath,
  initializeCoreDirectory,
  getCurrentPlatformLabel,
  readStoreConfigSafe,
  writeStoreConfigSafe,
  writeLicenseRecordsSafe,
  readLicenseRecordsSafe,
  computeDeviceId,
  licenseCache,
  bootstrapMainApp,
  sendToSide,
  cleanupAllBrowserSessionData,
  cleanupBrowserPartitionsRootDir,
  browserRuntimeManager,
  browserAutomationBridge,
  getTabs: () => tabs,
  // AI 默认窗口工具需要的标签页/窗口操作桥。tabManager 的函数在上方解构赋值，
  // 用箭头包装保持晚绑定。
  browserWindowUi: {
    getTabs: () => tabs,
    getActiveTabId: appRuntime.getActiveTabId,
    addTab: (...args) => addTab(...args),
    switchTab: (...args) => switchTab(...args),
    closeTab: (...args) => closeTab(...args),
    renameTab: (...args) => renameTab(...args),
    updateTabs,
    sendToSide,
    browserRuntimeManager,
  },

  shortcutManager,
  authenticateAccount: serverResolver.authenticateAccount,
  applyResolvedConfigToStore: serverResolver.applyResolvedConfigToStore,
  refreshAllowedPlatformsAndNotify,
  setRuntimeServerBase,
  setRuntimeTcpConfig,
  getGlobalHttpClient: appRuntime.getGlobalHttpClient,
  isSwitchingToLicense: appRuntime.getIsSwitchingToLicense,
  isMainBootstrapped: appRuntime.getIsMainBootstrapped,
  getLicenseWindow: appRuntime.getLicenseWindow,
  BrowserWindow,
  createMainWindow,
  getMainWindow: appRuntime.getMainWindow,
  createDevConsoleWindow: appShell.createDevConsoleWindow,
  getAppConsoleHistory,
  getDebugConsoleHistory,
  isDevMode,
  logger: console,
});
}

module.exports = {
  startMainApp,
};
