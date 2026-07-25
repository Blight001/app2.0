'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createWorkspaceShell,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-shell.js'));

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = { isDestroyed: () => this.destroyed === true };
    this.destroyed = false;
    this.visible = false;
    FakeBrowserWindow.instances.push(this);
  }

  loadFile() { return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return false; }
  show() { this.visible = true; }
  focus() {}
  close() { this.destroyed = true; this.emit('closed'); }
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
    on() {},
    removeListener() {},
  };
}

test.beforeEach(() => {
  FakeBrowserWindow.instances = [];
});

test('启动只创建 Home，Home sender 可独立打开两个工作窗口', async () => {
  const ipcMain = fakeIpcMain();
  let mainWindow = null;
  const shell = createWorkspaceShell({
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    path,
    setMainWindow: (window) => { mainWindow = window; },
  });

  shell.bootstrap();
  const home = shell.controllers.home.getWindow();
  assert.equal(FakeBrowserWindow.instances.length, 1);
  assert.equal(mainWindow, home);

  const openBrowser = ipcMain.handlers.get('workspace-open-browser');
  const openSoftware = ipcMain.handlers.get('workspace-open-software');
  assert.equal((await openBrowser({ sender: home.webContents })).ok, true);
  assert.equal((await openSoftware({ sender: home.webContents })).ok, true);
  assert.equal(FakeBrowserWindow.instances.length, 3);
  assert.ok(shell.controllers.browser.getWindow());
  assert.ok(shell.controllers.software.getWindow());

  await shell.dispose();
  assert.equal(mainWindow, null);
});

test('非 Home sender 调用打开入口在主进程被拒绝且没有副作用', async () => {
  const ipcMain = fakeIpcMain();
  const shell = createWorkspaceShell({ BrowserWindow: FakeBrowserWindow, ipcMain, path });
  shell.bootstrap();
  const home = shell.controllers.home.getWindow();
  await ipcMain.handlers.get('workspace-open-software')({ sender: home.webContents });
  const software = shell.controllers.software.getWindow();
  const countBefore = FakeBrowserWindow.instances.length;

  const result = await ipcMain.handlers.get('workspace-open-browser')({
    sender: software.webContents,
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'WORKSPACE_ACCESS_DENIED',
      message: 'software 工作域无权调用此 IPC',
      retryable: false,
    },
  });
  assert.equal(FakeBrowserWindow.instances.length, countBefore);
  assert.equal(shell.controllers.browser.getWindow(), null);
  await shell.dispose();
});

test('同一入口重复调用只聚焦现有窗口，关闭后可重开', async () => {
  const ipcMain = fakeIpcMain();
  const shell = createWorkspaceShell({ BrowserWindow: FakeBrowserWindow, ipcMain, path });
  shell.bootstrap();
  const home = shell.controllers.home.getWindow();
  const openBrowser = ipcMain.handlers.get('workspace-open-browser');
  await openBrowser({ sender: home.webContents });
  const first = shell.controllers.browser.getWindow();
  await openBrowser({ sender: home.webContents });
  assert.equal(FakeBrowserWindow.instances.length, 2);

  first.close();
  await new Promise((resolve) => setImmediate(resolve));
  await openBrowser({ sender: home.webContents });
  assert.equal(FakeBrowserWindow.instances.length, 3);
  assert.notEqual(shell.controllers.browser.getWindow(), first);
  await shell.dispose();
});
