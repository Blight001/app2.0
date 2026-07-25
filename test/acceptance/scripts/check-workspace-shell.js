'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
} = require('electron');

const {
  createWorkspaceShell,
} = require('../../../src/app/main/workspace/workspace-shell');
const {
  createSoftwareWorkspaceState,
} = require('../../../src/app/main/workspace/software-workspace-state');

ipcMain.handle('account-get-session', () => ({ ok: true, data: null }));
ipcMain.handle('ai-control-get-browser-connections', () => ({
  ok: true,
  connections: [],
  softwareTargets: [],
}));
ipcMain.handle('ai-control-get-automation-cards', () => ({
  ok: true,
  cards: [],
  selectedId: '',
}));
ipcMain.handle('ai-control-history-list', () => ({
  ok: true,
  sessions: [],
  currentId: '',
}));
ipcMain.handle('ai-control-get-models', () => ({ ok: true, models: [] }));

function waitForLoad(window) {
  if (!window.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.once('did-fail-load', (_event, code, description) => {
      reject(new Error(`页面加载失败 ${code}: ${description}`));
    });
  });
}

function waitForDestroyed(window) {
  if (window.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!window.isDestroyed()) return;
      clearInterval(timer);
      resolve(undefined);
    }, 10);
  });
}

async function inspectApi(window) {
  return window.webContents.executeJavaScript(
    '({ domains: Object.keys(window.aiFree).sort(), frozen: Object.isFrozen(window.aiFree) })',
  );
}

