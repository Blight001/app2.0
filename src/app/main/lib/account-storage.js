// 账号存储模块：整合凭证存储和会话存储
const fs = require('fs');
const path = require('path');
const { getCoreDir, getStorePath } = require('../config');
const sessionStorage = require('./session-storage');
const {
  getCurrentAccountTypeLabel,
  resolveCurrentAccountType,
} = require('../utils/normalizers');

let runtimeLicenseCache = null;
let storageInitialized = false;
let accountsCache = null;

// 账号记录全部来自 JSON，可安全复制后交给调用方，避免排序或修改数组时污染缓存。
function cloneAccount(account) {
  if (!account || typeof account !== 'object') return account;
  return JSON.parse(JSON.stringify(account));
}

function cloneAccounts(accounts) {
  return Array.isArray(accounts) ? accounts.map(cloneAccount) : [];
}

function upsertCachedAccount(account) {
  if (!Array.isArray(accountsCache) || !account?.id) return;
  const nextAccount = cloneAccount(account);
  // Cookie/Storage 只允许在服务器响应到 Chromium 注入之间短暂存在，
  // 账号索引缓存同样只保存元数据。
  nextAccount.cookies = [];
  nextAccount.browserStorage = [];
  const index = accountsCache.findIndex((item) => item.id === nextAccount.id);
  if (index >= 0) accountsCache[index] = nextAccount;
  else accountsCache.push(nextAccount);
}

function removeCachedAccount(accountId) {
  if (!Array.isArray(accountsCache)) return;
  const normalizedId = String(accountId || '').trim();
  accountsCache = accountsCache.filter((item) => String(item?.id || '').trim() !== normalizedId);
}

// 设置/更新/持久化：setLicenseCache的具体业务逻辑。
function setLicenseCache(next) {
  runtimeLicenseCache = next || null;
}

// 处理：isPermanentAccountRecord的具体业务逻辑。
function isPermanentAccountRecord(account) {
  const currentAccountType = resolveCurrentAccountType(account?.currentAccountType, account?.currentAccountTypeLabel);
  return currentAccountType === 'one_time';
}

// 从分离的存储模块读取完整账号信息（全局凭证+会话合并）
function loadAccountFromFile(accountId) {
  try {
    const session = sessionStorage.loadSession(accountId);

    // 如果没有会话数据，说明账号不存在
    if (!session) {
      return null;
    }

    // 从 store/content 获取 key 和 deviceId
    let globalCredentials = { key: '' };
    try {
      if (runtimeLicenseCache && typeof runtimeLicenseCache.getCredentials === 'function') {
        globalCredentials = runtimeLicenseCache.getCredentials() || { key: '' };
      }
    } catch (e) {
      console.error('[AccountStorage] 读取运行时缓存失败:', e?.message || e);
    }

// 获取/读取/解析：resolvedKey的具体业务逻辑。
    const resolvedKey = (session && session.key) ? session.key : (globalCredentials ? globalCredentials.key : '');
// 获取/读取/解析：resolvedDeviceId的具体业务逻辑。
    const resolvedDeviceId = (session && session.deviceId) ? session.deviceId : (globalCredentials ? globalCredentials.deviceId : '');
    const resolvedPlatform = String(session.platform || '').trim();
    const resolvedCurrentPlatform = String(session.currentPlatform || '').trim();
    const resolvedCurrentUrl = String(session.currentUrl || '').trim();
    const resolvedAccount = String(session.account || session.accountName || '').trim();
    const currentAccountType = resolveCurrentAccountType(session.currentAccountType, session.currentAccountTypeLabel)
      || ((session.cleanupProtected === true || session.storageType === 'custom') ? 'one_time' : '');
    const currentAccountTypeLabel = String(session.currentAccountTypeLabel || '').trim()
      || (currentAccountType === 'one_time' && session.storageType === 'custom'
        ? '绑定账号'
        : getCurrentAccountTypeLabel(currentAccountType));
    const isPermanentAccount = currentAccountType === 'one_time'
      || (currentAccountType !== 'shared' && (session.cleanupProtected === true || session.storageType === 'custom' || isPermanentAccountRecord(session)));

    return {
      id: accountId,
      key: resolvedKey,
      deviceId: resolvedDeviceId,
      account: resolvedAccount,
      platform: resolvedPlatform,
      accountName: resolvedAccount,
      storageType: session.storageType || 'server',
      storageGroup: session.storageGroup || '',
      storageGroupLabel: session.storageGroupLabel || (isPermanentAccount ? '绑定账号分组' : '临时账号分组'),
      cleanupProtected: currentAccountType === 'one_time'
        ? true
        : (currentAccountType === 'shared' ? false : session.cleanupProtected === true),
      currentAccountType,
      currentAccountTypeLabel,
      current_account_type: currentAccountType,
      current_account_type_label: currentAccountTypeLabel,
      cookies: session.cookies || [],
      browserStorage: session.browserStorage || [],
      lastUsedAt: session.lastUsedAt || null,
      serverRecycleTime: session.serverRecycleTime || '',
      serverRecycleTimeTs: session.serverRecycleTimeTs ?? null,
      serverRecycleTimeIso: session.serverRecycleTimeIso || '',
      currentPlatform: resolvedCurrentPlatform,
      currentUrl: resolvedCurrentUrl
    };
  } catch (e) {
    console.error('[AccountStorage] 读取账号信息失败:', e?.message || e);
    return null;
  }
}

