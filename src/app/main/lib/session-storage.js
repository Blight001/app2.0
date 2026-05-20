// 会话存储模块：专门处理服务器会话数据的存储（cookies等，cookie内容加密落盘）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { machineIdSync } = require('node-machine-id');

const COOKIE_ENCRYPTION_VERSION = 'v1';
const COOKIE_ENCRYPTION_METHOD_SAFE_STORAGE = 'safeStorage';
const COOKIE_ENCRYPTION_METHOD_AES_GCM = 'aes-256-gcm';
let cookieMigrationDone = false;
let fallbackCookieKeyCache = null;
let sessionsDirCache = null;

// 获取/读取/解析：getSessionsDir的具体业务逻辑。
function getSessionsDir() {
  if (sessionsDirCache) {
    return sessionsDirCache;
  }

  let userDataDir = '';
  try {
    if (app && typeof app.getPath === 'function') {
      userDataDir = app.getPath('userData');
    }
  } catch (_) {}

  if (!userDataDir) {
    userDataDir = path.join(process.cwd(), 'userData');
  }

  sessionsDirCache = path.join(userDataDir, 'account_sessions');
  return sessionsDirCache;
}

// 确保持会话目录存在
function ensureSessionsDir() {
  try {
    const sessionsDir = getSessionsDir();
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
      console.log('[SessionStorage] 创建会话目录:', sessionsDir);
    }
    migratePlaintextCookieSessions();
  } catch (e) {
    console.error('[SessionStorage] 创建会话目录失败:', e?.message || e);
  }
}

// 格式化/规范化：normalizeKeyFolderName的具体业务逻辑。
function normalizeKeyFolderName(key) {
  const value = String(key || '').trim();
  if (!value) return '__no_key__';
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
  const prefix = value
    .slice(0, 6)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'key';
  return `${prefix}_${hash}`;
}

// 获取/读取/解析：getKeyFolderPath的具体业务逻辑。
function getKeyFolderPath(key) {
  return path.join(getSessionsDir(), normalizeKeyFolderName(key));
}

// 获取/读取/解析：getSessionFilePath的具体业务逻辑。
function getSessionFilePath(accountId, key, storageType = 'server', storageGroup = '') {
  const rootDir = getStorageRootDir(storageType, storageGroup);
  if (normalizeStorageType(storageType) === 'server') {
    return path.join(getKeyFolderPath(key), `${accountId}`);
  }
  return path.join(rootDir, normalizeKeyFolderName(key), `${accountId}`);
}

// 获取/读取/解析：getLegacyRootSessionPath的具体业务逻辑。
function getLegacyRootSessionPath(accountId) {
  return path.join(getSessionsDir(), `${accountId}`);
}

// 获取/读取/解析：getLegacyRootSessionJsonPath的具体业务逻辑。
function getLegacyRootSessionJsonPath(accountId) {
  return `${getLegacyRootSessionPath(accountId)}.json`;
}

// 格式化/规范化：normalizeFolderPart的具体业务逻辑。
function normalizeFolderPart(value, fallback = 'default') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || fallback;
}

