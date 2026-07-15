const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('empty wool platform list is not rebuilt from cached platform defaults', () => {
  const source = read('src/app/main/ipc/register/misc.js');
  const start = source.indexOf("ipcMain.handle('get-wool-platforms'");
  const end = source.indexOf("ipcMain.handle('get-tutorial-url'", start);
  const handler = source.slice(start, end);

  assert.match(handler, /return woolPlatforms;/);
  assert.doesNotMatch(handler, /runtimeConfig\.platformName|runtimeConfig\.targetUrl|DREAM_TARGET_URL/);
});

test('empty wool platform list removes and hides launch buttons', () => {
  const source = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/connection-sync.js');
  const start = source.indexOf('function renderWoolPlatformButtons');
  const end = source.indexOf('function setTutorialLinkHref', start);
  const renderer = source.slice(start, end);

  assert.match(renderer, /container\.innerHTML = '';/);
  assert.match(renderer, /container\.hidden = items\.length === 0;/);
  assert.doesNotMatch(renderer, /暂无可用羊毛平台/);
});

test('initial empty list is rendered instead of leaving stale buttons', () => {
  const source = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/connection-sync.js');
  const start = source.indexOf('async function refreshWoolPlatforms');
  const end = source.indexOf('async function refreshTutorialUrl', start);
  const refresh = source.slice(start, end);

  assert.match(refresh, /renderWoolPlatformButtons\(Array\.isArray\(woolPlatforms\) \? woolPlatforms : \[\]\);/);
  assert.doesNotMatch(refresh, /woolPlatforms\.length > 0/);
});
