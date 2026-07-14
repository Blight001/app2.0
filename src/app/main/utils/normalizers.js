function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function normalizeTimeValueToMs(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    if (value > 0) return Math.floor(value * 1000);
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    if (text.length >= 13) return Math.floor(num);
    if (text.length === 10) return Math.floor(num * 1000);
    if (num > 1e12) return Math.floor(num);
    if (num > 1e9) return Math.floor(num * 1000);
    return Math.floor(num * 1000);
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeCurrentAccountType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (['shared', 'temporary', 'temp', 'midnight_clear', 'clear_at_24', '24h', '24-hour'].includes(text)) return 'shared';
  if (['one_time', 'one-time', 'permanent', 'long_term', 'long-term', 'longterm', 'binding', 'bound'].includes(text)) return 'one_time';
  if (['disposable', 'throwaway', 'single_use', 'single-use'].includes(text)) return 'disposable';
  return text;
}

function inferCurrentAccountTypeFromLabel(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  if (text.includes('永久') || text.includes('长久') || text.includes('一次')) return 'one_time';
  if (text.includes('绑定')) return 'one_time';
  if (text.includes('次抛') || text.includes('disposable') || text.includes('throwaway')) return 'disposable';
  if (text.includes('循环') || text.includes('24点') || text.includes('清空') || text.includes('临时')) return 'shared';
  return '';
}

function resolveCurrentAccountType(rawType, rawLabel) {
  return normalizeCurrentAccountType(rawType) || inferCurrentAccountTypeFromLabel(rawLabel) || '';
}

function getCurrentAccountTypeLabel(value) {
  const type = normalizeCurrentAccountType(value);
  if (type === 'shared') return '循环账号';
  if (type === 'one_time') return '绑定账号';
  if (type === 'disposable') return '次抛账号';
  return '';
}

function normalizeLicenseUsage(source = {}) {
  if (!source || typeof source !== 'object') return null;

  const maxUsageTimes = toFiniteNumber(source.max_usage_times ?? source.maxUsageTimes);
  const usedUsageTimes = toFiniteNumber(source.used_usage_times ?? source.usedUsageTimes);
  const remainingUsageTimes = toFiniteNumber(source.remaining_usage_times ?? source.remainingUsageTimes);
  const expireAt = String(source.expire_at ?? source.expireAt ?? source.cardExpiryDate ?? source.expiryDate ?? '').trim();
  const daysLeft = source.days_left ?? source.daysLeft;
  const expiresInSeconds = source.expires_in_seconds ?? source.expiresInSeconds;

  if (
    maxUsageTimes === null
    && usedUsageTimes === null
    && remainingUsageTimes === null
    && !expireAt
    && daysLeft === undefined
    && expiresInSeconds === undefined
  ) {
    return null;
  }

  const normalized = {
    max_usage_times: maxUsageTimes,
    used_usage_times: usedUsageTimes,
    remaining_usage_times: remainingUsageTimes,
  };

  if (expireAt) normalized.expire_at = expireAt;
  if (daysLeft !== undefined) normalized.days_left = daysLeft;
  if (expiresInSeconds !== undefined) normalized.expires_in_seconds = expiresInSeconds;
  return normalized;
}

function normalizeTabBrowserProxyMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['inherit', 'proxy', 'direct'].includes(mode) ? mode : 'inherit';
}

module.exports = {
  getCurrentAccountTypeLabel,
  inferCurrentAccountTypeFromLabel,
  normalizeLicenseUsage,
  normalizePositiveNumber,
  normalizeTabBrowserProxyMode,
  normalizeTimeValueToMs,
  resolveCurrentAccountType,
  toFiniteNumber,
};