// 格式化/规范化：normalizeStorageType的具体业务逻辑。
function normalizeStorageType(value) {
  const text = String(value || 'server').trim().toLowerCase();
  if (text === 'custom' || text === 'manual' || text === 'server') return text;
  return 'server';
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
  if (text.includes('永久') || text.includes('长久') || text.includes('一次')) return 'one_time';
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

// 处理：isPermanentAccountSession的具体业务逻辑。
function isPermanentAccountSession(sessionInfo) {
  return resolveCurrentAccountType(sessionInfo?.currentAccountType, sessionInfo?.currentAccountTypeLabel) === 'one_time';
}

// 处理：isProtectedSession的具体业务逻辑。
function isProtectedSession(sessionInfo) {
  const currentType = resolveCurrentAccountType(sessionInfo?.currentAccountType, sessionInfo?.currentAccountTypeLabel);
  if (currentType === 'one_time') return true;
  if (currentType === 'shared') return false;
  return sessionInfo?.cleanupProtected === true;
}

// 处理：isCookieEncryptionAvailable的具体业务逻辑。
function isCookieEncryptionAvailable() {
  try {
    return !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

// 获取/读取/解析：getFallbackCookieKey的具体业务逻辑。
function getFallbackCookieKey() {
  if (fallbackCookieKeyCache) {
    return fallbackCookieKeyCache;
  }

  let machineId = '';
  try {
    machineId = machineIdSync({ original: true }) || '';
  } catch (_) {}

  const seed = [
    'ai-free-cookie-key',
    machineId,
    app.getPath('userData'),
    app.getName ? app.getName() : 'ai-free',
    process.platform,
    process.arch
  ].filter(Boolean).join('|');

  fallbackCookieKeyCache = crypto.createHash('sha256').update(seed, 'utf8').digest();
  return fallbackCookieKeyCache;
}

// 处理：encryptCookieArray的具体业务逻辑。
function encryptCookieArray(cookies) {
  const payload = JSON.stringify(Array.isArray(cookies) ? cookies : []);

  if (isCookieEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(payload);
    return {
      cookiesEncrypted: encrypted.toString('base64'),
      cookiesEncryptionMethod: COOKIE_ENCRYPTION_METHOD_SAFE_STORAGE,
      cookiesEncryptionVersion: COOKIE_ENCRYPTION_VERSION
    };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getFallbackCookieKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cookiesEncrypted: Buffer.concat([iv, authTag, ciphertext]).toString('base64'),
    cookiesEncryptionMethod: COOKIE_ENCRYPTION_METHOD_AES_GCM,
    cookiesEncryptionVersion: COOKIE_ENCRYPTION_VERSION
  };
}

// 处理：decryptCookieArray的具体业务逻辑。
function decryptCookieArray(sessionInfo) {
  const fallbackCookies = Array.isArray(sessionInfo?.cookies) ? sessionInfo.cookies : [];
  const encryptedPayload = String(sessionInfo?.cookiesEncrypted || '').trim();
  if (!encryptedPayload) {
    return fallbackCookies;
  }

  const method = String(sessionInfo?.cookiesEncryptionMethod || '').trim();
// 处理：trySafeStorage的具体业务逻辑。
  const trySafeStorage = () => {
    if (!isCookieEncryptionAvailable()) return null;
    const decrypted = safeStorage.decryptString(Buffer.from(encryptedPayload, 'base64'));
    const parsed = JSON.parse(decrypted);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.cookies)) return parsed.cookies;
    return null;
  };

// 处理：tryAesGcm的具体业务逻辑。
  const tryAesGcm = () => {
    const blob = Buffer.from(encryptedPayload, 'base64');
    if (blob.length <= 28) return null;
    const iv = blob.subarray(0, 12);
    const authTag = blob.subarray(12, 28);
    const ciphertext = blob.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getFallbackCookieKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.cookies)) return parsed.cookies;
    return null;
  };

  try {
    if (method === COOKIE_ENCRYPTION_METHOD_SAFE_STORAGE) {
      return trySafeStorage() || fallbackCookies;
    }
    if (method === COOKIE_ENCRYPTION_METHOD_AES_GCM) {
      return tryAesGcm() || fallbackCookies;
    }

    return trySafeStorage() || tryAesGcm() || fallbackCookies;
  } catch (e) {
    console.error('[SessionStorage] 解密 cookies 失败:', e?.message || e);
    return fallbackCookies;
  }
}

// 处理：migratePlaintextCookieSessions的具体业务逻辑。
function migratePlaintextCookieSessions() {
  try {
    if (cookieMigrationDone) return;
    cookieMigrationDone = true;

    const sessionsDir = getSessionsDir();
    if (!fs.existsSync(sessionsDir)) {
      return;
    }

    const allFiles = walkSessionFiles(sessionsDir, []);
    for (const filePath of allFiles) {
      try {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const trimmed = String(content || '').trim();
        if (!trimmed) continue;

        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const accountId = path.basename(filePath).replace(/\.json$/, '');
          const sessionInfo = {
            id: accountId,
            cookies: parsed,
            savedAt: null,
            lastUsedAt: null,
            serverRecycleTime: '',
            serverRecycleTimeTs: null,
            serverRecycleTimeIso: '',
            key: '',
            deviceId: '',
            accountName: '',
            currentPlatform: '',
            currentUrl: '',
            storageType: 'server',
            storageGroup: '',
            storageGroupLabel: '',
            cleanupProtected: false,
            currentAccountType: '',
            currentAccountTypeLabel: ''
          };
          const encrypted = encryptCookieArray(parsed);
          const migrated = {
            ...sessionInfo,
            ...encrypted
          };
          delete migrated.cookies;
          fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2), 'utf8');
          continue;
        }

        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cookies) && !parsed.cookiesEncrypted) {
          const encrypted = encryptCookieArray(parsed.cookies);
        const migrated = {
          ...parsed,
          ...encrypted
        };
        delete migrated.cookies;
        if (!Object.prototype.hasOwnProperty.call(migrated, 'currentAccountType')) {
          migrated.currentAccountType = '';
        }
        if (!Object.prototype.hasOwnProperty.call(migrated, 'currentAccountTypeLabel')) {
          migrated.currentAccountTypeLabel = '';
        }
        fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2), 'utf8');
      }
      } catch (_) {}
    }
  } catch (e) {
    console.warn('[SessionStorage] 迁移明文 cookie 失败:', e?.message || e);
  }
}

