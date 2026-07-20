'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(
  __dirname,
  '../../../src/assets/extensions/browser_automation/background/01_state_storage.js',
);
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const storage = {};
  const removed = [];
  const context = vm.createContext({
    console,
    URL,
    Date,
    Number,
    String,
    Array,
    Object,
    Promise,
    Map,
    CARD_SIDEBAR_STATE_KEY: 'sidebar',
    STANDALONE_PROGRESS_STATE_KEY: 'progress',
    standaloneSessions: new Map(),
    normalizeStandaloneSteps: (value) => value,
    saveCardCacheState: async () => {},
    getActiveTab: async () => ({ id: 7, url: 'https://example.com/page' }),
    readCookies: async () => [
      { name: 'sid', domain: '.example.com', path: '/', secure: true, storeId: 'store-1' },
      { name: '', domain: '.example.com' },
    ],
    runtimeStateStorage: {
      async get(keys) {
        return Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]]));
      },
      async set(values) { Object.assign(storage, plain(values)); },
      async remove(keys) { keys.forEach((key) => delete storage[key]); },
    },
    chrome: {
      tabs: { get: async () => ({ id: 7, url: 'https://example.com/page' }) },
      cookies: {
        remove: async (args) => { removed.push(args); return { name: args.name }; },
      },
      scripting: {
        executeScript: async () => [{ result: {
          clearedLocalStorageCount: 2,
          clearedSessionStorageCount: 1,
          clearedCacheStorageCount: 3,
          clearedIndexedDbCount: 4,
        } }],
      },
    },
  });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return { context, removed, storage };
}

test('当前页清理删除可定位 Cookie 并汇总页面存储清理结果', async () => {
  const data = fixture();
  const result = plain(await data.context.clearCurrentPageCache(7));

  assert.deepEqual(plain(data.removed), [{
    url: 'https://example.com/',
    name: 'sid',
    storeId: 'store-1',
  }]);
  assert.deepEqual(result, {
    success: true,
    tabId: 7,
    pageUrl: 'https://example.com/page',
    removedCookieCount: 1,
    clearedLocalStorageCount: 2,
    clearedSessionStorageCount: 1,
    clearedCacheStorageCount: 3,
    clearedIndexedDbCount: 4,
  });
});

test('进度状态保存时规范化字段，读取时保留可见性和数值进度', async () => {
  const data = fixture();
  const saved = plain(await data.context.saveStandaloneProgressState({
    tabId: '7',
    cardName: ' 卡片 ',
    stepIndex: '2',
    stepTotal: 5,
    progress: '40',
    running: true,
    visible: false,
  }));
  const loaded = plain(await data.context.loadStandaloneProgressState());

  assert.equal(saved.cardName, '卡片');
  assert.equal(saved.progress, 40);
  assert.equal(loaded.tabId, 7);
  assert.equal(loaded.stepIndex, 2);
  assert.equal(loaded.running, true);
  assert.equal(loaded.visible, false);
});
