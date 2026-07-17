const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { toggleSidebarVisibility } = require('../src/app/main/services/tab-common');

test('reopening the sidebar restores its input target after layout', async () => {
  let sidebarVisible = false;
  let resizeCalls = 0;
  let ownerFocusCalls = 0;
  let shellFocusCalls = 0;
  let sidebarFocusCalls = 0;
  const mainWindow = {
    isDestroyed: () => false,
    isFocused: () => true,
    focus: () => { ownerFocusCalls += 1; },
    emit: (event) => { if (event === 'resize') resizeCalls += 1; },
    webContents: {
      isDestroyed: () => false,
      send() {},
      focus: () => { shellFocusCalls += 1; },
    },
  };
  const sideView = {
    webContents: {
      isDestroyed: () => false,
      send() {},
      focus: () => { sidebarFocusCalls += 1; },
    },
  };

  const result = toggleSidebarVisibility({
    getIsSidebarVisible: () => sidebarVisible,
    setIsSidebarVisible: (visible) => { sidebarVisible = visible; },
    getMainWindow: () => mainWindow,
    getSideView: () => sideView,
  });

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(resizeCalls, 1);
  assert.ok(ownerFocusCalls >= 1);
  assert.ok(shellFocusCalls >= 1);
  assert.ok(sidebarFocusCalls >= 2);
});

test('sidebar layout uses visibility instead of a zero-width WebContentsView', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/services/app-shell.js',
  ), 'utf8');

  assert.match(source, /currentSideView\.setVisible\(isSidebarVisible\)/);
  assert.match(source, /visibleSideViewWidth = Math\.max\(1,/);
  assert.doesNotMatch(source, /setBounds\(\{ x: mainViewWidth, y: tabBarHeight, width: sideViewWidth/);
});

test('sidebar repairs native wheel focus when pointer input returns', () => {
  const announcements = fs.readFileSync(path.join(
    __dirname,
    '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/announcements.js',
  ), 'utf8');
  const bindings = fs.readFileSync(path.join(
    __dirname,
    '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/init-bindings.js',
  ), 'utf8');
  const uiIpc = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/ipc/register/ui.js',
  ), 'utf8');
  const tabManager = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/services/tab-manager.js',
  ), 'utf8');
  const chromiumBridgePatch = fs.readFileSync(path.join(
    __dirname,
    '../native/chromium-fork/patches/0003-ai-free-runtime-pipe.patch',
  ), 'utf8');

  assert.match(announcements, /document\.addEventListener\('pointermove'/);
  assert.match(announcements, /document\.addEventListener\('pointerenter'/);
  assert.match(announcements, /document\.addEventListener\('pointerdown',[\s\S]*requestSidebarInputFocus\(true\)/);
  assert.match(announcements, /document\.addEventListener\('focusin'/);
  assert.match(announcements, /invoke\('focus-sidebar-input'\)/);
  assert.match(bindings, /initSidebarInputRouting\(\)/);
  assert.match(uiIpc, /mainWindow\.webContents\.focus\(\)[\s\S]*sideWc\.focus\(\)/);
  assert.doesNotMatch(uiIpc, /if \(!sideWc\.isFocused/);
  assert.match(tabManager, /mainWindow\.webContents\.focus\?\.\(\)[\s\S]*webContents\.focus\(\)/);
  assert.doesNotMatch(chromiumBridgePatch, /^\+\s*web_contents\(\)->Focus\(\);/m);
});
