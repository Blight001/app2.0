// 认证与 Cookie 相关封装
// 通过工厂函数传入依赖（serverBase、sendToSide、log），避免硬编码与循环依赖

const { app } = require('electron');
const { URL } = require('url');
const { postJson } = require('./http');
const fs = require('fs');
const { getStorePath, getServerBase } = require('../config');

// TCP客户端将在运行时注入
let tcpClient = null;
let runtimeLicenseCache = null;

// 获取/读取/解析：readStoreConfig的具体业务逻辑。
function readStoreConfig(logPrefix = 'Store') {
  try {
    const storePath = getStorePath();
    if (!fs.existsSync(storePath)) return {};
    const storeData = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(storeData || '{}');
  } catch (error) {
    console.warn(`[${logPrefix}] 读取store/content失败:`, error?.message || error);
    return {};
  }
}

/**
 * 从store/content获取平台信息
 * @returns {string} 平台名称，默认为'即梦'
 */
function getPlatformFromStore() {
  try {
    const runtimeConfig = runtimeLicenseCache && typeof runtimeLicenseCache.getRuntimeConfig === 'function'
      ? runtimeLicenseCache.getRuntimeConfig()
      : null;
    const runtimeAllowedPlatforms = Array.isArray(runtimeConfig?.allowedPlatforms) ? runtimeConfig.allowedPlatforms : [];
    if (runtimeAllowedPlatforms.length > 0) {
      return runtimeAllowedPlatforms[0];
    }
    if (runtimeConfig?.platformName) {
      return runtimeConfig.platformName;
    }
  } catch (error) {
    console.warn('[Platform] 读取运行时平台信息失败:', error.message);
  }
  return '即梦'; // 默认值
}

/**
 * 从store/content获取目标URL
 * @returns {string} 目标URL，默认为'https://dreamina.capcut.com/'
 */
function getTargetUrlFromStore() {
  try {
    const runtimeConfig = runtimeLicenseCache && typeof runtimeLicenseCache.getRuntimeConfig === 'function'
      ? runtimeLicenseCache.getRuntimeConfig()
      : null;
    if (runtimeConfig?.targetUrl) {
      return runtimeConfig.targetUrl;
    }
  } catch (error) {
    console.warn('[TargetURL] 读取运行时目标URL失败:', error.message);
  }
  return 'https://dreamina.capcut.com/'; // 默认值
}

// ---- 繁体中文偏好注入（常量与工具，模块级共享，确保同一 session 只装配一次）
const ZH_HANT_ACCEPT_LANGUAGE = 'zh-Hant,zh-TW;q=0.95,zh;q=0.8,en;q=0.7';
const ZH_HANT_COOKIE_VALUE = 'zh-Hant-TW';
const LOCALE_TARGET_HOSTS = ['capcut.com', 'dreamina.capcut.com'];
const patchedSessions = new WeakSet();
const browserStorageInjectionState = new WeakMap();

// 处理：pickFirstText的具体业务逻辑。
function pickFirstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

// 处理：pickFirstValue的具体业务逻辑。
function pickFirstValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

// 格式化/规范化：normalizeTimeValueToMs的具体业务逻辑。
function normalizeTimeValueToMs(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    if (value > 0) return Math.floor(value * 1000);
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    if (text.length >= 13) return Math.floor(num);
    if (text.length === 10) return Math.floor(num * 1000);
    if (num > 1e12) return Math.floor(num);
    if (num > 1e9) return Math.floor(num * 1000);
    return Math.floor(num * 1000);
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

// 格式化/规范化：normalizePositiveNumber的具体业务逻辑。
function normalizePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

// 获取/读取/解析：extractNestedText的具体业务逻辑。
function extractNestedText(source) {
  if (!source || typeof source !== 'object') return '';
  return pickFirstText(
    source.message,
    source.msg,
    source.error,
    source.reason,
    source.detail,
    source.description,
    source.error_description,
    source.errorMessage,
    source.data?.message,
    source.data?.msg,
    source.data?.error,
    source.data?.reason,
    source.data?.detail,
    source.data?.description,
    source.data?.error_description,
    source.data?.errorMessage,
    source.result?.message,
    source.result?.msg,
    source.result?.error,
    source.result?.reason,
    source.result?.detail,
    source.result?.description,
    source.result?.error_description,
    source.result?.errorMessage,
    source.payload?.message,
    source.payload?.msg,
    source.payload?.error,
    source.payload?.reason,
    source.payload?.detail,
    source.payload?.description,
    source.payload?.error_description,
    source.payload?.errorMessage,
    source.announcement?.message,
    source.announcement?.msg,
    source.announcement?.error,
    source.announcement?.reason,
    source.announcement?.detail,
    source.announcement?.description,
    source.announcement?.error_description,
    source.announcement?.errorMessage,
  );
}

// 获取/读取/解析：extractValidationState的具体业务逻辑。
function extractValidationState(source) {
  if (!source || typeof source !== 'object') return '';
  const raw = pickFirstText(
    source.code,
    source.error_code,
    source.errorCode,
    source.card_state,
    source.cardState,
    source.state,
    source.status,
    source.message_type,
    source.result?.card_state,
    source.result?.code,
    source.result?.error_code,
    source.result?.errorCode,
    source.result?.cardState,
    source.result?.state,
    source.result?.status,
    source.data?.card_state,
    source.data?.code,
    source.data?.error_code,
    source.data?.errorCode,
    source.data?.cardState,
    source.data?.state,
    source.data?.status,
    source.payload?.card_state,
    source.payload?.code,
    source.payload?.error_code,
    source.payload?.errorCode,
    source.payload?.cardState,
    source.payload?.state,
    source.payload?.status,
  ).toLowerCase();

  if (!raw) return '';
  if (['active', 'success', 'valid', 'enabled', 'normal', 'ok', 'passed', 'pass'].includes(raw)) return 'active';
  if (['disabled', 'disable', 'inactive', 'blocked', 'banned', 'revoked', 'forbidden', 'frozen', 'card_disabled', 'card_blocked', 'card_revoked'].includes(raw)) return 'disabled';
  if (['expired', 'expire', 'expired_at', 'overdue'].includes(raw)) return 'expired';
  if (['not_found', 'missing', 'absent', 'none', 'unfound', 'card_not_found', 'notexist', 'not_exist'].includes(raw)) return 'not_found';
  if (['pending', 'pending_activation', 'not_started', 'unverified', 'not_active'].includes(raw)) return 'pending';
  return raw;
}

// 处理：isValidationSuccess的具体业务逻辑。
function isValidationSuccess(resp) {
  if (!resp || typeof resp !== 'object') return false;
  if (resp.valid === true || resp.is_valid === true || resp.success === true || resp.ok === true) return true;
  return extractValidationState(resp) === 'active';
}

// 获取/读取/解析：getValidationFailureMessage的具体业务逻辑。
function getValidationFailureMessage(resp, fallback = '卡密无效或已过期') {
  const message = extractNestedText(resp);
  if (message) return message;

  const state = extractValidationState(resp);
  const stateMessages = {
    not_found: '卡密不存在',
    expired: '卡密已过期',
    disabled: '卡密已被禁用',
    revoked: '卡密已被撤销',
    pending: '卡密暂未生效',
    active: '',
  };
  if (Object.prototype.hasOwnProperty.call(stateMessages, state) && stateMessages[state]) {
    return stateMessages[state];
  }

  if (resp && (resp.valid === false || resp.is_valid === false || resp.success === false || resp.ok === false)) {
    return fallback;
  }

  return fallback;
}

// 格式化/规范化：sanitizeUserFacingMessage的具体业务逻辑。
function sanitizeUserFacingMessage(message, fallback = '账号分配失败') {
  let text = String(message || '').trim();
  if (!text) return fallback;
  text = text
    .replace(/获取\s*Cookie/gi, '获取账号信息')
    .replace(/Cookie\s*获取/gi, '账号信息获取')
    .replace(/Cookies?/gi, '账号信息')
    .replace(/cookie/gi, '账号信息');
  text = text.replace(/\s+/g, ' ').trim();
  return text || fallback;
}

// 格式化/规范化：normalizeCurrentAccountType的具体业务逻辑。
function normalizeCurrentAccountType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (['shared', 'permanent', 'long_term', 'long-term', 'longterm'].includes(text)) return 'shared';
  if (['one_time', 'one-time', 'temporary', 'temp', 'midnight_clear', 'clear_at_24', '24h', '24-hour'].includes(text)) return 'one_time';
  return text;
}

