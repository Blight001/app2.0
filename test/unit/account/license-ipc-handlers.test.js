'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLicenseIpcHandlers,
} = require('../../../src/app/main/features/account/license-ipc-handlers');

function fixture(overrides = {}) {
  const runtimeUpdates = [];
  const deps = {
    accountStorage: {
      getLastUsedAccount: () => ({ ok: true, account: { key: 'key', deviceId: 'device' } }),
    },
    auth: {},
    buildAccountCleanupOptions: () => ({}),
    getServerBase: () => 'https://account.example',
    httpClient: {
      validateKey: async () => ({ ok: true, valid: true, woolPlatforms: ['Dream'] }),
      getTutorialUrl: async () => ({ ok: true, tutorialUrl: 'https://docs.example' }),
      getClientConfig: async () => ({ ok: true, proxy_subscription_url: 'https://proxy.example/sub' }),
      unbindDevice: async () => ({ ok: true, remaining_unbind_times: 1 }),
    },
    licenseCache: {
      getCredentials: () => ({ key: 'key', deviceId: 'device' }),
      setRuntimeConfig: (value) => runtimeUpdates.push(value),
      setUnboundState(value) { this.unbound = value; },
    },
    resolveRuntimeConnectionConfig: () => ({ serverBase: '', tcp: null }),
    state: {},
    ...overrides,
  };
  return { deps, handlers: createLicenseIpcHandlers(deps), runtimeUpdates };
}

test('并发刷新羊毛平台共享一次验证请求并只更新对应缓存', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const data = fixture({
    httpClient: {
      validateKey: async () => {
        calls += 1;
        await pending;
        return {
          ok: true,
          valid: true,
          wool_platforms: [{ name: 'Dream', target_url: 'https://dream.example' }],
        };
      },
    },
  });
  const first = data.handlers.refreshWoolPlatforms();
  const second = data.handlers.refreshWoolPlatforms();
  release();

  const expected = [{
    name: 'Dream',
    platform: 'Dream',
    targetUrl: 'https://dream.example',
    quota: null,
  }];
  assert.deepEqual(await first, { ok: true, woolPlatforms: expected });
  assert.deepEqual(await second, { ok: true, woolPlatforms: expected });
  assert.equal(calls, 1);
  assert.deepEqual(data.runtimeUpdates, [{ woolPlatforms: expected }]);
});

test('教程刷新优先使用公开接口，未登录时也不触发卡密验证', async () => {
  let validations = 0;
  const data = fixture({
    httpClient: {
      getTutorialUrl: async () => ({ ok: true, tutorial_url: 'https://docs.example/new' }),
      validateKey: async () => { validations += 1; return { ok: false }; },
    },
    licenseCache: {
      getCredentials: () => ({}),
      setRuntimeConfig: (value) => data.runtimeUpdates.push(value),
    },
  });
  const result = await data.handlers.refreshTutorialUrl();

  assert.deepEqual(result, { ok: true, tutorialUrl: 'https://docs.example/new' });
  assert.equal(validations, 0);
});

test('卡密验证失败保留服务器结果和稳定用户消息', async () => {
  const response = { ok: false, valid: false, message: 'license expired' };
  const data = fixture({ httpClient: { validateKey: async () => response } });
  const result = await data.handlers.validateKey(null, { key: 'key', device_id: 'device' });

  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.equal(result.error, 'license expired');
  assert.equal(result.result, response);
});

test('设备解绑校验输入并在成功后同步运行时解绑状态', async () => {
  const data = fixture();
  assert.deepEqual(await data.handlers.unbindDevice(null, { key: '', device_id: '' }), {
    ok: false,
    message: '缺少卡密',
  });
  const result = await data.handlers.unbindDevice(null, { key: ' key ', deviceId: ' device ' });

  assert.equal(result.ok, true);
  assert.deepEqual(data.deps.licenseCache.unbound, { key: 'key', deviceId: 'device' });
});

test('订阅刷新使用最后账号并拒绝不完整服务器响应', async () => {
  const success = fixture();
  assert.deepEqual(await success.handlers.refreshSubscriptionUrl(), {
    ok: true,
    subscriptionUrl: 'https://proxy.example/sub',
  });
  const invalid = fixture({
    httpClient: { getClientConfig: async () => ({ ok: true }) },
  });
  assert.deepEqual(await invalid.handlers.refreshSubscriptionUrl(), {
    ok: false,
    error: '获取配置失败或响应格式不正确',
  });
});
