'use strict';

const { createWorkspaceWindowController } = require('./workspace-window-controller');

function createHomeWindowController(deps = {}) {
  return createWorkspaceWindowController({
    ...deps,
    type: 'home',
    title: 'AI-FREE',
    htmlPath: deps.path.join(__dirname, '../../renderer/home/index.html'),
    preloadPath: deps.path.join(__dirname, '../preload/home-preload.js'),
    windowOptions: {
      width: 1040,
      height: 720,
      minWidth: 800,
      minHeight: 560,
      ...deps.windowOptions,
    },
  });
}

module.exports = { createHomeWindowController };