// 从 cookies 中提取账号名称
function extractAccountNameFromCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return null;
  }

  // 常见的账号相关 cookie 名称
  const accountCookieNames = [
    'username', 'user_name', 'userName', 'user-name',
    'email', 'user_email', 'userEmail', 'user-email',
    'account', 'account_name', 'accountName', 'account-name',
    'name', 'display_name', 'displayName', 'display-name',
    'nickname', 'nick_name', 'nickName', 'nick-name',
    'user', 'user_id', 'userId', 'user-id',
  ];

  // 优先查找账号相关的 cookie
  for (const cookieName of accountCookieNames) {
    const cookie = cookies.find(c => c && c.name && c.name.toLowerCase() === cookieName.toLowerCase());
    if (cookie && cookie.value) {
      return cookie.value;
    }
  }

  // 如果没找到，尝试从其他 cookie 中查找（可能是 JSON 格式）
  for (const cookie of cookies) {
    if (cookie && cookie.value) {
      try {
        // 尝试解析 JSON
        const parsed = JSON.parse(cookie.value);
        if (parsed && typeof parsed === 'object') {
          for (const key of accountCookieNames) {
            if (parsed[key] && typeof parsed[key] === 'string') {
              return parsed[key];
            }
          }
        }
      } catch (_) {
        // 不是 JSON，继续
      }
    }
  }

  return null;
}

// 初始化存储目录
function initStorageDirs() {
  if (storageInitialized) return;

  try {
    const storePath = getStorePath();
    console.log('[AccountStorage] 用户凭证存储路径:', storePath);
    console.log('[AccountStorage] 会话数据目录路径:', sessionStorage.getSessionsDir());

    // 每次进程启动只检查一次旧数据迁移；账号列表刷新不应重复初始化。
    migrateFromOldStorage();
    storageInitialized = true;
  } catch (e) {
    console.error('[AccountStorage] 初始化存储目录失败:', e?.message || e);
  }
}

