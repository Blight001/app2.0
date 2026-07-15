const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTabBrowserProfile } = require('../src/app/main/utils/browser-profile');
const fs = require('node:fs');
const path = require('node:path');

const silentLogger = {
  info() {},
  warn() {},
};

test('proxy exit detection waits for authoritative Cloudflare trace instead of faster direct-routed JSON', async () => {
  const proxyServer = 'http://127.0.0.1:17890';
  const requests = [];
  const profile = await resolveTabBrowserProfile({
    browserSettings: {},
    geoProxyServer: proxyServer,
    forceGeoLookup: true,
    logger: silentLogger,
    httpGetUniversal: async (endpoint, timeoutMs, options = {}) => {
      requests.push({ endpoint, timeoutMs, options });
      if (!options.proxyServer) {
        return {
          ok: true,
          body: { ip: '220.195.204.135', country_code: 'CN' },
        };
      }
      if (endpoint.includes('/cdn-cgi/trace')) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          ok: true,
          body: null,
          raw: 'fl=1\nh=www.cloudflare.com\nip=103.62.49.178\nloc=JP\ncolo=NRT\n',
        };
      }
      return {
        ok: true,
        // 模拟直连服务因 IPv4/IPv6 或运营商出口轮换而与基线 IP 不完全相同。
        // 旧的并发抢答方案会把它误收为有效的中国代理出口。
        body: { ip: '220.195.204.136', country_code: 'CN' },
      };
    },
  });

  assert.equal(profile.region, 'jp');
  assert.equal(profile.sourceIp, '103.62.49.178');
  assert.equal(profile.sourceCountryCode, 'JP');
  assert.equal(profile.geoEndpoint, 'https://www.cloudflare.com/cdn-cgi/trace');
  assert.equal(profile.timezoneId, 'Asia/Tokyo');

  const traceRequests = requests.filter((request) => request.endpoint.includes('/cdn-cgi/trace'));
  assert.equal(traceRequests.length, 2);
  assert.ok(traceRequests.every((request) => request.options.headers.Accept.includes('text/plain')));
  assert.ok(traceRequests.every((request) => request.options.headers['Cache-Control'] === 'no-cache'));
  assert.equal(
    requests.filter((request) => request.options.proxyServer && !request.endpoint.includes('/cdn-cgi/trace')).length,
    0,
    'Cloudflare 成功后不应再让备用服务参与抢答',
  );
});

test('background profile refresh bypasses stale direct cache after a system proxy change', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/app/main/services/tab-manager.js'),
    'utf8',
  );
  assert.match(
    source,
    /function refreshBrowserProfileInBackground[\s\S]*?forceGeoLookup:\s*true/,
  );
});

test('proxy detection rejects a rotating Chinese ISP IP as an unready proxy exit', async () => {
  const profile = await resolveTabBrowserProfile({
    browserSettings: {},
    geoProxyServer: 'http://127.0.0.1:17891',
    forceGeoLookup: true,
    logger: silentLogger,
    httpGetUniversal: async (_endpoint, _timeoutMs, options = {}) => ({
      ok: true,
      body: options.proxyServer
        ? { ip: '220.195.204.194', country_code: 'CN' }
        : { ip: '220.195.204.135', country_code: 'CN' },
    }),
  });

  assert.equal(profile.region, 'cn');
  assert.equal(profile.proxyExitVerified, false);
  assert.match(profile.regionLabel, /代理未改变出口/);
  assert.notEqual(profile.sourceIp, '220.195.204.194');
});

test('automatic and manual node switches force a browser geo refresh', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/app/main/ipc/register/clash-mini-actions.js'),
    'utf8',
  );
  const refreshCalls = source.match(/applyClashMiniBrowserProxy\(true,\s*\{\s*forceProfileRefresh:\s*true/g) || [];
  assert.equal(refreshCalls.length, 2);
});

test('a failed forced proxy profile refresh cannot restart Chromium with the direct fallback region', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/app/main/services/tab-manager.js'),
    'utf8',
  );
  assert.match(source, /resolvedProfile\.proxyExitVerified !== false/);
  assert.match(source, /if \(!proxyChanged && !runtimeProfileChanged\)/);
  assert.doesNotMatch(
    source,
    /runtimeProfileChanged\s*=\s*\[[^\]]*sourceIp/,
    '同地区出口 IP 轮换不应重启整个 Chromium',
  );
});
