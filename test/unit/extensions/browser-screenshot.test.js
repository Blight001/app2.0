'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const extensionRoot = path.join(root, 'src/assets/extensions/browser_automation');
const screenshotSource = fs.readFileSync(
  path.join(extensionRoot, 'background/11_browser_screenshot.js'),
  'utf8',
);
const plain = (value) => JSON.parse(JSON.stringify(value));

function createScreenshotContext(chrome, tab = { id: 7, windowId: 3, url: 'https://example.com/' }) {
  const context = vm.createContext({
    chrome,
    resolveAutomationTargetTab: async () => tab,
    focusTab: async () => tab,
    sleep: async () => {},
    setTimeout,
    clearTimeout,
    Promise,
    Number,
    String,
    Math,
    Error,
  });
  vm.runInContext(screenshotSource, context, { filename: '11_browser_screenshot.js' });
  return context;
}

test('browser_screenshot captures the visible target tab and returns delivery metadata', async () => {
  const calls = [];
  const chrome = {
    tabs: {
      async captureVisibleTab(windowId, options) {
        calls.push({ windowId, options });
        return 'data:image/png;base64,AA==';
      },
    },
  };
  const context = createScreenshotContext(chrome);
  const result = await vm.runInContext(
    'toolBrowserScreenshot({screenshot_fx:false, send_to_user:false})',
    context,
  );

  assert.equal(result.success, true);
  assert.equal(result.method, 'captureVisibleTab');
  assert.equal(result.dataUrl, 'data:image/png;base64,AA==');
  assert.equal(result.send_to_user, false);
  assert.equal(result.save_to_server, false);
  assert.deepEqual(plain(calls), [{ windowId: 3, options: { format: 'png' } }]);
});

test('browser_screenshot uses CDP for a full-page capture and always detaches', async () => {
  const commands = [];
  let detached = false;
  const chrome = {
    tabs: { async captureVisibleTab() { throw new Error('visible capture should not run'); } },
    debugger: {
      async attach(target, version) { commands.push({ method: 'attach', target, version }); },
      async detach(target) { detached = true; commands.push({ method: 'detach', target }); },
      async sendCommand(_target, method, params) {
        commands.push({ method, params });
        if (method === 'Page.getLayoutMetrics') {
          return { cssContentSize: { width: 1200, height: 2400 } };
        }
        if (method === 'Page.captureScreenshot') return { data: 'FULL_PAGE' };
        return {};
      },
    },
  };
  const context = createScreenshotContext(chrome);
  const result = await vm.runInContext(
    'toolBrowserScreenshot({full_page:true, screenshot_fx:false})',
    context,
  );

  assert.equal(result.success, true);
  assert.equal(result.method, 'debugger.Page.captureScreenshot');
  assert.equal(result.dataUrl, 'data:image/png;base64,FULL_PAGE');
  assert.equal(detached, true);
  const capture = commands.find((entry) => entry.method === 'Page.captureScreenshot');
  assert.deepEqual(plain(capture.params.clip), { x: 0, y: 0, width: 1200, height: 2400, scale: 1 });
  assert.equal(capture.params.captureBeyondViewport, true);
});

test('browser_screenshot returns a structured failure and detaches after a CDP error', async () => {
  let detached = false;
  const chrome = {
    tabs: { async captureVisibleTab() { return 'data:image/png;base64,FALLBACK'; } },
    debugger: {
      async attach() {},
      async detach() { detached = true; },
      async sendCommand(_target, method) {
        if (method === 'Page.captureScreenshot') throw new Error('capture denied');
        if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 800, height: 1200 } };
        return {};
      },
    },
  };
  const context = createScreenshotContext(chrome);
  const result = await vm.runInContext(
    'toolBrowserScreenshot({full_page:true, screenshot_fx:false})',
    context,
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'SCREENSHOT_FAILED');
  assert.match(result.error, /capture denied/);
  assert.equal(detached, true);
});

test('extension publishes browser_screenshot and declares debugger permission', () => {
  const protocolSource = fs.readFileSync(
    path.join(extensionRoot, 'background/09_agent_protocol.js'),
    'utf8',
  );
  const context = vm.createContext({
    CARD_MANAGE_ACTIONS: [],
    CARD_STEP_TYPES: [],
    CARD_STEP_BY_VALUES: [],
    CARD_STEP_EDIT_ACTIONS: [],
  });
  vm.runInContext(protocolSource, context, { filename: '09_agent_protocol.js' });
  const names = vm.runInContext('effectiveAgentToolDefs().map((tool) => tool.name)', context);
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

  assert.ok(names.includes('browser_screenshot'));
  assert.ok(manifest.permissions.includes('debugger'));
});

test('agent transport routes browser_screenshot through the screenshot executor', async () => {
  const transportSource = fs.readFileSync(
    path.join(extensionRoot, 'background/09_agent_transport.js'),
    'utf8',
  );
  const calls = [];
  const unused = async () => ({ unused: true });
  const context = vm.createContext({
    toolBrowserTab: unused,
    toolBrowserObserve: unused,
    toolBrowserScreenshot: async (args) => { calls.push(args); return { success: true }; },
    toolBrowserAction: unused,
    toolBrowserWait: unused,
    Promise,
    Object,
    String,
    Number,
    Error,
  });
  vm.runInContext(transportSource, context, { filename: '09_agent_transport.js' });
  const result = await vm.runInContext(
    'runAgentToolCommand("browser_screenshot", {tab_id:12, full_page:true})',
    context,
  );

  assert.equal(result.success, true);
  assert.deepEqual(plain(calls), [{ tab_id: 12, full_page: true }]);
});