// 处理：walkSessionFiles的具体业务逻辑。
function walkSessionFiles(dir, out = []) {
  try {
    if (!fs.existsSync(dir)) return out;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkSessionFiles(full, out);
      } else {
        out.push(full);
      }
    }
  } catch (_) {}
  return out;
}

// 获取/读取/解析：findSessionPaths的具体业务逻辑。
function findSessionPaths(accountId) {
  const results = [];
  try {
    const legacyFlat = getLegacyRootSessionPath(accountId);
    const legacyFlatJson = getLegacyRootSessionJsonPath(accountId);
    if (fs.existsSync(legacyFlat)) results.push(legacyFlat);
    if (fs.existsSync(legacyFlatJson)) results.push(legacyFlatJson);

    const allFiles = walkSessionFiles(getSessionsDir(), []);
    for (const filePath of allFiles) {
      if (path.basename(filePath) === String(accountId)) {
        results.push(filePath);
      }
    }
  } catch (_) {}
  return Array.from(new Set(results));
}

// 获取/读取/解析：getStorageRootDir的具体业务逻辑。
function getStorageRootDir(storageType, storageGroup) {
  const type = normalizeStorageType(storageType);
  const sessionsDir = getSessionsDir();
  if (type === 'custom') {
    return path.join(sessionsDir, 'custom', normalizeFolderPart(storageGroup, 'default'));
  }
  if (type === 'manual') {
    return path.join(sessionsDir, 'manual');
  }
  return sessionsDir;
}

// 处理：inferSessionLocationInfo的具体业务逻辑。
function inferSessionLocationInfo(filePath) {
  try {
    const sessionsDir = path.resolve(getSessionsDir());
    const resolvedPath = path.resolve(filePath || '');
    const relativePath = path.relative(sessionsDir, resolvedPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return { storageType: 'server', storageGroup: '', storageGroupLabel: '' };
    }

    const segments = relativePath.split(path.sep).filter(Boolean);
    if (segments[0] === 'custom') {
      const storageGroup = segments[1] || '';
      return { storageType: 'custom', storageGroup, storageGroupLabel: storageGroup };
    }
    if (segments[0] === 'manual') {
      return { storageType: 'manual', storageGroup: '', storageGroupLabel: 'manual' };
    }
    return { storageType: 'server', storageGroup: '', storageGroupLabel: '' };
  } catch (_) {
    return { storageType: 'server', storageGroup: '', storageGroupLabel: '' };
  }
}

