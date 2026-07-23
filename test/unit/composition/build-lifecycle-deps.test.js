'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildLifecycleDeps,
} = require('../../../src/app/main/composition/build-lifecycle-deps');

test('生命周期装配向动态软件 MCP 提供当前活动栏目', () => {
  const activeTabId = 'software-notepad';
  const noop = () => {};
  const services = {
    appRuntime: {
      getActiveTabId: () => activeTabId,
      getAppConsoleHistory: noop,
      getDebugConsoleHistory: noop,
      getGlobalHttpClient: noop,
      setGlobalHttpClient: noop,
      getIsSwitchingToLicense: noop,
      getIsMainBootstrapped: noop,
      getLicenseWindow: noop,
      getMainWindow: noop,
    },
    tabs: new Map(),
    browserRuntimeManager: {},
    aiSandboxDir: 'C:/AI-Workspace',
    browserAutomationBridge: {},
    aiServerDeviceService: null,
    licenseCache: {},
    browserPartitionCleaner: {
      cleanupAllBrowserSessionData: noop,
      cleanupBrowserPartitionsRootDir: noop,
    },
    isDevMode: false,
    sendToSide: noop,
    getAppConsoleHistory: noop,
    getDebugConsoleHistory: noop,
    licenseStore: {
      getCurrentPlatformLabel: noop,
      readStoreConfigSafe: noop,
      writeStoreConfigSafe: noop,
      writeLicenseRecordsSafe: noop,
      readLicenseRecordsSafe: noop,
    },
    serverResolver: {
      authenticateAccount: noop,
      applyResolvedConfigToStore: noop,
    },
    tabHelpers: { updateTabs: noop },
    runtimeHelpers: { computeDeviceId: noop },
  };
  const deps = buildLifecycleDeps({
    app: {},
    fs: {},
    services,
    appShell: {
      bootstrapMainApp: noop,
      refreshAnnouncements: noop,
      createMainWindow: noop,
      revealMainWindow: noop,
      createDevConsoleWindow: noop,
    },
    refreshAllowedPlatformsAndNotify: noop,
    late: {
      getAddTab: noop,
      getSwitchTab: noop,
      getCloseTab: noop,
      getRenameTab: noop,
      getSetTabBrowserSettings: noop,
    },
  });

  assert.equal(deps.getActiveTabId(), activeTabId);
  assert.equal(deps.browserWindowUi.getActiveTabId(), activeTabId);
});
