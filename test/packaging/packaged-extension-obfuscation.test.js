'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const JavaScriptObfuscator = require('javascript-obfuscator');

const {
  buildObfuscationOptions,
} = require('../../scripts/obfuscate-packaged-extensions');
const obfuscatePackagedExtensions =
  require('../../scripts/obfuscate-packaged-extensions').default;

test('executeScript host files keep serialized page functions self-contained', async () => {
  const source = `
    async function invokePage() {
      return chrome.scripting.executeScript({
        target: { tabId: 1 },
        args: ['scan'],
        func: (method) => {
          if (!window.__pageApi || typeof window.__pageApi[method] !== 'function') {
            return { missing: true };
          }
          return window.__pageApi[method]();
        },
      });
    }
  `;
  const options = buildObfuscationOptions(source);
  assert.equal(options.stringArray, false);

  const obfuscated = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
  const workerContext = vm.createContext({
    chrome: {
      scripting: {
        executeScript: async ({ func, args }) => {
          const pageFunction = vm.runInNewContext(`(${func.toString()})`, {
            window: { __pageApi: { scan: () => 'observed-page-content' } },
          });
          return pageFunction(...args);
        },
      },
    },
  });

  vm.runInContext(obfuscated, workerContext);
  assert.equal(await vm.runInContext('invokePage()', workerContext), 'observed-page-content');
});

test('removed browser automation extension is not available to the packaging pipeline', async () => {
  const root = path.join(__dirname, '..', '..');
  assert.equal(fs.existsSync(path.join(
    root, 'src/assets/extensions/browser_automation',
  )), false);
  const platformConfig = JSON.parse(fs.readFileSync(
    path.join(root, 'platforms-config.json'), 'utf8',
  ));
  assert.equal(platformConfig.packagedExtensions.includes('browser_automation'), false);
  await assert.doesNotReject(obfuscatePackagedExtensions({
    appOutDir: path.join(root, 'test', '.missing-packaged-extensions'),
  }));
});
