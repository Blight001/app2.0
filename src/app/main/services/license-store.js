// 创建/初始化：createLicenseStore的具体业务逻辑。
function createLicenseStore(deps = {}) {
  const {
    fs,
    path,
    getStorePath,
    getCurrentPlatformLabel,
    licenseCache,
    logger = console,
  } = deps;

// 获取/读取/解析：readStoreConfigSafe的具体业务逻辑。
  function readStoreConfigSafe() {
    try {
      const storePath = getStorePath();
      if (!fs.existsSync(storePath)) return {};
      const storeData = fs.readFileSync(storePath, 'utf8');
      return JSON.parse(storeData);
    } catch (_) {
      return {};
    }
  }

// 设置/更新/持久化：writeStoreConfigSafe的具体业务逻辑。
  function writeStoreConfigSafe(nextConfig) {
    try {
      const storePath = getStorePath();
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(nextConfig || {}, null, 2), 'utf8');
      return true;
    } catch (e) {
      logger.warn?.('[配置] 写入 store 失败:', e?.message || e);
      return false;
    }
  }

// 获取/读取/解析：getLegacyLicenseRecordsPaths的具体业务逻辑。
  function getLegacyLicenseRecordsPaths() {
    try {
      const baseDir = path.dirname(getStorePath());
      const legacyRootDir = path.dirname(baseDir);
      return [
        path.join(baseDir, 'license-records'),
        path.join(baseDir, 'license-records.json'),
        path.join(legacyRootDir, 'license-records'),
        path.join(legacyRootDir, 'license-records.json'),
      ];
    } catch (_) {
      return [];
    }
  }

// 处理：maskLicenseKey的具体业务逻辑。
  function maskLicenseKey(key) {
    const value = String(key || '').trim();
    if (!value) return '';
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }

// 处理：maskDeviceId的具体业务逻辑。
  function maskDeviceId(deviceId) {
    const value = String(deviceId || '').trim();
    if (!value) return '';
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }

// 格式化/规范化：normalizeLicenseRecord的具体业务逻辑。
  function normalizeLicenseRecord(entry = {}) {
    if (!entry) return null;
    if (entry.status && entry.status !== 'success') return null;

    const keyValue = String(entry.keyValue || entry.key || '').trim();
    if (!keyValue) return null;
    const platformName = String(
      entry.platformName
      || entry.platform
      || entry.currentPlatformName
      || ''
    ).trim();

    const normalized = {
      id: String(entry.id || keyValue || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
      keyValue,
    };

    if (platformName) {
      normalized.platformName = platformName;
    }

    const savedAt = String(entry.savedAt || entry.createdAt || '').trim();
    const updatedAt = String(entry.updatedAt || '').trim();
    if (savedAt) {
      normalized.savedAt = savedAt;
    }
    if (updatedAt) {
      normalized.updatedAt = updatedAt;
    }

    return normalized;
  }

// 格式化/规范化：normalizeLicenseRecordsPayload的具体业务逻辑。
  function normalizeLicenseRecordsPayload(records) {
    const seenKeys = new Set();
    const cleaned = [];

    for (const item of Array.isArray(records) ? records : []) {
      const normalized = normalizeLicenseRecord(item);
      if (!normalized) continue;
      if (seenKeys.has(normalized.keyValue)) continue;
      seenKeys.add(normalized.keyValue);
      cleaned.push(normalized);
      if (cleaned.length >= 50) break;
    }

    return cleaned;
  }

// 格式化/规范化：sanitizeLicenseRecords的具体业务逻辑。
  function sanitizeLicenseRecords(records) {
    return normalizeLicenseRecordsPayload(records);
  }

// 获取/读取/解析：readLicenseRecordsSafe的具体业务逻辑。
  function readLicenseRecordsSafe() {
    try {
      const sourceRecords = [];

      if (licenseCache && typeof licenseCache.getRecords === 'function') {
        sourceRecords.push(...licenseCache.getRecords());
      }

      const storeConfig = readStoreConfigSafe();
      if (Array.isArray(storeConfig.licenseRecords)) {
        sourceRecords.push(...storeConfig.licenseRecords);
      }
      if (Array.isArray(storeConfig.license_records)) {
        sourceRecords.push(...storeConfig.license_records);
      }

      const savedKey = String(storeConfig.userCredentials?.key || '').trim();
      if (savedKey && !sourceRecords.some((item) => String(item?.keyValue || item?.key || '').trim() === savedKey)) {
        sourceRecords.unshift({
          keyValue: savedKey,
          platformName: getCurrentPlatformLabelSafe(),
        });
      }

      const legacyPaths = getLegacyLicenseRecordsPaths();
      for (const legacyPath of legacyPaths) {
        try {
          if (!legacyPath || !fs.existsSync(legacyPath)) continue;
          const stat = fs.statSync(legacyPath);
          if (stat.isDirectory()) continue;
          const raw = fs.readFileSync(legacyPath, 'utf8');
          const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed)) {
            sourceRecords.push(...parsed);
          } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.records)) sourceRecords.push(...parsed.records);
            if (Array.isArray(parsed.licenseRecords)) sourceRecords.push(...parsed.licenseRecords);
          }
        } catch (_) {}
      }

      const cleaned = sanitizeLicenseRecords(sourceRecords);
      if (cleaned.length > 0) {
        if (licenseCache && typeof licenseCache.setRecords === 'function') {
          licenseCache.setRecords(cleaned);
        }
        return cleaned;
      }

      return [];
    } catch (_) {
      return [];
    }
  }

