function isUsableWebContents(webContents) {
  return !!webContents && !(typeof webContents.isDestroyed === 'function' && webContents.isDestroyed());
}

function isUsableWindow(win) {
  return !!win && !(typeof win.isDestroyed === 'function' && win.isDestroyed());
}

function resolveTabTitle(tab = {}) {
  const fixedTitle = String(tab?.fixedTitle || tab?.tabTitle || '').trim();
  if (fixedTitle) {
    return fixedTitle;
  }
  return String(tab?.view?.webContents?.getTitle?.() || '').trim();
}

function normalizePersistPartitionName(partition) {
  return String(partition || '').trim().replace(/^persist:/, '');
}

function normalizeManagedTabPartitionSuffix(value) {
  const text = String(value || '').trim();
  if (!text) return Date.now().toString();
  return text
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || Date.now().toString();
}

function buildManagedTabPartitionName(accountId) {
  return `tab-${normalizeManagedTabPartitionSuffix(accountId)}`;
}

function buildDefaultManagedTabPartitionName() {
  return buildManagedTabPartitionName('default');
}

function getActiveTabWebContents(tabs, activeTabId) {
  try {
    const tab = tabs && typeof tabs.get === 'function' ? tabs.get(activeTabId) : null;
    const webContents = tab?.view?.webContents || null;
    return isUsableWebContents(webContents) ? webContents : null;
  } catch (_) {
    return null;
  }
}

function sendSidebarVisibility(target, visible) {
  const webContents = target?.webContents || null;
  if (isUsableWebContents(webContents)) {
    webContents.send(visible ? 'sidebar-expand' : 'sidebar-collapse');
  }
}

function toggleSidebarVisibility(options = {}) {
  const {
    getIsSidebarVisible,
    setIsSidebarVisible,
    getMainWindow,
    getSideView,
    logger = null,
    logPrefix = 'Tabs',
  } = options;

  try {
    const currentVisible = typeof getIsSidebarVisible === 'function' ? getIsSidebarVisible() : true;
    const nextVisible = !currentVisible;
    if (typeof setIsSidebarVisible === 'function') {
      setIsSidebarVisible(nextVisible);
    }

    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (isUsableWindow(mainWindow)) {
      mainWindow.webContents.send(nextVisible ? 'sidebar-expand' : 'sidebar-collapse');
    }

    const sideView = typeof getSideView === 'function' ? getSideView() : null;
    sendSidebarVisibility(sideView, nextVisible);

    const delay = nextVisible ? 140 : 400;
    setTimeout(() => {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (isUsableWindow(win)) {
        win.emit('resize');
      }
    }, delay);

    return nextVisible;
  } catch (error) {
    logger?.warn?.(`[${logPrefix}] toggleSidebar 失败:`, error?.message || error);
    return null;
  }
}

module.exports = {
  buildDefaultManagedTabPartitionName,
  buildManagedTabPartitionName,
  getActiveTabWebContents,
  normalizePersistPartitionName,
  resolveTabTitle,
  toggleSidebarVisibility,
};