// 处理：inferCurrentAccountTypeFromLabel的具体业务逻辑。
function inferCurrentAccountTypeFromLabel(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  if (text.includes('长久') || text.includes('一次')) return 'one_time';
  if (text.includes('循环') || text.includes('24点') || text.includes('清空') || text.includes('临时')) return 'shared';
  return '';
}

// 获取/读取/解析：resolveCurrentAccountType的具体业务逻辑。
function resolveCurrentAccountType(rawType, rawLabel) {
  const normalizedRawType = normalizeCurrentAccountType(rawType);
  const inferredFromLabel = inferCurrentAccountTypeFromLabel(rawLabel);
  return normalizedRawType || inferredFromLabel || '';
}

// 获取/读取/解析：getCurrentAccountTypeLabel的具体业务逻辑。
function getCurrentAccountTypeLabel(value) {
  const type = normalizeCurrentAccountType(value);
  if (type === 'shared') return '循环账号';
  if (type === 'one_time') return '长久账号';
  return '';
}

// 获取/读取/解析：extractCurrentAccountTypeInfo的具体业务逻辑。
function extractCurrentAccountTypeInfo(source) {
  if (!source || typeof source !== 'object') {
    return {
      currentAccountType: '',
      currentAccountTypeLabel: ''
    };
  }

  const rawType = pickFirstText(
    source.current_account_type,
    source.currentAccountType,
    source.data?.current_account_type,
    source.data?.currentAccountType,
    source.result?.current_account_type,
    source.result?.currentAccountType,
    source.payload?.current_account_type,
    source.payload?.currentAccountType
  );

  const rawLabel = pickFirstText(
    source.current_account_type_label,
    source.currentAccountTypeLabel,
    source.data?.current_account_type_label,
    source.data?.currentAccountTypeLabel,
    source.result?.current_account_type_label,
    source.result?.currentAccountTypeLabel,
    source.payload?.current_account_type_label,
    source.payload?.currentAccountTypeLabel
  );

  const currentAccountType = resolveCurrentAccountType(rawType, rawLabel);
  const normalizedLabelType = inferCurrentAccountTypeFromLabel(rawLabel);
  const currentAccountTypeLabel = normalizedLabelType && currentAccountType && normalizedLabelType !== currentAccountType
    ? getCurrentAccountTypeLabel(currentAccountType)
    : (String(rawLabel || '').trim() || getCurrentAccountTypeLabel(currentAccountType));

  return {
    currentAccountType,
    currentAccountTypeLabel
  };
}

// 获取/读取/解析：extractServerRecycleTimeInfo的具体业务逻辑。
function extractServerRecycleTimeInfo(source) {
  if (!source || typeof source !== 'object') {
    return {
      serverRecycleTime: '',
      serverRecycleTimeTs: null,
      serverRecycleTimeIso: '',
    };
  }

  const explicitRecycleValue = pickFirstValue(
    source.server_recycle_time,
    source.serverRecycleTime,
    source.data?.server_recycle_time,
    source.data?.serverRecycleTime,
    source.result?.server_recycle_time,
    source.result?.serverRecycleTime,
    source.payload?.server_recycle_time,
    source.payload?.serverRecycleTime
  );

  const nextRefreshValue = pickFirstValue(
    source.next_refresh_at,
    source.nextRefreshAt,
    source.refresh_info?.next_refresh_at,
    source.refresh_info?.nextRefreshAt,
    source.refreshInfo?.next_refresh_at,
    source.refreshInfo?.nextRefreshAt,
    source.data?.next_refresh_at,
    source.data?.nextRefreshAt,
    source.data?.refresh_info?.next_refresh_at,
    source.data?.refresh_info?.nextRefreshAt,
    source.data?.refreshInfo?.next_refresh_at,
    source.data?.refreshInfo?.nextRefreshAt,
    source.result?.next_refresh_at,
    source.result?.nextRefreshAt,
    source.result?.refresh_info?.next_refresh_at,
    source.result?.refresh_info?.nextRefreshAt,
    source.result?.refreshInfo?.next_refresh_at,
    source.result?.refreshInfo?.nextRefreshAt,
    source.payload?.next_refresh_at,
    source.payload?.nextRefreshAt,
    source.payload?.refresh_info?.next_refresh_at,
    source.payload?.refresh_info?.nextRefreshAt,
    source.payload?.refreshInfo?.next_refresh_at,
    source.payload?.refreshInfo?.nextRefreshAt
  );

  const remainingSeconds = pickFirstValue(
    source.remaining_seconds,
    source.remainingSeconds,
    source.refresh_info?.remaining_seconds,
    source.refresh_info?.remainingSeconds,
    source.refreshInfo?.remaining_seconds,
    source.refreshInfo?.remainingSeconds,
    source.data?.remaining_seconds,
    source.data?.remainingSeconds,
    source.data?.refresh_info?.remaining_seconds,
    source.data?.refresh_info?.remainingSeconds,
    source.data?.refreshInfo?.remaining_seconds,
    source.data?.refreshInfo?.remainingSeconds,
    source.result?.remaining_seconds,
    source.result?.remainingSeconds,
    source.result?.refresh_info?.remaining_seconds,
    source.result?.refresh_info?.remainingSeconds,
    source.result?.refreshInfo?.remaining_seconds,
    source.result?.refreshInfo?.remainingSeconds,
    source.payload?.remaining_seconds,
    source.payload?.remainingSeconds,
    source.payload?.refresh_info?.remaining_seconds,
    source.payload?.refresh_info?.remainingSeconds,
    source.payload?.refreshInfo?.remaining_seconds,
    source.payload?.refreshInfo?.remainingSeconds
  );

  const remainingMinutes = pickFirstValue(
    source.remaining_minutes,
    source.remainingMinutes,
    source.refresh_info?.remaining_minutes,
    source.refresh_info?.remainingMinutes,
    source.refreshInfo?.remaining_minutes,
    source.refreshInfo?.remainingMinutes,
    source.data?.remaining_minutes,
    source.data?.remainingMinutes,
    source.data?.refresh_info?.remaining_minutes,
    source.data?.refresh_info?.remainingMinutes,
    source.data?.refreshInfo?.remaining_minutes,
    source.data?.refreshInfo?.remainingMinutes,
    source.result?.remaining_minutes,
    source.result?.remainingMinutes,
    source.result?.refresh_info?.remaining_minutes,
    source.result?.refresh_info?.remainingMinutes,
    source.result?.refreshInfo?.remaining_minutes,
    source.result?.refreshInfo?.remainingMinutes,
    source.payload?.remaining_minutes,
    source.payload?.remainingMinutes,
    source.payload?.refresh_info?.remaining_minutes,
    source.payload?.refresh_info?.remainingMinutes,
    source.payload?.refreshInfo?.remaining_minutes,
    source.payload?.refreshInfo?.remainingMinutes
  );

  const explicitRecycleTs = normalizeTimeValueToMs(explicitRecycleValue);
  const nextRefreshTs = normalizeTimeValueToMs(nextRefreshValue);
  const remainingSecondsNum = normalizePositiveNumber(remainingSeconds);
  const remainingMinutesNum = normalizePositiveNumber(remainingMinutes);
  const remainingTs = remainingSecondsNum
    ? Date.now() + Math.floor(remainingSecondsNum * 1000)
    : (remainingMinutesNum ? Date.now() + Math.floor(remainingMinutesNum * 60 * 1000) : null);
  const serverRecycleTimeTs = explicitRecycleTs || nextRefreshTs || remainingTs || null;
  const rawValue = explicitRecycleValue
    ?? nextRefreshValue
    ?? (remainingSecondsNum ? String(remainingSecondsNum) : null)
    ?? (remainingMinutesNum ? String(remainingMinutesNum * 60) : null);
  const serverRecycleTime = serverRecycleTimeTs
    ? (typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : new Date(serverRecycleTimeTs).toISOString())
    : '';
  const serverRecycleTimeIso = serverRecycleTimeTs ? new Date(serverRecycleTimeTs).toISOString() : '';

  return {
    serverRecycleTime,
    serverRecycleTimeTs,
    serverRecycleTimeIso,
  };
}

