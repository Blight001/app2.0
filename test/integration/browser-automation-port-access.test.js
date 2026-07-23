'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  APP_BROWSER_PID_HEADER,
  CONNECTION_TTL_MS,
  createBrowserAutomationBridge,
} = require('../../src/app/main/services/browser-automation-bridge');
const { createExtensionManager } = require('../../src/app/main/services/extension-manager');

async function reserveFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('automation bridge heartbeat grace covers the MV3 offscreen wake interval', () => {
  const offscreenWakeIntervalMs = 20_000;
  assert.ok(
    CONNECTION_TTL_MS >= offscreenWakeIntervalMs * 2,
    `heartbeat grace ${CONNECTION_TTL_MS}ms is shorter than two offscreen wake intervals`,
  );
});

test('automation bridge accepts browser extensions through the loopback port', async (t) => {
  const port = await reserveFreePort();
  const bridge = createBrowserAutomationBridge({
    port,
    isAllowedBrowserProcess: () => false,
    logger: { log() {}, warn() {} },
  });
  await bridge.start();
  t.after(() => bridge.stop());

  const url = `http://127.0.0.1:${port}`;
  const headers = {
    Origin: 'chrome-extension://external-browser-extension',
    [APP_BROWSER_PID_HEADER]: '98765',
  };
  const health = await fetch(`${url}/health`, { headers });
  assert.equal(health.status, 200);

  const registration = await fetch(`${url}/v1/register`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceId: 'external-browser',
      sessionId: 'one',
      browserProcessId: 98765,
      toolDefs: [{ name: 'browser_tab' }],
    }),
  });
  assert.equal(registration.status, 200);
  const connection = await registration.json();
  assert.ok(connection.connectionId);
  assert.ok(connection.token);

  const heartbeat = await fetch(
    `${url}/v1/heartbeat?connection_id=${encodeURIComponent(connection.connectionId)}`,
    { method: 'POST', headers: { ...headers, 'X-Bridge-Token': connection.token } },
  );
  assert.equal(heartbeat.status, 200);

  const wrongConnection = await fetch(
    `${url}/v1/heartbeat?connection_id=${encodeURIComponent(connection.connectionId)}`,
    { method: 'POST', headers: { ...headers, 'X-Bridge-Token': 'wrong-token' } },
  );
  assert.equal(wrongConnection.status, 401);
});

test('automation extension manager returns the bundled source directory directly', async (t) => {
  const root = path.join(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-direct-extension-'));
  const beforeQuitHandlers = [];
  t.after(() => {
    beforeQuitHandlers.forEach((handler) => handler());
    fs.rmSync(userData, { recursive: true, force: true });
  });

  const manager = createExtensionManager({
    app: {
      getPath: () => userData,
      getAppPath: () => root,
      once: (event, handler) => {
        if (event === 'before-quit') beforeQuitHandlers.push(handler);
      },
    },
    fs,
    path,
    logger: { log() {}, warn() {}, error() {} },
    getStorePath: () => path.join(userData, 'store.json'),
    getTranslateExtDir: () => path.join(root, 'src/assets/extensions/transform'),
  });

  await manager.initialize();
  const expectedPath = path.join(root, 'src/assets/extensions/browser_automation');
  const extensionPath = manager.getEnabledExtensionPaths()
    .find((item) => path.basename(item).toLowerCase() === 'browser_automation');
  assert.equal(path.resolve(extensionPath), path.resolve(expectedPath));
  assert.equal(fs.existsSync(path.join(userData, 'protected-extension-runtime')), false);

  const loadedPaths = [];
  await manager.loadEnabledIntoSession({
    extensions: {
      getAllExtensions: () => [],
      loadExtension: async (loadPath) => {
        loadedPaths.push(loadPath);
        return { id: `loaded-${loadedPaths.length}`, path: loadPath };
      },
    },
  }, 'source path');
  const loadedAutomationPath = loadedPaths.find(
    (item) => path.basename(item).toLowerCase() === 'browser_automation',
  );
  assert.equal(path.resolve(loadedAutomationPath), path.resolve(expectedPath));
});
