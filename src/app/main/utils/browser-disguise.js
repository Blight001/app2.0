const path = require('path');
const { app } = require('electron');
const {
  REGION_PRESETS,
  getBrowserRegionPreset,
  inferBrowserRegionKeyFromLocale,
} = require('./browser-region');
const { registerRequestHeaderTransformer } = require('./session-request-headers');

const TAB_PLATFORM = 'Win32';
const GEO_IP_ENDPOINTS = [
  'https://ipapi.co/json/',
  'https://ipwho.is/',
  'https://ipinfo.io/json',
];

let cachedBrowserRegionProfile = null;
let cachedBrowserRegionProfilePromise = null;
const configuredWebContents = new WeakMap();
const proxyCredentialsByWebContents = new WeakMap();

// 获取/读取/解析：getChromiumVersion的具体业务逻辑。
function getChromiumVersion() {
  const version = String(process.versions && process.versions.chrome ? process.versions.chrome : '').trim();
  if (version) {
    return version;
  }
  return '122.0.0.0';
}

// 获取/读取/解析：getChromiumMajorVersion的具体业务逻辑。
function getChromiumMajorVersion() {
  const version = getChromiumVersion();
  const major = version.split('.')[0];
  return major || '122';
}

// 获取/读取/解析：getDefaultLocale的具体业务逻辑。
function getDefaultLocale() {
  try {
    if (app && typeof app.getLocale === 'function') {
      const locale = String(app.getLocale() || '').trim().replace('_', '-');
      if (locale) {
        return locale;
      }
    }
  } catch (_) {}

  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      return String(intlLocale).trim().replace('_', '-') || 'en-US';
    }
  } catch (_) {}

  return 'en-US';
}

// 格式化/规范化：normalizeLocale的具体业务逻辑。
function normalizeLocale(locale) {
  const raw = String(locale || '').trim().replace('_', '-');
  return raw || getDefaultLocale();
}

// 格式化/规范化：normalizeRegionKey的具体业务逻辑。
function normalizeRegionKey(region) {
  return String(region || '').trim().toLowerCase().replace(/\s+/g, '');
}

// 处理：inferBrowserRegionKeyFromCountryCode的具体业务逻辑。
function inferBrowserRegionKeyFromCountryCode(countryCode) {
  const normalized = normalizeRegionKey(countryCode).replace(/[^a-z0-9]/g, '');
  if (!normalized) {
    return null;
  }

  if (REGION_PRESETS[normalized]) {
    return normalized;
  }

  const aliasMap = {
    cn: 'cn',
    hk: 'hk',
    tw: 'tw',
    jp: 'jp',
    kr: 'kr',
    sg: 'sg',
    us: 'us',
    gb: 'gb',
    uk: 'gb',
    unitedkingdom: 'gb',
    greatbritain: 'gb',
    britain: 'gb',
    de: 'de',
    fr: 'fr',
    ca: 'ca',
    au: 'au',
    nl: 'nl',
    in: 'in',
    ru: 'ru',
    th: 'th',
    china: 'cn',
    mainlandchina: 'cn',
    peoplesrepublicofchina: 'cn',
    hongkong: 'hk',
    hongkongsar: 'hk',
    taiwan: 'tw',
    republicofchina: 'tw',
    southkorea: 'kr',
    korea: 'kr',
    singapore: 'sg',
    unitedstates: 'us',
    usa: 'us',
    america: 'us',
    canada: 'ca',
    australia: 'au',
    netherlands: 'nl',
    india: 'in',
    russia: 'ru',
    thailand: 'th',
  };

  return aliasMap[normalized] || null;
}

// 处理：inferBrowserRegionKeyFromIpInfo的具体业务逻辑。
function inferBrowserRegionKeyFromIpInfo(info = {}) {
  const countryCode = String(
    info.country_code
    || info.countryCode
    || info.country
    || info.country_name
    || info.countryName
    || ''
  ).trim();
  const regionKey = inferBrowserRegionKeyFromCountryCode(countryCode);
  if (regionKey) {
    return regionKey;
  }

  const locale = String(info.locale || info.language || '').trim();
  if (locale) {
    return inferBrowserRegionKeyFromLocale(locale);
  }

  return null;
}

// 获取/读取/解析：getAcceptLanguageFromLocale的具体业务逻辑。
function getAcceptLanguageFromLocale(locale) {
  const normalized = normalizeLocale(locale);
  const primary = normalized.split('-')[0] || 'en';

  if (primary === 'zh') {
    return `${normalized},${primary};q=0.9,en-US;q=0.8,en;q=0.7`;
  }

  return `${normalized},${primary};q=0.9,en-US;q=0.8,en;q=0.7`;
}

function getTimezoneOffsetMinutes(timezoneId) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezoneId,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    return -Math.round((localAsUtc - now.getTime()) / 60000);
  } catch (_) {
    return new Date().getTimezoneOffset();
  }
}

