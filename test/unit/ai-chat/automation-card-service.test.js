'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createAutomationCardService } = require('../../../src/app/main/features/ai-chat/automation-card-service');

test('card listing maps durable cache records and selection details', async () => {
  const state = { items: [
    { id: 'one', cardName: 'First', cardData: { name: 'Fallback', steps: [{}, {}] }, savedAt: 'now' },
    { id: '', cardData: {} },
  ], selectedId: 'one' };
  const bridge = {
    getCardCacheState: () => ({ exists: true, state }),
    selectCard: (id) => ({ state: { selectedId: id }, item: state.items[0] }),
  };
  const service = createAutomationCardService({ bridge });
  assert.deepEqual(await service.getAutomationCards(), {
    ok: true, selectedId: 'one', cards: [{ id: 'one', name: 'First', stepCount: 2, savedAt: 'now' }],
  });
  assert.deepEqual(service.selectAutomationCard({ id: 'one' }), {
    ok: true, selectedId: 'one', card: { id: 'one', name: 'First', stepCount: 2 },
  });
  assert.throws(() => createAutomationCardService({ bridge: {} }).selectAutomationCard({}), /卡片库不可用/);
});

test('missing bridge returns an empty stable response', async () => {
  const service = createAutomationCardService({ bridge: null, now: () => 20000 });
  assert.deepEqual(await service.getAutomationCards(), { ok: true, selectedId: '', cards: [] });
});

test('software card editor reads, saves and deletes the durable shared card record', () => {
  let state = {
    items: [{
      id: 'card-1',
      cardName: 'Before',
      cardData: { name: 'Before', website: 'https://example.com', steps: [] },
      savedAt: '2026-01-01T00:00:00.000Z',
    }],
    selectedId: 'card-1',
  };
  const bridge = {
    getCardCacheState: () => ({ exists: true, state }),
    setCardCacheState: (next) => { state = next; return next; },
  };
  const service = createAutomationCardService({ bridge, now: () => Date.parse('2026-07-23T10:00:00.000Z') });
  const read = service.getAutomationCard({ id: 'card-1' });
  assert.equal(read.data.cardData.name, 'Before');

  const saved = service.saveAutomationCard({
    id: 'card-1',
    cardData: {
      name: 'After',
      website: 'https://example.com',
      steps: [{ id: 'open', type: 'navigate', url: 'https://example.com' }],
    },
  });
  assert.equal(saved.data.name, 'After');
  assert.equal(saved.data.stepCount, 1);
  assert.equal(saved.data.savedAt, '2026-07-23T10:00:00.000Z');
  assert.equal(state.items[0].cardData.name, 'After');
  assert.throws(() => service.saveAutomationCard({
    cardData: { name: 'Unsafe', steps: [{ type: 'external_script', script: 'alert(1)' }] },
  }), /不受支持|不允许/);

  assert.deepEqual(service.deleteAutomationCard({ id: 'card-1' }), {
    ok: true,
    data: { deletedId: 'card-1', selectedId: '' },
  });
  assert.deepEqual(state, { items: [], selectedId: '' });
  assert.throws(() => service.getAutomationCard({ id: 'card-1' }), /不存在或已被删除/);
});

test('software card run and stop target capable native browsers', async () => {
  const dispatched = [];
  const bridge = {
    getCardCacheState: () => ({ exists: true, state: {
      items: [{ id: 'card-1', cardName: 'Run me', cardData: { name: 'Run me', steps: [{}] } }],
      selectedId: 'card-1',
    } }),
    setCardCacheState: (state) => state,
    listConnections: () => [{ id: 'unsupported', online: true }, { id: 'browser-1', online: true }],
    getConnection: (id) => ({ tools: id === 'browser-1' ? [{ name: 'manage_card' }] : [] }),
    dispatch: async (...args) => {
      dispatched.push(args);
      if (args[2]?.action === 'stop') return { success: true, stopped: true };
      return { success: true, summary: 'done' };
    },
  };
  const service = createAutomationCardService({ bridge });
  assert.deepEqual(await service.runAutomationCard({
    id: 'card-1', inputs: { email: 'fixture@example.com' }, startStep: 2, loopCount: 3,
  }), {
    ok: true,
    data: { connectionId: 'browser-1', result: { success: true, summary: 'done' } },
  });
  assert.deepEqual(dispatched[0].slice(0, 3), [
    'browser-1',
    'manage_card',
    {
      action: 'run', id: 'card-1', inputs: { email: 'fixture@example.com' },
      start_step: 2, loop_count: 3,
    },
  ]);
  assert.deepEqual(await service.stopAutomationCard(), { ok: true, data: { stopped: 1 } });
  assert.deepEqual(dispatched.at(-1).slice(0, 3), [
    'browser-1', 'manage_card', { action: 'stop' },
  ]);
});
