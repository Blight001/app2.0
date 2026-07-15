const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createTabManager } = require('../src/app/main/services/tab-manager');

test('新建浏览器窗口默认打开 Chromium 新建标签页', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/app/main/ipc/register/settings.js'),
    'utf8',
  );

  assert.match(source, /const DEFAULT_BROWSER_WINDOW_URL = 'chrome:\/\/newtab\/';/);
  assert.doesNotMatch(source, /const DEFAULT_BROWSER_WINDOW_URL = 'about:blank';/);
  assert.doesNotMatch(source, /const DEFAULT_BROWSER_WINDOW_URL = 'https:\/\/www\.baidu\.com\/'/);
});

test('Chromium 新建标签页不经过 data URL 启动占位页', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map();
  let launchedProfile = null;
  const browserRuntimeManager = {
    chromium,
    async launchProfile(profile) {
      launchedProfile = profile;
      return { status: 'ready' };
    },
    async hide() {},
    async show() {},
    async focus() {},
  };
  const mainWindow = {
    isDestroyed: () => false,
    getContentSize: () => [1200, 800],
    emit() {},
  };
  let activeTabId = null;
  const manager = createTabManager({
    browserRuntimeManager,
    getTabs: () => tabs,
    getMainWindow: () => mainWindow,
    getActiveTabId: () => activeTabId,
    setActiveTabId: (tabId) => { activeTabId = tabId; },
    getIsSidebarVisible: () => true,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {} },
  });

  await manager.addTab('chrome://newtab/', {
    tabId: 'new-tab',
    showLoadingPage: true,
  });

  assert.equal(launchedProfile.initialUrl, '');
  assert.equal(tabs.get('new-tab').runtimeUrl, 'chrome://newtab/');
});

test('新建栏目在慢速环境探测完成前立即发布 starting 占位', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map();
  let finishProfileLookup;
  let launchCount = 0;
  const profileLookup = new Promise((resolve) => { finishProfileLookup = resolve; });
  let activeTabId = null;
  const manager = createTabManager({
    browserRuntimeManager: {
      chromium,
      async launchProfile() {
        launchCount += 1;
        return { status: 'ready' };
      },
      async hide() {},
      async show() {},
      async focus() {},
    },
    resolveTabBrowserProfile: () => profileLookup,
    getTabs: () => tabs,
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1200, 800], emit() {} }),
    getActiveTabId: () => activeTabId,
    setActiveTabId: (tabId) => { activeTabId = tabId; },
    getIsSidebarVisible: () => true,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });

  const creation = manager.addTab('chrome://newtab/', {
    tabId: 'async-browser',
    fixedTitle: '异步窗口',
  });

  assert.equal(tabs.get('async-browser')?.runtimeStatus, 'starting');
  assert.equal(activeTabId, 'async-browser');
  assert.equal(launchCount, 0);

  finishProfileLookup({ locale: 'zh-CN' });
  assert.equal(await creation, 'async-browser');
  assert.equal(launchCount, 1);
  assert.equal(tabs.get('async-browser')?.runtimeStatus, 'ready');
});

test('异步创建失败时移除占位并恢复之前的栏目', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map([['existing-browser', {
    id: 'existing-browser', runtimeType: 'chromium', runtimeStatus: 'ready',
  }]]);
  let activeTabId = 'existing-browser';
  const manager = createTabManager({
    browserRuntimeManager: {
      chromium,
      async launchProfile() { throw new Error('launch failed'); },
      async hide() {},
      async show() {},
      async focus() {},
    },
    getTabs: () => tabs,
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1200, 800], emit() {} }),
    getActiveTabId: () => activeTabId,
    setActiveTabId: (tabId) => { activeTabId = tabId; },
    getIsSidebarVisible: () => false,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });

  await assert.rejects(
    manager.addTab('chrome://newtab/', { tabId: 'failed-browser' }),
    /launch failed/,
  );

  assert.deepEqual([...tabs.keys()], ['existing-browser']);
  assert.equal(activeTabId, 'existing-browser');
});

test('加载中关闭栏目会取消后续启动', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map([['existing-browser', {
    id: 'existing-browser', runtimeType: 'chromium', runtimeStatus: 'ready',
  }]]);
  let activeTabId = 'existing-browser';
  let finishProfileLookup;
  let launchCount = 0;
  const profileLookup = new Promise((resolve) => { finishProfileLookup = resolve; });
  const manager = createTabManager({
    browserRuntimeManager: {
      chromium,
      async launchProfile() { launchCount += 1; return { status: 'ready' }; },
      async stop() {},
      async hide() {},
      async show() {},
      async focus() {},
    },
    resolveTabBrowserProfile: () => profileLookup,
    getTabs: () => tabs,
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1200, 800], emit() {} }),
    getActiveTabId: () => activeTabId,
    setActiveTabId: (tabId) => { activeTabId = tabId; },
    getIsSidebarVisible: () => false,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });

  const creation = manager.addTab('chrome://newtab/', { tabId: 'cancelled-browser' });
  await manager.closeTab('cancelled-browser');
  finishProfileLookup({ locale: 'zh-CN' });

  await assert.rejects(creation, /创建过程中关闭/);
  assert.equal(launchCount, 0);
  assert.deepEqual([...tabs.keys()], ['existing-browser']);
  assert.equal(activeTabId, 'existing-browser');
});

