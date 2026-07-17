const FREE_BROWSER_WINDOW_LIMIT = 5;
const VIP_VERIFICATION_MAX_AGE_MS = 10 * 60 * 1000;
const VIP_CLOCK_SKEW_MS = 60 * 1000;

function parseVipExpiry(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function collectVipSources(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const candidates = [
    source.validation?.result,
    source.validation,
    source.result,
    source,
    source.account,
    source.result?.account,
  ];
  return candidates.filter((item) => item && typeof item === 'object');
}

function resolveVipAccess(input = {}, now = Date.now()) {
  const sources = collectVipSources(input);
  const verification = sources.find((source) => source.vip_server_verified === true);
  const verifiedAt = Date.parse(String(verification?.vip_verified_at || ''));
  const serverVerified = Number.isFinite(verifiedAt)
    && verifiedAt <= now + VIP_CLOCK_SKEW_MS
    && now - verifiedAt <= VIP_VERIFICATION_MAX_AGE_MS;
  let enabled = false;
  let statusResolved = false;
  let expiryDate = '';
  for (const source of sources) {
    const hasStatus = ['is_vip', 'isVip', 'vip_active', 'vipActive']
      .some((key) => Object.prototype.hasOwnProperty.call(source, key));
    if (!statusResolved && hasStatus) {
      enabled = source.is_vip === true || source.isVip === true || source.vip_active === true || source.vipActive === true
        || Number(source.is_vip) === 1 || Number(source.isVip) === 1;
      statusResolved = true;
    }
    const candidateExpiry = String(source.vip_expiry_date || source.vipExpiryDate || '').trim();
    if (!expiryDate && candidateExpiry) expiryDate = candidateExpiry;
  }
  const expiryTimestamp = parseVipExpiry(expiryDate);
  const active = serverVerified && enabled
    && (expiryTimestamp === null || (Number.isFinite(expiryTimestamp) && expiryTimestamp > now));
  return {
    isVip: active,
    vipActive: active,
    vipExpiryDate: expiryDate,
    permanent: active && !expiryDate,
    serverVerified,
    verifiedAt: Number.isFinite(verifiedAt) ? new Date(verifiedAt).toISOString() : '',
  };
}

function markVipServerVerified(source = {}, verifiedAt = Date.now()) {
  const value = source && typeof source === 'object' ? source : {};
  return {
    ...value,
    vip_server_verified: true,
    vip_verified_at: new Date(verifiedAt).toISOString(),
  };
}

function clearVipServerVerification(source = {}) {
  const value = source && typeof source === 'object' ? source : {};
  const clear = (item) => ({
    ...(item && typeof item === 'object' ? item : {}),
    is_vip: false,
    isVip: false,
    vip_active: false,
    vipActive: false,
    vip_server_verified: false,
    vip_verified_at: '',
  });
  return {
    ...clear(value),
    ...(value.result && typeof value.result === 'object' ? { result: clear(value.result) } : {}),
    ...(value.account && typeof value.account === 'object' ? { account: clear(value.account) } : {}),
  };
}

function readStoredVipAccess(readStoreConfigSafe) {
  try {
    const store = typeof readStoreConfigSafe === 'function' ? readStoreConfigSafe() : {};
    return resolveVipAccess(store?.userCredentials || {});
  } catch (_) {
    return resolveVipAccess({});
  }
}

function createVipRequiredResult(feature = '此功能') {
  return {
    ok: false,
    vipRequired: true,
    code: 'VIP_REQUIRED',
    message: `${feature}仅限 VIP 用户，请前往个人中心开通 VIP`,
  };
}

module.exports = {
  FREE_BROWSER_WINDOW_LIMIT,
  VIP_VERIFICATION_MAX_AGE_MS,
  clearVipServerVerification,
  createVipRequiredResult,
  markVipServerVerified,
  parseVipExpiry,
  readStoredVipAccess,
  resolveVipAccess,
};
