'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('侧边栏状态事件同时投递到独立浏览器配置页', () => {
  const consoleModulePath = require.resolve('../../../src/app/main/runtime/app-console');
  const bridgeModulePath = require.resolve('../../../src/app/main/composition/create-ui-bridge');
  const originalConsoleModule = require.cache[consoleModulePath];
  const originalBridgeModule = require.cache[bridgeModulePath];
  require.cache[consoleModulePath] = {
    id: consoleModulePath,
    filename: consoleModulePath,
    loaded: true,
    exports: {
      createAppConsoleBridge: () => ({
        install() {},
        pushDebugOnly() {},
        getHistory: () => [],
        getDebugHistory: () => [],
      }),
    },
    children: [],
    paths: [],
  };
  delete require.cache[bridgeModulePath];

  try {
    const { createUiBridge } = require(bridgeModulePath);
    const sidebarEvents = [];
    const settingsEvents = [];
    const makeView = (events) => ({
      webContents: {
        isDestroyed: () => false,
        send: (...args) => events.push(args),
      },
    });
    const bridge = createUiBridge({
      getSideView: () => makeView(sidebarEvents),
      getBrowserSettingsView: () => makeView(settingsEvents),
      getControlPanelWindow: () => null,
      getConsoleWindow: () => null,
    });

    assert.equal(bridge.sendToSide('clash-mini-status', { running: true }), true);
    assert.deepEqual(sidebarEvents, [['clash-mini-status', { running: true }]]);
    assert.deepEqual(settingsEvents, [['clash-mini-status', { running: true }]]);
  } finally {
    if (originalConsoleModule) require.cache[consoleModulePath] = originalConsoleModule;
    else delete require.cache[consoleModulePath];
    if (originalBridgeModule) require.cache[bridgeModulePath] = originalBridgeModule;
    else delete require.cache[bridgeModulePath];
  }
});
