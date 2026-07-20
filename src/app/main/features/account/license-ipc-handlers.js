const { writeDebugConsoleOnly } = require('../../runtime/debug-console-log');
const {
  getValidationFailureMessage,
  isValidationSuccess,
} = require('../../utils/license-response');
const { setLicenseRuntimeConfig } = require('../../utils/runtime-config');
const { markVipServerVerified } = require('../../utils/vip-access');
const {
  normalizeLicenseBinding,
  persistSavedLicenseKeySafe,
  readStoreConfigSafe,
  writeStoreConfigSafe,
} = require('../../ipc/register/store-utils');
const { normalizeValidationRuntimeConfig } = require('../../lib/http-client');
const { firstNonNull, firstNonNullOr, firstText } = require('../../../shared/safe-values');

function text(...values) {
  return firstText(...values).trim();
}

function errorMessage(error, fallback = '') {
  return text(error && error.message, error, fallback);
}

async function runExclusive(state, key, task) {
  if (state[key]) return state[key];
  state[key] = task();
  try {
    return await state[key];
  } finally {
    state[key] = null;
  }
}

function credentialsFrom(deps) {
  if (!deps.licenseCache || typeof deps.licenseCache.getCredentials !== 'function') return {};
  return deps.licenseCache.getCredentials();
}

function cacheRuntimeConfig(deps, value) {
  if (deps.licenseCache && typeof deps.licenseCache.setRuntimeConfig === 'function') {
    deps.licenseCache.setRuntimeConfig(value);
  }
}

