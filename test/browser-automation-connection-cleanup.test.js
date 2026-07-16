'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('目标浏览器连接会主动断开、替换旧会话并快速刷新列表', () => {
  const root = path.join(__dirname, '..');
  const bridge = fs.readFileSync(
    path.join(root, 'src/app/main/services/browser-automation-bridge.js'),
    'utf8',
  );
  const socket = fs.readFileSync(
    path.join(root, 'src/assets/extensions/browser_automation/background/09_agent_socket.js'),
    'utf8',
  );
  const ui = fs.readFileSync(
    path.join(root, 'src/app/sidebar/client/app/side/controllers/pages/ai-control.js'),
    'utf8',
  );

  assert.match(bridge, /CONNECTION_TTL_MS = 3000/);
  assert.match(bridge, /existing\.instanceId === instanceId/);
  assert.match(bridge, /url\.pathname === '\/v1\/disconnect'/);
  assert.match(bridge, /pending\.reject\(createBrowserToolError\(reason/);
  assert.match(bridge, /errorCode: 'BROWSER_CONNECTION_CLOSED'/);
  assert.match(socket, /keepalive: true/);
  assert.match(socket, /chrome\.runtime\.onSuspend\?\.addListener/);
  assert.match(ui, /window\.setInterval\(loadBrowserConnections, 750\)/);
  assert.match(ui, /browserConnectionsLoading/);
});
