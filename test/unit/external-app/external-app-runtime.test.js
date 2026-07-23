'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { ExternalAppRuntime } = require('../../../src/app/main/browser-runtime/external-app-runtime');

function createBridge(calls) {
  return {
    findMainWindowByExecutablePath: () => null,
    findMainWindowByProcessId: () => '200',
    getWindowProcessId: () => 321,
    dockExternalWindow: (options) => { calls.push(['dock', options]); return true; },
    isExternalWindowDocked: () => true,
    hideDockedExternalWindow: (hwnd) => calls.push(['hide-docked', hwnd]),
    restoreExternalWindow: (hwnd) => calls.push(['restore', hwnd]),
    focusChildWindow: () => true,
    releaseChildWindowFocus: () => true,
    isWindowAlive: () => true,
  };
}

function createParentWindow() {
  const parent = new EventEmitter();
  parent.isDestroyed = () => false;
  parent.isVisible = () => true;
  parent.isMinimized = () => false;
  parent.getNativeWindowHandle = () => Buffer.from([1]);
  return parent;
}

test('外部软件运行时停靠窗口并在关闭栏目时恢复原始状态', async () => {
  const calls = [];
  const runtime = new ExternalAppRuntime({
    windowBridge: createBridge(calls),
    spawn: () => ({ pid: 321 }),
    getParentWindow: createParentWindow,
  });

  const state = await runtime.launchProfile({
    profileId: 'software-notepad',
    runtimeType: 'external-app',
    executablePath: 'C:/Windows/notepad.exe',
    displayName: '记事本',
  }, { x: 0, y: 41, width: 800, height: 600 });

  assert.equal(state.status, 'ready');
  assert.equal(state.runtimeType, 'external-app');
  assert.equal(state.pid, 321);
  const dock = calls.find(([name]) => name === 'dock');
  assert.deepEqual(dock[1], {
    parentHwnd: Buffer.from([1]),
    childHwnd: '200',
    childPid: 321,
    x: 0,
    y: 41,
    width: 800,
    height: 600,
  });

  await runtime.stop('software-notepad');
  assert.ok(calls.some(([name, hwnd]) => name === 'restore' && hwnd === '200'));
  assert.ok(!calls.some(([name]) => name === 'close-window'));
  assert.equal(runtime.getState('software-notepad').status, 'stopped');
});

test('外部软件运行时直接停靠已打开窗口并跟随主窗口移动', async () => {
  const calls = [];
  let spawnCount = 0;
  const parentWindow = createParentWindow();
  const runtime = new ExternalAppRuntime({
    windowBridge: createBridge(calls),
    spawn: () => { spawnCount += 1; return { pid: 321 }; },
    getParentWindow: () => parentWindow,
  });

  const state = await runtime.launchProfile({
    profileId: 'software-running-window',
    runtimeType: 'external-app',
    existingWindowHwnd: '200',
    existingWindowPid: 321,
    displayName: '已打开的记事本',
  }, { x: 0, y: 41, width: 800, height: 600 });

  assert.equal(spawnCount, 0);
  assert.equal(state.browserHwnd, '200');
  assert.equal(state.pid, 321);
  const initialDockCount = calls.filter(([name]) => name === 'dock').length;
  parentWindow.emit('move');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.filter(([name]) => name === 'dock').length, initialDockCount + 1);

  await runtime.hide('software-running-window');
  assert.ok(calls.some(([name, hwnd]) => name === 'hide-docked' && hwnd === '200'));
  await runtime.stop('software-running-window');
  assert.ok(calls.some(([name, hwnd]) => name === 'restore' && hwnd === '200'));
});

test('外部软件运行时拒绝已被复用的窗口句柄', async () => {
  const bridge = createBridge([]);
  bridge.getWindowProcessId = () => 999;
  const runtime = new ExternalAppRuntime({
    windowBridge: bridge,
    getParentWindow: createParentWindow,
  });

  await assert.rejects(runtime.launchProfile({
    profileId: 'software-stale-window',
    existingWindowHwnd: '200',
    existingWindowPid: 321,
  }, {}), /身份已变化/);
});