// 获取/读取/解析：extractServerRecycleDebugInfo的具体业务逻辑。
function extractServerRecycleDebugInfo(source) {
  if (!source || typeof source !== 'object') {
    return {
      serverRecycleTime: undefined,
      serverRecycleTimeIso: undefined,
      aiAccountExpiryTime: undefined,
      nextRefreshAt: undefined,
      remainingSeconds: undefined,
      remainingMinutes: undefined,
    };
  }

  const recycleTimeInfo = extractServerRecycleTimeInfo(source);
  const nextRefreshAt = pickFirstValue(
    source.next_refresh_at,
    source.nextRefreshAt,
    source.refresh_info?.next_refresh_at,
    source.refresh_info?.nextRefreshAt,
    source.refreshInfo?.next_refresh_at,
    source.refreshInfo?.nextRefreshAt,
    source.data?.next_refresh_at,
    source.data?.nextRefreshAt,
    source.data?.refresh_info?.next_refresh_at,
    source.data?.refresh_info?.nextRefreshAt,
    source.data?.refreshInfo?.next_refresh_at,
    source.data?.refreshInfo?.nextRefreshAt,
    source.result?.next_refresh_at,
    source.result?.nextRefreshAt,
    source.result?.refresh_info?.next_refresh_at,
    source.result?.refresh_info?.nextRefreshAt,
    source.result?.refreshInfo?.next_refresh_at,
    source.result?.refreshInfo?.nextRefreshAt,
    source.payload?.next_refresh_at,
    source.payload?.nextRefreshAt,
    source.payload?.refresh_info?.next_refresh_at,
    source.payload?.refresh_info?.nextRefreshAt,
    source.payload?.refreshInfo?.next_refresh_at,
    source.payload?.refreshInfo?.nextRefreshAt
  );
  const remainingSeconds = pickFirstValue(
    source.remaining_seconds,
    source.remainingSeconds,
    source.refresh_info?.remaining_seconds,
    source.refresh_info?.remainingSeconds,
    source.refreshInfo?.remaining_seconds,
    source.refreshInfo?.remainingSeconds,
    source.data?.remaining_seconds,
    source.data?.remainingSeconds,
    source.data?.refresh_info?.remaining_seconds,
    source.data?.refresh_info?.remainingSeconds,
    source.data?.refreshInfo?.remaining_seconds,
    source.data?.refreshInfo?.remainingSeconds,
    source.result?.remaining_seconds,
    source.result?.remainingSeconds,
    source.result?.refresh_info?.remaining_seconds,
    source.result?.refresh_info?.remainingSeconds,
    source.result?.refreshInfo?.remaining_seconds,
    source.result?.refreshInfo?.remainingSeconds,
    source.payload?.remaining_seconds,
    source.payload?.remainingSeconds,
    source.payload?.refresh_info?.remaining_seconds,
    source.payload?.refresh_info?.remainingSeconds,
    source.payload?.refreshInfo?.remaining_seconds,
    source.payload?.refreshInfo?.remainingSeconds
  );
  const remainingMinutes = pickFirstValue(
    source.remaining_minutes,
    source.remainingMinutes,
    source.refresh_info?.remaining_minutes,
    source.refresh_info?.remainingMinutes,
    source.refreshInfo?.remaining_minutes,
    source.refreshInfo?.remainingMinutes,
    source.data?.remaining_minutes,
    source.data?.remainingMinutes,
    source.data?.refresh_info?.remaining_minutes,
    source.data?.refresh_info?.remainingMinutes,
    source.data?.refreshInfo?.remaining_minutes,
    source.data?.refreshInfo?.remainingMinutes,
    source.result?.remaining_minutes,
    source.result?.remainingMinutes,
    source.result?.refresh_info?.remaining_minutes,
    source.result?.refresh_info?.remainingMinutes,
    source.result?.refreshInfo?.remaining_minutes,
    source.result?.refreshInfo?.remainingMinutes,
    source.payload?.remaining_minutes,
    source.payload?.remainingMinutes,
    source.payload?.refresh_info?.remaining_minutes,
    source.payload?.refresh_info?.remainingMinutes,
    source.payload?.refreshInfo?.remaining_minutes,
    source.payload?.refreshInfo?.remainingMinutes
  );

  return {
    serverRecycleTime: recycleTimeInfo.serverRecycleTime || undefined,
    serverRecycleTimeIso: recycleTimeInfo.serverRecycleTimeIso || undefined,
    aiAccountExpiryTime: pickFirstValue(
      source.ai_account_expiry_time,
      source.aiAccountExpiryTime,
      source.data?.ai_account_expiry_time,
      source.data?.aiAccountExpiryTime,
      source.result?.ai_account_expiry_time,
      source.result?.aiAccountExpiryTime,
      source.payload?.ai_account_expiry_time,
      source.payload?.aiAccountExpiryTime
    ) || undefined,
    nextRefreshAt: nextRefreshAt === null || nextRefreshAt === undefined || nextRefreshAt === '' ? undefined : nextRefreshAt,
    remainingSeconds: remainingSeconds === null || remainingSeconds === undefined || remainingSeconds === '' ? undefined : remainingSeconds,
    remainingMinutes: remainingMinutes === null || remainingMinutes === undefined || remainingMinutes === '' ? undefined : remainingMinutes,
  };
}

