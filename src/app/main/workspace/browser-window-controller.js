'use strict';

const { createWorkspaceWindowController } = require('./workspace-window-controller');

function createBrowserWindowController(deps = {}) {
  return createWorkspaceWindowController({
    ...deps,
    type: 'browser',
    title: 'AI-FREE 浏览器',
    htmlPath: deps.path.join(__dirname, '../../renderer/browser-workspace/index.html'),
    preloadPath: deps.path.join(__dirname, '../preload/browser-preload.js'),
  });
}

module.exports = { createBrowserWindowController };