test('普通空白栏目不会把服务器教程地址当作默认主页', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map();
  let launchedProfile = null;
  const manager = createTabManager({
    browserRuntimeManager: {
      chromium,
      async launchProfile(profile) {
        launchedProfile = profile;
        return { status: 'ready' };
      },
      async hide() {},
      async show() {},
      async focus() {},
    },
    licenseCache: {
      getRuntimeConfig: () => ({ tutorialUrl: 'https://server.example.com/tutorial' }),
    },
    getTabs: () => tabs,
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1200, 800], emit() {} }),
    getActiveTabId: () => null,
    setActiveTabId() {},
    getIsSidebarVisible: () => false,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });

  await manager.addTab('', { tabId: 'ordinary-browser' });

  assert.equal(launchedProfile.initialUrl, '');
  assert.equal(tabs.get('ordinary-browser')?.runtimeUrl, 'chrome://newtab/');
  assert.equal(tabs.get('ordinary-browser')?.isTutorialTab, false);
});

test('关闭最后一个栏目后重建普通新标签页而不是教程栏目', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map([['old-browser', {
    id: 'old-browser',
    runtimeType: 'chromium',
    runtimeStatus: 'ready',
  }]]);
  let activeTabId = 'old-browser';
  const manager = createTabManager({
    browserRuntimeManager: {
      chromium,
      async stop() {},
      async launchProfile() { return { status: 'ready' }; },
      async hide() {},
      async show() {},
      async focus() {},
    },
    getTabs: () => tabs,
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1200, 800], emit() {} }),
    getActiveTabId: () => activeTabId,
    setActiveTabId: (tabId) => { activeTabId = tabId; },
    getIsSidebarVisible: () => false,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });

  await manager.closeTab('old-browser');

  assert.deepEqual([...tabs.keys()], ['1']);
  assert.equal(tabs.get('1')?.requestedUrl, 'chrome://newtab/');
  assert.equal(tabs.get('1')?.isTutorialTab, false);
});

test('新建按钮等待后台完成事件且主进程合并重复创建请求', () => {
  const settingsSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/ipc/register/settings.js'),
    'utf8',
  );
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '../src/app/renderer/controllers/pages/app-shell/tabs.js'),
    'utf8',
  );

  assert.match(settingsSource, /if \(independentBrowserCreation\)/);
  assert.match(settingsSource, /deduplicated: true/);
  assert.match(settingsSource, /independent-browser-create-complete/);
  assert.match(rendererSource, /independentBrowserCreationPending/);
  assert.match(rendererSource, /IPC\.on\('independent-browser-create-complete'/);
});

test('Chromium 意外关闭时同步关闭对应栏目', async () => {
  const chromium = new EventEmitter();
  const tabs = new Map([
    ['browser-1', { id: 'browser-1', runtimeType: 'chromium' }],
    ['browser-2', { id: 'browser-2', runtimeType: 'chromium' }],
  ]);
  const stopped = [];
  const browserRuntimeManager = {
    chromium,
    async stop(profileId) {
      stopped.push(profileId);
    },
  };
  const mainWindow = {
    isDestroyed: () => false,
    emit() {},
  };

  createTabManager({
    browserRuntimeManager,
    getTabs: () => tabs,
    getMainWindow: () => mainWindow,
    getActiveTabId: () => 'browser-2',
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {} },
  });

  chromium.emit('crashed', { profileId: 'browser-1', lastError: { message: '已退出' } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(stopped, ['browser-1']);
  assert.equal(tabs.has('browser-1'), false);
  assert.equal(tabs.has('browser-2'), true);
});

test('软件整体退出时不由崩溃回调重复关闭栏目', async () => {
  const previousShutdownState = global._isShuttingDown;
  global._isShuttingDown = true;
  try {
    const chromium = new EventEmitter();
    const tabs = new Map([['browser-1', { id: 'browser-1', runtimeType: 'chromium' }]]);
    let stopped = false;

    createTabManager({
      browserRuntimeManager: {
        chromium,
        async stop() { stopped = true; },
      },
      getTabs: () => tabs,
      getMainWindow: () => ({ isDestroyed: () => false, emit() {} }),
      getActiveTabId: () => 'browser-1',
      updateTabs() {},
      logger: { warn() {} },
    });

    chromium.emit('crashed', { profileId: 'browser-1' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(stopped, false);
    assert.equal(tabs.has('browser-1'), true);
  } finally {
    global._isShuttingDown = previousShutdownState;
  }
});
