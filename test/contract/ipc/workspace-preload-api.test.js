'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const preloadRoot = path.join(projectRoot, 'src/app/main/preload');

function loadScopedPreload(name) {
  const exposed = {};
  const calls = [];
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = async (channel, data) => {
    calls.push([channel, data]);
    return { channel, data };
  };
  ipcRenderer.send = () => {};
  let context;
  context = vm.createContext({
    process: {
      argv: name === 'browser' ? ['--ai-free-workspace=browser'] : [],
      env: {},
    },
    window: { addEventListener() {}, postMessage() {} },
    require(request) {
      if (request === 'electron') {
        return {
          contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
          ipcRenderer,
        };
      }
      if (request === './preload-helpers') {
        return require(path.join(preloadRoot, 'preload-helpers.js'));
      }
      if (request === '../preload.js') {
        const sharedPreload = path.join(preloadRoot, '..', 'preload.js');
        return vm.runInContext(
          fs.readFileSync(sharedPreload, 'utf8'),
          context,
          { filename: sharedPreload },
        );
      }
      throw new Error(`unexpected preload require: ${request}`);
    },
  });
  const file = path.join(preloadRoot, `${name}-preload.js`);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { calls, api: exposed.aiFree };
}

test('Home preload 只暴露主页和公共能力并固定绑定工作区入口', async () => {
  const { api, calls } = loadScopedPreload('home');
  assert.deepEqual(
    Object.keys(api).sort(),
    ['account', 'home', 'license', 'ui', 'updates'],
  );
  assert.equal(api.browser, undefined);
  assert.equal(api.software, undefined);
  await api.home.openBrowser();
  await api.home.openSoftware();
  assert.deepEqual(calls, [
    ['workspace-open-browser', undefined],
    ['workspace-open-software', undefined],
  ]);
});

test('Browser preload 不暴露软件或 Home 控制能力', () => {
  const { api } = loadScopedPreload('browser');
  assert.equal(typeof api.browser.getHistory, 'function');
  assert.equal(typeof api.ai.chat, 'function');
  assert.equal(typeof api.automation.runCard, 'function');
  assert.equal(typeof api.network.applyToBrowser, 'function');
  assert.equal(typeof api.workspace.getType, 'function');
  assert.equal(api.software, undefined);
  assert.equal(api.home, undefined);
  assert.equal(Object.isFrozen(api), true);
});

test('Software preload 不暴露浏览器、网络或 Home 控制能力', () => {
  const { api } = loadScopedPreload('software');
  assert.deepEqual(
    Object.keys(api).sort(),
    ['software', 'softwareAi', 'softwareAutomation', 'workspace'],
  );
  assert.equal(api.browser, undefined);
  assert.equal(api.network, undefined);
  assert.equal(api.home, undefined);
  assert.equal(Object.isFrozen(api), true);
});
