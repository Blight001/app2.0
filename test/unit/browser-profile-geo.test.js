'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTabBrowserProfile } = require('../../src/app/main/utils/browser-profile');

test('BrowserProfile never requests exit IP data, including for legacy automatic modes', async () => {
  let requestCount = 0;
  const profile = await resolveTabBrowserProfile({
    browserSettings: {
      locale: 'ja-JP',
      language: { mode: 'ip' },
      timezone: { mode: 'ip' },
      geolocation: { mode: 'ip' },
    },
    // 保留旧调用参数以覆盖兼容输入；解析器必须完全忽略探测依赖。
    geoProxyServer: 'http://127.0.0.1:17890',
    forceGeoLookup: true,
    httpGetUniversal: async () => {
      requestCount += 1;
      throw new Error('exit IP detection has been removed');
    },
  });

  assert.equal(requestCount, 0);
  assert.equal(profile.region, 'jp');
  assert.equal(profile.locale, 'ja-JP');
  assert.equal(profile.timezoneId, 'Asia/Tokyo');
  assert.equal(profile.sourceIp, '');
  assert.equal(profile.sourceCountryCode, '');
  assert.equal(profile.geoEndpoint, '');
  assert.equal(profile.fingerprintSettings.geolocation.resolvedFromIp, undefined);
});

test('explicit BrowserProfile identity remains authoritative without IP detection', async () => {
  const profile = await resolveTabBrowserProfile({
    browserSettings: {
      region: 'cn',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      language: { mode: 'custom', value: 'zh-CN' },
      timezone: { mode: 'custom', value: 'Asia/Shanghai' },
      geolocation: { mode: 'custom', longitude: 121.47, latitude: 31.23 },
    },
  });

  assert.equal(profile.region, 'cn');
  assert.equal(profile.locale, 'zh-CN');
  assert.equal(profile.timezoneId, 'Asia/Shanghai');
  assert.equal(profile.fingerprintSettings.geolocation.longitude, 121.47);
  assert.equal(profile.fingerprintSettings.geolocation.latitude, 31.23);
});

test('unsupported locale falls back without starting a network request', async () => {
  let requested = false;
  const profile = await resolveTabBrowserProfile({
    browserSettings: { locale: 'es-ES' },
    httpGetUniversal: async () => { requested = true; },
  });

  assert.equal(requested, false);
  assert.equal(profile.region, 'us');
  assert.equal(profile.locale, 'es-ES');
});