// 比较/匹配：matchesLocaleTargets的具体业务逻辑。
function matchesLocaleTargets(url) {
  try {
    const u = new URL(url);
    return LOCALE_TARGET_HOSTS.some((host) => u.hostname === host || u.hostname.endsWith('.' + host));
  } catch (_) {
    return false;
  }
}

// 设置/更新/持久化：setLocaleCookies的具体业务逻辑。
async function setLocaleCookies(sess, log = () => {}) {
  const cookies = [
    // 作用于 capcut.com 及其子域
    {
      url: 'https://capcut.com/',
      domain: '.capcut.com',
      name: 'NEXT_LOCALE',
      value: ZH_HANT_COOKIE_VALUE,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
    },
    {
      url: 'https://capcut.com/',
      domain: '.capcut.com',
      name: 'capcut_locale',
      value: ZH_HANT_COOKIE_VALUE,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
    },
    // 作用于 dreamina.capcut.com（即梦）
    {
      url: 'https://dreamina.capcut.com/',
      domain: '.dreamina.capcut.com',
      name: 'NEXT_LOCALE',
      value: ZH_HANT_COOKIE_VALUE,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
    },
    {
      url: 'https://dreamina.capcut.com/',
      domain: '.dreamina.capcut.com',
      name: 'capcut_locale',
      value: ZH_HANT_COOKIE_VALUE,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
    },
  ];

  for (const c of cookies) {
    try {
      await sess.cookies.set(c);
    } catch (e) {
      log('Locale', `语言 Cookie 注入失败: ${e?.message || e}`);
    }
  }
}

