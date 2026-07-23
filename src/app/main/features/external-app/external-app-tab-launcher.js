'use strict';

const { resolveSidebarWidth } = require('../../../shared/sidebar-layout');

class ExternalAppTabLauncher {
  constructor(deps = {}) {
    this.deps = deps;
  }

  resolveBounds(mainWindow) {
    const [contentWidth, contentHeight] = mainWindow.getContentSize();
    const sidebarWidth = resolveSidebarWidth({
      contentWidth,
      isVisible: this.deps.resolveIsSidebarVisible(),
      isMaximized: mainWindow.isMaximized?.() === true,
      currentWidth: this.deps.resolveSideView()?.getBounds?.().width,
      normalWindowWidth: mainWindow.getNormalBounds?.().width,
    });
    return { x: 0, y: 41, width: contentWidth - sidebarWidth, height: Math.max(0, contentHeight - 41) };
  }

  async addExternalApp(softwareId) {
    const definition = this.deps.softwareCatalog?.getLaunchDefinition(softwareId);
    if (!definition) throw new Error('该软件未安装或暂不支持嵌入');
    const tabs = this.deps.resolveTabs();
    const existing = [...tabs.values()].find((tab) => tab.softwareId === definition.id);
    if (existing) {
      this.deps.switchTab(existing.id, { focusBrowser: true });
      return existing.id;
    }
    const mainWindow = this.deps.resolveMainWindow();
    if (!mainWindow || mainWindow.isDestroyed?.()) throw new Error('AI-FREE 主窗口不可用');
    const id = `software-${definition.id}-${Date.now()}`;
    const previousId = String(this.deps.resolveActiveTabId() || '');
    const tab = {
      id,
      fixedTitle: definition.name,
      runtimeTitle: definition.name,
      runtimeType: 'external-app',
      runtimeStatus: 'starting',
      softwareId: definition.id,
      networkMagicApplied: false,
    };
    tabs.set(id, tab);
    this.deps.updateTabs(true);
    this.deps.switchTab(id);
    try {
      const state = await this.deps.browserRuntimeManager.launchProfile({
        profileId: id,
        runtimeType: 'external-app',
        softwareId: definition.id,
        displayName: definition.name,
        executablePath: definition.executablePath,
        args: definition.args,
        launchTimeoutMs: definition.launchTimeoutMs,
        existingWindowHwnd: definition.existingWindowHwnd,
        existingWindowPid: definition.existingWindowPid,
      }, this.resolveBounds(mainWindow));
      tab.runtimeStatus = state.status;
      this.deps.switchTab(id, { focusBrowser: true });
      return id;
    } catch (error) {
      if (tabs.get(id) === tab) tabs.delete(id);
      if (previousId && tabs.has(previousId)) this.deps.switchTab(previousId);
      this.deps.updateTabs(true);
      throw error;
    }
  }
}

function createExternalAppTabLauncher(deps) {
  const launcher = new ExternalAppTabLauncher(deps);
  return { addExternalApp: (softwareId) => launcher.addExternalApp(softwareId) };
}

module.exports = { ExternalAppTabLauncher, createExternalAppTabLauncher };
