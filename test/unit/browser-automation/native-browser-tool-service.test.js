'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createNativeBrowserToolService,
} = require('../../../src/app/main/features/browser-automation/native-browser-tool-service');

function createService(overrides = {}) {
  const calls = [];
  const manager = {
    listStates: () => [
      { profileId: 'ready', pid: 10, status: 'ready', startedAt: 1 },
      { profileId: 'closed', pid: 11, status: 'closed' },
    ],
    dispatchAutomation: async (...args) => {
      calls.push(['automation', ...args]);
      return { result: { success: true, items: [] } };
    },
    navigate: async (...args) => { calls.push(['navigate', ...args]); return {}; },
    sendChromiumCommand: async (...args) => {
      calls.push(['command', ...args]);
      if (args[1] === 'get-session-data') {
        return { result: { pageUrl: 'https://example.com/upload', cookies: [] } };
      }
      return { result: { success: true, tabs: [] } };
    },
    selectFiles: async (...args) => { calls.push(['files', ...args]); return {}; },
    ...overrides,
  };
  const service = createNativeBrowserToolService({
    browserRuntimeManager: manager,
    getTabs: () => new Map([['ready', { id: 'ready', title: '工作浏览器' }]]),
    cardStore: {
      read: () => ({ state: { items: [], selectedId: '' } }),
      write: (state) => state,
    },
    downloadService: { execute: async (input) => ({ action: input.action }) },
  });
  return { service, calls };
}

test('native service exposes only ready managed Chromium connections', () => {
  const { service } = createService();
  const connections = service.listConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].id, 'native:ready');
  assert.equal(connections[0].name, '工作浏览器');
  assert.equal(service.getConnection('native:ready').tools.length, 7);
});

test('native browser actions use Runtime commands and bind uploads to current origin', async () => {
  const { service, calls } = createService();
  await service.dispatch('native:ready', 'browser_tab', { action: 'list' });
  await service.dispatch('native:ready', 'browser_action', {
    action: 'upload_file', paths: ['D:\\AI-Workspace\\fixture.txt'], mode: 'open',
  });
  assert.equal(calls.some((entry) => entry[0] === 'command' && entry[2] === 'manage-tabs'), true);
  const selection = calls.find((entry) => entry[0] === 'files')[2];
  assert.equal(selection.pageUrl, 'https://example.com/upload');
});

test('native observe refs and submit actions remain usable without the extension', async () => {
  const { service, calls } = createService({
    dispatchAutomation: async (...args) => {
      calls.push(['automation', ...args]);
      if (args[1] === 'observe-page') {
        return { result: { success: true, items: [{ id: 'e1', selector: '#email' }] } };
      }
      return { result: { success: true } };
    },
  });
  await service.dispatch('native:ready', 'browser_observe', {});
  await service.dispatch('native:ready', 'browser_action', {
    action: 'type', ref: 'e1', text: 'demo@example.com', submit: true,
  });
  const actions = calls.filter((entry) => entry[0] === 'automation').map((entry) => entry[3]);
  assert.equal(actions[1].selector, '#email');
  assert.deepEqual(actions[2], { action: 'press_key', key: 'Enter' });
});

test('native mouse actions resolve observed refs to the exact element center', async () => {
  const { service, calls } = createService({
    dispatchAutomation: async (...args) => {
      calls.push(['automation', ...args]);
      if (args[1] === 'observe-page') {
        return {
          result: {
            success: true,
            items: [
              { id: 'e1', selector: 'div', x: 356, y: 568, width: 102, height: 30 },
              { id: 'e2', selector: 'span', x: 367, y: 569, width: 80, height: 29 },
            ],
          },
        };
      }
      return { result: { success: true } };
    },
  });
  await service.dispatch('native:ready', 'browser_observe', { keyword: '密码登录' });
  await service.dispatch('native:ready', 'browser_action', { action: 'click', ref: 'e1' });
  const action = calls.filter((entry) => entry[0] === 'automation')[1][3];
  assert.equal(action.selector, 'div');
  assert.equal(action.x, 407);
  assert.equal(action.y, 583);
});
