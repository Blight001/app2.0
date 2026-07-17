const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../src/app/main/ipc/register/license.js'),
  'utf8',
);

test('已打开的羊毛账号窗口会重新导航到本次平台网址', () => {
  const start = source.indexOf('const activeTab = launchAccountId');
  const end = source.indexOf('if (!launchAccount) {', start);
  const branch = source.slice(start, end);

  assert.match(branch, /await navigateDreamTab\(activeTab\.id, targetUrl\)/);
});

test('恢复历史 Chromium Profile 后仍导航到本次平台网址', () => {
  const start = source.indexOf('if (restorePersistedProfile) {');
  const end = source.indexOf('try {', start);
  const branch = source.slice(start, end);

  assert.match(branch, /await navigateDreamTab\(tabId, targetUrl\)/);
});

test('新羊毛账号把平台网址直接作为 Chromium 首次启动地址', () => {
  const start = source.indexOf('const tabId = await ui.addTab(targetUrl');
  const end = source.indexOf('if (restorePersistedProfile) {', start);
  const launch = source.slice(start, end);

  assert.match(launch, /deferChromiumNavigation:\s*false/);
});

test('羊毛平台导航拒绝服务器下发的非 HTTP 地址', () => {
  const start = source.indexOf('const navigateDreamTab = async');
  const end = source.indexOf('// 处理：importServerFetchedDreamAccount', start);
  const helper = source.slice(start, end);

  assert.match(helper, /\^https\?:\\\/\\\//i);
  assert.match(helper, /服务器下发的平台网址无效/);
});
