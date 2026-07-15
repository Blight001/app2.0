const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTabHelpers } = require('../src/app/main/services/tab-helpers');

function createWindowSink() {
  const messages = [];
  return {
    messages,
    window: {
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => messages.push({ channel, payload }) },
    },
  };
}

test('tab payload reports the applied Chromium snapshot instead of pending settings', () => {
  const tabs = new Map([['browser-1', {
    id: 'browser-1',
    fixedTitle: '测试浏览器',
    runtimeType: 'chromium',
    runtimeStatus: 'ready',
    networkMagicApplied: false,
    browserProfile: {
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      sourceIp: '203.0.113.20',
      regionLabel: '日本',
    },
    browserSettings: {
      os: 'win11',
      language: { mode: 'ip' },
    },
  }]]);
  const appliedProfile = {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    proxyServer: '',
    hardwareAcceleration: false,
    extensionCount: 3,
    browserSettings: {
      os: 'win10',
      browserVersion: '140',
      kernelVersion: 'auto',
      cookieCount: 2,
      language: { mode: 'custom', value: 'zh-CN' },
      timezone: { mode: 'custom', value: 'Asia/Shanghai' },
      hardwareAcceleration: false,
    },
    browserEnvironment: {
      browserBrand: 'AI-FREE',
      browserType: 'chrome',
      browserVersion: '140.0.0.0',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      sourceIp: '198.51.100.10',
      regionLabel: '中国大陆',
    },
  };
  const helpers = createTabHelpers({
    getTabs: () => tabs,
    getActiveTabId: () => 'browser-1',
    browserRuntimeManager: {
      getState: () => ({ bounds: { width: 1280, height: 720 } }),
      chromium: { instances: new Map([['browser-1', { appliedProfile }]]) },
    },
  });

  const [payload] = helpers.buildTabsPayload();
  assert.equal(payload.browserProfile.locale, 'zh-CN');
  assert.equal(payload.browserProfile.timezoneId, 'Asia/Shanghai');
  assert.equal(payload.browserProfile.sourceIp, '198.51.100.10');
  assert.equal(payload.browserSettings.os, 'win10');
  assert.equal(payload.browserSettings.cookieCount, 2);
  assert.equal(payload.browserSettings.language.value, 'zh-CN');
  assert.equal(payload.networkMagicEnabled, false);
  assert.deepEqual(payload.runtimeEnvironment, {
    windowWidth: 1280,
    windowHeight: 720,
    hardwareAcceleration: false,
    extensionCount: 3,
  });
});

test('tab payload exposes network magic only when it is applied to that browser', () => {
  const tab = {
    id: 'browser-2',
    title: '代理浏览器',
    runtimeType: 'chromium',
    runtimeStatus: 'ready',
    networkMagicApplied: true,
    browserProfile: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  };
  const helpers = createTabHelpers({
    getTabs: () => new Map([[tab.id, tab]]),
    getActiveTabId: () => tab.id,
    browserRuntimeManager: {
      chromium: {
        instances: new Map([[tab.id, {
          appliedProfile: {
            locale: 'ja-JP',
            timezoneId: 'Asia/Tokyo',
            proxyServer: 'http://127.0.0.1:7890',
            browserEnvironment: tab.browserProfile,
          },
        }]]),
      },
    },
  });

  assert.equal(helpers.buildTabsPayload()[0].networkMagicEnabled, true);
  tab.networkMagicApplied = false;
  assert.equal(helpers.buildTabsPayload()[0].networkMagicEnabled, false);
});

test('update-tabs sends the same applied environment to the shell', () => {
  const sink = createWindowSink();
  const tabs = new Map([['browser-3', {
    id: 'browser-3', fixedTitle: '窗口', runtimeType: 'chromium', runtimeStatus: 'ready',
  }]]);
  const helpers = createTabHelpers({
    getTabs: () => tabs,
    getMainWindow: () => sink.window,
    getActiveTabId: () => 'browser-3',
  });

  helpers.updateTabs(true);
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.messages[0].channel, 'update-tabs');
  assert.equal(sink.messages[0].payload[0].title, '窗口');
});

test('tab tooltip covers every basic and advanced browser setting in Chinese', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../src/app/renderer/controllers/pages/app-shell/tabs.js',
  ), 'utf8');
  const expectedLabels = [
    '浏览器名称：', '已加载扩展：', '【基础设置】', '操作系统：', '浏览器版本：',
    '内核版本：', '代理设置：', 'Cookie：', '启动主页：', '【高级设置】',
    'User Agent：', '用户代理（UA）：', 'Sec-CH-UA：', '语言：', '网页请求语言：',
    '时区：', 'WebRTC：', '地理位置权限：', '地理位置：', '分辨率：', '字体：',
    'Canvas：', 'WebGL 图像：', 'WebGL 元数据：', 'WebGL 厂商：',
    'WebGL 渲染器：', 'WebGPU：', 'AudioContext：', 'ClientRects：',
    '语音列表：', 'CPU：', '内存：', '设备名称：', 'MAC 地址：',
    '禁止跟踪（DNT）：', 'SSL：', '端口扫描保护：', '端口扫描白名单：',
    '硬件加速：', '启动参数：',
  ];
  expectedLabels.forEach((label) => assert.ok(source.includes(label), `missing tooltip label: ${label}`));
  assert.match(source, /网络魔法：已开启（当前浏览器已应用）/);
  assert.doesNotMatch(source, /`代理模式:/);
  assert.doesNotMatch(source, /`tabId:/);
  assert.doesNotMatch(source, /`accountId:/);
  assert.doesNotMatch(source, /`Accept-Language:/);
  assert.doesNotMatch(source, /`UA:/);
});
