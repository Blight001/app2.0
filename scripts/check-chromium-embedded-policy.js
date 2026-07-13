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
const omniboxPatch = fs.readFileSync(path.join(
  root,
  'native',
  'chromium-fork',
  'patches',
  '0009-ai-free-embedded-omnibox-read-only.patch',
), 'utf8');
const toolbarPatch = fs.readFileSync(path.join(
  root,
  'native',
  'chromium-fork',
  'patches',
  '0010-ai-free-embedded-toolbar-simplification.patch',
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
assert(series.includes('0009-ai-free-embedded-omnibox-read-only.patch'));
assert(series.includes('0010-ai-free-embedded-toolbar-simplification.patch'));
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

assert(popupPatch.includes('chrome/browser/ui/views/extensions/extension_popup.cc'));
assert(popupPatch.includes('set_close_on_deactivate('));
assert(popupPatch.includes('switches::kHsEmbedMode) == "child-window"'));
assert(!popupPatch.includes('set_close_on_deactivate(true)'));
assert(popupPatch.includes('toolbar_action_hover_card_controller.cc'));
assert(popupPatch.includes('embedded_hover_exit_watchdog_.Start('));
assert(popupPatch.includes('Screen::Get()->GetCursorScreenPoint()'));
assert(popupPatch.includes('GetBoundsInScreen().Contains(cursor)'));

for (const marker of [
  'SetReadOnly(true);',
  'case IDC_OPEN_CURRENT_URL:',
  'case IDC_FOCUS_LOCATION:',
  'case IDC_FOCUS_SEARCH:',
  'command_id == IDC_PASTE_AND_GO',
  'if (GetReadOnly()) {',
  'return ui::mojom::DragOperation::kNone;',
  '!omnibox_view_->GetReadOnly()',
]) {
  assert(omniboxPatch.includes(marker), `omnibox policy patch is missing: ${marker}`);
}
const omniboxPatchedFiles = [...omniboxPatch.matchAll(/^diff --git a\/(\S+) /gm)]
  .map((match) => match[1]);
assert(!omniboxPatchedFiles.some((file) =>
  file.startsWith('chrome/browser/extensions/api/tabs/') ||
  file.startsWith('extensions/browser/api/tabs/')),
'the omnibox policy must not patch the chrome.tabs extension API');

for (const marker of [
  'ToolbarActionsModel::GetFilteredPinnedActionIds() const',
  'return std::vector<ActionId>(action_ids_.begin(), action_ids_.end());',
  'ToolbarActionsModel::SetActionVisibility',
  'HideAiFreeEmbeddedLocationBarContents(this);',
  'child->SetVisible(false);',
  'SetCanProcessEventsWithinSubtree(false);',
  'SetBackground(nullptr);',
  'show_avatar_toolbar_button = false;',
  'bool IsWebUIAvatarButtonEnabled()',
  'bool IsWebUILocationBarEnabled()',
]) {
  assert(toolbarPatch.includes(marker), `toolbar simplification patch is missing: ${marker}`);
}
for (const forbiddenMarker of [
  'child->SetBoundsRect(gfx::Rect());',
  'omnibox_view_->SetBoundsRect(location_bounds);',
  'return GetMinimumSize();',
]) {
  assert(!toolbarPatch.includes(forbiddenMarker),
    `toolbar simplification patch contains unstable layout logic: ${forbiddenMarker}`);
}
const toolbarPatchedFiles = [...toolbarPatch.matchAll(/^diff --git a\/(\S+) /gm)]
  .map((match) => match[1]);
assert.deepEqual(toolbarPatchedFiles, [
  'chrome/browser/ui/toolbar/toolbar_actions_model.cc',
  'chrome/browser/ui/ui_features.cc',
  'chrome/browser/ui/views/location_bar/location_bar_view.cc',
  'chrome/browser/ui/views/toolbar/toolbar_view.cc',
]);

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