// 移除/删除：pruneEmptyDir的具体业务逻辑。
function pruneEmptyDir(dirPath) {
  try {
    if (!dirPath || dirPath === getSessionsDir()) return;
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch (_) {}
}

// 保存会话数据（cookies等）
function saveSession(accountId, sessionData) {
  try {
    ensureSessionsDir();
    const {
      cookies,
      browserStorage,
      lastUsedAt,
      serverRecycleTime,
      serverRecycleTimeTs,
      serverRecycleTimeIso,
      platform,
      currentPlatform,
      currentUrl,
      key,
      account,
      storageType,
      storageGroup,
      cleanupProtected,
      currentAccountType,
      currentAccountTypeLabel,
    } = sessionData;

    // 读取现有会话数据
    let existingSession = loadSession(accountId);
    if (!existingSession) {
      existingSession = {
        id: accountId,
        cookies: [],
        savedAt: null,
        lastUsedAt: null,
        serverRecycleTime: '',
        serverRecycleTimeTs: null,
        serverRecycleTimeIso: '',
        platform: '',
        currentPlatform: '',
        currentUrl: '',
        account: '',
        storageType: 'server',
        storageGroup: '',
        storageGroupLabel: '',
        cleanupProtected: false,
        currentAccountType: '',
        currentAccountTypeLabel: '',
        browserStorage: [],
      };
    }

    const finalStorageType = normalizeStorageType(storageType || existingSession.storageType || 'server');
    const finalStorageGroup = String(storageGroup !== undefined ? storageGroup : (existingSession.storageGroup || '')).trim();
    const hasCurrentAccountType = currentAccountType !== undefined && currentAccountType !== null && String(currentAccountType).trim() !== '';
    const rawCurrentAccountTypeLabel = String(
      currentAccountTypeLabel !== undefined
        ? currentAccountTypeLabel
        : (existingSession.currentAccountTypeLabel || '')
    ).trim();
    const finalCurrentAccountType = hasCurrentAccountType
      ? resolveCurrentAccountType(currentAccountType, rawCurrentAccountTypeLabel)
      : resolveCurrentAccountType(existingSession.currentAccountType, rawCurrentAccountTypeLabel);
    const finalCurrentAccountTypeLabel = rawCurrentAccountTypeLabel
      || (finalStorageType === 'custom'
        ? '永久账号'
        : getCurrentAccountTypeLabel(finalCurrentAccountType));
    const finalCleanupProtected = hasCurrentAccountType
      ? finalCurrentAccountType === 'one_time'
      : (cleanupProtected !== undefined
        ? cleanupProtected === true
        : (existingSession.cleanupProtected === true
          || isPermanentAccountSession(existingSession)
          || finalStorageType === 'custom'));

    const sessionInfo = {
      id: accountId,
      savedAt: cookies !== undefined ? new Date().toISOString() : existingSession.savedAt,
      lastUsedAt: lastUsedAt !== undefined ? lastUsedAt : existingSession.lastUsedAt,
      serverRecycleTime: serverRecycleTime !== undefined ? serverRecycleTime : existingSession.serverRecycleTime,
      serverRecycleTimeTs: serverRecycleTimeTs !== undefined ? serverRecycleTimeTs : existingSession.serverRecycleTimeTs,
      serverRecycleTimeIso: serverRecycleTimeIso !== undefined ? serverRecycleTimeIso : existingSession.serverRecycleTimeIso,
      platform: platform !== undefined ? String(platform || '').trim() : String(existingSession.platform || '').trim(),
      currentPlatform: currentPlatform !== undefined ? String(currentPlatform || '').trim() : String(existingSession.currentPlatform || '').trim(),
      currentUrl: currentUrl !== undefined ? String(currentUrl || '').trim() : String(existingSession.currentUrl || '').trim(),
      account: account !== undefined ? String(account || '').trim() : String(existingSession.account || '').trim(),
      key: key !== undefined ? key : (existingSession.key || ''),
      cleanupProtected: finalCleanupProtected,
      currentAccountType: finalCurrentAccountType,
      currentAccountTypeLabel: finalCurrentAccountTypeLabel,
      browserStorage: browserStorage !== undefined
        ? browserStorage
        : (Array.isArray(existingSession.browserStorage) ? existingSession.browserStorage : []),
    };

    const cookiesToPersist = cookies !== undefined ? cookies : existingSession.cookies;
    const encryptedCookies = encryptCookieArray(cookiesToPersist);
    sessionInfo.cookiesEncrypted = encryptedCookies.cookiesEncrypted;
    sessionInfo.cookiesEncryptionMethod = encryptedCookies.cookiesEncryptionMethod;
    sessionInfo.cookiesEncryptionVersion = encryptedCookies.cookiesEncryptionVersion;

    const finalKey = sessionInfo.key || '';
    const targetDir = path.dirname(getSessionFilePath(accountId, finalKey, finalStorageType, finalStorageGroup));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const filePath = getSessionFilePath(accountId, finalKey, finalStorageType, finalStorageGroup);

    // 如果旧位置存在同一份会话，先清理掉，避免同一账号散落在多个目录
    for (const candidate of findSessionPaths(accountId)) {
      try {
        if (path.resolve(candidate) !== path.resolve(filePath) && fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      } catch (_) {}
    }

    fs.writeFileSync(filePath, JSON.stringify(sessionInfo, null, 2), 'utf8');
    console.log('[SessionStorage] 会话数据已保存到文件:', filePath);
    return true;
  } catch (e) {
    console.error('[SessionStorage] 保存会话文件失败:', e?.message || e);
    return false;
  }
}

// 从文件读取会话数据
function loadSession(accountId) {
  try {
    ensureSessionsDir();
    const candidates = findSessionPaths(accountId);
    const actualFilePath = candidates.length > 0 ? candidates[0] : null;
    if (!actualFilePath) {
      return null;
    }
    const content = fs.readFileSync(actualFilePath, 'utf8');
    const sessionInfo = JSON.parse(content);
    const locationInfo = inferSessionLocationInfo(actualFilePath);
    if (actualFilePath === getLegacyRootSessionJsonPath(accountId) || actualFilePath === getLegacyRootSessionPath(accountId)) {
      try {
        const migratedKey = String(sessionInfo.key || '').trim();
        const targetPath = getSessionFilePath(accountId, migratedKey);
        if (!fs.existsSync(path.dirname(targetPath))) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        }
        fs.writeFileSync(targetPath, content, 'utf8');
        try { fs.unlinkSync(actualFilePath); } catch (_) {}
        try {
          const legacyJson = getLegacyRootSessionJsonPath(accountId);
          if (legacyJson !== actualFilePath && fs.existsSync(legacyJson)) {
            fs.unlinkSync(legacyJson);
          }
        } catch (_) {}
      } catch (_) {}
    }

    if (sessionInfo && typeof sessionInfo === 'object' && !Array.isArray(sessionInfo)) {
      const stripped = { ...sessionInfo };
      let changed = false;
      for (const field of ['deviceId', 'accountName', 'storageType', 'storageGroup', 'storageGroupLabel']) {
        if (Object.prototype.hasOwnProperty.call(stripped, field)) {
          delete stripped[field];
          changed = true;
        }
      }
      if (changed) {
        try {
          fs.writeFileSync(actualFilePath, JSON.stringify(stripped, null, 2), 'utf8');
        } catch (_) {}
      }
    }

    // 兼容旧格式（只有cookies数组）
    if (Array.isArray(sessionInfo)) {
      const encrypted = encryptCookieArray(sessionInfo);
      return {
        id: accountId,
        cookies: sessionInfo,
        savedAt: null,
        lastUsedAt: null,
        serverRecycleTime: '',
        serverRecycleTimeTs: null,
        serverRecycleTimeIso: '',
      platform: '',
      currentPlatform: '',
      currentUrl: '',
      account: '',
      key: '',
        deviceId: '',
        accountName: '',
        storageType: locationInfo.storageType,
        storageGroup: locationInfo.storageGroup,
        storageGroupLabel: locationInfo.storageGroupLabel,
        cleanupProtected: locationInfo.storageType === 'custom',
        currentAccountType: locationInfo.storageType === 'custom' ? 'one_time' : '',
        currentAccountTypeLabel: locationInfo.storageType === 'custom' ? '永久账号' : '',
        current_account_type: '',
        current_account_type_label: '',
        cookiesEncrypted: encrypted.cookiesEncrypted,
        cookiesEncryptionMethod: encrypted.cookiesEncryptionMethod,
        cookiesEncryptionVersion: encrypted.cookiesEncryptionVersion
      };
    }

    const resolvedStorageType = normalizeStorageType(sessionInfo.storageType || locationInfo.storageType || 'server');
    const resolvedCurrentAccountType = resolveCurrentAccountType(sessionInfo.currentAccountType, sessionInfo.currentAccountTypeLabel);
    const inferredPermanentAccount = resolvedStorageType === 'custom'
      || sessionInfo.cleanupProtected === true
      || resolvedCurrentAccountType === 'one_time';
    const finalCurrentAccountType = resolvedCurrentAccountType || (inferredPermanentAccount ? 'one_time' : '');
    const finalCurrentAccountTypeLabel = String(sessionInfo.currentAccountTypeLabel || '').trim()
      || (inferredPermanentAccount ? '永久账号' : getCurrentAccountTypeLabel(finalCurrentAccountType));

    return {
      id: accountId,
      cookies: decryptCookieArray(sessionInfo),
      savedAt: sessionInfo.savedAt,
      lastUsedAt: sessionInfo.lastUsedAt,
      serverRecycleTime: sessionInfo.serverRecycleTime || '',
      serverRecycleTimeTs: sessionInfo.serverRecycleTimeTs ?? null,
      serverRecycleTimeIso: sessionInfo.serverRecycleTimeIso || '',
      platform: String(sessionInfo.platform || '').trim(),
      currentPlatform: String(sessionInfo.currentPlatform || '').trim(),
      currentUrl: String(sessionInfo.currentUrl || '').trim(),
      account: String(sessionInfo.account || sessionInfo.accountName || '').trim(),
      key: sessionInfo.key || '',
      deviceId: sessionInfo.deviceId || '',
      accountName: sessionInfo.accountName || '',
      storageType: resolvedStorageType,
      storageGroup: String(sessionInfo.storageGroup || locationInfo.storageGroup || '').trim(),
      storageGroupLabel: String(sessionInfo.storageGroupLabel || locationInfo.storageGroupLabel || '').trim(),
      cleanupProtected: finalCurrentAccountType === 'one_time'
        ? true
        : (finalCurrentAccountType === 'shared'
          ? false
          : sessionInfo.cleanupProtected === true || resolvedStorageType === 'custom'),
      currentAccountType: finalCurrentAccountType,
      currentAccountTypeLabel: finalCurrentAccountTypeLabel,
      current_account_type: finalCurrentAccountType,
      current_account_type_label: finalCurrentAccountTypeLabel,
      browserStorage: Array.isArray(sessionInfo.browserStorage) ? sessionInfo.browserStorage : [],
      cookiesEncrypted: sessionInfo.cookiesEncrypted || '',
      cookiesEncryptionMethod: sessionInfo.cookiesEncryptionMethod || '',
      cookiesEncryptionVersion: sessionInfo.cookiesEncryptionVersion || ''
    };
  } catch (e) {
    console.error('[SessionStorage] 读取会话文件失败:', e?.message || e);
    return null;
  }
}

// 删除会话文件
function deleteSession(accountId) {
  try {
    ensureSessionsDir();
    const candidatePaths = findSessionPaths(accountId);
    let deleted = false;
    for (const filePath of candidatePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('[SessionStorage] 会话文件已删除:', filePath);
          deleted = true;
          pruneEmptyDir(path.dirname(filePath));
        }
      } catch (e) {
        console.error('[SessionStorage] 删除会话文件失败:', e?.message || e);
      }
    }
    return deleted;
  } catch (e) {
    console.error('[SessionStorage] 删除会话文件失败:', e?.message || e);
    return false;
  }
}

