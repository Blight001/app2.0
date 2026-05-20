const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const { app } = require('electron');
const execAsync = util.promisify(exec);
const { findBrowserByName } = require('./browser_detector');
const { getBrowserRegionPreset, resolveBrowserRegionKeyFromSettings } = require('./browser-region');
const { launchBuiltinElectronBrowser } = require('./electron-browser');

function loadPlaywrightChromium() {
    const candidates = [
        'playwright',
        process.resourcesPath ? path.join(process.resourcesPath, 'node_modules', 'playwright') : null,
        'playwright-core',
        process.resourcesPath ? path.join(process.resourcesPath, 'node_modules', 'playwright-core') : null
    ].filter(Boolean);

    const errors = [];

    for (const candidate of candidates) {
        try {
            const mod = require(candidate);
            if (mod && mod.chromium) {
                return mod.chromium;
            }
        } catch (error) {
            errors.push(`${candidate}: ${error.message}`);
        }
    }

    throw new Error(`无法加载 Playwright Chromium: ${errors.join(' | ')}`);
}

const chromium = loadPlaywrightChromium();

const BLOCKED_ASSET_RESOURCE_TYPES = new Set(['image', 'media']);
const BLOCKED_ASSET_URL_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|mov|webm|mkv|avi|flv|wmv|m3u8|mpd)(?:[?#].*)?$/i;

function resolveBuiltinWatermarkExtensionPath() {
    const candidates = [
        path.join(process.cwd(), 'extensions', 'remove_watermark'),
        process.resourcesPath ? path.join(process.resourcesPath, 'extensions', 'remove_watermark') : null
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const manifestPath = path.join(candidate, 'manifest.json');
            if (fs.existsSync(candidate) && fs.existsSync(manifestPath)) {
                return candidate;
            }
        } catch (_error) {
        }
    }

    return '';
}

function resolveBrowserDownloadsPath(browserOptions = {}) {
    const explicitDownloadsPath = String(browserOptions.downloadsPath || '').trim();
    if (explicitDownloadsPath) {
        return explicitDownloadsPath;
    }

    try {
        const downloadsPath = String(app.getPath('downloads') || '').trim();
        if (downloadsPath) {
            return downloadsPath;
        }
    } catch (_error) {
    }

    return path.join(os.homedir(), 'Downloads');
}

function buildSandboxLaunchArgs() {
    const args = ['--no-sandbox'];

    if (process.platform === 'linux') {
        args.push('--disable-setuid-sandbox');
    }

    return args;
}

class BrowserManager {
    constructor() {
        this.browsers = new Map(); // browserId -> { browser, context, page, type }
        this.closingBrowsers = new Set();
        this.cleanupInProgress = false;
        this.browserLifecycleListeners = new Set();
        this.mainWindow = null;
        this.logger = {
            debug: (...args) => console.debug(...args),
            info: (...args) => console.info(...args),
            warning: (...args) => console.warn(...args),
            warn: (...args) => console.warn(...args),
            error: (...args) => console.error(...args)
        }; // 默认适配器，后续可替换成 Logger 实例
        this.enableSystemCleanup = true;
        this.stealthScriptPath = path.join(__dirname, '..', '..', '..', 'stealth.min.js');
    }

    setMainWindow(mainWindow = null) {
        this.mainWindow = mainWindow || null;
    }

    onBrowserLifecycle(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        this.browserLifecycleListeners.add(listener);
        return () => {
            this.browserLifecycleListeners.delete(listener);
        };
    }

    _emitBrowserLifecycle(event = {}) {
        for (const listener of this.browserLifecycleListeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.warning(`浏览器生命周期回调执行失败: ${error.message}`);
            }
        }
    }

    _extractBrowserMajorVersion(browserVersion = '') {
        const match = String(browserVersion).match(/(?:Chrome|Chromium|HeadlessChrome)\/(\d+)/i);
        if (match && match[1]) {
            return match[1];
        }

        const fallback = String(browserVersion).match(/(\d+)/);
        return fallback ? fallback[1] : '91';
    }

    _extractBrowserFullVersion(browserVersion = '') {
        const match = String(browserVersion).match(/(?:Chrome|Chromium|HeadlessChrome)\/(\d+\.\d+\.\d+\.\d+)/i);
        if (match && match[1]) {
            return match[1];
        }

        const majorVersion = this._extractBrowserMajorVersion(browserVersion);
        return `${majorVersion}.0.0.0`;
    }

    _isChromiumFamilyBrowser(browserType = 'chromium') {
        const normalizedType = String(browserType || '').trim().toLowerCase();
        return ['chromium', 'chrome', 'edge', 'system', 'electron'].includes(normalizedType);
    }

    _isWatermarkExtensionEnabled(browserSettings = {}) {
        if (browserSettings.remove_watermark_plugin === false || browserSettings.removeWatermarkPlugin === false) {
            return false;
        }

        return true;
    }

    _buildUserAgentBrands(browserType = 'chromium', majorVersion = '91') {
        const normalizedType = String(browserType || '').trim().toLowerCase();
        const browserBrand = normalizedType === 'edge' || normalizedType === 'system'
            ? 'Microsoft Edge'
            : 'Google Chrome';

        return [
            { brand: 'Chromium', version: String(majorVersion) },
            { brand: browserBrand, version: String(majorVersion) },
            { brand: 'Not.A/Brand', version: '24' }
        ];
    }

    _formatClientHintBrandList(brands = [], useFullVersion = false) {
        if (!Array.isArray(brands) || brands.length === 0) {
            return '';
        }

        return brands
            .map((item) => {
                const brand = String(item?.brand || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const version = String(useFullVersion ? item?.fullVersion || item?.version || '' : item?.version || '');
                return `"${brand}";v="${version}"`;
            })
            .filter(Boolean)
            .join(', ');
    }

    _buildPluginMetadata(browserType = 'chromium') {
        const normalizedType = String(browserType || '').trim().toLowerCase();
        const isEdge = normalizedType === 'edge' || normalizedType === 'system';
        const browserPrefix = isEdge ? 'Microsoft Edge' : 'Chrome';
        const pluginName = `${browserPrefix} PDF Viewer`;
        const pluginDriverName = `${browserPrefix} PDF Plugin`;

        return [
            {
                name: pluginName,
                filename: 'internal-pdf-viewer',
                description: 'Portable Document Format',
                mimeTypes: [
                    {
                        type: 'application/pdf',
                        suffixes: 'pdf',
                        description: 'Portable Document Format'
                    }
                ]
            },
            {
                name: pluginDriverName,
                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                description: 'Portable Document Format',
                mimeTypes: [
                    {
                        type: 'application/x-google-chrome-pdf',
                        suffixes: 'pdf',
                        description: 'Portable Document Format'
                    }
                ]
            },
            {
                name: 'Native Client',
                filename: 'internal-nacl-plugin',
                description: 'Native Client',
                mimeTypes: [
                    {
                        type: 'application/x-nacl',
                        suffixes: '',
                        description: 'Native Client'
                    },
                    {
                        type: 'application/x-pnacl',
                        suffixes: '',
                        description: 'Portable Native Client'
                    }
                ]
            }
        ];
    }

    _buildUserAgentData(profile = {}) {
        const brands = Array.isArray(profile.uaBrands) && profile.uaBrands.length > 0
            ? profile.uaBrands
            : this._buildUserAgentBrands(profile.browserType, profile.majorVersion);
        const fullVersion = String(profile.uaFullVersion || `${profile.majorVersion || '91'}.0.0.0`);

        return {
            brands,
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: async (hints = []) => {
                const requestedHints = new Set(Array.isArray(hints) ? hints.map(item => String(item || '')) : []);
                const response = {
                    brands,
                    fullVersionList: Array.isArray(profile.uaFullVersionList) && profile.uaFullVersionList.length > 0
                        ? profile.uaFullVersionList
                        : brands.map(item => ({ brand: item.brand, version: fullVersion })),
                    mobile: false,
                    platform: 'Windows',
                    platformVersion: profile.platformVersion || '15.0.0',
                    architecture: profile.architecture || 'x86',
                    bitness: profile.bitness || '64',
                    model: profile.model || '',
                    uaFullVersion: fullVersion,
                    wow64: !!profile.wow64
                };

                if (requestedHints.size === 0) {
                    return response;
                }

                const filtered = { brands: response.brands, mobile: response.mobile, platform: response.platform };
                for (const key of requestedHints) {
                    if (Object.prototype.hasOwnProperty.call(response, key)) {
                        filtered[key] = response[key];
                    }
                }
                return filtered;
            },
            toJSON: () => ({
                brands,
                mobile: false,
                platform: 'Windows'
            })
        };
    }

    _buildUserAgent(browserType = 'chromium', browserVersion = '') {
        const majorVersion = this._extractBrowserMajorVersion(browserVersion);
        const normalizedType = String(browserType || 'chromium').toLowerCase();

        if (normalizedType === 'edge' || normalizedType === 'system') {
            return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36 Edg/${majorVersion}.0.0.0`;
        }

        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36`;
    }

    _normalizeLanguages(languages, locale = 'en-US') {
        const normalizedLocale = this._normalizeLocale(locale);
        const fallbackLanguages = [normalizedLocale, normalizedLocale.split('-')[0]].filter(Boolean);
        const rawLanguages = Array.isArray(languages)
            ? languages
            : (typeof languages === 'string'
                ? languages.split(',')
                : fallbackLanguages);

        const normalizedLanguages = rawLanguages
            .map((item) => this._normalizeLocale(item))
            .filter(Boolean);

        if (normalizedLanguages.length === 0) {
            return fallbackLanguages;
        }

        return [...new Set(normalizedLanguages)];
    }

    _applyBrowserVersionToProfile(profile = {}, browserVersion = '') {
        if (!profile || typeof profile !== 'object') {
            return profile;
        }

        const majorVersion = this._extractBrowserMajorVersion(browserVersion);
        const uaFullVersion = this._extractBrowserFullVersion(browserVersion);
        const uaBrands = this._buildUserAgentBrands(profile.browserType, majorVersion);

        profile.browserVersion = browserVersion;
        profile.majorVersion = majorVersion;
        profile.uaFullVersion = uaFullVersion;
        profile.uaBrands = uaBrands;
        profile.uaFullVersionList = uaBrands.map((item) => ({
            brand: item.brand,
            version: uaFullVersion
        }));

        if (!profile.hasCustomUserAgent) {
            profile.userAgent = this._buildUserAgent(profile.browserType, browserVersion);
        }

        return profile;
    }

    _buildChromiumUserAgentMetadata(profile = {}) {
        return {
            brands: Array.isArray(profile.uaBrands) ? profile.uaBrands : [],
            fullVersionList: Array.isArray(profile.uaFullVersionList) ? profile.uaFullVersionList : [],
            platform: 'Windows',
            platformVersion: profile.platformVersion || '15.0.0',
            architecture: profile.architecture || 'x86',
            model: profile.model || '',
            mobile: false,
            bitness: profile.bitness || '64',
            wow64: !!profile.wow64
        };
    }

    _randomChoice(values, fallback = null) {
        if (!Array.isArray(values) || values.length === 0) {
            return fallback;
        }

        return values[crypto.randomInt(values.length)];
    }

    _normalizeLocale(locale) {
        const raw = String(locale || '').trim().replace('_', '-');
        return raw || 'en-US';
    }

    _getSystemLocale() {
        try {
            if (app && typeof app.getLocale === 'function') {
                const locale = this._normalizeLocale(app.getLocale());
                if (locale) {
                    return locale;
                }
            }
        } catch (_error) {
        }

        try {
            const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
            if (intlLocale) {
                return this._normalizeLocale(intlLocale);
            }
        } catch (_error) {
        }

        return 'en-US';
    }

    _buildAcceptLanguage(locale) {
        const normalized = this._normalizeLocale(locale);
        const primary = normalized.split('-')[0] || 'en';

        if (primary === 'zh') {
            return `${normalized},${primary};q=0.9,en-US;q=0.8,en;q=0.7`;
        }

        return `${normalized},${primary};q=0.9,en-US;q=0.8,en;q=0.7`;
    }

    _pickCommonViewport() {
        const viewports = [
            { width: 1366, height: 768 },
            { width: 1440, height: 900 },
            { width: 1536, height: 864 },
            { width: 1600, height: 900 },
            { width: 1728, height: 972 },
            { width: 1920, height: 1080 }
        ];

        return this._randomChoice(viewports, { width: 1366, height: 768 });
    }

    _pickDeviceScaleFactor(viewportWidth) {
        if (viewportWidth >= 1920) {
            return this._randomChoice([1, 1.25, 1.5], 1);
        }

        if (viewportWidth >= 1440) {
            return this._randomChoice([1, 1.25], 1);
        }

        return 1;
    }

    _pickHardwareConcurrency() {
        return this._randomChoice([4, 6, 8, 8, 8, 12, 16], 8);
    }

    _pickDeviceMemory() {
        return this._randomChoice([4, 8, 8, 16], 8);
    }

    _pickColorScheme() {
        return this._randomChoice(['light', 'light', 'light', 'dark'], 'light');
    }

    _pickScreenMetrics(viewport) {
        const taskbarHeight = viewport.height >= 900 ? 40 : 32;
        return {
            width: viewport.width,
            height: viewport.height,
            availWidth: viewport.width,
            availHeight: Math.max(0, viewport.height - taskbarHeight),
            availLeft: 0,
            availTop: 0,
            colorDepth: 24,
            pixelDepth: 24
        };
    }

    _buildBrowserProfile(browserType = 'chromium', browserVersion = '', browserSettings = {}) {
        const dynamicFingerprint = browserSettings.dynamic_fingerprint !== false;
        const browserRegion = resolveBrowserRegionKeyFromSettings(browserSettings);
        const regionPreset = getBrowserRegionPreset(browserRegion);
        const locale = this._normalizeLocale(
            browserSettings.locale
            || regionPreset?.locale
            || this._getSystemLocale()
        );
        const timezoneId = browserSettings.timezone_id
            || browserSettings.timezoneId
            || regionPreset?.timezoneId
            || Intl.DateTimeFormat().resolvedOptions().timeZone
            || 'UTC';

        let viewport = browserSettings.viewport;
        if (!viewport || typeof viewport !== 'object') {
            const width = parseInt(browserSettings.viewport_width || browserSettings.window_width, 10);
            const height = parseInt(browserSettings.viewport_height || browserSettings.window_height, 10);

            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                viewport = { width, height };
            } else {
                viewport = dynamicFingerprint ? this._pickCommonViewport() : { width: 1280, height: 720 };
            }
        }

        const screen = browserSettings.screen && typeof browserSettings.screen === 'object'
            ? browserSettings.screen
            : this._pickScreenMetrics(viewport);

        const deviceScaleFactorInput = parseFloat(browserSettings.device_scale_factor);
        const deviceScaleFactor = Number.isFinite(deviceScaleFactorInput) && deviceScaleFactorInput > 0
            ? deviceScaleFactorInput
            : (dynamicFingerprint ? this._pickDeviceScaleFactor(viewport.width) : 1);

        const profile = {
            dynamicFingerprint,
            browserType,
            browserVersion,
            majorVersion: this._extractBrowserMajorVersion(browserVersion),
            uaFullVersion: this._extractBrowserFullVersion(browserVersion),
            region: browserRegion,
            regionLabel: regionPreset?.label || '',
            locale,
            timezoneId,
            viewport,
            screen,
            userAgent: browserSettings.user_agent || this._buildUserAgent(browserType, browserVersion),
            acceptLanguage: browserSettings.accept_language
                || browserSettings.acceptLanguage
                || regionPreset?.acceptLanguage
                || this._buildAcceptLanguage(locale),
            colorScheme: browserSettings.color_scheme || (dynamicFingerprint ? this._pickColorScheme() : 'light'),
            browserBrand: (String(browserType || '').trim().toLowerCase() === 'edge' || String(browserType || '').trim().toLowerCase() === 'system')
                ? 'Microsoft Edge'
                : 'Google Chrome',
            uaBrands: this._buildUserAgentBrands(browserType, this._extractBrowserMajorVersion(browserVersion)),
            uaFullVersionList: this._buildUserAgentBrands(browserType, this._extractBrowserMajorVersion(browserVersion))
                .map(item => ({ brand: item.brand, version: this._extractBrowserFullVersion(browserVersion) })),
            platformVersion: browserSettings.platform_version || '15.0.0',
            architecture: browserSettings.architecture || 'x86',
            bitness: browserSettings.bitness || '64',
            model: browserSettings.model || '',
            wow64: browserSettings.wow64 === true,
            hasCustomUserAgent: !!browserSettings.user_agent,
            hardwareConcurrency: Number.isFinite(parseInt(browserSettings.hardware_concurrency, 10))
                ? Math.max(1, parseInt(browserSettings.hardware_concurrency, 10))
                : (dynamicFingerprint ? this._pickHardwareConcurrency() : 8),
            deviceMemory: Number.isFinite(parseInt(browserSettings.device_memory, 10))
                ? Math.max(1, parseInt(browserSettings.device_memory, 10))
                : (dynamicFingerprint ? this._pickDeviceMemory() : 8),
            deviceScaleFactor,
            maxTouchPoints: Number.isFinite(parseInt(browserSettings.max_touch_points, 10))
                ? Math.max(0, parseInt(browserSettings.max_touch_points, 10))
                : 0,
            navigatorVendor: browserSettings.navigator_vendor || 'Google Inc.',
            navigatorPlatform: browserSettings.navigator_platform || 'Win32',
            languages: this._normalizeLanguages(browserSettings.languages, locale),
            webglVendor: browserSettings.webgl_vendor || browserSettings.webglVendor || 'Google Inc.',
            webglRenderer: browserSettings.webgl_renderer || browserSettings.webglRenderer || 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)',
            mediaDevices: {
                audioinput: browserSettings.media_devices?.audioinput || browserSettings.mediaDevices?.audioinput || 'Default Microphone',
                audiooutput: browserSettings.media_devices?.audiooutput || browserSettings.mediaDevices?.audiooutput || 'Default Speakers',
                videoinput: browserSettings.media_devices?.videoinput || browserSettings.mediaDevices?.videoinput || 'Integrated Camera'
            },
            plugins: this._buildPluginMetadata(browserType)
        };

        return profile;
    }

    async _applyChromiumFingerprintOverrides(context, page, profile = {}) {
        if (!context || !page || typeof context.newCDPSession !== 'function') {
            return false;
        }

        const client = await context.newCDPSession(page);

        await client.send('Network.enable');
        await client.send('Network.setUserAgentOverride', {
            userAgent: profile.userAgent,
            acceptLanguage: profile.acceptLanguage,
            platform: 'Windows',
            userAgentMetadata: this._buildChromiumUserAgentMetadata(profile)
        });

        try {
            await client.send('Emulation.setLocaleOverride', {
                locale: profile.locale
            });
        } catch (_error) {
        }

        try {
            await client.send('Emulation.setTimezoneOverride', {
                timezoneId: profile.timezoneId
            });
        } catch (_error) {
        }

        try {
            await client.send('Emulation.setAutomationOverride', {
                enabled: false
            });
        } catch (_error) {
        }

        return true;
    }

    _buildProfileInitScript(profile) {
        return `
(() => {
  const profile = ${JSON.stringify(profile)};
  const defineGetter = (target, key, value) => {
    if (!target) return;
    try {
      Object.defineProperty(target, key, {
        get: () => value,
        configurable: true
      });
    } catch (_error) {
    }
  };
  const defineValue = (target, key, value) => {
    if (!target) return;
    try {
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        enumerable: false,
        writable: false
      });
    } catch (_error) {
    }
  };

  const navigatorProto = Object.getPrototypeOf(navigator);
  defineGetter(navigatorProto, 'webdriver', undefined);
  defineGetter(navigatorProto, 'languages', profile.languages);
  defineGetter(navigatorProto, 'language', profile.locale);
  defineGetter(navigatorProto, 'platform', profile.navigatorPlatform);
  defineGetter(navigatorProto, 'hardwareConcurrency', profile.hardwareConcurrency);
  defineGetter(navigatorProto, 'deviceMemory', profile.deviceMemory);
  defineGetter(navigatorProto, 'maxTouchPoints', profile.maxTouchPoints);
  defineGetter(navigatorProto, 'vendor', profile.navigatorVendor);
  defineGetter(navigatorProto, 'appCodeName', 'Mozilla');
  defineGetter(navigatorProto, 'appName', 'Netscape');
  defineGetter(navigatorProto, 'product', 'Gecko');
  defineGetter(navigatorProto, 'productSub', '20030107');
  defineGetter(navigatorProto, 'vendorSub', '');
  const javaEnabledFn = function javaEnabled() {
    return false;
  };
  try {
    Object.defineProperty(javaEnabledFn, 'toString', {
      value: () => 'function javaEnabled() { [native code] }',
      configurable: true
    });
  } catch (_error) {
  }
  defineValue(navigatorProto, 'javaEnabled', javaEnabledFn);

  const screenProto = Object.getPrototypeOf(window.screen);
  defineGetter(screenProto, 'width', profile.screen.width);
  defineGetter(screenProto, 'height', profile.screen.height);
  defineGetter(screenProto, 'availWidth', profile.screen.availWidth);
  defineGetter(screenProto, 'availHeight', profile.screen.availHeight);
  defineGetter(screenProto, 'availLeft', profile.screen.availLeft);
  defineGetter(screenProto, 'availTop', profile.screen.availTop);
  defineGetter(screenProto, 'colorDepth', profile.screen.colorDepth);
  defineGetter(screenProto, 'pixelDepth', profile.screen.pixelDepth);

  try {
    if (!window.__browserProfile) {
      Object.defineProperty(window, '__browserProfile', {
        value: profile,
        configurable: true
      });
    }
  } catch (_error) {
  }
})();
        `;
    }

    _buildAdvancedFingerprintInitScript(profile) {
        if (!this._isChromiumFamilyBrowser(profile.browserType)) {
            return '';
        }

        return `
(() => {
  const profile = ${JSON.stringify(profile)};
  const defineGetter = (target, key, value) => {
    if (!target) return;
    try {
      Object.defineProperty(target, key, {
        get: () => value,
        configurable: true
      });
    } catch (_error) {
    }
  };
  const defineValue = (target, key, value) => {
    if (!target) return;
    try {
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        enumerable: false,
        writable: false
      });
    } catch (_error) {
    }
  };
  const makeNativeString = (name) => 'function ' + (name || '') + '() { [native code] }';
  const setNativeToString = (fn, name) => {
    if (typeof fn !== 'function') {
      return fn;
    }
    try {
      Object.defineProperty(fn, 'toString', {
        value: () => makeNativeString(name || fn.name || ''),
        configurable: true
      });
    } catch (_error) {
    }
    return fn;
  };
  const buildMimeType = (data, enabledPlugin) => {
    const mimeType = Object.create(typeof MimeType !== 'undefined' && MimeType.prototype ? MimeType.prototype : Object.prototype);
    defineValue(mimeType, 'type', data.type || '');
    defineValue(mimeType, 'suffixes', data.suffixes || '');
    defineValue(mimeType, 'description', data.description || '');
    defineValue(mimeType, 'enabledPlugin', enabledPlugin || null);
    setNativeToString(mimeType, 'MimeType');
    return mimeType;
  };
  const buildPlugin = (data) => {
    const plugin = Object.create(typeof Plugin !== 'undefined' && Plugin.prototype ? Plugin.prototype : Object.prototype);
    const mimeTypes = Array.isArray(data.mimeTypes) ? data.mimeTypes : [];
    defineValue(plugin, 'name', data.name || '');
    defineValue(plugin, 'filename', data.filename || '');
    defineValue(plugin, 'description', data.description || '');
    defineValue(plugin, 'length', mimeTypes.length);

    const pluginMimeTypes = mimeTypes.map((mimeTypeData) => buildMimeType(mimeTypeData, plugin));
    pluginMimeTypes.forEach((mimeType, index) => {
      defineValue(plugin, index, mimeType);
      if (mimeType && mimeType.type) {
        defineValue(plugin, mimeType.type, mimeType);
      }
    });

    setNativeToString(plugin, 'Plugin');
    return plugin;
  };
  const buildArrayLike = (arrayProto, items, nameKey) => {
    const arrayLike = Object.create(arrayProto || Object.prototype);
    const entries = Array.isArray(items) ? items : [];
    entries.forEach((item, index) => {
      defineValue(arrayLike, index, item);
      if (item && item[nameKey]) {
        defineValue(arrayLike, item[nameKey], item);
      }
    });
    defineValue(arrayLike, 'length', entries.length);

    const itemFn = function item(index) {
      const resolvedIndex = Number(index);
      if (!Number.isFinite(resolvedIndex) || resolvedIndex < 0 || resolvedIndex >= entries.length) {
        return null;
      }
      return entries[resolvedIndex] || null;
    };
    const namedItemFn = function namedItem(name) {
      const targetName = String(name || '');
      return entries.find(item => item && item[nameKey] === targetName) || null;
    };
    const refreshFn = function refresh() {
      return undefined;
    };

    setNativeToString(itemFn, 'item');
    setNativeToString(namedItemFn, 'namedItem');
    setNativeToString(refreshFn, 'refresh');
    defineValue(arrayLike, 'item', itemFn);
    defineValue(arrayLike, 'namedItem', namedItemFn);
    defineValue(arrayLike, 'refresh', refreshFn);
    defineValue(arrayLike, Symbol.iterator, function* iterator() {
      for (const entry of entries) {
        yield entry;
      }
    });

    return arrayLike;
  };
  const pluginProto = typeof PluginArray !== 'undefined' && PluginArray.prototype ? PluginArray.prototype : Object.prototype;
  const mimeTypeProto = typeof MimeTypeArray !== 'undefined' && MimeTypeArray.prototype ? MimeTypeArray.prototype : Object.prototype;
  const pluginObjects = (profile.plugins || []).map((pluginData) => buildPlugin(pluginData));
  const mimeTypeObjects = [];
  pluginObjects.forEach((plugin, index) => {
    const pluginData = Array.isArray(profile.plugins) ? profile.plugins[index] : null;
    const pluginMimeTypes = pluginData && Array.isArray(pluginData.mimeTypes) ? pluginData.mimeTypes : [];
    pluginMimeTypes.forEach((mimeTypeData) => {
      mimeTypeObjects.push(buildMimeType(mimeTypeData, plugin));
    });
  });
  const plugins = buildArrayLike(pluginProto, pluginObjects, 'name');
  const mimeTypes = buildArrayLike(mimeTypeProto, mimeTypeObjects, 'type');
  const uaData = {
    brands: Array.isArray(profile.uaBrands) ? profile.uaBrands : [],
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: async (hints = []) => {
      const requestedHints = new Set(Array.isArray(hints) ? hints.map(item => String(item || '')) : []);
      const response = {
        brands: Array.isArray(profile.uaBrands) ? profile.uaBrands : [],
        fullVersionList: Array.isArray(profile.uaFullVersionList) ? profile.uaFullVersionList : [],
        mobile: false,
        platform: 'Windows',
        platformVersion: profile.platformVersion || '15.0.0',
        architecture: profile.architecture || 'x86',
        bitness: profile.bitness || '64',
        model: profile.model || '',
        uaFullVersion: profile.uaFullVersion || '91.0.0.0',
        wow64: !!profile.wow64
      };

      if (requestedHints.size === 0) {
        return response;
      }

      const filtered = {
        brands: response.brands,
        mobile: response.mobile,
        platform: response.platform
      };

      for (const key of requestedHints) {
        if (Object.prototype.hasOwnProperty.call(response, key)) {
          filtered[key] = response[key];
        }
      }

      return filtered;
    },
    toJSON: () => ({
      brands: Array.isArray(profile.uaBrands) ? profile.uaBrands : [],
      mobile: false,
      platform: 'Windows'
    })
  };
  setNativeToString(uaData.getHighEntropyValues, 'getHighEntropyValues');

  const navigatorProto = Object.getPrototypeOf(navigator);
  defineGetter(navigatorProto, 'plugins', plugins);
  defineGetter(navigatorProto, 'mimeTypes', mimeTypes);
  defineGetter(navigatorProto, 'pdfViewerEnabled', true);
  defineGetter(navigatorProto, 'userAgentData', uaData);

  const permissionsProto = navigator.permissions ? Object.getPrototypeOf(navigator.permissions) : null;
  if (permissionsProto && typeof navigator.permissions.query === 'function') {
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    const buildPermissionStatus = (stateValue) => {
      const permissionStatus = Object.create(typeof PermissionStatus !== 'undefined' && PermissionStatus.prototype ? PermissionStatus.prototype : Object.prototype);
      defineValue(permissionStatus, 'state', stateValue);
      defineValue(permissionStatus, 'onchange', null);
      defineValue(permissionStatus, 'addEventListener', function addEventListener() {});
      defineValue(permissionStatus, 'removeEventListener', function removeEventListener() {});
      defineValue(permissionStatus, 'dispatchEvent', function dispatchEvent() { return false; });
      setNativeToString(permissionStatus.addEventListener, 'addEventListener');
      setNativeToString(permissionStatus.removeEventListener, 'removeEventListener');
      setNativeToString(permissionStatus.dispatchEvent, 'dispatchEvent');
      return permissionStatus;
    };
    const query = function query(parameters = {}) {
      const permissionName = String(parameters && parameters.name ? parameters.name : '');
      if (permissionName === 'notifications' || permissionName === 'push') {
        const state = typeof Notification !== 'undefined' && Notification && typeof Notification.permission === 'string'
          ? Notification.permission
          : 'default';
        return Promise.resolve(buildPermissionStatus(state));
      }

      if (permissionName === 'camera' || permissionName === 'microphone' || permissionName === 'geolocation' || permissionName === 'clipboard-read' || permissionName === 'clipboard-write') {
        return Promise.resolve(buildPermissionStatus('prompt'));
      }

      return originalQuery(parameters);
    };
    setNativeToString(query, 'query');
    defineValue(permissionsProto, 'query', query);
  }

  const webglVendor = String(profile.webglVendor || 'Google Inc.');
  const webglRenderer = String(profile.webglRenderer || 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)');
  const mediaDevicesProfile = profile.mediaDevices && typeof profile.mediaDevices === 'object' ? profile.mediaDevices : {};
  const fakeMediaDevices = [
    { kind: 'audioinput', deviceId: 'default', groupId: 'default', label: String(mediaDevicesProfile.audioinput || 'Default Microphone') },
    { kind: 'audiooutput', deviceId: 'communications', groupId: 'communications', label: String(mediaDevicesProfile.audiooutput || 'Default Speakers') },
    { kind: 'videoinput', deviceId: 'camera-default', groupId: 'camera-default', label: String(mediaDevicesProfile.videoinput || 'Integrated Camera') }
  ];

  try {
    const webglContexts = [];
    if (typeof WebGLRenderingContext !== 'undefined' && WebGLRenderingContext.prototype) {
      webglContexts.push(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype) {
      webglContexts.push(WebGL2RenderingContext.prototype);
    }

    for (const proto of webglContexts) {
      const originalGetParameter = typeof proto.getParameter === 'function' ? proto.getParameter : null;
      const originalGetExtension = typeof proto.getExtension === 'function' ? proto.getExtension : null;
      const originalGetSupportedExtensions = typeof proto.getSupportedExtensions === 'function' ? proto.getSupportedExtensions : null;

      if (originalGetParameter) {
        defineValue(proto, 'getParameter', function getParameter(parameter) {
          if (parameter === 37445) {
            return webglVendor;
          }
          if (parameter === 37446) {
            return webglRenderer;
          }
          return originalGetParameter.apply(this, arguments);
        });
      }

      if (originalGetExtension) {
        defineValue(proto, 'getExtension', function getExtension(name) {
          if (name === 'WEBGL_debug_renderer_info') {
            return {
              UNMASKED_VENDOR_WEBGL: 37445,
              UNMASKED_RENDERER_WEBGL: 37446
            };
          }
          return originalGetExtension.apply(this, arguments);
        });
      }

      if (originalGetSupportedExtensions) {
        defineValue(proto, 'getSupportedExtensions', function getSupportedExtensions() {
          const result = originalGetSupportedExtensions.apply(this, arguments);
          const list = Array.isArray(result) ? [...result] : [];
          if (!list.includes('WEBGL_debug_renderer_info')) {
            list.push('WEBGL_debug_renderer_info');
          }
          return list;
        });
      }
    }
  } catch (_error) {
  }

  try {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices) {
      const mediaDevicesProto = Object.getPrototypeOf(mediaDevices);
      const originalEnumerateDevices = typeof mediaDevices.enumerateDevices === 'function'
        ? mediaDevices.enumerateDevices.bind(mediaDevices)
        : null;
      const originalGetUserMedia = typeof mediaDevices.getUserMedia === 'function'
        ? mediaDevices.getUserMedia.bind(mediaDevices)
        : null;

      if (mediaDevicesProto && originalEnumerateDevices) {
        defineValue(mediaDevicesProto, 'enumerateDevices', async function enumerateDevices() {
          return fakeMediaDevices.map(item => ({ ...item }));
        });
      }

      if (mediaDevicesProto && originalGetUserMedia) {
        defineValue(mediaDevicesProto, 'getUserMedia', function getUserMedia(constraints = {}) {
          return originalGetUserMedia(constraints);
        });
      }
    }
  } catch (_error) {
  }

  try {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {}
      });
    }
    if (window.chrome && !window.chrome.runtime) {
      Object.defineProperty(window.chrome, 'runtime', {
        configurable: true,
        enumerable: true,
        writable: false,
        value: {
          id: undefined,
          connect: function connect() { return null; },
          sendMessage: function sendMessage() { return undefined; },
          getManifest: function getManifest() { return {}; },
          getURL: function getURL(path = '') { return String(path || ''); },
          onMessage: { addListener() {}, removeListener() {}, hasListener() { return false; } },
          onConnect: { addListener() {}, removeListener() {}, hasListener() { return false; } }
        }
      });
      setNativeToString(window.chrome.runtime.connect, 'connect');
      setNativeToString(window.chrome.runtime.sendMessage, 'sendMessage');
      setNativeToString(window.chrome.runtime.getManifest, 'getManifest');
      setNativeToString(window.chrome.runtime.getURL, 'getURL');
    }
  } catch (_error) {
  }
})();
        `;
    }

    _isImageVideoBlockingEnabled(browserSettings = {}) {
        return browserSettings.block_images_videos === true || browserSettings.block_images_videos === 'true';
    }

    _shouldBlockImageVideoRequest(request) {
        if (!request) {
            return false;
        }

        const resourceType = typeof request.resourceType === 'function'
            ? String(request.resourceType() || '').toLowerCase()
            : '';
        if (BLOCKED_ASSET_RESOURCE_TYPES.has(resourceType)) {
            return true;
        }

        const url = typeof request.url === 'function'
            ? String(request.url() || '').toLowerCase()
            : '';
        return BLOCKED_ASSET_URL_PATTERN.test(url);
    }

    async _applyImageVideoRequestBlocking(context, browserSettings = {}) {
        if (!this._isImageVideoBlockingEnabled(browserSettings) || !context || typeof context.route !== 'function') {
            return false;
        }

        try {
            await context.route('**/*', async (route) => {
                const request = route.request();
                if (this._shouldBlockImageVideoRequest(request)) {
                    return route.abort('blockedbyclient');
                }

                return route.continue();
            });

            this.logger.info('已启用图片/视频请求拦截');
            return true;
        } catch (error) {
            this.logger.warning(`启用图片/视频请求拦截失败: ${error.message}`);
            return false;
        }
    }

    async createBrowser(browserType = 'chromium', headless = false, browserOptions = {}) {
        try {
            const browserId = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const rawBrowserOptions = browserOptions && typeof browserOptions === 'object' ? { ...browserOptions } : {};
            const browserSettings = { ...rawBrowserOptions };
            const imageVideoBlockingEnabled = this._isImageVideoBlockingEnabled(browserSettings);
            const watermarkExtensionEnabled = this._isWatermarkExtensionEnabled(browserSettings);
            const watermarkExtensionPath = watermarkExtensionEnabled ? resolveBuiltinWatermarkExtensionPath() : '';
            const normalizedBrowserType = String(browserType || 'electron').trim().toLowerCase() || 'electron';
            const browserProfile = this._buildBrowserProfile(normalizedBrowserType, '', browserSettings);
            const browserDownloadsPath = resolveBrowserDownloadsPath(rawBrowserOptions);
            try {
                if (browserDownloadsPath) {
                    fs.mkdirSync(browserDownloadsPath, { recursive: true });
                }
            } catch (downloadsPathError) {
                this.logger.warning(`准备浏览器下载目录失败: ${downloadsPathError.message}`);
            }
            const shouldLoadWatermarkExtensionInPersistentContext = !!watermarkExtensionPath
                && watermarkExtensionEnabled
                && this._isChromiumFamilyBrowser(normalizedBrowserType)
                && headless !== true;

            if (normalizedBrowserType === 'electron') {
                const electronLaunch = await launchBuiltinElectronBrowser({
                    browserId,
                    browserProfile,
                    browserSettings,
                    browserOptions: rawBrowserOptions,
                    logger: this.logger,
                    headless,
                    launchTimeout: Number.isFinite(parseInt(rawBrowserOptions.timeout, 10))
                        ? Math.max(0, parseInt(rawBrowserOptions.timeout, 10))
                        : 30000
                });

                const browser = electronLaunch.electronApp;
                const context = electronLaunch.context;
                const page = electronLaunch.page;
                const browserVersion = electronLaunch.browserVersion || '';
                this._applyBrowserVersionToProfile(browserProfile, browserVersion);
                this.logger.info(`启动 ${normalizedBrowserType} 浏览器，headless: ${headless}，图片/视频拦截: ${imageVideoBlockingEnabled ? '开启' : '关闭'}`);

                try {
                    await context.addInitScript({ content: this._buildProfileInitScript(browserProfile) });
                    this.logger.info(`已注入动态浏览器 profile: ${browserProfile.viewport.width}x${browserProfile.viewport.height}, ${browserProfile.locale}, ${browserProfile.timezoneId}${browserProfile.region ? `, region=${browserProfile.region}` : ''}`);
                } catch (profileError) {
                    this.logger.warning(`注入动态 profile 脚本失败: ${profileError.message}`);
                }

                const imageVideoBlockingApplied = await this._applyImageVideoRequestBlocking(context, browserSettings);

                if (fs.existsSync(this.stealthScriptPath)) {
                    try {
                        await context.addInitScript({ path: this.stealthScriptPath });
                        this.logger.info(`已注入 stealth 脚本: ${this.stealthScriptPath}`);
                    } catch (stealthError) {
                        this.logger.warning(`注入 stealth 脚本失败: ${stealthError.message}`);
                    }
                } else {
                    this.logger.warning(`未找到 stealth 脚本: ${this.stealthScriptPath}`);
                }

                const advancedFingerprintScript = this._buildAdvancedFingerprintInitScript(browserProfile);
                if (advancedFingerprintScript) {
                    try {
                        await context.addInitScript({ content: advancedFingerprintScript });
                        this.logger.info('已注入增强浏览器指纹脚本');
                    } catch (fingerprintError) {
                        this.logger.warning(`注入增强浏览器指纹脚本失败: ${fingerprintError.message}`);
                    }
                }

                if (this._isChromiumFamilyBrowser(normalizedBrowserType)) {
                    try {
                        await this._applyChromiumFingerprintOverrides(context, page, browserProfile);
                        this.logger.info('已通过 CDP 对齐 User-Agent / Client Hints / locale / timezone');
                    } catch (cdpError) {
                        this.logger.warning(`应用 CDP 浏览器指纹覆盖失败: ${cdpError.message}`);
                    }
                }

                page.setDefaultTimeout(30000);
                page.setDefaultNavigationTimeout(30000);

                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
                } catch (error) {
                    this.logger.debug(`页面初始化验证失败，但继续: ${error.message}`);
                }

                this.browsers.set(browserId, {
                    browser,
                    context,
                    page,
                    type: normalizedBrowserType,
                    kind: 'electron',
                    displayMode: 'window',
                    hidden: false,
                    createdAt: Date.now(),
                    profile: browserProfile,
                    requestBlocking: {
                        imagesAndVideos: imageVideoBlockingApplied
                    },
                    cleanup: electronLaunch.cleanup,
                    userDataDir: electronLaunch.userDataDir
                });

                const syncBrowserEntry = (reason = '') => {
                    const currentEntry = this.browsers.get(browserId);
                    if (!currentEntry) {
                        return;
                    }

                    const isBrowserConnected = currentEntry.browser && typeof currentEntry.browser.isConnected === 'function'
                        ? currentEntry.browser.isConnected()
                        : true;
                    let openPages = [];
                    try {
                        openPages = currentEntry.context && typeof currentEntry.context.pages === 'function'
                            ? currentEntry.context.pages().filter(item => item && typeof item.isClosed === 'function' ? !item.isClosed() : !!item)
                            : [];
                    } catch (_error) {
                        openPages = [];
                    }

                if (!isBrowserConnected || openPages.length === 0) {
                    this.browsers.delete(browserId);
                    if (currentEntry.cleanup && typeof currentEntry.cleanup === 'function') {
                        Promise.resolve(currentEntry.cleanup()).catch((cleanupError) => {
                            this.logger.warning(`清理内置 Electron 浏览器目录失败: ${cleanupError.message}`);
                        });
                    }
                    this._emitBrowserLifecycle({
                        browserId,
                        reason: openPages.length === 0 ? 'page-close' : 'browser-disconnected',
                        kind: currentEntry.kind || 'unknown'
                    });
                    this.logger.info(`浏览器实例已从管理器移除: ${browserId}${reason ? ` (${reason})` : ''}`);
                    return;
                }

                    if (!currentEntry.page || (typeof currentEntry.page.isClosed === 'function' && currentEntry.page.isClosed())) {
                        currentEntry.page = [...openPages].reverse().find(Boolean) || openPages[0];
                        this.browsers.set(browserId, currentEntry);
                        this.logger.info(`浏览器 ${browserId} 已自动切换到存活页面: ${typeof currentEntry.page?.url === 'function' ? currentEntry.page.url() : 'unknown'}`);
                    }
                };

                const bindPageLifecycle = (targetPage) => {
                    if (!targetPage || typeof targetPage.on !== 'function') {
                        return;
                    }

                    targetPage.on('close', () => {
                        setTimeout(() => {
                            syncBrowserEntry('page close');
                        }, 0);
                    });
                };

                if (browser && typeof browser.on === 'function') {
                    browser.on('close', () => {
                        syncBrowserEntry('browser closed');
                    });
                }

                if (context && typeof context.on === 'function') {
                    context.on('close', () => {
                        syncBrowserEntry('context close');
                    });
                    context.on('page', (newPage) => {
                        const currentEntry = this.browsers.get(browserId);
                        if (currentEntry) {
                            currentEntry.page = newPage;
                            currentEntry.lastMirroredUrl = '';
                            this.browsers.set(browserId, currentEntry);
                        }
                        bindPageLifecycle(newPage);
                    });
                }

                bindPageLifecycle(page);

                this.logger.info(`浏览器实例创建成功: ${browserId}`);
                return browserId;
            }

            // 选择浏览器类型
            let browserLauncher;
            let executablePath = null;

            switch (normalizedBrowserType) {
                case 'system':
                case 'edge':
                    // 只使用系统 Edge，不使用 Playwright Chromium
                    executablePath = await findBrowserByName('edge');
                    if (!executablePath) {
                        throw new Error('未找到系统 Edge 浏览器，请确保 Edge 已正确安装，或选择其他浏览器类型');
                    }
                    browserLauncher = chromium;
                    break;
                case 'chrome':
                    // 只使用系统 Chrome，不使用 Playwright Chromium
                    executablePath = await findBrowserByName('chrome');
                    if (!executablePath) {
                        throw new Error('未找到系统 Chrome 浏览器，请确保 Chrome 已正确安装，或选择其他浏览器类型');
                    }
                    browserLauncher = chromium;
                    break;
                case 'chromium':
                default:
                    // 直接使用 Playwright Chromium
                    browserLauncher = chromium;
                    break;
            }

            // 构建启动参数
            const launchOptions = {
                headless: headless,
                downloadsPath: browserDownloadsPath,
                args: [
                    ...buildSandboxLaunchArgs(),
                    '--disable-dev-shm-usage',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--password-store=basic',
                    '--force-color-profile=srgb',
                    '--disable-blink-features=AutomationControlled',
                    `--lang=${browserProfile.locale}`,
                    `--window-size=${browserProfile.viewport.width},${browserProfile.viewport.height}`
                ]
            };

            if (headless) {
                launchOptions.args.push('--disable-gpu');
            }

            if (Array.isArray(rawBrowserOptions.args) && rawBrowserOptions.args.length > 0) {
                launchOptions.args.push(...rawBrowserOptions.args);
            }

            launchOptions.ignoreDefaultArgs = [
                '--enable-automation',
                ...(Array.isArray(rawBrowserOptions.ignoreDefaultArgs) ? rawBrowserOptions.ignoreDefaultArgs : [])
            ];

            if (rawBrowserOptions.executablePath) {
                launchOptions.executablePath = rawBrowserOptions.executablePath;
            }

            if (rawBrowserOptions.proxy) {
                launchOptions.proxy = rawBrowserOptions.proxy;
            }

            if (rawBrowserOptions.env) {
                launchOptions.env = rawBrowserOptions.env;
            }

            if (rawBrowserOptions.channel) {
                launchOptions.channel = rawBrowserOptions.channel;
            }

            // 只在使用 Playwright 默认浏览器时设置浏览器路径
            if (!executablePath && normalizedBrowserType === 'chromium') {
                // 检查是否在打包后的环境中
                const appPath = path.dirname(process.execPath);
                const playwrightBrowsersPath = path.join(appPath, 'resources', 'playwright-browsers');

                if (fs.existsSync(playwrightBrowsersPath)) {
                    // 设置 Playwright 浏览器下载路径
                    process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;
                    this.logger.info(`设置 Playwright 浏览器路径: ${playwrightBrowsersPath}`);
                }
            }

            // 如果使用系统浏览器，添加 executablePath
            if (executablePath) {
                launchOptions.executablePath = executablePath;
                this.logger.info(`使用系统浏览器: ${executablePath}`);
            }

            this.logger.info(`启动 ${normalizedBrowserType} 浏览器，headless: ${headless}，图片/视频拦截: ${imageVideoBlockingEnabled ? '开启' : '关闭'}`);

            if (watermarkExtensionEnabled) {
                if (watermarkExtensionPath) {
                    this.logger.info(`已定位去水印插件目录: ${watermarkExtensionPath}`);
                } else {
                    this.logger.warning('已启用去水印插件，但未找到插件目录');
                }
            } else {
                this.logger.info('已禁用去水印插件');
            }

            let browser = null;
            let context = null;
            let persistentUserDataDir = '';
            let cleanupPersistentUserDataDir = false;

            if (shouldLoadWatermarkExtensionInPersistentContext) {
                if (headless === true) {
                    this.logger.warning('去水印插件在 headless 模式下不可用，已跳过扩展加载');
                }

                persistentUserDataDir = String(rawBrowserOptions.userDataDir || '').trim();
                if (!persistentUserDataDir) {
                    persistentUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-register-browser-'));
                    cleanupPersistentUserDataDir = true;
                }

                const persistentLaunchOptions = {
                    ...launchOptions,
                    acceptDownloads: true,
                    args: [
                        ...(Array.isArray(launchOptions.args) ? launchOptions.args : []),
                        `--disable-extensions-except=${watermarkExtensionPath}`,
                    `--load-extension=${watermarkExtensionPath}`
                    ]
                };

                context = await browserLauncher.launchPersistentContext(persistentUserDataDir, persistentLaunchOptions);
                browser = typeof context.browser === 'function' ? context.browser() : null;
                if (!browser) {
                    browser = {
                        isConnected: () => !context.isClosed(),
                        close: async () => context.close()
                    };
                }
                this.logger.info('已通过持久化上下文加载去水印插件');
            } else {
                // 启动浏览器
                browser = await browserLauncher.launch(launchOptions);
            }

            let browserVersion = '';
            try {
                browserVersion = browser && typeof browser.version === 'function'
                    ? await browser.version()
                    : '';
            } catch (versionError) {
                this.logger.debug(`获取浏览器版本失败，使用默认 UA: ${versionError.message}`);
            }
            this._applyBrowserVersionToProfile(browserProfile, browserVersion);

            if (!context) {
                // 创建浏览器上下文
                const contextOptions = {
                    acceptDownloads: true,
                    viewport: browserProfile.viewport,
                    screen: browserProfile.screen,
                    userAgent: browserProfile.userAgent,
                    locale: browserProfile.locale,
                    timezoneId: browserProfile.timezoneId,
                    deviceScaleFactor: browserProfile.deviceScaleFactor,
                    colorScheme: browserProfile.colorScheme,
                    isMobile: false,
                    hasTouch: false,
                    extraHTTPHeaders: {
                        'Accept-Language': browserProfile.acceptLanguage
                    }
                };

                context = await browser.newContext(contextOptions);
            }

            try {
                await context.addInitScript({ content: this._buildProfileInitScript(browserProfile) });
                this.logger.info(`已注入动态浏览器 profile: ${browserProfile.viewport.width}x${browserProfile.viewport.height}, ${browserProfile.locale}, ${browserProfile.timezoneId}${browserProfile.region ? `, region=${browserProfile.region}` : ''}`);
            } catch (profileError) {
                this.logger.warning(`注入动态 profile 脚本失败: ${profileError.message}`);
            }

            const imageVideoBlockingApplied = await this._applyImageVideoRequestBlocking(context, browserSettings);

            if (fs.existsSync(this.stealthScriptPath)) {
                try {
                    await context.addInitScript({ path: this.stealthScriptPath });
                    this.logger.info(`已注入 stealth 脚本: ${this.stealthScriptPath}`);
                } catch (stealthError) {
                    this.logger.warning(`注入 stealth 脚本失败: ${stealthError.message}`);
                }
            } else {
                this.logger.warning(`未找到 stealth 脚本: ${this.stealthScriptPath}`);
            }

            const advancedFingerprintScript = this._buildAdvancedFingerprintInitScript(browserProfile);
            if (advancedFingerprintScript) {
                try {
                    await context.addInitScript({ content: advancedFingerprintScript });
                    this.logger.info('已注入增强浏览器指纹脚本');
                } catch (fingerprintError) {
                    this.logger.warning(`注入增强浏览器指纹脚本失败: ${fingerprintError.message}`);
                }
            }

            // 创建页面
            const existingPages = typeof context.pages === 'function' ? context.pages() : [];
            const page = existingPages && existingPages.length > 0
                ? existingPages[0]
                : await context.newPage();

            if (this._isChromiumFamilyBrowser(browserType)) {
                try {
                    await this._applyChromiumFingerprintOverrides(context, page, browserProfile);
                    this.logger.info('已通过 CDP 对齐 User-Agent / Client Hints / locale / timezone');
                } catch (cdpError) {
                    this.logger.warning(`应用 CDP 浏览器指纹覆盖失败: ${cdpError.message}`);
                }
            }

            // 设置页面超时
            page.setDefaultTimeout(30000); // 30秒
            page.setDefaultNavigationTimeout(30000);

            // 验证页面是否可用
            try {
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
            } catch (error) {
                this.logger.debug(`页面初始化验证失败，但继续: ${error.message}`);
            }

            // 存储浏览器实例
            this.browsers.set(browserId, {
                browser,
                context,
                page,
                type: normalizedBrowserType,
                kind: shouldLoadWatermarkExtensionInPersistentContext ? 'playwright-persistent' : 'playwright',
                hidden: false,
                createdAt: Date.now(),
                profile: browserProfile,
                requestBlocking: {
                    imagesAndVideos: imageVideoBlockingApplied
                }
                ,
                cleanup: cleanupPersistentUserDataDir
                    ? async () => {
                        try {
                            await fs.promises.rm(persistentUserDataDir, { recursive: true, force: true });
                        } catch (cleanupError) {
                            this.logger.warning(`清理持久化浏览器目录失败: ${cleanupError.message}`);
                        }
                    }
                    : null,
                userDataDir: persistentUserDataDir || rawBrowserOptions.userDataDir || ''
            });

            const syncBrowserEntry = (reason = '') => {
                const currentEntry = this.browsers.get(browserId);
                if (!currentEntry) {
                    return;
                }

                const isBrowserConnected = currentEntry.browser && typeof currentEntry.browser.isConnected === 'function'
                    ? currentEntry.browser.isConnected()
                    : true;
                let openPages = [];
                try {
                    openPages = currentEntry.context && typeof currentEntry.context.pages === 'function'
                        ? currentEntry.context.pages().filter(item => item && typeof item.isClosed === 'function' ? !item.isClosed() : !!item)
                        : [];
                } catch (_error) {
                    openPages = [];
                }

                if (!isBrowserConnected || openPages.length === 0) {
                    this.browsers.delete(browserId);
                    this._emitBrowserLifecycle({
                        browserId,
                        reason: openPages.length === 0 ? 'page-close' : 'browser-disconnected',
                        kind: currentEntry.kind || 'unknown'
                    });
                    this.logger.info(`浏览器实例已从管理器移除: ${browserId}${reason ? ` (${reason})` : ''}`);
                    return;
                }

                if (!currentEntry.page || (typeof currentEntry.page.isClosed === 'function' && currentEntry.page.isClosed())) {
                    currentEntry.page = [...openPages].reverse().find(Boolean) || openPages[0];
                    this.browsers.set(browserId, currentEntry);
                    this.logger.info(`浏览器 ${browserId} 已自动切换到存活页面: ${typeof currentEntry.page?.url === 'function' ? currentEntry.page.url() : 'unknown'}`);
                }
            };

            const bindPageLifecycle = (targetPage) => {
                if (!targetPage || typeof targetPage.on !== 'function') {
                    return;
                }

                targetPage.on('close', () => {
                    setTimeout(() => {
                        syncBrowserEntry('page close');
                    }, 0);
                });
            };

            if (browser && typeof browser.on === 'function') {
                browser.on('disconnected', () => {
                    syncBrowserEntry('browser disconnected');
                });
            }

            if (context && typeof context.on === 'function') {
                context.on('close', () => {
                    syncBrowserEntry('context close');
                });
                context.on('page', (newPage) => {
                    const currentEntry = this.browsers.get(browserId);
                    if (currentEntry) {
                        currentEntry.page = newPage;
                        this.browsers.set(browserId, currentEntry);
                    }
                    bindPageLifecycle(newPage);
                });
            }

            bindPageLifecycle(page);

            this.logger.info(`浏览器实例创建成功: ${browserId}`);
            return browserId;

        } catch (error) {
            this.logger.error(`创建浏览器失败: ${error.message}`);
            throw error;
        }
    }

    getBrowser(browserId) {
        const browserData = this.browsers.get(browserId);
        if (!browserData) {
            return null;
        }

        if (browserData.page && typeof browserData.page.isClosed === 'function' && !browserData.page.isClosed()) {
            return browserData.page;
        }

        try {
            const openPages = browserData.context && typeof browserData.context.pages === 'function'
                ? browserData.context.pages().filter(page => page && typeof page.isClosed === 'function' ? !page.isClosed() : !!page)
                : [];
            if (openPages.length > 0) {
                browserData.page = [...openPages].reverse().find(Boolean) || openPages[0];
                this.browsers.set(browserId, browserData);
                return browserData.page;
            }
        } catch (_error) {}

        return null;
    }

    getBrowserData(browserId) {
        return this.browsers.get(browserId) || null;
    }

    async setBrowserPage(browserId, page) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                return false;
            }

            if (!page || typeof page.isClosed !== 'function' || page.isClosed()) {
                return false;
            }

            browserData.page = page;
            this.browsers.set(browserId, browserData);
            this.logger.info(`浏览器 ${browserId} 已切换到新页面: ${typeof page.url === 'function' ? page.url() : 'unknown'}`);
            return true;
        } catch (error) {
            this.logger.warning(`切换浏览器页面失败: ${error.message}`);
            return false;
        }
    }

    async hideBrowser(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                return false;
            }

            if (browserData.kind === 'electron' && browserData.browser && typeof browserData.browser.evaluate === 'function') {
                await browserData.browser.evaluate(({ BrowserWindow }) => {
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (win && !win.isDestroyed()) {
                            win.hide();
                        }
                    }
                });
                browserData.hidden = true;
                this.browsers.set(browserId, browserData);
                this.logger.info(`浏览器实例已隐藏: ${browserId}`);
                return true;
            }

            return false;
        } catch (error) {
            this.logger.warning(`隐藏浏览器失败: ${error.message}`);
            return false;
        }
    }

    async showBrowser(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                return false;
            }

            if (browserData.kind === 'electron' && browserData.browser && typeof browserData.browser.evaluate === 'function') {
                await browserData.browser.evaluate(({ BrowserWindow }) => {
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (win && !win.isDestroyed()) {
                            win.show();
                            win.focus();
                        }
                    }
                });
                browserData.hidden = false;
                this.browsers.set(browserId, browserData);
                this.logger.info(`浏览器实例已显示: ${browserId}`);
                return true;
            }

            return false;
        } catch (error) {
            this.logger.warning(`显示浏览器失败: ${error.message}`);
            return false;
        }
    }

    async getCookies(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                throw new Error(`浏览器实例不存在: ${browserId}`);
            }

            const cookies = await browserData.context.cookies();
            return cookies;
        } catch (error) {
            this.logger.error(`获取Cookie失败: ${error.message}`);
            return [];
        }
    }

    async getBrowserState(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                throw new Error(`浏览器实例不存在: ${browserId}`);
            }

            const readCookies = async () => {
                const directCookies = await browserData.context.cookies();
                const pages = typeof browserData.context.pages === 'function'
                    ? browserData.context.pages()
                    : (browserData.page ? [browserData.page] : []);
                const urls = [];
                for (const page of Array.isArray(pages) ? pages : []) {
                    if (!page || typeof page.url !== 'function') {
                        continue;
                    }
                    const url = String(page.url() || '').trim();
                    if (url) {
                        urls.push(url);
                    }
                }

                let urlCookies = [];
                if (urls.length > 0) {
                    try {
                        urlCookies = await browserData.context.cookies(urls);
                    } catch (error) {
                        this.logger.debug?.(`按页面 URL 读取 Cookie 失败: ${error.message}`);
                    }
                }

                const merged = [...(Array.isArray(directCookies) ? directCookies : []), ...(Array.isArray(urlCookies) ? urlCookies : [])];
                const seen = new Set();
                return merged.filter((cookie) => {
                    if (!cookie || !cookie.name) {
                        return false;
                    }
                    const key = `${cookie.name || ''}||${cookie.domain || ''}||${cookie.path || ''}||${cookie.url || ''}`;
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            };

            const pollCookies = async () => {
                const mergedCookies = [];
                const seenCookies = new Set();
                let stableRounds = 0;
                const maxRounds = 8;

                for (let round = 0; round < maxRounds; round += 1) {
                    const currentCookies = await readCookies();
                    let addedCount = 0;

                    for (const cookie of Array.isArray(currentCookies) ? currentCookies : []) {
                        const key = `${cookie.name || ''}||${cookie.domain || ''}||${cookie.path || ''}||${cookie.url || ''}`;
                        if (seenCookies.has(key)) {
                            continue;
                        }
                        seenCookies.add(key);
                        mergedCookies.push(cookie);
                        addedCount += 1;
                    }

                    if (addedCount === 0) {
                        stableRounds += 1;
                    } else {
                        stableRounds = 0;
                    }

                    if (stableRounds >= 2) {
                        break;
                    }

                    if (round < maxRounds - 1) {
                        await new Promise((resolve) => setTimeout(resolve, 400));
                    }
                }

                return mergedCookies;
            };

            const cookies = await pollCookies();

            const pages = typeof browserData.context.pages === 'function'
                ? browserData.context.pages()
                : (browserData.page ? [browserData.page] : []);

            const storageSnapshots = [];
            const seenOrigins = new Set();

            for (const page of Array.isArray(pages) ? pages : []) {
                if (!page || typeof page.evaluate !== 'function') {
                    continue;
                }

                let snapshot = null;
                try {
                    snapshot = await page.evaluate(() => {
                        const collect = (storage) => {
                            const result = {};
                            try {
                                const length = storage && typeof storage.length === 'number' ? storage.length : 0;
                                for (let index = 0; index < length; index += 1) {
                                    const key = storage.key(index);
                                    if (!key) {
                                        continue;
                                    }
                                    result[key] = storage.getItem(key);
                                }
                            } catch (_error) {
                            }
                            return result;
                        };

                        return {
                            url: String(window.location.href || ''),
                            origin: String(window.location.origin || ''),
                            localStorage: collect(window.localStorage),
                            sessionStorage: collect(window.sessionStorage)
                        };
                    });
                } catch (error) {
                    this.logger.debug?.(`读取页面浏览器存储失败: ${error.message}`);
                    continue;
                }

                const origin = String(snapshot?.origin || snapshot?.url || '').trim();
                if (!origin || seenOrigins.has(origin)) {
                    continue;
                }

                seenOrigins.add(origin);
                storageSnapshots.push(snapshot);
            }

            return {
                cookies: Array.isArray(cookies) ? cookies : [],
                browserStorage: storageSnapshots
            };
        } catch (error) {
            this.logger.error(`获取浏览器状态失败: ${error.message}`);
            return {
                cookies: [],
                browserStorage: []
            };
        }
    }

    async setCookies(browserId, cookies = []) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                throw new Error(`浏览器实例不存在: ${browserId}`);
            }

            if (!Array.isArray(cookies) || cookies.length === 0) {
                this.logger.info(`浏览器 ${browserId} 没有可注入的Cookie`);
                return true;
            }

            await browserData.context.addCookies(cookies);
            this.logger.info(`浏览器 ${browserId} 已注入 ${cookies.length} 个Cookie`);
            return true;
        } catch (error) {
            this.logger.error(`注入Cookie失败: ${error.message}`);
            return false;
        }
    }

    async closeBrowser(browserId, options = {}) {
        const { silent = false } = options;
        let browserData = null;

        try {
            if (!browserId) {
                return false;
            }

            if (this.closingBrowsers.has(browserId)) {
                if (!silent) {
                    this.logger.debug(`浏览器已在关闭中，跳过重复关闭: ${browserId}`);
                }
                return false;
            }

            browserData = this.browsers.get(browserId);
            if (!browserData) {
                if (!silent) {
                    this.logger.debug(`浏览器已不存在，跳过关闭: ${browserId}`);
                }
                this.browsers.delete(browserId);
                return false;
            }

            this.closingBrowsers.add(browserId);

            if (browserData.kind === 'electron') {
                if (browserData.context && typeof browserData.context.close === 'function') {
                    await browserData.context.close();
                } else if (browserData.browser && typeof browserData.browser.close === 'function') {
                    await browserData.browser.close();
                }
            } else {
                // 关闭页面、上下文和浏览器
                if (browserData.page && !browserData.page.isClosed()) {
                    await browserData.page.close();
                }

                if (browserData.context) {
                    await browserData.context.close();
                }

                if (browserData.browser && browserData.browser.isConnected()) {
                    await browserData.browser.close();
                }
            }

            if (browserData.cleanup && typeof browserData.cleanup === 'function') {
                await browserData.cleanup().catch(() => {});
            }

            this.browsers.delete(browserId);
            this._emitBrowserLifecycle({
                browserId,
                reason: 'close',
                kind: browserData?.kind || 'unknown'
            });
            this.logger.info(`浏览器实例关闭成功: ${browserId}`);
            return true;

        } catch (error) {
            this.logger.error(`关闭浏览器失败: ${error.message}`);
            if (browserData && browserData.cleanup && typeof browserData.cleanup === 'function') {
                await browserData.cleanup().catch(() => {});
            }
            // 即使出错也要从Map中移除
            this.browsers.delete(browserId);
            return false;
        } finally {
            if (browserId) {
                this.closingBrowsers.delete(browserId);
            }
        }
    }

    async closeAll(options = {}) {
        const {
            skipSystemCleanup = false,
            silentIfEmpty = true
        } = options;

        if (this.cleanupInProgress) {
            this.logger.debug('浏览器批量清理已在进行中，跳过重复调用');
            return { closedCount: 0, skipped: true };
        }

        this.cleanupInProgress = true;

        try {
            const browserIds = Array.from(this.browsers.keys());
            if (browserIds.length === 0) {
                if (!silentIfEmpty) {
                    this.logger.info('没有管理的浏览器实例，跳过系统级清理');
                }
                return { closedCount: 0, skipped: true };
            }

            this.logger.info(`开始关闭 ${browserIds.length} 个浏览器实例`);

            const closePromises = browserIds.map(id => this.closeBrowser(id, { silent: true }));
            await Promise.allSettled(closePromises);

            // 等待一段时间确保完全关闭
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 系统级清理 - 只有当有管理的浏览器实例时才执行
            if (this.enableSystemCleanup && !skipSystemCleanup) {
                this.logger.info('执行系统级浏览器进程清理');
                await this._killBrowserProcesses();
            }

            this.logger.info('所有浏览器实例关闭完成');
            return { closedCount: browserIds.length, skipped: false };
        } finally {
            this.cleanupInProgress = false;
        }
    }

    getBrowserCount() {
        return this.browsers.size;
    }

    async checkBrowserProcesses() {
        try {
            // 检查是否有残留的浏览器进程
            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq chrome.exe" /NH');
            const chromeProcesses = stdout.split('\n').filter(line => line.trim().length > 0);

            const { stdout: edgeStdout } = await execAsync('tasklist /FI "IMAGENAME eq msedge.exe" /NH');
            const edgeProcesses = edgeStdout.split('\n').filter(line => line.trim().length > 0);

            return chromeProcesses.length > 0 || edgeProcesses.length > 0;
        } catch (error) {
            this.logger.error(`检查浏览器进程失败: ${error.message}`);
            return false;
        }
    }

    async _killBrowserProcesses(force = false) {
        try {
            const processes = ['chrome.exe', 'msedge.exe'];

            for (const processName of processes) {
                try {
                    if (force) {
                        await execAsync(`taskkill /F /IM ${processName} /T`);
                        this.logger.warning(`强制终止进程: ${processName}`);
                    } else {
                        await execAsync(`taskkill /IM ${processName} /T`);
                        this.logger.info(`终止进程: ${processName}`);
                    }
                } catch (error) {
                    // 忽略进程不存在的错误
                    if (!error.message.includes('not found')) {
                        this.logger.debug(`终止进程 ${processName} 失败: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            this.logger.error(`系统级浏览器进程清理失败: ${error.message}`);
        }
    }

    setLogger(logger) {
        this.logger = logger;
    }

    // 获取所有浏览器信息（用于调试）
    getBrowserInfo() {
        const info = {};
        for (const [id, data] of this.browsers) {
            info[id] = {
                type: data.type,
                createdAt: new Date(data.createdAt).toISOString(),
                pageClosed: data.page ? data.page.isClosed() : true,
                browserConnected: data.browser ? data.browser.isConnected() : false,
                requestBlocking: data.requestBlocking || null,
                profile: data.profile ? {
                    dynamicFingerprint: data.profile.dynamicFingerprint,
                    viewport: data.profile.viewport,
                    region: data.profile.region,
                    regionLabel: data.profile.regionLabel,
                    locale: data.profile.locale,
                    timezoneId: data.profile.timezoneId,
                    userAgent: data.profile.userAgent
                } : null
            };
        }
        return info;
    }
}

module.exports = BrowserManager;
