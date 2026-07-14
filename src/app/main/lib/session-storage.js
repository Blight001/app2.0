// 会话存储模块：只保存账号元数据。Cookie/Storage 由独立 Chromium Profile 持久化。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const {
  getCurrentAccountTypeLabel,
  resolveCurrentAccountType,
} = require('../utils/normalizers');

let metadataMigrationDone = false;
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
    migrateSessionMetadataOnly();
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

// 账号 ID 来自服务端，可能包含 Windows 文件名不允许的字符（例如“平台::邮箱”）。
// 业务层仍保留原始 ID；只有落盘文件名使用稳定哈希，避免破坏账号匹配、去重和切换逻辑。
function getSessionFileName(accountId) {
  const value = String(accountId || '').trim();
  const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  const isPortableFileName = value
    && value !== '.'
    && value !== '..'
    && Buffer.byteLength(value, 'utf8') <= 180
    && !/[<>:"/\\|?*\x00-\x1f]/.test(value)
    && !/[. ]$/.test(value)
    && !reservedWindowsName.test(value);

  if (isPortableFileName) {
    return value;
  }

  return `account-${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

// 获取/读取/解析：getKeyFolderPath的具体业务逻辑。
function getKeyFolderPath(key) {
  return path.join(getSessionsDir(), normalizeKeyFolderName(key));
}

// 获取/读取/解析：getSessionFilePath的具体业务逻辑。
function getSessionFilePath(accountId, key, storageType = 'server', storageGroup = '') {
  const rootDir = getStorageRootDir(storageType, storageGroup);
  const fileName = getSessionFileName(accountId);
  if (normalizeStorageType(storageType) === 'server') {
    return path.join(getKeyFolderPath(key), fileName);
  }
  return path.join(rootDir, normalizeKeyFolderName(key), fileName);
}

// 获取/读取/解析：getLegacyRootSessionPath的具体业务逻辑。
function getLegacyRootSessionPath(accountId) {
  return path.join(getSessionsDir(), getSessionFileName(accountId));
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

const SESSION_CREDENTIAL_FIELDS = [
  'cookies',
  'cookiesEncrypted',
  'cookiesEncryptionMethod',
  'cookiesEncryptionVersion',
  'browserStorage',
  'key',
  'deviceId',
];

// 旧版本曾在 account_sessions 中保存 Cookie/Storage；升级时统一收敛为纯元数据。
function migrateSessionMetadataOnly() {
  try {
    if (metadataMigrationDone) return;
    metadataMigrationDone = true;

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
        const metadata = Array.isArray(parsed)
          ? {
              id: path.basename(filePath).replace(/\.json$/, ''),
              savedAt: null,
              lastUsedAt: null,
              serverRecycleTime: '',
              serverRecycleTimeTs: null,
              serverRecycleTimeIso: '',
              platform: '',
              currentPlatform: '',
              currentUrl: '',
              account: '',
              cleanupProtected: false,
              currentAccountType: '',
              currentAccountTypeLabel: '',
            }
          : { ...parsed };
        let changed = Array.isArray(parsed);
        if (!String(metadata.account || '').trim() && String(metadata.accountName || '').trim()) {
          metadata.account = String(metadata.accountName).trim();
          changed = true;
        }
        for (const field of [
          ...SESSION_CREDENTIAL_FIELDS,
          'accountName',
          'storageType',
          'storageGroup',
          'storageGroupLabel',
        ]) {
          if (Object.prototype.hasOwnProperty.call(metadata, field)) {
            delete metadata[field];
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf8');
        }
      } catch (_) {}
    }
  } catch (e) {
    console.warn('[SessionStorage] 迁移账号元数据失败:', e?.message || e);
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
    const normalizedAccountId = String(accountId || '').trim();
    const sessionFileName = getSessionFileName(normalizedAccountId);
    const legacyFlat = getLegacyRootSessionPath(accountId);
    const legacyFlatJson = getLegacyRootSessionJsonPath(accountId);
    if (fs.existsSync(legacyFlat)) results.push(legacyFlat);
    if (fs.existsSync(legacyFlatJson)) results.push(legacyFlatJson);

    const allFiles = walkSessionFiles(getSessionsDir(), []);
    for (const filePath of allFiles) {
      const baseName = path.basename(filePath).replace(/\.json$/, '');
      if (baseName === normalizedAccountId || baseName === sessionFileName) {
        results.push(filePath);
        continue;
      }

      // 新格式的文件名不可逆，因此以文件内保存的原始 ID 作为最终匹配依据。
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && !Array.isArray(parsed) && String(parsed.id || '').trim() === normalizedAccountId) {
          results.push(filePath);
        }
      } catch (_) {
        // 损坏或旧式文件由 loadSession 统一处理，这里只跳过 ID 内容匹配。
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

// 保存账号元数据。即使调用方意外传入 Cookie/Storage，也绝不写入磁盘。
function saveSession(accountId, sessionData) {
  try {
    ensureSessionsDir();
    const {
      lastUsedAt,
      serverRecycleTime,
      serverRecycleTimeTs,
      serverRecycleTimeIso,
      platform,
      currentPlatform,
      currentUrl,
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
        ? '绑定账号'
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
      savedAt: existingSession.savedAt || new Date().toISOString(),
      lastUsedAt: lastUsedAt !== undefined ? lastUsedAt : existingSession.lastUsedAt,
      serverRecycleTime: serverRecycleTime !== undefined ? serverRecycleTime : existingSession.serverRecycleTime,
      serverRecycleTimeTs: serverRecycleTimeTs !== undefined ? serverRecycleTimeTs : existingSession.serverRecycleTimeTs,
      serverRecycleTimeIso: serverRecycleTimeIso !== undefined ? serverRecycleTimeIso : existingSession.serverRecycleTimeIso,
      platform: platform !== undefined ? String(platform || '').trim() : String(existingSession.platform || '').trim(),
      currentPlatform: currentPlatform !== undefined ? String(currentPlatform || '').trim() : String(existingSession.currentPlatform || '').trim(),
      currentUrl: currentUrl !== undefined ? String(currentUrl || '').trim() : String(existingSession.currentUrl || '').trim(),
      account: account !== undefined ? String(account || '').trim() : String(existingSession.account || '').trim(),
      cleanupProtected: finalCleanupProtected,
      currentAccountType: finalCurrentAccountType,
      currentAccountTypeLabel: finalCurrentAccountTypeLabel,
    };

    const targetDir = path.dirname(getSessionFilePath(accountId, '', finalStorageType, finalStorageGroup));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const filePath = getSessionFilePath(accountId, '', finalStorageType, finalStorageGroup);

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
    let sessionInfo = JSON.parse(content);
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
      for (const field of [
        ...SESSION_CREDENTIAL_FIELDS,
        'accountName',
        'storageType',
        'storageGroup',
        'storageGroupLabel',
      ]) {
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
      sessionInfo = stripped;
    }

    // 极旧格式只有 Cookie 数组；不再返回凭证，只保留账号占位元数据。
    if (Array.isArray(sessionInfo)) {
      return {
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
      key: '',
        deviceId: '',
        accountName: '',
        storageType: locationInfo.storageType,
        storageGroup: locationInfo.storageGroup,
        storageGroupLabel: locationInfo.storageGroupLabel,
        cleanupProtected: locationInfo.storageType === 'custom',
        currentAccountType: locationInfo.storageType === 'custom' ? 'one_time' : '',
        currentAccountTypeLabel: locationInfo.storageType === 'custom' ? '绑定账号' : '',
        current_account_type: '',
        current_account_type_label: '',
        browserStorage: []
      };
    }

    const resolvedStorageType = normalizeStorageType(sessionInfo.storageType || locationInfo.storageType || 'server');
    const resolvedCurrentAccountType = resolveCurrentAccountType(sessionInfo.currentAccountType, sessionInfo.currentAccountTypeLabel);
    const inferredPermanentAccount = resolvedStorageType === 'custom'
      || sessionInfo.cleanupProtected === true
      || resolvedCurrentAccountType === 'one_time';
    const finalCurrentAccountType = resolvedCurrentAccountType || (inferredPermanentAccount ? 'one_time' : '');
    const finalCurrentAccountTypeLabel = String(sessionInfo.currentAccountTypeLabel || '').trim()
      || (inferredPermanentAccount ? '绑定账号' : getCurrentAccountTypeLabel(finalCurrentAccountType));

    return {
      id: accountId,
      cookies: [],
      savedAt: sessionInfo.savedAt,
      lastUsedAt: sessionInfo.lastUsedAt,
      serverRecycleTime: sessionInfo.serverRecycleTime || '',
      serverRecycleTimeTs: sessionInfo.serverRecycleTimeTs ?? null,
      serverRecycleTimeIso: sessionInfo.serverRecycleTimeIso || '',
      platform: String(sessionInfo.platform || '').trim(),
      currentPlatform: String(sessionInfo.currentPlatform || '').trim(),
      currentUrl: String(sessionInfo.currentUrl || '').trim(),
      account: String(sessionInfo.account || sessionInfo.accountName || '').trim(),
      key: '',
      deviceId: '',
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
      browserStorage: []
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
    const ids = walkSessionFiles(sessionsDir, [])
      .filter(filePath => fs.existsSync(filePath) && fs.lstatSync(filePath).isFile())
      .map((filePath) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const storedId = parsed && !Array.isArray(parsed) ? String(parsed.id || '').trim() : '';
          if (storedId) return storedId;
        } catch (_) {}
        return path.basename(filePath).replace(/\.json$/, '');
      });
    return Array.from(new Set(ids)).sort((a, b) => b.localeCompare(a)); // 按ID降序排列（时间戳大的在前）
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
  getSessionsDir,
};
