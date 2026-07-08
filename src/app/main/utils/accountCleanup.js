// 基于服务器回收时间的账号删除调度

const {
  normalizePositiveNumber,
  normalizeTimeValueToMs,
} = require('./normalizers');

let recycleTimers = new Map();

const MAX_TIMEOUT_MS = 2147483647;

// 获取/读取/解析：resolveRecycleTimestamp的具体业务逻辑。
function resolveRecycleTimestamp(account) {
  if (!account || typeof account !== 'object') return null;
  const explicitValues = [
    account.serverRecycleTimeTs,
    account.serverRecycleTime,
    account.serverRecycleTimeIso,
    account.server_recycle_time,
    account.serverRecycleAt,
    account.next_refresh_at,
    account.nextRefreshAt,
    account.refresh_info?.next_refresh_at,
    account.refresh_info?.nextRefreshAt,
    account.refreshInfo?.next_refresh_at,
    account.refreshInfo?.nextRefreshAt
  ];

  for (const value of explicitValues) {
    const ts = normalizeTimeValueToMs(value);
    if (ts) return ts;
  }

  const remainingSeconds = normalizePositiveNumber(
    account.remaining_seconds
    ?? account.remainingSeconds
    ?? account.refresh_info?.remaining_seconds
    ?? account.refresh_info?.remainingSeconds
    ?? account.refreshInfo?.remaining_seconds
    ?? account.refreshInfo?.remainingSeconds
  );
  if (remainingSeconds) {
    return Date.now() + Math.floor(remainingSeconds * 1000);
  }

  const remainingMinutes = normalizePositiveNumber(
    account.remaining_minutes
    ?? account.remainingMinutes
    ?? account.refresh_info?.remaining_minutes
    ?? account.refresh_info?.remainingMinutes
    ?? account.refreshInfo?.remaining_minutes
    ?? account.refreshInfo?.remainingMinutes
  );
  if (remainingMinutes) {
    return Date.now() + Math.floor(remainingMinutes * 60 * 1000);
  }

  const fallbackValues = [
    account.aiAccountExpiryTime,
    account.ai_account_expiry_time
  ];

  for (const value of fallbackValues) {
    const ts = normalizeTimeValueToMs(value);
    if (ts) return ts;
  }
  return null;
}

// 处理：isTemporaryAccount的具体业务逻辑。
function isTemporaryAccount(account) {
  if (!account || typeof account !== 'object') return false;
  if (String(account.currentAccountType || '').trim() === 'one_time') return false;
  if (account.cleanupProtected === true && !resolveRecycleTimestamp(account)) return false;
  return true;
}

// 停止/关闭/清理：clearRecycleTimer的具体业务逻辑。
function clearRecycleTimer(accountId) {
  const normalizedId = String(accountId || '').trim();
  if (!normalizedId) return;

  const timer = recycleTimers.get(normalizedId);
  if (timer) {
    clearTimeout(timer);
    recycleTimers.delete(normalizedId);
  }
}

// 处理：notifyAccountListUpdated的具体业务逻辑。
function notifyAccountListUpdated(options = {}) {
  const sendToSide = options && typeof options.sendToSide === 'function' ? options.sendToSide : null;
  if (!sendToSide) return;
  try {
    sendToSide('account-list-updated', {});
  } catch (_) {}
}

// 移除/删除：deleteAccountNow的具体业务逻辑。
function deleteAccountNow(accountStorage, accountId, options = {}) {
  clearRecycleTimer(accountId);

  if (!accountStorage || typeof accountStorage.deleteAccount !== 'function') {
    return false;
  }

  try {
    const result = accountStorage.deleteAccount(accountId);
    if (result && result.ok) {
      console.log(`[AccountCleanup] 已删除到期账号: ${accountId}`);
      notifyAccountListUpdated(options);
      return true;
    }

    if (result && result.error) {
      console.warn(`[AccountCleanup] 删除账号失败(${accountId}):`, result.error);
    }
    return false;
  } catch (e) {
    console.error('[AccountCleanup] 删除到期账号失败:', e?.message || e);
    return false;
  }
}

