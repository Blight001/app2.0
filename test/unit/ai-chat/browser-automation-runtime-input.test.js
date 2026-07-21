'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  APP_BROWSER_PID_HEADER,
  APP_BROWSER_TOKEN_HEADER,
  createBrowserAutomationBridge,
} = require('../../../src/app/main/services/browser-automation-bridge');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function postJson(port, token, pid, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path: '/v1/runtime-input', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        [APP_BROWSER_TOKEN_HEADER]: token,
        [APP_BROWSER_PID_HEADER]: String(pid),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

test('trusted runtime-input route dispatches only for a managed Chromium process', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-runtime-input-'));
  const port = await reservePort();
  const calls = [];
  const bridge = createBrowserAutomationBridge({
    port,
    appBrowserToken: 'trusted-app-browser-token',
    cardCacheDir: root,
    externalMcpDescriptorPath: path.join(root, 'mcp.json'),
    isAllowedBrowserProcess: (pid) => pid === 4321,
    dispatchRuntimeInput: async (pid, input) => {
      calls.push({ pid, input });
      return { ok: true, result: { dispatched: true } };
    },
    logger: { log() {}, warn() {} },
  });

  try {
    await bridge.start();
    const accepted = await postJson(port, 'trusted-app-browser-token', 4321, {
      input: {
        inputType: 'mouse', action: 'click', x: 40, y: 50,
        viewportWidth: 800, viewportHeight: 600,
      },
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.data.ok, true);
    assert.equal(accepted.data.result.dispatched, true);
    assert.deepEqual(calls, [{
      pid: 4321,
      input: {
        inputType: 'mouse', action: 'click', x: 40, y: 50,
        viewportWidth: 800, viewportHeight: 600,
      },
    }]);

    const rejected = await postJson(port, 'trusted-app-browser-token', 9999, {
      input: {
        inputType: 'mouse', action: 'click', x: 40, y: 50,
        viewportWidth: 800, viewportHeight: 600,
      },
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(calls.length, 1);
  } finally {
    await bridge.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
