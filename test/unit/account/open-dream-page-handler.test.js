'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOpenDreamPageHandler,
} = require('../../../src/app/main/features/account/open-dream-page-handler');
const {
  resolveRuntimeConnectionConfig,
} = require('../../../src/app/main/features/account/dream-platform-support');

function fixture(overrides = {}) {
  const events = [];
  const importedSessions = [];
  const addedTabs = [];
  const account = {
    id: 'Dream::alice',
    accountName: 'alice',
    platform: 'Dream',
    currentUrl: 'https://dream.example',
  };
  const support = {
    buildAccountCleanupOptions: () => ({}),
    findOpenDreamTab: () => null,
    hasPersistedDreamProfile: () => false,
    importServerFetchedDreamAccount: (data) => ({
      account,
      accountId: account.id,
      cookies: data.cookies,
      browserStorage: data.browserStorage,
    }),
    isPermanentDreamAccount: () => false,
    navigateDreamTab: async () => {},
    resolveDreamWindowTitle: () => 'Dream',
    resolveHistoricalDreamAccount: () => null,
    ...overrides.support,
  };
  const deps = {
    accountStorage: {
      updateAccount: () => ({ ok: true, account }),
      updateLastUsedTime() {},
    },
    auth: {
      fetchCookieFromServerForDream: async () => ({
        account: 'alice',
        platform: 'Dream',
        currentUrl: 'https://dream.example',
        cookies: [{ name: 'sid', value: 'redacted' }],
        browserStorage: [],
      }),
    },
    isUsageExhaustedFetchError: () => false,
    resolveDreamTargetUrl: () => 'https://dream.example',
    support,
    ui: {
      addTab: async (url, options) => { addedTabs.push({ url, options }); return 'tab-1'; },
      browserRuntimeManager: {
        importSession: async (tabId, session) => importedSessions.push({ tabId, session }),
        reload: async () => {},
      },
      sendToSide: (channel, payload) => events.push({ channel, payload }),
    },
    updateAccountRecycleTimer() {},
    ...overrides.deps,
  };
  return {
    account,
    addedTabs,
    deps,
    events,
    handler: createOpenDreamPageHandler(deps),
    importedSessions,
    support,
  };
}

test('新服务器账号先持久化再创建 Profile、导航并注入会话', async () => {
  const data = fixture();
  const result = await data.handler(null, { key: 'key', deviceId: 'device' });

  assert.deepEqual(result, { ok: true, tabId: 'tab-1' });
  assert.equal(data.addedTabs[0].options.accountId, 'Dream::alice');
  assert.equal(data.addedTabs[0].options.restoreLastSession, false);
  assert.equal(data.importedSessions.length, 1);
  assert.equal(data.importedSessions[0].session.navigateAfterImport, false);
  assert.equal(data.events.some((event) => event.channel === 'account-list-updated'), true);
  assert.equal(data.events.some((event) => event.channel === 'browser-history-changed'), true);
});

test('命中已持久化 Profile 时恢复本地会话且不覆盖 Cookie 和 Storage', async () => {
  const data = fixture({
    support: {
      resolveHistoricalDreamAccount: () => ({
        id: 'Dream::alice', accountName: 'alice', platform: 'Dream', currentUrl: 'https://dream.example',
      }),
      hasPersistedDreamProfile: () => true,
    },
  });
  const result = await data.handler(null, { key: 'key', deviceId: 'device' });

  assert.equal(result.ok, true);
  assert.equal(result.restored, true);
  assert.equal(data.addedTabs[0].options.restoreLastSession, true);
  assert.equal(data.importedSessions.length, 0);
});

test('永久账号次数耗尽时只允许恢复匹配的本地 Profile', async () => {
  const historical = {
    id: 'Dream::saved', key: 'saved-key', deviceId: 'saved-device', accountName: 'saved', platform: 'Dream',
  };
  const data = fixture({
    support: {
      isPermanentDreamAccount: () => true,
      resolveHistoricalDreamAccount: () => historical,
      hasPersistedDreamProfile: () => true,
    },
    deps: {
      auth: { fetchCookieFromServerForDream: async () => { throw new Error('usage exhausted'); } },
      isUsageExhaustedFetchError: () => true,
    },
  });
  const result = await data.handler(null, {
    key: 'key', deviceId: 'device', accountId: 'Dream::saved',
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountId, 'Dream::saved');
  assert.equal(result.restored, true);
  assert.equal(data.importedSessions.length, 0);
});

test('已打开账号窗口被切换并导航，不重复创建 Chromium 标签', async () => {
  const switched = [];
  const navigated = [];
  const data = fixture({
    support: {
      resolveHistoricalDreamAccount: () => ({ id: 'Dream::alice', accountName: 'alice' }),
      findOpenDreamTab: () => ({ id: 'tab-open', accountId: 'Dream::alice' }),
      navigateDreamTab: async (tabId, url) => navigated.push({ tabId, url }),
    },
    deps: { ui: {
      addTab: async () => { throw new Error('不应创建新标签'); },
      browserRuntimeManager: {},
      sendToSide() {},
      switchTab: (tabId) => switched.push(tabId),
    } },
  });
  const result = await data.handler(null, { key: 'key', deviceId: 'device' });

  assert.deepEqual(result, {
    ok: true,
    tabId: 'tab-open',
    alreadyOpen: true,
    accountId: 'Dream::alice',
  });
  assert.deepEqual(switched, ['tab-open']);
  assert.equal(navigated[0].url, 'https://dream.example');
});

test('入口拒绝缺少卡密，运行连接配置兼容 HTTP 与 TCP 字段别名', async () => {
  const data = fixture();
  assert.deepEqual(await data.handler(null, {}), { ok: false, message: '缺少卡密' });
  assert.deepEqual(resolveRuntimeConnectionConfig({
    address_HTTP: ' https://account.example ',
    address_TCP: 'tcp://127.0.0.1:9443',
  }), {
    serverBase: 'https://account.example',
    tcp: { host: '127.0.0.1', port: 9443 },
  });
});
