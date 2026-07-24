const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTabBrowserProfile } = require('../../src/app/main/utils/browser-profile');
const { normalizeAiFreeBrowserSettings } = require('../../src/app/main/utils/ai-free-browser-settings');

test('profile uses injected exitIp without remote geo probe', async () => {
  let httpCalled = false;
  const profile = await resolveTabBrowserProfile({
    browserSettings: normalizeAiFreeBrowserSettings({
      language: { mode: 'custom', value: 'ja-JP' },
      timezone: { mode: 'custom', value: 'Asia/Tokyo' },
      exitIp: {
        ip: '103.62.49.178',
        region: 'jp',
        countryCode: 'JP',
        country: 'Japan',
        city: 'Tokyo',
        timezoneId: 'Asia/Tokyo',
      },
    }),
    httpGetUniversal: async () => {
      httpCalled = true;
      throw new Error('geo probe must not run');
    },
    forceGeoLookup: true,
    geoProxyServer: 'http://127.0.0.1:17890',
  });

  assert.equal(httpCalled, false);
  assert.equal(profile.region, 'jp');
  assert.equal(profile.sourceIp, '103.62.49.178');
  assert.equal(profile.sourceCountryCode, 'JP');
  assert.equal(profile.geoEndpoint, 'settings.exitIp');
  assert.equal(profile.timezoneId, 'Asia/Tokyo');
  assert.equal(profile.locale, 'ja-JP');
  assert.notEqual(profile.proxyExitVerified, false);
});

test('without exitIp falls back to locale region and leaves sourceIp empty', async () => {
  const profile = await resolveTabBrowserProfile({
    browserSettings: normalizeAiFreeBrowserSettings({
      language: { mode: 'custom', value: 'zh-CN' },
      timezone: { mode: 'custom', value: 'Asia/Shanghai' },
    }),
    httpGetUniversal: async () => {
      throw new Error('geo probe must not run');
    },
  });

  assert.equal(profile.region, 'cn');
  assert.equal(profile.sourceIp, '');
  assert.equal(profile.locale, 'zh-CN');
  assert.equal(profile.timezoneId, 'Asia/Shanghai');
});

test('legacy language mode ip is normalized to custom', () => {
  const settings = normalizeAiFreeBrowserSettings({
    language: { mode: 'ip', value: 'en-US' },
    timezone: { mode: 'ip', value: 'America/New_York' },
    geolocation: { mode: 'ip', longitude: 1, latitude: 2, accuracy: 50 },
  });
  assert.equal(settings.language.mode, 'custom');
  assert.equal(settings.timezone.mode, 'custom');
  assert.equal(settings.geolocation.mode, 'custom');
  assert.equal(settings.language.value, 'en-US');
  assert.equal(settings.exitIp.ip, '');
});
