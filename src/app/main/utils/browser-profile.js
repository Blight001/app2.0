const { app } = require('electron');
const {
  REGION_PRESETS,
  getBrowserRegionPreset,
  inferBrowserRegionKeyFromLocale,
} = require('./browser-region');

const TAB_PLATFORM = 'Win32';
// ipapi.co 直连在国内会被 Cloudflare 拦成 403 人机验证页，永远探测不到，已移除。
// api.ip.sb/geoip 国内直连可达，返回 ip/country_code/timezone(IANA)/经纬度，字段与 buildGeoProfile 兼容。
const GEO_IP_ENDPOINTS = [
  'https://ipwho.is/',
  'https://ipinfo.io/json',
  'https://api.ip.sb/geoip',
];
const GEO_IP_REQUEST_TIMEOUT_MS = 5000;
const GEO_IP_OVERALL_TIMEOUT_MS = 6000;
const GEO_IP_CACHE_TTL_MS = 5 * 60 * 1000;

const cachedGeoProfiles = new Map();
const pendingGeoProfiles = new Map();

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

function buildGeoProfile(response, endpoint) {
  const body = response?.body && typeof response.body === 'object' ? response.body : null;
  if (!body || response?.ok === false || body.success === false || body.error === true) return null;

  const regionKey = inferRegionFromIpInfo(body);
  if (!regionKey) return null;

  const country = body.country_code || body.countryCode || body.country
    || body.country_name || body.countryName || '';
  const normalizedCountry = String(country || '').trim();
  const countryCode = String(body.country_code || body.countryCode
    || (/^[a-z]{2}$/i.test(normalizedCountry) ? normalizedCountry : '')).trim();
  const rawTimezone = body.timezone;
  const timezoneId = String(
    (rawTimezone && typeof rawTimezone === 'object'
      ? (rawTimezone.id || rawTimezone.name || rawTimezone.timezone)
      : rawTimezone)
    || body.timezone_id || body.timezoneId || '',
  ).trim();

  return {
    regionKey,
    sourceIp: String(body.ip || body.query || body.ip_address || body.ipAddress || '').trim(),
    sourceCountryCode: countryCode,
    sourceCountry: String(body.country_name || body.countryName || body.country || '').trim(),
    sourceRegion: String(body.region || body.region_name || body.regionName || '').trim(),
    sourceCity: String(body.city || '').trim(),
    timezoneId,
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

function buildBrowserProfileFromRegion(regionKey, settings = {}, geoInfo = {}) {
  const preset = getBrowserRegionPreset(regionKey);
  const locale = normalizeLocale(
    settings.locale || settings.browser_locale || settings.browserLocale
    || preset?.locale || getDefaultLocale(),
  );
  const timezoneId = String(
    settings.timezone_id || settings.timezoneId || geoInfo.timezoneId
    || preset?.timezoneId
    || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  ).trim() || 'UTC';
  const acceptLanguage = String(
    settings.accept_language || settings.acceptLanguage
    || preset?.acceptLanguage || getAcceptLanguage(locale),
  ).trim();
  const kernelVersion = String(settings.kernelVersion || '').trim();
  const kernelMajor = kernelVersion && kernelVersion.toLowerCase() !== 'auto' && /^\d/.test(kernelVersion)
    ? kernelVersion.split('.')[0]
    : '';
  const major = String(kernelMajor || settings.browserVersion || getChromiumMajorVersion()).split('.')[0]
    || getChromiumMajorVersion();
  const os = String(settings.os || 'win11').toLowerCase();
  const osToken = os === 'win7' ? 'Windows NT 6.1' : os === 'win8' ? 'Windows NT 6.2' : 'Windows NT 10.0';
  const defaultUserAgent = `Mozilla/5.0 (${osToken}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const userAgent = String(
    settings.ua?.mode === 'custom'
      ? settings.ua?.value
      : (settings.user_agent || settings.userAgent || defaultUserAgent),
  ).trim() || defaultUserAgent;
  const defaultBrands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not_A Brand', version: '24' },
  ];
  const brands = settings.secChUa?.mode === 'custom'
    && Array.isArray(settings.secChUa?.brands)
    && settings.secChUa.brands.length
    ? settings.secChUa.brands
    : defaultBrands;

  return {
    browserType: 'chrome',
    browserBrand: 'AI-FREE',
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
    uaBrands: brands,
    uaFullVersionList: brands.map((item) => ({
      brand: item.brand,
      version: `${String(item.version).split('.')[0]}.0.0.0`,
    })),
    platformVersion: String(
      settings.platform_version || settings.platformVersion
      || (os === 'win11' ? '15.0.0' : os === 'win10' ? '10.0.0' : os === 'win8' ? '6.2.0' : '6.1.0'),
    ).trim(),
    architecture: String(settings.architecture || 'x86').trim() || 'x86',
    bitness: String(settings.bitness || '64').trim() || '64',
    model: String(settings.model || '').trim(),
    wow64: settings.wow64 === true,
    viewport: settings.viewport && typeof settings.viewport === 'object'
      ? settings.viewport : { width: 1366, height: 768 },
    screen: settings.screen && typeof settings.screen === 'object' ? settings.screen : {
      width: 1366, height: 768, availWidth: 1366, availHeight: 728,
      availLeft: 0, availTop: 0, colorDepth: 24, pixelDepth: 24,
    },
    colorScheme: String(settings.color_scheme || settings.colorScheme || 'light').trim() || 'light',
    deviceScaleFactor: Number.isFinite(Number(settings.device_scale_factor || settings.deviceScaleFactor))
      ? Math.max(0.5, Number(settings.device_scale_factor || settings.deviceScaleFactor)) : 1,
    hardwareConcurrency: Number.isFinite(Number(settings.hardware_concurrency || settings.hardwareConcurrency))
      ? Math.max(1, Number(settings.hardware_concurrency || settings.hardwareConcurrency)) : 8,
    deviceMemory: Number.isFinite(Number(settings.device_memory || settings.deviceMemory))
      ? Math.max(1, Number(settings.device_memory || settings.deviceMemory)) : 8,
    maxTouchPoints: Number.isFinite(Number(settings.max_touch_points || settings.maxTouchPoints))
      ? Math.max(0, Number(settings.max_touch_points || settings.maxTouchPoints)) : 0,
    navigatorVendor: String(settings.navigator_vendor || settings.navigatorVendor || 'Google Inc.').trim() || 'Google Inc.',
    navigatorPlatform: String(settings.navigator_platform || settings.navigatorPlatform || TAB_PLATFORM).trim() || TAB_PLATFORM,
    webglVendor: String(settings.webgl_vendor || settings.webglVendor || 'Google Inc. (Intel)').trim() || 'Google Inc. (Intel)',
    webglRenderer: String(settings.webgl_renderer || settings.webglRenderer || 'ANGLE (Intel, Intel(R) Graphics, Direct3D11)').trim(),
    fingerprintSettings: {
      ...settings,
      geolocation: settings.geolocation?.mode === 'ip' ? {
        ...settings.geolocation,
        longitude: Number(geoInfo.raw?.longitude ?? geoInfo.raw?.lon ?? settings.geolocation?.longitude ?? 0),
        latitude: Number(geoInfo.raw?.latitude ?? geoInfo.raw?.lat ?? settings.geolocation?.latitude ?? 0),
        resolvedFromIp: !!geoInfo.raw,
      } : settings.geolocation,
    },
    languages: Array.from(new Set([locale, locale.split('-')[0], 'en'].filter(Boolean))),
  };
}

async function resolveGeoIpInfo(httpGetUniversal, logger = console, options = {}) {
  const proxyServer = String(options.proxyServer || '').trim();
  const cacheKey = proxyServer || 'direct';
  const cached = cachedGeoProfiles.get(cacheKey);
  if (options.forceRefresh !== true && cached && Date.now() - cached.cachedAt < GEO_IP_CACHE_TTL_MS) {
    return cached.profile;
  }
  if (pendingGeoProfiles.has(cacheKey)) return pendingGeoProfiles.get(cacheKey);
  if (typeof httpGetUniversal !== 'function') return null;

  logger?.info?.(`[BrowserProfile] 开始按出口 IP 探测地区（${proxyServer ? `代理 ${proxyServer}` : '直连'}）`);

  const pendingGeoProfile = new Promise((resolve) => {
    let completedCount = 0;
    let resolved = false;
    const failures = [];
    const finish = (profile) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimer);
      if (profile) {
        cachedGeoProfiles.set(cacheKey, { profile, cachedAt: Date.now() });
        logger?.info?.('[BrowserProfile] 出口 IP 地区探测成功:', {
          ip: profile.sourceIp,
          countryCode: profile.sourceCountryCode,
          country: profile.sourceCountry,
          region: profile.regionKey,
          timezoneId: profile.timezoneId,
          endpoint: profile.endpoint,
          proxyServer: proxyServer || 'direct',
        });
      } else {
        logger?.warn?.(
          '[BrowserProfile] IP 地区探测不可用，已回退到系统地区:',
          failures.filter(Boolean).join('; ') || `超过 ${GEO_IP_OVERALL_TIMEOUT_MS}ms`,
        );
      }
      resolve(profile);
    };
    const overallTimer = setTimeout(() => finish(null), GEO_IP_OVERALL_TIMEOUT_MS);

    for (const endpoint of GEO_IP_ENDPOINTS) {
      Promise.resolve()
        .then(() => httpGetUniversal(endpoint, GEO_IP_REQUEST_TIMEOUT_MS, { proxyServer }))
        .then((response) => {
          const profile = buildGeoProfile(response, endpoint);
          if (profile) {
            finish(profile);
          } else {
            failures.push(`${new URL(endpoint).hostname}: 无有效地区数据`);
          }
        })
        .catch((error) => {
          failures.push(`${new URL(endpoint).hostname}: ${error?.message || error}`);
        })
        .finally(() => {
          completedCount += 1;
          if (completedCount === GEO_IP_ENDPOINTS.length) finish(null);
        });
    }
  }).finally(() => { pendingGeoProfiles.delete(cacheKey); });

  pendingGeoProfiles.set(cacheKey, pendingGeoProfile);

  return pendingGeoProfile;
}

async function resolveTabBrowserProfile(options = {}) {
  const settings = options.browserSettings && typeof options.browserSettings === 'object'
    ? options.browserSettings : {};
  const explicitRegion = normalizeRegionKey(
    settings.region || settings.browser_region || settings.browserRegion || '',
  );
  // 历史窗口可能保留旧的 region 字段。只要任一配置要求跟随 IP，
  // 就必须重新探测当前出口，不能让旧地区提前短路整个解析流程。
  if (!shouldResolveProfileFromIp(settings) && explicitRegion && REGION_PRESETS[explicitRegion]) {
    return buildBrowserProfileFromRegion(explicitRegion, settings);
  }

  const localeRegion = inferBrowserRegionKeyFromLocale(
    settings.locale || settings.browser_locale || settings.browserLocale || getDefaultLocale(),
  );
  if (options.skipGeoLookup === true) {
    return buildBrowserProfileFromRegion(localeRegion || 'us', settings);
  }

  const ipInfo = await resolveGeoIpInfo(options.httpGetUniversal, options.logger, {
    proxyServer: options.geoProxyServer,
    forceRefresh: options.forceGeoLookup === true,
  });
  return buildBrowserProfileFromRegion(ipInfo?.regionKey || localeRegion || 'us', settings, ipInfo || {});
}

module.exports = {
  buildBrowserProfileFromRegion,
  resolveTabBrowserProfile,
};