// 创建/初始化：buildBrowserProfileFromRegion的具体业务逻辑。
function buildBrowserProfileFromRegion(regionKey, browserSettings = {}, geoInfo = {}) {
  const preset = getBrowserRegionPreset(regionKey);
  const locale = normalizeLocale(
    browserSettings.locale
    || browserSettings.browser_locale
    || browserSettings.browserLocale
    || preset?.locale
    || getDefaultLocale()
  );
  const timezoneId = String(
    browserSettings.timezone_id
    || browserSettings.timezoneId
    || preset?.timezoneId
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC'
  ).trim() || 'UTC';
  const acceptLanguage = String(
    browserSettings.accept_language
    || browserSettings.acceptLanguage
    || preset?.acceptLanguage
    || getAcceptLanguageFromLocale(locale)
  ).trim();
  const browserType = 'chrome';
  // 「内核版本」优先级高于「浏览器版本」：Chrome 的 UA 版本即引擎版本，用户显式指定内核版本时应作为准。
  // kernelVersion 为空或 'auto' 时回退到浏览器版本，再回退到当前运行时内核。
  const kernelVersionRaw = String(browserSettings.kernelVersion || '').trim();
  const kernelMajor = kernelVersionRaw && kernelVersionRaw.toLowerCase() !== 'auto' && /^\d/.test(kernelVersionRaw)
    ? kernelVersionRaw.split('.')[0]
    : '';
  const major = String(kernelMajor || browserSettings.browserVersion || getChromiumMajorVersion()).split('.')[0] || getChromiumMajorVersion();
  const os = String(browserSettings.os || 'win11').toLowerCase();
  const osToken = os === 'win7' ? 'Windows NT 6.1' : os === 'win8' ? 'Windows NT 6.2' : 'Windows NT 10.0';
  const defaultUserAgent = `Mozilla/5.0 (${osToken}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const userAgent = String(browserSettings.ua?.mode === 'custom' ? browserSettings.ua?.value : (browserSettings.user_agent || browserSettings.userAgent || defaultUserAgent)).trim() || defaultUserAgent;
  const defaultBrands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not_A Brand', version: '24' },
  ];
  const selectedBrands = browserSettings.secChUa?.mode === 'custom' && Array.isArray(browserSettings.secChUa?.brands) && browserSettings.secChUa.brands.length
    ? browserSettings.secChUa.brands
    : defaultBrands;
  const fullVersionList = selectedBrands.map((item) => ({ brand: item.brand, version: `${String(item.version).split('.')[0]}.0.0.0` }));
  const languages = Array.from(new Set([
    locale,
    locale.split('-')[0],
    'en',
  ].filter(Boolean)));

  return {
    browserType,
    browserBrand: 'Google Chrome',
    browserVersion: `${major}.0.0.0`,
    majorVersion: major,
    uaFullVersion: `${major}.0.0.0`,
    region: regionKey || '',
    regionLabel: preset?.label || '',
    sourceIp: String(geoInfo.sourceIp || '').trim(),
    sourceCountryCode: String(geoInfo.sourceCountryCode || '').trim(),
    sourceCountry: String(geoInfo.sourceCountry || '').trim(),
    sourceRegion: String(geoInfo.sourceRegion || '').trim(),
    sourceCity: String(geoInfo.sourceCity || '').trim(),
    geoEndpoint: String(geoInfo.endpoint || '').trim(),
    locale,
    timezoneId,
    timezoneOffset: getTimezoneOffsetMinutes(timezoneId),
    acceptLanguage,
    userAgent,
    uaBrands: selectedBrands,
    uaFullVersionList: fullVersionList,
    platformVersion: String(browserSettings.platform_version || browserSettings.platformVersion || (os === 'win11' ? '15.0.0' : os === 'win10' ? '10.0.0' : os === 'win8' ? '6.2.0' : '6.1.0')).trim(),
    architecture: String(browserSettings.architecture || 'x86').trim() || 'x86',
    bitness: String(browserSettings.bitness || '64').trim() || '64',
    model: String(browserSettings.model || '').trim(),
    wow64: browserSettings.wow64 === true,
    viewport: browserSettings.viewport && typeof browserSettings.viewport === 'object'
      ? browserSettings.viewport
      : { width: 1366, height: 768 },
    screen: browserSettings.screen && typeof browserSettings.screen === 'object'
      ? browserSettings.screen
      : {
          width: 1366,
          height: 768,
          availWidth: 1366,
          availHeight: 728,
          availLeft: 0,
          availTop: 0,
          colorDepth: 24,
          pixelDepth: 24,
        },
    colorScheme: String(browserSettings.color_scheme || browserSettings.colorScheme || 'light').trim() || 'light',
    deviceScaleFactor: Number.isFinite(Number(browserSettings.device_scale_factor || browserSettings.deviceScaleFactor))
      ? Math.max(0.5, Number(browserSettings.device_scale_factor || browserSettings.deviceScaleFactor))
      : 1,
    hardwareConcurrency: Number.isFinite(Number(browserSettings.hardware_concurrency || browserSettings.hardwareConcurrency))
      ? Math.max(1, Number(browserSettings.hardware_concurrency || browserSettings.hardwareConcurrency))
      : 8,
    deviceMemory: Number.isFinite(Number(browserSettings.device_memory || browserSettings.deviceMemory))
      ? Math.max(1, Number(browserSettings.device_memory || browserSettings.deviceMemory))
      : 8,
    maxTouchPoints: Number.isFinite(Number(browserSettings.max_touch_points || browserSettings.maxTouchPoints))
      ? Math.max(0, Number(browserSettings.max_touch_points || browserSettings.maxTouchPoints))
      : 0,
    navigatorVendor: String(browserSettings.navigator_vendor || browserSettings.navigatorVendor || 'Google Inc.').trim() || 'Google Inc.',
    navigatorPlatform: String(browserSettings.navigator_platform || browserSettings.navigatorPlatform || TAB_PLATFORM).trim() || TAB_PLATFORM,
    webglVendor: String(browserSettings.webgl_vendor || browserSettings.webglVendor || 'Google Inc. (Intel)').trim() || 'Google Inc. (Intel)',
    webglRenderer: String(browserSettings.webgl_renderer || browserSettings.webglRenderer || 'ANGLE (Intel, Intel(R) Graphics, Direct3D11 vs_5_0 ps_5_0, D3D11)').trim() || 'ANGLE (Intel, Intel(R) Graphics, Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprintSettings: {
      ...browserSettings,
      geolocation: browserSettings.geolocation?.mode === 'ip' ? {
        ...browserSettings.geolocation,
        longitude: Number(geoInfo.raw?.longitude ?? geoInfo.raw?.lon ?? browserSettings.geolocation?.longitude ?? 0),
        latitude: Number(geoInfo.raw?.latitude ?? geoInfo.raw?.lat ?? browserSettings.geolocation?.latitude ?? 0),
        resolvedFromIp: !!geoInfo.raw,
      } : browserSettings.geolocation,
    },
    languages,
    plugins: [
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Plugin', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client' },
    ],
    mimeTypes: [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'application/x-nacl', suffixes: '', description: 'Native Client' },
      { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client' },
    ],
  };
}

// 创建/初始化：buildTabBrowserPreferences的具体业务逻辑。
function buildTabBrowserPreferences(partition) {
  return {
    partition,
    contextIsolation: true,
    // Inactive/minimized BrowserViews remain live MCP targets.
    backgroundThrottling: false,
    preload: path.join(__dirname, '../preload.js'),
  };
}

// 格式化/规范化：normalizeProxyServer的具体业务逻辑。
function normalizeProxyServer(proxyServer = '') {
  const raw = String(proxyServer || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hostname) {
      return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    }
  } catch (_) {}

  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^socks(?:4|5)?:\/\//i, '')
    .trim();
}

// 设置/更新/持久化：applyTabBrowserProxy的具体业务逻辑。
async function applyTabBrowserProxy(webContents, browserProxy = null, logger = console) {
  if (!webContents || typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return false;
  }

  const session = webContents.session;
  if (!session || typeof session.setProxy !== 'function') {
    return false;
  }

  if (!browserProxy || browserProxy.enabled === false) {
    try {
      await session.setProxy({ mode: 'direct' });
      proxyCredentialsByWebContents.delete(webContents);
      return true;
    } catch (error) {
      logger?.warn?.(`[BrowserProxy] 清理标签代理失败: ${error.message}`);
      return false;
    }
  }

  const proxyServer = normalizeProxyServer(browserProxy.server || browserProxy.proxyServer || '');
  if (!proxyServer) {
    return false;
  }

  const bypassRules = String(
    browserProxy.bypass
    || browserProxy.bypassRules
    || '<local>;127.0.0.1;localhost;::1'
  ).trim();
  const protocol = String(browserProxy.protocol || 'http').trim().toLowerCase();
  const proxyRules = protocol.startsWith('socks')
    ? `${protocol}://${proxyServer}`
    : [`http=${protocol}://${proxyServer}`, `https=${protocol}://${proxyServer}`].join(';');

  try {
    await session.setProxy({
      proxyRules,
      proxyBypassRules: bypassRules,
    });
    proxyCredentialsByWebContents.set(webContents, {
      username: String(browserProxy.username || ''),
      password: String(browserProxy.password || ''),
    });
    if (webContents.__aiFreeProxyLoginBound !== true && typeof webContents.on === 'function') {
      webContents.__aiFreeProxyLoginBound = true;
      webContents.on('login', (event, _details, authInfo, callback) => {
        if (!authInfo?.isProxy) return;
        const credentials = proxyCredentialsByWebContents.get(webContents);
        if (!credentials || (!credentials.username && !credentials.password)) return;
        event.preventDefault();
        callback(credentials.username, credentials.password);
      });
    }
    logger?.info?.(`[BrowserProxy] 标签代理已切换到 ${proxyServer}`);
    return true;
  } catch (error) {
    logger?.warn?.(`[BrowserProxy] 设置标签代理失败: ${error.message}`);
    return false;
  }
}

