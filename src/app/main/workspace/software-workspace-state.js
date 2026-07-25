'use strict';

function createSoftwareWorkspaceState() {
  const tabs = new Map();
  const state = {
    window: null,
    sideView: null,
    activeTabId: null,
    isSidebarVisible: true,
  };

  return Object.freeze({
    tabs,
    getWindow: () => state.window,
    setWindow: (window) => { state.window = window; },
    getSideView: () => state.sideView,
    setSideView: (sideView) => { state.sideView = sideView; },
    getActiveTabId: () => state.activeTabId,
    setActiveTabId: (tabId) => { state.activeTabId = tabId; },
    getIsSidebarVisible: () => state.isSidebarVisible,
    setIsSidebarVisible: (visible) => { state.isSidebarVisible = visible === true; },
  });
}

module.exports = { createSoftwareWorkspaceState };