// 从旧的 saved_accounts.json 迁移数据到新的 store/content 存储结构
function migrateFromOldStorage() {
  try {
    const coreDir = getCoreDir();
    const storePath = getStorePath();
    const oldAccountsFile = path.join(coreDir, 'saved_accounts.json');
    if (!fs.existsSync(oldAccountsFile)) {
      return; // 没有旧文件需要迁移
    }

    console.log('[AccountStorage] 发现旧的账号文件，正在迁移数据到新的 store/content 存储结构...');

    const content = fs.readFileSync(oldAccountsFile, 'utf8');
    const oldAccounts = JSON.parse(content);

    if (!Array.isArray(oldAccounts) || oldAccounts.length === 0) {
      console.log('[AccountStorage] 旧账号文件为空，跳过迁移');
      return;
    }

    let migratedCount = 0;
    let globalCredentials = null;

    for (const oldAccount of oldAccounts) {
      if (oldAccount.id && oldAccount.key && oldAccount.deviceId) {
        // 保存用户凭证到 store/content（只保存一次）
        if (!globalCredentials) {
          globalCredentials = {
            key: oldAccount.key,
            deviceId: oldAccount.deviceId
          };
          try {
            if (runtimeLicenseCache && typeof runtimeLicenseCache.setCredentials === 'function') {
              runtimeLicenseCache.setCredentials({ key: oldAccount.key, deviceId: oldAccount.deviceId });
            }
            console.log('[AccountStorage] 用户凭证已迁移到运行时缓存');
          } catch (e) {
            console.error('[AccountStorage] 保存用户凭证到运行时缓存失败:', e?.message || e);
            continue;
          }
        }

        // 保存会话数据
        const sessionSaved = sessionStorage.saveSession(oldAccount.id, {
          storageType: 'server',
          cleanupProtected: false
        });

        if (sessionSaved) {
          migratedCount++;
        }
      }
    }

    if (migratedCount > 0) {
      console.log(`[AccountStorage] 成功迁移 ${migratedCount} 个账号到新的全局凭证存储系统`);

      // 备份旧文件并删除
      const backupPath = oldAccountsFile + '.backup';
      fs.copyFileSync(oldAccountsFile, backupPath);
      fs.unlinkSync(oldAccountsFile);
      console.log('[AccountStorage] 已备份旧文件并删除:', backupPath);
    }
  } catch (e) {
    console.error('[AccountStorage] 迁移旧数据失败:', e?.message || e);
  }
}

// 读取所有账号（基于会话文件）
function loadAccounts() {
  try {
    initStorageDirs();

    if (Array.isArray(accountsCache)) {
      return cloneAccounts(accountsCache);
    }

    // 获取所有会话ID
    const accountIds = sessionStorage.getAllSessionIds();

    // 为每个账号ID加载完整的账号信息
    const accounts = [];
    for (const accountId of accountIds) {
      const accountInfo = loadAccountFromFile(accountId);
      if (accountInfo) {
        accounts.push(accountInfo);
      }
    }

    accountsCache = cloneAccounts(accounts);
    console.log(`[AccountStorage] 首次加载了 ${accounts.length} 个账号，后续读取使用内存缓存`);
    return cloneAccounts(accountsCache);
  } catch (e) {
    console.error('[AccountStorage] 读取账号失败:', e?.message || e);
    return [];
  }
}


