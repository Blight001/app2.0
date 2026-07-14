const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');

const { buildChromiumArgs } = require('../src/app/main/browser-runtime/chromium-launcher');
const {
  importDirectClashRuntimeConfig,
  normalizeClashMiniStartupConfig,
} = require('../src/app/main/ipc/register/clash-mini-core');

function createTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-mini-geo-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeGeoFixture(coreDir, missingProvider = '') {
  fs.mkdirSync(path.join(coreDir, 'providers'), { recursive: true });
  fs.writeFileSync(path.join(coreDir, 'geoip.metadb'), Buffer.alloc((1024 * 1024) + 1));
  fs.writeFileSync(path.join(coreDir, 'geosite.dat'), Buffer.alloc((1024 * 1024) + 1));
  for (const name of ['cn_ip.mrs', 'cn_domain.mrs', 'private_domain.mrs', 'geolocation-!cn.mrs']) {
    if (name !== missingProvider) fs.writeFileSync(path.join(coreDir, 'providers', name), name);
  }
}

function buildRemoteGeoConfig() {
  return {
    mode: 'rule',
    'geo-auto-update': true,
    'geox-url': {
      geoip: 'https://testingcf.jsdelivr.net/geoip.metadb',
      geosite: 'https://testingcf.jsdelivr.net/geosite.dat',
    },
    'rule-providers': {
      cn_ip: { type: 'http', behavior: 'ipcidr', format: 'mrs', url: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/cn.mrs', interval: 86400 },
      cn_domain: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs', interval: 86400 },
      private_domain: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/private.mrs', interval: 86400 },
      'geolocation-!cn': { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/geolocation-!cn.mrs', interval: 86400, proxy: 'DIRECT' },
      custom: { type: 'http', behavior: 'domain', url: 'https://example/custom.yaml' },
    },
    rules: [
      'RULE-SET,cn_domain,DIRECT',
      'GEOSITE,CN,DIRECT',
      'GEOIP,CN,DIRECT,no-resolve',
      'MATCH,节点选择',
    ],
  };
}

test('embedded Chromium disables autonomous background component downloads', () => {
  const args = buildChromiumArgs({
    paths: { chromiumData: 'profile', downloads: 'downloads' },
    runtimeProfileId: 'test-profile',
    pipeName: 'test-pipe',
    launchToken: 'test-token',
  });

  assert.ok(args.includes('--disable-background-networking'));
  assert.ok(args.includes('--disable-component-update'));
});

test('Chromium update domains are forced direct before subscription proxy rules', () => {
  const result = normalizeClashMiniStartupConfig({
    mode: 'rule',
    rules: [
      'DOMAIN-SUFFIX,gvt1.com,🚀节点选择',
      'DOMAIN,update.googleapis.com,🚀节点选择',
      'MATCH,🚀节点选择',
    ],
  });

  const gvtDirect = result.config.rules.indexOf('DOMAIN-SUFFIX,gvt1.com,DIRECT');
  const gvtProxy = result.config.rules.indexOf('DOMAIN-SUFFIX,gvt1.com,🚀节点选择');
  const updateDirect = result.config.rules.indexOf('DOMAIN,update.googleapis.com,DIRECT');
  const updateProxy = result.config.rules.indexOf('DOMAIN,update.googleapis.com,🚀节点选择');

  assert.ok(gvtDirect >= 0 && gvtDirect < gvtProxy);
  assert.ok(updateDirect >= 0 && updateDirect < updateProxy);
});

test('Clash Mini localizes Geo databases and known rule providers', (t) => {
  const coreDir = createTempDir(t);
  writeGeoFixture(coreDir);

  const result = normalizeClashMiniStartupConfig(buildRemoteGeoConfig(), coreDir);

  assert.equal(result.geoDatabaseAvailable, true);
  assert.equal(result.geoLocalized, true);
  assert.equal(result.providersLocalized, 4);
  assert.equal(result.config['geo-auto-update'], false);
  assert.equal('geox-url' in result.config, false);
  assert.equal(result.config.rules.at(-1), 'MATCH,节点选择');

  const expectedPaths = {
    cn_ip: './providers/cn_ip.mrs',
    cn_domain: './providers/cn_domain.mrs',
    private_domain: './providers/private_domain.mrs',
    'geolocation-!cn': './providers/geolocation-!cn.mrs',
  };
  for (const [name, expectedPath] of Object.entries(expectedPaths)) {
    const provider = result.config['rule-providers'][name];
    assert.equal(provider.type, 'file');
    assert.equal(provider.path, expectedPath);
    assert.equal(provider.format, 'mrs');
    assert.equal('url' in provider, false);
    assert.equal('interval' in provider, false);
    assert.equal('proxy' in provider, false);
  }
  assert.equal(result.config['rule-providers'].cn_ip.behavior, 'ipcidr');
  assert.equal(result.config['rule-providers'].cn_domain.behavior, 'domain');
  assert.equal(result.config['rule-providers'].custom.url, 'https://example/custom.yaml');
  assert.doesNotMatch(YAML.stringify(result.config), /jsdelivr|meta-rules-dat/i);
});

test('Clash Mini keeps a provider remote when its local asset is missing', (t) => {
  const coreDir = createTempDir(t);
  writeGeoFixture(coreDir, 'private_domain.mrs');

  const result = normalizeClashMiniStartupConfig(buildRemoteGeoConfig(), coreDir);
  const provider = result.config['rule-providers'].private_domain;

  assert.equal(result.providersLocalized, 3);
  assert.equal(provider.type, 'http');
  assert.match(provider.url, /meta-rules-dat@meta\/geo\/geosite\/private\.mrs/);
  assert.equal(provider.interval, 86400);
});

test('Clash Mini localizes a renamed provider by its known MetaCubeX source path', (t) => {
  const coreDir = createTempDir(t);
  writeGeoFixture(coreDir);
  const config = buildRemoteGeoConfig();
  config['rule-providers'].china_domains = {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    url: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs?cache=1',
    interval: 86400,
  };

  const result = normalizeClashMiniStartupConfig(config, coreDir);
  const provider = result.config['rule-providers'].china_domains;

  assert.equal(result.providersLocalized, 5);
  assert.deepEqual(provider, {
    behavior: 'domain',
    format: 'mrs',
    type: 'file',
    path: './providers/cn_domain.mrs',
  });
  assert.doesNotMatch(YAML.stringify(result.config), /jsdelivr|meta-rules-dat/i);
});

test('direct config import syncs bundled assets before applying the offline fallback', (t) => {
  const coreDir = createTempDir(t);
  fs.writeFileSync(path.join(coreDir, 'geoip.metadb'), 'truncated-cache');

  const imported = importDirectClashRuntimeConfig(coreDir, YAML.stringify(buildRemoteGeoConfig()), 'test');
  assert.equal(imported.ok, true);
  const generated = YAML.parse(imported.generatedContent);

  assert.ok(fs.statSync(path.join(coreDir, 'geoip.metadb')).size > 1024 * 1024);
  assert.ok(fs.statSync(path.join(coreDir, 'geosite.dat')).size > 1024 * 1024);
  assert.equal(generated['geo-auto-update'], false);
  assert.equal('geox-url' in generated, false);
  assert.equal(generated.rules.at(-1), 'MATCH,节点选择');
  assert.equal(generated['rule-providers'].cn_ip.type, 'file');
});
