function normalizeLicenseKeyValue(value) {
  return String(value || '').trim();
}

function normalizeLicenseRecord(entry = {}, options = {}) {
  if (!entry) return null;
  if (options.requireSuccessStatus === true && entry.status && entry.status !== 'success') {
    return null;
  }

  const keyValue = normalizeLicenseKeyValue(entry.keyValue || entry.key || '');
  if (!keyValue) return null;

  const platformName = normalizeLicenseKeyValue(
    entry.platformName
    || entry.platform
    || entry.currentPlatformName
    || ''
  );

  const normalized = {
    id: String(entry.id || keyValue || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    keyValue,
  };

  if (platformName) {
    normalized.platformName = platformName;
  }

  if (options.includeTimestamps === true) {
    const savedAt = normalizeLicenseKeyValue(entry.savedAt || entry.createdAt || '');
    const updatedAt = normalizeLicenseKeyValue(entry.updatedAt || '');
    if (savedAt) normalized.savedAt = savedAt;
    if (updatedAt) normalized.updatedAt = updatedAt;
  }

  return normalized;
}

function normalizeLicenseRecords(records, options = {}) {
  const seenKeys = new Set();
  const cleaned = [];
  const maxRecords = Number.isFinite(Number(options.maxRecords)) ? Number(options.maxRecords) : 50;

  for (const item of Array.isArray(records) ? records : []) {
    const normalized = normalizeLicenseRecord(item, options);
    if (!normalized || seenKeys.has(normalized.keyValue)) continue;
    seenKeys.add(normalized.keyValue);
    cleaned.push(normalized);
    if (cleaned.length >= maxRecords) break;
  }

  return cleaned;
}

module.exports = {
  normalizeLicenseKeyValue,
  normalizeLicenseRecord,
  normalizeLicenseRecords,
};
