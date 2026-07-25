'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  createWorkspaceAppShellDeps,
} = require('../../../src/app/main/composition/workspace-app-shell-deps');
const {
  createAppShellBootstrap,
} = require('../../../src/app/main/services/app-shell-bootstrap');

test('AppShell 创建前注入可晚绑定的 Home、授权和 Software 装配', () => {
  let workspaceShell = null;
  let softwareWorkspace = null;
  let homeBootstraps = 0;
  const deps = createWorkspaceAppShellDeps({
    getWorkspaceShell: () => workspaceShell,
    getSoftwareWorkspace: () => softwareWorkspace,
  });

  assert.throws(() => deps.bootstrapWorkspaceShell(), /尚未装配/);
  workspaceShell = {
    bootstrap: () => { homeBootstraps += 1; },
    authorizeIpc: (...args) => ({ ok: true, args }),
  };
  softwareWorkspace = { domain: 'software' };

  deps.bootstrapWorkspaceShell();
  assert.equal(homeBootstraps, 1);
  assert.deepEqual(deps.authorizeIpc('channel', 'event'), {
    ok: true,
    args: ['channel', 'event'],
  });
  assert.equal(deps.getSoftwareWorkspace(), softwareWorkspace);
  assert.equal(deps.deferBrowserBootstrap, true);
});

test('AppShell 启动只打开 Home 并向 IPC 注册当前 Software Workspace', async () => {
  const noop = () => {};
  const client = {};
  const softwareWorkspace = { domain: 'software' };
  const authorizeIpc = () => ({ ok: true });
  let bootstrapped = false;
  let homeBootstraps = 0;
  let browserWindows = 0;
  let ipcContext = null;
  const resolveNothing = () => null;
  const bootstrap = createAppShellBootstrap({
    resolveIsMainBootstrapped: () => bootstrapped,
    setIsMainBootstrapped: (value) => { bootstrapped = value; },
    resolveGlobalHttpClient: () => client,
    setGlobalHttpClient: noop,
    createHttpClient: () => client,
    createAuthCookie: () => ({}),
    setAuth: noop,
    getServerBase: () => '',
    sendToSide: noop,
    licenseCache: { getRuntimeConfig: () => ({}) },
    registerIPC: (context) => { ipcContext = context; },
    authorizeIpc,
    getSoftwareWorkspace: () => softwareWorkspace,
    getDreamTargetUrl: () => '',
    httpGetUniversal: noop,
    resolveAuth: resolveNothing,
    resolveAddTab: resolveNothing,
    resolveOpenTutorialTab: resolveNothing,
    resolveSyncTutorialTabUrl: resolveNothing,
    resolveSwitchTab: resolveNothing,
    resolveCloseTab: resolveNothing,
    resolveReorderTab: resolveNothing,
    resolveRenameTab: resolveNothing,
    resolveSetTabAccountId: resolveNothing,
    resolveSetTabBrowserSettings: resolveNothing,
    resolveSetZoom: resolveNothing,
    resolveRefreshActiveTabToUrl: resolveNothing,
    resolveRefreshActiveTab: resolveNothing,
    resolveRefreshTab: resolveNothing,
    resolveAddExternalApp: resolveNothing,
    resolveTabs: () => new Map(),
    resolveActiveTabId: resolveNothing,
    resolveMainWindow: resolveNothing,
    resolveSideView: resolveNothing,
    ensureAnnouncementPoller: () => ({ start: noop, refreshNow: noop }),
    bootstrapWorkspaceShell: () => { homeBootstraps += 1; },
    createMainWindow: () => { browserWindows += 1; },
    isControlPanelOnlyModeEnabled: () => false,
    isDevMode: false,
    deferBrowserBootstrap: true,
    initDownloadPrefs: noop,
    extensionManager: { initialize: async () => {} },
    applyPluginSettings: noop,
    app: { getPath: () => 'C:/test-user-data' },
    fs: { promises: { readdir: async () => [] } },
    path,
    logger: { log: noop, warn: noop, error: noop },
  });

  await bootstrap();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(homeBootstraps, 1);
  assert.equal(browserWindows, 0);
  assert.equal(ipcContext.softwareWorkspace, softwareWorkspace);
  assert.equal(ipcContext.authorizeIpc, authorizeIpc);
});
