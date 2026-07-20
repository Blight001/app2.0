'use strict';

const { firstText } = require('../../../shared/safe-values');

function text(...values) {
  return firstText(...values).trim();
}

function notify(deps, channel, payload) {
  try {
    if (deps.ui && typeof deps.ui.sendToSide === 'function') deps.ui.sendToSide(channel, payload);
  } catch (_) {}
}

function normalizeRequest(deps, payload) {
  const input = payload || {};
  const platform = text(input.platform, input.platformName);
  const pushed = input.serverPushedData || {};
  return {
    key: text(input.key),
    deviceId: text(input.deviceId),
    requestedAccountId: text(input.accountId),
    platform,
    targetUrl: text(input.targetUrl, deps.resolveDreamTargetUrl()),
    platformName: platform || deps.support.resolveDreamWindowTitle(
      text(pushed.platform_name, pushed.platformName, pushed.platform),
    ),
    fetchResult: null,
    fetchedAccountId: '',
    fetchedCookies: [],
    fetchedBrowserStorage: [],
    launchAccountId: text(input.accountId),
    launchAccount: null,
    launchCookies: [],
    launchBrowserStorage: [],
    restoreProfileOnly: false,
    importedNewAccount: false,
  };
}

function fetchedAccountId(result) {
  const data = result && result.data || {};
  const nested = result && result.result || {};
  return text(
    result && result.account,
    result && result.accountName,
    result && result.username,
    data.account,
    nested.account,
  );
}

async function fetchServerAccount(deps, state) {
  const result = await deps.auth.fetchCookieFromServerForDream(state.key, state.deviceId, {
    platform: state.platform || state.platformName,
    targetUrl: state.targetUrl,
  });
  state.fetchResult = result;
  state.platformName = text(result.platform, result.currentPlatform, state.platformName);
  state.targetUrl = text(result.currentUrl, result.targetUrl, state.targetUrl);
  state.fetchedCookies = Array.isArray(result.cookies) ? result.cookies : [];
  state.fetchedBrowserStorage = Array.isArray(result.browserStorage) ? result.browserStorage : [];
  state.fetchedAccountId = fetchedAccountId(result);
  if (!state.fetchedAccountId) throw new Error('服务器未返回账号ID，无法判断历史账号');
}

function accountBusinessError(message, code) {
  return Object.assign(new Error(message), { businessError: true, errorCode: code });
}

function useHistoricalAccountAfterExhaustion(deps, state) {
  const account = deps.support.resolveHistoricalDreamAccount({
    key: state.key,
    accountId: state.requestedAccountId,
    requirePermanent: true,
    platform: state.platformName,
  });
  if (!account) throw accountBusinessError('本地无账号', 'ACCOUNT_EMPTY');
  state.launchAccount = account;
  state.launchAccountId = text(account.id, state.launchAccountId);
  state.key = account.key || state.key;
  state.deviceId = account.deviceId || state.deviceId;
  state.restoreProfileOnly = true;
  if (!deps.support.hasPersistedDreamProfile(state.launchAccountId)) {
    throw accountBusinessError('本地账号浏览器环境不存在', 'ACCOUNT_PROFILE_EMPTY');
  }
}

async function fetchOrRestore(deps, state, sourceIsPermanent) {
  try {
    await fetchServerAccount(deps, state);
  } catch (error) {
    if (!sourceIsPermanent || !deps.isUsageExhaustedFetchError(error)) throw error;
    useHistoricalAccountAfterExhaustion(deps, state);
  }
}

function updateHistoricalAccount(deps, state, historical) {
  const result = state.fetchResult;
  if (!result) return historical;
  const updated = deps.accountStorage.updateAccount(text(historical.id), {
    currentUrl: state.targetUrl,
    platform: result.platform || historical.platform,
    currentPlatform: result.currentPlatform || state.platformName || historical.currentPlatform,
    currentAccountType: result.currentAccountType,
    currentAccountTypeLabel: result.currentAccountTypeLabel,
    serverRecycleTime: result.serverRecycleTime,
    serverRecycleTimeTs: result.serverRecycleTimeTs,
    serverRecycleTimeIso: result.serverRecycleTimeIso,
  });
  return updated && updated.ok && updated.account ? updated.account : historical;
}

function resolveHistoricalLaunch(deps, state, sourceIsPermanent) {
  if (state.launchAccount) return;
  const historical = deps.support.resolveHistoricalDreamAccount({
    key: state.key,
    accountId: state.fetchedAccountId || state.requestedAccountId,
    requirePermanent: sourceIsPermanent,
    platform: state.platformName,
  });
  if (!historical) return;
  state.launchAccount = updateHistoricalAccount(deps, state, historical);
  state.launchAccountId = text(historical.id, state.launchAccountId, state.fetchedAccountId);
  state.launchCookies = state.fetchedCookies;
  state.launchBrowserStorage = state.fetchedBrowserStorage;
}

