const fs = require('fs');
const path = require('path');
const { getStorePath } = require('../../config');

// 获取/读取/解析：readStoreConfigSafe的具体业务逻辑。
function readStoreConfigSafe() {
  try {
    const storePath = getStorePath();
    if (!storePath || !fs.existsSync(storePath)) return {};
    return JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
  } catch (_) {
    return {};
  }
}

// 设置/更新/持久化：writeStoreConfigSafe的具体业务逻辑。
function writeStoreConfigSafe(storeConfig) {
  try {
    const storePath = getStorePath();
    if (!storePath) return false;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(storeConfig || {}, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

// 设置/更新/持久化：persistSavedLicenseKeySafe的具体业务逻辑。
function persistSavedLicenseKeySafe({ readStoreConfigSafe, writeStoreConfigSafe, licenseCache } = {}, key, deviceId) {
  try {
    const normalizedKey = String(key || '').trim();
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedKey) {
      return false;
    }

    const currentStore = typeof readStoreConfigSafe === 'function' ? readStoreConfigSafe() : {};
    const nextStore = {
      ...(currentStore && typeof currentStore === 'object' ? currentStore : {}),
      userCredentials: {
        ...(currentStore?.userCredentials && typeof currentStore.userCredentials === 'object'
          ? currentStore.userCredentials
          : {}),
        key: normalizedKey,
      },
    };

    if (normalizedDeviceId) {
      nextStore.userCredentials.deviceId = normalizedDeviceId;
    }

    const wroteStore = typeof writeStoreConfigSafe === 'function' ? writeStoreConfigSafe(nextStore) : false;
    if (licenseCache && typeof licenseCache.setCredentials === 'function') {
      licenseCache.setCredentials({
        key: normalizedKey,
        deviceId: normalizedDeviceId,
      });
    }
    return wroteStore === true;
  } catch (_) {
    return false;
  }
}

// 设置/更新/持久化：persistSystemProxyEnabled的具体业务逻辑。
function persistSystemProxyEnabled(enabled) {
  try {
    return enabled === true || enabled === false;
  } catch (_) {
    return false;
  }
}

// 处理：toFiniteNumber的具体业务逻辑。
function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// 格式化/规范化：normalizeLicenseBinding的具体业务逻辑。
function normalizeLicenseBinding(source = {}) {
  return {
    canSelfUnbind: source.can_self_unbind === true || source.canSelfUnbind === true,
    maxUsageTimes: toFiniteNumber(source.max_usage_times ?? source.maxUsageTimes),
    usedUsageTimes: toFiniteNumber(source.used_usage_times ?? source.usedUsageTimes),
    remainingUsageTimes: toFiniteNumber(source.remaining_usage_times ?? source.remainingUsageTimes),
    remainingUnbindTimes: toFiniteNumber(source.remaining_unbind_times ?? source.remainingUnbindTimes),
    maxUnbindTimes: toFiniteNumber(source.max_unbind_times ?? source.maxUnbindTimes),
    usedUnbindTimes: toFiniteNumber(source.used_unbind_times ?? source.usedUnbindTimes),
    deviceBindCount: toFiniteNumber(source.device_bind_count ?? source.deviceBindCount),
    maxDeviceCount: toFiniteNumber(source.max_device_count ?? source.maxDeviceCount),
    deviceBindingStatus: source.device_binding_status ?? source.deviceBindingStatus ?? '',
    deviceBindingSummary: source.device_binding_summary ?? source.deviceBindingSummary ?? '',
  };
}

// 创建/初始化：buildUnboundCredentialRecord的具体业务逻辑。
function buildUnboundCredentialRecord(existing = {}, { key, deviceId } = {}) {
  return {
    key: key || existing.key || '',
  };
}

// 格式化/规范化：sanitizeUserFacingMessage的具体业务逻辑。
function sanitizeUserFacingMessage(message, fallback = '账号分配失败') {
  const text = String(message || '').trim();
  if (!text) return fallback;
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

// 处理：toBoolean的具体业务逻辑。
function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
  }
  return fallback;
}

module.exports = {
  buildUnboundCredentialRecord,
  normalizeLicenseBinding,
  persistSystemProxyEnabled,
  persistSavedLicenseKeySafe,
  readStoreConfigSafe,
  sanitizeUserFacingMessage,
  toBoolean,
  toFiniteNumber,
  writeStoreConfigSafe,
};
