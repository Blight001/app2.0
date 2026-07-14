const ACCOUNT_AUTH_TYPE = 'account';
const {
  inferServerMode,
  normalizeServerMode,
} = require('./server-mode');

function clonePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return {};
  }
}

function normalizeAccountSession(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authType = String(source.authType || source.auth_type || '').trim().toLowerCase();
  const serverBase = String(source.serverBase || source.server_base || '').trim().replace(/\/+$/, '');
  const hasLegacyTenant = Boolean(String(source.tenantId || source.tenant_id || '').trim())
    || /\/t\/[^/]+(?:\/|$)/i.test(serverBase);
  const session = {
    authType,
    username: String(source.username || '').trim(),
    key: String(source.key || source.credential || '').trim(),
    deviceId: String(source.deviceId || source.device_id || '').trim(),
    platformName: String(source.platformName || source.platform_name || '').trim(),
    serverBase,
    serverMode: normalizeServerMode(
      source.serverMode || source.server_mode,
      inferServerMode(serverBase),
    ),
    authenticatedAt: String(source.authenticatedAt || source.authenticated_at || '').trim(),
    account: clonePlainObject(source.account),
    validation: clonePlainObject(source.validation),
  };

  session.authenticated = Boolean(
    session.authType === ACCOUNT_AUTH_TYPE
    && session.username
    && session.key
    && session.deviceId
    && session.serverBase
    && !hasLegacyTenant
  );
  return session;
}

function buildStoredAccountSession({
  current = {},
  username = '',
  key = '',
  deviceId = '',
  platformName = '',
  serverBase = '',
  serverMode = '',
  account = {},
  validation = {},
  authenticatedAt = new Date().toISOString(),
} = {}) {
  return serializeAccountSession({
    ...(current && typeof current === 'object' ? current : {}),
    authType: ACCOUNT_AUTH_TYPE,
    username,
    key,
    deviceId,
    platformName,
    serverBase,
    serverMode: normalizeServerMode(serverMode, inferServerMode(serverBase)),
    authenticatedAt,
    account,
    validation,
  });
}

function serializeAccountSession(input = {}) {
  const session = normalizeAccountSession(input);
  if (!session.authenticated) return {};
  const { authenticated: _authenticated, ...stored } = session;
  return stored;
}

module.exports = {
  ACCOUNT_AUTH_TYPE,
  buildStoredAccountSession,
  normalizeAccountSession,
  serializeAccountSession,
};
