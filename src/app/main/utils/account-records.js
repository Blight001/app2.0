function resolveDreamTargetUrl(getDreamTargetUrl, fallbackUrl = '') {
  try {
    if (typeof getDreamTargetUrl === 'function') {
      const value = getDreamTargetUrl();
      if (value && typeof value === 'string') return value;
    }
  } catch (_) {}
  return fallbackUrl;
}

function getAccountTypeInfo(account) {
  if (!account || typeof account !== 'object') {
    return { type: '', label: '' };
  }
  return {
    type: String(
      account.currentAccountType
      || account.current_account_type
      || account.accountType
      || account.account_type
      || ''
    ).trim(),
    label: String(
      account.currentAccountTypeLabel
      || account.current_account_type_label
      || account.accountTypeLabel
      || account.account_type_label
      || ''
    ).trim(),
  };
}

function isPermanentAccountRecord(account, options = {}) {
  if (!account || typeof account !== 'object') return false;
  const includeProtected = options.includeProtected === true;
  if (includeProtected) {
    const storageType = String(account.storageType || account.storage_type || '').trim();
    if (storageType === 'custom' || account.cleanupProtected === true) {
      return true;
    }
  }

  const { type, label } = getAccountTypeInfo(account);
  return type === 'one_time' || label.includes('永久') || label.includes('长久');
}

function findAccountRecord(accountStorage, options = {}) {
  if (!accountStorage) return null;
  const normalizedAccountId = String(options.accountId || '').trim();
  const normalizedKey = String(options.key || '').trim();

  try {
    if (normalizedAccountId && typeof accountStorage.getAccount === 'function') {
      const accountResult = accountStorage.getAccount(normalizedAccountId);
      if (accountResult && accountResult.ok && accountResult.account) {
        return accountResult.account;
      }
    }

    if (!normalizedKey || typeof accountStorage.getAllAccounts !== 'function' || typeof accountStorage.getAccount !== 'function') {
      return null;
    }

    const accountSummariesRaw = accountStorage.getAllAccounts();
    const accountSummaries = Array.isArray(accountSummariesRaw) ? accountSummariesRaw : [];
    for (const summary of accountSummaries) {
      const accountId = String(summary?.id || '').trim();
      if (!accountId) continue;
      const accountResult = accountStorage.getAccount(accountId);
      if (!accountResult || accountResult.ok !== true || !accountResult.account) continue;
      const account = accountResult.account;
      if (String(account.key || '').trim() === normalizedKey) {
        return account;
      }
    }
  } catch (_) {
    return null;
  }

  return null;
}

function findPermanentAccountByKey(accountStorage, key, options = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey || !accountStorage) return null;

  try {
    const accountSummariesRaw = typeof accountStorage.getAllAccounts === 'function'
      ? accountStorage.getAllAccounts()
      : [];
    const accountSummaries = Array.isArray(accountSummariesRaw) ? accountSummariesRaw : [];
    for (const summary of accountSummaries) {
      const accountId = String(summary?.id || '').trim();
      if (!accountId) continue;
      const accountResult = accountStorage.getAccount(accountId);
      if (!accountResult || accountResult.ok !== true || !accountResult.account) continue;
      const account = accountResult.account;
      if (String(account.key || '').trim() !== normalizedKey) continue;
      if (isPermanentAccountRecord(account, options)) {
        return account;
      }
    }
  } catch (error) {
    const logger = options.logger;
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[IPC] 查找永久账号失败:', error?.message || error);
    }
  }

  return null;
}

module.exports = {
  findAccountRecord,
  findPermanentAccountByKey,
  isPermanentAccountRecord,
  resolveDreamTargetUrl,
};
