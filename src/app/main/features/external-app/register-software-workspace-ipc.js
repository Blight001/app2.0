'use strict';

function registerSoftwareWorkspaceIPC(ctx) {
  const workspace = ctx.softwareWorkspace;
  if (!workspace) return;
  const ipc = ctx.ipc.scope('features/external-app/software-workspace');
  ipc.on('software-close-tab', (_event, tabId) => {
    void workspace.tabManager.closeTab(tabId);
  });
  ipc.on('software-reorder-tab', (_event, payload = {}) => {
    workspace.tabManager.reorderTab(
      payload.tabId,
      payload.targetTabId,
      payload.position,
    );
  });
  ipc.on('software-switch-tab', (_event, tabId) => {
    void workspace.tabManager.switchTab(tabId);
  });
  ipc.on('software-toggle-sidebar', () => workspace.toggleSidebar());
}

module.exports = { registerSoftwareWorkspaceIPC };
