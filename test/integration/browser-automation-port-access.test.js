'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const {
  createBrowserAutomationBridge,
} = require('../../src/app/main/services/browser-automation-bridge');

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

test('automation bridge publishes native Chromium connections and rejects extension registration', async (t) => {
  const port = await reserveFreePort();
  const nativeConnection = {
    id: 'native:profile-a',
    profileId: 'profile-a',
    name: '工作浏览器',
    online: true,
  };
  const bridge = createBrowserAutomationBridge({
    port,
    logger: { log() {}, warn() {} },
    createNativeBrowserService: () => ({
      listConnections: () => [nativeConnection],
      getConnection: (id) => (id === nativeConnection.id
        ? { ...nativeConnection, tools: [{ name: 'browser_tab' }] }
        : null),
      dispatch: async (_id, tool) => ({ success: true, tool }),
    }),
  });
  await bridge.start();
  t.after(() => bridge.stop());

  const url = `http://127.0.0.1:${port}`;
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'ai-free-native-browser-automation',
    connections: 1,
  });
  assert.equal(bridge.listConnections()[0].id, 'native:profile-a');
  assert.deepEqual(await bridge.dispatch('native:profile-a', 'browser_tab', { action: 'list' }), {
    success: true,
    tool: 'browser_tab',
  });

  const registration = await fetch(`${url}/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'extension' }),
  });
  assert.equal(registration.status, 404);
});

test('browser automation extension asset has been removed', () => {
  const extensionPath = path.join(
    __dirname, '..', '..', 'src', 'assets', 'extensions', 'browser_automation',
  );
  assert.equal(fs.existsSync(extensionPath), false);
});