// 处理：scheduleAccountDeletion的具体业务逻辑。
function scheduleAccountDeletion(accountStorage, account, options = {}) {
  if (!account || typeof account !== 'object') return false;

  const accountId = String(account.id || '').trim();
  if (!accountId) return false;

  clearRecycleTimer(accountId);

  if (!isTemporaryAccount(account)) {
    return false;
  }

  const recycleAt = resolveRecycleTimestamp(account);
  if (!recycleAt) {
    return false;
  }

  const delayMs = recycleAt - Date.now();
  if (delayMs <= 0) {
    return deleteAccountNow(accountStorage, accountId, options);
  }

  const timeoutMs = Math.min(delayMs, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    recycleTimers.delete(accountId);

    if (timeoutMs < delayMs) {
      const latest = accountStorage && typeof accountStorage.getAccount === 'function'
        ? accountStorage.getAccount(accountId)
        : null;
      if (latest && latest.ok && latest.account) {
        scheduleAccountDeletion(accountStorage, latest.account, options);
      }
      return;
    }

    const latest = accountStorage && typeof accountStorage.getAccount === 'function'
      ? accountStorage.getAccount(accountId)
      : null;

    if (!latest || !latest.ok || !latest.account) {
      return;
    }

    const latestRecycleAt = resolveRecycleTimestamp(latest.account);
    if (!latestRecycleAt) {
      return;
    }

    if (latestRecycleAt > Date.now()) {
      scheduleAccountDeletion(accountStorage, latest.account, options);
      return;
    }

    deleteAccountNow(accountStorage, accountId, options);
  }, timeoutMs);

  recycleTimers.set(accountId, timer);
  console.log(`[AccountCleanup] 已为账号 ${accountId} 设置回收定时器，剩余 ${Math.ceil(delayMs / 1000)} 秒`);
  return true;
}

// 渲染/刷新：refreshAccountRecycleTimers的具体业务逻辑。
function refreshAccountRecycleTimers(accountStorage, options = {}) {
  if (!accountStorage || typeof accountStorage.getAllAccounts !== 'function') {
    return { scheduled: 0, removed: 0 };
  }

  const accounts = accountStorage.getAllAccounts() || [];
  const seenIds = new Set();
  let scheduled = 0;
  let removed = 0;

  for (const account of accounts) {
    const accountId = String(account && account.id ? account.id : '').trim();
    if (!accountId) continue;
    seenIds.add(accountId);

    if (!isTemporaryAccount(account)) {
      clearRecycleTimer(accountId);
      continue;
    }

    const recycleAt = resolveRecycleTimestamp(account);
    if (!recycleAt) {
      clearRecycleTimer(accountId);
      continue;
    }

    if (recycleAt <= Date.now()) {
      const deleted = deleteAccountNow(accountStorage, accountId, options);
      if (deleted) {
        removed += 1;
      }
      continue;
    }

    if (scheduleAccountDeletion(accountStorage, account, options)) {
      scheduled += 1;
    }
  }

  for (const accountId of Array.from(recycleTimers.keys())) {
    if (!seenIds.has(accountId)) {
      clearRecycleTimer(accountId);
    }
  }

  return { scheduled, removed };
}

// 创建/初始化：initializeAccountCleanup的具体业务逻辑。
function initializeAccountCleanup(accountStorage, options = {}) {
  const result = refreshAccountRecycleTimers(accountStorage, options);
  console.log('[AccountCleanup] 服务器回收定时器已刷新:', result);
  return result;
}

// 设置/更新/持久化：updateAccountRecycleTimer的具体业务逻辑。
function updateAccountRecycleTimer(accountStorage, accountOrId, options = {}) {
  if (!accountStorage) return false;

  const account = typeof accountOrId === 'object' && accountOrId !== null
    ? accountOrId
    : (typeof accountStorage.getAccount === 'function'
      ? (accountStorage.getAccount(accountOrId)?.account || null)
      : null);

  if (!account) {
    clearRecycleTimer(accountOrId);
    return false;
  }

  return scheduleAccountDeletion(accountStorage, account, options);
}

// 停止/关闭/清理：stopAccountCleanup的具体业务逻辑。
function stopAccountCleanup() {
  for (const timer of recycleTimers.values()) {
    clearTimeout(timer);
  }
  recycleTimers.clear();
}

module.exports = {
  initializeAccountCleanup,
  updateAccountRecycleTimer,
  refreshAccountRecycleTimers,
  stopAccountCleanup,
  clearRecycleTimer,
  resolveRecycleTimestamp,
};
