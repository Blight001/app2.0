'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extensionRoot = path.resolve(__dirname, '../../../src/assets/extensions/browser_automation');
const source = fs.readFileSync(path.join(extensionRoot, 'background/08_agent_settings.js'), 'utf8');

function contextFor(settings, granted) {
  const context = vm.createContext({
    chrome: {
      storage: { local: { get: async () => ({ 'agent-settings': settings }), set: async () => {} } },
      permissions: { contains: async () => granted },
    },
    Object, String, Error,
  });
  vm.runInContext(source, context, { filename: '08_agent_settings.js' });
  return context;
}

test('脚本兼容模式默认关闭且必须同时具备显式权限', async () => {
  const disabled = contextFor({}, false);
  await assert.rejects(
    vm.runInContext('requireBrowserScriptCompatibility("Observe")', disabled),
    (error) => error.code === 'SCRIPT_COMPATIBILITY_DISABLED',
  );
  const enabled = contextFor({ scriptCompatibility: true }, true);
  assert.equal(await vm.runInContext('isBrowserScriptCompatibilityEnabled()', enabled), true);
});

test('标签页前进后退使用 tabs API 而不是页面脚本', () => {
  const source = fs.readFileSync(path.join(extensionRoot, 'background/10_browser_tools.js'), 'utf8');
  assert.match(source, /chrome\.tabs\.goBack\(tab\.id\)/);
  assert.match(source, /chrome\.tabs\.goForward\(tab\.id\)/);
  assert.doesNotMatch(source, /history\.(?:back|forward)\(\)/);
});