// 创建/初始化：buildTabDisguiseScript的具体业务逻辑。
function buildTabDisguiseScript(profile = {}) {
  const locale = normalizeLocale(profile.locale || getDefaultLocale());
  const major = String(profile.majorVersion || getChromiumMajorVersion()).trim() || getChromiumMajorVersion();
  const userAgent = String(profile.userAgent || `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`);
  const brands = JSON.stringify(profile.uaBrands || [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not.A/Brand', version: '24' },
  ]);
  const fullVersionList = JSON.stringify(profile.uaFullVersionList || [
    { brand: 'Chromium', version: `${major}.0.0.0` },
    { brand: 'Google Chrome', version: `${major}.0.0.0` },
    { brand: 'Not.A/Brand', version: '24.0.0.0' },
  ]);
  const languages = JSON.stringify(Array.isArray(profile.languages) && profile.languages.length > 0
    ? profile.languages
    : [locale, locale.split('-')[0], 'en'].filter(Boolean));
  const navigatorPlatform = String(profile.navigatorPlatform || TAB_PLATFORM);
  const browserBrand = String(profile.browserBrand || 'Google Chrome');
  const platformVersion = String(profile.platformVersion || '15.0.0');
  const architecture = String(profile.architecture || 'x86');
  const bitness = String(profile.bitness || '64');
  const uaFullVersion = String(profile.uaFullVersion || `${major}.0.0.0`);
  const deviceMemory = Number.isFinite(Number(profile.deviceMemory)) ? Number(profile.deviceMemory) : 8;
  const hardwareConcurrency = Number.isFinite(Number(profile.hardwareConcurrency)) ? Number(profile.hardwareConcurrency) : 8;
  const maxTouchPoints = Number.isFinite(Number(profile.maxTouchPoints)) ? Number(profile.maxTouchPoints) : 0;
  const viewport = profile.viewport && typeof profile.viewport === 'object' ? profile.viewport : {};
  const screen = profile.screen && typeof profile.screen === 'object' ? profile.screen : {};
  const webglVendor = String(profile.webglVendor || 'Google Inc. (Intel)');
  const webglRenderer = String(profile.webglRenderer || 'ANGLE (Intel, Intel(R) Graphics, Direct3D11 vs_5_0 ps_5_0, D3D11)');
  const timezoneId = String(profile.timezoneId || 'UTC');
  const timezoneOffset = Number.isFinite(Number(profile.timezoneOffset)) ? Number(profile.timezoneOffset) : 0;
  const fingerprint = profile.fingerprintSettings && typeof profile.fingerprintSettings === 'object' ? profile.fingerprintSettings : {};
  const seedNumber = (value) => Array.from(String(value || '')).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
  const canvasNoise = fingerprint.canvas?.mode === 'noise' ? ((seedNumber(fingerprint.canvas?.seed) % 5) + 1) : 0;
  const webglImageNoise = fingerprint.webglImage?.mode === 'noise' ? ((seedNumber(fingerprint.webglImage?.seed) % 3) + 1) : 0;
  const audioNoise = fingerprint.audioContext?.mode === 'noise' ? ((seedNumber(fingerprint.audioContext?.seed) % 97) + 1) / 100000000 : 0;
  const rectNoise = fingerprint.clientRects?.mode === 'noise' ? ((seedNumber(fingerprint.clientRects?.seed) % 19) + 1) / 1000 : 0;
  const voiceSeed = seedNumber(fingerprint.speechVoices?.seed);
  const fontSeed = seedNumber(fingerprint.fonts?.seed);
  const fontsRandom = fingerprint.fonts?.mode === 'random';
  const customWebglMetadata = fingerprint.webglMetadata?.mode === 'custom';
  const webgpuFromWebgl = fingerprint.webgpu?.mode === 'webgl';
  const customResolution = fingerprint.resolution?.mode === 'custom';
  const webrtcMode = String(fingerprint.webrtc?.mode || 'allow');
  const geo = fingerprint.geolocation && typeof fingerprint.geolocation === 'object' ? fingerprint.geolocation : {};
  const doNotTrack = fingerprint.doNotTrack === true ? '1' : null;
  const portProtection = fingerprint.portScanProtection?.enabled === true;
  const allowedPorts = Array.isArray(fingerprint.portScanProtection?.allowList) ? fingerprint.portScanProtection.allowList.map(Number).filter(Number.isFinite) : [];

  return `
(() => {
  try {
    const fingerprintSignature = ${JSON.stringify(JSON.stringify(fingerprint))};
    if (window.__aiFreeFingerprintSignature === fingerprintSignature) return;
    Object.defineProperty(window, '__aiFreeFingerprintSignature', { configurable: true, value: fingerprintSignature });
    const navigatorProto = Object.getPrototypeOf(navigator);
    const screenProto = window.screen ? Object.getPrototypeOf(window.screen) : null;
// 处理：define的具体业务逻辑。
    const define = (target, key, value) => {
      try {
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: true,
          get: () => value,
        });
      } catch (_) {}
    };
// 创建/初始化：makeNativeString的具体业务逻辑。
    const makeNativeString = (name) => 'function ' + String(name || '') + '() { [native code] }';
// 设置/更新/持久化：setNativeToString的具体业务逻辑。
    const setNativeToString = (fn, name) => {
      if (typeof fn !== 'function') {
        return fn;
      }
      try {
        Object.defineProperty(fn, 'toString', {
          value: () => makeNativeString(name || fn.name || ''),
          configurable: true,
        });
      } catch (_) {}
      return fn;
    };

    define(navigatorProto, 'webdriver', undefined);
    define(navigatorProto, 'platform', ${JSON.stringify(navigatorPlatform)});
    define(navigatorProto, 'language', ${JSON.stringify(locale)});
    define(navigatorProto, 'languages', ${languages});
    define(navigatorProto, 'hardwareConcurrency', ${hardwareConcurrency});
    define(navigatorProto, 'deviceMemory', ${deviceMemory});
    define(navigatorProto, 'maxTouchPoints', ${maxTouchPoints});
    define(navigatorProto, 'vendor', ${JSON.stringify(profile.navigatorVendor || 'Google Inc.')});
    define(navigatorProto, 'doNotTrack', ${JSON.stringify(doNotTrack)});
    define(window, 'doNotTrack', ${JSON.stringify(doNotTrack)});
    define(navigatorProto, 'userAgent', ${JSON.stringify(userAgent)});
    define(navigatorProto, 'userAgentData', {
      brands: ${brands},
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: async (hints = []) => {
        const requested = new Set(Array.isArray(hints) ? hints.map((item) => String(item || '')) : []);
        const values = {
          architecture: ${JSON.stringify(architecture)},
          bitness: ${JSON.stringify(bitness)},
          brands: ${brands},
          fullVersionList: ${fullVersionList},
          mobile: false,
          model: '',
          platform: 'Windows',
          platformVersion: ${JSON.stringify(platformVersion)},
          uaFullVersion: ${JSON.stringify(uaFullVersion)},
          wow64: false,
        };

        if (!requested.size) {
          return values;
        }

        const filtered = {
          brands: values.brands,
          mobile: values.mobile,
          platform: values.platform,
        };
        for (const key of requested) {
          if (Object.prototype.hasOwnProperty.call(values, key)) {
            filtered[key] = values[key];
          }
        }
        return filtered;
      },
      toJSON: () => ({
        brands: ${brands},
        mobile: false,
        platform: 'Windows',
      }),
    });
    try {
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      const resolvedOptions = function resolvedOptions() {
        return { ...originalResolvedOptions.apply(this, arguments), timeZone: ${JSON.stringify(timezoneId)} };
      };
      setNativeToString(resolvedOptions, 'resolvedOptions');
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
        configurable: true, writable: true, value: resolvedOptions,
      });
      const getTimezoneOffset = function getTimezoneOffset() { return ${timezoneOffset}; };
      setNativeToString(getTimezoneOffset, 'getTimezoneOffset');
      Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
        configurable: true, writable: true, value: getTimezoneOffset,
      });
    } catch (_) {}

    const innerWidth = Number(${JSON.stringify(viewport.width || screen.width || 1366)}) || 1366;
    const innerHeight = Number(${JSON.stringify(viewport.height || screen.height || 768)}) || 768;
    const screenWidth = Number(${JSON.stringify(screen.width || viewport.width || 1366)}) || innerWidth;
    const screenHeight = Number(${JSON.stringify(screen.height || viewport.height || 768)}) || innerHeight;
    const screenAvailWidth = Number(${JSON.stringify(screen.availWidth || screen.width || viewport.width || 1366)}) || screenWidth;
    const screenAvailHeight = Number(${JSON.stringify(screen.availHeight || Math.max(Number(screen.height || viewport.height || 768) - 40, Number(viewport.height || screen.height || 768)))}) || screenHeight;
    const outerWidth = Math.max(screenWidth, innerWidth + 16);
    const outerHeight = Math.max(screenHeight, innerHeight + 88);

    if (${customResolution}) {
      define(window, 'innerWidth', innerWidth);
      define(window, 'innerHeight', innerHeight);
      define(window, 'outerWidth', outerWidth);
      define(window, 'outerHeight', outerHeight);
      define(window, 'screenX', ${Number.isFinite(Number(screen.left)) ? Number(screen.left) : 0});
      define(window, 'screenY', ${Number.isFinite(Number(screen.top)) ? Number(screen.top) : 0});
      define(window, 'visualViewport', {
        width: innerWidth,
        height: innerHeight,
        scale: window.devicePixelRatio || 1,
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
        onresize: null,
        onscroll: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      });
    }

    if (${customResolution} && screenProto) {
      define(screenProto, 'width', screenWidth);
      define(screenProto, 'height', screenHeight);
      define(screenProto, 'availWidth', screenAvailWidth);
      define(screenProto, 'availHeight', screenAvailHeight);
      define(screenProto, 'availLeft', ${Number.isFinite(Number(screen.availLeft)) ? Number(screen.availLeft) : 0});
      define(screenProto, 'availTop', ${Number.isFinite(Number(screen.availTop)) ? Number(screen.availTop) : 0});
      define(screenProto, 'colorDepth', ${Number.isFinite(Number(screen.colorDepth)) ? Number(screen.colorDepth) : 24});
      define(screenProto, 'pixelDepth', ${Number.isFinite(Number(screen.pixelDepth)) ? Number(screen.pixelDepth) : 24});
      define(screenProto, 'orientation', {
        angle: 0,
        type: 'landscape-primary',
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      });
    }

    const permissionsProto = navigator.permissions ? Object.getPrototypeOf(navigator.permissions) : null;
    if (permissionsProto && typeof navigator.permissions.query === 'function') {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      const query = function query(parameters = {}) {
        const permissionName = String(parameters && parameters.name ? parameters.name : '');
        let state = null;
        if (permissionName === 'notifications' || permissionName === 'push') {
          state = typeof Notification !== 'undefined' && Notification && typeof Notification.permission === 'string'
            ? Notification.permission
            : 'default';
        } else if (permissionName === 'geolocation') {
          state = ${JSON.stringify(String(geo.permission || 'ask'))} === 'allow'
            ? 'granted'
            : (${JSON.stringify(String(geo.permission || 'ask'))} === 'block' ? 'denied' : 'prompt');
        } else if (
          permissionName === 'camera'
          || permissionName === 'microphone'
          || permissionName === 'clipboard-read'
          || permissionName === 'clipboard-write'
        ) {
          state = 'prompt';
        }

        if (state) {
          const permissionStatus = Object.create(typeof PermissionStatus !== 'undefined' && PermissionStatus.prototype ? PermissionStatus.prototype : Object.prototype);
          define(permissionStatus, 'state', state);
          Object.defineProperty(permissionStatus, 'onchange', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: null,
          });
          define(permissionStatus, 'addEventListener', function addEventListener() {});
          define(permissionStatus, 'removeEventListener', function removeEventListener() {});
          define(permissionStatus, 'dispatchEvent', function dispatchEvent() { return false; });
          setNativeToString(permissionStatus.addEventListener, 'addEventListener');
          setNativeToString(permissionStatus.removeEventListener, 'removeEventListener');
          setNativeToString(permissionStatus.dispatchEvent, 'dispatchEvent');
          return Promise.resolve(permissionStatus);
        }

        return originalQuery(parameters);
      };
      setNativeToString(query, 'query');
      define(permissionsProto, 'query', query);
    }

    try {
      const geoPermission = ${JSON.stringify(String(geo.permission || 'ask'))};
      const coordinates = {
        latitude: ${Number(geo.latitude) || 0}, longitude: ${Number(geo.longitude) || 0},
        accuracy: ${Number(geo.accuracy) || 100}, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      };
      const makePosition = () => ({ coords: coordinates, timestamp: Date.now() });
      const geolocation = {
        getCurrentPosition(success, error) {
          if (geoPermission === 'block') {
            if (typeof error === 'function') error({ code: 1, message: 'User denied Geolocation' });
            return;
          }
          if (geoPermission === 'ask' && navigator.geolocation) {
            return navigator.geolocation.getCurrentPosition(success, error);
          }
          if (typeof success === 'function') success(makePosition());
        },
        watchPosition(success, error) {
          if (geoPermission === 'block') {
            if (typeof error === 'function') error({ code: 1, message: 'User denied Geolocation' });
            return 0;
          }
          const id = setTimeout(() => { if (typeof success === 'function') success(makePosition()); }, 0);
          return Number(id) || 1;
        },
        clearWatch(id) { clearTimeout(id); },
      };
      if (geoPermission !== 'ask') define(navigatorProto, 'geolocation', geolocation);
    } catch (_) {}

    try {
      if (${JSON.stringify(webrtcMode)} === 'block') {
        const blockedRtc = function RTCPeerConnection() { throw new DOMException('WebRTC is disabled', 'NotAllowedError'); };
        setNativeToString(blockedRtc, 'RTCPeerConnection');
        Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: blockedRtc });
        Object.defineProperty(window, 'webkitRTCPeerConnection', { configurable: true, value: blockedRtc });
      } else if (${JSON.stringify(webrtcMode)} === 'replace' && typeof RTCIceCandidate !== 'undefined') {
        const candidateDescriptor = Object.getOwnPropertyDescriptor(RTCIceCandidate.prototype, 'candidate');
        if (candidateDescriptor && typeof candidateDescriptor.get === 'function') {
          Object.defineProperty(RTCIceCandidate.prototype, 'candidate', {
            configurable: true,
            get() { return String(candidateDescriptor.get.call(this) || '').replace(/(?:\\d{1,3}\\.){3}\\d{1,3}/g, '0.0.0.0'); },
          });
        }
      }
    } catch (_) {}

    const mediaDevicesTarget = navigator.mediaDevices && typeof navigator.mediaDevices === 'object'
      ? navigator.mediaDevices
      : {};
    const fakeDevices = [
      { kind: 'audioinput', label: '', deviceId: 'default-audioinput', groupId: 'default-audio' },
      { kind: 'audiooutput', label: '', deviceId: 'default-audiooutput', groupId: 'default-audio' },
      { kind: 'videoinput', label: '', deviceId: 'default-videoinput', groupId: 'default-video' },
    ];
    const enumerateDevices = function enumerateDevices() {
      return Promise.resolve(fakeDevices.map((item) => ({ ...item })));
    };
    setNativeToString(enumerateDevices, 'enumerateDevices');
    define(mediaDevicesTarget, 'enumerateDevices', enumerateDevices);
    if (${JSON.stringify(webrtcMode)} === 'block' || typeof mediaDevicesTarget.getUserMedia !== 'function') {
      const getUserMedia = function getUserMedia() {
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      };
      setNativeToString(getUserMedia, 'getUserMedia');
      define(mediaDevicesTarget, 'getUserMedia', getUserMedia);
    }
    define(navigatorProto, 'mediaDevices', mediaDevicesTarget);

    try {
      if (${canvasNoise} && typeof CanvasRenderingContext2D !== 'undefined') {
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        const getImageData = function getImageData() {
          const image = originalGetImageData.apply(this, arguments);
          if (image?.data?.length) {
            for (let index = 0; index < image.data.length; index += 97) image.data[index] = (image.data[index] + ${canvasNoise}) & 255;
          }
          return image;
        };
        setNativeToString(getImageData, 'getImageData');
        Object.defineProperty(CanvasRenderingContext2D.prototype, 'getImageData', { configurable: true, value: getImageData });
        if (typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.toDataURL === 'function') {
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          const toDataURL = function toDataURL() {
            let context; let originalPixel;
            try {
              context = this.getContext('2d');
              if (context && this.width > 0 && this.height > 0) {
                originalPixel = originalGetImageData.call(context, 0, 0, 1, 1);
                const noisyPixel = new ImageData(new Uint8ClampedArray(originalPixel.data), 1, 1);
                noisyPixel.data[0] = (noisyPixel.data[0] + ${canvasNoise}) & 255;
                context.putImageData(noisyPixel, 0, 0);
              }
              return originalToDataURL.apply(this, arguments);
            } finally {
              try { if (context && originalPixel) context.putImageData(originalPixel, 0, 0); } catch (_) {}
            }
          };
          setNativeToString(toDataURL, 'toDataURL');
          Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', { configurable: true, value: toDataURL });
        }
      }
    } catch (_) {}

    try {
      if (${audioNoise} && typeof AudioBuffer !== 'undefined') {
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        const getChannelData = function getChannelData() {
          const data = originalGetChannelData.apply(this, arguments);
          if (data?.length) data[0] = data[0] + ${audioNoise};
          return data;
        };
        setNativeToString(getChannelData, 'getChannelData');
        Object.defineProperty(AudioBuffer.prototype, 'getChannelData', { configurable: true, value: getChannelData });
      }
    } catch (_) {}

    try {
      if (${rectNoise} && typeof Element !== 'undefined') {
        const originalRect = Element.prototype.getBoundingClientRect;
        const originalRects = Element.prototype.getClientRects;
        const getBoundingClientRect = function getBoundingClientRect() {
          const rect = originalRect.apply(this, arguments);
          return new DOMRect(rect.x + ${rectNoise}, rect.y + ${rectNoise}, rect.width, rect.height);
        };
        setNativeToString(getBoundingClientRect, 'getBoundingClientRect');
        Object.defineProperty(Element.prototype, 'getBoundingClientRect', { configurable: true, value: getBoundingClientRect });
        if (typeof originalRects === 'function') {
          const getClientRects = function getClientRects() {
            const list = originalRects.apply(this, arguments);
            const convert = (rect) => new DOMRect(rect.x + ${rectNoise}, rect.y + ${rectNoise}, rect.width, rect.height);
            return new Proxy(list, {
              get(target, key) {
                if (key === 'item') return (index) => { const rect = target.item(index); return rect ? convert(rect) : null; };
                if (/^\\d+$/.test(String(key))) return target[key] ? convert(target[key]) : target[key];
                const result = Reflect.get(target, key, target);
                return typeof result === 'function' ? result.bind(target) : result;
              },
            });
          };
          setNativeToString(getClientRects, 'getClientRects');
          Object.defineProperty(Element.prototype, 'getClientRects', { configurable: true, value: getClientRects });
        }
      }
    } catch (_) {}

    try {
      if (${fontsRandom} && document.fonts?.check) {
        const originalFontCheck = document.fonts.check.bind(document.fonts);
        const fontCheck = function check(font, text) {
          const descriptor = String(font || '');
          const common = /Arial|Times New Roman|Courier New|Segoe UI|sans-serif|serif|monospace/i.test(descriptor);
          if (!common) {
            const hash = Array.from(descriptor).reduce((value, char) => ((value * 33) + char.charCodeAt(0)) >>> 0, ${fontSeed});
            if (hash % 4 === 0) return false;
          }
          return originalFontCheck(font, text);
        };
        setNativeToString(fontCheck, 'check');
        Object.defineProperty(document.fonts, 'check', { configurable: true, value: fontCheck });
      }
    } catch (_) {}

    try {
      if (${voiceSeed} && window.speechSynthesis?.getVoices) {
        const originalGetVoices = window.speechSynthesis.getVoices.bind(window.speechSynthesis);
        const getVoices = function getVoices() {
          const voices = originalGetVoices();
          if (!Array.isArray(voices) || voices.length < 2) return voices;
          const offset = ${voiceSeed} % voices.length;
          return voices.slice(offset).concat(voices.slice(0, offset)).slice(0, Math.max(1, voices.length - (${voiceSeed} % 3)));
        };
        setNativeToString(getVoices, 'getVoices');
        Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: getVoices });
      }
    } catch (_) {}

    try {
      if (${portProtection}) {
        const allowedPorts = new Set(${JSON.stringify(allowedPorts)}.map(Number));
        const isBlockedLocalUrl = (rawUrl) => {
          try {
            const parsed = new URL(String(rawUrl || ''), location.href);
            const isLocal = /^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0|\\[?::1\\]?)$/i.test(parsed.hostname);
            const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
            return isLocal && !allowedPorts.has(port);
          } catch (_) { return false; }
        };
        if (typeof window.fetch === 'function') {
          const originalFetch = window.fetch.bind(window);
          const protectedFetch = function fetch(resource, init) {
            const url = typeof resource === 'string' ? resource : resource?.url;
            return isBlockedLocalUrl(url) ? Promise.reject(new TypeError('Local port scan blocked')) : originalFetch(resource, init);
          };
          setNativeToString(protectedFetch, 'fetch');
          Object.defineProperty(window, 'fetch', { configurable: true, value: protectedFetch });
        }
        if (typeof window.WebSocket === 'function') {
          const OriginalWebSocket = window.WebSocket;
          const ProtectedWebSocket = function WebSocket(url, protocols) {
            if (isBlockedLocalUrl(url)) throw new DOMException('Local port scan blocked', 'SecurityError');
            return protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
          };
          ProtectedWebSocket.prototype = OriginalWebSocket.prototype;
          setNativeToString(ProtectedWebSocket, 'WebSocket');
          Object.defineProperty(window, 'WebSocket', { configurable: true, value: ProtectedWebSocket });
        }
        if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype?.open) {
          const originalOpen = XMLHttpRequest.prototype.open;
          const protectedOpen = function open(method, url) {
            if (isBlockedLocalUrl(url)) throw new DOMException('Local port scan blocked', 'SecurityError');
            return originalOpen.apply(this, arguments);
          };
          setNativeToString(protectedOpen, 'open');
          Object.defineProperty(XMLHttpRequest.prototype, 'open', { configurable: true, value: protectedOpen });
        }
      }
    } catch (_) {}

// 同步/连接：patchWebGL的具体业务逻辑。
    const patchWebGL = (contextProto) => {
      if (!contextProto || typeof contextProto.getParameter !== 'function') {
        return;
      }

      const originalGetParameter = contextProto.getParameter;
      const originalReadPixels = typeof contextProto.readPixels === 'function' ? contextProto.readPixels : null;
      const originalGetExtension = typeof contextProto.getExtension === 'function'
        ? contextProto.getExtension
        : null;
      const originalGetSupportedExtensions = typeof contextProto.getSupportedExtensions === 'function'
        ? contextProto.getSupportedExtensions
        : null;

      const getParameter = function getParameter(parameter) {
        if (${customWebglMetadata} && parameter === 0x9245) return ${JSON.stringify(webglVendor)};
        if (${customWebglMetadata} && parameter === 0x9246) return ${JSON.stringify(webglRenderer)};
        return originalGetParameter.apply(this, arguments);
      };
      setNativeToString(getParameter, 'getParameter');
      define(contextProto, 'getParameter', getParameter);

      if (${customWebglMetadata} && originalGetExtension) {
        const getExtension = function getExtension(name) {
          if (String(name || '') === 'WEBGL_debug_renderer_info') {
            return {
              UNMASKED_VENDOR_WEBGL: 0x9245,
              UNMASKED_RENDERER_WEBGL: 0x9246,
            };
          }
          return originalGetExtension.apply(this, arguments);
        };
        setNativeToString(getExtension, 'getExtension');
        define(contextProto, 'getExtension', getExtension);
      }

      if (${customWebglMetadata} && originalGetSupportedExtensions) {
        const getSupportedExtensions = function getSupportedExtensions() {
          const list = originalGetSupportedExtensions.apply(this, arguments) || [];
          return Array.from(new Set([...(Array.isArray(list) ? list : []), 'WEBGL_debug_renderer_info']));
        };
        setNativeToString(getSupportedExtensions, 'getSupportedExtensions');
        define(contextProto, 'getSupportedExtensions', getSupportedExtensions);
      }

      if (${webglImageNoise} && originalReadPixels) {
        const readPixels = function readPixels() {
          const result = originalReadPixels.apply(this, arguments);
          const pixels = arguments[6];
          if (pixels && typeof pixels.length === 'number' && pixels.length) {
            for (let index = 0; index < pixels.length; index += 101) pixels[index] = (pixels[index] + ${webglImageNoise}) & 255;
          }
          return result;
        };
        setNativeToString(readPixels, 'readPixels');
        define(contextProto, 'readPixels', readPixels);
      }
    };

    patchWebGL(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
    patchWebGL(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);

    try {
      if (${webgpuFromWebgl} && typeof GPUAdapter !== 'undefined' && GPUAdapter.prototype) {
        if (typeof GPUAdapter.prototype.requestAdapterInfo === 'function') {
          const requestAdapterInfo = async function requestAdapterInfo() {
            return { vendor: ${JSON.stringify(webglVendor)}, architecture: 'x86', device: ${JSON.stringify(webglRenderer)}, description: ${JSON.stringify(webglRenderer)} };
          };
          setNativeToString(requestAdapterInfo, 'requestAdapterInfo');
          Object.defineProperty(GPUAdapter.prototype, 'requestAdapterInfo', { configurable: true, value: requestAdapterInfo });
        }
        define(GPUAdapter.prototype, 'info', { vendor: ${JSON.stringify(webglVendor)}, architecture: 'x86', device: ${JSON.stringify(webglRenderer)}, description: ${JSON.stringify(webglRenderer)} });
      }
    } catch (_) {}

    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        configurable: true,
        enumerable: true,
        value: {
          app: {},
          runtime: {},
        },
      });
    } else if (!window.chrome.runtime) {
      try {
        window.chrome.runtime = {};
      } catch (_) {}
    }

    try {
      if (window.screen && !window.screen.orientation) {
        Object.defineProperty(window.screen, 'orientation', {
          configurable: true,
          enumerable: true,
          get: () => ({
            angle: 0,
            type: 'landscape-primary',
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false; },
          }),
        });
      }
    } catch (_) {}

    if (!navigator.plugins || navigator.plugins.length === 0) {
      const pluginStub = [
        { name: '${browserBrand} PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: '${browserBrand} PDF Plugin', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client' },
      ];
      define(navigatorProto, 'plugins', pluginStub);
      define(navigatorProto, 'mimeTypes', [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client' },
        { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client' },
      ]);
    }
  } catch (_) {}
})();
`;
}