// 创建/初始化：createAuthCookie的具体业务逻辑。
function createAuthCookie({ serverBase: serverBaseInput, tcp, sendToSide = () => {}, log = () => {}, licenseCache } = {}) {
  // 设置TCP客户端
  tcpClient = tcp;
  runtimeLicenseCache = licenseCache || null;
  const ENDPOINT_FETCH_COOKIE = '/api/fetch_cookie';

// 获取/读取/解析：resolveServerBase的具体业务逻辑。
  function resolveServerBase() {
    try {
      const runtimeConfig = runtimeLicenseCache && typeof runtimeLicenseCache.getRuntimeConfig === 'function'
        ? runtimeLicenseCache.getRuntimeConfig()
        : null;
      const runtimeBase = String(runtimeConfig?.serverBase || '').trim();
      if (runtimeBase) return runtimeBase.replace(/\/+$/, '');
    } catch (_) {}
    try {
      const tcpRuntimeBase = String(tcp?.runtimeServerBase || '').trim();
      if (tcpRuntimeBase) return tcpRuntimeBase.replace(/\/+$/, '');
    } catch (_) {}
    return String(serverBaseInput || getServerBase() || '').replace(/\/+$/, '');
  }

// 创建/初始化：createBusinessError的具体业务逻辑。
  function createBusinessError(message, code = 'BUSINESS_ERROR') {
    const err = new Error(message);
    err.businessError = true;
    err.noHttpFallback = true;
    err.errorCode = code;
    return err;
  }

// 获取/读取/解析：readStoreConfigSafe的具体业务逻辑。
  function readStoreConfigSafe() {
    return readStoreConfig('LicenseUsage');
  }

// 设置/更新/持久化：writeStoreConfigSafe的具体业务逻辑。
  function writeStoreConfigSafe(storeConfig) {
    try {
      const storePath = getStorePath();
      fs.mkdirSync(require('path').dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(storeConfig || {}, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.warn('[LicenseUsage] 写入store/content失败:', e?.message || e);
      return false;
    }
  }

// 处理：toFiniteNumber的具体业务逻辑。
  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

// 格式化/规范化：normalizeLicenseUsage的具体业务逻辑。
  function normalizeLicenseUsage(source = {}) {
    if (!source || typeof source !== 'object') return null;

    const maxUsageTimes = toFiniteNumber(source.max_usage_times ?? source.maxUsageTimes);
    const usedUsageTimes = toFiniteNumber(source.used_usage_times ?? source.usedUsageTimes);
    const remainingUsageTimes = toFiniteNumber(source.remaining_usage_times ?? source.remainingUsageTimes);

    const expireAt = source.expire_at ?? source.expireAt ?? '';
    const daysLeft = source.days_left ?? source.daysLeft;
    const expiresInSeconds = source.expires_in_seconds ?? source.expiresInSeconds;

    if (
      maxUsageTimes === null
      && usedUsageTimes === null
      && remainingUsageTimes === null
      && !expireAt
      && daysLeft === undefined
      && expiresInSeconds === undefined
    ) {
      return null;
    }

    const out = {
      max_usage_times: maxUsageTimes,
      used_usage_times: usedUsageTimes,
      remaining_usage_times: remainingUsageTimes,
    };

    if (expireAt) out.expire_at = expireAt;
    if (daysLeft !== undefined) out.days_left = daysLeft;
    if (expiresInSeconds !== undefined) out.expires_in_seconds = expiresInSeconds;
    return out;
  }

// 获取/读取/解析：getStoredLicenseUsage的具体业务逻辑。
  function getStoredLicenseUsage(key, deviceId) {
    try {
      if (!runtimeLicenseCache || typeof runtimeLicenseCache.getSnapshot !== 'function') {
        return null;
      }
      const snapshot = runtimeLicenseCache.getSnapshot() || {};
      const normalizedKey = String(key || '').trim();
      const normalizedDeviceId = String(deviceId || '').trim();
      if (normalizedKey && snapshot.key && String(snapshot.key).trim() !== normalizedKey) {
        return null;
      }
      if (normalizedDeviceId && snapshot.deviceId && String(snapshot.deviceId).trim() !== normalizedDeviceId) {
        return null;
      }

      const usageSource = snapshot.licenseUsage && typeof snapshot.licenseUsage === 'object'
        ? snapshot.licenseUsage
        : snapshot.result;
      const normalizedUsage = normalizeLicenseUsage({
        ...snapshot,
        ...(usageSource && typeof usageSource === 'object' ? usageSource : {}),
      });
      if (!normalizedUsage) {
        return null;
      }
      return {
        ...normalizedUsage,
        key: snapshot.key || normalizedKey,
        deviceId: snapshot.deviceId || normalizedDeviceId,
      };
    } catch (error) {
      console.warn('[LicenseUsage] 读取运行时次数失败:', error?.message || error);
      return null;
    }
  }

// 设置/更新/持久化：saveLicenseUsageSnapshot的具体业务逻辑。
  function saveLicenseUsageSnapshot({ key, deviceId, source }) {
    try {
      if (!runtimeLicenseCache || typeof runtimeLicenseCache.setValidationState !== 'function') {
        return null;
      }

      const normalizedKey = String(key || '').trim();
      const normalizedDeviceId = String(deviceId || '').trim();
      const payload = source && typeof source === 'object' ? source : {};
      const normalizedUsage = normalizeLicenseUsage(payload) || {};
      const currentAccountType = String(
        payload.currentAccountType
        || payload.current_account_type
        || payload.accountType
        || payload.account_type
        || ''
      ).trim();
      const currentAccountTypeLabel = String(
        payload.currentAccountTypeLabel
        || payload.current_account_type_label
        || payload.accountTypeLabel
        || payload.account_type_label
        || ''
      ).trim();

      const nextState = runtimeLicenseCache.setValidationState({
        key: normalizedKey,
        deviceId: normalizedDeviceId,
        validated: true,
        bound: true,
        licenseValidated: true,
        result: payload,
        licenseUsage: payload,
        maxUsageTimes: normalizedUsage.max_usage_times ?? payload.max_usage_times ?? payload.maxUsageTimes ?? null,
        usedUsageTimes: normalizedUsage.used_usage_times ?? payload.used_usage_times ?? payload.usedUsageTimes ?? null,
        remainingUsageTimes: normalizedUsage.remaining_usage_times ?? payload.remaining_usage_times ?? payload.remainingUsageTimes ?? null,
        accountType: payload.accountType || payload.account_type || '',
        accountTypeLabel: payload.accountTypeLabel || payload.account_type_label || '',
        currentAccountType,
        currentAccountTypeLabel,
        message: payload.message || payload.msg || '',
      });
      try {
        sendToSide('license-usage-updated', nextState);
      } catch (e) {
        console.warn('[LicenseUsage] 通知侧边栏失败:', e?.message || e);
      }
      return nextState;
    } catch (error) {
      console.warn('[LicenseUsage] 保存运行时次数快照失败:', error?.message || error);
      return null;
    }
  }

// 处理：consumeLocalLicenseUsage的具体业务逻辑。
  function consumeLocalLicenseUsage({ key, deviceId } = {}) {
    try {
      if (!runtimeLicenseCache || typeof runtimeLicenseCache.getSnapshot !== 'function' || typeof runtimeLicenseCache.setValidationState !== 'function') {
        return null;
      }

      const snapshot = runtimeLicenseCache.getSnapshot() || {};
      const normalizedKey = String(key || snapshot.key || '').trim();
      const normalizedDeviceId = String(deviceId || snapshot.deviceId || '').trim();
      if (normalizedKey && snapshot.key && String(snapshot.key).trim() !== normalizedKey) {
        return null;
      }
      if (normalizedDeviceId && snapshot.deviceId && String(snapshot.deviceId).trim() !== normalizedDeviceId) {
        return null;
      }

      const usageSource = snapshot.licenseUsage && typeof snapshot.licenseUsage === 'object'
        ? snapshot.licenseUsage
        : snapshot.result;
      const normalizedUsage = normalizeLicenseUsage({
        ...snapshot,
        ...(usageSource && typeof usageSource === 'object' ? usageSource : {}),
      });
      if (!normalizedUsage) {
        return null;
      }

      const currentRemaining = Number.isFinite(Number(normalizedUsage.remaining_usage_times))
        ? Number(normalizedUsage.remaining_usage_times)
        : (
          Number.isFinite(Number(normalizedUsage.max_usage_times)) && Number.isFinite(Number(normalizedUsage.used_usage_times))
            ? Number(normalizedUsage.max_usage_times) - Number(normalizedUsage.used_usage_times)
            : null
        );
      const nextRemaining = currentRemaining === null ? null : Math.max(0, currentRemaining - 1);
      const nextUsed = Number.isFinite(Number(normalizedUsage.used_usage_times))
        ? Number(normalizedUsage.used_usage_times) + 1
        : null;
      const nextUsage = {
        ...normalizedUsage,
        remaining_usage_times: nextRemaining,
      };
      if (nextUsed !== null) {
        nextUsage.used_usage_times = nextUsed;
      }

      return runtimeLicenseCache.setValidationState({
        key: normalizedKey || snapshot.key || '',
        deviceId: normalizedDeviceId || snapshot.deviceId || '',
        validated: true,
        bound: true,
        licenseValidated: true,
        result: snapshot.result || snapshot.licenseUsage || {},
        licenseUsage: nextUsage,
        maxUsageTimes: nextUsage.max_usage_times ?? null,
        usedUsageTimes: nextUsage.used_usage_times ?? null,
        remainingUsageTimes: nextUsage.remaining_usage_times ?? null,
        accountType: snapshot.accountType || snapshot.account_type || '',
        accountTypeLabel: snapshot.accountTypeLabel || snapshot.account_type_label || '',
        currentAccountType: snapshot.currentAccountType || snapshot.current_account_type || snapshot.accountType || snapshot.account_type || '',
        currentAccountTypeLabel: snapshot.currentAccountTypeLabel || snapshot.current_account_type_label || snapshot.accountTypeLabel || snapshot.account_type_label || '',
        message: snapshot.message || '',
      });
    } catch (error) {
      console.warn('[LicenseUsage] 消耗运行时次数失败:', error?.message || error);
      return null;
    }
  }

// 格式化/规范化：normalizeServerBrowserStorage的具体业务逻辑。
  function normalizeServerBrowserStorage(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const origin = String(entry.origin ?? entry.Origin ?? '').trim();
        const url = String(entry.url ?? entry.URL ?? '').trim();
        const localStorage = entry.localStorage && typeof entry.localStorage === 'object' ? entry.localStorage : {};
        const sessionStorage = entry.sessionStorage && typeof entry.sessionStorage === 'object' ? entry.sessionStorage : {};
        if (!origin && !url) return null;
        return { origin, url, localStorage, sessionStorage };
      })
      .filter(Boolean);
  }

// 获取/读取/解析：extractBrowserStorageFromResponse的具体业务逻辑。
  function extractBrowserStorageFromResponse(source) {
    if (!source || typeof source !== 'object') return [];
    const candidates = [
      source.browserStorage,
      source.browser_storage,
      source.data?.browserStorage,
      source.data?.browser_storage,
      source.result?.browserStorage,
      source.result?.browser_storage,
      source.payload?.browserStorage,
      source.payload?.browser_storage,
    ];
    for (const value of candidates) {
      const normalized = normalizeServerBrowserStorage(value);
      if (normalized.length > 0) return normalized;
    }
    return [];
  }

// 获取/读取/解析：extractAccountFromResponse的具体业务逻辑。
  function extractAccountFromResponse(source) {
    if (!source || typeof source !== 'object') return '';
    const candidates = [
      source.account,
      source.accountName,
      source.username,
      source.user_name,
      source.data?.account,
      source.data?.accountName,
      source.data?.username,
      source.result?.account,
      source.result?.accountName,
      source.result?.username,
      source.payload?.account,
      source.payload?.accountName,
      source.payload?.username,
    ];
    for (const value of candidates) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  }

// 格式化/规范化：normalizeServerCookies的具体业务逻辑。
  function normalizeServerCookies(raw) {
    if (!raw) return [];
    let arr = [];
    if (Array.isArray(raw)) {
      arr = raw.filter(x => x && typeof x === 'object');
    } else if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.cookies)) arr = raw.cookies.filter(x => x && typeof x === 'object');
      else {
        arr = Object.entries(raw).map(([name, value]) => ({ name: String(name), value: String(value) }));
      }
    }
    return arr.map(c => {
      const out = { path: '/', ...c };
      if (!out.url) {
        if (out.domain) {
          const host = String(out.domain).replace(/^\./, '');
          out.url = `https://${host}/`;
        } else {
          out.url = getTargetUrlFromStore();
        }
      }
      return out;
    });
  }

