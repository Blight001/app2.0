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
const popupPatch = fs.readFileSync(path.join(
  root,
  'native',
  'chromium-fork',
  'patches',
  '0008-ai-free-extension-popup-auto-dismiss.patch',
), 'utf8');
const pinnedActionsPatch = fs.readFileSync(path.join(
  root,
  'native',
  'chromium-fork',
  'patches',
  '0011-ai-free-embedded-extension-actions-pinned.patch',
), 'utf8');
const timezonePatch = fs.readFileSync(path.join(
  root,
  'native',
  'chromium-fork',
  'patches',
  '0012-ai-free-profile-timezone.patch',
), 'utf8');
const series = fs.readFileSync(
  path.join(root, 'native', 'chromium-fork', 'patches', 'series'),
  'utf8',
);
const nativeHost = fs.readFileSync(
  path.join(root, 'native', 'browser-host', 'src', 'child_window_manager.cc'),
  'utf8',
);

assert(series.includes('0007-ai-free-embedded-window-lockdown.patch'));
assert(series.includes('0008-ai-free-extension-popup-auto-dismiss.patch'));
assert(series.includes('0011-ai-free-embedded-extension-actions-pinned.patch'));
assert(series.includes('0012-ai-free-profile-timezone.patch'));
assert(!series.includes('0009-ai-free-embedded-omnibox-read-only.patch'));
assert(!series.includes('0010-ai-free-embedded-toolbar-simplification.patch'));
for (const marker of [
  'switches::kHsEmbedMode) == "child-window"',
  'return HTCLIENT;',
  'SetHasWindowSizeControls(false);',
  'close_button_->SetVisible(false);',
  'case IDC_CLOSE_WINDOW:',
  'case IDC_MINIMIZE_WINDOW:',
  'case IDC_MAXIMIZE_WINDOW:',
]) {
  assert(patch.includes(marker), `embedded policy patch is missing: ${marker}`);
}

for (const restoredMarker of [
  'case IDC_NEW_WINDOW:',
  'case IDC_NEW_INCOGNITO_WINDOW:',
  'case IDC_NEW_TAB:',
  'case IDC_NEW_TAB_TO_RIGHT:',
  'case IDC_CLOSE_TAB:',
  'bool ShouldShowNewTabButton',
  'bool IsAiFreeBlockedTabContextCommand',
  'void BrowserTabStripController::OnCloseTab',
  'void TabStrip::MaybeStartDrag',
]) {
  assert(!patch.includes(restoredMarker),
    `embedded policy still disables restored browser UI: ${restoredMarker}`);
}

const patchedFiles = [...patch.matchAll(/^diff --git a\/(\S+) /gm)]
  .map((match) => match[1]);
assert.deepEqual(patchedFiles, [
  'chrome/browser/ui/browser_command_controller.cc',
  'chrome/browser/ui/views/frame/browser_caption_button_container_win.cc',
  'chrome/browser/ui/views/frame/browser_view.cc',
]);
assert(!patchedFiles.some((file) =>
  file.startsWith('chrome/browser/extensions/api/tabs/') ||
  file.startsWith('extensions/browser/api/tabs/')),
'the embedded policy must not patch the chrome.tabs extension API');

assert(popupPatch.includes('chrome/browser/ui/views/extensions/extension_popup.cc'));
assert(popupPatch.includes('set_close_on_deactivate('));
assert(popupPatch.includes('switches::kHsEmbedMode) == "child-window"'));
assert(!popupPatch.includes('set_close_on_deactivate(true)'));
assert(popupPatch.includes('toolbar_action_hover_card_controller.cc'));
assert(popupPatch.includes('embedded_hover_exit_watchdog_.Start('));
assert(popupPatch.includes('Screen::Get()->GetCursorScreenPoint()'));
assert(popupPatch.includes('GetBoundsInScreen().Contains(cursor)'));

for (const marker of [
  'ToolbarActionsModel::SetActionVisibility',
  'ToolbarActionsModel::GetFilteredPinnedActionIds() const',
  'return std::vector<ActionId>(action_ids_.begin(), action_ids_.end());',
  'switches::kHsEmbedMode) == "child-window"',
]) {
  assert(pinnedActionsPatch.includes(marker),
    `default-pinned extension patch is missing: ${marker}`);
}
const pinnedActionPatchedFiles = [
  ...pinnedActionsPatch.matchAll(/^diff --git a\/(\S+) /gm),
].map((match) => match[1]);
assert.deepEqual(pinnedActionPatchedFiles, [
  'chrome/browser/ui/toolbar/toolbar_actions_model.cc',
]);
for (const forbiddenMarker of [
  'HideAiFreeEmbeddedLocationBarContents',
  'SetCanProcessEventsWithinSubtree(false)',
  'IsWebUILocationBarEnabled',
]) {
  assert(!pinnedActionsPatch.includes(forbiddenMarker),
    `default-pinned extension patch must not alter the address bar: ${forbiddenMarker}`);
}

for (const marker of [
  'hs-timezone-id',
  'String::FromUtf8(base::as_byte_span(timezone_id))',
  'g_command_line_timezone_override',
]) {
  assert(timezonePatch.includes(marker), `timezone patch is missing: ${marker}`);
}

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
