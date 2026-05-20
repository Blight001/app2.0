const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { postJson } = require('./httpClient');

const CARD_STATUS_SEARCH_PATH = '/api/server_vue/card-status/search';

const STATE_TEXT = {
  active: '卡密有效',
  disabled: '卡密已被禁用',
  expired: '卡密已过期',
  not_found: '卡密不存在',
  pending: '卡密暂未生效',
  revoked: '卡密已被撤销',
};

function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const pathname = url.pathname || '';
    if (pathname.includes(CARD_STATUS_SEARCH_PATH)) {
      url.pathname = pathname.replace(/\/+$/, '');
    } else if (pathname.endsWith('/api/card/search_platform')) {
      url.pathname = CARD_STATUS_SEARCH_PATH;
    } else if (pathname === '/' || pathname === '' || pathname === '/api' || pathname === '/api/') {
      url.pathname = CARD_STATUS_SEARCH_PATH;
    } else {
      url.pathname = `${pathname.replace(/\/+$/, '')}${CARD_STATUS_SEARCH_PATH}`;
    }
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch (_) {
    if (value.includes(CARD_STATUS_SEARCH_PATH)) return value.replace(/\/+$/, '');
    if (value.includes('/api/card/search_platform')) {
      return value.replace(/\/api\/card\/search_platform\/?$/, CARD_STATUS_SEARCH_PATH);
    }
    return `${value.replace(/\/+$/, '')}${CARD_STATUS_SEARCH_PATH}`;
  }
}

function extractState(source = {}) {
  const value = String(
    source.state
    || source.status
    || source.card_status
    || source.cardStatus
    || source.validation_state
    || source.validationState
    || ''
  ).trim().toLowerCase();
  if (['active', 'valid', 'enabled', 'success', 'ok'].includes(value)) return 'active';
  if (['disabled', 'expired', 'not_found', 'pending', 'revoked'].includes(value)) return value;
  if (source.valid === true || source.is_valid === true || source.success === true || source.ok === true) return 'active';
  if (source.valid === false || source.is_valid === false) return 'not_found';
  return '';
}

function isExpiredDate(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime() <= Date.now();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!match) return false;
  const endOfDay = new Date(`${match[1]}T23:59:59.999`);
  return !Number.isNaN(endOfDay.getTime()) && endOfDay.getTime() <= Date.now();
}

function serverBaseFromAddress(address) {
  const raw = String(address || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch (_) {
    return raw.replace(/\/+$/, '');
  }
}

function resolveTcpAddress(address) {
  const raw = String(address || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `tcp://${raw}`);
    const port = Number(url.port);
    if (!url.hostname || !Number.isFinite(port) || port <= 0) return null;
    return { host: url.hostname, port: Math.round(port) };
  } catch (_) {
    const [host, portText] = raw.replace(/^tcp:\/\//i, '').replace(/^https?:\/\//i, '').split(':');
    const port = Number(portText);
    return host && Number.isFinite(port) && port > 0 ? { host: host.trim(), port: Math.round(port) } : null;
  }
}

function stringifyForLog(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value || '');
  }
}

class ServerResolver {
  constructor(context, deps = {}) {
    this.context = context;
    this.logService = deps.logService || null;
  }

