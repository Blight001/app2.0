const { ipcMain } = require('electron');
const { writeDebugConsoleOnly } = require('../../runtime/debug-console-log');
const fs = require('fs');
const accountStorage = require('../../lib/account-storage');
const { getStorePath, getServerBase } = require('../../config');
const {
  getValidationFailureMessage,
  isValidationSuccess,
} = require('../../utils/license-response');
const { isUsageExhaustedFetchError } = require('../../utils/account-errors');
const {
  findAccountRecord,
  isPermanentAccountRecord,
  resolveDreamTargetUrl: resolveConfiguredDreamTargetUrl,
} = require('../../utils/account-records');
const { setLicenseRuntimeConfig } = require('../../utils/runtime-config');
const { markVipServerVerified } = require('../../utils/vip-access');
const {
  buildUnboundCredentialRecord,
  normalizeLicenseBinding,
  persistSavedLicenseKeySafe,
  readStoreConfigSafe,
  sanitizeUserFacingMessage,
  writeStoreConfigSafe,
} = require('./store-utils');
const { initializeAccountCleanup, updateAccountRecycleTimer } = require('../../utils/accountCleanup');
const { cleanupAccountProfile } = require('../../services/account-profile-cleanup');

// 监听/绑定：registerLicenseIPC的具体业务逻辑。
function registerLicenseIPC(ctx) {
  const {
    httpClient,
    auth,
    ui,
    state,
    licenseCache,
    setRuntimeTcpConfig = () => {},
    setRuntimeServerBase = () => {},
    appendLicenseRecord,
    refreshAllowedPlatformsAndNotify,
    refreshAnnouncements,
    DREAM_TARGET_URL,
    getDreamTargetUrl,
  } = ctx;
  let woolPlatformRefreshInFlight = null;
  let tutorialUrlRefreshInFlight = null;

  const resolveDreamTargetUrl = () => resolveConfiguredDreamTargetUrl(getDreamTargetUrl, DREAM_TARGET_URL);

  ipcMain.handle('refresh-wool-platforms', async () => {
    if (woolPlatformRefreshInFlight) return woolPlatformRefreshInFlight;

    woolPlatformRefreshInFlight = (async () => {
      try {
        const credentials = licenseCache?.getCredentials?.() || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        if (!key || !deviceId) {
          return { ok: false, authenticated: false, message: '请先登录账号' };
        }
        if (!httpClient || typeof httpClient.validateKey !== 'function') {
          return { ok: false, message: '羊毛平台服务尚未就绪' };
        }

        // 切入浏览器配置时只请求一次验证接口，以获取服务器最新羊毛平台。
        const validation = await httpClient.validateKey(key, deviceId);
        if (!isValidationSuccess(validation)) {
          return {
            ok: false,
            message: getValidationFailureMessage(validation, '刷新羊毛平台失败'),
          };
        }

        const { normalizeValidationRuntimeConfig } = require('../../lib/http-client');
        const normalized = normalizeValidationRuntimeConfig(validation);
        const woolPlatforms = Array.isArray(normalized.woolPlatforms)
          ? normalized.woolPlatforms
          : [];
        // 本入口只更新羊毛平台缓存；账号、配额和其它运行配置保持原样。
        licenseCache?.setRuntimeConfig?.({ woolPlatforms });
        return { ok: true, woolPlatforms };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    })();

    try {
      return await woolPlatformRefreshInFlight;
    } finally {
      woolPlatformRefreshInFlight = null;
    }
  });

  ipcMain.handle('refresh-tutorial-url', async () => {
    if (tutorialUrlRefreshInFlight) return tutorialUrlRefreshInFlight;

    tutorialUrlRefreshInFlight = (async () => {
      try {
        // 新版服务器提供公开教程配置接口。优先直接读取，使未登录用户、
        // 会员验证暂时失败的用户也能同步管理员刚保存的新地址。
        if (httpClient && typeof httpClient.getTutorialUrl === 'function') {
          const response = await httpClient.getTutorialUrl();
          const tutorialUrl = String(response?.tutorialUrl || response?.tutorial_url || '').trim();
          if (response?.ok === true && tutorialUrl) {
            licenseCache?.setRuntimeConfig?.({ tutorialUrl });
            return { ok: true, tutorialUrl };
          }
        }

        // 兼容尚未提供公开接口的旧服务器。
        const credentials = licenseCache?.getCredentials?.() || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        if (!key || !deviceId) {
          return { ok: false, authenticated: false, message: '请先登录账号' };
        }
        if (!httpClient || typeof httpClient.validateKey !== 'function') {
          return { ok: false, message: '教程配置服务尚未就绪' };
        }

        // 教程入口可能由服务器随时更换。每次打开前只刷新这一项，避免继续
        // 使用登录时留下的旧缓存，也不改动账号状态、配额或其它运行配置。
        const validation = await httpClient.validateKey(key, deviceId);
        if (!isValidationSuccess(validation)) {
          return {
            ok: false,
            message: getValidationFailureMessage(validation, '刷新教程链接失败'),
          };
        }

        const { normalizeValidationRuntimeConfig } = require('../../lib/http-client');
        const normalized = normalizeValidationRuntimeConfig(validation);
        const tutorialUrl = String(normalized.tutorialUrl || '').trim();
        if (!tutorialUrl) {
          return { ok: false, message: '服务器未配置教程链接' };
        }
        licenseCache?.setRuntimeConfig?.({ tutorialUrl });
        return { ok: true, tutorialUrl };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    })();

    try {
      return await tutorialUrlRefreshInFlight;
    } finally {
      tutorialUrlRefreshInFlight = null;
    }
  });

  const cleanupAccountBrowserArtifacts = (accountId) => cleanupAccountProfile(accountId, {
    browserRuntimeManager: ui?.browserRuntimeManager,
    getTabs: ui?.getTabs,
    closeTab: ui?.closeTab,
    fs,
    getStorePath,
    sendToSide: ui?.sendToSide,
    logger: console,
  });
  const buildAccountCleanupOptions = () => ({
    sendToSide: ui && typeof ui.sendToSide === 'function' ? ui.sendToSide : null,
    cleanupAccountArtifacts: cleanupAccountBrowserArtifacts,
  });

// 获取/读取/解析：resolveDreamWindowTitle的具体业务逻辑。
  const resolveDreamWindowTitle = (fallback = '') => {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const candidates = [
        runtimeConfig.platformName,
        Array.isArray(runtimeConfig.allowedPlatforms) ? runtimeConfig.allowedPlatforms[0] : '',
        fallback,
      ];
      for (const item of candidates) {
        const text = String(item || '').trim();
        if (text) return text;
      }
    } catch (_) {}
    return String(fallback || '').trim();
  };

  const findDreamAccountRecord = (accountId = '', key = '') => findAccountRecord(accountStorage, { accountId, key });

  const buildPlatformAccountId = (platform, accountId) => {
    const normalizedPlatform = String(platform || '').trim();
    const normalizedAccountId = String(accountId || '').trim();
    return normalizedPlatform && normalizedAccountId
      ? `${normalizedPlatform}::${normalizedAccountId}`
      : normalizedAccountId;
  };

  const isPermanentDreamAccount = (accountId = '', key = '') => {
    try {
      const account = findDreamAccountRecord(accountId, key);
      return isPermanentAccountRecord(account, { includeProtected: true });
    } catch (_) {
      return false;
    }
  };

// 获取/读取/解析：resolveHistoricalDreamAccount的具体业务逻辑。
  const resolveHistoricalDreamAccount = (preferredKey = '', preferredAccountId = '', requirePermanent = false, requestedPlatform = '') => {
    try {
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : {};
      const targetPlatform = String(
        requestedPlatform
        || snapshot.platformName
        || snapshot.platform
        || snapshot.currentPlatform
        || snapshot.currentPlatformName
        || ''
      ).trim().toLowerCase();
      const normalizedPreferredKey = String(preferredKey || '').trim();
      const normalizedPreferredAccountId = String(preferredAccountId || '').trim();
      const accountSummaries = typeof accountStorage.getAllAccounts === 'function'
        ? accountStorage.getAllAccounts()
        : [];
      const candidates = [];

      for (const summary of accountSummaries) {
        const accountId = String(summary?.id || '').trim();
        if (!accountId) continue;

        const accountResult = accountStorage.getAccount(accountId);
        if (!accountResult || accountResult.ok !== true || !accountResult.account) {
          continue;
        }

        const account = accountResult.account;
        const accountIdentity = String(account.account || account.accountName || '').trim();
        if (normalizedPreferredAccountId && accountId !== normalizedPreferredAccountId && accountIdentity !== normalizedPreferredAccountId) {
          continue;
        }
        const accountKey = String(account.key || '').trim();
        if (normalizedPreferredKey && accountKey && accountKey !== normalizedPreferredKey) {
          continue;
        }
        if (requirePermanent && !isPermanentAccountRecord(account, { includeProtected: true })) {
          continue;
        }

        if (targetPlatform) {
          const accountPlatform = String(
            account.platform
            || account.currentPlatform
            || summary.platform
            || summary.currentPlatform
            || ''
          ).trim().toLowerCase();
          if (accountPlatform && accountPlatform !== targetPlatform) {
            continue;
          }
        }

        candidates.push(account);
      }

      candidates.sort((a, b) => {
        const aTime = Date.parse(String(a.lastUsedAt || '')) || 0;
        const bTime = Date.parse(String(b.lastUsedAt || '')) || 0;
        if (aTime !== bTime) return bTime - aTime;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      return candidates[0] || null;
    } catch (error) {
      console.warn('[open-dream-page] 读取历史账号失败:', error?.message || error);
      return null;
    }
  };

// 获取/读取/解析：findOpenDreamTab的具体业务逻辑。
  const findOpenDreamTab = (accountId = '') => {
    try {
      const tabs = ui && typeof ui.getTabs === 'function' ? ui.getTabs() : new Map();
      const normalizedAccountId = String(accountId || '').trim();

      for (const tab of tabs.values()) {
        const tabAccountId = String(tab?.accountId || '').trim();
        if (normalizedAccountId && tabAccountId === normalizedAccountId) {
          return tab;
        }
      }
    } catch (_) {}
    return null;
  };

  const hasPersistedDreamProfile = (accountId = '') => {
    try {
      const store = ui?.browserRuntimeManager?.store;
      if (!store || typeof store.readProfile !== 'function') return false;
      const profile = store.readProfile(String(accountId || '').trim());
      return !!(profile && profile.createdAt);
    } catch (_) {
      return false;
    }
  };

// 处理：importServerFetchedDreamAccount的具体业务逻辑。
  const importServerFetchedDreamAccount = async ({
    key,
    deviceId,
    fetchedAccountId,
    fetchResult,
    fetchedCookies,
    fetchedBrowserStorage,
    targetUrl,
  }) => {
    const browserStoragePayload = Array.isArray(fetchedBrowserStorage) ? fetchedBrowserStorage : [];
    const storageAccountId = buildPlatformAccountId(
      fetchResult?.platform || fetchResult?.currentPlatform,
      fetchedAccountId
    );
    console.log('[open-dream-page] 未命中历史账号，导入服务器返回的账号信息到历史记录:', fetchedAccountId);

    const saveResult = accountStorage.addAccount({
      key,
      deviceId,
      cookies: Array.isArray(fetchedCookies) ? fetchedCookies : [],
      browserStorage: browserStoragePayload.length > 0 ? browserStoragePayload : undefined,
      accountId: storageAccountId,
      accountName: fetchedAccountId,
      account: fetchedAccountId,
      platform: fetchResult?.platform,
      currentPlatform: fetchResult?.currentPlatform,
      currentUrl: fetchResult?.currentUrl || targetUrl,
      currentAccountType: fetchResult?.currentAccountType,
      currentAccountTypeLabel: fetchResult?.currentAccountTypeLabel,
      current_account_type: fetchResult?.currentAccountType,
      current_account_type_label: fetchResult?.currentAccountTypeLabel,
      serverRecycleTime: fetchResult?.serverRecycleTime,
      serverRecycleTimeTs: fetchResult?.serverRecycleTimeTs,
      serverRecycleTimeIso: fetchResult?.serverRecycleTimeIso,
      server_recycle_time: fetchResult?.serverRecycleTime,
      ai_account_expiry_time: fetchResult?.serverRecycleTime,
      aiAccountExpiryTime: fetchResult?.serverRecycleTime,
    });

    if (!saveResult.ok || !saveResult.account) {
      throw new Error(saveResult.error || '账号保存失败');
    }

    const importAccount = saveResult.account;
    const savedAccountId = String(importAccount.id || '').trim();

    return {
      account: importAccount,
      accountId: String(importAccount.id || savedAccountId || fetchedAccountId || '').trim(),
      cookies: Array.isArray(fetchedCookies) ? fetchedCookies : [],
      browserStorage: browserStoragePayload,
    };
  };

  const resolveRuntimeConnectionConfig = (source = {}) => {
    const runtimeConfig = typeof source === 'object' && source !== null
      ? source
      : {};
    const runtimeServerBase = String(
      runtimeConfig.serverBase
      || runtimeConfig.server_base
      || runtimeConfig.address_HTTP
      || runtimeConfig.addressHttp
      || runtimeConfig.address_http
      || runtimeConfig.client_address
      || runtimeConfig.clientAddress
      || runtimeConfig.address
      || ''
    ).trim();
    const runtimeTcpAddress = String(
      runtimeConfig.address_TCP
      || runtimeConfig.addressTcp
      || runtimeConfig.address_tcp
      || ''
    ).trim();

    let tcpHost = '';
    let tcpPort = 0;
    if (runtimeTcpAddress) {
      try {
        const parsedUrl = new URL(runtimeTcpAddress.includes('://') ? runtimeTcpAddress : `tcp://${runtimeTcpAddress}`);
        tcpHost = String(parsedUrl.hostname || '').trim();
        tcpPort = Number.parseInt(parsedUrl.port, 10) || 0;
      } catch (_) {
        const stripped = runtimeTcpAddress.replace(/^tcp:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        const [hostPart, portPart] = stripped.split(':');
        tcpHost = String(hostPart || '').trim();
        tcpPort = Number.parseInt(portPart, 10) || 0;
      }
    }

    return {
      serverBase: runtimeServerBase,
      tcp: (tcpHost && Number.isFinite(tcpPort) && tcpPort > 0)
        ? { host: tcpHost, port: tcpPort }
        : null,
    };
  };

  ipcMain.handle('validate-key', async (_event, { key, device_id, manualProxyPreferred }) => {
    try {
      console.log('[验证] 开始验证卡密（HTTP）');
      console.log('[验证] 请求参数:', { key: key?.substring(0, 5) + '***', device_id });

      if (!httpClient) {
        return { ok: false, status: 0, error: '网络客户端不可用' };
      }

      const r = await httpClient.validateKey(key, device_id);
      if (r?.requestUrl) {
        writeDebugConsoleOnly('info', `[验证] HTTP请求地址: ${r.requestMethod || 'GET'} ${r.requestUrl}`);
      }
      console.log('[验证] HTTP响应摘要:', {
        ok: r?.ok === true,
        valid: r?.valid === true,
        state: r?.state || r?.status || '',
        expire_at: r?.expire_at || '',
        days_left: r?.days_left ?? null,
        account_type: r?.account_type || r?.accountType || '',
        transport_mode: r?.transportMode || 'http',
        request_url: r?.requestUrl || '',
      });

      const isValid = Object.prototype.hasOwnProperty.call(r || {}, 'valid')
        ? r?.valid === true
        : isValidationSuccess(r);

      if (isValid) {
        try {
          const verifiedResult = markVipServerVerified(r);
          const { normalizeValidationRuntimeConfig } = require('../../lib/http-client');
          const runtimeConfig = normalizeValidationRuntimeConfig(r);
          const runtimeConnection = resolveRuntimeConnectionConfig(runtimeConfig);

          setLicenseRuntimeConfig(licenseCache, runtimeConfig, {
            serverBase: runtimeConnection.serverBase,
          });
          if (typeof setRuntimeServerBase === 'function' && runtimeConnection.serverBase) {
            setRuntimeServerBase(runtimeConnection.serverBase);
          }
          if (typeof setRuntimeTcpConfig === 'function') {
            if (runtimeConnection.tcp) {
              setRuntimeTcpConfig({
                host: runtimeConnection.tcp.host,
                port: runtimeConnection.tcp.port,
                transport: {
                  preferred: 'tls',
                  allowHttpFallback: true,
                  allowPlainFallback: false,
                  tls: {
                    enabled: true,
                    rejectUnauthorized: false,
                  },
                },
              });
            } else {
              setRuntimeTcpConfig(null);
            }
          }
          const bindingInfo = normalizeLicenseBinding(r);
          if (licenseCache && typeof licenseCache.setValidationState === 'function') {
            licenseCache.setValidationState({
              key,
              deviceId: device_id,
              validated: true,
              bound: true,
              licenseValidated: true,
              result: verifiedResult,
              canSelfUnbind: bindingInfo.canSelfUnbind,
              remainingUnbindTimes: bindingInfo.remainingUnbindTimes,
              maxUnbindTimes: bindingInfo.maxUnbindTimes,
              usedUnbindTimes: bindingInfo.usedUnbindTimes,
              deviceBindCount: bindingInfo.deviceBindCount,
              maxDeviceCount: bindingInfo.maxDeviceCount,
              deviceBindingStatus: bindingInfo.deviceBindingStatus,
              deviceBindingSummary: bindingInfo.deviceBindingSummary,
              maxUsageTimes: bindingInfo.maxUsageTimes ?? r.max_usage_times ?? r.maxUsageTimes ?? null,
              usedUsageTimes: bindingInfo.usedUsageTimes ?? r.used_usage_times ?? r.usedUsageTimes ?? null,
              remainingUsageTimes: bindingInfo.remainingUsageTimes ?? r.remaining_usage_times ?? r.remainingUsageTimes ?? null,
              licenseUsage: r,
              accountType: r.accountType || r.account_type || '',
              accountTypeLabel: r.accountTypeLabel || r.account_type_label || '',
              currentAccountType: r.currentAccountType || r.current_account_type || '',
              currentAccountTypeLabel: r.currentAccountTypeLabel || r.current_account_type_label || '',
              message: r.message || r.msg || '',
            });
          }
          console.log('[验证] 卡密状态已写入运行时缓存');

          // 运行时地址和登录态一就绪就立即拉取公告，不等待账号清理、平台列表
          // 等其它登录后任务。这里不阻塞登录响应，拉取失败由轮询器继续重试。
          try {
            if (typeof refreshAnnouncements === 'function') {
              void Promise.resolve(refreshAnnouncements()).catch((announcementErr) => {
                console.warn('[验证] 获取服务器公告失败:', announcementErr?.message || announcementErr);
              });
            }
          } catch (announcementErr) {
            console.warn('[验证] 获取服务器公告失败:', announcementErr?.message || announcementErr);
          }

          try {
            if (typeof initializeAccountCleanup === 'function') {
              await initializeAccountCleanup(accountStorage, buildAccountCleanupOptions());
            }
          } catch (cleanupErr) {
            console.warn('[验证] 刷新账号回收定时器失败:', cleanupErr?.message || cleanupErr);
          }
          try {
            if (auth && typeof auth.saveLicenseUsageSnapshot === 'function') {
              const savedUsage = auth.saveLicenseUsageSnapshot({
                key,
                deviceId: device_id,
                source: r,
              });
              if (savedUsage) {
                console.log('[验证] 本地试用次数已同步:', savedUsage);
              }
            }
          } catch (usageErr) {
            console.warn('[验证] 保存本地试用次数失败:', usageErr?.message || usageErr);
          }

          try {
            if (typeof appendLicenseRecord === 'function') {
              appendLicenseRecord({
                key,
                status: 'success',
                platformName: String(r.platformName || r.platform || r.currentPlatformName || '').trim(),
              });
            }
          } catch (recordErr) {
            console.warn('[验证] 写入卡密历史失败:', recordErr?.message || recordErr);
          }

          try {
            persistSavedLicenseKeySafe({
              readStoreConfigSafe,
              writeStoreConfigSafe,
              licenseCache,
            }, key, device_id);
          } catch (persistErr) {
            console.warn('[验证] 保存最近使用卡密失败:', persistErr?.message || persistErr);
          }

          try {
            if (typeof refreshAllowedPlatformsAndNotify === 'function') {
              await refreshAllowedPlatformsAndNotify();
            }
          } catch (refreshErr) {
            console.warn('[验证] 刷新平台名称失败:', refreshErr?.message || refreshErr);
          }

        } catch (e) {
          console.warn('[验证] 保存凭证过程出错:', e?.message || e);
        }
      }
      if (!isValid) {
        return {
          ok: false,
          status: 200,
          error: getValidationFailureMessage(r, '卡密验证失败'),
          result: r,
        };
      }

      let mergedResult = r;
      try {
        if (auth && typeof auth.getStoredLicenseUsage === 'function') {
          const localUsage = auth.getStoredLicenseUsage(key, device_id);
          if (localUsage) {
            mergedResult = {
              ...r,
              ...localUsage,
            };
          }
        }
      } catch (usageErr) {
        console.warn('[验证] 读取本地试用次数失败:', usageErr?.message || usageErr);
      }

      try {
        if (manualProxyPreferred) {
          try { state.manualProxyPreferred = true; } catch (_) {}
          console.log('[验证] 用户已开启自定义代理模式，跳过内置代理自动启动');
          return { ok: true, status: 200, result: mergedResult, started: false, reason: 'manual_proxy_preferred' };
        }

        return { ok: true, status: 200, result: mergedResult, started: false, reason: 'proxy_removed' };
      } catch (e) {
        console.error('[验证] 处理失败:', e?.message || e);
        return { ok: true, status: 200, result: mergedResult, started: false, error: e?.message };
      }
    } catch (e) {
      console.error('[验证] 验证过程出错:', e.message);
      console.error('[验证] 错误堆栈:', e.stack);
      return { ok: false, status: 0, error: e.message };
    }
  });

  ipcMain.handle('unbind-device', async (_event, { key, device_id, deviceId }) => {
    try {
      const normalizedKey = String(key || '').trim();
      const normalizedDeviceId = String(device_id || deviceId || '').trim();
      if (!normalizedKey) {
        return { ok: false, message: '缺少卡密' };
      }
      if (!normalizedDeviceId) {
        return { ok: false, message: '缺少设备号' };
      }

      console.log('[解绑] 开始解绑设备:', {
        key: normalizedKey.substring(0, 5) + '***',
        deviceId: normalizedDeviceId.substring(0, 8) + '***',
      });

      let response = null;
      if (httpClient && typeof httpClient.unbindDevice === 'function') {
        response = await httpClient.unbindDevice(normalizedKey, normalizedDeviceId);
      } else if (ctx.http && typeof ctx.http.postJson === 'function') {
        const serverBase = getServerBase();
        if (!serverBase) {
          throw new Error('服务器地址未配置');
        }
        const url = serverBase.replace(/\/+$/, '') + '/api/unbind_device';
        const httpResp = await ctx.http.postJson(url, {
          key: normalizedKey,
          device_id: normalizedDeviceId,
          deviceId: normalizedDeviceId,
        });
        const body = httpResp.body && typeof httpResp.body === 'object' ? httpResp.body : {};
        response = { ok: httpResp.ok, status: httpResp.status, ...body };
      } else {
        throw new Error('解绑客户端不可用');
      }

      console.log('[解绑] 服务器响应:', response);

      if (!response?.ok) {
        return response || { ok: false, message: '解绑失败' };
      }

      try {
        if (licenseCache && typeof licenseCache.setUnboundState === 'function') {
          licenseCache.setUnboundState({
            key: normalizedKey,
            deviceId: normalizedDeviceId,
          });
        }
      } catch (storeErr) {
        console.warn('[解绑] 更新本地凭证状态失败:', storeErr?.message || storeErr);
      }

      return response;
    } catch (e) {
      console.error('[解绑] 解绑过程出错:', e?.message || e);
      return { ok: false, message: e?.message || '解绑失败' };
    }
  });

  ipcMain.handle('open-dream-page', async (_event, payload = {}) => {
    try {
      let {
        key,
        deviceId,
        accountId,
        serverPushedData,
        platform: requestedPlatform,
        platformName: requestedPlatformName,
        targetUrl: requestedTargetUrl,
      } = payload || {};

      key = String(key || '').trim();
      deviceId = String(deviceId || '').trim();
      accountId = String(accountId || '').trim();
      requestedPlatform = String(requestedPlatform || requestedPlatformName || '').trim();
      requestedTargetUrl = String(requestedTargetUrl || '').trim();

      let historicalAccount = null;
      let launchAccountId = accountId;
      let launchAccount = null;
      let launchCookies = [];
      let launchBrowserStorage = [];
      let restoreProfileOnly = false;
      let importedNewAccount = false;
      const sourceAccountIsPermanent = isPermanentDreamAccount(accountId, key);

      if (!key) throw new Error('缺少卡密');

      let targetUrl = requestedTargetUrl || resolveDreamTargetUrl();
      let platformName = requestedPlatform || resolveDreamWindowTitle(
        serverPushedData?.platform_name
        || serverPushedData?.platformName
        || serverPushedData?.platform
        || ''
      );
      console.log('[网页打开] 正在打开链接:', targetUrl);
      if (platformName) {
        console.log('[网页打开] 使用固定窗口名称:', platformName);
      }
      console.log('[网页打开] 使用卡密:', key.substring(0, 8) + '***');
      console.log('[网页打开] 使用设备ID:', deviceId);

      let fetchResult = null;
      let fetchedAccountId = '';
      let fetchedCookies = [];
      let fetchedBrowserStorage = [];

      try {
        fetchResult = await auth.fetchCookieFromServerForDream(key, deviceId, {
          platform: requestedPlatform || platformName,
          targetUrl,
        });
        platformName = String(fetchResult?.platform || fetchResult?.currentPlatform || platformName || '').trim();
        targetUrl = String(fetchResult?.currentUrl || fetchResult?.targetUrl || targetUrl || '').trim();
        fetchedCookies = Array.isArray(fetchResult.cookies) ? fetchResult.cookies : [];
        fetchedBrowserStorage = Array.isArray(fetchResult.browserStorage) ? fetchResult.browserStorage : [];
        fetchedAccountId = String(
          fetchResult.account
          || fetchResult.accountName
          || fetchResult.username
          || fetchResult.data?.account
          || fetchResult.result?.account
          || ''
        ).trim();
        console.log('[open-dream-page] 获取到cookies:', Array.isArray(fetchedCookies) ? `数组长度${fetchedCookies.length}` : typeof fetchedCookies);
        console.log('[open-dream-page] 服务器返回的账号:', fetchedAccountId);

        if (!fetchedAccountId) {
          throw new Error('服务器未返回账号ID，无法判断历史账号');
        }
      } catch (fetchErr) {
        if (sourceAccountIsPermanent && isUsageExhaustedFetchError(fetchErr)) {
          historicalAccount = resolveHistoricalDreamAccount(key, accountId, true, platformName);
          if (!historicalAccount) {
            const error = new Error('本地无账号');
            error.businessError = true;
            error.errorCode = 'ACCOUNT_EMPTY';
            throw error;
          }

          launchAccountId = String(historicalAccount.id || launchAccountId || '').trim();
          key = historicalAccount.key || key;
          deviceId = historicalAccount.deviceId || deviceId;
          launchAccount = historicalAccount;
          restoreProfileOnly = true;
          if (!hasPersistedDreamProfile(launchAccountId)) {
            const error = new Error('本地账号浏览器环境不存在');
            error.businessError = true;
            error.errorCode = 'ACCOUNT_PROFILE_EMPTY';
            throw error;
          }
          console.log('[open-dream-page] 绑定账号服务器次数已用尽，直接改用本地历史账号:', launchAccountId);
        } else {
          throw fetchErr;
        }
      }

      if (!launchAccount) {
        historicalAccount = resolveHistoricalDreamAccount(key, fetchedAccountId || accountId, sourceAccountIsPermanent, platformName);
        if (historicalAccount) {
          launchAccount = historicalAccount;
          launchAccountId = String(historicalAccount.id || launchAccountId || fetchedAccountId || '').trim();
          // 服务器入口只使用本次响应中的会话并直接注入 Chromium；
          // account_sessions 不再作为 Cookie/Storage 快照来源。
          launchCookies = fetchedCookies;
          launchBrowserStorage = fetchedBrowserStorage;
          if (fetchResult) {
            const updated = accountStorage.updateAccount(launchAccountId, {
              currentUrl: targetUrl,
              platform: fetchResult.platform || historicalAccount.platform,
              currentPlatform: fetchResult.currentPlatform || platformName || historicalAccount.currentPlatform,
              currentAccountType: fetchResult.currentAccountType,
              currentAccountTypeLabel: fetchResult.currentAccountTypeLabel,
              serverRecycleTime: fetchResult.serverRecycleTime,
              serverRecycleTimeTs: fetchResult.serverRecycleTimeTs,
              serverRecycleTimeIso: fetchResult.serverRecycleTimeIso,
            });
            if (updated?.ok && updated.account) launchAccount = updated.account;
          }
          console.log('[open-dream-page] 命中历史账号记录:', launchAccountId);
        }
      }

      const activeTab = launchAccountId ? findOpenDreamTab(launchAccountId) : null;
      if (activeTab && activeTab.id) {
        console.log('[open-dream-page] 历史账号页面已打开，直接切换标签页:', launchAccountId);
        if (typeof ui.switchTab === 'function') {
          try { ui.switchTab(activeTab.id); } catch (_) {}
        }
        if (launchAccountId) {
          accountStorage.updateLastUsedTime(launchAccountId);
          try { ui.sendToSide('account-list-updated', {}); } catch (_) {}
        }
        return { ok: true, tabId: activeTab.id, alreadyOpen: true, accountId: launchAccountId };
      }

      if (!launchAccount) {
        const importedAccount = await importServerFetchedDreamAccount({
          key,
          deviceId,
          fetchedAccountId,
          fetchResult,
          fetchedCookies,
          fetchedBrowserStorage,
          targetUrl,
        });
        launchAccount = importedAccount.account;
        importedNewAccount = true;
        launchAccountId = String(importedAccount.accountId || launchAccountId || fetchedAccountId || '').trim();
        launchCookies = Array.isArray(importedAccount.cookies) ? importedAccount.cookies : fetchedCookies;
        launchBrowserStorage = Array.isArray(importedAccount.browserStorage) ? importedAccount.browserStorage : fetchedBrowserStorage;

        console.log('[open-dream-page] 账号保存成功并改从历史账号启动:', launchAccountId);
        try { ui.sendToSide('account-list-updated', {}); } catch (_) {}
      } else {
        console.log('[open-dream-page] 使用历史账号启动:', launchAccount.id);
        accountStorage.updateLastUsedTime(launchAccount.id);
        try { ui.sendToSide('account-list-updated', {}); } catch (_) {}
      }
      updateAccountRecycleTimer(accountStorage, launchAccount, buildAccountCleanupOptions());

      if (!launchAccountId) {
        throw new Error('缺少可用账号ID');
      }
      // 服务器 Cookie 只负责首次创建 Profile。已经存在的账号环境必须优先
      // 恢复本地 Chromium 会话，否则每次服务器请求成功都会 clear-session，
      // 抹掉用户在浏览器中继续产生的登录状态和页面会话。
      const restorePersistedProfile = restoreProfileOnly
        || (!importedNewAccount && hasPersistedDreamProfile(launchAccountId));
      if (!launchAccount || (
        !restorePersistedProfile
        && (
          (!Array.isArray(launchCookies) || launchCookies.length === 0)
          && (!Array.isArray(launchBrowserStorage) || launchBrowserStorage.length === 0)
        )
      )) {
        throw new Error('本地无账号');
      }

      const browserName = String(
        platformName
        || launchAccount.currentPlatform
        || launchAccount.platform
        || launchAccount.accountName
        || launchAccountId
      ).trim();
      const tabId = await ui.addTab(targetUrl, {
        accountId: launchAccountId,
        fixedTitle: browserName,
        tabTitle: browserName,
        deferChromiumNavigation: !restorePersistedProfile,
        restoreLastSession: restorePersistedProfile,
      });
      if (restorePersistedProfile) {
        accountStorage.updateLastUsedTime(launchAccountId);
        try { ui.sendToSide?.('browser-history-changed'); } catch (_) {}
        return { ok: true, tabId, accountId: launchAccountId, restored: true };
      }
      try {
        try {
          await ui.browserRuntimeManager.navigate(tabId, 'chromium', targetUrl);
        } catch (navigationError) {
          const message = String(navigationError?.message || '');
          const deliveredButPending = ['NAVIGATION_TIMEOUT', 'RUNTIME_COMMAND_TIMEOUT'].includes(navigationError?.code)
            || (navigationError?.code === 'NAVIGATION_FAILED'
              && (/页面加载失败:\s*-3(?:\s|$)/.test(message) || /ERR_ABORTED/i.test(message)));
          if (!deliveredButPending) throw navigationError;
          console.warn('[open-dream-page] 目标页仍在加载或正在重定向，继续注入账号会话:', message);
        }
        const importResult = await ui.browserRuntimeManager.importSession(tabId, {
          cookies: launchCookies,
          browserStorage: launchBrowserStorage,
          targetUrl,
          // 账号专属浏览器已经按顺序完成创建、命名和目标页打开；这里只注入
          // 会话，随后刷新页面让后注入的 Cookie / Storage 立即生效。
          navigateAfterImport: false,
        });
        await ui.browserRuntimeManager.reload(tabId, 'chromium');
        console.log('[open-dream-page] 独立 Chromium Profile 会话导入完成:', {
          tabId,
          cookiesImported: importResult.cookiesImported,
          cookiesSkipped: importResult.cookiesSkipped,
          storageOriginsImported: importResult.storageOriginsImported,
          storageOriginsSkipped: importResult.storageOriginsSkipped,
        });
        try { ui.sendToSide?.('browser-history-changed'); } catch (_) {}
        return { ok: true, tabId };
      } catch (error) {
        console.warn('[open-dream-page] Chromium 会话导入失败，保留浏览器供用户重试:', error?.message || error);
        throw error;
      }
    } catch (e) {
      return { ok: false, message: e?.message || String(e) };
    }
  });

  ipcMain.handle('refresh-subscription-url', async () => {
    try {
      console.log('[刷新] 开始重新获取订阅链接...');

      if (!httpClient) {
        return { ok: false, error: 'TCP客户端不可用' };
      }

      let configResponse = null;
      try {
        const lastAccountResult = accountStorage.getLastUsedAccount();
        if (!lastAccountResult.ok || !lastAccountResult.account) {
          return { ok: false, error: '没有找到有效的账号信息，请先验证卡密' };
        }
        const { key, deviceId } = lastAccountResult.account;
        configResponse = await httpClient.getClientConfig(key, deviceId);
      } catch (e) {
        console.warn('[刷新] 获取配置失败:', e?.message || e);
        return { ok: false, error: '获取配置失败: ' + (e?.message || e) };
      }

      if (configResponse && configResponse.ok && configResponse.proxy_subscription_url) {
        const newSubscriptionUrl = configResponse.proxy_subscription_url;
        console.log('[刷新] 已更新订阅地址到内存中');
        return { ok: true, subscriptionUrl: newSubscriptionUrl };
      }

      console.warn('[刷新] 获取配置失败或响应格式不正确:', configResponse);
      return { ok: false, error: '获取配置失败或响应格式不正确' };
    } catch (e) {
      console.error('[刷新] 刷新订阅链接异常:', e.message);
      return { ok: false, error: e.message };
    }
  });

}

module.exports = { registerLicenseIPC };
