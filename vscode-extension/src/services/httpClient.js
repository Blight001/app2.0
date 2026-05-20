const http = require('http');
const https = require('https');

function normalizeRequestArgs(methodOrUrl, urlOrOptions, maybeOptions) {
  if (typeof urlOrOptions === 'string') {
    return {
      method: String(methodOrUrl || 'GET').toUpperCase(),
      url: urlOrOptions,
      options: maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {},
    };
  }
  const options = urlOrOptions && typeof urlOrOptions === 'object' ? urlOrOptions : {};
  return {
    method: String(options.method || 'GET').toUpperCase(),
    url: methodOrUrl,
    options,
  };
}

function requestJson(methodOrUrl, urlOrOptions = {}, maybeOptions = {}) {
  return new Promise((resolve, reject) => {
    const { method, url, options } = normalizeRequestArgs(methodOrUrl, urlOrOptions, maybeOptions);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(new Error(`无效请求地址: ${url}`));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const timeoutMs = Number(options.timeoutMs) || 15000;
    const headers = options.headers && typeof options.headers === 'object' ? { ...options.headers } : {};
    const data = options.data;
    const body = ['GET', 'HEAD'].includes(method) || data === undefined
      ? null
      : Buffer.from(JSON.stringify(data));
    const transport = isHttps ? https : http;
    const req = transport.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      timeout: timeoutMs,
      ...(isHttps ? { rejectUnauthorized: false } : {}),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
        ...(body ? {
          'Content-Length': body.length,
        } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let bodyValue = raw;
        try {
          bodyValue = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          body: bodyValue,
          raw,
        });
      });
    });

    req.on('timeout', () => req.destroy(new Error(`请求超时（${timeoutMs / 1000 | 0}秒）`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postJson(url, data, timeoutMs = 15000, options = {}) {
  return requestJson('POST', url, { ...options, data, timeoutMs });
}

function getJson(url, timeoutMs = 15000, options = {}) {
  if (timeoutMs && typeof timeoutMs === 'object') {
    options = timeoutMs || {};
    timeoutMs = Number(options.timeoutMs || 15000);
  }
  return requestJson('GET', url, { ...options, timeoutMs });
}

function httpGetUniversal(url, timeoutMs = 10000) {
  return requestJson('GET', url, {
    timeoutMs,
    headers: { Accept: 'application/json' },
  });
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeLicenseUsage(source = {}) {
  if (!source || typeof source !== 'object') return null;
  const maxUsageTimes = toFiniteNumber(source.max_usage_times ?? source.maxUsageTimes);
  const usedUsageTimes = toFiniteNumber(source.used_usage_times ?? source.usedUsageTimes);
  const remainingUsageTimes = toFiniteNumber(source.remaining_usage_times ?? source.remainingUsageTimes);
  const expireAt = source.expire_at ?? source.expireAt ?? source.expiryDate ?? source.expiry_date ?? '';
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

  const out = {
    max_usage_times: maxUsageTimes,
    used_usage_times: usedUsageTimes,
    remaining_usage_times: remainingUsageTimes,
  };
  if (expireAt) out.expire_at = expireAt;
  if (daysLeft !== undefined) out.days_left = daysLeft;
  if (expiresInSeconds !== undefined) out.expires_in_seconds = expiresInSeconds;
  return out;
}

function normalizeValidationResult(source = {}) {
  const body = source && typeof source === 'object' ? source : {};
  const state = String(body.state || body.status || '').trim().toLowerCase();
  const valid = Object.prototype.hasOwnProperty.call(body, 'valid')
    ? body.valid === true
    : (
        body.ok === true
        || body.success === true
        || body.is_valid === true
        || ['active', 'valid', 'enabled', 'success', 'ok'].includes(state)
      );
  const usage = normalizeLicenseUsage(body);
  return {
    ok: valid,
    valid,
    message: body.message || body.msg || (valid ? '卡密有效' : '卡密验证失败'),
    state: state || (valid ? 'active' : ''),
    expire_at: body.expire_at || body.expireAt || body.expiryDate || body.expiry_date || '',
    days_left: body.days_left ?? body.daysLeft ?? null,
    remaining_usage_times: body.remaining_usage_times ?? body.remainingUsageTimes ?? usage?.remaining_usage_times ?? null,
    max_usage_times: body.max_usage_times ?? body.maxUsageTimes ?? usage?.max_usage_times ?? null,
    used_usage_times: body.used_usage_times ?? body.usedUsageTimes ?? usage?.used_usage_times ?? null,
    account_type: body.account_type || body.accountType || '',
    account_type_label: body.account_type_label || body.accountTypeLabel || '',
    current_account_type: body.current_account_type || body.currentAccountType || body.account_type || body.accountType || '',
    current_account_type_label: body.current_account_type_label || body.currentAccountTypeLabel || body.account_type_label || body.accountTypeLabel || '',
    raw: body,
  };
}

function normalizeServerCookies(raw, fallbackUrl = '') {
  if (!raw) return [];
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw.filter((item) => item && typeof item === 'object');
  } else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.cookies)) {
      arr = raw.cookies.filter((item) => item && typeof item === 'object');
    } else {
      arr = Object.entries(raw).map(([name, value]) => ({ name: String(name), value: String(value) }));
    }
  }
  return arr.map((cookie) => {
    const out = { path: '/', ...cookie };
    if (!out.url) {
      if (out.domain) {
        const host = String(out.domain).replace(/^\./, '');
        out.url = `https://${host}/`;
      } else if (fallbackUrl) {
        out.url = fallbackUrl;
      }
    }
    return out;
  });
}

