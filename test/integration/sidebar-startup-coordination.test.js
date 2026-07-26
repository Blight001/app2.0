'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function createButton(textContent = '') {
  return {
    dataset: {},
    disabled: false,
    textContent,
  };
}

test('自动开启网络魔法在配置获取完成前禁用主开关', async () => {
  let finishStart;
  const startPending = new Promise((resolve) => { finishStart = resolve; });
  const vpnBtn = createButton('开启网络魔法');
  const startBtn = createButton('启动 Clash Mini');
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    window: {
      aiFree: {
        network: {
          getAutoStartEnabled: async () => ({ ok: true, enabled: true }),
          getClashStatus: async () => ({ running: false }),
        },
      },
    },
    autoStartClashMiniInFlight: false,
    hasValidatedInSession: true,
    isVpnEnabled: false,
    isLicenseValidated: () => true,
    applyVpnActionAvailability: () => {},
    updateClashVpnButton: (button, state) => {
      button.textContent = state.enabled ? '关闭网络魔法' : '开启网络魔法';
    },
  });
  vm.runInContext(
    readSource('src/app/renderer/controllers/shared/controller-utils.js'),
    context,
  );
  context.withBusyButton = context.window.RendererControllerUtils.withBusyButton;
  vm.runInContext(
    readSource('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/vpn-lifecycle.js'),
    context,
  );
  context.startClashMiniFlow = () => startPending;

  const task = context.autoStartNetworkMagicIfEligible({ startBtn, vpnBtn });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(vpnBtn.disabled, true);
  assert.equal(vpnBtn.dataset.busy, '1');
  assert.equal(vpnBtn.textContent, '正在开启魔法请稍等');

  finishStart();
  await task;
  assert.equal(vpnBtn.disabled, false);
  assert.equal(vpnBtn.dataset.busy, '0');
  assert.equal(vpnBtn.textContent, '开启网络魔法');
});

test('侧边栏启动时主动读取并渲染浏览器记录', async () => {
  const listeners = new Map();
  const refreshButton = {
    disabled: false,
    setAttribute() {},
  };
  const historyList = {
    innerHTML: '',
    setAttribute() {},
  };
  let historyReads = 0;
  let renderedHistory = [];
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    window: {
      aiFree: {
        browser: {
          getHistory: async () => {
            historyReads += 1;
            return { ok: true, history: [{ id: 'history-1', name: '浏览器 1' }] };
          },
        },
      },
      createAiFreeBrowserHistoryView: (deps) => ({
        renderBrowserHistory: () => { renderedHistory = deps.getBrowserHistory(); },
        renderBrowserProfileAudit: () => {},
        getSelectedBrowserHistory: () => [],
        hideBrowserHistoryContextMenu: () => {},
        formatBrowserHistoryDateTime: () => '',
      }),
      bindAiFreeBrowserSettingsEvents: () => {},
    },
    document: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      getElementById: (id) => ({
        'refresh-browser-history': refreshButton,
        'browser-history-list': historyList,
      })[id] || null,
      querySelectorAll: () => [],
    },
  });
  vm.runInContext(
    readSource('src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/browser-settings.js'),
    context,
  );

  listeners.get('DOMContentLoaded')();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(historyReads, 1);
  assert.equal(renderedHistory.length, 1);
  assert.equal(renderedHistory[0].id, 'history-1');
});
