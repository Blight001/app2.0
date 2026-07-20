'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeValidationRuntimeConfig } = require('../../../src/app/main/features/account/validation-runtime-config');

test('validation runtime config merges nested results and wire aliases', () => {
  const result = normalizeValidationRuntimeConfig({
    result: { allowed_platforms: ['one', ''], address_HTTP: ' https://server.test/ ' },
    platform_name: 'one', target_url: 'https://target.test', tutorialUrl: 'https://tutorial.test',
    wool_platforms: [
      { platform_name: 'wool', target_url: 'https://wool.test', quota: { remaining: 1 } },
      { name: 'invalid' },
    ],
  });
  assert.equal(result.platformName, 'one');
  assert.deepEqual(result.allowedPlatforms, ['one']);
  assert.equal(result.woolPlatforms[0].platform, 'wool');
  assert.equal(result.serverBase, 'https://server.test/');
  assert.equal(result.targetUrl, 'https://target.test');
});

test('validation runtime config derives allowed platform and handles invalid lists', () => {
  const result = normalizeValidationRuntimeConfig({ platformName: 'fallback', allowedPlatforms: 'invalid', woolPlatforms: null });
  assert.deepEqual(result.allowedPlatforms, ['fallback']);
  assert.deepEqual(result.woolPlatforms, []);
  assert.equal(normalizeValidationRuntimeConfig(null).platformName, '');
});
