const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('仅从 AI 控制切入浏览器配置时请求最新羊毛平台', () => {
  const source = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/tabs.js');

  assert.match(source, /previousPanelId === 'ai-control-panel' && panelId === 'ai-free-settings-panel'/);
  assert.match(source, /invoke\?\.\('refresh-wool-platforms'\)/);
  assert.match(source, /renderWoolPlatformButtons/);
});

test('羊毛平台刷新只发起一次验证请求并只更新羊毛平台缓存', () => {
  const source = read('src/app/main/ipc/register/license.js');
  const start = source.indexOf("ipc.handle('refresh-wool-platforms'");
  const end = source.indexOf('const cleanupAccountBrowserArtifacts', start);
  const handler = source.slice(start, end);

  assert.match(handler, /woolPlatformRefreshInFlight/);
  assert.match(handler, /httpClient\.validateKey\(key, deviceId\)/);
  assert.match(handler, /setRuntimeConfig\?\.\(\{ woolPlatforms \}\)/);
  assert.doesNotMatch(handler, /setValidationState|refreshAllowedPlatformsAndNotify/);
});

