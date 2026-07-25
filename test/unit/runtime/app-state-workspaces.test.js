'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createAppState,
} = require(path.join(projectRoot, 'src/app/main/runtime/app-state.js'));

test('Home 与 Browser 窗口句柄互不覆盖', () => {
  const runtime = createAppState();
  const home = { id: 'home' };
  const browser = { id: 'browser' };

  runtime.setMainWindow(home);
  runtime.setBrowserWindow(browser);

  assert.equal(runtime.getMainWindow(), home);
  assert.equal(runtime.getBrowserWindow(), browser);
  runtime.setBrowserWindow(null);
  assert.equal(runtime.getMainWindow(), home);
});
