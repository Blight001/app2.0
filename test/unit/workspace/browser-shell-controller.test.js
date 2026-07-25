'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createBrowserShellController,
} = require(path.join(
  projectRoot,
  'src/app/main/workspace/browser-shell-controller.js',
));
const {
  createWorkspaceRegistry,
} = require(path.join(
  projectRoot,
  'src/app/main/workspace/workspace-registry.js',
));

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.webContents = { isDestroyed: () => false };
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return false; }
  show() {}
  focus() {}
  close() {
    this.destroyed = true;
    this.emit('closed');
  }
}

test('Browser 壳注册主页面和侧栏 sender，并复用现有窗口', async () => {
  const registry = createWorkspaceRegistry();
  const sideView = { webContents: { isDestroyed: () => false } };
  let browserWindow = null;
  let createCount = 0;
  const controller = createBrowserShellController({
    registry,
    createWindow: () => {
      createCount += 1;
      browserWindow = new FakeWindow();
      return browserWindow;
    },
    getWindow: () => browserWindow,
    getSideView: () => sideView,
    clearWindow: () => { browserWindow = null; },
  });

  const first = controller.open();
  assert.equal(controller.open(), first);
  assert.equal(createCount, 1);
  assert.equal(registry.identifySender(first.webContents), 'browser');
  assert.equal(registry.identifySender(sideView.webContents), 'browser');

  first.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getWindow(), null);
  controller.open();
  assert.equal(createCount, 2);
  await controller.dispose();
});

test('Browser 窗口关闭时等待本域 AI/自动化 disposer', async () => {
  const registry = createWorkspaceRegistry();
  let browserWindow = null;
  let disposed = false;
  const controller = createBrowserShellController({
    registry,
    createWindow: () => {
      browserWindow = new FakeWindow();
      return browserWindow;
    },
    getWindow: () => browserWindow,
    clearWindow: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      disposed = true;
      browserWindow = null;
    },
  });

  const window = controller.open();
  window.close();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, true);
  assert.equal(controller.getWindow(), null);
});
