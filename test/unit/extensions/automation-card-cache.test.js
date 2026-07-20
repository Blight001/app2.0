'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const keys = {
  AUTOMATION_CARD_CACHE_LIST_KEY: 'list',
  AUTOMATION_CARD_SELECTED_ID_KEY: 'selected',
  AUTOMATION_CARD_CACHE_KEY: 'legacy',
  AUTOMATION_CARD_CACHE_NAME_KEY: 'legacyName',
  AUTOMATION_CARD_CACHE_TIME_KEY: 'legacyTime',
  AUTOMATION_CARD_PERSIST_PENDING_KEY: 'pending',
};
Object.assign(global, keys);
let storage = {};
let remote = { exists: false };
let writeFailure = null;
global.chrome = { storage: { local: {
  get: async () => ({ ...storage }),
  set: async (value) => { storage = { ...storage, ...value }; },
} } };
global.readSoftwareCardCache = async () => remote;
global.writeSoftwareCardCache = async (state) => {
  if (writeFailure) throw writeFailure;
  return { state };
};

const cache = require('../../../src/assets/extensions/browser_automation/background/04_cache');

test.beforeEach(() => { storage = {}; remote = { exists: false }; writeFailure = null; });

test('step and flow normalization creates stable unique graph identifiers', () => {
  assert.equal(cache.sanitizeStepIdPart(' Hello 世界! '), 'hello_世界');
  assert.equal(cache.sanitizeStepIdPart('***'), 'step');
  const steps = cache.ensureStepIds([
    { id: 'same', name: 'First' }, { step_id: 'same', name: 'Second' }, { name: 'Click Here', type: 'click' }, null,
  ]);
  assert.deepEqual(steps.map((step) => step.id), ['same', 'same_2', 'click_here_3', 'step_4']);
  const flow = cache.normalizeFlowData({
    start_node_id: 'same',
    nodes: [{ stepId: 'same', x: '12', y: 'bad' }, { id: 'unknown' }],
    edges: [
      { source: 'same', target: 'same_2', branch: 'yes' },
      { from: 'same', to: 'same_2', label: 'yes' },
      { from: 'same', to: 'same' },
    ],
  }, steps);
  assert.equal(flow.start, 'same');
  assert.equal(flow.nodes.length, 4);
  assert.deepEqual(flow.nodes[0], { id: 'same', x: 12, y: 0 });
  assert.equal(flow.edges.length, 1);
  assert.equal(cache.normalizeFlowData([], steps), undefined);
});

test('card normalization validates input, names drafts and inserts navigation', () => {
  assert.throws(() => cache.normalizeCardData(null), /格式不正确/);
  assert.throws(() => cache.normalizeCardData({ steps: [] }), /缺少 steps/);
  const draft = cache.normalizeCardData({ steps: [] }, { allowEmptySteps: true });
  assert.match(draft.name, /^automation_/);
  const standalone = cache.normalizeStandaloneSteps({
    name: 'Fixture', website: 'https://example.test', steps: [{ type: 'click', name: 'Go' }],
  });
  assert.equal(standalone.steps[0].type, 'navigate');
  assert.equal(standalone.steps[0].id, '__auto_navigate_start');
  const alreadyNavigates = cache.normalizeStandaloneSteps({
    name: 'Fixture', website: 'https://example.test', steps: [{ type: 'navigate', url: 'https://other.test' }],
  });
  assert.equal(alreadyNavigates.steps.length, 1);
});

test('cache entry and state normalization discard invalid records and select fallback', () => {
  const entry = cache.normalizeCardCacheEntry({
    cacheId: 'card-1', cardData: { name: 'Card', steps: [] }, updatedAt: 'now', selected: true,
  });
  assert.equal(entry.id, 'card-1');
  assert.equal(entry.cardName, 'Card');
  const invalid = new Proxy({}, { get: () => { throw new Error('invalid cache entry'); } });
  const state = cache.normalizeCardCacheState([
    entry, invalid, { id: 'card-2', cardData: { name: 'Two', steps: [] } },
  ], 'missing');
  assert.deepEqual(state.items.map((item) => item.id), ['card-1', 'card-2']);
  assert.equal(state.selectedId, 'card-1');
  assert.deepEqual(cache.normalizeCardCacheState(null), { items: [], selectedId: '' });
});

