'use strict';

const { revealWindow } = require('./workspace-window-controller');

function createBrowserShellController(deps = {}) {
  const {
    registry,
    createWindow,
    revealBrowserWindow,
    getWindow,
    getSideView,
    clearWindow,
    initializeBrowser,
    logger = console,
  } = deps;

  if (typeof createWindow !== 'function' || typeof getWindow !== 'function') {
    throw new TypeError('Browser Workspace 缺少窗口创建依赖');
  }

  function registerWindow(window) {
    registry.register('browser', {
      window,
      sideView: getSideView?.() || null,
      status: 'ready',
      dispose: () => clearWindow?.(window),
    });
    return window;
  }

  function open() {
    const existing = getWindow();
    if (existing && !existing.isDestroyed?.()) {
      if (!revealBrowserWindow?.()) revealWindow(existing);
      return existing;
    }
    const window = registerWindow(createWindow());
    Promise.resolve(initializeBrowser?.()).catch((error) => {
      logger.warn?.(
        '[Workspace:browser] 初始化浏览器内容失败:',
        error?.message || error,
      );
    });
    return window;
  }

  return Object.freeze({
    type: 'browser',
    getWindow: () => registry.get('browser')?.window || null,
    open,
    reveal: () => {
      if (revealBrowserWindow?.()) return true;
      return revealWindow(getWindow());
    },
    dispose: (options) => registry.disposeWorkspace(
      'browser',
      { closeWindow: true, ...options },
    ),
  });
}

module.exports = { createBrowserShellController };
