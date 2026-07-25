'use strict';

const workspaceType = window.env?.WORKSPACE_TYPE || '';
const coreScripts = [
  './client/scripts/control-panel.js',
  './client/app/side/controllers/pages/side-panel/tabs.js',
  './client/app/side/controllers/pages/automation/automation-flow-canvas.js',
  './client/app/side/controllers/pages/automation/automation-step-fields.js',
  './client/app/side/controllers/pages/automation/automation-card-transfer.js',
  './client/app/side/controllers/pages/automation/automation-card-editor.js',
  './client/app/side/controllers/pages/automation/automation-dialogs.js',
  './client/app/side/controllers/pages/automation/automation-flow-window.js',
  './client/app/side/controllers/pages/automation.js',
  '../shared/quota-display.js',
  './client/app/side/controllers/pages/ai-control.js',
  './client/app/side/controllers/pages/ai-control/ai-control-selection.js',
  './client/app/side/controllers/pages/ai-control/ai-control-server-device.js',
  './client/app/side/controllers/pages/ai-control/ai-control-prompt-diagnostics.js',
  './client/app/side/controllers/pages/ai-control/ai-control-selectors.js',
  './client/app/side/controllers/pages/ai-control/ai-control-card-selector.js',
  './client/app/side/controllers/pages/ai-control/ai-control-history-list.js',
  './client/app/side/controllers/pages/ai-control/ai-control-quick-launch.js',
  './client/app/side/controllers/pages/ai-control/ai-control-history-session.js',
  './client/app/side/controllers/pages/ai-control/ai-control-markdown.js',
  './client/app/side/controllers/pages/ai-control/ai-control-tool-display.js',
  './client/app/side/controllers/pages/ai-control/ai-control-messages.js',
  './client/app/side/controllers/pages/ai-control/ai-control-data-loaders.js',
  './client/app/side/controllers/pages/ai-control/ai-control-composer.js',
  './client/app/side/controllers/pages/ai-control/ai-control-bootstrap.js',
  './client/app/side/controllers/pages/side-panel/context-menu.js',
  '../renderer/controllers/shared/controller-utils.js',
  '../shared/version-utils.js',
  '../shared/message-utils.js',
  '../shared/server-message-utils.js',
  '../shared/text-preview-utils.js',
  './client/app/side/controllers/shared/message-modal.js',
  './client/app/side/controllers/shared/message-modal-server.js',
  './client/app/side/controllers/shared/message-modal-dialogs.js',
];

const browserScripts = [
  './client/app/side/controllers/pages/side-panel/modules/shared.js',
  './client/app/side/controllers/pages/side-panel/modules/connection-sync.js',
  './client/app/side/controllers/pages/side-panel/modules/account-auth.js',
  './client/app/side/controllers/pages/side-panel/modules/account-auth-vip-plans.js',
  './client/app/side/controllers/pages/side-panel/modules/account-auth-usage.js',
  './client/app/side/controllers/pages/side-panel/modules/account-auth-actions.js',
  './client/app/side/controllers/pages/side-panel/modules/account-auth-bindings.js',
  './client/app/side/controllers/pages/side-panel/modules/entry-links.js',
  './client/app/side/controllers/pages/side-panel/modules/region.js',
  './client/app/side/controllers/pages/side-panel/modules/vpn.js',
  './client/app/side/controllers/pages/side-panel/modules/vpn-config.js',
  './client/app/side/controllers/pages/side-panel/modules/vpn-selector.js',
  './client/app/side/controllers/pages/side-panel/modules/vpn-lifecycle.js',
  './client/app/side/controllers/pages/side-panel/modules/license.js',
  './client/app/side/controllers/pages/side-panel/modules/license-controls.js',
  './client/app/side/controllers/pages/side-panel/modules/announcements.js',
  './client/app/side/controllers/pages/side-panel/modules/browser-settings-history-view.js',
  './client/app/side/controllers/pages/side-panel/modules/browser-settings-validation.js',
  './client/app/side/controllers/pages/side-panel/modules/browser-settings-form.js',
  './client/app/side/controllers/pages/side-panel/modules/browser-settings-bindings.js',
  './client/app/side/controllers/pages/side-panel/modules/browser-settings.js',
  './client/app/side/controllers/pages/side-panel/modules/init-core.js',
  './client/app/side/controllers/pages/side-panel/modules/init-bindings.js',
  './client/app/side/controllers/pages/side-panel/modules/init-runtime.js',
  './client/app/side/controllers/pages/side-panel/modules/bootstrap.js',
  './client/app/side/controllers/pages/side-panel/index.js',
  './client/app/side/controllers/pages/side-panel/dream-opener.js',
];

const scripts = [...coreScripts];
if (workspaceType !== 'browser') {
  scripts.splice(3, 0, './client/app/side/controllers/pages/software-settings.js');
}
if (workspaceType !== 'software') scripts.push(...browserScripts);

for (const source of scripts) {
  document.write(`<script src="${source}"><\/script>`);
}