// 获取/读取/解析：resolveGeoIpInfo的具体业务逻辑。
async function resolveGeoIpInfo(httpGetUniversal, logger = console) {
  if (cachedBrowserRegionProfile) {
    return cachedBrowserRegionProfile;
  }
  if (cachedBrowserRegionProfilePromise) {
    return cachedBrowserRegionProfilePromise;
  }

  cachedBrowserRegionProfilePromise = (async () => {
    const getter = typeof httpGetUniversal === 'function'
      ? httpGetUniversal
      : null;

    if (!getter) {
      return null;
    }

    for (const endpoint of GEO_IP_ENDPOINTS) {
      try {
        const response = await getter(endpoint, 8000);
        const body = response && response.body && typeof response.body === 'object'
          ? response.body
          : null;
        if (!body) {
          continue;
        }

        const regionKey = inferBrowserRegionKeyFromIpInfo(body);
        if (regionKey) {
          const preset = getBrowserRegionPreset(regionKey);
          const result = {
            regionKey,
            preset,
            sourceIp: String(body.ip || body.query || body.ip_address || body.ipAddress || '').trim(),
            sourceCountryCode: String(body.country_code || body.countryCode || '').trim(),
            sourceCountry: String(body.country_name || body.countryName || body.country || '').trim(),
            sourceRegion: String(body.region || body.region_name || body.regionName || '').trim(),
            sourceCity: String(body.city || '').trim(),
            endpoint,
            raw: body,
          };
          cachedBrowserRegionProfile = result;
          return result;
        }
      } catch (error) {
        logger?.warn?.('[BrowserMask] IP 地区探测失败:', error?.message || error);
      }
    }

    return null;
  })().finally(() => {
    cachedBrowserRegionProfilePromise = null;
  });

  return cachedBrowserRegionProfilePromise;
}

