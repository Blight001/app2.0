'use strict';

const { createWorkspaceWindowController } = require('./workspace-window-controller');

function createSoftwareWindowController(deps = {}) {
  return createWorkspaceWindowController({
    ...deps,
    type: 'software',
    title: 'AI-FREE 软件控制',
    htmlPath: deps.path.join(__dirname, '../../renderer/software-workspace/index.html'),
    preloadPath: deps.path.join(__dirname, '../preload/software-preload.js'),
  });
}

module.exports = { createSoftwareWindowController };