function normalizeServerBrowserStorage(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const origin = String(entry.origin ?? entry.Origin ?? '').trim();
      const url = String(entry.url ?? entry.URL ?? '').trim();
      const localStorage = entry.localStorage && typeof entry.localStorage === 'object' ? entry.localStorage : {};
      const sessionStorage = entry.sessionStorage && typeof entry.sessionStorage === 'object' ? entry.sessionStorage : {};
      if (!origin && !url) return null;
      return { origin, url, localStorage, sessionStorage };
    })
    .filter(Boolean);
}

function extractBrowserStorageFromResponse(source) {
  if (!source || typeof source !== 'object') return [];
  const candidates = [
    source.browserStorage,
    source.browser_storage,
    source.data?.browserStorage,
    source.data?.browser_storage,
    source.result?.browserStorage,
    source.result?.browser_storage,
    source.payload?.browserStorage,
    source.payload?.browser_storage,
  ];
  for (const value of candidates) {
    const normalized = normalizeServerBrowserStorage(value);
    if (normalized.length > 0) return normalized;
  }
  return [];
}

function extractAccountFromResponse(source) {
  if (!source || typeof source !== 'object') return '';
  const candidates = [
    source.account,
    source.accountName,
    source.username,
    source.user_name,
    source.data?.account,
    source.data?.accountName,
    source.data?.username,
    source.result?.account,
    source.result?.accountName,
    source.result?.username,
    source.payload?.account,
    source.payload?.accountName,
    source.payload?.username,
  ];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  const message = String(source.message || source.msg || '').trim();
  const accountMatch = message.match(/已分配账号[：:]\s*([^\s（()]+)/);
  return accountMatch?.[1] ? String(accountMatch[1]).trim() : '';
}

function extractCurrentAccountTypeInfo(source = {}) {
  const body = source && typeof source === 'object' ? source : {};
  return {
    currentAccountType: String(
      body.currentAccountType
      || body.current_account_type
      || body.accountType
      || body.account_type
      || ''
    ).trim(),
    currentAccountTypeLabel: String(
      body.currentAccountTypeLabel
      || body.current_account_type_label
      || body.accountTypeLabel
      || body.account_type_label
      || ''
    ).trim(),
  };
}

function extractServerRecycleTimeInfo(source = {}) {
  const body = source && typeof source === 'object' ? source : {};
  return {
    remainingSeconds: body.remainingSeconds ?? body.remaining_seconds ?? null,
    remainingMinutes: body.remainingMinutes ?? body.remaining_minutes ?? null,
    nextRefreshAt: body.nextRefreshAt || body.next_refresh_at || '',
    serverRecycleTime: body.serverRecycleTime || body.server_recycle_time || '',
    serverRecycleTimeIso: body.serverRecycleTimeIso || body.server_recycle_time_iso || '',
  };
}

function normalizeCookieFetchResult(source = {}, fallbackUrl = '') {
  const body = source && typeof source === 'object' ? source : {};
  const cookiesRaw = body.cookies || body.data || body.cookie;
  const cookies = normalizeServerCookies(cookiesRaw, fallbackUrl);
  const currentAccountTypeInfo = extractCurrentAccountTypeInfo(body);
  return {
    ok: body.ok !== false && body.success !== false && body.valid !== false && body.is_valid !== false && cookies.length > 0,
    message: body.message || body.msg || '',
    cookies,
    browserStorage: extractBrowserStorageFromResponse(body),
    account: extractAccountFromResponse(body) || '未知账号',
    platform: body.platform || '',
    ...extractServerRecycleTimeInfo(body),
    ...currentAccountTypeInfo,
    current_account_type: currentAccountTypeInfo.currentAccountType,
    current_account_type_label: currentAccountTypeInfo.currentAccountTypeLabel,
    raw: body,
  };
}

