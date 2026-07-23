'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const browserToolsSource = fs.readFileSync(path.resolve(
  __dirname,
  '../../../src/assets/extensions/browser_automation/background/10_browser_tools.js',
), 'utf8');

test('browser_wait fixed delay does not require Chromium or script compatibility', async () => {
  const calls = [];
  const context = vm.createContext({
    sleep: async (ms) => { calls.push({ kind: 'sleep', ms }); },
    resolveAutomationTargetTab: async () => {
      calls.push({ kind: 'target' });
      throw new Error('固定等待不应解析页面目标');
    },
    trySoftwareRuntimeAutomation: async () => {
      calls.push({ kind: 'native' });
      throw new Error('固定等待不应调用 Chromium 自动化');
    },
    requireBrowserScriptCompatibility: async () => {
      calls.push({ kind: 'compatibility' });
      throw new Error('固定等待不应要求脚本兼容模式');
    },
    String, Number, Math, Array, Error, URL,
  });
  vm.runInContext(browserToolsSource, context, { filename: '10_browser_tools.js' });

  const result = await vm.runInContext('toolBrowserWait({ms: 500})', context);

  assert.equal(result.success, true);
  assert.equal(result.waitedMs, 500);
  assert.equal(result.cardStep.type, 'wait');
  assert.equal(result.cardStep.timeout, 500);
  assert.deepEqual(calls, [{ kind: 'sleep', ms: 500 }]);
});

test('browser_wait forwards selector timeout to Chromium automation', async () => {
  let nativeCall = null;
  const context = vm.createContext({
    resolveAutomationTargetTab: async () => ({ id: 7 }),
    trySoftwareRuntimeAutomation: async (command, input) => {
      nativeCall = { command, input };
      return { success: true, found: true };
    },
    String, Number, Math, Array, Error, URL,
  });
  vm.runInContext(browserToolsSource, context, { filename: '10_browser_tools.js' });

  const result = await vm.runInContext(
    'toolBrowserWait({selector:"#ready", ms: 750})',
    context,
  );

  assert.equal(result.success, true);
  assert.equal(nativeCall.command, 'perform-action');
  assert.equal(nativeCall.input.selector, '#ready');
  assert.equal(nativeCall.input.timeout_ms, 750);
});