async function checkBrowserWorkspaceShell() {
  let browserWindow = null;
  let browserSideView = null;
  let browserPreloadError = null;
  const softwareState = createSoftwareWorkspaceState();
  const preload = path.join(
    __dirname,
    '../../../src/app/main/preload/browser-preload.js',
  );
  const appShellHtml = path.join(__dirname, '../../../src/app/views/app-shell.html');
  const sidebarHtml = path.join(__dirname, '../../../src/app/sidebar/index.html');
  const browserArguments = ['--ai-free-workspace=browser'];

  function createBrowserWindow() {
    browserWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload,
        additionalArguments: browserArguments,
      },
    });
    browserSideView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload,
        additionalArguments: browserArguments,
      },
    });
    browserWindow.contentView.addChildView(browserSideView);
    const capturePreloadError = (_event, _preloadPath, error) => {
      browserPreloadError = error;
    };
    browserWindow.webContents.on('preload-error', capturePreloadError);
    browserSideView.webContents.on('preload-error', capturePreloadError);
    browserSideView.setBounds({ x: 900, y: 52, width: 380, height: 768 });
    void browserWindow.loadFile(appShellHtml);
    void browserSideView.webContents.loadFile(sidebarHtml);
    return browserWindow;
  }

  const shell = createWorkspaceShell({
    BrowserWindow,
    ipcMain,
    path,
    createBrowserWindow,
    revealBrowserWindow: () => false,
    getBrowserWindow: () => browserWindow,
    getBrowserSideView: () => browserSideView,
    clearBrowserWindow: () => {
      browserWindow = null;
      browserSideView = null;
    },
    softwareShellDeps: {
      BrowserWindow,
      WebContentsView,
      state: softwareState,
      browserRuntimeManager: { resize: async () => {} },
      updateTabs: () => {},
      disposeDomain: async () => {},
      icon: '',
      preloadPath: path.join(
        __dirname,
        '../../../src/app/main/preload/software-preload.js',
      ),
      mainHtmlPath: appShellHtml,
      sidebarHtmlPath: sidebarHtml,
      logger: console,
    },
  });
  shell.bootstrap();
  const home = shell.controllers.home.getWindow();
  await waitForLoad(home);
  assert.equal(BrowserWindow.getAllWindows().length, 1, '冷启动只应创建 Home');
  assert.deepEqual(await inspectApi(home), {
    domains: ['account', 'home', 'license', 'ui', 'updates'],
    frozen: true,
  });
  await home.webContents.executeJavaScript('window.aiFree.home.openBrowser()');
  await Promise.all([waitForLoad(browserWindow), waitForLoad({
    webContents: browserSideView.webContents,
  })]);
  assert.equal(browserPreloadError, null, browserPreloadError?.stack);

  const domains = await inspectApi(browserWindow);
  assert.equal(domains.domains.includes('software'), false);
  assert.equal(domains.domains.includes('browser'), true);
  assert.equal(domains.domains.includes('automation'), true);
  assert.equal(domains.domains.includes('workspace'), true);
  const labels = await browserSideView.webContents.executeJavaScript(
    '[...document.querySelectorAll(".tab-button span:last-child")].map((node) => node.textContent)',
  );
  assert.deepEqual(labels, ['AI 控制', '自动化', '浏览器配置']);
  assert.equal(
    await browserSideView.webContents.executeJavaScript(
      'document.getElementById("software-settings-panel") === null',
    ),
    true,
  );
  await home.webContents.executeJavaScript('window.aiFree.home.openBrowser()');
  assert.equal(BrowserWindow.getAllWindows().length, 2, '重复打开应聚焦现有 Browser');

  await home.webContents.executeJavaScript('window.aiFree.home.openSoftware()');
  const software = shell.controllers.software.getWindow();
  await waitForLoad(software);
  await waitForLoad({ webContents: softwareState.getSideView().webContents });
  assert.deepEqual(await inspectApi(software), {
    domains: ['software', 'softwareAi', 'softwareAutomation', 'workspace'],
    frozen: true,
  });
  assert.deepEqual(
    await software.webContents.executeJavaScript(`({
      hidden: document.getElementById('browser-empty-state').hidden,
      title: document.getElementById('workspace-empty-title').textContent,
      hint: document.getElementById('workspace-empty-hint').textContent,
    })`),
    {
      hidden: false,
      title: '尚未嵌入软件',
      hint: '请从右侧“软件配置”中选择软件并点击“嵌入”',
    },
    'Software 尚无实例时应显示明确的嵌入引导，不能呈现无说明白屏',
  );
  assert.equal(
    await software.webContents.executeJavaScript(
      'document.querySelector("[data-workspace-domain=\\"browser\\"]") === null',
    ),
    true,
    'Software 主壳不得保留 Browser 专属控件',
  );
  const softwareLabels = await softwareState.getSideView().webContents.executeJavaScript(
    '[...document.querySelectorAll(".tab-button span:last-child")].map((node) => node.textContent)',
  );
  assert.deepEqual(softwareLabels, ['AI 控制', '自动化', '软件配置']);
  assert.equal(
    await softwareState.getSideView().webContents.executeJavaScript(
      'document.getElementById("ai-free-settings-panel") === null',
    ),
    true,
  );
  const softwareResources = await softwareState.getSideView().webContents.executeJavaScript(
    'performance.getEntriesByType("resource").map((entry) => entry.name)',
  );
  assert.equal(
    softwareResources.some((url) => url.includes('browser-settings')),
    false,
    'Software 侧栏不得加载 Browser 配置脚本',
  );
  const firstBrowser = browserWindow;
  firstBrowser.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(software.isDestroyed(), false, '关闭 Browser 不得销毁 Software');
  assert.equal(shell.controllers.browser.getWindow(), null);
  await home.webContents.executeJavaScript('window.aiFree.home.openBrowser()');
  await waitForLoad(browserWindow);
  assert.notEqual(browserWindow.id, firstBrowser.id, '关闭后应创建新 Browser 窗口');
  assert.equal(
    await browserWindow.webContents.executeJavaScript(
      'document.getElementById("tabs-container") !== null',
    ),
    true,
  );

  const closed = BrowserWindow.getAllWindows().map(waitForDestroyed);
  await shell.dispose();
  await Promise.all(closed);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  console.log('[workspace-shell] Browser/Software 真实标签壳与三栏目侧栏验收通过');
}

async function run() {
  await checkBrowserWorkspaceShell();
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
