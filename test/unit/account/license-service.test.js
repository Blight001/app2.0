'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLicenseService,
  createVipSession,
  shouldClearSavedKey,
} = require('../../../src/app/main/features/account/license-service');

function fixture(overrides = {}) {
  const writes = [];
  const recordWrites = [];
  const events = [];
  const store = {
    userCredentials: {
      authType: 'account', username: 'alice', key: 'key', deviceId: 'stale-device',
      serverBase: 'https://service.example', serverMode: 'remote', platformName: 'default',
      account: {}, validation: {},
    },
  };
  const context = {
    computeDeviceId: async () => 'trusted-device',
    readStoreConfigSafe: () => writes.at(-1) || store,
    writeStoreConfigSafe: (value) => { writes.push(value); return true; },
    readLicenseRecordsSafe: () => [{ id: 'one', keyValue: 'key' }, { id: 'two', keyValue: 'other' }],
    writeLicenseRecordsSafe: (value) => recordWrites.push(value),
    getCurrentPlatformLabel: () => 'default',
    getGlobalHttpClient: () => ({}),
    licenseCache: {
      setValidationState(value) { this.validation = value; },
      setCredentials(value) { this.credentials = value; },
      setRuntimeConfig() {},
      getRuntimeConfig: () => ({}),
      getCredentials: () => ({}),
    },
    sendToSide: (channel, value) => events.push({ channel, value }),
    ...overrides,
  };
  return { context, events, recordWrites, writes };
}

test('VIP 礼品码每次读取可信设备号，兑换后持久化并发布会员状态', async () => {
  const calls = [];
  const data = fixture({
    getGlobalHttpClient: () => ({
      redeemVipGiftCode: async (...args) => { calls.push(args); return { ok: true, vip_tier: 'svip' }; },
      validateKey: async () => ({ valid: true, is_vip: true, vip_active: true, vip_tier: 'svip' }),
    }),
  });
  const result = await createLicenseService(data.context).redeemVipGiftCode({ code: ' gift ' });
  assert.deepEqual(calls, [['key', 'trusted-device', 'gift']]);
  assert.equal(result.ok, true);
  assert.equal(data.writes.at(-1).userCredentials.deviceId, 'trusted-device');
  assert.equal(data.events.at(-1).channel, 'account-session-updated');
});

test('羊毛礼品码服务失败不写缓存，验证成功才刷新平台', async () => {
  let refreshes = 0;
  const failed = fixture({
    getGlobalHttpClient: () => ({ redeemWoolGiftCode: async () => ({ ok: false, message: 'invalid' }) }),
    refreshAllowedPlatformsAndNotify: () => { refreshes += 1; },
  });
  assert.equal((await createLicenseService(failed.context).redeemWoolGiftCode({ code: 'bad' })).ok, false);
  assert.equal(refreshes, 0);
  const success = fixture({
    getGlobalHttpClient: () => ({
      redeemWoolGiftCode: async () => ({ ok: true }),
      validateKey: async () => ({ valid: true, allowed_platforms: ['one'] }),
    }),
    refreshAllowedPlatformsAndNotify: () => { refreshes += 1; },
  });
  assert.equal((await createLicenseService(success.context).redeemWoolGiftCode({ code: 'ok' })).ok, true);
  assert.equal(refreshes, 1);
});

test('删除当前卡密同时清除账号保存键，未知记录保持原数据', () => {
  const data = fixture();
  const service = createLicenseService(data.context);
  assert.deepEqual(service.deleteRecord({ id: 'missing' }), { ok: false, error: '未找到要删除的卡密' });
  const result = service.deleteRecord({ id: 'one' });
  assert.deepEqual(result, { ok: true, removed: 1 });
  assert.deepEqual(data.recordWrites.at(-1), [{ id: 'two', keyValue: 'other' }]);
  assert.equal(data.writes.at(-1).userCredentials.key, '');
  assert.deepEqual(data.context.licenseCache.credentials, { key: '' });
});

test('VIP session and saved-key rules normalize expiry and remaining records', () => {
  const session = createVipSession({ userCredentials: { keep: true } }, {
    username: 'alice', key: 'key', deviceId: 'device', platformName: 'fixture',
    serverBase: 'https://service.example', serverMode: 'remote', account: { id: 1 },
  }, { vip_tier: 'gold', vip_expiry_date: '2030-01-01' }, {});
  assert.equal(session.account.is_vip, true);
  assert.equal(session.account.vip_tier, 'gold');
  assert.equal(session.publicSession.authenticated, true);
  assert.equal(shouldClearSavedKey('', 'key', []), false);
  assert.equal(shouldClearSavedKey('key', 'key', [{ keyValue: 'key' }]), true);
  assert.equal(shouldClearSavedKey('key', 'other', [{ key: 'key' }]), false);
  assert.equal(shouldClearSavedKey('key', 'other', [{ key: 'another' }]), true);
});

