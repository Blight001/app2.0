'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createWindowBackgroundController,
} = require('../../../src/app/main/features/window/window-background-controller');

class FakeTray extends EventEmitter {
  constructor(iconPath) {
    super();
    this.iconPath = iconPath;
    this.destroyed = false;
  }

  setToolTip(value) { this.toolTip = value; }
  setContextMenu(value) { this.contextMenu = value; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; }
}

function createHarness(response = 0) {
  const app = new EventEmitter();
  const window = new EventEmitter();
  const state = {
    dialogCalls: 0,
    focusCalls: 0,
    hideCalls: 0,
    menuTemplate: null,
    minimized: false,
    quitCalls: 0,
    showCalls: 0,
  };
  app.quit = () => { state.quitCalls += 1; };
  window.isDestroyed = () => false;
  window.isMinimized = () => state.minimized;
  window.restore = () => { state.minimized = false; };
  window.hide = () => { state.hideCalls += 1; };
  window.show = () => { state.showCalls += 1; };
  window.focus = () => { state.focusCalls += 1; };
  const controller = createWindowBackgroundController({
    app,
    APP_DISPLAY_NAME: 'AI-FREE',
    dialog: {
      showMessageBox: async (_owner, options) => {
        state.dialogCalls += 1;
        state.dialogOptions = options;
        return { response };
      },
    },
    logger: { warn() {} },
    Menu: {
      buildFromTemplate: (template) => {
        state.menuTemplate = template;
        return { template };
      },
    },
    resolveAppIconPath: () => 'logo.ico',
    resolveMainWindow: () => window,
    Tray: FakeTray,
  });
  controller.bindWindow(window);
  return { app, controller, state, window };
}

async function emitClose(harness) {
  let prevented = false;
  harness.window.emit('close', { preventDefault: () => { prevented = true; } });
  const pending = harness.controller.closePrompt;
  if (pending) await pending;
  return prevented;
}

test('关闭主窗口选择隐藏时保留应用并隐藏到托盘', async () => {
  const harness = createHarness(0);
  assert.equal(await emitClose(harness), true);
  assert.equal(harness.state.hideCalls, 1);
  assert.equal(harness.state.quitCalls, 0);
  assert.deepEqual(harness.state.dialogOptions.buttons, ['隐藏窗口', '退出软件']);
  assert.equal(harness.controller.tray.iconPath, 'logo.ico');
});

test('关闭主窗口选择退出时进入现有应用退出流程', async () => {
  const harness = createHarness(1);
  assert.equal(await emitClose(harness), true);
  assert.equal(harness.state.hideCalls, 0);
  assert.equal(harness.state.quitCalls, 1);
});

test('托盘可以恢复窗口和退出，应用退出期间不再弹关闭提示', async () => {
  const harness = createHarness(0);
  harness.state.minimized = true;
  harness.state.menuTemplate[0].click();
  assert.equal(harness.state.minimized, false);
  assert.equal(harness.state.showCalls, 1);
  assert.equal(harness.state.focusCalls, 1);

  harness.state.menuTemplate[2].click();
  assert.equal(harness.state.quitCalls, 1);
  assert.equal(await emitClose(harness), false);
  assert.equal(harness.state.dialogCalls, 0);
});