// 添加账号
function addAccount(accountData) {
  try {
    const {
      cookies,
      browserStorage,
      accountName,
      account: inputAccount,
      platform: inputPlatform,
      currentPlatform: inputCurrentPlatform,
      currentUrl: inputCurrentUrl,
      accountId: providedAccountId,
      key: inputKey,
      deviceId: inputDeviceId,
      storageType: inputStorageType,
      storageGroup: inputStorageGroup,
      storageGroupLabel: inputStorageGroupLabel,
      cleanupProtected: inputCleanupProtected,
      currentAccountType: inputCurrentAccountType,
      currentAccountTypeLabel: inputCurrentAccountTypeLabel,
      current_account_type: inputCurrentAccountTypeSnake,
      current_account_type_label: inputCurrentAccountTypeLabelSnake,
      serverRecycleTime: inputServerRecycleTime,
      serverRecycleTimeTs: inputServerRecycleTimeTs,
      serverRecycleTimeIso: inputServerRecycleTimeIso,
      server_recycle_time: inputServerRecycleTimeSnake,
      ai_account_expiry_time: inputAiAccountExpiryTime,
      aiAccountExpiryTime: inputAiAccountExpiryTimeCamel,
    } = accountData;

    // cookies 可以为空数组，后续可以更新
    const finalCookies = cookies || [];

    // 使用提供的账号ID，如果没有提供则生成纯时间戳ID，便于排序和管理
    const accountId = providedAccountId || Date.now().toString();

    // 获取用户凭证信息（优先使用传入的凭证，其次从 store/content 读取）
    let finalKey = inputKey || '';
    let finalDeviceId = inputDeviceId || '';

    // 如果传入的凭证无效，从 store/content 读取
    if (!finalKey || !finalDeviceId || finalDeviceId === 'unknown') {
      try {
        const globalCredentials = runtimeLicenseCache && typeof runtimeLicenseCache.getCredentials === 'function'
          ? runtimeLicenseCache.getCredentials()
          : { key: '' };
        // 只有当传入的凭证无效时，才使用 store/content 中的凭证
        if (!finalKey && globalCredentials.key) {
          finalKey = globalCredentials.key;
        }
      } catch (e) {
        console.error('[AccountStorage] 读取运行时缓存失败:', e?.message || e);
      }
    }

    const resolvedAccountName = accountName || inputAccount || extractAccountNameFromCookies(finalCookies) || '';
    const resolvedAccount = String(inputAccount || accountName || resolvedAccountName || '').trim();
    const resolvedPlatform = String(inputPlatform || '').trim();
    const resolvedCurrentPlatform = String(inputCurrentPlatform || '').trim();
    const resolvedCurrentUrl = String(inputCurrentUrl || '').trim();
    const resolvedStorageType = inputStorageType === 'custom' ? 'custom' : 'server';
    const resolvedStorageGroup = String(inputStorageGroup || '').trim();
    const resolvedStorageGroupLabel = String(inputStorageGroupLabel || '').trim();
    const rawCurrentAccountType = inputCurrentAccountType !== undefined && inputCurrentAccountType !== null && String(inputCurrentAccountType).trim() !== ''
      ? inputCurrentAccountType
      : inputCurrentAccountTypeSnake;
    const rawCurrentAccountTypeLabel = String(
      inputCurrentAccountTypeLabel !== undefined && inputCurrentAccountTypeLabel !== null
        ? inputCurrentAccountTypeLabel
        : (inputCurrentAccountTypeLabelSnake !== undefined ? inputCurrentAccountTypeLabelSnake : '')
    ).trim();
    const resolvedCurrentAccountType = resolveCurrentAccountType(rawCurrentAccountType, rawCurrentAccountTypeLabel);
    const resolvedCurrentAccountTypeLabel = rawCurrentAccountTypeLabel || getCurrentAccountTypeLabel(resolvedCurrentAccountType);
    const resolvedCleanupProtected = resolvedCurrentAccountType
      ? resolvedCurrentAccountType === 'one_time'
      : (inputCleanupProtected === true || resolvedStorageType === 'custom');
    const resolvedServerRecycleTime = inputServerRecycleTime !== undefined
      ? inputServerRecycleTime
      : (inputServerRecycleTimeSnake !== undefined
        ? inputServerRecycleTimeSnake
        : (inputAiAccountExpiryTimeCamel !== undefined
          ? inputAiAccountExpiryTimeCamel
          : inputAiAccountExpiryTime));
    const resolvedServerRecycleTimeTs = inputServerRecycleTimeTs !== undefined ? inputServerRecycleTimeTs : null;
    const resolvedServerRecycleTimeIso = inputServerRecycleTimeIso !== undefined ? inputServerRecycleTimeIso : '';

    // account_sessions 只保存元数据；Cookie/Storage 由返回值直接交给 Chromium 注入。
    const lastUsedAt = new Date().toISOString();
    const sessionSaved = sessionStorage.saveSession(accountId, {
      lastUsedAt: lastUsedAt,
      account: resolvedAccount,
      accountName: resolvedAccountName,
      platform: resolvedPlatform,
      currentPlatform: resolvedCurrentPlatform,
      currentUrl: resolvedCurrentUrl,
      storageType: resolvedStorageType,
      storageGroup: resolvedStorageGroup,
      storageGroupLabel: resolvedStorageGroupLabel,
      cleanupProtected: resolvedCleanupProtected,
      currentAccountType: resolvedCurrentAccountType,
      currentAccountTypeLabel: resolvedCurrentAccountTypeLabel,
      serverRecycleTime: resolvedServerRecycleTime,
      serverRecycleTimeTs: resolvedServerRecycleTimeTs,
      serverRecycleTimeIso: resolvedServerRecycleTimeIso
    });

    if (!sessionSaved) {
      console.error('[AccountStorage] 账号保存失败:', accountId);
      return { ok: false, error: '保存账号失败' };
    }

    console.log('[AccountStorage] 添加账号成功:', { id: accountId, hasKey: !!finalKey, hasDeviceId: !!finalDeviceId && finalDeviceId !== 'unknown' });
    const savedAccount = {
      id: accountId,
      key: finalKey,
      deviceId: finalDeviceId,
      account: resolvedAccount,
      cookies: [],
      browserStorage: [],
      accountName: resolvedAccountName,
      platform: resolvedPlatform,
      currentPlatform: resolvedCurrentPlatform,
      currentUrl: resolvedCurrentUrl,
      storageType: resolvedStorageType,
      storageGroup: resolvedStorageGroup,
      storageGroupLabel: resolvedStorageGroupLabel,
      cleanupProtected: resolvedCleanupProtected,
      currentAccountType: resolvedCurrentAccountType,
      currentAccountTypeLabel: resolvedCurrentAccountTypeLabel,
      current_account_type: resolvedCurrentAccountType,
      current_account_type_label: resolvedCurrentAccountTypeLabel,
      lastUsedAt,
      serverRecycleTime: resolvedServerRecycleTime,
      serverRecycleTimeTs: resolvedServerRecycleTimeTs,
      serverRecycleTimeIso: resolvedServerRecycleTimeIso
    };
    upsertCachedAccount(savedAccount);
    return {
      ok: true,
      account: cloneAccount(savedAccount)
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 更新账号
function updateAccount(accountId, updates) {
  try {
    // 检查账号是否存在
    const existingAccount = loadAccountFromFile(accountId);
    if (!existingAccount) {
      return { ok: false, error: '账号不存在' };
    }

    // Cookie/Storage 参数只用于兼容调用方，不会写入 account_sessions。
    const {
      cookies,
      browserStorage,
      key,
      deviceId,
      accountName,
      platform,
      currentPlatform,
      currentUrl,
      storageType,
      storageGroup,
      storageGroupLabel,
      cleanupProtected,
      currentAccountType,
      currentAccountTypeLabel,
      current_account_type,
      current_account_type_label,
      serverRecycleTime,
      serverRecycleTimeTs,
      serverRecycleTimeIso,
      server_recycle_time,
      ai_account_expiry_time,
      aiAccountExpiryTime,
    } = updates;

    if (cookies !== undefined || browserStorage !== undefined || key !== undefined || deviceId !== undefined || accountName !== undefined || platform !== undefined || currentPlatform !== undefined || currentUrl !== undefined || storageType !== undefined || storageGroup !== undefined || storageGroupLabel !== undefined || cleanupProtected !== undefined || currentAccountType !== undefined || currentAccountTypeLabel !== undefined || current_account_type !== undefined || current_account_type_label !== undefined || serverRecycleTime !== undefined || serverRecycleTimeTs !== undefined || serverRecycleTimeIso !== undefined || server_recycle_time !== undefined || ai_account_expiry_time !== undefined || aiAccountExpiryTime !== undefined) {
      const sessionUpdates = {
        account: accountName,
        platform: platform,
        currentPlatform: currentPlatform,
        currentUrl: currentUrl,
        storageType: storageType,
        storageGroup: storageGroup,
        storageGroupLabel: storageGroupLabel,
        cleanupProtected: cleanupProtected,
        currentAccountType: currentAccountType !== undefined ? currentAccountType : current_account_type,
        currentAccountTypeLabel: currentAccountTypeLabel !== undefined ? currentAccountTypeLabel : current_account_type_label,
        serverRecycleTime: serverRecycleTime !== undefined ? serverRecycleTime : (server_recycle_time !== undefined ? server_recycle_time : (aiAccountExpiryTime !== undefined ? aiAccountExpiryTime : ai_account_expiry_time)),
        serverRecycleTimeTs: serverRecycleTimeTs !== undefined ? serverRecycleTimeTs : undefined,
        serverRecycleTimeIso: serverRecycleTimeIso !== undefined ? serverRecycleTimeIso : undefined,
        lastUsedAt: new Date().toISOString()
      };
      const sessionUpdated = sessionStorage.saveSession(accountId, sessionUpdates);

      if (!sessionUpdated) {
        return { ok: false, error: '保存账号更新失败' };
      }
    }

    // 返回更新后的完整账号信息
    const updatedAccount = loadAccountFromFile(accountId);
    upsertCachedAccount(updatedAccount);
    return { ok: true, account: cloneAccount(updatedAccount) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 删除账号
function deleteAccount(accountId) {
  try {
    const existingAccount = loadAccountFromFile(accountId);
    if (!existingAccount) {
      return { ok: false, error: '账号不存在' };
    }

    const deleted = sessionStorage.deleteSession(accountId);
    if (!deleted) {
      return { ok: false, error: '删除账号失败' };
    }

    removeCachedAccount(accountId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 处理：migrateAccountId的具体业务逻辑。
function migrateAccountId(oldAccountId, newAccountId) {
  try {
    const sourceId = String(oldAccountId || '').trim();
    const targetId = String(newAccountId || '').trim();
    if (!sourceId || !targetId) {
      return { ok: false, error: '账号ID无效' };
    }
    if (sourceId === targetId) {
      return { ok: true, account: loadAccountFromFile(sourceId) };
    }

    const existingAccount = loadAccountFromFile(sourceId);
    if (!existingAccount) {
      return { ok: false, error: '账号不存在' };
    }

    const saved = sessionStorage.saveSession(targetId, {
      lastUsedAt: existingAccount.lastUsedAt || new Date().toISOString(),
      account: existingAccount.account || existingAccount.accountName || '',
      platform: existingAccount.platform || '',
      currentPlatform: existingAccount.currentPlatform || '',
      currentUrl: existingAccount.currentUrl || '',
      storageType: existingAccount.storageType || 'server',
      storageGroup: existingAccount.storageGroup || '',
      storageGroupLabel: existingAccount.storageGroupLabel || '',
      cleanupProtected: existingAccount.cleanupProtected === true,
      currentAccountType: existingAccount.currentAccountType || '',
      currentAccountTypeLabel: existingAccount.currentAccountTypeLabel || '',
      serverRecycleTime: existingAccount.serverRecycleTime || '',
      serverRecycleTimeTs: existingAccount.serverRecycleTimeTs ?? null,
      serverRecycleTimeIso: existingAccount.serverRecycleTimeIso || '',
    });

    if (!saved) {
      return { ok: false, error: '迁移账号失败' };
    }

    if (!sessionStorage.deleteSession(sourceId)) {
      return { ok: false, error: '迁移成功但删除旧账号失败' };
    }

    const migratedAccount = loadAccountFromFile(targetId);
    removeCachedAccount(sourceId);
    upsertCachedAccount(migratedAccount);
    return { ok: true, account: cloneAccount(migratedAccount) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取单个账号
function getAccount(accountId) {
  try {
    // 从分离存储中读取账号信息
    const account = loadAccountFromFile(accountId);
    if (!account) {
      return { ok: false, error: '账号不存在' };
    }

    return { ok: true, account };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取最后使用的账号（包含完整的key和deviceId）
function getLastUsedAccount() {
  try {
    const accounts = loadAccounts();
    if (accounts.length === 0) {
      return { ok: false, error: '没有保存的账号' };
    }

    // 按id排序（id包含时间戳），最新的在前
    const sortedAccounts = accounts.sort((a, b) => b.id.localeCompare(a.id));

    // 返回第一个（ID最大的，理论上最新的）账号
    const account = sortedAccounts[0];
    return { ok: true, account };
  } catch (e) {
    console.error('[AccountStorage] 获取最后使用的账号失败:', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// 更新账号的最后使用时间
function updateLastUsedTime(accountId) {
  try {
    // 检查账号是否存在
    const account = loadAccountFromFile(accountId);
    if (!account) {
      return { ok: false, error: '账号不存在' };
    }

    // 更新会话数据中的最后使用时间
    const lastUsedAt = new Date().toISOString();
    const result = sessionStorage.saveSession(accountId, {
      lastUsedAt: lastUsedAt
    });

    if (result) {
      upsertCachedAccount({ ...account, lastUsedAt });
      console.log('[AccountStorage] 账号最后使用时间已更新:', accountId, lastUsedAt);
      return { ok: true };
    } else {
      return { ok: false, error: '保存最后使用时间失败' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取所有账号（不包含敏感信息）
function getAllAccounts() {
  try {
    const accounts = loadAccounts();

    // 为每个账号生成显示名称
    const accountsWithNames = accounts.map(acc => {
      let accountName;
      const currentAccountType = resolveCurrentAccountType(acc.currentAccountType, acc.currentAccountTypeLabel);
      const currentAccountTypeLabel = String(acc.currentAccountTypeLabel || '').trim()
        || (currentAccountType === 'one_time' && acc.storageType === 'custom'
          ? '绑定账号'
          : getCurrentAccountTypeLabel(currentAccountType));
      const isPermanent = currentAccountType === 'one_time'
        || (currentAccountType !== 'shared' && (acc.cleanupProtected === true || acc.storageType === 'custom' || isPermanentAccountRecord(acc)));
      const storageType = acc.storageType || 'server';
      const storageGroupLabel = acc.storageGroupLabel || (isPermanent ? '绑定账号分组' : '临时账号分组');

      // 如果ID包含@符号，说明是邮箱格式账号，直接使用账号作为显示名称
      if (acc.id && acc.id.includes('@')) {
        accountName = acc.id;
      } else {
        // 否则使用原来的时间戳格式
        const timestamp = parseInt(acc.id, 10);
        if (!isNaN(timestamp)) {
          const date = new Date(timestamp);
          const timeStr = date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          accountName = timeStr;
        } else {
          accountName = `账号${acc.id.slice(-6)}`;
        }
      }

      return {
        ...acc,
        displayName: accountName,
        storageType,
        storageGroupLabel,
        currentAccountType,
        currentAccountTypeLabel,
        storageSortOrder: isPermanent ? 0 : 1
      };
    });

    // 按来源分组，再按账号名称排序
    const sortedAccounts = accountsWithNames.sort((a, b) => {
      if (a.storageSortOrder !== b.storageSortOrder) {
        return a.storageSortOrder - b.storageSortOrder;
      }
      if (a.storageGroupLabel !== b.storageGroupLabel) {
        return a.storageGroupLabel.localeCompare(b.storageGroupLabel, 'zh-CN');
      }
      if (a.lastUsedAt && b.lastUsedAt) {
        return String(b.lastUsedAt).localeCompare(String(a.lastUsedAt));
      }
      if (a.id.includes('@') && b.id.includes('@')) {
        return a.id.localeCompare(b.id);
      }
      return String(b.id).localeCompare(String(a.id));
    });

    // 返回账号列表
    return sortedAccounts.map(acc => {
      return {
        id: acc.id,
        displayName: acc.displayName,
        platform: acc.platform || '',
        key: acc.key,
        cleanupProtected: acc.currentAccountType === 'one_time'
          ? true
          : (acc.currentAccountType === 'shared'
            ? false
            : (acc.cleanupProtected === true || isPermanentAccountRecord(acc))),
        currentAccountType: acc.currentAccountType || (acc.storageType === 'custom' || acc.cleanupProtected === true ? 'one_time' : ''),
        currentAccountTypeLabel: acc.currentAccountTypeLabel || ((acc.storageType === 'custom' || acc.cleanupProtected === true) ? '绑定账号' : ''),
        current_account_type: acc.currentAccountType || (acc.storageType === 'custom' || acc.cleanupProtected === true ? 'one_time' : ''),
        current_account_type_label: acc.currentAccountTypeLabel || ((acc.storageType === 'custom' || acc.cleanupProtected === true) ? '绑定账号' : ''),
        hasCookies: Array.isArray(acc.cookies) && acc.cookies.length > 0,
        cookiesCount: Array.isArray(acc.cookies) ? acc.cookies.length : 0,
        lastUsedAt: acc.lastUsedAt,
        serverRecycleTime: acc.serverRecycleTime || '',
        serverRecycleTimeTs: acc.serverRecycleTimeTs ?? null,
        serverRecycleTimeIso: acc.serverRecycleTimeIso || ''
      };
    });
  } catch (e) {
    console.error('[AccountStorage] 获取账号列表失败:', e?.message || e);
    return [];
  }
}

module.exports = {
  addAccount,
  updateAccount,
  deleteAccount,
  migrateAccountId,
  getAccount,
  getLastUsedAccount,
  getAllAccounts,
  updateLastUsedTime,
  setLicenseCache,
};
