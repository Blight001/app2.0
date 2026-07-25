'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createWorkspaceRegistry,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-registry.js'));

function fakeWindow(id) {
  const window = new EventEmitter();
  window.webContents = { id, isDestroyed: () => false };
  window.closeCalls = 0;
  window.close = () => {
    window.closeCalls += 1;
    window.emit('closed');
  };
  window.isDestroyed = () => false;
  return window;
}

test('三个工作域独立注册并按 window/side view 识别 sender', () => {
  const registry = createWorkspaceRegistry();
  const home = fakeWindow('home');
  const browser = fakeWindow('browser');
  const browserSide = { webContents: { id: 'browser-side', isDestroyed: () => false } };
  const software = fakeWindow('software');

  registry.register('home', { window: home });
  registry.register('browser', { window: browser, sideView: browserSide });
  registry.register('software', { window: software });

  assert.equal(registry.identifySender(home.webContents), 'home');
  assert.equal(registry.identifySender({ sender: browserSide.webContents }), 'browser');
  assert.equal(registry.identifySender(software.webContents), 'software');
  assert.deepEqual(registry.list().map(({ type }) => type), ['home', 'browser', 'software']);
});

test('关闭一个工作域只执行本域 dispose，其他工作域保持注册', async () => {
  const disposed = [];
  const registry = createWorkspaceRegistry();
  const browser = fakeWindow('browser');
  const software = fakeWindow('software');
  registry.register('browser', { window: browser, dispose: () => disposed.push('browser') });
  registry.register('software', { window: software, dispose: () => disposed.push('software') });

  browser.emit('closed');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(disposed, ['browser']);
  assert.equal(registry.get('browser'), null);
  assert.equal(registry.get('software')?.window, software);
});

test('显式 dispose 幂等并可选择关闭窗口', async () => {
  let disposeCalls = 0;
  const registry = createWorkspaceRegistry();
  const home = fakeWindow('home');
  registry.register('home', { window: home, dispose: () => { disposeCalls += 1; } });

  assert.equal(await registry.disposeWorkspace('home', { closeWindow: true }), true);
  assert.equal(await registry.disposeWorkspace('home', { closeWindow: true }), false);
  assert.equal(disposeCalls, 1);
  assert.equal(home.closeCalls, 1);
});

test('拒绝未知、缺少窗口和重复工作域，已销毁 sender 不再获得身份', () => {
  const registry = createWorkspaceRegistry();
  const home = fakeWindow('home');
  registry.register('home', { window: home });

  assert.throws(() => registry.register('unknown', { window: fakeWindow('x') }), /未知工作域/);
  assert.throws(() => registry.register('browser'), /缺少 window/);
  assert.throws(() => registry.register('home', { window: fakeWindow('other') }), /已注册/);

  home.webContents.isDestroyed = () => true;
  assert.equal(registry.identifySender(home.webContents), null);
});

test('disposeAll 释放当前全部工作域且不互相重复清理', async () => {
  const disposed = [];
  const registry = createWorkspaceRegistry();
  registry.register('home', { window: fakeWindow('home'), dispose: () => disposed.push('home') });
  registry.register('browser', { window: fakeWindow('browser'), dispose: () => disposed.push('browser') });
  registry.register('software', { window: fakeWindow('software'), dispose: () => disposed.push('software') });

  await registry.disposeAll();

  assert.deepEqual(disposed.sort(), ['browser', 'home', 'software']);
  assert.deepEqual(registry.list(), []);
});
