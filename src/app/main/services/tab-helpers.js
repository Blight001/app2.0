const {
  getActiveTabWebContents,
  resolveTabTitle,
  toggleSidebarVisibility,
} = require('./tab-common');

// 创建/初始化：createTabHelpers的具体业务逻辑。
function createTabHelpers(deps = {}) {
  const {
    logger = console,
    getTabs,
    getMainWindow,
    getSideView,
    getActiveTabId,
    setIsSidebarVisible,
    sendToSide,
    browserRuntimeManager,
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
  const resolveIsSidebarVisible = () => (typeof deps.getIsSidebarVisible === 'function' ? deps.getIsSidebarVisible() : true);

  let tabsUpdateTimer = null;
  let lastTabsSignature = '';

// 创建/初始化：buildTabsPayload的具体业务逻辑。
  function buildTabsPayload() {
    return Array.from(resolveTabs().values()).map((t) => {
      const instance = browserRuntimeManager?.chromium?.instances?.get?.(String(t.id));
      const runtimeState = typeof browserRuntimeManager?.getState === 'function'
        ? browserRuntimeManager.getState(String(t.id))
        : null;
      const applied = instance?.appliedProfile && typeof instance.appliedProfile === 'object'
        ? instance.appliedProfile
        : null;
      const environment = applied?.browserEnvironment && typeof applied.browserEnvironment === 'object'
        ? applied.browserEnvironment
        : (t.browserProfile || null);
      const actualProfile = environment ? {
        ...environment,
        locale: String(applied?.locale || environment.locale || '').trim(),
        timezoneId: String(applied?.timezoneId || environment.timezoneId || '').trim(),
        acceptLanguage: String(applied?.acceptLanguage || environment.acceptLanguage || '').trim(),
        userAgent: String(applied?.userAgent || environment.userAgent || '').trim(),
      } : null;
      const actualProxyServer = String(applied?.proxyServer || '').trim();
      return ({
      id: t.id,
      title: resolveTabTitle(t),
      isActive: t.id === resolveActiveTabId(),
      accountId: String(t.accountId || '').trim(),
      browserHistoryId: String(t.browserHistoryId || '').trim(),
      browserProxyMode: String(t.browserProxyMode || 'inherit').trim(),
      networkMagicEnabled: t.networkMagicApplied === true && !!actualProxyServer,
      browserSettings: applied?.browserSettings && typeof applied.browserSettings === 'object'
        ? applied.browserSettings
        : null,
      runtimeEnvironment: applied ? {
        windowWidth: Math.max(0, Number(runtimeState?.bounds?.width) || 0),
        windowHeight: Math.max(0, Number(runtimeState?.bounds?.height) || 0),
        hardwareAcceleration: applied.hardwareAcceleration !== false,
        extensionCount: Math.max(0, Number(applied.extensionCount) || 0),
      } : null,
      runtimeType: String(t.runtimeType || 'chromium').trim(),
      runtimeStatus: String(t.runtimeStatus || 'starting').trim(),
      browserProfile: actualProfile ? {
        browserBrand: String(actualProfile.browserBrand || '').trim(),
        browserType: String(actualProfile.browserType || '').trim(),
        browserVersion: String(actualProfile.browserVersion || '').trim(),
        majorVersion: String(actualProfile.majorVersion || '').trim(),
        region: String(actualProfile.region || '').trim(),
        regionLabel: String(actualProfile.regionLabel || '').trim(),
        sourceIp: String(actualProfile.sourceIp || '').trim(),
        sourceCountryCode: String(actualProfile.sourceCountryCode || '').trim(),
        sourceCountry: String(actualProfile.sourceCountry || '').trim(),
        sourceRegion: String(actualProfile.sourceRegion || '').trim(),
        sourceCity: String(actualProfile.sourceCity || '').trim(),
        locale: String(actualProfile.locale || '').trim(),
        timezoneId: String(actualProfile.timezoneId || '').trim(),
        acceptLanguage: String(actualProfile.acceptLanguage || '').trim(),
        userAgent: String(actualProfile.userAgent || '').trim(),
        uaBrands: Array.isArray(actualProfile.uaBrands)
          ? actualProfile.uaBrands.map((item) => ({
            brand: String(item?.brand || '').trim(),
            version: String(item?.version || '').trim(),
          })).filter((item) => item.brand)
          : [],
      } : null,
      });
    });
  }

// 获取/读取/解析：getTabsSignature的具体业务逻辑。
  function getTabsSignature(tabData) {
    try {
      return JSON.stringify(tabData.map((item) => [
        item.id,
        item.title,
        item.isActive ? 1 : 0,
        item.accountId || '',
        item.browserHistoryId || '',
        item.browserProxyMode || '',
        item.networkMagicEnabled ? 1 : 0,
        JSON.stringify(item.browserSettings || {}),
        item.runtimeEnvironment?.windowWidth || 0,
        item.runtimeEnvironment?.windowHeight || 0,
        item.runtimeEnvironment?.hardwareAcceleration === false ? 0 : 1,
        item.runtimeEnvironment?.extensionCount || 0,
        item.runtimeType || '',
        item.runtimeStatus || '',
        item.browserProfile?.browserBrand || '',
        item.browserProfile?.region || '',
        item.browserProfile?.sourceIp || '',
        item.browserProfile?.sourceCountry || '',
        item.browserProfile?.sourceRegion || '',
        item.browserProfile?.sourceCity || '',
        item.browserProfile?.locale || '',
        item.browserProfile?.timezoneId || '',
      ]));
    } catch (_) {
      return '';
    }
  }

// 设置/更新/持久化：updateTabs的具体业务逻辑。
  function updateTabs(force = false) {
    try {
      const mainWindow = resolveMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (tabsUpdateTimer) {
        clearTimeout(tabsUpdateTimer);
        tabsUpdateTimer = null;
      }

// 处理：sendUpdate的具体业务逻辑。
      const sendUpdate = () => {
        const win = resolveMainWindow();
        if (!win || win.isDestroyed()) return;
        const tabData = buildTabsPayload();
        const signature = getTabsSignature(tabData);
        if (!force && signature && signature === lastTabsSignature) return;
        lastTabsSignature = signature;
        win.webContents.send('update-tabs', tabData);
        const sideView = resolveSideView();
        if (sideView && sideView.webContents && !sideView.webContents.isDestroyed()) {
          sideView.webContents.send('update-tabs', tabData);
        }
      };

      if (force) {
        sendUpdate();
      } else {
        tabsUpdateTimer = setTimeout(sendUpdate, 120);
      }
    } catch (_) {}
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
      logger,
      logPrefix: 'TabHelpers',
    });
  }

  return {
    buildTabsPayload,
    getTabsSignature,
    updateTabs,
    getActiveWC,
    resolveTabTitle,
    toggleSidebar,
  };
}

module.exports = {
  createTabHelpers,
};
