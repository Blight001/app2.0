const {
  normalizeLicenseUsage,
  toFiniteNumber,
} = require('../utils/normalizers');
const {
  normalizeLicenseKeyValue,
  normalizeLicenseRecord,
  normalizeLicenseRecords,
} = require('../utils/license-records');

// 复制/克隆：clone的具体业务逻辑。
function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

// 创建/初始化：createEmptyValidationState的具体业务逻辑。
function createEmptyValidationState() {
  return {
    bound: false,
    validated: false,
    key: '',
    deviceId: '',
    licenseValidated: false,
    cardStatus: '',
    cardExpiryDate: '',
    expiryDate: '',
    expireAt: '',
    daysLeft: null,
    expiresInSeconds: null,
    licenseUsage: null,
    maxUsageTimes: null,
    usedUsageTimes: null,
    remainingUsageTimes: null,
    canSelfUnbind: false,
    remainingUnbindTimes: null,
    maxUnbindTimes: null,
    usedUnbindTimes: null,
    deviceBindCount: null,
    maxDeviceCount: null,
    deviceBindingStatus: '',
    deviceBindingSummary: '',
    accountType: '',
    accountTypeLabel: '',
    currentAccountType: '',
    currentAccountTypeLabel: '',
    lastValidatedAt: null,
    result: null,
    message: '',
  };
}

// 处理：pickValidationSource的具体业务逻辑。
function pickValidationSource(input = {}) {
  return input.result || input.source || input.data || input.payload || input || {};
}

