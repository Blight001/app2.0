const { app } = require('electron');
const {
  REGION_PRESETS,
  getBrowserRegionPreset,
  inferBrowserRegionKeyFromLocale,
} = require('./browser-region');
const { callOptional, firstNonNull, firstText } = require('../../shared/safe-values');

const TAB_PLATFORM = 'Win32';
// Cloudflare trace 作为权威首选。其余服务可能被 Clash 的国内规则分流为
// DIRECT，不能再与 Cloudflare 并发抢答，否则较快的中国直连结果会误判出口。
const GEO_IP_PRIMARY_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_IP_FALLBACK_ENDPOINTS = [
  'https://ipwho.is/',
  'https://ipinfo.io/json',
  'https://api.ip.sb/geoip',
];
const GEO_IP_REQUEST_TIMEOUT_MS = 5000;
const GEO_IP_PRIMARY_TIMEOUT_MS = 3000;
const GEO_IP_OVERALL_TIMEOUT_MS = 6000;
const GEO_IP_CACHE_TTL_MS = 5 * 60 * 1000;

const cachedGeoProfiles = new Map();
const pendingGeoProfiles = new Map();

function text(...values) {
  return firstText(...values).trim();
}

function getChromiumVersion() {
  return String(process.versions?.chrome || '122.0.0.0').trim() || '122.0.0.0';
}

function getChromiumMajorVersion() {
  return getChromiumVersion().split('.')[0] || '122';
}

function getDefaultLocale() {
  try {
    const locale = String(app?.getLocale?.() || '').trim().replace('_', '-');
    if (locale) return locale;
  } catch (_) {}
  try {
    return String(Intl.DateTimeFormat().resolvedOptions().locale || 'en-US').replace('_', '-');
  } catch (_) {
    return 'en-US';
  }
}

function normalizeLocale(locale) {
  return String(locale || '').trim().replace('_', '-') || getDefaultLocale();
}

function normalizeRegionKey(region) {
  return String(region || '').trim().toLowerCase().replace(/\s+/g, '');
}

function shouldResolveProfileFromIp(settings = {}) {
  return settings.language?.mode === 'ip'
    || settings.timezone?.mode === 'ip'
    || settings.geolocation?.mode === 'ip';
}

function inferRegionFromCountry(countryCode) {
  const normalized = normalizeRegionKey(countryCode).replace(/[^a-z0-9]/g, '');
  if (REGION_PRESETS[normalized]) return normalized;
  return ({
    uk: 'gb', unitedkingdom: 'gb', greatbritain: 'gb', britain: 'gb',
    china: 'cn', mainlandchina: 'cn', peoplesrepublicofchina: 'cn',
    hongkong: 'hk', hongkongsar: 'hk', taiwan: 'tw', republicofchina: 'tw',
    southkorea: 'kr', korea: 'kr', singapore: 'sg',
    unitedstates: 'us', usa: 'us', america: 'us', canada: 'ca',
    australia: 'au', netherlands: 'nl', india: 'in', russia: 'ru', thailand: 'th',
  })[normalized] || null;
}

function inferRegionFromIpInfo(info = {}) {
  const country = info.country_code || info.countryCode || info.country
    || info.country_name || info.countryName || '';
  return inferRegionFromCountry(country)
    || inferBrowserRegionKeyFromLocale(info.locale || info.language || '');
}

function parseCloudflareTrace(raw) {
  const text = typeof raw === 'string'
    ? raw
    : (raw && typeof raw.raw === 'string' ? raw.raw : '');
  if (!/(^|\n)\s*ip=/i.test(text) || !/(^|\n)\s*loc=/i.test(text)) return null;

  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) fields[key] = value;
  }
  if (!fields.ip || !fields.loc) return null;
  return {
    ip: fields.ip,
    country_code: fields.loc,
    country: fields.loc,
  };
}

