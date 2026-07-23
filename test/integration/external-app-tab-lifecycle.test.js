'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createTabManager } = require('../../src/app/main/services/tab-manager');

test('软件目录点击创建 external-app 栏目并按实际运行时关闭', async () => {
  const calls = [];
  const tabs = new Map([['browser-1', { id: 'browser-1', runtimeType: 'chromium' }]]);
  let activeTabId = 'browser-1';
  const externalApp = new EventEmitter();
  const manager = createTabManager({
    softwareCatalog: {
      getLaunchDefinition: (id) => id === 'notepad'
        ? { id, name: '记事本', executablePath: 'C:/Windows/notepad.exe' }
        : null,
    },
    browserRuntimeManager: {
      store: { readProfile: () => ({}) },
      chromium: new EventEmitter(),
      externalApp,
      async launchProfile(profile) {
        calls.push(['launch', profile.runtimeType]);
        return { status: 'ready' };
      },
      async show(id, type) { calls.push(['show', id, type]); },
      async hide(id, type) { calls.push(['hide', id, type]); },
      async focus(id, type) { calls.push(['focus', id, type]); },
      async stop(id, type) { calls.push(['stop', id, type]); },
    },
    getTabs: () => tabs,
    getMainWindow: () => ({
      isDestroyed: () => false,
      getContentSize: () => [1200, 800],
      isMaximized: () => false,
      getNormalBounds: () => ({ width: 1200 }),
      emit() {},
    }),
    getSideView: () => ({ getBounds: () => ({ width: 360 }) }),
    getActiveTabId: () => activeTabId,
    setActiveTabId: (id) => { activeTabId = id; },
    getIsSidebarVisible: () => true,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });

  const tabId = await manager.addExternalApp('notepad');
  assert.equal(tabs.get(tabId).runtimeType, 'external-app');
  assert.deepEqual(calls.find(([name]) => name === 'launch'), ['launch', 'external-app']);

  await manager.closeTab(tabId);
  assert.ok(calls.some((call) => call[0] === 'stop' && call[2] === 'external-app'));
});