  readPlatformsConfig() {
    const repoRoot = path.resolve(this.context.extensionPath, '..');
    const candidates = [
      path.join(repoRoot, 'config', 'platforms-config.json'),
      path.join(repoRoot, 'platforms-config.json'),
      path.join(this.context.extensionPath, 'config', 'platforms-config.json'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf8') || '{}');
        }
      } catch (_) {}
    }
    return {};
  }

  detectPlatformKey() {
    const cfg = this.readPlatformsConfig();
    return String(cfg.defaultPlatform || 'default').trim() || 'default';
  }

  getSearchConfig() {
    const cfg = this.readPlatformsConfig();
    const platformKey = this.detectPlatformKey();
    const platformCfg = (cfg.platformConfigs || {})[platformKey] || {};
    const rootResolver = cfg.localResolver || {};
    const platformResolver = platformCfg.localResolver || {};
    const configuredPrimaryUrl = String(
      vscode.workspace.getConfiguration('aiFreeTools').get('cardStatusSearchUrl')
      || process.env.SERVER_VUE_CARD_STATUS_SEARCH_URL
      || 'http://49.234.181.190:59000/api/server_vue/card-status/search'
    ).trim();
    const timeoutSec = platformResolver.timeoutSec || rootResolver.timeoutSec || platformCfg.localResolverTimeoutSec || cfg.localResolverTimeoutSec || 8;
    const timeoutMs = Math.max(1000, Number(timeoutSec) < 1000 ? Number(timeoutSec || 8) * 1000 : Number(timeoutSec || 8000));
    const values = [
      configuredPrimaryUrl,
      platformResolver.url,
      ...(Array.isArray(platformResolver.urls) ? platformResolver.urls : []),
      rootResolver.url,
      ...(Array.isArray(rootResolver.urls) ? rootResolver.urls : []),
      platformCfg.cardStatusSearchUrl,
      ...(Array.isArray(platformCfg.cardStatusSearchUrls) ? platformCfg.cardStatusSearchUrls : []),
      cfg.cardStatusSearchUrl,
      ...(Array.isArray(cfg.cardStatusSearchUrls) ? cfg.cardStatusSearchUrls : []),
      platformCfg.cardQueryUrl,
      cfg.cardQueryUrl,
      platformCfg.serverBase,
      cfg.serverBase,
    ];
    const seen = new Set();
    const urls = values.map(normalizeUrl).filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
    return { urls, timeoutMs };
  }

  normalizeResponse(resp) {
    const body = resp && resp.body && typeof resp.body === 'object' ? resp.body : {};
    const card = body.card && typeof body.card === 'object' ? body.card : {};
    const server = body.server && typeof body.server === 'object' ? body.server : {};
    const expiryDate = String(
      body.expiry_date || body.expiryDate || body.expire_at || body.expireAt || card.expiry_date || card.expiryDate || card.expire_at || card.expireAt || ''
    ).trim();
    const rawState = extractState(body) || extractState(card);
    const expired = isExpiredDate(expiryDate);
    const state = expired && rawState === 'active' ? 'expired' : (rawState || (expired ? 'expired' : ''));
    const message = state === 'active'
      ? (STATE_TEXT[state] || body.message || '卡密有效')
      : (body.error || body.message || body.msg || STATE_TEXT[state] || '卡密无效');
    const serverAddressHttp = String(
      body.client_address
      || body.clientAddress
      || server.client_address
      || server.clientAddress
      || body.address_HTTP
      || body.addressHttp
      || body.address_http
      || server.address_HTTP
      || server.addressHttp
      || server.address_http
      || body.serverBase
      || body.server_base
      || body.address
      || server.address
      || ''
    ).trim();
    const serverBase = serverBaseFromAddress(serverAddressHttp);
    const tcpAddress = String(body.address_TCP || body.addressTcp || body.address_tcp || server.address_TCP || server.addressTcp || server.address_tcp || '').trim();
    const tcpFromAddress = resolveTcpAddress(tcpAddress);
    const tcpSource = body.tcp && typeof body.tcp === 'object' ? body.tcp : (server.tcp && typeof server.tcp === 'object' ? server.tcp : {});
    const tcpPort = Number(tcpSource.port || body.tcp_port || body.tcpPort || tcpFromAddress?.port || 0);
    const tcpHost = String(tcpSource.host || tcpSource.hostname || body.tcp_host || body.tcpHost || tcpFromAddress?.host || '').trim();
    return {
      ok: body.success === true || body.ok === true || state === 'active',
      error: state === 'active' ? '' : message,
      data: {
        ...body,
        state: state || 'unknown',
        status: String(body.status || card.status || state || '').trim(),
        message,
        expiryDate,
        expire_at: expiryDate,
        address_HTTP: serverBase,
        clientHttpBase: serverBase,
        serverBase,
        address_TCP: tcpAddress,
        tcp: tcpHost && Number.isFinite(tcpPort) && tcpPort > 0 ? { host: tcpHost, port: Math.round(tcpPort) } : null,
        platformName: String(body.platformName || body.platform_name || body.platform || server.name || server.platform || '').trim(),
        tutorialUrl: String(body.tutorialUrl || body.tutorial_url || '').trim(),
        targetUrl: String(body.targetUrl || body.target_url || '').trim(),
      },
    };
  }

  async resolveForKey(key) {
    const config = this.getSearchConfig();
    if (!config.urls.length) return { ok: false, error: '未找到卡密搜索接口配置' };
    let lastError = '';
    for (const url of config.urls) {
      try {
        this.logService?.info?.(`请求卡密搜索接口：${url}`, { source: 'resolver', url });
        const resp = await postJson(url, {
          activation_code: key,
          activationCode: key,
          card: key,
          card_code: key,
        }, config.timeoutMs);
        if (!resp || (!resp.ok && !(resp.body && typeof resp.body === 'object'))) {
          lastError = resp?.raw || resp?.body?.message || '卡密查询接口请求失败';
          this.logService?.warn?.(`卡密搜索接口无有效响应：HTTP ${resp?.status || 0}，${String(lastError || '').slice(0, 160)}`, { source: 'resolver', url, status: resp?.status || 0 });
          continue;
        }
        this.logService?.info?.(`卡密搜索接口响应状态：HTTP ${resp.status || 0}`, { source: 'resolver', url, status: resp.status || 0 });
        this.logService?.debug?.(`卡密搜索接口完整返回内容：\n${stringifyForLog(resp.body ?? resp.raw ?? {})}`, {
          source: 'resolver',
          url,
          status: resp.status || 0,
        });
        const normalized = this.normalizeResponse(resp);
        if (!normalized.ok) {
          this.logService?.warn?.(`卡密搜索返回无效：${normalized.error || '卡密无效'}，state=${normalized.data?.state || 'unknown'}`, {
            source: 'resolver',
            url,
            status: resp.status || 0,
            state: normalized.data?.state || '',
            clientHttpBase: normalized.data?.clientHttpBase || normalized.data?.address_HTTP || '',
          });
          return { ok: false, error: normalized.error || '卡密无效' };
        }
        this.logService?.success?.(`卡密搜索返回客户端地址：客户端HTTP=${normalized.data.clientHttpBase || normalized.data.address_HTTP || '未返回'}，客户端TCP=${normalized.data.address_TCP || '未返回'}，平台=${normalized.data.platformName || '未知'}`, {
          source: 'resolver',
          url,
          clientHttpBase: normalized.data.clientHttpBase || normalized.data.address_HTTP || '',
          addressTcp: normalized.data.address_TCP || '',
          platformName: normalized.data.platformName || '',
        });
        return { ok: true, data: normalized.data, requestUrl: url };
      } catch (error) {
        this.logService?.warn?.(`卡密搜索接口请求失败：${error?.message || error}`, { source: 'resolver', url });
        lastError = error?.message || String(error);
      }
    }
    return { ok: false, error: lastError || '卡密不存在或未生效' };
  }
}

module.exports = {
  ServerResolver,
};