async function reuseOpenTab(deps, state) {
  const activeTab = state.launchAccountId
    ? deps.support.findOpenDreamTab(state.launchAccountId)
    : null;
  if (!activeTab || !activeTab.id) return null;
  if (deps.ui && typeof deps.ui.switchTab === 'function') {
    try { deps.ui.switchTab(activeTab.id); } catch (_) {}
  }
  await deps.support.navigateDreamTab(activeTab.id, state.targetUrl);
  if (state.launchAccountId) {
    deps.accountStorage.updateLastUsedTime(state.launchAccountId);
    notify(deps, 'account-list-updated', {});
  }
  return { ok: true, tabId: activeTab.id, alreadyOpen: true, accountId: state.launchAccountId };
}

function importFetchedAccount(deps, state) {
  const imported = deps.support.importServerFetchedDreamAccount({
    key: state.key,
    deviceId: state.deviceId,
    accountId: state.fetchedAccountId,
    fetchResult: state.fetchResult,
    cookies: state.fetchedCookies,
    browserStorage: state.fetchedBrowserStorage,
    targetUrl: state.targetUrl,
  });
  state.launchAccount = imported.account;
  state.importedNewAccount = true;
  state.launchAccountId = text(imported.accountId, state.launchAccountId, state.fetchedAccountId);
  state.launchCookies = Array.isArray(imported.cookies) ? imported.cookies : state.fetchedCookies;
  state.launchBrowserStorage = Array.isArray(imported.browserStorage)
    ? imported.browserStorage
    : state.fetchedBrowserStorage;
}

function finalizeLaunchAccount(deps, state) {
  if (!state.launchAccount) {
    importFetchedAccount(deps, state);
    notify(deps, 'account-list-updated', {});
  } else {
    deps.accountStorage.updateLastUsedTime(state.launchAccount.id);
    notify(deps, 'account-list-updated', {});
  }
  deps.updateAccountRecycleTimer(
    deps.accountStorage,
    state.launchAccount,
    deps.support.buildAccountCleanupOptions(),
  );
}

function shouldRestoreProfile(deps, state) {
  return state.restoreProfileOnly || (
    !state.importedNewAccount && deps.support.hasPersistedDreamProfile(state.launchAccountId)
  );
}

function validateLaunchState(state, restoreProfile) {
  if (!state.launchAccountId) throw new Error('缺少可用账号ID');
  if (!state.launchAccount) throw new Error('本地无账号');
  const hasCookies = Array.isArray(state.launchCookies) && state.launchCookies.length > 0;
  const hasStorage = Array.isArray(state.launchBrowserStorage) && state.launchBrowserStorage.length > 0;
  if (!restoreProfile && !hasCookies && !hasStorage) throw new Error('本地无账号');
}

function browserName(state) {
  const account = state.launchAccount;
  return text(
    state.platformName,
    account.currentPlatform,
    account.platform,
    account.accountName,
    state.launchAccountId,
  );
}

async function createDreamTab(deps, state, restoreProfile) {
  const tabId = await deps.ui.addTab(state.targetUrl, {
    accountId: state.launchAccountId,
    fixedTitle: browserName(state),
    tabTitle: browserName(state),
    deferChromiumNavigation: false,
    restoreLastSession: restoreProfile,
  });
  if (restoreProfile) {
    await deps.support.navigateDreamTab(tabId, state.targetUrl);
    deps.accountStorage.updateLastUsedTime(state.launchAccountId);
    notify(deps, 'browser-history-changed');
    return { ok: true, tabId, accountId: state.launchAccountId, restored: true };
  }
  await deps.support.navigateDreamTab(tabId, state.targetUrl);
  await deps.ui.browserRuntimeManager.importSession(tabId, {
    cookies: state.launchCookies,
    browserStorage: state.launchBrowserStorage,
    targetUrl: state.targetUrl,
    navigateAfterImport: false,
  });
  await deps.ui.browserRuntimeManager.reload(tabId, 'chromium');
  notify(deps, 'browser-history-changed');
  return { ok: true, tabId };
}

async function openDreamPage(deps, payload) {
  try {
    const state = normalizeRequest(deps, payload);
    if (!state.key) throw new Error('缺少卡密');
    const sourceIsPermanent = deps.support.isPermanentDreamAccount(
      state.requestedAccountId,
      state.key,
    );
    await fetchOrRestore(deps, state, sourceIsPermanent);
    resolveHistoricalLaunch(deps, state, sourceIsPermanent);
    const reused = await reuseOpenTab(deps, state);
    if (reused) return reused;
    finalizeLaunchAccount(deps, state);
    const restoreProfile = shouldRestoreProfile(deps, state);
    validateLaunchState(state, restoreProfile);
    return await createDreamTab(deps, state, restoreProfile);
  } catch (error) {
    return { ok: false, message: text(error && error.message, error) };
  }
}

function createOpenDreamPageHandler(deps) {
  return (_event, payload = {}) => openDreamPage(deps, payload);
}

module.exports = { createOpenDreamPageHandler };
