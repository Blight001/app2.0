'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiSupportService } = require('../../../src/app/main/features/ai-chat/ai-support-service');
const { markVipServerVerified } = require('../../../src/app/main/utils/vip-access');

function vipLicenseCache() {
  return { getSnapshot: () => ({ result: markVipServerVerified({ is_vip: true }) }) };
}

test('远端模型服务不可用时仍向已验证 VIP 返回本地自定义模型', async () => {
  const service = createAiSupportService({
    readStoreConfigSafe: () => ({
      userCredentials: {},
      aiControlSettings: {
        customApi: { enabled: true, name: '私有模型', baseUrl: 'https://ai.example/v1', model: 'model-x' },
      },
    }),
    licenseCache: vipLicenseCache(),
    getGlobalHttpClient: () => null,
  });

  assert.deepEqual(await service.getModels(), {
    ok: true,
    models: [{
      id: '__custom_openai_api__',
      name: '私有模型',
      model: 'model-x',
      custom_api: true,
      supports_image_input: false,
    }],
    quota: null,
  });
});

test('AI 礼品码兑换每次重新读取本机设备号且不信任存储旧值', async () => {
  const calls = [];
  const service = createAiSupportService({
    readStoreConfigSafe: () => ({ userCredentials: { key: 'account-key', deviceId: 'stale-device' } }),
    computeDeviceId: async () => 'current-device',
    getGlobalHttpClient: () => ({
      redeemAIControlGiftCode: async (...args) => {
        calls.push(args);
        return { ok: true };
      },
    }),
  });

  assert.deepEqual(await service.redeemGiftCode({ code: 'gift-1' }), { ok: true });
  assert.deepEqual(calls, [['account-key', 'current-device', 'gift-1']]);
});

test('浏览器连接列表关联运行中 Profile 名称并保留外部浏览器', () => {
  const service = createAiSupportService({
    browserAutomationBridge: {
      listConnections: () => [
        { id: 'managed', browserProcessId: 100, name: '插件名称' },
        { id: 'external', browserProcessId: 999, name: '外部 Chrome' },
      ],
    },
    browserRuntimeManager: { listStates: () => [{ profileId: 'p1', pid: 100 }] },
    getTabs: () => [{ id: 'p1', runtimeType: 'chromium', fixedTitle: '运营浏览器' }],
  });

  const result = service.getBrowserConnections();
  assert.equal(result.connections[0].name, '运营浏览器');
  assert.equal(result.connections[0].pluginName, '插件名称');
  assert.equal(result.connections[1].name, '外部 Chrome');
});

test('控制目标列表同时返回可绑定的软件窗口并标记当前栏目', () => {
  const service = createAiSupportService({
    browserAutomationBridge: { listConnections: () => [] },
    browserRuntimeManager: {
      listStates: () => [],
      externalApp: {
        listAutomationTargets: () => [{
          profileId: 'software-1', name: '记事本', pid: 321,
        }],
      },
    },
    getActiveTabId: () => 'software-1',
    getTabs: () => [],
  });

  assert.deepEqual(service.getBrowserConnections().softwareTargets, [{
    profileId: 'software-1',
    name: '记事本',
    pid: 321,
    isActive: true,
    toolCount: 1,
  }]);
});

test('自动化卡片读取和选择返回稳定摘要，不泄露完整卡片步骤', async () => {
  const bridge = {
    getCardCacheState: () => ({
      exists: true,
      state: {
        selectedId: 'card-1',
        items: [{ id: 'card-1', cardName: '登录流程', cardData: { steps: [{}, {}] }, savedAt: '2026-01-01' }],
      },
    }),
    selectCard: () => ({
      state: { selectedId: 'card-1' },
      item: { id: 'card-1', cardName: '登录流程', cardData: { steps: [{}, {}] } },
    }),
  };
  const service = createAiSupportService({ browserAutomationBridge: bridge });

  assert.deepEqual(await service.getAutomationCards(), {
    ok: true,
    selectedId: 'card-1',
    cards: [{ id: 'card-1', name: '登录流程', stepCount: 2, savedAt: '2026-01-01' }],
  });
  assert.deepEqual(service.selectAutomationCard({ id: 'card-1' }), {
    ok: true,
    selectedId: 'card-1',
    card: { id: 'card-1', name: '登录流程', stepCount: 2 },
  });
});

test('浏览器选择事件对已销毁窗口无副作用', () => {
  const sent = [];
  const destroyed = createAiSupportService({
    getMainWindow: () => ({ isDestroyed: () => true, webContents: { send: (...args) => sent.push(args) } }),
  });
  assert.equal(destroyed.broadcastBrowserSelection({ profileIds: ['p1'] }), false);
  assert.deepEqual(sent, []);
});

test('软件控制目标选择事件保留软件 Profile 供主窗口显示 AI 粒子效果', () => {
  const sent = [];
  const service = createAiSupportService({
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (...args) => sent.push(args),
      },
    }),
  });

  assert.equal(service.broadcastBrowserSelection({
    profileIds: [],
    softwareProfileId: 'software-notepad',
  }), true);
  assert.deepEqual(sent, [[
    'ai-control-browser-selection-changed',
    {
      profileId: '',
      profileIds: [],
      softwareProfileId: 'software-notepad',
    },
  ]]);
});
