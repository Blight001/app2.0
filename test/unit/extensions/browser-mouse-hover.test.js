'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..', '..');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.id = '';
    this.innerHTML = '';
    this.isConnected = true;
    this.style = {};
    this.events = [];
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : !!force;
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      },
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  contains(child) {
    return child === this || this.children.includes(child);
  }

  dispatchEvent(event) {
    this.events.push(event);
    return true;
  }

  querySelector() {
    return null;
  }

  remove() {
    this.isConnected = false;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

test('browser mouse effect enters the viewport, hovers, and moves automatically', async () => {
  const body = new FakeElement('body');
  const head = new FakeElement('head');
  const documentElement = new FakeElement('html');
  const pageTarget = new FakeElement('button');
  const elementsById = new Map();
  let frameTime = 0;

  const document = {
    body,
    head,
    documentElement,
    hidden: false,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      Object.defineProperty(element, 'id', {
        get() { return this._id || ''; },
        set(value) { this._id = value; if (value) elementsById.set(value, this); },
      });
      return element;
    },
    elementFromPoint: () => pageTarget,
    getElementById: (id) => elementsById.get(id) || null,
    querySelectorAll: () => [],
  };

  const context = vm.createContext({
    chrome: {
      runtime: { getURL: () => 'chrome-extension://test/cursors/hand.png' },
      storage: {
        local: { get: async () => ({}) },
        onChanged: { addListener: () => {} },
      },
    },
    document,
    window: { innerWidth: 1000, innerHeight: 700 },
    MouseEvent: FakeEvent,
    PointerEvent: FakeEvent,
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      frameTime += 100;
      return setImmediate(() => callback(frameTime));
    },
    cancelAnimationFrame: clearImmediate,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
    Math,
    Promise,
  });
  context.window.window = context.window;
  context.window.document = document;

  const source = fs.readFileSync(
    path.join(root, 'src/assets/extensions/browser_automation/content/fx.js'),
    'utf8',
  );
  vm.runInContext(source, context);

  const moved = await context.window.__hsFx.hoverBrowser();
  assert.equal(moved, true);

  const eventTypes = pageTarget.events.map((event) => event.type);
  assert.ok(eventTypes.includes('pointerenter'));
  assert.ok(eventTypes.includes('mouseenter'));
  assert.ok(eventTypes.includes('pointermove'));
  assert.ok(eventTypes.includes('mousemove'));

  const positions = new Set(
    pageTarget.events
      .filter((event) => event.type === 'mousemove')
      .map((event) => `${Math.round(event.clientX)},${Math.round(event.clientY)}`),
  );
  assert.ok(positions.size > 1, '鼠标应从浏览器边缘自动移动到视口内部');

  const cursor = body.children.find((element) => element.className.includes('-cur'));
  assert.ok(cursor);
  assert.ok(cursor.classes.has('show'), '操作结束后鼠标应停在最后位置并持续显示');
});

test('browser observe focuses and hovers the browser before scanning the page', async () => {
  const calls = [];
  const context = vm.createContext({
    chrome: {
      tabs: {
        get: async (tabId) => ({ id: tabId, windowId: 3, url: 'https://example.com' }),
        update: async (tabId) => { calls.push(`focus-tab:${tabId}`); },
      },
      windows: {
        update: async (windowId) => { calls.push(`focus-window:${windowId}`); },
      },
      scripting: {
        executeScript: async ({ args, func }) => {
          const pageWindow = args
            ? { __hsObserve: { scan: () => { calls.push('scan'); return { success: true }; } } }
            : { __hsFx: { hoverBrowser: async () => { calls.push('hover'); return true; } } };
          const pageFunction = vm.runInNewContext(`(${func.toString()})`, { window: pageWindow });
          return [{ result: await pageFunction(...(args || [])) }];
        },
      },
    },
    resolveAutomationTargetTab: async () => ({ id: 7, windowId: 3, url: 'https://example.com' }),
    requireBrowserScriptCompatibility: async () => true,
    rememberAutomationTargetTab: async () => {},
    normalizeTargetUrl: (value) => value,
    waitForTabComplete: async () => {},
    getActiveTab: async () => null,
    sleep: async () => {},
    URL,
    Number,
    Array,
    Error,
  });
  const source = fs.readFileSync(
    path.join(root, 'src/assets/extensions/browser_automation/background/10_browser_tools.js'),
    'utf8',
  );
  vm.runInContext(source, context);

  const result = await vm.runInContext('toolBrowserObserve({})', context);
  assert.equal(result.success, true);
  assert.deepEqual(calls, ['focus-tab:7', 'focus-window:3', 'hover', 'scan']);
});

test('browser upload queues local files before dispatching the trusted Chromium click', async () => {
  const calls = [];
  const tab = { id: 9, windowId: 4, url: 'https://video.example.test/create' };
  const prepared = {
    success: true,
    input: {
      inputType: 'mouse', action: 'click', x: 20, y: 30,
      viewportWidth: 800, viewportHeight: 600,
    },
  };
  const context = vm.createContext({
    chrome: {
      tabs: { get: async () => tab, update: async () => {} },
      windows: { update: async () => {} },
      scripting: {
        executeScript: async ({ args }) => [{ result: args ? prepared : true }],
      },
    },
    resolveAutomationTargetTab: async () => tab,
    requireBrowserScriptCompatibility: async () => true,
    rememberAutomationTargetTab: async () => {},
    requestSoftwareRuntimeFileSelection: async (selection) => {
      calls.push({ kind: 'selection', selection });
      return { result: { queued: true } };
    },
    requestSoftwareRuntimeInput: async (input) => {
      calls.push({ kind: 'input', input });
      return { result: { dispatched: true } };
    },
    URL, Number, Array, Error,
  });
  const source = fs.readFileSync(
    path.join(root, 'src/assets/extensions/browser_automation/background/10_browser_tools.js'),
    'utf8',
  );
  vm.runInContext(source, context);

  const result = await vm.runInContext(
    'toolBrowserAction({action:"upload_file", selector:"#upload", path:"C:\\\\media\\\\clip.mp4"})',
    context,
  );
  assert.equal(result.uploadedFileCount, 1);
  assert.equal(calls[0].kind, 'selection');
  assert.equal(calls[0].selection.pageUrl, tab.url);
  assert.equal(calls[1].kind, 'input');
});
