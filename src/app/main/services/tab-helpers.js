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
    return Array.from(resolveTabs().values()).map((t) => ({
      id: t.id,
      title: resolveTabTitle(t),
      isActive: t.id === resolveActiveTabId(),
      accountId: String(t.accountId || '').trim(),
      browserHistoryId: String(t.browserHistoryId || '').trim(),
      browserProxyMode: String(t.browserProxyMode || 'inherit').trim(),
      runtimeType: String(t.runtimeType || 'chromium').trim(),
      runtimeStatus: String(t.runtimeStatus || 'starting').trim(),
      browserProfile: t.browserProfile ? {
        browserBrand: String(t.browserProfile.browserBrand || '').trim(),
        browserType: String(t.browserProfile.browserType || '').trim(),
        region: String(t.browserProfile.region || '').trim(),
        regionLabel: String(t.browserProfile.regionLabel || '').trim(),
        sourceIp: String(t.browserProfile.sourceIp || '').trim(),
        sourceCountryCode: String(t.browserProfile.sourceCountryCode || '').trim(),
        sourceCountry: String(t.browserProfile.sourceCountry || '').trim(),
        locale: String(t.browserProfile.locale || '').trim(),
        timezoneId: String(t.browserProfile.timezoneId || '').trim(),
        acceptLanguage: String(t.browserProfile.acceptLanguage || '').trim(),
        userAgent: String(t.browserProfile.userAgent || '').trim(),
      } : null,
    }));
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
        item.runtimeType || '',
        item.runtimeStatus || '',
        item.browserProfile?.browserBrand || '',
        item.browserProfile?.region || '',
        item.browserProfile?.sourceIp || '',
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
