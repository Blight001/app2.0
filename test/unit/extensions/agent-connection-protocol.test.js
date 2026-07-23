'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.resolve(
  __dirname,
  '../../../src/assets/extensions/browser_automation/background/09_agent_connection.js',
);

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function createSocketContext(fetchImpl) {
  const timers = [];
  const context = vm.createContext({
    AbortSignal,
    Map,
    crypto: { randomUUID: () => 'session-1' },
    fetch: fetchImpl,
    setTimeout: (handler) => {
      timers.push(handler);
      return timers.length;
    },
    clearTimeout() {},
    trimUrl: (value) => String(value).replace(/\/$/, ''),
    getAgentBrowserProcessId: async () => 4567,
    agentBrowserProcessId: 4567,
    APP_BROWSER_PID_HEADER: 'X-AI-Free-Browser-Pid',
    AGENT_BRIDGE_PROTOCOL_VERSION: 1,
    DEVICE_ENROLLED: 'device:registered',
  });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  vm.runInContext('globalThis.AgentSocketForTest = LocalAutomationBridgeSocket', context);
  return { Socket: context.AgentSocketForTest, timers };
}

test('插件只在软件返回受认证会话后进入 connected', async () => {
  let releaseRegistration;
  const registrationPending = new Promise((resolve) => {
    releaseRegistration = resolve;
  });
  const requests = [];
  const { Socket } = createSocketContext(async (url, options) => {
    requests.push({ url, options });
    return registrationPending;
  });
  const socket = new Socket('http://127.0.0.1:18765/');
  const events = [];
  socket.on('connect', () => events.push('connect'));
  socket.on('device:registered', () => events.push('registered'));

  const connecting = socket.connect({ id: 'browser-1', browserProcessId: 4567 });
  await Promise.resolve();
  assert.equal(socket.connected, false);
  assert.equal(socket.active, true);

  releaseRegistration(response(200, {
    ok: true,
    protocolVersion: 1,
    connectionId: 'connection-1',
    token: 'secret',
    pollIntervalMs: 650,
  }));
  await connecting;

  assert.equal(socket.connected, true);
  assert.equal(socket.connectionId, 'connection-1');
  assert.deepEqual(events, ['connect', 'registered']);
  assert.match(requests[0].url, /\/v1\/register$/);
});

test('统一 poll 遇到 401 时清理会话并只触发一次重连信号', async () => {
  const requests = [];
  const replies = [
    response(200, {
      ok: true,
      protocolVersion: 1,
      connectionId: 'connection-1',
      token: 'secret',
    }),
    response(401, { ok: false, message: '会话失效' }),
  ];
  const { Socket } = createSocketContext(async (url, options) => {
    requests.push({ url, options });
    return replies.shift();
  });
  const socket = new Socket('http://127.0.0.1:18765');
  const disconnects = [];
  socket.on('disconnect', (reason) => disconnects.push(reason));
  await socket.connect({ id: 'browser-1', browserProcessId: 4567 });

  await socket.poll();

  assert.equal(socket.connected, false);
  assert.equal(socket.connectionId, '');
  assert.equal(disconnects.length, 1);
  assert.match(disconnects[0], /重新注册/);
  assert.match(requests[1].url, /\/v1\/poll\?connection_id=connection-1$/);
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.headers['X-Bridge-Token'], 'secret');
});

test('旧软件没有统一 poll 时只回退到兼容任务接口', async () => {
  const requests = [];
  const replies = [
    response(200, {
      ok: true,
      connectionId: 'connection-1',
      token: 'secret',
    }),
    response(404, { ok: false, message: '接口不存在' }),
    response(200, { ok: true, tasks: [{ taskId: 'task-1' }] }),
  ];
  const { Socket } = createSocketContext(async (url, options) => {
    requests.push({ url, options });
    return replies.shift();
  });
  const socket = new Socket('http://127.0.0.1:18765');
  const tasks = [];
  socket.on('task:dispatch', (task) => tasks.push(task.taskId));
  await socket.connect({ id: 'browser-1' });

  await socket.poll();

  assert.equal(socket.connected, true);
  assert.deepEqual(tasks, ['task-1']);
  assert.match(requests[1].url, /\/v1\/poll/);
  assert.match(requests[2].url, /\/v1\/tasks/);
});
