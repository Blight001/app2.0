'use strict';

function revealWindow(window) {
  if (!window || window.isDestroyed?.()) return false;
  if (window.isMinimized?.()) window.restore?.();
  window.show?.();
  window.focus?.();
  return true;
}

function createWorkspaceWindowController(options = {}) {
  const {
    type,
    BrowserWindow,
    registry,
    htmlPath,
    preloadPath,
    title,
    icon,
    onWindowCreated,
    onWindowDisposed,
    logger = console,
    windowOptions = {},
  } = options;

  function getWindow() {
    return registry.get(type)?.window || null;
  }

  function open() {
    const existing = getWindow();
    if (revealWindow(existing)) return existing;
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title,
      icon,
      autoHideMenuBar: true,
      ...windowOptions,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        ...windowOptions.webPreferences,
        preload: preloadPath,
      },
    });
    registry.register(type, {
      window,
      status: 'loading',
      dispose: () => onWindowDisposed?.(window),
    });
    onWindowCreated?.(window);
    window.once?.('ready-to-show', () => {
      registry.setStatus(type, 'ready');
      revealWindow(window);
    });
    Promise.resolve(window.loadFile(htmlPath)).catch((error) => {
      logger.error?.(`[Workspace:${type}] 页面加载失败:`, error?.message || error);
      registry.setStatus(type, 'failed');
    });
    return window;
  }

  return Object.freeze({
    type,
    getWindow,
    open,
    reveal: () => revealWindow(getWindow()),
    dispose: (options) => registry.disposeWorkspace(type, { closeWindow: true, ...options }),
  });
}

module.exports = { createWorkspaceWindowController, revealWindow };