function buildGeoProfile(response, endpoint) {
  if (response && response.ok === false) return null;
  const body = response && response.body && typeof response.body === 'object'
    ? response.body
    : parseCloudflareTrace(response && (response.body || response.raw));
  if (!body || body.success === false || body.error === true) return null;

  const regionKey = inferRegionFromIpInfo(body);
  if (!regionKey) return null;

  const country = text(body.country_code, body.countryCode, body.country, body.country_name, body.countryName);
  const countryCode = text(
    body.country_code,
    body.countryCode,
    /^[a-z]{2}$/i.test(country) ? country : '',
  );
  const rawTimezone = body.timezone;
  const timezoneValue = rawTimezone && typeof rawTimezone === 'object'
    ? firstNonNull(rawTimezone.id, rawTimezone.name, rawTimezone.timezone)
    : rawTimezone;

  return {
    regionKey,
    sourceIp: text(body.ip, body.query, body.ip_address, body.ipAddress),
    sourceCountryCode: countryCode,
    sourceCountry: text(body.country_name, body.countryName, body.country),
    sourceRegion: text(body.region, body.region_name, body.regionName),
    sourceCity: text(body.city),
    timezoneId: text(timezoneValue, body.timezone_id, body.timezoneId),
    endpoint,
    raw: body,
  };
}