// 获取/读取/解析：fetchCookieFromServerForDream的具体业务逻辑。
  async function fetchCookieFromServerForDream(key, deviceId, options = {}) {
    if (tcpClient) {
      try {
        // 使用TCP通信（内部会自动降级HTTP）
        console.log('[fetchCookieFromServerForDream] 使用TCP获取Cookie');
        console.log(`[fetchCookieFromServerForDream] TCP连接状态: ${tcpClient.connected ? '已连接' : '未连接'}`);
        const platform = getPlatformFromStore();
        console.log(`[fetchCookieFromServerForDream] 发送请求参数: key=${key.substring(0, 4)}***, platform=${platform}, deviceId=${deviceId.substring(0, 8)}***`);

        const r = await tcpClient.fetchCookie(key, platform, deviceId);
        console.log(`[fetchCookieFromServerForDream] TCP响应接收完成，响应类型: ${typeof r}`);
        const currentAccountTypeInfo = extractCurrentAccountTypeInfo(r);
        const recycleDebugInfo = extractServerRecycleDebugInfo(r);

      // 详细记录响应内容（脱敏处理）
        const responseLog = {
          ok: r.ok,
          hasCookies: !!r.cookies,
          hasData: !!r.data,
          hasCookie: !!r.cookie,
          platform: r.platform,
          currentAccountType: currentAccountTypeInfo.currentAccountType || undefined,
          currentAccountTypeLabel: currentAccountTypeInfo.currentAccountTypeLabel || undefined,
          remainingSeconds: recycleDebugInfo.remainingSeconds,
          remainingMinutes: recycleDebugInfo.remainingMinutes,
          nextRefreshAt: recycleDebugInfo.nextRefreshAt,
          serverRecycleTime: recycleDebugInfo.serverRecycleTime,
          serverRecycleTimeIso: recycleDebugInfo.serverRecycleTimeIso,
          message: extractNestedText(r).substring(0, 100) || undefined,
          cookiesCount: r.cookies ? r.cookies.length : 0
        };
        console.log('[fetchCookieFromServerForDream] 响应内容:', JSON.stringify(responseLog, null, 2));

      const validationFailed = !isValidationSuccess(r) && (
        r.ok === false
        || r.success === false
        || r.valid === false
        || r.is_valid === false
        || extractValidationState(r)
      );
      if (!r.ok || validationFailed) {
        const errorMsg = sanitizeUserFacingMessage(
          getValidationFailureMessage(r, r.message || r.msg || '账号分配失败'),
          '账号分配失败'
        );
        console.log('[fetchCookieFromServerForDream] 请求失败，即将抛出错误:', errorMsg);
        throw createBusinessError(errorMsg, 'ACCOUNT_FETCH_FAILED');
      }
      const cookiesRaw = r.cookies || r.data || r.cookie;
      console.log(`[fetchCookieFromServerForDream] 提取到原始cookie数据，类型:${typeof cookiesRaw}, 长度:${Array.isArray(cookiesRaw) ? cookiesRaw.length : 'N/A'}`);

      const cookies = normalizeServerCookies(cookiesRaw);
      console.log(`[fetchCookieFromServerForDream] 标准化后cookie数量: ${cookies.length}`);

      if (!cookies.length) {
        console.error('[fetchCookieFromServerForDream] 标准化后没有可用cookie');
        throw createBusinessError('服务器未返回可用账号信息', 'ACCOUNT_EMPTY');
      }

      // 解析账号信息
      let account = extractAccountFromResponse(r) || '未知账号';

      // 如果账号是"未知账号"，尝试从message字段解析账号信息
      if (account === '未知账号' && r.message) {
        // 从message中提取账号信息，格式如："获取成功，已分配账号：TMd1d3hTWW@heysure.xyz（平台：即梦，积分：50）"
        const accountMatch = r.message.match(/已分配账号[：:]\s*([^\s（()]+)/);
        if (accountMatch && accountMatch[1]) {
          account = accountMatch[1];
          console.log(`[fetchCookieFromServerForDream] 从message中解析到账号: ${account}`);
        }
      }

      // 统一的Cookie分配报告
      try {
        const platform = r.platform || '即梦';
        const maskedKey = key.length >= 4 ? key.substring(0, 4) + '***' : key;

        const typeSuffix = currentAccountTypeInfo.currentAccountTypeLabel ? ` | 类型:${currentAccountTypeInfo.currentAccountTypeLabel}` : '';
        const reportMsg = `[fetchCookieFromServerForDream] Cookie获取成功 | 平台:${platform} | 账号:${account}${typeSuffix} | 卡密:${maskedKey} | Cookie数量:${cookies.length}`;
        console.log(reportMsg);
      } catch (e) {
        console.warn('[fetchCookieFromServerForDream] 生成报告消息失败:', e.message);
        // 降级到简单消息
        try {
          const maskedKey = key.length >= 4 ? key.substring(0, 4) + '***' : key;
          const simpleMsg = `[fetchCookieFromServerForDream] 平台=即梦 已获取Cookie 给卡密=${maskedKey}`;
          console.log(simpleMsg);
        } catch (e2) {
          console.warn('[fetchCookieFromServerForDream] 降级报告也失败:', e2.message);
        }
      }

        saveLicenseUsageSnapshot({ key, deviceId, source: r });
        const serverRecycleTimeInfo = extractServerRecycleTimeInfo(r);
        const browserStorage = extractBrowserStorageFromResponse(r);
        return {
          cookies,
          browserStorage,
          account,
          platform,
          currentPlatform: getPlatformFromStore(),
          currentUrl: getTargetUrlFromStore(),
          ...serverRecycleTimeInfo,
          ...currentAccountTypeInfo,
          current_account_type: currentAccountTypeInfo.currentAccountType,
          current_account_type_label: currentAccountTypeInfo.currentAccountTypeLabel,
          currentAccountType: currentAccountTypeInfo.currentAccountType,
          currentAccountTypeLabel: currentAccountTypeInfo.currentAccountTypeLabel
        };
      } catch (e) {
        if (e?.noHttpFallback || e?.businessError) {
          throw e;
        }
        console.warn('[fetchCookieFromServerForDream] TCP失败，尝试HTTP降级:', e?.message || e);
      }
    }

    // TCP客户端不可用或TCP失败，回退到HTTP通信
    const serverBase = resolveServerBase();
    if (!serverBase) throw new Error('HTTP服务器地址未配置');
    console.log('[fetchCookieFromServerForDream] HTTP降级获取Cookie');
    const url = serverBase + ENDPOINT_FETCH_COOKIE;
    const platform = getPlatformFromStore();
    const r = await postJson(url, { key, device_id: deviceId, platform });
    console.log('[fetchCookieFromServerForDream] 服务器响应:', { status: r.status, ok: r.ok });

    if (!r.ok || r.body?.success === false || r.body?.valid === false || r.body?.is_valid === false) {
      throw createBusinessError(
        sanitizeUserFacingMessage(
          getValidationFailureMessage(r.body || r, r.body?.message || r.body?.msg || '账号分配失败'),
          '账号分配失败'
        ),
        'ACCOUNT_FETCH_FAILED'
      );
    }

    const body = r.body;
    if (!body) throw new Error('服务器响应为空');

    const cookiesRaw = body.cookies || body.data || body.cookie;
    const cookies = normalizeServerCookies(cookiesRaw);
    if (!cookies.length) throw createBusinessError('服务器未返回可用账号信息', 'ACCOUNT_EMPTY');

    const currentAccountTypeInfo = extractCurrentAccountTypeInfo(body);

    // 解析账号信息
    let account = extractAccountFromResponse(body) || '未知账号';

    // 如果账号是"未知账号"，尝试从message字段解析账号信息
    if (account === '未知账号' && body.message) {
      // 从message中提取账号信息，格式如："获取成功，已分配账号：TMd1d3hTWW@heysure.xyz（平台：即梦，积分：50）"
      const accountMatch = body.message.match(/已分配账号[：:]\s*([^\s（()]+)/);
      if (accountMatch && accountMatch[1]) {
        account = accountMatch[1];
        console.log(`[fetchCookieFromServerForDream] 从message中解析到账号(HTTP降级): ${account}`);
      }
    }

    // 统一的Cookie分配报告
    try {
      const platform = body.platform || getPlatformFromStore();
      const maskedKey = key.length >= 4 ? key.substring(0, 4) + '***' : key;

      const typeSuffix = currentAccountTypeInfo.currentAccountTypeLabel ? ` | 类型:${currentAccountTypeInfo.currentAccountTypeLabel}` : '';
      const reportMsg = `[fetchCookieFromServerForDream] Cookie获取成功(HTTP降级) | 平台:${platform} | 账号:${account}${typeSuffix} | 卡密:${maskedKey} | Cookie数量:${cookies.length}`;
      console.log(reportMsg);
    } catch (e) {
      console.warn('[fetchCookieFromServerForDream] 生成报告消息失败:', e.message);
      // 降级到简单消息
      try {
        const maskedKey = key.length >= 4 ? key.substring(0, 4) + '***' : key;
        const platform = getPlatformFromStore();
        const simpleMsg = `[fetchCookieFromServerForDream] 平台=${platform} 已获取Cookie(HTTP降级) 给卡密=${maskedKey}`;
        console.log(simpleMsg);
      } catch (e2) {
        console.warn('[fetchCookieFromServerForDream] 降级报告也失败:', e2.message);
      }
    }

    saveLicenseUsageSnapshot({ key, deviceId, source: body });
    const serverRecycleTimeInfo = extractServerRecycleTimeInfo(body);
    const browserStorage = extractBrowserStorageFromResponse(body);
    return {
      cookies,
      browserStorage,
      account,
      platform: platform || '',
      currentPlatform: getPlatformFromStore(),
      currentUrl: getTargetUrlFromStore(),
      ...serverRecycleTimeInfo,
      ...currentAccountTypeInfo,
      current_account_type: currentAccountTypeInfo.currentAccountType,
      current_account_type_label: currentAccountTypeInfo.currentAccountTypeLabel,
      currentAccountType: currentAccountTypeInfo.currentAccountType,
      currentAccountTypeLabel: currentAccountTypeInfo.currentAccountTypeLabel
    };
  }