test('local cache reader supports current and legacy storage formats', () => {
  const current = cache.readLocalCardCacheState({ list: [
    { id: 'one', cardData: { name: 'One', steps: [] } },
  ], selected: 'one' });
  assert.equal(current.selectedId, 'one');
  const legacy = cache.readLocalCardCacheState({
    legacy: { name: 'Legacy', steps: [] }, legacyName: 'legacy-id', legacyTime: 'yesterday',
  });
  assert.equal(legacy.items[0].id, 'legacy-id');
  assert.equal(legacy.items[0].savedAt, 'yesterday');
  assert.deepEqual(cache.readLocalCardCacheState({}), { items: [], selectedId: '' });
});

test('mirror and replacement persist remote state with offline fallback', async () => {
  const state = { items: [{ id: 'one', cardData: { name: 'One', steps: [] }, cardName: 'One' }], selectedId: 'one' };
  const mirrored = await cache.writeLocalCardCacheMirror(state, true);
  assert.equal(mirrored.selectedId, 'one');
  assert.equal(storage.pending, true);
  const persisted = await cache.replaceCardCacheState(state.items, 'one');
  assert.equal(persisted.persisted, true);
  assert.equal(storage.pending, false);
  writeFailure = new Error('bridge offline');
  const offline = await cache.replaceCardCacheState(state.items, 'one');
  assert.equal(offline.persisted, false);
  assert.equal(offline.persistError, 'bridge offline');
  assert.equal(storage.pending, true);
});

test('loader synchronizes pending, remote, legacy and offline states', async () => {
  storage = { list: [{ id: 'one', cardData: { name: 'One', steps: [] } }], selected: 'one', pending: true };
  assert.equal((await cache.loadCardCacheState()).persisted, true);
  storage = {};
  remote = { exists: true, state: { items: [{ id: 'remote', cardData: { name: 'Remote', steps: [] } }], selectedId: 'remote' } };
  assert.equal((await cache.loadCardCache()).selectedId, 'remote');
  storage = { legacy: { name: 'Legacy', steps: [] }, legacyName: 'legacy' };
  remote = { exists: false };
  assert.equal((await cache.loadCardCacheState()).selectedId, 'legacy');
  storage = {};
  writeFailure = new Error('offline');
  global.readSoftwareCardCache = async () => { throw new Error('offline'); };
  assert.deepEqual(await cache.loadCardCacheState(), { items: [], selectedId: '', persisted: false });
  assert.equal(await cache.loadCardCache(), null);
  global.readSoftwareCardCache = async () => remote;
});

test('save and delete manage selected card state and ambiguous names safely', async () => {
  remote = { exists: true, state: { items: [], selectedId: '' } };
  const saved = await cache.saveCardCacheState({ name: 'Card', steps: [{ type: 'click' }] }, 'card-id');
  assert.equal(saved.selectedId, 'card-id');
  assert.equal(saved.cardData.steps[0].id, 'click_1');

  const state = { items: [
    { id: 'one', cardName: 'Same', cardData: { name: 'One', steps: [] } },
    { id: 'two', cardName: 'Same', cardData: { name: 'Two', steps: [] } },
  ], selectedId: 'two' };
  assert.equal(cache.resolveCardCacheDeleteTarget(state).id, 'two');
  assert.equal(cache.resolveCardCacheDeleteTarget(state, 'one').id, 'one');
  assert.throws(() => cache.resolveCardCacheDeleteTarget(state, 'Same'), /多张同名/);
  assert.throws(() => cache.resolveCardCacheDeleteTarget(state, 'missing'), /未找到/);
  assert.throws(() => cache.resolveCardCacheDeleteTarget({}, ''), /当前没有/);

  storage = { list: state.items, selected: 'two' };
  remote = { exists: true, state };
  const deleted = await cache.deleteCardCacheEntry('two');
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.id, 'two');
  assert.equal(deleted.selectedId, 'one');
});
