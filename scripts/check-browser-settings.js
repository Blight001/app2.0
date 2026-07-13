const assert = require('assert');
const {
  normalizeAiFreeBrowserSettings,
  parseCookieJson,
  parseLaunchArgs,
} = require('../src/app/main/utils/ai-free-browser-settings');
const {
  configureTabBrowserView,
  resolveTabBrowserProfile,
} = require('../src/app/main/utils/browser-disguise');

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

  let injectedScript = '';
  let appliedAcceptLanguage = '';
  let appliedProxy = null;
  const listeners = {};
  const webContents = {
    isDestroyed: () => false,
    setUserAgent: (_userAgent, acceptLanguage) => { appliedAcceptLanguage = acceptLanguage; },
    on: (name, listener) => { listeners[name] = listener; },
    executeJavaScript: async (script) => { injectedScript = script; },
    session: { setProxy: async (proxy) => { appliedProxy = proxy; } },
  };
  const profile = await resolveTabBrowserProfile({ browserSettings: settings });
  await configureTabBrowserView(webContents, {
    browserProfile: profile,
    browserProxy: { enabled: true, protocol: 'socks5', server: 'socks5://127.0.0.1:7897', username: 'u', password: 'p' },
  });
  // Parsing catches accidental interpolation of variables that only exist in
  // the target page, while the string assertions protect the main mappings.
  new Function(injectedScript); // eslint-disable-line no-new-func
  assert.ok(injectedScript.includes('AI-FREE-Test-UA'));
  assert.ok(injectedScript.includes('Asia/Shanghai'));
  assert.ok(injectedScript.includes('1920'));
  assert.ok(injectedScript.includes('getImageData'));
  assert.ok(injectedScript.includes('readPixels'));
  assert.ok(injectedScript.includes('getClientRects'));
  assert.ok(injectedScript.includes('requestAdapterInfo'));
  assert.ok(injectedScript.includes('ANGLE test renderer'));
  assert.ok(appliedAcceptLanguage.includes('zh-CN'));
  assert.equal(appliedProxy.proxyRules, 'socks5://127.0.0.1:7897');
  assert.equal(typeof listeners.login, 'function');
  assert.equal(typeof listeners['dom-ready'], 'function');
  console.log('browser settings checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
