const test = require('node:test');
const assert = require('node:assert/strict');

const { buildChromiumArgs } = require('../src/app/main/browser-runtime/chromium-launcher');
const { normalizeClashMiniStartupConfig } = require('../src/app/main/ipc/register/clash-mini-core');

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