function buildServerUrl(serverBase, endpoint) {
  const base = String(serverBase || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('HTTP服务器地址未配置');
  return `${base}${endpoint}`;
}

async function validateKeyOnServer(serverBase, { key, deviceId, device_id: deviceIdSnake } = {}, timeoutMs = 12000) {
  const resp = await postJson(buildServerUrl(serverBase, '/api/validate_key'), {
    key,
    device_id: deviceIdSnake || deviceId,
  }, timeoutMs);
  const body = resp && resp.body && typeof resp.body === 'object' ? resp.body : {};
  return {
    response: resp,
    validation: normalizeValidationResult({
      ok: resp.ok,
      status: resp.status,
      ...body,
    }),
  };
}

async function unbindDeviceOnServer(serverBase, { key, deviceId, device_id: deviceIdSnake } = {}, timeoutMs = 15000) {
  const resp = await postJson(buildServerUrl(serverBase, '/api/unbind_device'), {
    key,
    device_id: deviceIdSnake || deviceId,
    deviceId: deviceIdSnake || deviceId,
  }, timeoutMs);
  const body = resp && resp.body && typeof resp.body === 'object' ? resp.body : {};
  return {
    response: resp,
    ok: resp.ok && body.ok !== false && body.success !== false,
    message: body.message || body.msg || (resp.ok ? '解绑成功' : '解绑失败'),
    data: body.data && typeof body.data === 'object' ? body.data : body,
    raw: body,
  };
}

async function fetchServerCookie(serverBase, { key, deviceId, device_id: deviceIdSnake, platform } = {}, options = {}) {
  const fallbackUrl = String(options.fallbackUrl || options.targetUrl || '').trim();
  const resp = await postJson(buildServerUrl(serverBase, '/api/fetch_cookie'), {
    key,
    device_id: deviceIdSnake || deviceId,
    platform,
  }, options.timeoutMs || 15000);
  const body = resp && resp.body && typeof resp.body === 'object' ? resp.body : {};
  const result = normalizeCookieFetchResult(body, fallbackUrl);
  return {
    response: resp,
    result: {
      ...result,
      ok: resp.ok && result.ok,
    },
  };
}

function resolveSubscriptionUrl(value, serverBase = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return raw;
  const base = String(serverBase || '').trim();
  if (!base) return raw;
  try {
    return new URL(raw, base.endsWith('/') ? base : `${base}/`).toString();
  } catch (_) {
    return raw;
  }
}

// 拉取机场订阅链接的原始内容（可能是 base64 或 yaml 文本）。
async function fetchSubscriptionContent(url, serverBase = '', timeoutMs = 15000) {
  const targetUrl = resolveSubscriptionUrl(url, serverBase);
  if (!targetUrl) return '';
  const resp = await httpGetUniversal(targetUrl, timeoutMs);
  if (!resp || resp.ok !== true) {
    throw new Error(`订阅链接请求失败: ${resp?.status || 'unknown'}`);
  }
  if (resp.body && typeof resp.body === 'object') {
    const fields = [resp.body.config, resp.body.data, resp.body.content, resp.body.yaml_content];
    for (const field of fields) {
      if (typeof field === 'string' && field.trim()) return field.trim();
    }
  }
  return String(resp.raw || '').trim();
}

// 从客户端 HTTP 服务获取 Clash 配置（对应软件端 tcp.getClientConfig 的 HTTP 等价物）。
async function getClientConfig(serverBase, { key, deviceId, device_id: deviceIdSnake } = {}, timeoutMs = 15000) {
  const resp = await postJson(buildServerUrl(serverBase, '/api/client/config'), {
    key,
    device_id: deviceIdSnake || deviceId,
  }, timeoutMs);
  const body = resp && resp.body && typeof resp.body === 'object' ? resp.body : {};
  const directContent = String(
    body.profiles_yaml_content
    || body.yaml_content
    || body.content
    || body.configContent
    || body.red_yaml_content
    || ''
  ).trim();
  return {
    response: resp,
    ok: resp.ok && body.ok !== false,
    content: directContent,
    proxySubscriptionUrl: String(body.proxy_subscription_url || body.proxySubscriptionUrl || '').trim(),
    accountType: body.account_type || body.accountType || '',
    accountTypeLabel: body.account_type_label || body.accountTypeLabel || '',
    expire_at: body.expire_at || body.expireAt || '',
    days_left: body.days_left ?? body.daysLeft ?? null,
    raw: body,
  };
}

module.exports = {
  getJson,
  postJson,
  requestJson,
  httpGetUniversal,
  validateKeyOnServer,
  unbindDeviceOnServer,
  fetchServerCookie,
  getClientConfig,
  fetchSubscriptionContent,
  resolveSubscriptionUrl,
  normalizeValidationResult,
  normalizeLicenseUsage,
  normalizeCookieFetchResult,
  normalizeServerCookies,
  normalizeServerBrowserStorage,
  extractBrowserStorageFromResponse,
  extractAccountFromResponse,
};