// 设置/更新/持久化：setCookiesToSession的具体业务逻辑。
  async function setCookiesToSession(electronSession, cookies) {
    const sess = electronSession;
    for (const c of cookies) {
      try {
        const { name, value, url, domain, path = '/', secure = false, httpOnly = false, expirationDate, sameSite } = c;
        if (!name) {
          log('Cookie', '单个 Cookie 注入失败：缺少 name 属性。原始数据:', c);
          continue;
        }
        const cookie = {
          url: url || (domain ? `https://${String(domain).replace(/^\./, '')}/` : getTargetUrlFromStore()),
          name: String(name), value: String(value), path,
          secure: !!secure, httpOnly: !!(httpOnly || c.httponly),
        };
        if (expirationDate) cookie.expirationDate = Number(expirationDate);
        if (domain) cookie.domain = String(domain);
        if (sameSite && ['no_restriction','lax','strict'].includes(String(sameSite).toLowerCase())) {
          cookie.sameSite = String(sameSite).toLowerCase();
        }
        await sess.cookies.set(cookie);
        log('Cookie', `成功注入 Cookie: ${cookie.name}`);
      } catch (e) {
        log('Cookie', `单个 Cookie 注入失败: ${e?.message || e}`, '原始数据:', c);
      }
    }
  }

// 获取/读取/解析：hasSessionCookies的具体业务逻辑。
  async function hasSessionCookies(electronSession) {
    try {
      const sess = electronSession;
      if (!sess || !sess.cookies || typeof sess.cookies.get !== 'function') {
        return false;
      }
      const currentCookies = await sess.cookies.get({});
      return Array.isArray(currentCookies) && currentCookies.length > 0;
    } catch (_) {
      return false;
    }
  }

// 格式化/规范化：normalizeBrowserStorageEntries的具体业务逻辑。
  function normalizeBrowserStorageEntries(browserStorage) {
    if (!Array.isArray(browserStorage)) return [];
    return browserStorage
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const origin = String(entry.origin ?? entry.Origin ?? '').trim();
        const url = String(entry.url ?? entry.URL ?? '').trim();
        const localStorage = entry.localStorage && typeof entry.localStorage === 'object' ? entry.localStorage : {};
        const sessionStorage = entry.sessionStorage && typeof entry.sessionStorage === 'object' ? entry.sessionStorage : {};
        if (!origin && !url) return null;
        return { origin, url, localStorage, sessionStorage };
      })
      .filter(Boolean);
  }

// 获取/读取/解析：getBrowserStorageOrigin的具体业务逻辑。
  function getBrowserStorageOrigin(urlValue) {
    try {
      return new URL(String(urlValue || '').trim()).origin;
    } catch (_) {
      return '';
    }
  }

// 创建/初始化：buildBrowserStorageScript的具体业务逻辑。
  function buildBrowserStorageScript(storageEntry) {
    return `
      (() => {
        try {
          const localData = ${JSON.stringify(storageEntry.localStorage || {})};
          const sessionData = ${JSON.stringify(storageEntry.sessionStorage || {})};
          try { localStorage.clear(); } catch (_) {}
          try { sessionStorage.clear(); } catch (_) {}
          for (const [key, value] of Object.entries(localData)) {
            try { localStorage.setItem(key, String(value)); } catch (_) {}
          }
          for (const [key, value] of Object.entries(sessionData)) {
            try { sessionStorage.setItem(key, String(value)); } catch (_) {}
          }
        } catch (e) {}
      })();
    `;
  }

// 设置/更新/持久化：applyBrowserStorageToPage的具体业务逻辑。
  function applyBrowserStorageToPage(webContents, browserStorage) {
    try {
      if (!webContents || typeof webContents.executeJavaScript !== 'function') return false;
      const entries = normalizeBrowserStorageEntries(browserStorage);
      if (!entries.length) return false;

      const state = browserStorageInjectionState.get(webContents) || {};
      state.entries = entries;
      state.bound = true;
      state.reloadedAfterInject = state.reloadedAfterInject === true;
      browserStorageInjectionState.set(webContents, state);

// 处理：inject的具体业务逻辑。
      const inject = async () => {
        try {
          if (!webContents || webContents.isDestroyed()) return;
          const currentUrl = String(webContents.getURL() || '').trim();
          const currentOrigin = getBrowserStorageOrigin(currentUrl);
          if (!currentOrigin) return;
          const matched = state.entries.filter((entry) => {
            const entryOrigin = getBrowserStorageOrigin(entry.origin || entry.url || '');
            return entryOrigin && entryOrigin === currentOrigin;
          });
          if (!matched.length) return;

          const merged = {
            localStorage: {},
            sessionStorage: {},
          };
          for (const entry of matched) {
            Object.assign(merged.localStorage, entry.localStorage || {});
            Object.assign(merged.sessionStorage, entry.sessionStorage || {});
          }

          const js = buildBrowserStorageScript(merged);
          await webContents.executeJavaScript(js, true).catch(() => {});
          if (!state.reloadedAfterInject) {
            state.reloadedAfterInject = true;
            setTimeout(() => {
              try {
                if (!webContents || webContents.isDestroyed()) return;
                const currentUrl = String(webContents.getURL() || '').trim();
                if (!currentUrl || currentUrl === 'about:blank') return;
                webContents.reloadIgnoringCache();
              } catch (_) {}
            }, 0);
          }
        } catch (_) {}
      };

      if (!state.listenersAttached) {
        state.listenersAttached = true;
        webContents.on('dom-ready', inject);
        webContents.on('did-finish-load', inject);
      }

      void inject();
      return true;
    } catch (e) {
      log('BrowserStorage', `浏览器存储注入失败: ${e?.message || e}`);
      return false;
    }
  }

