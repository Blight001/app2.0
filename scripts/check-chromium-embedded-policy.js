'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const patchPath = path.join(
  root,
  'native',
  'chromium-fork',
  'patches',
  '0007-ai-free-embedded-window-lockdown.patch',
);
const patch = fs.readFileSync(patchPath, 'utf8');
const series = fs.readFileSync(
  path.join(root, 'native', 'chromium-fork', 'patches', 'series'),
  'utf8',
);
const nativeHost = fs.readFileSync(
  path.join(root, 'native', 'browser-host', 'src', 'child_window_manager.cc'),
  'utf8',
);

assert(series.includes('0007-ai-free-embedded-window-lockdown.patch'));
for (const marker of [
  'switches::kHsEmbedMode) == "child-window"',
  'return HTCLIENT;',
  'SetHasWindowSizeControls(false);',
  'close_button_->SetVisible(false);',
  'bool ShouldShowNewTabButton',
  'case IDC_NEW_TAB:',
  'case IDC_CLOSE_WINDOW:',
  'case IDC_MINIMIZE_WINDOW:',
  'case IDC_MAXIMIZE_WINDOW:',
  'void BrowserTabStripController::OnCloseTab',
  'bool IsAiFreeBlockedTabContextCommand',
  'void TabStrip::MaybeStartDrag',
]) {
  assert(patch.includes(marker), `embedded policy patch is missing: ${marker}`);
}

const patchedFiles = [...patch.matchAll(/^diff --git a\/(\S+) /gm)]
  .map((match) => match[1]);
assert(patchedFiles.length >= 8);
assert(!patchedFiles.some((file) =>
  file.startsWith('chrome/browser/extensions/api/tabs/') ||
  file.startsWith('extensions/browser/api/tabs/')),
'the embedded policy must not patch the chrome.tabs extension API');

for (const style of [
  'WS_POPUP',
  'WS_CAPTION',
  'WS_THICKFRAME',
  'WS_SYSMENU',
  'WS_MINIMIZEBOX',
  'WS_MAXIMIZEBOX',
  'WS_CHILD',
]) {
  assert(nativeHost.includes(style), `native host style policy is missing: ${style}`);
}

const automationManifest = JSON.parse(fs.readFileSync(
  path.join(root, 'src', 'assets', 'extensions', 'browser_automation', 'manifest.json'),
  'utf8',
));
assert(automationManifest.permissions.includes('tabs'));
const browserTools = fs.readFileSync(
  path.join(
    root,
    'src',
    'assets',
    'extensions',
    'browser_automation',
    'background',
    '10_browser_tools.js',
  ),
  'utf8',
);
assert(browserTools.includes('chrome.tabs.create('));

console.log('chromium embedded window policy checks passed');
