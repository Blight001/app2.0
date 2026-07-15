const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createAppConsoleBridge } = require('../src/app/main/runtime/app-console');
const {
  isClashMiniNetworkRequestLog,
} = require('../src/app/main/ipc/register/clash-mini-core');

test('debug-only network logs are isolated from regular console history and senders', () => {
  const regularLines = [];
  const debugLines = [];
  const bridge = createAppConsoleBridge({
    getSenders: () => [{ send: (_channel, entry) => regularLines.push(entry) }],
    getDebugSenders: () => [{ send: (_channel, entry) => debugLines.push(entry) }],
  });

  bridge.pushDebugOnly('warn', [
    '[Clash Mini]',
    'time="2026-07-15" level=warning msg="[TCP] dial DIRECT timeout"',
    { stream: 'stdout' },
  ]);

  assert.equal(regularLines.length, 0);
  assert.equal(bridge.getHistory().length, 0);
  assert.equal(debugLines.length, 1);
  assert.equal(bridge.getDebugHistory().length, 1);
  assert.match(debugLines[0].text, /^\[Clash Mini\].*\[TCP\]/);
});

test('only Mihomo network request stream lines use the exclusive debug route', () => {
  assert.equal(isClashMiniNetworkRequestLog(
    'time="2026-07-15" level=info msg="[TCP] 127.0.0.1:1 --> example.com:443"',
    { stream: 'stdout' },
  ), true);
  assert.equal(isClashMiniNetworkRequestLog(
    'time="2026-07-15" level=info msg="[UDP] 127.0.0.1:1 --> 8.8.8.8:53"',
    { stream: 'stdout' },
  ), true);
  assert.equal(isClashMiniNetworkRequestLog('Clash Meta started', { stream: 'stdout' }), false);
  assert.equal(isClashMiniNetworkRequestLog('[TCP] lifecycle text without child stream', {}), false);
});

test('HTTP request addresses use the debug-only sink instead of console.log', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/app/main/lib/http-client/transport-request.js'),
    'utf8',
  );
  assert.match(source, /writeDebugConsoleOnly\('info', `\[HTTP\] 请求地址:/);
  assert.doesNotMatch(source, /console\.log\(`\[HTTP\] 请求地址:/);
});

test('debug console history is separate from sidebar app console history', () => {
  const bridgeSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/composition/create-ui-bridge.js'),
    'utf8',
  );
  const shellSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/services/app-shell.js'),
    'utf8',
  );
  assert.match(bridgeSource, /getDebugConsoleHistory:\s*\(\) => appConsoleBridge\.getDebugHistory\(\)/);
  assert.match(shellSource, /sendToSide\('app-console-history',[\s\S]*?getAppConsoleHistory/);
  assert.doesNotMatch(shellSource, /sendToSide\('app-console-history',[\s\S]*?getDebugConsoleHistory/);
});

test('the separate debug console opens in packaged and development builds', () => {
  const shellSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/services/app-shell.js'),
    'utf8',
  );
  const lifecycleSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/services/app-lifecycle.js'),
    'utf8',
  );
  const createFlow = shellSource.slice(
    shellSource.indexOf('function createDevConsoleWindow()'),
    shellSource.indexOf('function createControlPanelWindow()'),
  );
  assert.doesNotMatch(createFlow, /if \(!isDevMode\)/);
  assert.match(lifecycleSource, /if \(typeof createDevConsoleWindow === 'function'\)/);
  assert.doesNotMatch(lifecycleSource, /if \(isDevMode && typeof createDevConsoleWindow/);
});

test('Clash configuration import logs one compact success summary without YAML previews', () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/ipc/register/clash.js'),
    'utf8',
  );
  const coreSource = fs.readFileSync(
    path.join(__dirname, '../src/app/main/ipc/register/clash-mini-core.js'),
    'utf8',
  );
  const sidebarSource = fs.readFileSync(
    path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/vpn.js'),
    'utf8',
  );
  const combined = `${mainSource}\n${coreSource}\n${sidebarSource}`;

  assert.equal((combined.match(/Clash 配置导入完成/g) || []).length, 1);
  for (const removedMessage of [
    'Clash配置摘要',
    '客户端配置摘要',
    'Clash 运行配置生成预览',
    'Clash 运行配置内容预览',
    'Clash 运行配置内容长度',
    'Clash 运行配置已硬刷新',
  ]) {
    assert.doesNotMatch(combined, new RegExp(removedMessage));
  }
});
