function pickFirstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function pickFirstValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

function extractNestedText(source) {
  if (!source || typeof source !== 'object') return '';
  return pickFirstText(
    source.message,
    source.msg,
    source.error,
    source.reason,
    source.detail,
    source.description,
    source.error_description,
    source.errorMessage,
    source.data?.message,
    source.data?.msg,
    source.data?.error,
    source.data?.reason,
    source.data?.detail,
    source.data?.description,
    source.data?.error_description,
    source.data?.errorMessage,
    source.result?.message,
    source.result?.msg,
    source.result?.error,
    source.result?.reason,
    source.result?.detail,
    source.result?.description,
    source.result?.error_description,
    source.result?.errorMessage,
    source.payload?.message,
    source.payload?.msg,
    source.payload?.error,
    source.payload?.reason,
    source.payload?.detail,
    source.payload?.description,
    source.payload?.error_description,
    source.payload?.errorMessage,
    source.announcement?.message,
    source.announcement?.msg,
    source.announcement?.error,
    source.announcement?.reason,
    source.announcement?.detail,
    source.announcement?.description,
    source.announcement?.error_description,
    source.announcement?.errorMessage,
  );
}

function extractValidationState(source) {
  if (!source || typeof source !== 'object') return '';
  const raw = pickFirstText(
    source.code,
    source.error_code,
    source.errorCode,
    source.card_state,
    source.cardState,
    source.state,
    source.status,
    source.message_type,
    source.result?.card_state,
    source.result?.code,
    source.result?.error_code,
    source.result?.errorCode,
    source.result?.cardState,
    source.result?.state,
    source.result?.status,
    source.data?.card_state,
    source.data?.code,
    source.data?.error_code,
    source.data?.errorCode,
    source.data?.cardState,
    source.data?.state,
    source.data?.status,
    source.payload?.card_state,
    source.payload?.code,
    source.payload?.error_code,
    source.payload?.errorCode,
    source.payload?.cardState,
    source.payload?.state,
    source.payload?.status,
  ).toLowerCase();

  if (!raw) return '';
  if (['active', 'success', 'valid', 'enabled', 'normal', 'ok', 'passed', 'pass'].includes(raw)) return 'active';
  if (['disabled', 'disable', 'inactive', 'blocked', 'banned', 'revoked', 'forbidden', 'frozen', 'card_disabled', 'card_blocked', 'card_revoked'].includes(raw)) return 'disabled';
  if (['expired', 'expire', 'expired_at', 'overdue'].includes(raw)) return 'expired';
  if (['not_found', 'missing', 'absent', 'none', 'unfound', 'card_not_found', 'notexist', 'not_exist'].includes(raw)) return 'not_found';
  if (['pending', 'pending_activation', 'not_started', 'unverified', 'not_active'].includes(raw)) return 'pending';
  return raw;
}

function isValidationSuccess(resp) {
  if (!resp || typeof resp !== 'object') return false;
  if (resp.valid === true || resp.is_valid === true || resp.success === true || resp.ok === true) return true;
  return extractValidationState(resp) === 'active';
}

function getValidationFailureMessage(resp, fallback = '卡密无效或已过期') {
  const message = extractNestedText(resp);
  if (message) return message;

  const state = extractValidationState(resp);
  const stateMessages = {
    not_found: '卡密不存在',
    expired: '卡密已过期',
    disabled: '卡密已被禁用',
    revoked: '卡密已被撤销',
    pending: '卡密暂未生效',
    active: '',
  };
  if (Object.prototype.hasOwnProperty.call(stateMessages, state) && stateMessages[state]) {
    return stateMessages[state];
  }

  if (resp && (resp.valid === false || resp.is_valid === false || resp.success === false || resp.ok === false)) {
    return fallback;
  }

  return fallback;
}

module.exports = {
  extractNestedText,
  extractValidationState,
  getValidationFailureMessage,
  isValidationSuccess,
  pickFirstText,
  pickFirstValue,
};
