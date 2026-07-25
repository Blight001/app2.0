const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppShellBootstrap } = require('../../../src/app/main/services/app-shell-bootstrap');

function bootstrapDeps(options = {}) {
  let bootstrapped = options.bootstrapped === true;
  const calls = { createMainWindow: 0, openTutorial: 0, revealMainWindow: 0 };
  const deps = {
    accountStorage: {},
    app: { getPath: () => 'C:/AI-FREE-test-user-data' },
    applyPluginSettings() {},
    createAuthCookie: () => ({}),
    createHttpClient: () => ({}),
    createMainWindow: () => { calls.createMainWindow += 1; },
    ensureAnnouncementPoller: () => ({ start() {} }),
    extensionManager: { async initialize() {} },
    fs: {
      promises: {
        readdir: async () => [],
      },
    },
    getServerBase: () => '',
    initDownloadPrefs() {},
    isControlPanelOnlyModeEnabled: () => false,
    isDevMode: false,
    licenseCache: { getRuntimeConfig: () => ({}) },
    logger: { error() {}, log() {}, warn() {} },
    path: { join: (...parts) => parts.join('/') },
    registerIPC() {},
    resolveActiveTabId: () => null,
    resolveAddTab: () => () => {},
    resolveAuth: () => ({}),
    resolveCloseTab: () => () => {},
    resolveGlobalHttpClient: () => ({}),
    resolveIsMainBootstrapped: () => bootstrapped,
    resolveMainWindow: () => (
      Object.prototype.hasOwnProperty.call(options, 'mainWindow') ? options.mainWindow : {}
    ),
    resolveOpenTutorialTab: () => () => { calls.openTutorial += 1; },
    resolveRefreshActiveTab: () => () => {},
    resolveRefreshActiveTabToUrl: () => () => {},
    resolveRefreshTab: () => () => {},
    resolveRenameTab: () => () => {},
    resolveReorderTab: () => () => {},
    resolveSetTabAccountId: () => () => {},
    resolveSetTabBrowserSettings: () => () => {},
    resolveSetZoom: () => () => {},
    resolveSideView: () => null,
    resolveSwitchTab: () => () => {},
    resolveSyncTutorialTabUrl: () => () => {},
    resolveTabs: () => new Map(),
    revealMainWindow() { calls.revealMainWindow += 1; },
    setAuth() {},
    setIsMainBootstrapped: (value) => { bootstrapped = value; },
    statePluginGetter: () => ({}),
    updateTabs() {},
  };
  return { calls, deps };
}

test('软件启动显示内置首页且不自动打开教程或启动浏览器', async () => {
  const { calls, deps } = bootstrapDeps();

  await createAppShellBootstrap(deps)();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.createMainWindow, 1);
  assert.equal(calls.openTutorial, 0);
});

test('主界面已初始化但窗口缺失时只重建软件外壳', async () => {
  const { calls, deps } = bootstrapDeps({ bootstrapped: true, mainWindow: null });

  await createAppShellBootstrap(deps)();

  assert.equal(calls.createMainWindow, 1);
  assert.equal(calls.revealMainWindow, 1);
  assert.equal(calls.openTutorial, 0);
});
