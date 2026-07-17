const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('点击使用教程前向服务器刷新教程地址并回退到本地缓存', () => {
  const source = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/entry-links.js');
  const refreshIndex = source.indexOf("invoke('refresh-tutorial-url')");
  const fallbackIndex = source.indexOf("invoke('get-tutorial-url')");

  assert.ok(refreshIndex >= 0);
  assert.ok(fallbackIndex > refreshIndex);
  assert.match(source, /refreshed\?\.ok === true && refreshedUrl/);
});

test('教程地址刷新接口只更新教程缓存并合并并发请求', () => {
  const source = read('src/app/main/ipc/register/license.js');
  const start = source.indexOf("ipc.handle('refresh-tutorial-url'");
  const end = source.indexOf('const cleanupAccountBrowserArtifacts', start);
  const handler = source.slice(start, end);

  assert.match(handler, /tutorialUrlRefreshInFlight/);
  assert.match(handler, /httpClient\.getTutorialUrl\(\)/);
  assert.match(handler, /httpClient\.validateKey\(key, deviceId\)/);
  assert.match(handler, /setRuntimeConfig\?\.\(\{ tutorialUrl \}\)/);
  assert.doesNotMatch(handler, /setValidationState|setRuntimeConfig\?\.\(\{[^}]*woolPlatforms/);
});

test('初始教程地址通过公开服务接口刷新且不依赖登录', () => {
  const client = read('src/app/main/lib/http-client.js');
  const misc = read('src/app/main/ipc/register/misc.js');

  assert.match(client, /async getTutorialUrl\(\)/);
  assert.match(client, /path: '\/api\/get_tutorial_url'/);
  assert.match(misc, /httpClient\.getTutorialUrl\(\)/);
  assert.match(misc, /await ui\.syncTutorialTabUrl\(tutorialUrl\)/);
});

test('运行时配置刷新会同步已打开的教程页', () => {
  // 阶段 2D-3：刷新逻辑迁至 composition/create-refresh-platforms.js
  const source = read('src/app/main/composition/create-refresh-platforms.js');
  const start = source.indexOf('async function refreshAllowedPlatformsAndNotify');
  assert.ok(start >= 0);
  const refresh = source.slice(start);

  assert.match(refresh, /await syncTutorialTabUrl\(tutorialUrl\)/);
});

test('软件启动时先拉取公开教程地址再创建教程 Chromium', () => {
  const source = read('src/app/main/services/app-shell.js');
  const fetchIndex = source.indexOf('await refreshRuntimeUrls();');
  const openIndex = source.indexOf("await resolveOpenTutorialTab()('',");

  assert.ok(fetchIndex >= 0);
  assert.ok(openIndex > fetchIndex);
  assert.match(source, /licenseCache\?\.setRuntimeConfig\?\.\(\{ tutorialUrl \}\)/);
});
