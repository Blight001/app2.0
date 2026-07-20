'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const target = require.resolve('../../../src/app/main/services/ai-browser-window-tools');
const historyDependency = require.resolve('../../../src/app/main/features/browser/browser-history-service');
const storeDependency = require.resolve('../../../src/app/main/ipc/register/store-utils');
const settingsDependency = require.resolve('../../../src/app/main/utils/ai-free-browser-settings');
const vipDependency = require.resolve('../../../src/app/main/utils/vip-access');

let history;
let nextId;
let writes;

function installDependencies({ vip = true } = {}) {
  history = [
    { id: 'history-1', name: 'Primary', url: 'https://one.test', tabId: 'tab-1', isOpen: true },
    { id: 'history-2', name: 'Duplicate', url: 'https://two.test' },
    { id: 'history-3', name: 'Duplicate', url: 'https://three.test' },
  ];
  nextId = 10;
  writes = [];
  require.cache[historyDependency] = { exports: {
    DEFAULT_BROWSER_WINDOW_NAME: 'New window',
    DEFAULT_BROWSER_WINDOW_URL: 'chrome://newtab/',
    createBrowserHistoryId: () => `history-${nextId++}`,
    makeUniqueBrowserName: (name, records) => {
      const base = String(name || 'New window').trim();
      return records.some((item) => item.name === base) ? `${base} (2)` : base;
    },
    openBrowserHistoryRecord: async (_ui, id) => ({ historyId: id, tabId: 'opened-tab', name: history.find((item) => item.id === id)?.name }),
    readBrowserHistorySafe: () => history.map((item) => ({ ...item })),
    renameBrowserHistoryRecord: (_ui, id, name) => {
      const item = history.find((record) => record.id === id);
      item.name = name;
      return { historyId: id, name, tabId: item.tabId || '' };
    },
    serializeBrowserHistory: (records) => records.map((item) => ({ ...item })),
    syncOpenTabsToBrowserHistory: () => history,
    writeBrowserHistorySafe: (records) => {
      history = records.map((item) => ({ ...item }));
      writes.push(history);
      return true;
    },
  } };
  require.cache[storeDependency] = { exports: { readStoreConfigSafe: () => ({ aiFreeBrowserSettings: { homepage: { mode: 'custom', url: 'https://home.test' } } }) } };
  require.cache[settingsDependency] = { exports: { normalizeAiFreeBrowserSettings: (value) => value } };
  require.cache[vipDependency] = { exports: { FREE_BROWSER_WINDOW_LIMIT: 2, resolveVipAccess: () => ({ isVip: vip }) } };
  delete require.cache[target];
  return require(target);
}

test('window tool registry lists records and validates lookup arguments', async () => {
  const { createAiBrowserWindowTools } = installDependencies();
  assert.throws(() => createAiBrowserWindowTools({}), /缺少 ui 桥接/);
  const logLines = [];
  const tools = createAiBrowserWindowTools({
    ui: { getTabs: () => new Map([['tab-1', { id: 'tab-1', browserHistoryId: 'history-1' }]]) },
    logger: { log: (line) => logLines.push(line) },
  });
  assert.equal(tools.tools.length, 5);
  assert.equal(tools.has('software_window_list'), true);
  assert.equal(tools.has(' unknown '), false);
  const listed = await tools.execute('software_window_list');
  assert.equal(listed.total, 3);
  assert.equal(listed.open_count, 1);
  assert.equal(listed.items[0].history_id, 'history-1');
  assert.match(logLines[0], /software_window_list/);
  await assert.rejects(tools.execute('missing'), /未知的软件窗口工具/);
  await assert.rejects(tools.execute('software_window_open', {}), /history_id 或 name/);
  await assert.rejects(tools.execute('software_window_open', { history_id: 'missing' }), /记录不存在/);
  await assert.rejects(tools.execute('software_window_open', { name: 'Duplicate' }), /2 个窗口/);
  const opened = await tools.execute('software_window_open', { name: 'primary' });
  assert.equal(opened.history_id, 'history-1');
  assert.equal(opened.tab_id, 'opened-tab');
});

test('create validates access and URL, persists before opening, and rolls back failures', async () => {
  let addShouldFail = false;
  const { createAiBrowserWindowTools } = installDependencies();
  const tabs = new Map();
  const changes = [];
  const tools = createAiBrowserWindowTools({
    licenseCache: { getSnapshot: () => ({}) },
    ui: {
      addTab: async (url) => {
        if (addShouldFail) throw new Error('runtime failed');
        assert.equal(url, 'https://home.test');
        return 'new-tab';
      },
      getTabs: () => tabs,
      sendToSide: (channel) => changes.push(channel),
    },
  });
  await assert.rejects(tools.execute('software_window_create', { url: 'file:///secret' }), /http\/https/);
  const created = await tools.execute('software_window_create', { name: 'Primary' });
  assert.equal(created.name, 'Primary (2)');
  assert.equal(created.url, 'https://home.test');
  assert.equal(history.some((item) => item.id === created.history_id), true);
  assert.deepEqual(changes, ['browser-history-changed']);
  assert.equal(writes.length, 1);

  addShouldFail = true;
  await assert.rejects(tools.execute('software_window_create', { name: 'Failure' }), /runtime failed/);
  assert.equal(history.some((item) => item.name === 'Failure'), false);
  assert.equal(writes.length, 3);

  const freeModule = installDependencies({ vip: false });
  const limited = freeModule.createAiBrowserWindowTools({
    licenseCache: { getSnapshot: () => ({}) },
    ui: { getTabs: () => new Map([['a', {}], ['b', {}]]), addTab: async () => 'x' },
  });
  await assert.rejects(limited.execute('software_window_create'), /普通用户最多/);
});

test('rename and close update open windows while preserving closed records', async () => {
  const { createAiBrowserWindowTools } = installDependencies();
  const closed = [];
  const tabs = new Map([['tab-1', { id: 'tab-1', browserHistoryId: 'history-1' }]]);
  const tools = createAiBrowserWindowTools({
    ui: {
      closeTab: async (id) => closed.push(id),
      getTabs: () => tabs,
      sendToSide() {},
    },
  });
  await assert.rejects(tools.execute('software_window_rename', { history_id: 'history-1' }), /缺少新名称/);
  const renamed = await tools.execute('software_window_rename', { history_id: 'history-1', new_name: 'Renamed' });
  assert.equal(renamed.previous_name, 'Primary');
  assert.equal(renamed.name, 'Renamed');
  const openClosed = await tools.execute('software_window_close', { history_id: 'history-1' });
  assert.equal(openClosed.closed, true);
  assert.deepEqual(closed, ['tab-1']);
  const alreadyClosed = await tools.execute('software_window_close', { history_id: 'history-2' });
  assert.equal(alreadyClosed.closed, false);
});
