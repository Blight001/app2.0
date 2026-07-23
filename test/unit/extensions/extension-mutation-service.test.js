'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createExtensionMutationService } = require('../../../src/app/main/features/extensions/extension-mutation-service');

function createFixture(overrides = {}) {
  const state = { plugins: [
    { id: 'builtin', path: '/builtin', builtin: true, enabled: true },
    { id: 'local', path: '/local', builtin: false, enabled: false },
    { id: 'missing', path: '/missing', builtin: false, enabled: false, missing: true },
  ] };
  const calls = [];
  const warnings = [];
  const deps = {
    getPluginById: (id) => state.plugins.find((plugin) => plugin.id === id),
    getPublicState: () => ({ plugins: state.plugins.map((plugin) => ({ ...plugin })) }),
    loadPluginIntoAllCurrentSessions: async (plugin) => calls.push(`load:${plugin.id}`),
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
    onPluginStateChanged: async (change) => ({ ok: true, change }),
    persistState: () => calls.push('persist'),
    syncLegacyTranslateSetting: () => calls.push('legacy'),
    toPublicPlugin: (plugin) => ({ id: plugin.id, enabled: plugin.enabled }),
    unloadPluginFromAllSessions: async (plugin) => calls.push(`unload:${plugin.id}`),
    ...overrides,
  };
  return { calls, service: createExtensionMutationService(deps), state, warnings };
}

test('enable and disable validate plugin state and refresh sessions', async () => {
  const fixture = createFixture();
  assert.equal((await fixture.service.setPluginEnabled('unknown', true)).message, '插件不存在');
  assert.equal((await fixture.service.setPluginEnabled('missing', true)).message, '插件目录不存在，请重新导入');
  const enabled = await fixture.service.setPluginEnabled('local', true);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.plugin.enabled, true);
  assert.deepEqual(fixture.calls.slice(0, 3), ['persist', 'load:local', 'legacy']);
  const disabled = await fixture.service.setPluginEnabled('local', false);
  assert.equal(disabled.ok, true);
  assert.equal(fixture.service.isPluginEnabled('local'), false);
  assert.ok(fixture.calls.includes('unload:local'));
});

test('refresh failures do not roll back persisted enable state', async () => {
  const fixture = createFixture({ onPluginStateChanged: async () => { throw new Error('refresh failed'); } });
  const result = await fixture.service.setPluginEnabled('local', true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.browserRefresh, { ok: false, message: 'refresh failed' });
  assert.match(fixture.warnings[0], /浏览器刷新失败/);
});
