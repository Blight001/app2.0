'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  manageNativeCard,
  rules,
} = require('../../../src/app/main/features/browser-automation/native-card-manager');

function createStore() {
  let state = { items: [], selectedId: '' };
  return {
    read: () => ({ exists: state.items.length > 0, state }),
    write: (next) => { state = next; return next; },
  };
}

test('native card manager owns safe CRUD and visual flow data', async () => {
  const store = createStore();
  const context = { store, runtime: {}, profileId: 'profile-a' };
  const written = await manageNativeCard(context, {
    action: 'write',
    id: 'card-a',
    cardData: {
      name: '登录',
      steps: [
        { id: 'open', type: 'navigate', url: 'https://example.com' },
        { id: 'click', type: 'click', selector: '#login' },
      ],
      flow: {
        start: 'open',
        nodes: [{ id: 'open', x: 10, y: 20 }],
        edges: [{ from: 'open', to: 'click', label: 'next' }],
      },
    },
  });
  assert.equal(written.id, 'card-a');
  assert.equal((await manageNativeCard(context, { action: 'list' })).items[0].stepCount, 2);
  const detail = await manageNativeCard(context, { action: 'get', id: 'card-a' });
  assert.equal(detail.cardData.flow.nodes.length, 2);

  const patched = await manageNativeCard(context, {
    action: 'patch_step', id: 'card-a', step_index: 2, stepPatch: { selector: '#submit' },
  });
  assert.equal(patched.cardData.steps[1].selector, '#submit');
  assert.equal((await manageNativeCard(context, { action: 'delete', id: 'card-a' })).deleted, true);
});

test('native card boundary rejects arbitrary scripts and documents removed cookie UI', async () => {
  const context = { store: createStore(), runtime: {}, profileId: 'profile-a' };
  await assert.rejects(manageNativeCard(context, {
    action: 'write',
    cardData: { name: 'unsafe', steps: [{ type: 'external_script', script: 'alert(1)' }] },
  }), /不受支持|不允许/);
  await assert.rejects(manageNativeCard(context, {
    action: 'write',
    cardData: { name: 'unsafe', steps: [{ type: 'condition', condition_mode: 'js' }] },
  }), /不允许 JS 条件/);
  assert.equal(rules().forbidden.includes('手动 Cookie 管理'), true);
  assert.equal(rules().stepTypes.includes('save_cookies'), true);
});
