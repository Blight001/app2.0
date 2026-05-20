const path = require('path');
const { app } = require('electron');
const {
  REGION_PRESETS,
  getBrowserRegionPreset,
  inferBrowserRegionKeyFromLocale,
} = require('./browser-region');

const TAB_PLATFORM = 'Win32';
const GEO_IP_ENDPOINTS = [
  'https://ipapi.co/json/',
  'https://ipwho.is/',
  'https://ipinfo.io/json',
];

let cachedBrowserRegionProfile = null;
let cachedBrowserRegionProfilePromise = null;

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
  const browserType = 'edge';
  const major = getChromiumMajorVersion();
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`;
  const brands = JSON.stringify([
    { brand: 'Chromium', version: major },
    { brand: 'Microsoft Edge', version: major },
    { brand: 'Not.A/Brand', version: '24' },
  ]);
  const fullVersionList = JSON.stringify([
    { brand: 'Chromium', version: `${major}.0.0.0` },
    { brand: 'Microsoft Edge', version: `${major}.0.0.0` },
    { brand: 'Not.A/Brand', version: '24.0.0.0' },
  ]);
  const languages = Array.from(new Set([
    locale,
    locale.split('-')[0],
    'en',
  ].filter(Boolean)));

  return {
    browserType,
    browserBrand: 'Microsoft Edge',
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
    acceptLanguage,
    userAgent,
    uaBrands: JSON.parse(brands),
    uaFullVersionList: JSON.parse(fullVersionList),
    platformVersion: String(browserSettings.platform_version || browserSettings.platformVersion || '15.0.0').trim() || '15.0.0',
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
    languages,
    plugins: [
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Plugin', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
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
  const proxyRules = [
    `http=${proxyServer}`,
    `https=${proxyServer}`,
  ].join(';');

  try {
    await session.setProxy({
      proxyRules,
      proxyBypassRules: bypassRules,
    });
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
  const userAgent = String(profile.userAgent || `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`);
  const brands = JSON.stringify(profile.uaBrands || [
    { brand: 'Chromium', version: major },
    { brand: 'Microsoft Edge', version: major },
    { brand: 'Not.A/Brand', version: '24' },
  ]);
  const fullVersionList = JSON.stringify(profile.uaFullVersionList || [
    { brand: 'Chromium', version: `${major}.0.0.0` },
    { brand: 'Microsoft Edge', version: `${major}.0.0.0` },
    { brand: 'Not.A/Brand', version: '24.0.0.0' },
  ]);
  const languages = JSON.stringify(Array.isArray(profile.languages) && profile.languages.length > 0
    ? profile.languages
    : [locale, locale.split('-')[0], 'en'].filter(Boolean));
  const navigatorPlatform = String(profile.navigatorPlatform || TAB_PLATFORM);
  const browserBrand = String(profile.browserBrand || 'Microsoft Edge');
  const platformVersion = String(profile.platformVersion || '15.0.0');
  const architecture = String(profile.architecture || 'x86');
  const bitness = String(profile.bitness || '64');
  const uaFullVersion = String(profile.uaFullVersion || `${major}.0.0.0`);
  const deviceMemory = Number.isFinite(Number(profile.deviceMemory)) ? Number(profile.deviceMemory) : 8;
  const hardwareConcurrency = Number.isFinite(Number(profile.hardwareConcurrency)) ? Number(profile.hardwareConcurrency) : 8;
  const maxTouchPoints = Number.isFinite(Number(profile.maxTouchPoints)) ? Number(profile.maxTouchPoints) : 0;
  const viewport = profile.viewport && typeof profile.viewport === 'object' ? profile.viewport : {};
  const screen = profile.screen && typeof profile.screen === 'object' ? profile.screen : {};
  const deviceScaleFactor = Number.isFinite(Number(profile.deviceScaleFactor)) && Number(profile.deviceScaleFactor) > 0
    ? Number(profile.deviceScaleFactor)
    : 1;
  const webglVendor = String(profile.webglVendor || 'Google Inc. (Intel)');
  const webglRenderer = String(profile.webglRenderer || 'ANGLE (Intel, Intel(R) Graphics, Direct3D11 vs_5_0 ps_5_0, D3D11)');

  return `
