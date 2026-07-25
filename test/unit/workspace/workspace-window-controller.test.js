'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createWorkspaceRegistry,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-registry.js'));
const {
  createWorkspaceWindowController,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-window-controller.js'));

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = { isDestroyed: () => false };
    this.destroyed = false;
    this.minimized = false;
    this.showCalls = 0;
    this.focusCalls = 0;
    this.restoreCalls = 0;
    this.loadedFile = '';
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  show() { this.showCalls += 1; }
  focus() { this.focusCalls += 1; }
  restore() { this.restoreCalls += 1; this.minimized = false; }
  loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
  close() { this.destroyed = true; this.emit('closed'); }
}

test.beforeEach(() => {
  FakeBrowserWindow.instances = [];
});

test('open 创建一次工作窗口并在后续调用中只恢复和聚焦', () => {
  const registry = createWorkspaceRegistry();
  const controller = createWorkspaceWindowController({
    type: 'browser',
    BrowserWindow: FakeBrowserWindow,
    registry,
    htmlPath: 'browser.html',
    preloadPath: 'browser-preload.js',
    title: 'Browser',
  });

  const first = controller.open();
  first.emit('ready-to-show');
  first.minimized = true;
  const second = controller.open();

  assert.equal(first, second);
  assert.equal(FakeBrowserWindow.instances.length, 1);
  assert.equal(first.loadedFile, 'browser.html');
  assert.equal(first.options.webPreferences.preload, 'browser-preload.js');
  assert.equal(first.restoreCalls, 1);
  assert.equal(first.showCalls, 2);
  assert.equal(first.focusCalls, 2);
});

test('关闭后释放注册，重新打开创建全新窗口', async () => {
  let disposed = 0;
  const registry = createWorkspaceRegistry();
  const controller = createWorkspaceWindowController({
    type: 'software',
    BrowserWindow: FakeBrowserWindow,
    registry,
    htmlPath: 'software.html',
    preloadPath: 'software-preload.js',
    onWindowDisposed: () => { disposed += 1; },
  });

  const first = controller.open();
  first.close();
  await new Promise((resolve) => setImmediate(resolve));
  const second = controller.open();

  assert.notEqual(first, second);
  assert.equal(disposed, 1);
  assert.equal(FakeBrowserWindow.instances.length, 2);
});
