'use strict';

const {
  resolveSidebarWidth,
  resolveShellContentBounds,
} = require('../../shared/sidebar-layout');
const { revealWindow } = require('./workspace-window-controller');

function createWindow(deps) {
  return new deps.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AI-FREE 软件控制',
    icon: deps.icon,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: deps.preloadPath,
      additionalArguments: ['--ai-free-workspace=software'],
    },
  });
}

function createSideView(deps, window) {
  const sideView = new deps.WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      preload: deps.preloadPath,
      additionalArguments: ['--ai-free-workspace=software'],
    },
  });
  deps.state.setSideView(sideView);
  window.contentView.addChildView(sideView);
  return sideView;
}

function resolveLayout(deps, window, sideView) {
  const [width, height] = window.getContentSize();
  const sideViewWidth = resolveSidebarWidth({
    contentWidth: width,
    isVisible: deps.state.getIsSidebarVisible(),
    isMaximized: window.isMaximized?.() === true,
    currentWidth: sideView.getBounds?.().width,
    normalWindowWidth: window.getNormalBounds?.().width,
  });
  return {
    width,
    sideViewWidth,
    content: resolveShellContentBounds({
      contentWidth: width,
      contentHeight: height,
      sideViewWidth,
    }),
  };
}

function updateLayout(deps, window, sideView) {
  const layout = resolveLayout(deps, window, sideView);
  const visible = deps.state.getIsSidebarVisible();
  sideView.setVisible?.(visible);
  if (visible) {
    sideView.setBounds({
      x: layout.width - layout.sideViewWidth,
      y: layout.content.tabBarHeight,
      width: layout.sideViewWidth,
      height: layout.content.height,
    });
  }
  const active = deps.state.tabs.get(deps.state.getActiveTabId());
  if (!active) return;
  void deps.browserRuntimeManager.resize(
    active.id,
    active.runtimeType,
    {
      x: layout.content.x,
      y: layout.content.y,
      width: layout.content.width,
      height: layout.content.height,
    },
  ).catch((error) => {
    deps.logger?.warn?.('[SoftwareWorkspace] 同步软件窗口尺寸失败:', error?.message || error);
  });
}

function bindWindow(deps, window, sideView) {
  const refresh = () => updateLayout(deps, window, sideView);
  window.on('move', refresh);
  window.on('resize', refresh);
  window.on('ready-to-show', () => {
    refresh();
    deps.registry.setStatus('software', 'ready');
    revealWindow(window);
  });
  window.webContents.on('did-finish-load', () => deps.updateTabs(true));
  sideView.webContents.on('did-finish-load', () => deps.updateTabs(true));
}

function loadWorkspaceFile(deps, target, filePath, label) {
  Promise.resolve(target.loadFile(filePath)).catch((error) => {
    deps.registry.setStatus('software', 'failed');
    deps.logger?.warn?.(
      `[SoftwareWorkspace] ${label}加载失败:`,
      error?.message || error,
    );
  });
}

function createSoftwareShellController(deps = {}) {
  function getWindow() {
    return deps.registry.get('software')?.window || null;
  }

  function open() {
    const existing = getWindow();
    if (revealWindow(existing)) return existing;
    deps.startDomain?.();
    const window = createWindow(deps);
    const sideView = createSideView(deps, window);
    deps.state.setWindow(window);
    deps.registry.register('software', {
      window,
      sideView,
      status: 'loading',
      dispose: async () => {
        await deps.disposeDomain?.();
        deps.state.setWindow(null);
        deps.state.setSideView(null);
      },
    });
    bindWindow(deps, window, sideView);
    loadWorkspaceFile(deps, window, deps.mainHtmlPath, '主页面');
    loadWorkspaceFile(deps, sideView.webContents, deps.sidebarHtmlPath, '侧栏');
    return window;
  }

  return Object.freeze({
    type: 'software',
    getWindow,
    open,
    reveal: () => revealWindow(getWindow()),
    dispose: (options) => deps.registry.disposeWorkspace(
      'software',
      { closeWindow: true, ...options },
    ),
  });
}

module.exports = { createSoftwareShellController };