(() => {
  try {
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

    const innerWidth = Number(${JSON.stringify(viewport.width || screen.width || 1366)}) || 1366;
    const innerHeight = Number(${JSON.stringify(viewport.height || screen.height || 768)}) || 768;
    const screenWidth = Number(${JSON.stringify(screen.width || viewport.width || 1366)}) || innerWidth;
    const screenHeight = Number(${JSON.stringify(screen.height || viewport.height || 768)}) || innerHeight;
    const screenAvailWidth = Number(${JSON.stringify(screen.availWidth || screenWidth)}) || screenWidth;
    const screenAvailHeight = Number(${JSON.stringify(screen.availHeight || Math.max(screenHeight - 40, innerHeight) )}) || screenHeight;
    const outerWidth = Math.max(screenWidth, innerWidth + 16);
    const outerHeight = Math.max(screenHeight, innerHeight + 88);

    define(window, 'devicePixelRatio', ${deviceScaleFactor});
    define(window, 'innerWidth', innerWidth);
    define(window, 'innerHeight', innerHeight);
    define(window, 'outerWidth', outerWidth);
    define(window, 'outerHeight', outerHeight);
    define(window, 'screenX', ${Number.isFinite(Number(screen.left)) ? Number(screen.left) : 0});
    define(window, 'screenY', ${Number.isFinite(Number(screen.top)) ? Number(screen.top) : 0});

    define(window, 'visualViewport', {
      width: innerWidth,
      height: innerHeight,
      scale: ${deviceScaleFactor},
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

    if (screenProto) {
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
        } else if (
          permissionName === 'geolocation'
          || permissionName === 'camera'
          || permissionName === 'microphone'
          || permissionName === 'clipboard-read'
          || permissionName === 'clipboard-write'
        ) {
          state = 'prompt';
        }

        if (state) {
          const permissionStatus = Object.create(typeof PermissionStatus !== 'undefined' && PermissionStatus.prototype ? PermissionStatus.prototype : Object.prototype);
          define(permissionStatus, 'state', state);
          define(permissionStatus, 'onchange', null);
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
    if (typeof mediaDevicesTarget.getUserMedia !== 'function') {
      const getUserMedia = function getUserMedia() {
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      };
      setNativeToString(getUserMedia, 'getUserMedia');
      define(mediaDevicesTarget, 'getUserMedia', getUserMedia);
    }
    define(navigatorProto, 'mediaDevices', mediaDevicesTarget);

// 同步/连接：patchWebGL的具体业务逻辑。
    const patchWebGL = (contextProto) => {
      if (!contextProto || typeof contextProto.getParameter !== 'function') {
        return;
      }

      const originalGetParameter = contextProto.getParameter;
      const originalGetExtension = typeof contextProto.getExtension === 'function'
        ? contextProto.getExtension
        : null;
      const originalGetSupportedExtensions = typeof contextProto.getSupportedExtensions === 'function'
        ? contextProto.getSupportedExtensions
        : null;

      const getParameter = function getParameter(parameter) {
        if (parameter === 0x9245) return ${JSON.stringify(webglVendor)};
        if (parameter === 0x9246) return ${JSON.stringify(webglRenderer)};
        return originalGetParameter.apply(this, arguments);
      };
      setNativeToString(getParameter, 'getParameter');
      define(contextProto, 'getParameter', getParameter);

      if (originalGetExtension) {
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

      if (originalGetSupportedExtensions) {
        const getSupportedExtensions = function getSupportedExtensions() {
          const list = originalGetSupportedExtensions.apply(this, arguments) || [];
          return Array.from(new Set([...(Array.isArray(list) ? list : []), 'WEBGL_debug_renderer_info']));
        };
        setNativeToString(getSupportedExtensions, 'getSupportedExtensions');
        define(contextProto, 'getSupportedExtensions', getSupportedExtensions);
      }
    };

    patchWebGL(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
    patchWebGL(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);

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

// 处理：configureTabBrowserView的具体业务逻辑。
async function configureTabBrowserView(webContents, options = {}) {
  if (!webContents || typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return;
  }

  const browserProfile = options.browserProfile || buildBrowserProfileFromRegion('us', options.browserSettings || {});
  if (Object.prototype.hasOwnProperty.call(options, 'browserProxy')) {
    await applyTabBrowserProxy(webContents, options.browserProxy, options.logger);
  }
  const acceptLanguages = Array.isArray(browserProfile.languages) && browserProfile.languages.length > 0
    ? browserProfile.languages
    : [browserProfile.locale, browserProfile.locale.split('-')[0], 'en'].filter(Boolean);

  try {
    if (typeof webContents.setUserAgent === 'function') {
      webContents.setUserAgent(browserProfile.userAgent, acceptLanguages);
    }
  } catch (_) {}

// 处理：injectScript的具体业务逻辑。
  const injectScript = async () => {
    if (!webContents || typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
      return;
    }

    const script = buildTabDisguiseScript(browserProfile);
    try {
      await webContents.executeJavaScript(script, true);
    } catch (error) {
      options.logger?.warn?.('[BrowserMask] 页面注入失败:', error?.message || error);
    }
  };

  if (typeof webContents.on === 'function') {
    webContents.on('dom-ready', () => {
      void injectScript();
    });

    webContents.on('did-navigate-in-page', () => {
      void injectScript();
    });
  }
}

module.exports = {
  buildTabBrowserPreferences,
  buildTabDisguiseScript,
  buildBrowserProfileFromRegion,
  applyTabBrowserProxy,
  configureTabBrowserView,
  resolveTabBrowserProfile,
};
