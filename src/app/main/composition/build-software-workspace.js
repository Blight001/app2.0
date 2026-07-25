'use strict';

const { createTabHelpers } = require('../services/tab-helpers');
const {
  createSoftwareTabManager,
} = require('../features/external-app/software-tab-manager');
const {
  createSoftwareAutomationBridge,
} = require('../features/external-app/software-automation-bridge');
const {
  createSoftwareWorkspaceState,
} = require('../workspace/software-workspace-state');

function createSoftwareSideSender(state) {
  return (channel, ...args) => {
    const webContents = state.getSideView()?.webContents;
    if (!webContents || webContents.isDestroyed?.()) return false;
    webContents.send(channel, ...args);
    return true;
  };
}

async function disposeSoftwareTabs(state, tabManager) {
  for (const tabId of [...state.tabs.keys()]) {
    await tabManager.closeTab(tabId);
  }
  state.tabs.clear();
  state.setActiveTabId(null);
}

function createSoftwareWorkspaceComposition(deps = {}) {
  let domainDisposer = null;
  const state = createSoftwareWorkspaceState();
  const sendToSide = createSoftwareSideSender(state);
  const automationBridge = createSoftwareAutomationBridge({
    browserRuntimeManager: deps.browserRuntimeManager,
    cardCacheDir: deps.automationCardCacheDir,
    onProgress: (payload) => sendToSide('automation-card-progress', payload),
  });
  const tabHelpers = createTabHelpers({
    logger: deps.logger,
    getTabs: () => state.tabs,
    getMainWindow: state.getWindow,
    getSideView: state.getSideView,
    getActiveTabId: state.getActiveTabId,
    getIsSidebarVisible: state.getIsSidebarVisible,
    setIsSidebarVisible: state.setIsSidebarVisible,
    sendToSide,
    browserRuntimeManager: deps.browserRuntimeManager,
    cursorSidecarService: null,
    tabsUpdatedChannel: 'software-tabs-updated',
  });
  const updateTabs = tabHelpers.updateTabs;
  const tabManager = createSoftwareTabManager({
    browserRuntimeManager: deps.browserRuntimeManager,
    softwareCatalog: deps.softwareCatalog,
    logger: deps.logger,
    getTabs: () => state.tabs,
    getMainWindow: state.getWindow,
    getSideView: state.getSideView,
    getActiveTabId: state.getActiveTabId,
    setActiveTabId: state.setActiveTabId,
    getIsSidebarVisible: state.getIsSidebarVisible,
    setIsSidebarVisible: state.setIsSidebarVisible,
    updateTabs,
  });
  return Object.freeze({
    state,
    automationBridge,
    aiHistoryDirectory: deps.aiHistoryDirectory,
    tabManager,
    start: tabManager.start,
    sendToSide,
    updateTabs,
    toggleSidebar: tabHelpers.toggleSidebar,
    openExternalApp: tabManager.addExternalApp,
    softwareWindowUi: Object.freeze({
      listAvailableSoftware: () => deps.softwareCatalog.listAvailable(),
      openExternalApp: tabManager.addExternalApp,
      switchTab: tabManager.switchTab,
      closeTab: tabManager.closeTab,
    }),
    setDomainDisposer: (disposer) => {
      domainDisposer = typeof disposer === 'function' ? disposer : null;
    },
    dispose: async () => {
      await domainDisposer?.();
      automationBridge.dispose();
      await disposeSoftwareTabs(state, tabManager);
      tabManager.stop();
    },
  });
}

module.exports = {
  createSoftwareWorkspaceComposition,
  disposeSoftwareTabs,
};