// 获取/读取/解析：resolveTabBrowserProfile的具体业务逻辑。
async function resolveTabBrowserProfile(options = {}) {
  const browserSettings = options.browserSettings && typeof options.browserSettings === 'object'
    ? options.browserSettings
    : {};
  const explicitRegion = normalizeRegionKey(
    browserSettings.region
    || browserSettings.browser_region
    || browserSettings.browserRegion
    || ''
  );

  if (explicitRegion && REGION_PRESETS[explicitRegion]) {
    return buildBrowserProfileFromRegion(explicitRegion, browserSettings);
  }

  const ipInfo = await resolveGeoIpInfo(options.httpGetUniversal, options.logger);
  if (ipInfo && ipInfo.regionKey) {
    return buildBrowserProfileFromRegion(ipInfo.regionKey, browserSettings, ipInfo);
  }

  const localeRegion = inferBrowserRegionKeyFromLocale(
    browserSettings.locale
    || browserSettings.browser_locale
    || browserSettings.browserLocale
    || getDefaultLocale()
  );

  return buildBrowserProfileFromRegion(localeRegion || 'us', browserSettings);
}

// 创建/初始化：formatClientHintBrandList的具体业务逻辑。
// 把 [{brand, version}] 序列化成结构化头值：'"Chromium";v="147", "Google Chrome";v="147"'。
// useFullVersion=false 只取主版本（低熵头 sec-ch-ua 用），true 保留完整版本（sec-ch-ua-full-version-list 用）。
function formatClientHintBrandList(brands, useFullVersion) {
  return (Array.isArray(brands) ? brands : [])
    .map((item) => {
      const brand = String(item?.brand || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (!brand) return '';
      const rawVersion = String(item?.version || '');
      const version = useFullVersion ? rawVersion : (rawVersion.split('.')[0] || rawVersion);
      return `"${brand}";v="${version}"`;
    })
    .filter(Boolean)
    .join(', ');
}

// 设置/更新/持久化：applyClientHintsToHeaders的具体业务逻辑。
// 让 Sec-CH-UA* 请求头与注入脚本伪造的 navigator.userAgentData 保持一致，堵住内核真实版本的 HTTP 泄露。
// 仅当 Chromium 本身已发送 sec-ch-ua（安全上下文）时才改写，避免在 http 等场景凭空添加而暴露异常。
function applyClientHintsToHeaders(headers, profile) {
  if (!headers || typeof headers !== 'object') return headers;
  const lowerToActual = new Map(Object.keys(headers).map((key) => [key.toLowerCase(), key]));
  if (!lowerToActual.has('sec-ch-ua')) return headers;

  const present = new Set([...lowerToActual.keys()].filter((key) => key.startsWith('sec-ch-ua')));
  for (const lower of present) delete headers[lowerToActual.get(lower)];

  const baseBrands = formatClientHintBrandList(profile.uaBrands, false);
  if (baseBrands) headers['Sec-CH-UA'] = baseBrands;
  headers['Sec-CH-UA-Mobile'] = '?0';
  headers['Sec-CH-UA-Platform'] = '"Windows"';

  // 高熵头只有站点通过 Accept-CH 请求后 Chromium 才会发送，因此仅在原请求已包含时才改写。
  const rewriteIfPresent = (lowerKey, headerName, value) => {
    if (present.has(lowerKey) && value) headers[headerName] = value;
  };
  rewriteIfPresent('sec-ch-ua-platform-version', 'Sec-CH-UA-Platform-Version', `"${String(profile.platformVersion || '')}"`);
  rewriteIfPresent('sec-ch-ua-arch', 'Sec-CH-UA-Arch', `"${String(profile.architecture || 'x86')}"`);
  rewriteIfPresent('sec-ch-ua-bitness', 'Sec-CH-UA-Bitness', `"${String(profile.bitness || '64')}"`);
  rewriteIfPresent('sec-ch-ua-full-version-list', 'Sec-CH-UA-Full-Version-List', formatClientHintBrandList(profile.uaFullVersionList, true));
  rewriteIfPresent('sec-ch-ua-full-version', 'Sec-CH-UA-Full-Version', `"${String(profile.uaFullVersion || '')}"`);
  rewriteIfPresent('sec-ch-ua-model', 'Sec-CH-UA-Model', '""');
  rewriteIfPresent('sec-ch-ua-wow64', 'Sec-CH-UA-Wow64', '?0');
  return headers;
}

// 设置/更新/持久化：installClientHintsForSession的具体业务逻辑。
function installClientHintsForSession(webContents, profile) {
  const session = webContents && webContents.session;
  if (!session) return;
  registerRequestHeaderTransformer(session, 'ai-free-client-hints', (headers) => applyClientHintsToHeaders(headers, profile));
}

// 处理：configureTabBrowserView的具体业务逻辑。
async function configureTabBrowserView(webContents, options = {}) {
  if (!webContents || typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return;
  }

  const browserProfile = options.browserProfile || buildBrowserProfileFromRegion('us', options.browserSettings || {});
  let runtimeState = configuredWebContents.get(webContents);
  if (!runtimeState) {
    runtimeState = { browserProfile, logger: options.logger };
    configuredWebContents.set(webContents, runtimeState);
  } else {
    runtimeState.browserProfile = browserProfile;
    runtimeState.logger = options.logger || runtimeState.logger;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'browserProxy')) {
    await applyTabBrowserProxy(webContents, options.browserProxy, options.logger);
  }
  const acceptLanguages = String(browserProfile.acceptLanguage || '').trim() || (
    Array.isArray(browserProfile.languages) && browserProfile.languages.length > 0
      ? browserProfile.languages
      : [browserProfile.locale, browserProfile.locale.split('-')[0], 'en'].filter(Boolean)
  ).join(',');

  try {
    if (typeof webContents.setUserAgent === 'function') {
      webContents.setUserAgent(browserProfile.userAgent, acceptLanguages);
    }
  } catch (_) {}

  // 同步改写 Sec-CH-UA* 请求头，使其与伪造的 UA / userAgentData 一致，避免内核真实版本从 HTTP 头泄露。
  try {
    installClientHintsForSession(webContents, browserProfile);
  } catch (error) {
    options.logger?.warn?.('[BrowserMask] Client Hints 头改写安装失败:', error?.message || error);
  }

// 处理：injectScript的具体业务逻辑。
  const injectScript = async () => {
    if (!webContents || typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
      return;
    }

    const currentState = configuredWebContents.get(webContents) || runtimeState;
    const script = buildTabDisguiseScript(currentState.browserProfile || browserProfile);
    try {
      await webContents.executeJavaScript(script, true);
    } catch (error) {
      currentState.logger?.warn?.('[BrowserMask] 页面注入失败:', error?.message || error);
    }
  };

  if (typeof webContents.on === 'function' && runtimeState.listenersBound !== true) {
    runtimeState.listenersBound = true;
    webContents.on('dom-ready', () => {
      void injectScript();
    });

    webContents.on('did-navigate-in-page', () => {
      void injectScript();
    });
  }

  await injectScript();
}

module.exports = {
  buildTabBrowserPreferences,
  applyTabBrowserProxy,
  configureTabBrowserView,
  resolveTabBrowserProfile,
};
