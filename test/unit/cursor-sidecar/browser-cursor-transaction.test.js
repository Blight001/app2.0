'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BrowserRuntimeManager,
} = require('../../../src/app/main/browser-runtime');

function createManager(send, cursorSidecarService) {
  const chromiumRuntime = {
    instances: new Map(),
    async enqueueProfileOperation(_profileId, operation) {
      return operation();
    },
    getReadyInstance() {
      return { commandClient: { send } };
    },
  };
  return new BrowserRuntimeManager({
    userDataDir: 'C:/unused',
    store: {},
    windowBridge: {},
    chromiumRuntime,
    externalAppRuntime: {},
    cursorSidecarService,
  });
}

test('browser mouse action holds one profile transaction across resolve, animation and commit', async () => {
  const order = [];
  const manager = createManager(async (command, payload) => {
    order.push(command);
    if (command === 'resolve-action-target') {
      assert.equal(payload.selector, '#submit');
      return {
        result: {
          targetPhysical: { x: 900, y: 500 },
          resolvedInput: { x: 20, y: 30, viewportWidth: 100, viewportHeight: 80 },
        },
      };
    }
    return { result: { success: true, dispatched: true } };
  }, {
    async moveAndWait(tabId, point) {
      order.push('sidecar-arrived');
      assert.equal(tabId, 'profile-one');
      assert.deepEqual(point, { x: 900, y: 500 });
      return { displayed: true, sequenceId: 4 };
    },
    feedback(tabId, sequenceId, button) {
      order.push(`feedback:${tabId}:${sequenceId}:${button}`);
    },
  });

  const result = await manager.dispatchAutomation(
    'profile-one',
    'perform-action',
    { action: 'click', selector: '#submit' },
  );

  assert.equal(result.result.dispatched, true);
  assert.deepEqual(order, [
    'resolve-action-target',
    'sidecar-arrived',
    'commit-resolved-action',
    'feedback:profile-one:4:left',
  ]);
});

test('browser right click requests the right-button effect', async () => {
  let feedbackButton = '';
  const manager = createManager(async (command) => {
    if (command === 'resolve-action-target') {
      return {
        result: {
          targetPhysical: { x: 20, y: 30 },
          resolvedInput: { x: 20, y: 30 },
        },
      };
    }
    return { result: { success: true, dispatched: true } };
  }, {
    async moveAndWait() {
      return { displayed: true, sequenceId: 5 };
    },
    feedback(_tabId, _sequenceId, button) {
      feedbackButton = button;
    },
  });
  await manager.dispatchAutomation(
    'profile-one',
    'perform-action',
    { action: 'right_click', x: 20, y: 30 },
  );
  assert.equal(feedbackButton, 'right');
});

test('unsupported two-phase Chromium falls back to real input without failing the action', async () => {
  const commands = [];
  const manager = createManager(async (command) => {
    commands.push(command);
    if (command === 'resolve-action-target') throw new Error('unknown command');
    return { result: { success: true, dispatched: true } };
  }, {
    async moveAndWait() {
      throw new Error('must not run without resolved coordinates');
    },
  });

  const result = await manager.dispatchAutomation(
    'profile-one',
    'perform-action',
    { action: 'click', x: 10, y: 20 },
  );
  assert.equal(result.result.dispatched, true);
  assert.deepEqual(commands, ['resolve-action-target', 'perform-action']);
});
