const { readAiControlSource } = require('../helpers/source-bundles');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../../package.json');
const { resolveBindingCandidates } = require('../../src/app/main/browser-runtime/chromium-window-bridge');
const { assertStaticVCRuntime } = require('../../scripts/verify-packaged-runtime');

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

test('staged development app resolves the native browser host from the project root', () => {
  const projectRoot = path.resolve('D:/workspace/ai-free');
  const appRoot = path.join(projectRoot, '.generated', 'app');
  const candidates = resolveBindingCandidates({
    appRoot,
    resourcesPath: path.join(projectRoot, 'node_modules', 'electron', 'dist', 'resources'),
    workingDirectory: projectRoot,
  });

  assert.ok(candidates.includes(
    path.join(projectRoot, 'native', 'browser-host', 'build', 'Release', 'browser_host.node'),
  ));
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
  assert.ok(extraResources.some((entry) => (
    entry.from === 'resources/cursors/[CC] Handwrite v1.ani'
      && entry.to === 'cursors/[CC] Handwrite v1.ani'
  )));
});

test('native host has no external VC++ redistributable dependency', () => {
  assert.doesNotThrow(() => assertStaticVCRuntime(
    path.join(__dirname, '../../native/browser-host/build/Release/browser_host.node'),
  ));
  assert.match(packageJson.scripts.build, /build:native-host/);
  assert.match(packageJson.scripts['build:portable'], /build:native-host/);
});

test('sidebar logos use the runtime asset resolver in source and packaged apps', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/app/sidebar/index.html'), 'utf8');
  const appShell = fs.readFileSync(path.join(__dirname, '../../src/app/views/app-shell.html'), 'utf8');
  const logoResolver = fs.readFileSync(
    path.join(__dirname, '../../src/app/sidebar/client/scripts/logo-assets.js'),
    'utf8',
  );
  const aiControl = readAiControlSource();

  assert.ok(html.includes('<script src="./client/scripts/logo-assets.js"></script>'));
  assert.equal((html.match(/<img[^>]*data-app-logo/g) || []).length, 2);
  assert.ok(logoResolver.includes("const SOURCE_LOGO_PATH = '../../assets/logo.ico';"));
  assert.ok(logoResolver.includes("const PACKAGED_LOGO_PATH = '../../../../resource/logo.ico';"));
  assert.ok(aiControl.includes('window.aiFreeLogoAssets?.url'));
  assert.match(appShell, /id="account-center-btn"[\s\S]*?id="add-tab-btn"/);
  assert.ok(appShell.includes('../sidebar/client/scripts/logo-assets.js'));
});
