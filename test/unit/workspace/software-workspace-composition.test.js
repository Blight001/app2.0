'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createSoftwareWorkspaceComposition,
} = require(path.join(
  projectRoot,
  'src/app/main/composition/build-software-workspace.js',
));

function fakeWindow() {
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMaximized = () => false;
  window.getContentSize = () => [1200, 800];
  window.getNormalBounds = () => ({ width: 1200 });
  window.webContents = {
    isDestroyed: () => false,
    send() {},
    focus() {},
  };
  return window;
}

test('打开和关闭软件只改变 Software 状态，最后一项关闭不创建 Chromium', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-software-workspace-'));
  const browserTabs = new Map([['browser-1', { id: 'browser-1' }]]);
  const launches = [];
  const stops = [];
  try {
    const runtime = {
      launchProfile: async (profile, bounds, options) => {
        launches.push({ profile, bounds, options });
        return { status: 'ready' };
      },
      show: async () => {},
      hide: async () => {},
      focus: async () => {},
      stop: async (id, type) => stops.push([id, type]),
      externalApp: { listAutomationTargets: () => [] },
    };
    const workspace = createSoftwareWorkspaceComposition({
      browserRuntimeManager: runtime,
      softwareCatalog: {
        getLaunchDefinition: () => ({
          id: 'notepad',
          name: '记事本',
          executablePath: 'notepad.exe',
          args: [],
        }),
        listAvailable: async () => [],
      },
      automationCardCacheDir: directory,
      aiHistoryDirectory: path.join(directory, 'history'),
      logger: { warn() {} },
    });
    const softwareWindow = fakeWindow();
    workspace.state.setWindow(softwareWindow);

    const tabId = await workspace.openExternalApp('notepad');
    assert.equal(workspace.state.tabs.has(tabId), true);
    assert.deepEqual([...browserTabs.keys()], ['browser-1']);
    assert.equal(launches[0].profile.runtimeType, 'external-app');
    assert.equal(
      launches[0].options.parentWindow,
      softwareWindow,
      'Software 必须把自身窗口作为原生停靠 parent',
    );

    await workspace.tabManager.closeTab(tabId);
    assert.equal(workspace.state.tabs.size, 0);
    assert.equal(workspace.state.getActiveTabId(), null);
    assert.deepEqual(stops, [[tabId, 'external-app']]);
    assert.equal(launches.length, 1, '关闭最后一个软件栏目不得创建 Chromium');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
