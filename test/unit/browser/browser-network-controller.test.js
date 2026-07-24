'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

let clashStatus = { running: true, enabled: true, coreDir: 'fixture-core' };
let endpoint = { host: '127.0.0.2', port: 17890 };
let shuttingDown = false;
const runtimePath = require.resolve('../../../src/app/main/features/network/clash-mini-control-runtime');
const contextPath = require.resolve('../../../src/app/main/runtime/app-context');
const environmentPath = require.resolve('../../../src/app/main/features/browser/browser-environment');
const targetPath = require.resolve('../../../src/app/main/features/browser/browser-network-controller');

require.cache[runtimePath] = { exports: {
  getClashMiniStatus: () => clashStatus,
  getClashMiniProxyEndpoint: () => endpoint,
  getClashMiniRuntimeRoot: () => 'fallback-core',
} };
require.cache[contextPath] = { exports: { appContext: { isShuttingDown: () => shuttingDown } } };
require.cache[environmentPath] = { exports: {
  buildAppliedBrowserEnvironment: (profile) => ({ locale: profile.locale, timezoneId: profile.timezoneId }),
} };
delete require.cache[targetPath];
const { createBrowserNetworkController } = require(targetPath);

function createFixture(overrides = {}) {
  const tabs = new Map();
  const instances = new Map();
  const restarts = [];
  let updates = 0;
  const loggerMessages = [];
  const controller = createBrowserNetworkController({
    browserRuntimeManager: {
      chromium: { instances },
      restart: async (id) => { restarts.push(id); return { status: 'running' }; },
    },
    logger: { warn: (...args) => loggerMessages.push(args.join(' ')) },
    resolveTabBrowserProfile: async () => ({
      region: 'US', locale: 'en-US', acceptLanguage: 'en-US', timezoneId: 'America/New_York',
      userAgent: 'fixture-agent',
    }),
    resolveTabs: () => tabs,
    updateTabs: () => { updates += 1; },
    ...overrides,
  });
  return { controller, instances, loggerMessages, restarts, tabs, updates: () => updates };
}

test.beforeEach(() => {
  clashStatus = { running: true, enabled: true, coreDir: 'fixture-core' };
  endpoint = { host: '127.0.0.2', port: 17890 };
  shuttingDown = false;
});

test('proxy endpoint is normalized and rejects unavailable control data', () => {
  const { controller } = createFixture();
  assert.deepEqual(controller.getBrowserProxyEndpoint(), {
    enabled: true,
    server: 'http://127.0.0.2:17890',
    bypassRules: '<local>;127.0.0.1;localhost;::1',
  });
  endpoint = { host: '', port: '7890' };
  assert.equal(controller.getBrowserProxyEndpoint().server, 'http://127.0.0.1:7890');
  endpoint = { port: 'invalid' };
  assert.equal(controller.getBrowserProxyEndpoint(), null);
  clashStatus = {};
  assert.equal(controller.getBrowserProxyEndpoint(), null);
});

test('proxy application updates only selected profiles and avoids redundant restarts', async () => {
  const fixture = createFixture();
  const magic = { id: 'magic', browserSettings: { proxy: { mode: 'magic' } }, browserProfile: { region: 'CN' } };
  const direct = { id: 'direct', browserSettings: { proxy: { mode: 'default' } } };
  fixture.tabs.set(magic.id, magic);
  fixture.tabs.set(direct.id, direct);
  fixture.instances.set(magic.id, { profile: { proxyServer: '', proxyBypassList: '' } });

  const first = await fixture.controller.applyClashMiniBrowserProxy(true);
  assert.deepEqual({ ok: first.ok, updated: first.updated, total: first.total }, { ok: true, updated: 1, total: 1 });
  assert.deepEqual(fixture.restarts, ['magic']);
  assert.equal(magic.networkMagicApplied, true);
  assert.equal(fixture.instances.get('magic').profile.locale, 'en-US');

  const second = await fixture.controller.applyClashMiniBrowserProxy(true);
  assert.equal(second.updated, 0);
  assert.deepEqual(fixture.restarts, ['magic']);
  assert.equal(fixture.updates(), 2);
});

test('profile refresh applies injected region without proxy-exit probe gate', async () => {
  const fixture = createFixture({
    resolveTabBrowserProfile: async () => ({
      region: 'CN', locale: 'zh-CN', acceptLanguage: 'zh-CN', timezoneId: 'Asia/Shanghai', userAgent: 'fixture-agent',
    }),
  });
  const tab = { id: 'one', browserSettings: { proxy: { mode: 'magic' } }, browserProfile: { region: 'US' } };
  fixture.tabs.set(tab.id, tab);
  fixture.instances.set(tab.id, { profile: { proxyServer: '', proxyBypassList: '', locale: 'en-US' } });
  const result = await fixture.controller.applyClashMiniBrowserProxy(true, { forceProfileRefresh: true });
  assert.equal(result.updated, 1);
  assert.equal(tab.browserProfile.region, 'CN');
  assert.equal(fixture.instances.get('one').profile.locale, 'zh-CN');
});

test('shutdown and missing runtime instances are safe no-op paths', async () => {
  const fixture = createFixture();
  const tab = { id: 'one', browserSettings: { proxy: { mode: 'magic' } } };
  fixture.tabs.set(tab.id, tab);
  shuttingDown = true;
  const shutdown = await fixture.controller.applyClashMiniBrowserProxy(true);
  assert.equal(shutdown.skipped, true);
  shuttingDown = false;
  const missing = await fixture.controller.applyClashMiniBrowserProxy(true);
  assert.equal(missing.updated, 0);
  assert.equal(tab.networkMagicApplied, false);
});

test('per-tab magic selection persists choices and reports restart failures', async () => {
  const fixture = createFixture();
  assert.deepEqual(
    await fixture.controller.applyNetworkMagicToTab('missing', true),
    { ok: false, error: '浏览器窗口不存在' },
  );
  const tab = { id: 'one', browserSettings: {}, networkMagicApplied: false };
  fixture.tabs.set(tab.id, tab);
  fixture.instances.set(tab.id, { profile: { proxyServer: '', proxyBypassList: '' } });
  clashStatus = { running: false, enabled: false };
  const remembered = await fixture.controller.applyNetworkMagicToTab(tab.id, true);
  assert.deepEqual(remembered, { ok: true, magicRunning: false, restarted: false });
  assert.equal(tab.browserSettings.proxy.mode, 'magic');

  clashStatus = { running: true, enabled: true, coreDir: 'fixture-core' };
  fixture.controller.applyClashMiniBrowserProxy = async () => ({ ok: false });
  const disabled = await fixture.controller.applyNetworkMagicToTab(tab.id, false);
  assert.equal(disabled.ok, true);
  assert.equal(tab.browserSettings.proxy.mode, 'default');
});
