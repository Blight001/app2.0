const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');
const { resolveBindingCandidates } = require('../src/app/main/browser-runtime/chromium-window-bridge');

test('packaged native browser host resolves from external resources first', () => {
  const resourcesPath = path.resolve('C:/AI-FREE/resources');
  const appRoot = path.join(resourcesPath, 'app.asar');
  const candidates = resolveBindingCandidates({ resourcesPath, appRoot });

  assert.equal(
    candidates[0],
    path.join(resourcesPath, 'native', 'browser-host', 'browser_host.node'),
  );
  assert.ok(candidates.indexOf(path.join(appRoot, 'native', 'browser-host', 'build', 'Release', 'browser_host.node')) > 0);
});

test('native host and runtime logo are packaged only as external resources', () => {
  const files = packageJson.build.files || [];
  const extraResources = packageJson.build.extraResources || [];

  assert.equal(files.includes('native/browser-host/build/Release/browser_host.node'), false);
  assert.ok(files.includes('!src/assets/logo.ico'));
  assert.ok(extraResources.some((entry) => (
    entry.from === 'native/browser-host/build/Release/browser_host.node'
      && entry.to === 'native/browser-host/browser_host.node'
  )));
  assert.ok(extraResources.some((entry) => (
    entry.from === 'src/assets/logo.ico' && entry.to === 'resource/logo.ico'
  )));
});

test('sidebar logos use the runtime asset resolver in source and packaged apps', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/app/sidebar/index.html'), 'utf8');
  const appShell = fs.readFileSync(path.join(__dirname, '../src/app/views/app-shell.html'), 'utf8');
  const logoResolver = fs.readFileSync(
    path.join(__dirname, '../src/app/sidebar/client/scripts/logo-assets.js'),
    'utf8',
  );
  const aiControl = fs.readFileSync(
    path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/ai-control.js'),
    'utf8',
  );

  assert.ok(html.includes('<script src="./client/scripts/logo-assets.js"></script>'));
  assert.equal((html.match(/<img[^>]*data-app-logo/g) || []).length, 3);
  assert.ok(logoResolver.includes("const SOURCE_LOGO_PATH = '../../assets/logo.ico';"));
  assert.ok(logoResolver.includes("const PACKAGED_LOGO_PATH = '../../../../resource/logo.ico';"));
  assert.ok(aiControl.includes('window.aiFreeLogoAssets?.url'));
  assert.match(appShell, /id="account-center-btn"[\s\S]*?id="add-tab-btn"/);
  assert.ok(appShell.includes('../sidebar/client/scripts/logo-assets.js'));
});
