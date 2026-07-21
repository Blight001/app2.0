'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { app, BrowserWindow } = require('electron');
const { createBrowserRuntimeManager } = require('../../../src/app/main/browser-runtime');
const { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } = require('../../../src/app/main/browser-runtime/chromium-command-client');

const acceptanceChromiumPath = String(process.env.AI_FREE_ACCEPTANCE_CHROMIUM_PATH || '').trim();
if (acceptanceChromiumPath) {
  process.env.AI_FREE_CHROMIUM_HANDSHAKE = 'prototype';
  process.env.AI_FREE_CHROMIUM_PATH = acceptanceChromiumPath;
} else {
  delete process.env.AI_FREE_CHROMIUM_HANDSHAKE;
  delete process.env.AI_FREE_CHROMIUM_PATH;
}

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-phase3-'));
const pageLoads = new Map();
const requests = [];
let manager;
let window;
let server;

function cookieHeaderHas(header, name, value) {
  return String(header || '').split(/;\s*/).includes(`${name}=${value}`);
}

function createTestServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const profile = String(url.searchParams.get('profile') || 'origin');
    requests.push({
      path: url.pathname,
      query: url.search,
      profile,
      cookie: String(request.headers.cookie || ''),
    });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/input-result') {
      response.end('ok');
      return;
    }
    if (url.pathname === '/input') {
      response.end(`<!doctype html><meta charset="utf-8"><title>INPUT_READY</title>
        <button id="target" style="position:fixed;inset:0;width:100vw;height:100vh">input target</button>
        <script>
          document.querySelector('#target').addEventListener('click', (event) => {
            fetch('/input-result?profile=${profile}&trusted=' + event.isTrusted).catch(() => {});
          });
        </script>`);
      return;
    }
    if (url.pathname === '/navigate') {
      response.end(`<title>NAVIGATED_${profile.toUpperCase()}</title><h1>navigate ok</h1>`);
      return;
    }
    const count = (pageLoads.get(profile) || 0) + 1;
    pageLoads.set(profile, count);
    response.end(`<!doctype html><meta charset="utf-8"><title>loading</title>
      <script>
        const profile = ${JSON.stringify(profile)};
        const visible = document.cookie.includes('visible=' + profile.toUpperCase());
        const httpOnlyHidden = !document.cookie.includes('secret=');
        const stored = localStorage.getItem('profileKey') || '';
        const sessionStored = sessionStorage.getItem('sessionKey') || '';
        document.title = 'PROFILE_' + profile.toUpperCase() + ';VISIBLE_' + (visible ? 'YES' : 'NO') +
          ';HTTPONLY_HIDDEN_' + (httpOnlyHidden ? 'YES' : 'NO') + ';LOCAL_' + stored +
          ';SESSION_' + sessionStored + ';LOAD_${count}';
      </script>`);
  });
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function findFiles(root, matcher) {
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (matcher(fullPath, entry.name)) found.push(fullPath);
    }
  };
  if (fs.existsSync(root)) visit(root);
  return found;
}

function waitForEvent(emitter, eventName, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(eventName, onEvent);
      reject(new Error(`等待 ${eventName} 超时`));
    }, timeoutMs);
    const onEvent = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.off(eventName, onEvent);
      resolve(value);
    };
    emitter.on(eventName, onEvent);
  });
}

async function waitForRequest(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = requests.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待输入事件结果超时');
}

async function launchProfile(profileId, targetUrl) {
  const state = await manager.launchProfile({
    profileId,
    runtimeType: 'chromium',
    initialUrl: 'about:blank',
    launchTimeoutMs: 30000,
    extraArgs: ['--enable-logging=stderr'],
  }, { x: 0, y: 41, width: 1180, height: 719 });
  assert.equal(state.status, 'ready');
  assert.equal(state.bridgeConnected, true);
  assert(state.sessionId && state.browserHwnd);
  const marker = profileId.slice(-1).toUpperCase();
  const result = await manager.importSession(profileId, {
    targetUrl,
    cookies: [
      { name: 'visible', value: marker, url: targetUrl, path: '/', sameSite: 'lax' },
      { name: 'secret', value: `http-only-${marker}`, url: targetUrl, path: '/', httpOnly: true, sameSite: 'lax' },
    ],
    browserStorage: [{
      origin: new URL(targetUrl).origin,
      localStorage: { profileKey: marker },
      sessionStorage: { sessionKey: `session-${marker}` },
    }],
  });
  assert.equal(result.cookiesImported, 2);
  assert.equal(result.storageOriginsImported, 1);
  assert.equal(result.storageResults[0].localVerified, true);
  assert.equal(result.storageResults[0].sessionVerified, true);
  assert.match(result.navigation.title,
    new RegExp(`PROFILE_${marker};VISIBLE_YES;HTTPONLY_HIDDEN_YES;LOCAL_${marker};SESSION_session-${marker}`));
  return { state, result };
}

