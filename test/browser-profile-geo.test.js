const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTabBrowserProfile } = require('../src/app/main/utils/browser-profile');

const silentLogger = {
  info() {},
  warn() {},
};

test('proxy exit detection accepts Cloudflare trace text and rejects direct-routed JSON endpoints', async () => {
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
        return {
          ok: true,
          body: null,
          raw: 'fl=1\nh=www.cloudflare.com\nip=103.62.49.178\nloc=JP\ncolo=NRT\n',
        };
      }
      return {
        ok: true,
        body: { ip: '220.195.204.135', country_code: 'CN' },
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
});
