'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const storeUtilsPath = require.resolve('../../../src/app/main/ipc/register/store-utils');
const historyPath = require.resolve('../../../src/app/main/features/browser/browser-history-service');
const targetPath = require.resolve('../../../src/app/main/features/browser/register-browser-settings-ipc');

const store = { aiFreeBrowserSettings: { language: { mode: 'custom', value: 'en-US' } } };
const written = [];

require.cache[storeUtilsPath] = {
  exports: {
    readStoreConfigSafe: () => store,
    writeStoreConfigSafe: (next) => {
      written.push(next);
      Object.assign(store, next);
      return true;
    },
  },
};
require.cache[historyPath] = {
  exports: {
    syncOpenTabsToBrowserHistory: () => [],
    writeBrowserHistorySafe: () => true,
  },
};
delete require.cache[targetPath];
const { setBrowserExitIp } = require(targetPath);

test('setBrowserExitIp merges exitIp into default settings and applies to active tab', async () => {
  const applied = [];
  const result = await setBrowserExitIp(
    {
      ui: {
        getActiveTabId: () => 'tab-1',
        setTabBrowserSettings: async (tabId, settings, options) => {
          applied.push({ tabId, settings, options });
          return { ok: true, applied: true };
        },
        sendToSide() {},
      },
      licenseCache: { setRuntimeConfig() {} },
    },
    { exitIp: { ip: '198.51.100.10', region: 'us', countryCode: 'US' } },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.settings.exitIp.ip, '198.51.100.10');
  assert.equal(result.data.settings.exitIp.region, 'us');
  assert.equal(result.data.settings.exitIp.countryCode, 'US');
  assert.equal(written.length, 1);
  assert.equal(applied[0].tabId, 'tab-1');
  assert.equal(applied[0].settings.exitIp.ip, '198.51.100.10');
});