async function stopAndAssertReleased(profileId, pid) {
  const paths = manager.store.getProfilePaths(profileId);
  const instance = manager.chromium.instances.get(profileId);
  await manager.stop(profileId, 'chromium', { timeoutMs: 5000 });
  assert.equal(manager.getState(profileId).status, 'stopped');
  assert.equal(isPidAlive(pid), false, `${profileId} Chromium 根进程必须退出`);
  assert.equal(fs.existsSync(paths.lock), false, `${profileId} Profile Lock 必须释放`);
  assert.equal(instance.commandClient.server, null, `${profileId} Named Pipe server 必须关闭`);
}

async function shutdown(exitCode) {
  try { await manager?.stopAll({ timeoutMs: 5000 }); } catch (_) {}
  try { await new Promise((resolve) => server?.close(resolve)); } catch (_) {}
  if (exitCode === 0) {
    try { fs.rmSync(runtimeRoot, { recursive: true, force: true }); } catch (_) {}
  } else {
    console.error(`[phase3-acceptance] failure artifacts preserved at ${runtimeRoot}`);
  }
  app.exit(exitCode);
}

app.whenReady().then(async () => {
  server = createTestServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ width: 1200, height: 800, show: true, title: 'AI-FREE Phase 3 Acceptance' });
  await window.loadURL('data:text/html,<body style="background:%23101827;color:white"><h2>Phase 3 acceptance</h2></body>');
  const acceptanceResourcesPath = String(process.env.AI_FREE_ACCEPTANCE_RESOURCES_PATH || '').trim()
    || (acceptanceChromiumPath
      ? path.dirname(acceptanceChromiumPath)
      : path.resolve(__dirname, '..', '..', '..', 'resources'));
  manager = createBrowserRuntimeManager({
    userDataDir: runtimeRoot,
    resourcesPath: acceptanceResourcesPath,
    getParentWindow: () => window,
    logger: console,
  });

  const a = await launchProfile('phase3_a', `${origin}/page?profile=a`);
  await manager.hide('phase3_a', 'chromium');
  const b = await launchProfile('phase3_b', `${origin}/page?profile=b`);

  const aRequest = requests.find((item) => item.path === '/page' && item.profile === 'a');
  const bRequest = requests.find((item) => item.path === '/page' && item.profile === 'b');
  assert(aRequest && cookieHeaderHas(aRequest.cookie, 'visible', 'A'));
  assert(aRequest && cookieHeaderHas(aRequest.cookie, 'secret', 'http-only-A'));
  assert(bRequest && cookieHeaderHas(bRequest.cookie, 'visible', 'B'));
  assert(bRequest && cookieHeaderHas(bRequest.cookie, 'secret', 'http-only-B'));
  assert.equal(cookieHeaderHas(aRequest.cookie, 'visible', 'B'), false);
  assert.equal(cookieHeaderHas(bRequest.cookie, 'visible', 'A'), false);

  await manager.hide('phase3_b', 'chromium');
  await manager.show('phase3_a', 'chromium');
  const aReloadAfterB = await manager.reload('phase3_a', 'chromium');
  assert.match(aReloadAfterB.result.title,
    /PROFILE_A;VISIBLE_YES;HTTPONLY_HIDDEN_YES;LOCAL_A;SESSION_session-A/);
  const latestARequest = requests.filter((item) => item.path === '/page' && item.profile === 'a').at(-1);
  assert(latestARequest && cookieHeaderHas(latestARequest.cookie, 'visible', 'A'));
  assert(latestARequest && cookieHeaderHas(latestARequest.cookie, 'secret', 'http-only-A'));
  assert.equal(cookieHeaderHas(latestARequest.cookie, 'visible', 'B'), false);
  assert.equal(cookieHeaderHas(latestARequest.cookie, 'secret', 'http-only-B'), false);
  await manager.hide('phase3_a', 'chromium');
  await manager.show('phase3_b', 'chromium');

  const inputPage = await manager.navigate('phase3_b', 'chromium', `${origin}/input?profile=b`);
  assert.equal(inputPage.result.title, 'INPUT_READY');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await manager.hide('phase3_b', 'chromium');
  const inputDispatch = await manager.dispatchInputByProcessId(b.state.pid, {
    inputType: 'mouse', action: 'click', x: 10, y: 10,
    viewportWidth: 1000, viewportHeight: 600,
  });
  assert.equal(inputDispatch.result.dispatched, true);
  const inputRequest = await waitForRequest((item) => item.path === '/input-result' && item.profile === 'b');
  assert.equal(new URLSearchParams(inputRequest.query || '').get('trusted'), 'true');
  await manager.show('phase3_b', 'chromium');
  await manager.navigate('phase3_b', 'chromium', `${origin}/page?profile=b`);

  const beforeReload = pageLoads.get('b');
  const reload = await manager.reload('phase3_b', 'chromium');
  assert(pageLoads.get('b') > beforeReload, 'reload 必须触发新的 HTTP 页面请求');
  assert.match(reload.result.title, /PROFILE_B/);
  const navigate = await manager.navigate('phase3_b', 'chromium', `${origin}/navigate?profile=b`);
  assert.equal(navigate.result.url, `${origin}/navigate?profile=b`);
  assert.equal(navigate.result.title, 'NAVIGATED_B');

  const clientB = manager.chromium.instances.get('phase3_b').commandClient;
  const invalidSessionId = `invalid-session-${Date.now()}`;
  const invalidSessionResponse = waitForEvent(clientB, 'response', (message) => message.requestId === invalidSessionId);
  clientB.sendRaw({
    type: 'reload', protocolVersion: PROTOCOL_VERSION, profileId: 'phase3_b',
    sessionId: 'wrong-session', requestId: invalidSessionId,
  });
  assert.equal((await invalidSessionResponse).error.code, 'SESSION_ID_MISMATCH');
  const invalidProfileId = `invalid-profile-${Date.now()}`;
  const invalidProfileResponse = waitForEvent(clientB, 'response', (message) => message.requestId === invalidProfileId);
  clientB.sendRaw({
    type: 'reload', protocolVersion: PROTOCOL_VERSION, profileId: 'wrong-profile',
    sessionId: clientB.sessionId, requestId: invalidProfileId,
  });
  assert.equal((await invalidProfileResponse).error.code, 'PROFILE_ID_MISMATCH');
  await assert.rejects(clientB.send('set-storage', {
    origin: 'http://unrelated.invalid', targetUrl: `${origin}/page?profile=b`,
    localStorage: { bad: '1' }, sessionStorage: {},
  }), (error) => /** @type {any} */ (error).code === 'STORAGE_ORIGIN_FORBIDDEN');

  const cookieFilesA = findFiles(manager.store.getProfilePaths('phase3_a').chromiumData,
    (_fullPath, name) => name === 'Cookies');
  const storageFilesA = findFiles(manager.store.getProfilePaths('phase3_a').chromiumData,
    (fullPath) => /Local Storage/i.test(fullPath));
  assert(cookieFilesA.length > 0, '独立 Chromium Profile 必须生成实际 Cookie Store');
  assert(storageFilesA.length > 0, '独立 Chromium Profile 必须生成实际 Local Storage 数据');

  await stopAndAssertReleased('phase3_a', a.state.pid);
  await stopAndAssertReleased('phase3_b', b.state.pid);

  const restoredB = await manager.launchProfile({
    profileId: 'phase3_b',
    runtimeType: 'chromium',
    initialUrl: '',
    restoreLastSession: true,
    restoreFallbackUrl: `${origin}/page?profile=b`,
    launchTimeoutMs: 30000,
  }, { x: 0, y: 41, width: 1180, height: 719 });
  const restoredReload = await manager.reload('phase3_b', 'chromium');
  assert.equal(restoredReload.result.url, `${origin}/navigate?profile=b`);
  assert.equal(restoredReload.result.title, 'NAVIGATED_B');
  const restoredA = await manager.launchProfile({
    profileId: 'phase3_a',
    runtimeType: 'chromium',
    initialUrl: '',
    restoreLastSession: true,
    restoreFallbackUrl: `${origin}/page?profile=a`,
    launchTimeoutMs: 30000,
  }, { x: 0, y: 41, width: 1180, height: 719 });
  await manager.stopAll({ timeoutMs: 5000 });
  assert.equal(manager.getState('phase3_a').status, 'stopped');
  assert.equal(manager.getState('phase3_b').status, 'stopped');
  assert.equal(isPidAlive(restoredA.pid), false);
  assert.equal(isPidAlive(restoredB.pid), false);

  const oversized = await manager.launchProfile({
    profileId: 'phase3_oversized', runtimeType: 'chromium', initialUrl: 'about:blank', launchTimeoutMs: 30000,
  }, { x: 0, y: 41, width: 1180, height: 719 });
  const oversizedClient = manager.chromium.instances.get('phase3_oversized').commandClient;
  const oversizedResponse = waitForEvent(oversizedClient, 'response',
    (message) => message.error?.code === 'MESSAGE_TOO_LARGE');
  const invalidHeader = Buffer.alloc(4);
  invalidHeader.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
  oversizedClient.socket.write(invalidHeader);
  assert.equal((await oversizedResponse).error.code, 'MESSAGE_TOO_LARGE');
  await manager.stop('phase3_oversized', 'chromium', { timeoutMs: 1000 });
  assert.equal(isPidAlive(oversized.pid), false);

  console.log('[phase3-acceptance] navigate/reload command responses passed');
  console.log('[phase3-acceptance] visible + HttpOnly cookies reached real Chromium requests');
  console.log('[phase3-acceptance] LocalStorage/SessionStorage verification and two-Profile isolation passed');
  console.log('[phase3-acceptance] invalid session/profile/origin/oversized message rejection passed');
  console.log('[phase3-acceptance] process, Named Pipe and Profile Lock release passed');
  console.log('[phase3-acceptance] stopAll graceful quit and last-session restore passed');
  await shutdown(0);
}).catch(async (error) => {
  console.error('[phase3-acceptance] FAILED', error.stack || error);
  try { console.error('[phase3-acceptance] runtime states', manager?.listStates()); } catch (_) {}
  await shutdown(1);
});

app.on('window-all-closed', () => { void shutdown(0); });
