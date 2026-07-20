'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function readFiles(relativePaths) {
  return relativePaths.map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n');
}

function readAiControlSource() {
  const base = 'src/app/sidebar/client/app/side/controllers/pages';
  return readFiles([
    `${base}/ai-control.js`,
    `${base}/ai-control/ai-control-selection.js`,
    `${base}/ai-control/ai-control-selectors.js`,
    `${base}/ai-control/ai-control-card-selector.js`,
    `${base}/ai-control/ai-control-history-list.js`,
    `${base}/ai-control/ai-control-history-session.js`,
    `${base}/ai-control/ai-control-markdown.js`,
    `${base}/ai-control/ai-control-tool-display.js`,
    `${base}/ai-control/ai-control-messages.js`,
    `${base}/ai-control/ai-control-data-loaders.js`,
    `${base}/ai-control/ai-control-composer.js`,
    `${base}/ai-control/ai-control-bootstrap.js`,
  ]);
}

const splitSourceFiles = {
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js': [
    'account-auth.js', 'account-auth-vip-plans.js', 'account-auth-usage.js',
    'account-auth-actions.js', 'account-auth-bindings.js',
  ],
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/license.js': [
    'license.js', 'license-controls.js',
  ],
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/vpn.js': [
    'vpn.js', 'vpn-config.js', 'vpn-selector.js', 'vpn-lifecycle.js',
  ],
  'src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/browser-settings.js': [
    'browser-settings-history-view.js', 'browser-settings-validation.js', 'browser-settings.js',
  ],
  'src/app/sidebar/client/app/side/controllers/shared/message-modal.js': [
    'message-modal.js', 'message-modal-server.js', 'message-modal-dialogs.js',
  ],
  'src/assets/extensions/browser_automation/background/02_sidebar_page.js': [
    '02_sidebar_page.js', '02_sidebar_actions.js', '02_sidebar_wait.js',
  ],
  'src/assets/extensions/browser_automation/background/09_agent_socket.js': [
    '09_agent_socket.js', '09_agent_protocol.js', '09_agent_transport.js',
    '09_agent_tasks.js', '09_agent_runtime.js',
  ],
  'src/assets/extensions/browser_automation/background/06_automation_run.js': [
    '06_automation_run.js', '06_run_context.js', '06_run_step_handlers.js',
    '06_run_action_handlers.js', '06_run_loop.js', '06_run_capture.js',
    '06_run_lifecycle.js',
  ],
  'src/assets/extensions/browser_automation/popup/automation-workbench.js': [
    'automation-workbench.js', 'automation-workbench-progress.js',
    'automation-workbench-flow-layout.js', 'automation-workbench-flow-canvas.js',
    'automation-workbench-flow-events.js', 'automation-workbench-selector.js',
    'automation-workbench-step-editor.js', 'automation-workbench-storage.js',
    'automation-workbench-cache.js',
  ],
  'src/assets/extensions/browser_automation/popup/bindings.js': [
    'bindings.js', 'bindings-card-data.js', 'bindings-cache.js',
    'bindings-editor.js', 'bindings-flow.js',
  ],
  'src/assets/extensions/browser_automation/popup/automation-flow.js': [
    'automation-card-import-parser.js', 'automation-flow.js',
  ],
};

function readProjectSource(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\.\//, '');
  const files = splitSourceFiles[normalized];
  if (!files) return fs.readFileSync(path.join(root, normalized), 'utf8');
  const directory = path.posix.dirname(normalized);
  return readFiles(files.map((name) => `${directory}/${name}`));
}

module.exports = { readAiControlSource, readFiles, readProjectSource };
