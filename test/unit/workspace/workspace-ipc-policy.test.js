'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  createWorkspaceRegistry,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-registry.js'));
const {
  createWorkspaceAccessGuard,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-access.js'));
const {
  createWorkspaceIpcAuthorizer,
} = require(path.join(projectRoot, 'src/app/main/workspace/workspace-ipc-policy.js'));

function windowFor(id) {
  return {
    webContents: { id, isDestroyed: () => false },
    once() {},
  };
}

function fixture() {
  const registry = createWorkspaceRegistry();
  const windows = {
    home: windowFor('home'),
    browser: windowFor('browser'),
    software: windowFor('software'),
  };
  for (const [type, window] of Object.entries(windows)) registry.register(type, { window });
  const access = createWorkspaceAccessGuard(registry);
  return { windows, authorize: createWorkspaceIpcAuthorizer(access) };
}

test('公共、浏览器和软件 domain 只允许对应 sender', () => {
  const { windows, authorize } = fixture();
  assert.equal(authorize(
    'account-get-session', { sender: windows.home.webContents }, 'invoke',
  ).ok, true);
  assert.equal(authorize(
    'get-browser-history', { sender: windows.browser.webContents }, 'invoke',
  ).ok, true);
  assert.equal(authorize(
    'list-available-software', { sender: windows.software.webContents }, 'invoke',
  ).ok, true);

  const denied = authorize(
    'get-browser-history', { sender: windows.software.webContents }, 'invoke',
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'WORKSPACE_ACCESS_DENIED');
});

test('混合 AI/automation 通道按 sender 归属授权并拒绝伪造 workspaceType', () => {
  const { windows, authorize } = fixture();
  const inferred = authorize(
    'ai-control-chat', { sender: windows.browser.webContents }, 'invoke', [{}],
  );
  assert.equal(inferred.ok, true);
  assert.equal(authorize(
    'ai-control-chat',
    { sender: windows.browser.webContents },
    'invoke',
    [{ workspaceType: 'browser' }],
  ).ok, true);
  assert.equal(authorize(
    'automation-card-run',
    { sender: windows.software.webContents },
    'invoke',
    [{ workspaceType: 'browser' }],
  ).ok, false);
});

test('renderer event 同样按 channel domain 校验', () => {
  const { windows, authorize } = fixture();
  assert.equal(authorize(
    'switch-tab', { sender: windows.browser.webContents }, 'event',
  ).ok, true);
  assert.equal(authorize(
    'switch-tab', { sender: windows.home.webContents }, 'event',
  ).ok, false);
});
