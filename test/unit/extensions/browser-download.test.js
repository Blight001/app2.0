'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(
  __dirname,
  '../../../src/assets/extensions/browser_automation/background/10_browser_download.js',
), 'utf8');

function createContext(calls) {
  const context = vm.createContext({
    resolveAutomationTargetTab: async () => ({ id: 7, url: 'https://example.test/page', title: 'Page' }),
    trySoftwareRuntimeAutomation: async () => ({
      success: true, url: 'https://example.test/page', title: 'Page',
      cookies: [{ name: 'sid', value: 'secret', domain: 'example.test', path: '/' }],
      localStorage: { theme: 'dark' }, sessionStorage: { step: '2' },
    }),
    requestSoftwareBrowserDownload: async (payload) => {
      calls.push(payload);
      return { success: true, action: payload.action, relative_path: 'file.zip' };
    },
    readPageSnapshot: async () => ({}),
    readCookies: async () => [],
    buildCurrentTabBrowserStorage: () => [],
    minimizeCapturedState: (value) => value,
    Date,
    Error,
    Object,
    String,
  });
  vm.runInContext(source, context, { filename: '10_browser_download.js' });
  return context;
}

test('browser_download forwards a URL with current native cookies to the authenticated service', async () => {
  const calls = [];
  const context = createContext(calls);
  const result = await vm.runInContext(
    'toolBrowserDownload({action:"download",url:"https://example.test/file.zip",directory:"models"})',
    context,
  );
  assert.equal(result.success, true);
  assert.equal(calls[0].url, 'https://example.test/file.zip');
  assert.equal(calls[0].cookies[0].name, 'sid');
  assert.equal(calls[0].directory, 'models');
});

test('browser_download save_session sends Cookie and Storage without returning their content', async () => {
  const calls = [];
  const context = createContext(calls);
  const result = await vm.runInContext(
    'toolBrowserDownload({action:"save_session",filename:"account"})',
    context,
  );
  assert.equal(result.relative_path, 'file.zip');
  assert.equal(calls[0].session.cookies[0].value, 'secret');
  assert.equal(calls[0].session.browserStorage[0].localStorage.theme, 'dark');
  assert.equal(Object.hasOwn(result, 'session'), false);
});