async function refreshWoolPlatformsTask(deps) {
  try {
    const credentials = credentialsFrom(deps);
    const key = text(credentials.key);
    const deviceId = text(credentials.deviceId);
    if (!key || !deviceId) return { ok: false, authenticated: false, message: '请先登录账号' };
    if (!deps.httpClient || typeof deps.httpClient.validateKey !== 'function') {
      return { ok: false, message: '羊毛平台服务尚未就绪' };
    }
    const validation = await deps.httpClient.validateKey(key, deviceId);
    if (!isValidationSuccess(validation)) {
      return { ok: false, message: getValidationFailureMessage(validation, '刷新羊毛平台失败') };
    }
    const normalized = normalizeValidationRuntimeConfig(validation);
    const woolPlatforms = Array.isArray(normalized.woolPlatforms) ? normalized.woolPlatforms : [];
    cacheRuntimeConfig(deps, { woolPlatforms });
    return { ok: true, woolPlatforms };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

async function readPublicTutorial(deps) {
  if (!deps.httpClient || typeof deps.httpClient.getTutorialUrl !== 'function') return '';
  const response = await deps.httpClient.getTutorialUrl();
  const tutorialUrl = text(response && response.tutorialUrl, response && response.tutorial_url);
  return response && response.ok === true ? tutorialUrl : '';
}

async function readValidatedTutorial(deps) {
  const credentials = credentialsFrom(deps);
  const key = text(credentials.key);
  const deviceId = text(credentials.deviceId);
  if (!key || !deviceId) return { ok: false, authenticated: false, message: '请先登录账号' };
  if (!deps.httpClient || typeof deps.httpClient.validateKey !== 'function') {
    return { ok: false, message: '教程配置服务尚未就绪' };
  }
  const validation = await deps.httpClient.validateKey(key, deviceId);
  if (!isValidationSuccess(validation)) {
    return { ok: false, message: getValidationFailureMessage(validation, '刷新教程链接失败') };
  }
  const tutorialUrl = text(normalizeValidationRuntimeConfig(validation).tutorialUrl);
  return tutorialUrl
    ? { ok: true, tutorialUrl }
    : { ok: false, message: '服务器未配置教程链接' };
}

async function refreshTutorialTask(deps) {
  try {
    const publicUrl = await readPublicTutorial(deps);
    const result = publicUrl ? { ok: true, tutorialUrl: publicUrl } : await readValidatedTutorial(deps);
    if (result.ok) cacheRuntimeConfig(deps, { tutorialUrl: result.tutorialUrl });
    return result;
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function validationSucceeded(response) {
  if (Object.prototype.hasOwnProperty.call(response || {}, 'valid')) {
    return response.valid === true;
  }
  return isValidationSuccess(response);
}

function logValidationSummary(response) {
  if (response && response.requestUrl) {
    const method = response.requestMethod || 'GET';
    writeDebugConsoleOnly('info', `[验证] HTTP请求地址: ${method} ${response.requestUrl}`);
  }
  console.log('[验证] HTTP响应摘要:', {
    ok: response && response.ok === true,
    valid: response && response.valid === true,
    state: text(response && response.state, response && response.status),
    expire_at: text(response && response.expire_at),
    days_left: firstNonNullOr(null, response && response.days_left),
    account_type: text(response && response.account_type, response && response.accountType),
    transport_mode: text(response && response.transportMode, 'http'),
    request_url: text(response && response.requestUrl),
  });
}

function applyRuntimeConnection(deps, runtimeConfig) {
  const connection = deps.resolveRuntimeConnectionConfig(runtimeConfig);
  setLicenseRuntimeConfig(deps.licenseCache, runtimeConfig, { serverBase: connection.serverBase });
  if (typeof deps.setRuntimeServerBase === 'function' && connection.serverBase) {
    deps.setRuntimeServerBase(connection.serverBase);
  }
  if (typeof deps.setRuntimeTcpConfig !== 'function') return connection;
  if (!connection.tcp) {
    deps.setRuntimeTcpConfig(null);
    return connection;
  }
  deps.setRuntimeTcpConfig({
    host: connection.tcp.host,
    port: connection.tcp.port,
    transport: {
      preferred: 'tls',
      allowHttpFallback: true,
      allowPlainFallback: false,
      tls: { enabled: true, rejectUnauthorized: false },
    },
  });
  return connection;
}

function validationState(response, key, deviceId) {
  const binding = normalizeLicenseBinding(response);
  return {
    key,
    deviceId,
    validated: true,
    bound: true,
    licenseValidated: true,
    result: markVipServerVerified(response),
    canSelfUnbind: binding.canSelfUnbind,
    remainingUnbindTimes: binding.remainingUnbindTimes,
    maxUnbindTimes: binding.maxUnbindTimes,
    usedUnbindTimes: binding.usedUnbindTimes,
    deviceBindCount: binding.deviceBindCount,
    maxDeviceCount: binding.maxDeviceCount,
    deviceBindingStatus: binding.deviceBindingStatus,
    deviceBindingSummary: binding.deviceBindingSummary,
    maxUsageTimes: firstNonNull(binding.maxUsageTimes, response.max_usage_times, response.maxUsageTimes, null),
    usedUsageTimes: firstNonNull(binding.usedUsageTimes, response.used_usage_times, response.usedUsageTimes, null),
    remainingUsageTimes: firstNonNull(binding.remainingUsageTimes, response.remaining_usage_times, response.remainingUsageTimes, null),
    licenseUsage: response,
    accountType: text(response.accountType, response.account_type),
    accountTypeLabel: text(response.accountTypeLabel, response.account_type_label),
    currentAccountType: text(response.currentAccountType, response.current_account_type),
    currentAccountTypeLabel: text(response.currentAccountTypeLabel, response.current_account_type_label),
    message: text(response.message, response.msg),
  };
}

function startAnnouncementRefresh(deps) {
  if (typeof deps.refreshAnnouncements !== 'function') return;
  try {
    void Promise.resolve(deps.refreshAnnouncements()).catch((error) => {
      console.warn('[验证] 获取服务器公告失败:', errorMessage(error));
    });
  } catch (error) {
    console.warn('[验证] 获取服务器公告失败:', errorMessage(error));
  }
}

async function runOptionalStep(label, task) {
  try {
    return await task();
  } catch (error) {
    console.warn(label, errorMessage(error));
    return undefined;
  }
}

async function applyValidatedLicense(deps, response, key, deviceId) {
  applyRuntimeConnection(deps, normalizeValidationRuntimeConfig(response));
  if (deps.licenseCache && typeof deps.licenseCache.setValidationState === 'function') {
    deps.licenseCache.setValidationState(validationState(response, key, deviceId));
  }
  startAnnouncementRefresh(deps);
  await runOptionalStep('[验证] 刷新账号回收定时器失败:', async () => {
    if (typeof deps.initializeAccountCleanup === 'function') {
      await deps.initializeAccountCleanup(deps.accountStorage, deps.buildAccountCleanupOptions());
    }
  });
  await runOptionalStep('[验证] 保存本地试用次数失败:', async () => {
    if (deps.auth && typeof deps.auth.saveLicenseUsageSnapshot === 'function') {
      deps.auth.saveLicenseUsageSnapshot({ key, deviceId, source: response });
    }
  });
  await runOptionalStep('[验证] 写入卡密历史失败:', async () => {
    if (typeof deps.appendLicenseRecord === 'function') {
      deps.appendLicenseRecord({
        key,
        status: 'success',
        platformName: text(response.platformName, response.platform, response.currentPlatformName),
      });
    }
  });
  await runOptionalStep('[验证] 保存最近使用卡密失败:', async () => {
    persistSavedLicenseKeySafe({
      readStoreConfigSafe,
      writeStoreConfigSafe,
      licenseCache: deps.licenseCache,
    }, key, deviceId);
  });
  await runOptionalStep('[验证] 刷新平台名称失败:', async () => {
    if (typeof deps.refreshAllowedPlatformsAndNotify === 'function') {
      await deps.refreshAllowedPlatformsAndNotify();
    }
  });
}

function mergeStoredUsage(deps, response, key, deviceId) {
  try {
    if (!deps.auth || typeof deps.auth.getStoredLicenseUsage !== 'function') return response;
    const localUsage = deps.auth.getStoredLicenseUsage(key, deviceId);
    return localUsage ? { ...response, ...localUsage } : response;
  } catch (error) {
    console.warn('[验证] 读取本地试用次数失败:', errorMessage(error));
    return response;
  }
}

function validationSuccessResult(deps, response, manualProxyPreferred) {
  if (manualProxyPreferred) {
    try {
      if (deps.state) deps.state.manualProxyPreferred = true;
    } catch (_) {}
    return { ok: true, status: 200, result: response, started: false, reason: 'manual_proxy_preferred' };
  }
  return { ok: true, status: 200, result: response, started: false, reason: 'proxy_removed' };
}

async function validateKey(deps, _event, payload) {
  try {
    const { key, device_id: deviceId, manualProxyPreferred } = payload;
    console.log('[验证] 开始验证卡密（HTTP）');
    if (!deps.httpClient) return { ok: false, status: 0, error: '网络客户端不可用' };
    const response = await deps.httpClient.validateKey(key, deviceId);
    logValidationSummary(response);
    if (!validationSucceeded(response)) {
      return {
        ok: false,
        status: 200,
        error: getValidationFailureMessage(response, '卡密验证失败'),
        result: response,
      };
    }
    try {
      await applyValidatedLicense(deps, response, key, deviceId);
    } catch (error) {
      console.warn('[验证] 保存凭证过程出错:', errorMessage(error));
    }
    const merged = mergeStoredUsage(deps, response, key, deviceId);
    return validationSuccessResult(deps, merged, manualProxyPreferred);
  } catch (error) {
    console.error('[验证] 验证过程出错:', errorMessage(error));
    return { ok: false, status: 0, error: errorMessage(error) };
  }
}

async function requestUnbind(deps, key, deviceId) {
  if (deps.httpClient && typeof deps.httpClient.unbindDevice === 'function') {
    return deps.httpClient.unbindDevice(key, deviceId);
  }
  if (!deps.http || typeof deps.http.postJson !== 'function') throw new Error('解绑客户端不可用');
  const serverBase = deps.getServerBase();
  if (!serverBase) throw new Error('服务器地址未配置');
  const response = await deps.http.postJson(`${serverBase.replace(/\/+$/, '')}/api/unbind_device`, {
    key,
    device_id: deviceId,
    deviceId,
  });
  const body = response.body && typeof response.body === 'object' ? response.body : {};
  return { ok: response.ok, status: response.status, ...body };
}

async function unbindDevice(deps, _event, payload) {
  try {
    const key = text(payload.key);
    const deviceId = text(payload.device_id, payload.deviceId);
    if (!key) return { ok: false, message: '缺少卡密' };
    if (!deviceId) return { ok: false, message: '缺少设备号' };
    const response = await requestUnbind(deps, key, deviceId);
    if (!response || !response.ok) return response || { ok: false, message: '解绑失败' };
    await runOptionalStep('[解绑] 更新本地凭证状态失败:', async () => {
      if (deps.licenseCache && typeof deps.licenseCache.setUnboundState === 'function') {
        deps.licenseCache.setUnboundState({ key, deviceId });
      }
    });
    return response;
  } catch (error) {
    console.error('[解绑] 解绑过程出错:', errorMessage(error));
    return { ok: false, message: errorMessage(error, '解绑失败') };
  }
}

async function refreshSubscriptionUrl(deps) {
  try {
    if (!deps.httpClient) return { ok: false, error: 'TCP客户端不可用' };
    const last = deps.accountStorage.getLastUsedAccount();
    if (!last.ok || !last.account) {
      return { ok: false, error: '没有找到有效的账号信息，请先验证卡密' };
    }
    let response;
    try {
      response = await deps.httpClient.getClientConfig(last.account.key, last.account.deviceId);
    } catch (error) {
      return { ok: false, error: `获取配置失败: ${errorMessage(error)}` };
    }
    if (response && response.ok && response.proxy_subscription_url) {
      return { ok: true, subscriptionUrl: response.proxy_subscription_url };
    }
    return { ok: false, error: '获取配置失败或响应格式不正确' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function createLicenseIpcHandlers(deps) {
  const inFlight = { wool: null, tutorial: null };
  return {
    refreshWoolPlatforms: () => runExclusive(inFlight, 'wool', () => refreshWoolPlatformsTask(deps)),
    refreshTutorialUrl: () => runExclusive(inFlight, 'tutorial', () => refreshTutorialTask(deps)),
    validateKey: (event, payload) => validateKey(deps, event, payload),
    unbindDevice: (event, payload) => unbindDevice(deps, event, payload),
    refreshSubscriptionUrl: () => refreshSubscriptionUrl(deps),
  };
}

module.exports = { createLicenseIpcHandlers };
