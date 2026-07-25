'use strict';

const { ok } = require('../../contracts/ipc-result');
const { createIpcRegistry } = require('../ipc/registry');
const { createBrowserWindowController } = require('./browser-window-controller');
const { createBrowserShellController } = require('./browser-shell-controller');
const { createHomeWindowController } = require('./home-window-controller');
const { createSoftwareWindowController } = require('./software-window-controller');
const { createSoftwareShellController } = require('./software-shell-controller');
const { createWorkspaceAccessGuard } = require('./workspace-access');
const { createWorkspaceIpcAuthorizer } = require('./workspace-ipc-policy');
const { createWorkspaceRegistry } = require('./workspace-registry');

function createWorkspaceControllers(deps, registry, getBrowserDisposer) {
  const controllerDeps = {
    BrowserWindow: deps.BrowserWindow,
    registry,
    path: deps.path,
    icon: deps.icon,
    logger: deps.logger,
  };
  const browser = deps.createBrowserWindow
    ? createBrowserShellController({
      registry,
      createWindow: deps.createBrowserWindow,
      revealBrowserWindow: deps.revealBrowserWindow,
      getWindow: deps.getBrowserWindow,
      getSideView: deps.getBrowserSideView,
      clearWindow: async (window) => {
        await getBrowserDisposer()?.();
        deps.clearBrowserWindow?.(window);
      },
      initializeBrowser: deps.initializeBrowserWorkspace,
      logger: deps.logger,
    })
    : createBrowserWindowController(controllerDeps);
  const software = deps.softwareShellDeps
    ? createSoftwareShellController({
      ...deps.softwareShellDeps,
      registry,
    })
    : createSoftwareWindowController(controllerDeps);
  return {
    home: createHomeWindowController({
      ...controllerDeps,
      onWindowCreated: (window) => deps.setMainWindow?.(window),
      onWindowDisposed: () => deps.setMainWindow?.(null),
    }),
    browser,
    software,
  };
}

function createWorkspaceShell(deps = {}) {
  const registry = createWorkspaceRegistry({ logger: deps.logger });
  let browserDomainDisposer = null;
  const controllers = createWorkspaceControllers(
    deps,
    registry,
    () => browserDomainDisposer,
  );
  const ipcRegistry = createIpcRegistry(deps.ipcMain, { source: 'workspace-shell' });
  const ipc = ipcRegistry.scope('src/app/main/workspace/workspace-shell.js');
  const access = createWorkspaceAccessGuard(registry);
  const authorizeIpc = createWorkspaceIpcAuthorizer(access);
  let initialized = false;

  function openWorkspace(type) {
    const controller = controllers[type];
    const created = !controller.getWindow();
    controller.open();
    return ok({ workspaceType: type, created });
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    ipc.handle('workspace-get-type', access.wrap(
      ['home', 'browser', 'software'],
      (event) => ok({ workspaceType: registry.identifySender(event) }),
    ));
    ipc.handle('workspace-open-browser', access.wrap(
      'home',
      () => openWorkspace('browser'),
    ));
    ipc.handle('workspace-open-software', access.wrap(
      'home',
      () => openWorkspace('software'),
    ));
  }

  function bootstrap() {
    initialize();
    controllers.home.open();
  }

  async function dispose() {
    ipcRegistry.dispose();
    await registry.disposeAll({ closeWindow: true });
    deps.setMainWindow?.(null);
  }

  return Object.freeze({
    registry,
    controllers: Object.freeze(controllers),
    bootstrap,
    initialize,
    openHome: controllers.home.open,
    identifySender: (event) => registry.identifySender(event),
    revealHome: controllers.home.reveal,
    getHomeWindow: controllers.home.getWindow,
    authorizeIpc,
    setBrowserDomainDisposer: (disposer) => {
      if (disposer !== null && typeof disposer !== 'function') {
        throw new TypeError('Browser domain disposer 必须是函数或 null');
      }
      browserDomainDisposer = disposer;
    },
    dispose,
  });
}

module.exports = { createWorkspaceShell };
