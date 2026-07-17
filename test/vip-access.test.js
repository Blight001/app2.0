'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createTabManager } = require('../src/app/main/services/tab-manager');
const { FREE_BROWSER_WINDOW_LIMIT, resolveVipAccess } = require('../src/app/main/utils/vip-access');
const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('VIP 状态支持永久、有效期和过期判断', () => {
  const now = Date.parse('2026-01-01T00:00:00');
  assert.equal(resolveVipAccess({ account: { is_vip: 1, vip_expiry_date: null } }, now).isVip, true);
  assert.equal(resolveVipAccess({ validation: { is_vip: true, vip_expiry_date: '2026-02-01 00:00:00' } }, now).isVip, true);
  assert.equal(resolveVipAccess({ validation: { is_vip: true, vip_expiry_date: '2025-12-01 00:00:00' } }, now).isVip, false);
  assert.equal(resolveVipAccess({ account: { is_vip: true }, validation: { is_vip: false } }, now).isVip, false);
});

test('普通用户打开第六个独立浏览器时由主进程拦截', async () => {
  const tabs = new Map();
  for (let index = 0; index < FREE_BROWSER_WINDOW_LIMIT; index += 1) {
    tabs.set(`browser-${index}`, { id: `browser-${index}`, runtimeType: 'chromium' });
  }
  const events = [];
  const manager = createTabManager({
    browserRuntimeManager: { chromium: new EventEmitter() },
    getTabs: () => tabs,
    getMainWindow: () => ({ isDestroyed: () => false }),
    getActiveTabId: () => 'browser-0',
    getIsSidebarVisible: () => true,
    licenseCache: { getSnapshot: () => ({ result: { is_vip: false } }) },
    updateTabs() {},
    sendToSide(channel, payload) { events.push({ channel, payload }); },
  });

  await assert.rejects(
    manager.addTab('chrome://newtab/', { tabId: 'browser-6' }),
    (error) => error?.code === 'VIP_BROWSER_WINDOW_LIMIT',
  );
  assert.equal(tabs.size, FREE_BROWSER_WINDOW_LIMIT);
  assert.equal(events.at(-1)?.channel, 'vip-access-required');
});

test('自定义插件和自定义模型同时具备界面锁与主进程 VIP 门禁', () => {
  const html = read('src/app/sidebar/index.html');
  const pluginsUi = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/feature-toggles.js');
  const modelUi = read('src/app/sidebar/client/app/side/controllers/pages/ai-control.js');
  const pluginIpc = read('src/app/main/ipc/register/extensions.js');
  const settingsIpc = read('src/app/main/ipc/register/settings.js');
  const lifecycle = read('src/app/main/services/app-lifecycle.js');

  assert.match(html, /class="vip-lock"/);
  assert.match(pluginsUi, /openVipAccountCenter/);
  assert.doesNotMatch(html, /id="import-extension-plugin"[^>]*\sdisabled(?:[\s=>]|$)/);
  assert.match(pluginsUi, /if \(!importButton \|\| importInProgress\) return;/);
  assert.ok(
    pluginsUi.indexOf('window.openVipAccountCenter?.();')
      < pluginsUi.indexOf("window.electronAPI.invoke('import-extension-plugin')"),
    '非 VIP 点击导入插件时应先跳转个人中心，不能先打开目录选择框',
  );
  assert.match(modelUi, /添加自定义模型（VIP）/);
  assert.match(modelUi, /openVipAccountCenter/);
  assert.match(pluginIpc, /createVipRequiredResult\('导入自定义插件'\)/);
  assert.match(settingsIpc, /createVipRequiredResult\('自定义模型'\)/);
  assert.match(lifecycle, /useCustomApi && !resolveVipAccess\(credentials\)\.isVip/);
});

test('个人中心提供服务器驱动的动态会员套餐弹窗', () => {
  const html = read('src/app/sidebar/index.html');
  const accountUi = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js');
  const accountStyles = read('src/app/sidebar/client/app/side/styles/modules/account-auth.css');
  const httpClient = read('src/app/main/lib/http-client.js');

  assert.match(html, /id="vip-benefits-dialog"/);
  assert.match(html, /data-vip-tier="vip"/);
  assert.match(html, /data-vip-tier="svip"/);
  assert.match(html, /id="vip-gold-theme-action"/);
  assert.match(accountUi, /get-vip-plans/);
  assert.match(accountUi, /display_name/);
  assert.match(accountUi, /vipTierCatalog\.map/);
  assert.match(accountUi, /item\?\.tiers\?\.\[tier\.tier\]/);
  assert.match(accountUi, /\^\[a-z\]\[a-z0-9_-\]/);
  assert.match(accountUi, /item\?\.code !== 'weekly_wool_quota'/);
  assert.doesNotMatch(html, /每周羊毛额度/);
  assert.match(accountUi, /table\.hidden = !hasComparison/);
  assert.match(accountUi, /tabs\.hidden = vipTierCatalog\.length === 0/);
  assert.match(accountUi, /list\.hidden = plans\.length === 0/);
  assert.match(httpClient, /\/api\/vip\/plans/);
  assert.match(accountStyles, /\.vip-benefits-backdrop\s*\{[\s\S]*?background:\s*transparent;/);
  assert.doesNotMatch(accountStyles, /\.vip-benefits-backdrop\s*\{[\s\S]*?background:\s*rgba\(2,\s*6,\s*12/);
});

test('未登录个人中心不显示开通会员入口', () => {
  const html = read('src/app/sidebar/index.html');
  const accountUi = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js');

  assert.match(html, /id="account-vip-card"[^>]*\shidden(?:[\s=>]|$)/);
  assert.match(accountUi, /vipCard\.hidden = !authenticated/);
  assert.match(accountUi, /if \(!authenticated\) \{\s*closeVipBenefitsDialog\(\)/);
});
