'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('software no longer exposes a WebContentsView extension panel', () => {
  const sources = [
    'src/app/main/services/extension-manager.js',
    'src/app/main/services/tab-manager.js',
    'src/app/main/services/app-shell.js',
    'src/app/main/ipc/register/extensions.js',
    'src/app/main/ipc/register/ui.js',
    'src/app/main/bootstrap.js',
  ].map(read).join('\n');

  for (const legacyName of [
    'webPanel',
    'openExtensionPopup',
    'openExtensionOptions',
    'open-extension-popup',
    'open-extension-options',
    'close-extension-web-panel',
    'syncWebPanelBounds',
    'extension-web-panel-closed',
  ]) {
    assert.equal(sources.includes(legacyName), false, `legacy extension UI remains: ${legacyName}`);
  }

  const extensionManager = read('src/app/main/services/extension-manager.js');
  assert.equal(extensionManager.includes('WebContentsView'), false);
  assert.match(extensionManager, /function getEnabledExtensionPaths\(\)/);
});

test('sidebar only lists and toggles Chromium-injected plugins', () => {
  const html = read('src/app/sidebar/index.html');
  const controller = read('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/feature-toggles.js');

  assert.match(html, /浏览器插件（自动注入）/);
  assert.match(controller, /invoke\('get-extension-manager-state'\)/);
  assert.match(controller, /invoke\('set-extension-enabled'/);
  assert.match(html, /id="import-extension-plugin"/);
  assert.match(controller, /invoke\('import-extension-plugin'/);
  assert.doesNotMatch(controller, /open-extension-(?:popup|options)/);
});

test('custom unpacked extensions can be imported and remain in manager state', () => {
  const extensionManager = read('src/app/main/services/extension-manager.js');
  const ipc = read('src/app/main/ipc/register/extensions.js');
  assert.match(extensionManager, /async function importPlugin\(sourcePath\)/);
  assert.match(extensionManager, /plugin\.builtin === true \|\| seenIds\.has\(plugin\.id\)/);
  assert.match(ipc, /ipcMain\.handle\('import-extension-plugin'/);
  assert.match(ipc, /properties: \['openDirectory'\]/);
});
