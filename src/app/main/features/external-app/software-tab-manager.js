'use strict';

const {
  createExternalAppTabLauncher,
} = require('./external-app-tab-launcher');

class SoftwareTabManager {
  constructor(deps = {}) {
    this.deps = deps;
    this.tabs = deps.getTabs();
    this.closing = new Set();
    this.externalApp = deps.browserRuntimeManager?.externalApp;
    this.listening = false;
    const launcher = createExternalAppTabLauncher({
      browserRuntimeManager: deps.browserRuntimeManager,
      softwareCatalog: deps.softwareCatalog,
      resolveActiveTabId: deps.getActiveTabId,
      resolveIsSidebarVisible: deps.getIsSidebarVisible,
      resolveMainWindow: deps.getMainWindow,
      resolveSideView: deps.getSideView,
      resolveTabs: () => this.tabs,
      switchTab: this.switchTab.bind(this),
      updateTabs: deps.updateTabs,
    });
    this.addExternalApp = launcher.addExternalApp;
    this.handleState = this.handleState.bind(this);
    this.handleCrash = this.handleCrash.bind(this);
    this.start();
  }

  handleState(state) {
    const tab = this.tabs.get(String(state?.profileId || ''));
    if (!tab) return;
    tab.runtimeStatus = state.status;
    tab.runtimeError = state.lastError || null;
    this.deps.updateTabs(true);
  }

  handleCrash(state) {
    const tabId = String(state?.profileId || '');
    if (this.tabs.has(tabId)) void this.closeTab(tabId);
  }

  start() {
    if (this.listening || typeof this.externalApp?.on !== 'function') return;
    this.listening = true;
    this.externalApp.on('state-changed', this.handleState);
    this.externalApp.on('crashed', this.handleCrash);
  }

  stop() {
    if (!this.listening) return;
    this.listening = false;
    this.externalApp.off?.('state-changed', this.handleState);
    this.externalApp.off?.('crashed', this.handleCrash);
  }

  switchTab(tabId, options = {}) {
    const window = this.deps.getMainWindow();
    if (!window || !this.tabs.has(tabId)) return false;
    const previous = this.tabs.get(this.deps.getActiveTabId());
    if (previous) {
      void this.deps.browserRuntimeManager.hide(previous.id, 'external-app');
    }
    this.deps.setActiveTabId(tabId);
    void this.showTab(tabId, options);
    window.emit?.('resize');
    this.deps.updateTabs(true);
    return true;
  }

  async showTab(tabId, options) {
    try {
      await this.deps.browserRuntimeManager.show(tabId, 'external-app');
      if (options.focusBrowser === true) {
        await this.deps.browserRuntimeManager.focus(tabId, 'external-app');
      }
    } catch (error) {
      this.deps.logger?.warn?.(
        '[SoftwareWorkspace] 显示软件失败:',
        error?.message || error,
      );
    }
  }

  async closeTab(tabId) {
    if (!this.tabs.has(tabId) || this.closing.has(tabId)) return false;
    this.closing.add(tabId);
    try {
      const order = [...this.tabs.keys()];
      await this.deps.browserRuntimeManager.stop(tabId, 'external-app', {
        timeoutMs: 4000,
      });
      this.tabs.delete(tabId);
      this.activateNeighbor(tabId, order);
      this.deps.updateTabs(true);
      return true;
    } finally {
      this.closing.delete(tabId);
    }
  }

  activateNeighbor(tabId, order) {
    if (this.deps.getActiveTabId() !== tabId) return;
    const index = order.indexOf(tabId);
    const nextId = order[index - 1] || order[index + 1] || null;
    if (nextId && this.tabs.has(nextId)) this.switchTab(nextId);
    else this.deps.setActiveTabId(null);
  }

  reorderTab(tabId, targetTabId, position = 'before') {
    if (!tabId || !targetTabId || tabId === targetTabId) return false;
    if (!this.tabs.has(tabId) || !this.tabs.has(targetTabId)) return false;
    const entries = [...this.tabs.entries()].filter(([id]) => id !== tabId);
    const targetIndex = entries.findIndex(([id]) => id === targetTabId);
    if (targetIndex < 0) return false;
    entries.splice(
      position === 'after' ? targetIndex + 1 : targetIndex,
      0,
      [tabId, this.tabs.get(tabId)],
    );
    this.tabs.clear();
    for (const [id, tab] of entries) this.tabs.set(id, tab);
    this.deps.updateTabs(true);
    return true;
  }
}

function createSoftwareTabManager(deps) {
  const manager = new SoftwareTabManager(deps);
  return Object.freeze({
    addExternalApp: manager.addExternalApp,
    closeTab: manager.closeTab.bind(manager),
    reorderTab: manager.reorderTab.bind(manager),
    start: manager.start.bind(manager),
    stop: manager.stop.bind(manager),
    switchTab: manager.switchTab.bind(manager),
  });
}

module.exports = { SoftwareTabManager, createSoftwareTabManager };
