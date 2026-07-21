'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBrowserAutomationBridge,
} = require('../../src/app/main/services/browser-automation-bridge');
const { BrowserRuntimeManager } = require('../../src/app/main/browser-runtime');
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

test('automation bridge requires the app token and a managed Chromium PID', async (t) => {
  const port = await reserveFreePort();
  const appBrowserToken = 'test-app-browser-token';
  const managedPid = 43210;
  const bridge = createBrowserAutomationBridge({
    port,
    appBrowserToken,
    isAllowedBrowserProcess: (pid) => pid === managedPid,
    logger: { log() {}, warn() {} },
  });
  await bridge.start();
  t.after(() => bridge.stop());

  const url = `http://127.0.0.1:${port}`;
  const trustedHeaders = {
    Origin: 'chrome-extension://trusted-extension-id',
    'X-AI-Free-Browser-Token': appBrowserToken,
    'X-AI-Free-Browser-Pid': String(managedPid),
  };

  const missingToken = await fetch(`${url}/health`, {
    headers: { Origin: trustedHeaders.Origin, 'X-AI-Free-Browser-Pid': String(managedPid) },
  });
  assert.equal(missingToken.status, 403);

  const unmanagedProcess = await fetch(`${url}/health`, {
    headers: { ...trustedHeaders, 'X-AI-Free-Browser-Pid': '98765' },
  });
  assert.equal(unmanagedProcess.status, 403);

  const health = await fetch(`${url}/health`, { headers: trustedHeaders });
  assert.equal(health.status, 200);

  const spoofedRegistration = await fetch(`${url}/v1/register`, {
    method: 'POST',
    headers: { ...trustedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'copied-extension', sessionId: 'one', browserProcessId: 99999 }),
  });
  assert.equal(spoofedRegistration.status, 403);

  const registration = await fetch(`${url}/v1/register`, {
    method: 'POST',
    headers: { ...trustedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'managed-extension', sessionId: 'one', browserProcessId: managedPid }),
  });
  assert.equal(registration.status, 200);
  assert.ok((await registration.json()).token);
});

test('managed process checks reject exited children', () => {
  const manager = {
    chromium: {
      instances: new Map([
        ['active', { child: { pid: 111, exitCode: null } }],
        ['exited', { child: { pid: 222, exitCode: 0 } }],
      ]),
    },
  };
  assert.equal(BrowserRuntimeManager.prototype.isManagedBrowserProcess.call(manager, 111), true);
  assert.equal(BrowserRuntimeManager.prototype.isManagedBrowserProcess.call(manager, 222), false);
  assert.equal(BrowserRuntimeManager.prototype.isManagedBrowserProcess.call(manager, 333), false);
});

test('extension manager injects the rotating token into a separate runtime copy only', async (t) => {
  const root = path.join(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-protected-extension-'));
  const beforeQuitHandlers = [];
  t.after(() => {
    beforeQuitHandlers.forEach((handler) => handler());
    fs.rmSync(userData, { recursive: true, force: true });
  });

  let accessToken = 'rotating-test-token-never-write-to-source';
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
    getBrowserAutomationAccessToken: () => accessToken,
  });

  await manager.initialize();
  const runtimePath = manager.getEnabledExtensionPaths()
    .find((item) => path.basename(item).toLowerCase() === 'browser_automation');
  assert.ok(runtimePath);
  assert.ok(path.resolve(runtimePath).startsWith(path.resolve(userData)));
  assert.notEqual(
    path.dirname(runtimePath),
    path.join(userData, 'protected-extension-runtime'),
    '运行副本应放在随启动凭据轮换的会话子目录中，以避开 Chromium Worker 缓存',
  );

  const runtimeEnvironment = fs.readFileSync(
    path.join(runtimePath, 'background/00_environment.js'),
    'utf8',
  );
  const sourceEnvironment = fs.readFileSync(
    path.join(root, 'src/assets/extensions/browser_automation/background/00_environment.js'),
    'utf8',
  );
  assert.match(runtimeEnvironment, /protectedRuntime":true/);
  assert.ok(runtimeEnvironment.includes(accessToken));
  assert.match(sourceEnvironment, /protectedRuntime: false/);
  assert.ok(!sourceEnvironment.includes(accessToken));

  const loadedPaths = [];
  await manager.loadEnabledIntoSession({
    extensions: {
      getAllExtensions: () => [],
      loadExtension: async (loadPath) => {
        loadedPaths.push(loadPath);
        return { id: `loaded-${loadedPaths.length}`, path: loadPath };
      },
    },
  }, '真实加载路径验证');
  const loadedAutomationPath = loadedPaths.find(
    (item) => path.basename(item).toLowerCase() === 'browser_automation',
  );
  assert.ok(loadedAutomationPath, '自动化插件必须进入实际 session.extensions.loadExtension 调用');
  assert.ok(path.resolve(loadedAutomationPath).startsWith(path.resolve(userData)));
  assert.match(
    fs.readFileSync(path.join(loadedAutomationPath, 'background/00_environment.js'), 'utf8'),
    /protectedRuntime":true/,
  );

  accessToken = 'next-start-token-uses-another-extension-path';
  const rotatedRuntimePath = manager.getEnabledExtensionPaths()
    .find((item) => path.basename(item).toLowerCase() === 'browser_automation');
  assert.ok(rotatedRuntimePath);
  assert.notEqual(rotatedRuntimePath, runtimePath);
  assert.ok(fs.readFileSync(
    path.join(rotatedRuntimePath, 'background/00_environment.js'),
    'utf8',
  ).includes(accessToken));
});
