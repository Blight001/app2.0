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
    requireBrowserScriptCompatibility: async () => true,
    focusTab: async () => tab,
    ensureAgentOffscreen: async () => {},
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

test('browser_screenshot backs off before retrying capture quota errors', async () => {
  const delays = [];
  let attempts = 0;
  const chrome = {
    tabs: {
      async captureVisibleTab() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
        }
        return 'data:image/png;base64,RETRIED';
      },
    },
  };
  const context = createScreenshotContext(chrome);
  context.sleep = async (ms) => { delays.push(ms); };
  const result = await vm.runInContext(
    'toolBrowserScreenshot({screenshot_fx:false, retries:2})',
    context,
  );

  assert.equal(result.success, true);
  assert.equal(attempts, 2);
  assert.ok(delays.includes(1100));
});

test('browser_screenshot stitches full-page captureVisibleTab tiles without debugger', async () => {
  const scrolls = [];
  let composedPayload;
  const chrome = {
    tabs: { async captureVisibleTab() { return 'data:image/png;base64,TILE'; } },
    scripting: {
      async executeScript(options) {
        if (!options.args) return [{ result: {
          scrollX: 10, scrollY: 20, viewportWidth: 800, viewportHeight: 600,
          pageWidth: 800, pageHeight: 1200,
        } }];
        scrolls.push(options.args);
        return [{ result: { x: options.args[0], y: options.args[1] } }];
      },
    },
    runtime: {
      async sendMessage(message) {
        composedPayload = message.payload;
        return { ok: true, dataUrl: 'data:image/png;base64,FULL_PAGE' };
      },
    },
  };
  const context = createScreenshotContext(chrome);
  const result = await vm.runInContext(
    'toolBrowserScreenshot({full_page:true, screenshot_fx:false})',
    context,
  );

  assert.equal(result.success, true);
  assert.equal(result.method, 'captureVisibleTab.stitched');
  assert.equal(result.dataUrl, 'data:image/png;base64,FULL_PAGE');
  assert.equal(composedPayload.tiles.length, 2);
  assert.equal(composedPayload.width, 800);
  assert.equal(composedPayload.height, 1200);
  assert.deepEqual(plain(scrolls), [[0, 0], [0, 600], [10, 20]]);
});

test('browser_screenshot falls back when native full-page capture does not return', async () => {
  const chrome = {
    tabs: { async captureVisibleTab() { return 'data:image/png;base64,TILE'; } },
    scripting: {
      async executeScript(options) {
        if (!options.args) return [{ result: {
          scrollX: 0, scrollY: 0, viewportWidth: 800, viewportHeight: 600,
          pageWidth: 800, pageHeight: 600,
        } }];
        return [{ result: { x: options.args[0], y: options.args[1] } }];
      },
    },
    runtime: {
      async sendMessage() {
        return { ok: true, dataUrl: 'data:image/png;base64,FALLBACK' };
      },
    },
  };
  const context = createScreenshotContext(chrome);
  context.trySoftwareRuntimeAutomation = async () => new Promise(() => {});
  const result = await vm.runInContext(
    'toolBrowserScreenshot({full_page:true, screenshot_fx:false, native_timeout_ms:10})',
    context,
  );

  assert.equal(result.success, true);
  assert.equal(result.method, 'captureVisibleTab.stitched');
  assert.equal(result.dataUrl, 'data:image/png;base64,FALLBACK');
});

test('browser_screenshot returns a structured failure when tile composition fails', async () => {
  const chrome = {
    tabs: { async captureVisibleTab() { return 'data:image/png;base64,TILE'; } },
    scripting: {
      async executeScript(options) {
        if (!options.args) return [{ result: {
          scrollX: 0, scrollY: 0, viewportWidth: 800, viewportHeight: 600,
          pageWidth: 800, pageHeight: 600,
        } }];
        return [{ result: { x: options.args[0], y: options.args[1] } }];
      },
    },
    runtime: { async sendMessage() { return { ok: false, error: 'canvas unavailable' }; } },
  };
  const context = createScreenshotContext(chrome);
  const result = await vm.runInContext(
    'toolBrowserScreenshot({full_page:true, screenshot_fx:false})',
    context,
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'SCREENSHOT_FAILED');
  assert.match(result.error, /canvas unavailable/);
});

test('extension publishes browser_screenshot without debugger permission or API usage', () => {
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
  assert.ok(names.includes('browser_download'));
  assert.equal(names.includes('save_cookies'), false);
  assert.equal(manifest.permissions.includes('debugger'), false);
  assert.equal(manifest.permissions.includes('scripting'), false);
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.ok(manifest.optional_permissions.includes('scripting'));
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(screenshotSource.includes('chrome.debugger'), false);
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
    toolBrowserDownload: unused,
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

test('offscreen document composes captured tiles with canvas', async () => {
  const source = fs.readFileSync(path.join(extensionRoot, 'offscreen.js'), 'utf8');
  const drawCalls = [];
  let listener;
  class FakeImage {
    constructor() { this.naturalWidth = 800; this.naturalHeight = 600; }
    set src(_value) { queueMicrotask(() => this.onload()); }
  }
  const context = vm.createContext({
    chrome: {
      runtime: {
        sendMessage: async () => ({}),
        onMessage: { addListener(callback) { listener = callback; } },
      },
    },
    document: {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: (...args) => drawCalls.push(args) }),
          toDataURL: (type) => `data:${type};base64,COMPOSED`,
        };
      },
    },
    Image: FakeImage,
    Date,
    Error,
    Number,
    String,
    Promise,
    queueMicrotask,
    setInterval: () => 1,
  });
  vm.runInContext(source, context, { filename: 'offscreen.js' });
  const response = await new Promise((resolve) => {
    const pending = listener({
      type: 'screenshot:compose',
      payload: {
        width: 400,
        height: 300,
        scale: 1,
        format: 'png',
        tiles: [{
          dataUrl: 'data:image/png;base64,TILE',
          viewportWidth: 800, viewportHeight: 600,
          sx: 0, sy: 0, sw: 400, sh: 300, dx: 0, dy: 0,
        }],
      },
    }, {}, resolve);
    assert.equal(pending, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.dataUrl, 'data:image/png;base64,COMPOSED');
  assert.equal(drawCalls.length, 1);
});