// 处理：waitForMainFrameSuccess的具体业务逻辑。
  function waitForMainFrameSuccess(wc, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      try {
        if (!wc || wc.isDestroyed()) return reject(new Error('webContents 不可用'));
        let done = false;
        let timer = null;
        try { if (typeof wc.setMaxListeners === 'function') wc.setMaxListeners(Math.max(20, wc.getMaxListeners ? wc.getMaxListeners() : 0)); } catch (_) {}
// 停止/关闭/清理：cleanup的具体业务逻辑。
        const cleanup = () => {
          try { wc.removeListener('dom-ready', onDomReady); } catch (_) {}
          try { wc.removeListener('did-frame-finish-load', onFrameFinish); } catch (_) {}
          try { wc.removeListener('did-finish-load', onFinish); } catch (_) {}
          try { wc.removeListener('did-fail-load', onFail); } catch (_) {}
          if (timer) { clearTimeout(timer); timer = null; }
        };
// 处理：finish的具体业务逻辑。
        const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
// 处理：fail的具体业务逻辑。
        const fail = (err) => { if (done) return; done = true; cleanup(); reject(err instanceof Error ? err : new Error(String(err))); };
// 监听/绑定：onDomReady的具体业务逻辑。
        const onDomReady = () => finish();
// 监听/绑定：onFrameFinish的具体业务逻辑。
        const onFrameFinish = (_event, isMainFrame) => { if (isMainFrame) finish(); };
// 监听/绑定：onFinish的具体业务逻辑。
        const onFinish = () => finish();
// 监听/绑定：onFail的具体业务逻辑。
        const onFail = (event, errorCode, errorDesc, validatedURL, isMainFrame) => {
          if (!isMainFrame) return;
// 处理：desc的具体业务逻辑。
          const desc = (errorDesc || '').trim();
          fail(new Error(`加载失败: ${errorCode}${desc ? ' ' + desc : ''}`));
        };
        wc.once('dom-ready', onDomReady);
        wc.once('did-frame-finish-load', onFrameFinish);
        wc.once('did-finish-load', onFinish);
        wc.once('did-fail-load', onFail);
        timer = setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          console.warn('[Auth] 主框架等待超时，继续后续账号注入/保存流程');
          resolve({ ok: false, timedOut: true });
        }, timeoutMs);
      } catch (e) { reject(e); }
    });
  }

  // —— 新增：繁体中文语言偏好注入 + 自动Cookie获取
  // 可传入 electronSession，且可选传入当前 webContents（确保已创建的窗口也能注入 init 脚本）
  function applyZhHantRequestPrefs(electronSession, currentWebContents) {
    try {
      if (!electronSession) return;

      // 首次为该 session 安装网络层钩子
      if (!patchedSessions.has(electronSession)) {
        patchedSessions.add(electronSession);

        // 1) HTTP Accept-Language 头
        electronSession.webRequest.onBeforeSendHeaders((details, callback) => {
          if (!matchesLocaleTargets(details.url)) return callback({ requestHeaders: details.requestHeaders });
          const headers = { ...details.requestHeaders, 'Accept-Language': ZH_HANT_ACCEPT_LANGUAGE };
          callback({ requestHeaders: headers });
        });

        // 2) Cookie 预置 + 首个请求兜底
        setLocaleCookies(electronSession, log);
        electronSession.webRequest.onBeforeRequest(async (details, callback) => {
          if (matchesLocaleTargets(details.url)) {
            try { await setLocaleCookies(electronSession, log); } catch (_) {}
          }
          callback({});
        });

        // 3) 未来创建的 webContents：自动注入 init 脚本 + 自动获取Cookie
        app.on('web-contents-created', (_evt, wc) => {
          try {
            if (!wc || wc.isDestroyed()) return;
            if (wc.session !== electronSession) return;

            // 监听页面加载完成，自动获取并注入Cookie
            wc.on('dom-ready', async () => {
              try {
                const url = wc.getURL();
                if (!matchesLocaleTargets(url)) return;

                // 注入繁体中文脚本
                const js = `
                  try {
                    if (!localStorage.getItem('i18nextLng')) {
                      localStorage.setItem('i18nextLng', '${ZH_HANT_COOKIE_VALUE}');
                    }
                    const doc = document.documentElement;
                    if (!doc.getAttribute('lang')) {
                      doc.setAttribute('lang', '${ZH_HANT_COOKIE_VALUE}');
                    }
                  } catch (e) {}
                `;
                await wc.executeJavaScript(js, true).catch(() => {});

              } catch (error) {
                log('AutoCookie', `自动Cookie注入过程出错: ${error.message}`);
              }
            });
          } catch (_) {}
        });

        log('Locale', '繁体中文偏好注入 + 自动Cookie获取 已启用');
      }

      // 如果当前 webContents 已经存在，确保也能拿到 init 脚本 + 自动Cookie
      if (currentWebContents && !currentWebContents.isDestroyed() && currentWebContents.session === electronSession) {
        currentWebContents.on('dom-ready', async () => {
          try {
            const url = currentWebContents.getURL();
            if (!matchesLocaleTargets(url)) return;

            // 注入繁体中文脚本
            const js = `
              try {
                if (!localStorage.getItem('i18nextLng')) {
                  localStorage.setItem('i18nextLng', '${ZH_HANT_COOKIE_VALUE}');
                }
                const doc = document.documentElement;
                if (!doc.getAttribute('lang')) {
                  doc.setAttribute('lang', '${ZH_HANT_COOKIE_VALUE}');
                }
              } catch (e) {}
            `;
            await currentWebContents.executeJavaScript(js, true).catch(() => {});

          } catch (error) {
            log('AutoCookie', `自动Cookie注入过程出错: ${error.message}`);
          }
        });
      }
    } catch (e) {
      log('Locale', `启用繁体化偏好失败: ${e?.message || e}`);
    }
  }

  return {
    fetchCookieFromServerForDream,
    normalizeServerCookies,
    setCookiesToSession,
    hasSessionCookies,
    applyBrowserStorageToPage,
    waitForMainFrameSuccess,
    applyZhHantRequestPrefs, // 新增导出
    saveLicenseUsageSnapshot,
    getStoredLicenseUsage,
    isValidationSuccess,
    extractNestedText,
    extractValidationState,
    extractServerRecycleTimeInfo,
    getValidationFailureMessage,
  };
}

module.exports = {
  createAuthCookie,
  isValidationSuccess,
  extractNestedText,
  extractValidationState,
  extractServerRecycleTimeInfo,
  getValidationFailureMessage,
};
