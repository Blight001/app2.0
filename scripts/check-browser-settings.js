const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeAiFreeBrowserSettings,
  parseCookieJson,
  parseLaunchArgs,
} = require('../src/app/main/utils/ai-free-browser-settings');
const {
  buildBrowserProfileFromRegion,
  resolveTabBrowserProfile,
} = require('../src/app/main/utils/browser-profile');
const { makeUniqueBrowserName } = require('../src/app/main/ipc/register/settings');

async function main() {
  const settings = normalizeAiFreeBrowserSettings({
    os: 'win11',
    browserVersion: '147',
    ua: { mode: 'custom', value: 'AI-FREE-Test-UA' },
    secChUa: { mode: 'custom', brands: [{ brand: 'Chromium', version: '147' }] },
    language: { mode: 'custom', value: 'zh-CN' },
    timezone: { mode: 'custom', value: 'Asia/Shanghai' },
    proxy: { mode: 'custom', protocol: 'socks5', host: '127.0.0.1', port: 7897 },
    cookies: [{ name: 'token', value: 'x', domain: 'example.com' }],
    resolution: { mode: 'custom', width: 1920, height: 1080 },
    canvas: { mode: 'noise', seed: 'canvas-seed' },
    webglImage: { mode: 'noise', seed: 'webgl-seed' },
    webglMetadata: { mode: 'custom', vendor: 'Google Inc. (Intel)', renderer: 'ANGLE test renderer' },
    webgpu: { mode: 'webgl' },
    audioContext: { mode: 'noise', seed: 'audio-seed' },
    clientRects: { mode: 'noise', seed: 'rect-seed' },
    speechVoices: { mode: 'noise', seed: 'voice-seed' },
    cpu: 12,
    memory: 16,
    launchArgs: { mode: 'custom', value: '--disable-features=Translate\n--force-color-profile=srgb' },
  });
  assert.equal(settings.locale, 'zh-CN');
  assert.equal(settings.timezoneId, 'Asia/Shanghai');
  assert.equal(settings.hardwareConcurrency, 12);
  assert.equal(settings.screen.width, 1920);
  assert.equal(settings.proxy.protocol, 'socks5');
  assert.equal(parseCookieJson(settings)[0].name, 'token');
  assert.deepEqual(parseLaunchArgs(settings), ['--disable-features=Translate', '--force-color-profile=srgb']);
  assert.equal(makeUniqueBrowserName('新建窗口', []), '新建窗口');
  assert.equal(makeUniqueBrowserName('新建窗口', [{ id: '1', name: '新建窗口' }]), '新建窗口[2]');
  assert.equal(makeUniqueBrowserName('新建窗口', [{ id: '1', name: '新建窗口' }, { id: '2', name: '新建窗口[2]' }]), '新建窗口[3]');
  assert.equal(makeUniqueBrowserName('已命名', [{ id: '1', name: '已命名' }], '1'), '已命名');
  const shellHtml = fs.readFileSync(path.join(__dirname, '../src/app/views/app-shell.html'), 'utf8');
  const shellTabsScript = fs.readFileSync(path.join(__dirname, '../src/app/renderer/controllers/pages/app-shell/tabs.js'), 'utf8');
  assert.ok(shellHtml.includes('id="new-browser-window-btn"'));
  assert.ok(shellTabsScript.includes("IPC.invoke('create-independent-browser'"));
  assert.ok(shellTabsScript.includes("IPC.invoke('rename-browser-history'"));
  const settingsIpcScript = fs.readFileSync(path.join(__dirname, '../src/app/main/ipc/register/settings.js'), 'utf8');
  const sidebarSettingsScript = fs.readFileSync(path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/browser-settings.js'), 'utf8');
  assert.ok(settingsIpcScript.includes("ipcMain.handle('delete-browser-history'"));
  assert.ok(sidebarSettingsScript.includes("electronAPI.invoke('delete-browser-history'"));
  const messageModalScript = fs.readFileSync(path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/shared/message-modal.js'), 'utf8');
  assert.ok(sidebarSettingsScript.includes('MessageModal.showConfirmDialog'));
  assert.ok(sidebarSettingsScript.includes('MessageModal.showPromptDialog'));
  assert.ok(!sidebarSettingsScript.includes('window.confirm('));
  assert.ok(!sidebarSettingsScript.includes('window.prompt('));
  assert.ok(messageModalScript.includes('showPromptDialog'));
  const uiIpcScript = fs.readFileSync(path.join(__dirname, '../src/app/main/ipc/register/ui.js'), 'utf8');
  const aiControlScript = fs.readFileSync(path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/ai-control.js'), 'utf8');
  assert.ok(uiIpcScript.includes("ipcMain.handle('focus-sidebar-input'"));
  assert.ok(aiControlScript.includes("electronAPI.invoke('focus-sidebar-input'"));
  assert.ok(settingsIpcScript.includes('focusBrowser: false'));
  assert.ok(shellTabsScript.includes('beginTabRename(tabElement, { commitOnBlur: false })'));
  let geoLookupCalls = 0;
  const fastProfile = await resolveTabBrowserProfile({
    browserSettings: {},
    skipGeoLookup: true,
    httpGetUniversal: async () => { geoLookupCalls += 1; return new Promise(() => {}); },
  });
  assert.ok(fastProfile && fastProfile.locale);
  assert.equal(geoLookupCalls, 0);

  const geoStartedAt = Date.now();
  const geoCalls = [];
  const geoProfilePromise = resolveTabBrowserProfile({
    browserSettings: {},
    httpGetUniversal: async (endpoint, timeoutMs) => {
      geoCalls.push({ endpoint, timeoutMs });
      if (endpoint.includes('ipapi.co')) return new Promise(() => {});
      if (endpoint.includes('ipwho.is')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          ok: true,
          body: {
            success: true,
            ip: '203.0.113.8',
            country_code: 'SG',
            country: 'Singapore',
            region: 'Singapore',
            city: 'Singapore',
          },
        };
      }
      throw new Error('service unavailable');
    },
  });
  const sharedGeoProfilePromise = resolveTabBrowserProfile({
    browserSettings: {},
    httpGetUniversal: async () => { throw new Error('并发探测应复用同一请求'); },
  });
  const [geoProfile, sharedGeoProfile] = await Promise.all([geoProfilePromise, sharedGeoProfilePromise]);
  assert.equal(geoProfile.region, 'sg');
  assert.equal(sharedGeoProfile.region, 'sg');
  assert.equal(geoProfile.sourceCountryCode, 'SG');
  assert.equal(geoProfile.sourceIp, '203.0.113.8');
  assert.ok(Date.now() - geoStartedAt < 1000, 'IP 地区探测不应等待悬挂的服务');
  assert.equal(geoCalls.length, 3);
  assert.ok(geoCalls.every((call) => call.timeoutMs === 3000));

  const cachedProfile = await resolveTabBrowserProfile({
    browserSettings: {},
    httpGetUniversal: async () => { throw new Error('缓存命中时不应发起请求'); },
  });
  assert.equal(cachedProfile.region, 'sg');

  const profile = buildBrowserProfileFromRegion('cn', settings);
  assert.equal(profile.browserBrand, 'AI-FREE');
  assert.equal(profile.userAgent, 'AI-FREE-Test-UA');
  assert.equal(profile.locale, 'zh-CN');
  assert.equal(profile.timezoneId, 'Asia/Shanghai');
  assert.equal(profile.screen.width, 1920);
  assert.equal(profile.hardwareConcurrency, 12);
  console.log('browser settings checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
