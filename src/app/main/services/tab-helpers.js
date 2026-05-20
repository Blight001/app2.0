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
// 处理：isOpenCutTab的具体业务逻辑。
  const isOpenCutTab = (tab = {}) => {
    const partition = String(tab?.partition || '').trim();
    if (partition === 'persist:opencut' || partition === 'opencut') {
      return true;
    }
    const currentUrl = String(tab?.view?.webContents?.getURL?.() || '').trim().toLowerCase();
    return currentUrl.startsWith('https://www.opencut.app/projects')
      || currentUrl.startsWith('https://opencut.app/projects')
      || currentUrl.startsWith('http://www.opencut.app/projects')
      || currentUrl.startsWith('http://opencut.app/projects');
  };
// 处理：isToonflowTab的具体业务逻辑。
  const isToonflowTab = (tab = {}) => {
    const partition = String(tab?.partition || '').trim();
    if (partition === 'persist:toonflow' || partition === 'toonflow') {
      return true;
    }
    const currentUrl = String(tab?.view?.webContents?.getURL?.() || '').trim().toLowerCase();
    return currentUrl.startsWith('http://localhost:10588/')
      || currentUrl.startsWith('http://127.0.0.1:10588/')
      || currentUrl.startsWith('https://localhost:10588/')
      || currentUrl.startsWith('https://127.0.0.1:10588/');
  };
// 获取/读取/解析：resolveTabTitle的具体业务逻辑。
  const resolveTabTitle = (tab = {}) => {
    const fixedTitle = String(tab?.fixedTitle || tab?.tabTitle || '').trim();
    if (fixedTitle) {
      return fixedTitle;
    }
    if (isOpenCutTab(tab)) {
      return '视频剪辑';
    }
    if (isToonflowTab(tab)) {
      return 'Toonflow';
    }
    return String(tab?.view?.webContents?.getTitle?.() || '').trim();
  };

  let tabsUpdateTimer = null;
  let lastTabsSignature = '';

// 创建/初始化：buildTabsPayload的具体业务逻辑。
  function buildTabsPayload() {
    return Array.from(resolveTabs().values()).map((t) => ({
      id: t.id,
      title: resolveTabTitle(t),
      isActive: t.id === resolveActiveTabId(),
      accountId: String(t.accountId || '').trim(),
      browserProxyMode: String(t.browserProxyMode || 'inherit').trim(),
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
        item.browserProxyMode || '',
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
    try {
      const t = resolveTabs().get(resolveActiveTabId());
      return t && t.view && t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    } catch (_) {
      return null;
    }
  }

// 设置/更新/持久化：toggleSidebar的具体业务逻辑。
  function toggleSidebar() {
    try {
      const nextVisible = !resolveIsSidebarVisible();
      if (typeof setIsSidebarVisible === 'function') {
        setIsSidebarVisible(nextVisible);
      }

      const mainWindow = resolveMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(nextVisible ? 'sidebar-expand' : 'sidebar-collapse');
      }

      const sideView = resolveSideView();
      if (sideView && sideView.webContents && !sideView.webContents.isDestroyed()) {
        sideView.webContents.send(nextVisible ? 'sidebar-expand' : 'sidebar-collapse');
      }

      const delay = nextVisible ? 140 : 400;
      setTimeout(() => {
        const win = resolveMainWindow();
        if (win && !win.isDestroyed()) {
          win.emit('resize');
        }
      }, delay);
    } catch (error) {
      logger.warn?.('[TabHelpers] toggleSidebar 失败:', error?.message || error);
    }
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