test('VIP plan lookup validates login, client capability and catches failures', async () => {
  const loggedOut = fixture({ readStoreConfigSafe: () => ({}) });
  assert.equal((await createLicenseService(loggedOut.context).getVipPlans()).message, '请先在个人中心登录账号');
  const unavailable = fixture();
  assert.equal((await createLicenseService(unavailable.context).getVipPlans()).message, 'VIP 套餐服务尚未就绪');
  const ready = fixture({ getGlobalHttpClient: () => ({ getVipPlans: async (key, device) => ({ ok: true, key, device }) }) });
  assert.equal((await createLicenseService(ready.context).getVipPlans()).ok, true);
  const broken = fixture({ readStoreConfigSafe: () => { throw new Error('store failed'); } });
  assert.equal((await createLicenseService(broken.context).getVipPlans()).message, 'store failed');
});

test('gift-code validation covers missing inputs, unavailable clients and rejected redemptions', async () => {
  const loggedOut = fixture({ readStoreConfigSafe: () => ({}), computeDeviceId: async () => '' });
  assert.equal((await createLicenseService(loggedOut.context).redeemVipGiftCode({ code: 'x' })).message, '请先在个人中心登录账号');
  assert.equal((await createLicenseService(loggedOut.context).redeemWoolGiftCode({ code: 'x' })).message, '请先在个人中心登录账号');
  const data = fixture();
  assert.equal((await createLicenseService(data.context).redeemVipGiftCode({})).message, '请输入礼品码');
  assert.equal((await createLicenseService(data.context).redeemWoolGiftCode({})).message, '请输入礼品码');
  assert.equal((await createLicenseService(data.context).redeemVipGiftCode({ code: 'x' })).message, 'VIP 礼品码服务尚未就绪');
  assert.equal((await createLicenseService(data.context).redeemWoolGiftCode({ code: 'x' })).message, '羊毛礼品码服务尚未就绪');
  const rejected = fixture({ getGlobalHttpClient: () => ({
    redeemVipGiftCode: async () => ({ ok: false, message: 'invalid vip' }),
    redeemWoolGiftCode: async () => ({ ok: false, message: 'invalid wool' }),
  }) });
  assert.equal((await createLicenseService(rejected.context).redeemVipGiftCode({ code: 'x' })).message, 'invalid vip');
  assert.equal((await createLicenseService(rejected.context).redeemWoolGiftCode({ code: 'x' })).message, 'invalid wool');
});

test('wool redemption returns validation failures without updating runtime state', async () => {
  let refreshes = 0;
  const data = fixture({
    getGlobalHttpClient: () => ({
      redeemWoolGiftCode: async () => ({ ok: true, reward: 1 }),
      validateKey: async () => ({ ok: false, message: 'still invalid' }),
    }),
    refreshAllowedPlatformsAndNotify: () => { refreshes += 1; },
  });
  const result = await createLicenseService(data.context).redeemWoolGiftCode({ code: 'x' });
  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, false);
  assert.equal(refreshes, 0);
});

test('saved keys and record operations tolerate cache, storage and write failures', () => {
  const cached = fixture();
  cached.context.licenseCache.getCredentials = () => ({ key: ' cached ' });
  assert.equal(createLicenseService(cached.context).getSavedKey(), 'cached');
  const fromRecord = fixture();
  assert.equal(createLicenseService(fromRecord.context).getSavedKey(), 'key');
  const brokenRead = fixture({ readLicenseRecordsSafe: () => { throw new Error('records failed'); } });
  assert.equal(createLicenseService(brokenRead.context).getSavedKey(), '');
  assert.equal(createLicenseService(brokenRead.context).getRecords().ok, false);
  const records = createLicenseService(fixture().context).getRecords();
  assert.equal(records.ok, true);
  assert.equal(records.currentPlatformName, 'default');
  const clearOk = fixture();
  assert.deepEqual(createLicenseService(clearOk.context).clearRecords(), { ok: true });
  const clearBad = fixture({ writeLicenseRecordsSafe: () => { throw new Error('write failed'); } });
  assert.deepEqual(createLicenseService(clearBad.context).clearRecords(), { ok: false, error: 'write failed' });
  assert.deepEqual(createLicenseService(fixture().context).deleteRecord({}), { ok: false, error: '缺少要删除的卡密' });
  const deleteBad = fixture({ readLicenseRecordsSafe: () => { throw new Error('delete failed'); } });
  assert.deepEqual(createLicenseService(deleteBad.context).deleteRecord({ id: 'one' }), { ok: false, error: 'delete failed' });
});
