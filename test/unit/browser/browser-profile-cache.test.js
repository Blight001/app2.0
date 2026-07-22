'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ProfileRuntimeStore } = require('../../../src/app/main/browser-runtime/profile-runtime-store');
const { buildBrowserProfileCacheKey } = require('../../../src/app/main/features/browser/browser-profile-cache');

test('浏览器 Profile 缓存键稳定且不会把代理凭据写入 fingerprint 文件', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-profile-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ProfileRuntimeStore({ rootDir: root });
  const settings = { language: { mode: 'ip' }, proxy: { password: 'secret' } };
  const key = buildBrowserProfileCacheKey(settings, 'http://127.0.0.1:7897');
  const profile = { region: 'jp', sourceIp: '203.0.113.8', timezoneId: 'Asia/Tokyo' };

  store.writeBrowserProfileCache('profile-a', key, profile);
  const fingerprint = fs.readFileSync(store.getProfilePaths('profile-a').fingerprint, 'utf8');

  assert.deepEqual(store.readBrowserProfileCache('profile-a', key), profile);
  assert.equal(store.readBrowserProfileCache('profile-a', `${key}-other`), null);
  assert.equal(fingerprint.includes('secret'), false);
});
