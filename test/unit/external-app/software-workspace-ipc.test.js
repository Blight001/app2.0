'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  registerSoftwareWorkspaceIPC,
} = require(path.join(
  projectRoot,
  'src/app/main/features/external-app/register-software-workspace-ipc.js',
));

test('Software 页签事件只调用注入的 Software TabManager', async () => {
  const listeners = new Map();
  const calls = [];
  registerSoftwareWorkspaceIPC({
    ipc: {
      scope: () => ({
        on: (channel, listener) => listeners.set(channel, listener),
      }),
    },
    softwareWorkspace: {
      tabManager: {
        closeTab: async (id) => calls.push(['close', id]),
        reorderTab: (...args) => calls.push(['reorder', ...args]),
        switchTab: async (id) => calls.push(['switch', id]),
      },
      toggleSidebar: () => calls.push(['toggle']),
    },
  });

  listeners.get('software-close-tab')({}, 'software-1');
  listeners.get('software-switch-tab')({}, 'software-2');
  listeners.get('software-reorder-tab')({}, {
    tabId: 'software-1',
    targetTabId: 'software-2',
    position: 'after',
  });
  listeners.get('software-toggle-sidebar')({});
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ['close', 'software-1'],
    ['switch', 'software-2'],
    ['reorder', 'software-1', 'software-2', 'after'],
    ['toggle'],
  ]);
});