// 创建/初始化：createLicenseCache的具体业务逻辑。
function createLicenseCache() {
  const state = {
    credentials: {
      key: '',
      deviceId: '',
    },
    config: {
      serverBase: '',
      platformName: '',
      targetUrl: '',
      tutorialUrl: '',
      browserSettings: {},
      allowedPlatforms: [],
      systemProxyEnabled: null,
      removeWatermarkEnabled: true,
      translateExtEnabled: false,
      autoValidatePending: false,
    },
    validation: createEmptyValidationState(),
    records: [],
  };

// 设置/更新/持久化：setCredentials的具体业务逻辑。
  function setCredentials({ key, deviceId } = {}) {
    const nextKey = normalizeLicenseKeyValue(key);
    const nextDeviceId = normalizeLicenseKeyValue(deviceId);
    if (key !== undefined) {
      state.credentials.key = nextKey;
      state.validation.key = nextKey;
    }
    if (deviceId !== undefined) {
      state.credentials.deviceId = nextDeviceId;
      state.validation.deviceId = nextDeviceId;
    }
    return getCredentials();
  }

// 获取/读取/解析：getCredentials的具体业务逻辑。
  function getCredentials() {
    return clone(state.credentials) || { key: '', deviceId: '' };
  }

// 设置/更新/持久化：setRuntimeConfig的具体业务逻辑。
  function setRuntimeConfig(partial = {}) {
    if (!partial || typeof partial !== 'object') return getRuntimeConfig();
    if (partial.serverBase !== undefined) {
      state.config.serverBase = normalizeLicenseKeyValue(partial.serverBase);
    }
    if (partial.platformName !== undefined) {
      state.config.platformName = normalizeLicenseKeyValue(partial.platformName);
    }
    if (partial.targetUrl !== undefined) {
      state.config.targetUrl = normalizeLicenseKeyValue(partial.targetUrl);
    }
    if (partial.tutorialUrl !== undefined) {
      state.config.tutorialUrl = normalizeLicenseKeyValue(partial.tutorialUrl);
    }
    if (partial.browserSettings !== undefined) {
      state.config.browserSettings = partial.browserSettings && typeof partial.browserSettings === 'object'
        ? clone(partial.browserSettings)
        : {};
    }
    if (partial.allowedPlatforms !== undefined) {
      state.config.allowedPlatforms = Array.isArray(partial.allowedPlatforms)
        ? partial.allowedPlatforms.map((item) => normalizeLicenseKeyValue(item)).filter(Boolean)
        : [];
    }
    if (partial.systemProxyEnabled !== undefined) {
      state.config.systemProxyEnabled = partial.systemProxyEnabled === true;
    }
    if (partial.removeWatermarkEnabled !== undefined) {
      state.config.removeWatermarkEnabled = partial.removeWatermarkEnabled === true;
    }
    if (partial.translateExtEnabled !== undefined) {
      state.config.translateExtEnabled = partial.translateExtEnabled === true;
    }
    if (partial.autoValidatePending !== undefined) {
      state.config.autoValidatePending = partial.autoValidatePending === true;
    }
    return getRuntimeConfig();
  }

// 获取/读取/解析：getRuntimeConfig的具体业务逻辑。
  function getRuntimeConfig() {
    return clone(state.config) || {
      serverBase: '',
      platformName: '',
      targetUrl: '',
      tutorialUrl: '',
      browserSettings: {},
      allowedPlatforms: [],
      systemProxyEnabled: null,
      removeWatermarkEnabled: true,
      translateExtEnabled: false,
      autoValidatePending: false,
    };
  }

// 设置/更新/持久化：setValidationState的具体业务逻辑。
  function setValidationState(input = {}) {
    const key = normalizeLicenseKeyValue(input.key || state.credentials.key);
    const deviceId = normalizeLicenseKeyValue(input.deviceId || state.credentials.deviceId);
    const source = pickValidationSource(input);
    const normalizedUsage = normalizeLicenseUsage({
      ...source,
      ...input,
      ...(source && typeof source.licenseUsage === 'object' ? source.licenseUsage : {}),
      ...(input.licenseUsage && typeof input.licenseUsage === 'object' ? input.licenseUsage : {}),
    });
    const cardExpiryDate = String(
      input.cardExpiryDate
      ?? input.expiryDate
      ?? input.expireAt
      ?? source.cardExpiryDate
      ?? source.expiryDate
      ?? source.expireAt
      ?? source.expire_at
      ?? normalizedUsage?.expire_at
      ?? '',
    ).trim();
    const daysLeft = input.daysLeft ?? source.daysLeft ?? source.days_left ?? normalizedUsage?.days_left ?? null;
    const expiresInSeconds = input.expiresInSeconds ?? source.expiresInSeconds ?? source.expires_in_seconds ?? normalizedUsage?.expires_in_seconds ?? null;
    const accountType = String(
      input.accountType
      ?? input.account_type
      ?? source.accountType
      ?? source.account_type
      ?? ''
    );
    const accountTypeLabel = String(
      input.accountTypeLabel
      ?? input.account_type_label
      ?? source.accountTypeLabel
      ?? source.account_type_label
      ?? ''
    );
    state.validation = {
      ...createEmptyValidationState(),
      bound: input.bound !== undefined ? input.bound === true : true,
      validated: input.validated !== undefined ? input.validated === true : true,
      key,
      deviceId,
      licenseValidated: input.licenseValidated !== undefined ? input.licenseValidated === true : true,
      cardStatus: String(input.cardStatus || source.cardStatus || source.status || ''),
      cardExpiryDate,
      expiryDate: String(input.expiryDate || source.expiryDate || ''),
      expireAt: String(input.expireAt || source.expireAt || source.expire_at || normalizedUsage?.expire_at || ''),
      daysLeft: toFiniteNumber(daysLeft),
      expiresInSeconds: toFiniteNumber(expiresInSeconds),
      licenseUsage: normalizedUsage ? clone(normalizedUsage) : null,
      maxUsageTimes: normalizedUsage?.max_usage_times ?? null,
      usedUsageTimes: normalizedUsage?.used_usage_times ?? null,
      remainingUsageTimes: normalizedUsage?.remaining_usage_times ?? null,
      canSelfUnbind: input.canSelfUnbind === true,
      remainingUnbindTimes: input.remainingUnbindTimes ?? null,
      maxUnbindTimes: input.maxUnbindTimes ?? null,
      usedUnbindTimes: input.usedUnbindTimes ?? null,
      deviceBindCount: input.deviceBindCount ?? null,
      maxDeviceCount: input.maxDeviceCount ?? null,
      deviceBindingStatus: String(input.deviceBindingStatus || ''),
      deviceBindingSummary: String(input.deviceBindingSummary || ''),
      accountType,
      accountTypeLabel,
      currentAccountType: String(input.currentAccountType || source.currentAccountType || accountType || source.account_type || ''),
      currentAccountTypeLabel: String(input.currentAccountTypeLabel || source.currentAccountTypeLabel || accountTypeLabel || source.account_type_label || ''),
      lastValidatedAt: input.lastValidatedAt || new Date().toISOString(),
      result: clone(source),
      message: String(input.message || ''),
    };
    state.credentials.key = key;
    state.credentials.deviceId = deviceId;
    return getValidationState();
  }

// 设置/更新/持久化：setUnboundState的具体业务逻辑。
  function setUnboundState(input = {}) {
    const key = normalizeLicenseKeyValue(input.key || state.credentials.key);
    const deviceId = normalizeLicenseKeyValue(input.deviceId || state.credentials.deviceId);
    state.validation = {
      ...createEmptyValidationState(),
      key,
      deviceId,
      bound: false,
      validated: false,
      licenseValidated: false,
      licenseUsage: null,
    };
    state.credentials.key = key;
    state.credentials.deviceId = deviceId;
    return getValidationState();
  }

// 停止/关闭/清理：clearValidationState的具体业务逻辑。
  function clearValidationState() {
    state.validation = createEmptyValidationState();
    state.validation.key = state.credentials.key;
    state.validation.deviceId = state.credentials.deviceId;
    return getValidationState();
  }

// 获取/读取/解析：getValidationState的具体业务逻辑。
  function getValidationState() {
    return clone(state.validation) || createEmptyValidationState();
  }

// 获取/读取/解析：getSnapshot的具体业务逻辑。
  function getSnapshot() {
    return {
      ...getCredentials(),
      ...getValidationState(),
      ...getRuntimeConfig(),
    };
  }

// 获取/读取/解析：getRecords的具体业务逻辑。
  function getRecords() {
    return clone(state.records) || [];
  }

// 设置/更新/持久化：setRecords的具体业务逻辑。
  function setRecords(records) {
    state.records = normalizeLicenseRecords(records);
    return getRecords();
  }

// 处理：appendRecord的具体业务逻辑。
  function appendRecord(entry = {}) {
    const normalized = normalizeLicenseRecord(entry);
    if (!normalized) return null;
    state.records = state.records.filter((item) => String(item.keyValue || '') !== normalized.keyValue);
    state.records.unshift(normalized);
    if (state.records.length > 50) {
      state.records = state.records.slice(0, 50);
    }
    return clone(normalized);
  }

// 移除/删除：deleteRecord的具体业务逻辑。
  function deleteRecord({ keyValue, id } = {}) {
    const normalizedKey = normalizeLicenseKeyValue(keyValue);
    const normalizedId = normalizeLicenseKeyValue(id);
    const before = state.records.length;
    state.records = state.records.filter((item) => {
      const itemKey = normalizeLicenseKeyValue(item?.keyValue);
      const itemId = normalizeLicenseKeyValue(item?.id);
      if (normalizedId && itemId && itemId === normalizedId) return false;
      if (normalizedKey && itemKey && itemKey === normalizedKey) return false;
      return true;
    });
    return before - state.records.length;
  }

// 停止/关闭/清理：clearRecords的具体业务逻辑。
  function clearRecords() {
    state.records = [];
    return [];
  }

  return {
    setCredentials,
    getCredentials,
    setValidationState,
    setUnboundState,
    clearValidationState,
    setRuntimeConfig,
    getRuntimeConfig,
    getValidationState,
    getSnapshot,
    getRecords,
    setRecords,
    appendRecord,
    deleteRecord,
    clearRecords,
  };
}

module.exports = {
  createLicenseCache,
};
