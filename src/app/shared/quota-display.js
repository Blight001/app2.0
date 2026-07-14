(function initQuotaDisplay(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AiFreeQuotaDisplay = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function quotaDisplayFactory() {
  const STORAGE_PREFIX = 'ai-free.quota-display-baseline.v1.';
  const NORMALIZED_FLAG = '__softwareQuotaNormalized';

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function currentScope() {
    if (typeof document === 'undefined') return 'local';
    const username = String(document.getElementById('account-username-display')?.value || '').trim();
    const deviceId = String(document.getElementById('device-id')?.value || '').trim();
    return `${username || 'anonymous'}|${deviceId || 'device'}`;
  }

  function optionsWithDefaults(options = {}) {
    return {
      storage: options.storage || (typeof localStorage !== 'undefined' ? localStorage : null),
      scope: String(options.scope || currentScope()),
    };
  }

  function readState(options = {}) {
    const { storage, scope } = optionsWithDefaults(options);
    if (!storage) return { version: 1, ai: null, traffic: null };
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_PREFIX + scope) || 'null');
      return {
        version: 1,
        ai: parsed?.ai && typeof parsed.ai === 'object' ? parsed.ai : null,
        traffic: parsed?.traffic && typeof parsed.traffic === 'object' ? parsed.traffic : null,
      };
    } catch (_) {
      return { version: 1, ai: null, traffic: null };
    }
  }

  function writeState(state, options = {}) {
    const { storage, scope } = optionsWithDefaults(options);
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_PREFIX + scope, JSON.stringify({
        version: 1,
        ai: state?.ai || null,
        traffic: state?.traffic || null,
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearBaseline(kind, options = {}) {
    const state = readState(options);
    state[kind] = null;
    writeState(state, options);
  }

  function marked(quota) {
    return { ...quota, [NORMALIZED_FLAG]: true };
  }

  function normalizeAIQuota(quota, options = {}) {
    if (!quota || typeof quota !== 'object' || quota[NORMALIZED_FLAG] === true || quota.unlimited === true) {
      return quota;
    }
    const total = finiteNumber(quota.quota);
    const used = finiteNumber(quota.used);
    const baseline = readState(options).ai;
    if (!baseline) return marked(quota);
    const baseTotal = finiteNumber(baseline.total);
    const baseUsed = finiteNumber(baseline.used);
    if (total < baseTotal || used < baseUsed) {
      clearBaseline('ai', options);
      return marked(quota);
    }
    const displayTotal = Math.max(0, total - baseTotal);
    const displayUsed = Math.max(0, used - baseUsed);
    return marked({
      ...quota,
      quota: displayTotal,
      used: displayUsed,
      remaining: Math.max(0, displayTotal - displayUsed),
    });
  }

  function normalizeTrafficQuota(quota, options = {}) {
    if (!quota || typeof quota !== 'object' || quota[NORMALIZED_FLAG] === true || quota.unlimited === true) {
      return quota;
    }
    const total = finiteNumber(quota.quota_bytes);
    const upload = finiteNumber(quota.upload_used_bytes);
    const download = finiteNumber(quota.download_used_bytes);
    const baseline = readState(options).traffic;
    if (!baseline) return marked(quota);
    const baseTotal = finiteNumber(baseline.total);
    const baseUpload = finiteNumber(baseline.upload);
    const baseDownload = finiteNumber(baseline.download);
    if (total < baseTotal || upload < baseUpload || download < baseDownload) {
      clearBaseline('traffic', options);
      return marked(quota);
    }
    const displayUpload = Math.max(0, upload - baseUpload);
    const displayDownload = Math.max(0, download - baseDownload);
    const displayUsed = displayUpload + displayDownload;
    const displayTotal = Math.max(0, total - baseTotal);
    const remaining = Math.max(0, displayTotal - displayUsed);
    return marked({
      ...quota,
      quota_bytes: displayTotal,
      upload_used_bytes: displayUpload,
      download_used_bytes: displayDownload,
      used_bytes: displayUsed,
      remaining_bytes: remaining,
      exhausted: remaining <= 0,
    });
  }

  function recordAIResetAfterRedeem(quota, addedQuota, options = {}) {
    if (!quota || quota.unlimited === true) return normalizeAIQuota(quota, options);
    const total = finiteNumber(quota.quota);
    const used = finiteNumber(quota.used);
    const added = finiteNumber(addedQuota);
    if (added <= 0) return normalizeAIQuota(quota, options);
    const previousTotal = total - added;
    const previousDisplay = normalizeAIQuota({
      ...quota,
      quota: previousTotal,
      remaining: Math.max(0, previousTotal - used),
    }, options);
    if (finiteNumber(previousDisplay?.remaining, previousDisplay?.quota - previousDisplay?.used) <= 0) {
      const state = readState(options);
      state.ai = { total: previousTotal, used, createdAt: Date.now() };
      writeState(state, options);
    }
    return normalizeAIQuota(quota, options);
  }

  function recordTrafficResetAfterRedeem(quota, addedBytes, options = {}) {
    if (!quota || quota.unlimited === true) return normalizeTrafficQuota(quota, options);
    const total = finiteNumber(quota.quota_bytes);
    const upload = finiteNumber(quota.upload_used_bytes);
    const download = finiteNumber(quota.download_used_bytes);
    const added = finiteNumber(addedBytes);
    if (added <= 0) return normalizeTrafficQuota(quota, options);
    const previousTotal = total - added;
    const previousDisplay = normalizeTrafficQuota({
      ...quota,
      quota_bytes: previousTotal,
      remaining_bytes: Math.max(0, previousTotal - upload - download),
    }, options);
    if (finiteNumber(previousDisplay?.remaining_bytes, previousDisplay?.quota_bytes - previousDisplay?.used_bytes) <= 0) {
      const state = readState(options);
      state.traffic = { total: previousTotal, upload, download, createdAt: Date.now() };
      writeState(state, options);
    }
    return normalizeTrafficQuota(quota, options);
  }

  return {
    normalizeAIQuota,
    normalizeTrafficQuota,
    recordAIResetAfterRedeem,
    recordTrafficResetAfterRedeem,
  };
}));