// 获取所有会话文件ID
function getAllSessionIds() {
  try {
    ensureSessionsDir();
    const sessionsDir = getSessionsDir();
    if (!fs.existsSync(sessionsDir)) {
      return [];
    }
    return walkSessionFiles(sessionsDir, [])
      .filter(filePath => fs.existsSync(filePath) && fs.lstatSync(filePath).isFile())
      .map(filePath => path.basename(filePath).replace(/\.json$/, ''))
      .sort((a, b) => b.localeCompare(a)); // 按ID降序排列（时间戳大的在前）
  } catch (e) {
    console.error('[SessionStorage] 获取会话文件列表失败:', e?.message || e);
    return [];
  }
}

// 清理所有会话文件
function clearAllSessions() {
  try {
    const sessionsDir = getSessionsDir();
    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
      console.log('[SessionStorage] 已删除会话目录');
    }
    return true;
  } catch (e) {
    console.error('[SessionStorage] 清理会话目录失败:', e?.message || e);
    return false;
  }
}

// 清理超过指定时间的会话文件（基于账号ID时间戳）
function clearSessionsOlderThan(maxAgeMs) {
  try {
    const now = Date.now();
    const sessionIds = getAllSessionIds();
    let removedCount = 0;

    for (const accountId of sessionIds) {
      const idTimestamp = parseInt(accountId, 10);
      if (!isNaN(idTimestamp) && (now - idTimestamp) > maxAgeMs) {
        const session = loadSession(accountId);
        if (session && isProtectedSession(session)) {
          continue;
        }
        if (deleteSession(accountId)) {
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      console.log(`[SessionStorage] 已清理 ${removedCount} 个过期的会话文件`);
    }
    return removedCount;
  } catch (e) {
    console.error('[SessionStorage] 清理过期会话失败:', e?.message || e);
    return 0;
  }
}

// 清理超过指定时间未使用的会话文件（基于lastUsedAt字段）
function clearSessionsOlderThanLastUsed(maxAgeMs) {
  try {
    const now = Date.now();
    const sessionIds = getAllSessionIds();
    let removedCount = 0;
    let checkedCount = 0;
    let skippedCount = 0;

    console.log(`[SessionStorage] 开始清理超过 ${Math.floor(maxAgeMs / (24 * 60 * 60 * 1000))} 天的未使用会话文件，当前时间: ${new Date(now).toISOString()}`);

    for (const accountId of sessionIds) {
      try {
        checkedCount++;
        const session = loadSession(accountId);
        if (!session) {
          skippedCount++;
          console.log(`[SessionStorage] 会话 ${accountId} 不存在，跳过`);
          continue;
        }

        if (isProtectedSession(session)) {
          skippedCount++;
          console.log(`[SessionStorage] 会话 ${accountId} 为受保护的自定义cookie，跳过自动清理`);
          continue;
        }

        if (!session.lastUsedAt) {
          skippedCount++;
          console.log(`[SessionStorage] 会话 ${accountId} 没有lastUsedAt字段，跳过`);
          continue;
        }

        const lastUsedTimestamp = new Date(session.lastUsedAt).getTime();
        const ageMs = now - lastUsedTimestamp;
        const ageDays = ageMs / (24 * 60 * 60 * 1000);

        console.log(`[SessionStorage] 检查会话 ${accountId}: lastUsedAt=${session.lastUsedAt}, 时间戳=${lastUsedTimestamp}, 年龄=${ageDays.toFixed(2)}天`);

        if (!isNaN(lastUsedTimestamp) && ageMs > maxAgeMs) {
          console.log(`[SessionStorage] 删除过期会话 ${accountId}`);
          if (deleteSession(accountId)) {
            removedCount++;
          }
        }
      } catch (e) {
        console.error(`[SessionStorage] 检查会话 ${accountId} 时出错:`, e?.message || e);
      }
    }

    console.log(`[SessionStorage] 清理完成: 检查了${checkedCount}个，跳过了${skippedCount}个，删除了${removedCount}个`);
    return removedCount;
  } catch (e) {
    console.error('[SessionStorage] 清理未使用会话失败:', e?.message || e);
    return 0;
  }
}

// 清理指定时间戳之前使用的会话文件
function clearSessionsBeforeTimestamp(beforeTimestampMs) {
  try {
    const sessionIds = getAllSessionIds();
    let removedCount = 0;
    let checkedCount = 0;
    let skippedCount = 0;

    console.log(`[SessionStorage] 开始清理 ${new Date(beforeTimestampMs).toISOString()} 之前使用的会话文件`);

    for (const accountId of sessionIds) {
      try {
        checkedCount++;
        const session = loadSession(accountId);
        if (!session) {
          skippedCount++;
          console.log(`[SessionStorage] 会话 ${accountId} 不存在，跳过`);
          continue;
        }

        if (isProtectedSession(session)) {
          skippedCount++;
          console.log(`[SessionStorage] 会话 ${accountId} 为受保护的自定义cookie，跳过自动清理`);
          continue;
        }

        if (!session.lastUsedAt) {
          skippedCount++;
          console.log(`[SessionStorage] 会话 ${accountId} 没有lastUsedAt字段，跳过`);
          continue;
        }

        const lastUsedTimestamp = new Date(session.lastUsedAt).getTime();

        console.log(`[SessionStorage] 检查会话 ${accountId}: lastUsedAt=${session.lastUsedAt}, 时间戳=${lastUsedTimestamp}, 目标时间=${beforeTimestampMs}`);

        if (!isNaN(lastUsedTimestamp) && lastUsedTimestamp < beforeTimestampMs) {
          console.log(`[SessionStorage] 删除昨天会话 ${accountId}`);
          if (deleteSession(accountId)) {
            removedCount++;
          }
        }
      } catch (e) {
        console.error(`[SessionStorage] 检查会话 ${accountId} 时出错:`, e?.message || e);
      }
    }

    console.log(`[SessionStorage] 昨天会话清理完成: 检查了${checkedCount}个，跳过了${skippedCount}个，删除了${removedCount}个`);
    return removedCount;
  } catch (e) {
    console.error('[SessionStorage] 清理昨天会话失败:', e?.message || e);
    return 0;
  }
}

module.exports = {
  saveSession,
  loadSession,
  deleteSession,
  getAllSessionIds,
  clearAllSessions,
  clearSessionsOlderThan,
  clearSessionsOlderThanLastUsed,
  clearSessionsBeforeTimestamp,
  migratePlaintextCookieSessions,
  getSessionsDir,
};
