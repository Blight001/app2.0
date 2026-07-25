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

function workspaceWindow(id) {
  return {
    webContents: { id, isDestroyed: () => false },
    once() {},
  };
}

test('允许已注册且属于白名单工作域的 sender', async () => {
  const registry = createWorkspaceRegistry();
  const browser = workspaceWindow('browser');
  registry.register('browser', { window: browser });
  const guard = createWorkspaceAccessGuard(registry);
  const handler = guard.wrap('browser', async (_event, payload) => ({ ok: true, payload }));

  assert.deepEqual(guard.authorize({ sender: browser.webContents }, 'browser'), {
    ok: true,
    data: { workspaceType: 'browser' },
  });
  assert.deepEqual(await handler({ sender: browser.webContents }, { id: 1 }), {
    ok: true,
    payload: { id: 1 },
  });
});

test('越权或未注册 sender 返回稳定错误且不触发业务 handler', async () => {
  const registry = createWorkspaceRegistry();
  const home = workspaceWindow('home');
  const software = workspaceWindow('software');
  registry.register('home', { window: home });
  registry.register('software', { window: software });
  const guard = createWorkspaceAccessGuard(registry);
  let calls = 0;
  const handler = guard.wrap('software', async () => { calls += 1; });

  for (const sender of [home.webContents, { id: 'unknown', isDestroyed: () => false }]) {
    const result = await handler({ sender });
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, {
      code: 'WORKSPACE_ACCESS_DENIED',
      message: sender === home.webContents
        ? 'home 工作域无权调用此 IPC'
        : 'IPC 发送方不属于已注册工作域',
      retryable: false,
    });
  }
  assert.equal(calls, 0);
});

test('一个 handler 可显式允许多个工作域但拒绝其余工作域', () => {
  const registry = createWorkspaceRegistry();
  const home = workspaceWindow('home');
  const browser = workspaceWindow('browser');
  const software = workspaceWindow('software');
  registry.register('home', { window: home });
  registry.register('browser', { window: browser });
  registry.register('software', { window: software });
  const guard = createWorkspaceAccessGuard(registry);

  assert.equal(guard.authorize({ sender: home.webContents }, ['home', 'browser']).ok, true);
  assert.equal(guard.authorize({ sender: browser.webContents }, ['home', 'browser']).ok, true);
  assert.equal(guard.authorize({ sender: software.webContents }, ['home', 'browser']).ok, false);
});