function getAcceptLanguage(locale) {
  const normalized = normalizeLocale(locale);
  const primary = normalized.split('-')[0] || 'en';
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

function positiveNumber(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function resolveBrowserMajorVersion(settings) {
  const kernelVersion = text(settings.kernelVersion);
  const usableKernel = kernelVersion
    && kernelVersion.toLowerCase() !== 'auto'
    && /^\d/.test(kernelVersion);
  const kernelMajor = usableKernel ? kernelVersion.split('.')[0] : '';
  return text(kernelMajor, settings.browserVersion, getChromiumMajorVersion()).split('.')[0]
    || getChromiumMajorVersion();
}

function resolveBrowserUserAgent(settings, os, major) {
  const osTokens = { win7: 'Windows NT 6.1', win8: 'Windows NT 6.2' };
  const osToken = osTokens[os] || 'Windows NT 10.0';
  const fallback = `Mozilla/5.0 (${osToken}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const ua = settings.ua && typeof settings.ua === 'object' ? settings.ua : {};
  return ua.mode === 'custom'
    ? text(ua.value, fallback)
    : text(settings.user_agent, settings.userAgent, fallback);
}

function resolveBrowserUaBrands(settings, major) {
  const defaults = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not_A Brand', version: '24' },
  ];
  const secChUa = settings.secChUa && typeof settings.secChUa === 'object' ? settings.secChUa : {};
  return secChUa.mode === 'custom' && Array.isArray(secChUa.brands) && secChUa.brands.length
    ? secChUa.brands
    : defaults;
}

function resolveBrowserIdentity(settings, geoInfo, preset) {
  const locale = normalizeLocale(firstNonNull(
    settings.locale,
    settings.browser_locale,
    settings.browserLocale,
    preset && preset.locale,
    getDefaultLocale(),
  ));
  const timezoneId = text(
    settings.timezone_id,
    settings.timezoneId,
    geoInfo.timezoneId,
    preset && preset.timezoneId,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    'UTC',
  ) || 'UTC';
  const major = resolveBrowserMajorVersion(settings);
  const os = text(settings.os, 'win11').toLowerCase();
  const userAgent = resolveBrowserUserAgent(settings, os, major);
  const brands = resolveBrowserUaBrands(settings, major);
  return { acceptLanguage: text(settings.accept_language, settings.acceptLanguage, preset && preset.acceptLanguage, getAcceptLanguage(locale)), brands, locale, major, os, timezoneId, userAgent };
}

function resolvePlatformVersion(settings, os) {
  const defaults = { win11: '15.0.0', win10: '10.0.0', win8: '6.2.0' };
  return text(settings.platform_version, settings.platformVersion, defaults[os], '6.1.0');
}

function resolveFingerprintSettings(settings, geoInfo) {
  const geolocation = settings.geolocation && typeof settings.geolocation === 'object'
    ? settings.geolocation
    : null;
  if (!geolocation || geolocation.mode !== 'ip') return { ...settings, geolocation };
  const raw = geoInfo.raw && typeof geoInfo.raw === 'object' ? geoInfo.raw : {};
  return {
    ...settings,
    geolocation: {
      ...geolocation,
      longitude: Number(firstNonNull(raw.longitude, raw.lon, geolocation.longitude, 0)),
      latitude: Number(firstNonNull(raw.latitude, raw.lat, geolocation.latitude, 0)),
      resolvedFromIp: Boolean(geoInfo.raw),
    },
  };
}

function buildBrowserProfileFromRegion(regionKey, settings = {}, geoInfo = {}) {
  const preset = getBrowserRegionPreset(regionKey);
  const identity = resolveBrowserIdentity(settings, geoInfo, preset);
  const viewport = settings.viewport && typeof settings.viewport === 'object'
    ? settings.viewport
    : { width: 1366, height: 768 };
  const screen = settings.screen && typeof settings.screen === 'object' ? settings.screen : {
    width: 1366, height: 768, availWidth: 1366, availHeight: 728,
    availLeft: 0, availTop: 0, colorDepth: 24, pixelDepth: 24,
  };
  return {
    browserType: 'chrome',
    browserBrand: 'AI-FREE',
    browserVersion: `${identity.major}.0.0.0`,
    majorVersion: identity.major,
    uaFullVersion: `${identity.major}.0.0.0`,
    region: regionKey || '',
    regionLabel: preset && preset.label || '',
    sourceIp: text(geoInfo.sourceIp),
    sourceCountryCode: text(geoInfo.sourceCountryCode),
    sourceCountry: text(geoInfo.sourceCountry),
    sourceRegion: text(geoInfo.sourceRegion),
    sourceCity: text(geoInfo.sourceCity),
    geoEndpoint: text(geoInfo.endpoint),
    locale: identity.locale,
    timezoneId: identity.timezoneId,
    timezoneOffset: getTimezoneOffsetMinutes(identity.timezoneId),
    acceptLanguage: identity.acceptLanguage,
    userAgent: identity.userAgent,
    uaBrands: identity.brands,
    uaFullVersionList: identity.brands.map((item) => ({
      brand: item.brand,
      version: `${String(item.version).split('.')[0]}.0.0.0`,
    })),
    platformVersion: resolvePlatformVersion(settings, identity.os),
    architecture: text(settings.architecture, 'x86') || 'x86',
    bitness: text(settings.bitness, '64') || '64',
    model: text(settings.model),
    wow64: settings.wow64 === true,
    viewport,
    screen,
    colorScheme: text(settings.color_scheme, settings.colorScheme, 'light') || 'light',
    deviceScaleFactor: positiveNumber(firstNonNull(settings.device_scale_factor, settings.deviceScaleFactor), 1, 0.5),
    hardwareConcurrency: positiveNumber(firstNonNull(settings.hardware_concurrency, settings.hardwareConcurrency), 8, 1),
    deviceMemory: positiveNumber(firstNonNull(settings.device_memory, settings.deviceMemory), 8, 1),
    maxTouchPoints: positiveNumber(firstNonNull(settings.max_touch_points, settings.maxTouchPoints), 0, 0),
    navigatorVendor: text(settings.navigator_vendor, settings.navigatorVendor, 'Google Inc.'),
    navigatorPlatform: text(settings.navigator_platform, settings.navigatorPlatform, TAB_PLATFORM),
    webglVendor: text(settings.webgl_vendor, settings.webglVendor, 'Google Inc. (Intel)'),
    webglRenderer: text(settings.webgl_renderer, settings.webglRenderer, 'ANGLE (Intel, Intel(R) Graphics, Direct3D11)'),
    fingerprintSettings: resolveFingerprintSettings(settings, geoInfo),
    languages: Array.from(new Set([identity.locale, identity.locale.split('-')[0], 'en'].filter(Boolean))),
  };
}

function finishGeoProbe(state, profile) {
  if (state.resolved) return;
  state.resolved = true;
  if (state.primaryTimer) clearTimeout(state.primaryTimer);
  if (state.overallTimer) clearTimeout(state.overallTimer);
  if (profile) {
    cachedGeoProfiles.set(state.cacheKey, { profile, cachedAt: Date.now() });
    callOptional(state.logger, 'info', '[BrowserProfile] 出口 IP 地区探测成功:', {
      ip: profile.sourceIp,
      countryCode: profile.sourceCountryCode,
      country: profile.sourceCountry,
      region: profile.regionKey,
      timezoneId: profile.timezoneId,
      endpoint: profile.endpoint,
      proxyServer: state.proxyServer || 'direct',
    });
  } else {
    const reason = state.failures.filter(Boolean).join('; ') || `超过 ${GEO_IP_OVERALL_TIMEOUT_MS}ms`;
    callOptional(state.logger, 'warn', '[BrowserProfile] IP 地区探测不可用，已回退到系统地区:', reason);
  }
  state.resolve(profile);
}

function validateGeoProbeProfile(state, endpoint, profile) {
  const host = new URL(endpoint).hostname;
  if (!profile) {
    state.failures.push(`${host}: 无有效地区数据`);
    return null;
  }
  if (state.rejectDirectIp && text(profile.sourceIp) === state.rejectDirectIp) {
    state.failures.push(`${host}: 出口=直连IP(${state.rejectDirectIp})，未过代理节点`);
    return null;
  }
  if (state.rejectDirectRegionKey === 'cn' && profile.regionKey === state.rejectDirectRegionKey) {
    state.failures.push(`${host}: 代理出口仍为直连地区(${state.rejectDirectRegionKey.toUpperCase()})`);
    return null;
  }
  return profile;
}

function geoRequestHeaders(endpoint) {
  if (!endpoint.includes('/cdn-cgi/trace')) return undefined;
  return {
    Accept: 'text/plain, application/json;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
}

function requestGeoEndpoint(state, endpoint, timeoutMs = GEO_IP_REQUEST_TIMEOUT_MS) {
  return Promise.resolve()
    .then(() => state.httpGetUniversal(endpoint, timeoutMs, {
      proxyServer: state.proxyServer,
      headers: geoRequestHeaders(endpoint),
    }))
    .then((response) => validateGeoProbeProfile(state, endpoint, buildGeoProfile(response, endpoint)))
    .catch((error) => {
      state.failures.push(`${new URL(endpoint).hostname}: ${text(error && error.message, error)}`);
      return null;
    });
}

function startGeoFallbacks(state) {
  if (state.fallbackStarted || state.resolved) return;
  state.fallbackStarted = true;
  let completed = 0;
  for (const endpoint of GEO_IP_FALLBACK_ENDPOINTS) {
    requestGeoEndpoint(state, endpoint)
      .then((profile) => { if (profile) finishGeoProbe(state, profile); })
      .finally(() => {
        completed += 1;
        if (completed === GEO_IP_FALLBACK_ENDPOINTS.length) finishGeoProbe(state, null);
      });
  }
}

function startGeoProbe(state) {
  state.overallTimer = setTimeout(() => finishGeoProbe(state, null), GEO_IP_OVERALL_TIMEOUT_MS);
  state.primaryTimer = setTimeout(() => {
    state.failures.push(`www.cloudflare.com: 超过 ${GEO_IP_PRIMARY_TIMEOUT_MS}ms，启用备用检测`);
    startGeoFallbacks(state);
  }, GEO_IP_PRIMARY_TIMEOUT_MS);
  requestGeoEndpoint(state, GEO_IP_PRIMARY_ENDPOINT, GEO_IP_PRIMARY_TIMEOUT_MS)
    .then((profile) => {
      if (profile) finishGeoProbe(state, profile);
      else {
        clearTimeout(state.primaryTimer);
        startGeoFallbacks(state);
      }
    });
}

function createGeoProbePromise(httpGetUniversal, logger, options, cacheKey, proxyServer) {
  return new Promise((resolve) => {
    const state = {
      cacheKey,
      failures: [],
      fallbackStarted: false,
      httpGetUniversal,
      logger,
      overallTimer: null,
      primaryTimer: null,
      proxyServer,
      rejectDirectIp: text(options.rejectDirectIp),
      rejectDirectRegionKey: normalizeRegionKey(options.rejectDirectRegionKey || ''),
      resolve,
      resolved: false,
    };
    startGeoProbe(state);
  });
}

async function resolveGeoIpInfo(httpGetUniversal, logger = console, options = {}) {
  const proxyServer = text(options.proxyServer);
  const cacheKey = proxyServer || 'direct';
  const cached = cachedGeoProfiles.get(cacheKey);
  if (options.forceRefresh !== true && cached && Date.now() - cached.cachedAt < GEO_IP_CACHE_TTL_MS) {
    return cached.profile;
  }
  if (pendingGeoProfiles.has(cacheKey)) return pendingGeoProfiles.get(cacheKey);
  if (typeof httpGetUniversal !== 'function') return null;
  callOptional(logger, 'info', `[BrowserProfile] 开始按出口 IP 探测地区（${proxyServer ? `代理 ${proxyServer}` : '直连'}）`);
  const pending = createGeoProbePromise(httpGetUniversal, logger, options, cacheKey, proxyServer)
    .finally(() => { pendingGeoProfiles.delete(cacheKey); });
  pendingGeoProfiles.set(cacheKey, pending);
  return pending;
}

async function resolveDirectBrowserProfile(options, settings, localeRegion) {
  const ipInfo = await resolveGeoIpInfo(options.httpGetUniversal, options.logger, {
    proxyServer: '',
    forceRefresh: options.forceGeoLookup === true,
  });
  return buildBrowserProfileFromRegion(
    ipInfo && ipInfo.regionKey || localeRegion || 'us',
    settings,
    ipInfo || {},
  );
}

async function resolveProxyBrowserProfile(options, settings, localeRegion, proxyServer) {
  const direct = await resolveGeoIpInfo(options.httpGetUniversal, options.logger, { proxyServer: '' });
  const baselineIp = text(direct && direct.sourceIp);
  const proxied = await resolveGeoIpInfo(options.httpGetUniversal, options.logger, {
    proxyServer,
    forceRefresh: options.forceGeoLookup === true,
    rejectDirectIp: baselineIp,
    rejectDirectRegionKey: direct && direct.regionKey || '',
  });
  if (proxied) {
    return buildBrowserProfileFromRegion(proxied.regionKey || localeRegion || 'us', settings, proxied);
  }
  callOptional(
    options.logger,
    'warn',
    '[BrowserProfile] 代理已启用，但所有探测端点均从直连出口返回，判定代理未改变出口',
    { proxyServer, baselineIp: baselineIp || '未知' },
  );
  const fallback = buildBrowserProfileFromRegion(
    direct && direct.regionKey || localeRegion || 'us',
    settings,
    direct || {},
  );
  fallback.regionLabel = `${fallback.regionLabel || '直连'}（代理未改变出口）`;
  fallback.proxyExitVerified = false;
  return fallback;
}

async function resolveTabBrowserProfile(options = {}) {
  const settings = options.browserSettings && typeof options.browserSettings === 'object'
    ? options.browserSettings
    : {};
  const explicitRegion = normalizeRegionKey(firstNonNull(
    settings.region,
    settings.browser_region,
    settings.browserRegion,
    '',
  ));
  // 历史窗口可能保留旧的 region 字段。只要任一配置要求跟随 IP，
  // 就必须重新探测当前出口，不能让旧地区提前短路整个解析流程。
  if (!shouldResolveProfileFromIp(settings) && explicitRegion && REGION_PRESETS[explicitRegion]) {
    return buildBrowserProfileFromRegion(explicitRegion, settings);
  }

  const localeRegion = inferBrowserRegionKeyFromLocale(
    firstNonNull(settings.locale, settings.browser_locale, settings.browserLocale, getDefaultLocale()),
  );
  if (options.skipGeoLookup === true) {
    return buildBrowserProfileFromRegion(localeRegion || 'us', settings);
  }

  const proxyServer = text(options.geoProxyServer);

  // 无代理：直连探测，返回的就是本机真实出口，无需校验。
  if (!proxyServer) {
    return resolveDirectBrowserProfile(options, settings, localeRegion);
  }
  return resolveProxyBrowserProfile(options, settings, localeRegion, proxyServer);
}

module.exports = {
  buildBrowserProfileFromRegion,
  resolveTabBrowserProfile,
};
