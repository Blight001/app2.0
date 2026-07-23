'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const root = path.join(__dirname, '..', '..', '..');
const runtimeAutomation = fs.readFileSync(
  path.join(root, 'src/app/main/browser-runtime/runtime-automation.js'),
  'utf8',
);
const nativeTools = fs.readFileSync(
  path.join(root, 'src/app/main/features/browser-automation/native-browser-tool-service.js'),
  'utf8',
);
const observePatch = fs.readFileSync(
  path.join(root, 'native/chromium-fork/patches/0024-ai-free-native-observe-highlights.patch'),
  'utf8',
);

assert(runtimeAutomation.includes("'observe-page'"));
assert(nativeTools.includes("'browser_observe'"));
assert(nativeTools.includes("'capture-screenshot'"));
assert(observePatch.includes('chromium-native-overlay'));
assert.equal(fs.existsSync(path.join(
  root, 'src/assets/extensions/browser_automation',
)), false);

console.log('native browser_observe policy checks passed');
app.quit();