// 设置/更新/持久化：writeLicenseRecordsSafe的具体业务逻辑。
  function writeLicenseRecordsSafe(records) {
    try {
      const cleaned = sanitizeLicenseRecords(records);
      const existingConfig = readStoreConfigSafe();
      const nextConfig = {
        ...existingConfig,
        licenseRecords: cleaned,
      };
      delete nextConfig.license_records;
      if (licenseCache && typeof licenseCache.setRecords === 'function') {
        licenseCache.setRecords(cleaned);
      }
      return writeStoreConfigSafe(nextConfig);
    } catch (e) {
      logger.warn?.('[验证记录] 写入失败:', e?.message || e);
      return false;
    }
  }

// 获取/读取/解析：getCurrentPlatformLabelSafe的具体业务逻辑。
  function getCurrentPlatformLabelSafe() {
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const runtimePlatformName = String(runtimeConfig.platformName || '').trim();
      if (runtimePlatformName) {
        return runtimePlatformName;
      }

      const runtimeAllowedPlatforms = Array.isArray(runtimeConfig.allowedPlatforms) ? runtimeConfig.allowedPlatforms : [];
      if (runtimeAllowedPlatforms.length > 0) {
        return String(runtimeAllowedPlatforms[0] || '').trim() || '未知平台';
      }

      const allowedPlatforms = Array.isArray(deps.getLatestAllowedPlatforms?.()) ? deps.getLatestAllowedPlatforms() : [];
      const cachedPlatformName = String(allowedPlatforms[0] || '').trim();
      if (cachedPlatformName) return cachedPlatformName;
    } catch (_) {
      return '未知平台';
    }
    return '未知平台';
  }

// 处理：appendLicenseRecord的具体业务逻辑。
  function appendLicenseRecord(entry = {}) {
    const normalized = normalizeLicenseRecord({
      ...entry,
      savedAt: String(entry.savedAt || new Date().toISOString()).trim(),
      updatedAt: String(entry.updatedAt || new Date().toISOString()).trim(),
    });
    if (!normalized) return null;

    const records = readLicenseRecordsSafe();
    const nextRecords = [normalized, ...records.filter((item) => String(item?.keyValue || '').trim() !== normalized.keyValue)];
    writeLicenseRecordsSafe(nextRecords);
    return normalized;
  }

// 设置/更新/持久化：updateLicenseRecordPlatform的具体业务逻辑。
  function updateLicenseRecordPlatform(entry = {}) {
    const keyValue = String(entry.keyValue || entry.key || '').trim();
    const platformName = String(entry.platformName || entry.platform || entry.currentPlatformName || '').trim();
    if (!keyValue || !platformName) return null;

    const records = readLicenseRecordsSafe();
    let updated = false;
    const updatedAt = new Date().toISOString();
    const nextRecords = records.map((item) => {
      const itemKey = String(item?.keyValue || item?.key || '').trim();
      if (itemKey !== keyValue) return item;
      updated = true;
      return {
        ...item,
        platformName,
        updatedAt,
      };
    });

    if (!updated) {
      nextRecords.unshift({
        keyValue,
        platformName,
        savedAt: updatedAt,
        updatedAt,
      });
    }

    writeLicenseRecordsSafe(nextRecords);
    return {
      keyValue,
      platformName,
      updated,
    };
  }

  return {
    readStoreConfigSafe,
    writeStoreConfigSafe,
    getCurrentPlatformLabel: getCurrentPlatformLabelSafe,
    normalizeLicenseRecord,
    sanitizeLicenseRecords,
    readLicenseRecordsSafe,
    writeLicenseRecordsSafe,
    maskLicenseKey,
    maskDeviceId,
    appendLicenseRecord,
    updateLicenseRecordPlatform,
  };
}

module.exports = {
  createLicenseStore,
};
