const { isServerBaseAllowedForMode } = require('../utils/server-mode');

function normalizeTimeoutMs(value, fallbackMs = 8000) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallbackMs;
  if (num < 1000) return Math.round(num * 1000);
  return Math.round(num);
}

function collectUrlCandidates(normalizeUrl, ...groups) {
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      const normalized = normalizeUrl(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function createServerResolver(deps = {}) {
  const {
    fs,
    path,
    postJson,
    getServerBase,
    licenseCache,
    setRuntimeTcpConfig = () => {},
    setRuntimeServerBase = () => {},
    logger = console,
  } = deps;

  function detectPlatformKeyFromRuntime() {
    try {
      const defaultPlatform = String(readPlatformsConfigSafe()?.defaultPlatform || '').trim();
      if (defaultPlatform) return defaultPlatform;
    } catch (_) {}
    try {
      const fromEnv = String(process.env.PLATFORM || '').trim();
      if (fromEnv) return fromEnv;
    } catch (_) {}
    return 'default';
  }

  function readPlatformsConfigSafe() {
    try {
      const candidates = [
        path.join(__dirname, '../../../../platforms-config.json'),
        path.join(__dirname, '../../../../docs/config/platforms-config.json'),
        path.join(__dirname, '../../../../config/platforms-config.json'),
      ];
      for (const configPath of candidates) {
        if (!fs.existsSync(configPath)) continue;
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (error) {
      logger.warn?.('[配置] 读取平台配置失败:', error?.message || error);
    }
    return {};
  }

  function getPlatformDefaultConfig(platformKey) {
    const cfg = readPlatformsConfigSafe();
    const platformConfigs = cfg.platformConfigs || {};
    if (platformConfigs[platformKey]) return platformConfigs[platformKey];
    const defaultPlatform = String(cfg.defaultPlatform || '').trim();
    if (defaultPlatform && platformConfigs[defaultPlatform]) return platformConfigs[defaultPlatform];
    const firstKey = Object.keys(platformConfigs)[0];
    return firstKey ? (platformConfigs[firstKey] || {}) : {};
  }

  function resolveServerBaseFromAddress(address) {
    const raw = String(address || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
      const pathname = String(url.pathname || '').replace(/\/+$/, '');
      return `${url.protocol}//${url.host}${pathname === '/' ? '' : pathname}`.replace(/\/+$/, '');
    } catch (_) {
      return raw.replace(/\/+$/, '');
    }
  }

  function publishLoopbackAddress(address, serviceUrl) {
    const raw = String(address || '').trim();
    const serviceRaw = String(serviceUrl || '').trim();
    if (!raw || !serviceRaw) return raw;
    try {
      const target = new URL(raw.includes('://') ? raw : `http://${raw}`);
      const service = new URL(serviceRaw.includes('://') ? serviceRaw : `http://${serviceRaw}`);
      const targetHost = String(target.hostname || '').toLowerCase();
      const serviceHost = String(service.hostname || '').toLowerCase();
      const isLoopback = (host) => host === 'localhost' || host === '::1' || /^127(?:\.|$)/.test(host);
      if (!isLoopback(targetHost) || !serviceHost || isLoopback(serviceHost)) return raw;
      target.hostname = service.hostname;
      return target.toString().replace(/\/+$/, '');
    } catch (_) {
      return raw;
    }
  }

  function resolveTcpAddressMeta(address) {
    const raw = String(address || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw.includes('://') ? raw : `tcp://${raw}`);
      const host = String(url.hostname || '').trim();
      const port = Number(url.port);
      if (!host || !Number.isFinite(port) || port <= 0) return null;
      return { host, port: Math.round(port) };
    } catch (_) {
      const stripped = raw.replace(/^tcp:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const [hostPart, portPart] = stripped.split(':');
      const port = Number(portPart);
      if (!hostPart || !Number.isFinite(port) || port <= 0) return null;
      return { host: hostPart.trim(), port: Math.round(port) };
    }
  }

  function normalizeAccountServiceUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
      const url = new URL(value);
      const pathname = String(url.pathname || '').replace(/\/+$/, '');
      const accountApiIndex = pathname.indexOf('/api/account');
      url.pathname = accountApiIndex >= 0
        ? `${pathname.slice(0, accountApiIndex)}/api/account`
        : `${pathname === '/' ? '' : pathname}/api/account`;
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    } catch (_) {
      return `${value.replace(/\/+$/, '')}/api/account`;
    }
  }

  function resolveAccountServiceConfig() {
    try {
      const platformKey = detectPlatformKeyFromRuntime();
      const cfg = readPlatformsConfigSafe();
      const platformCfg = (cfg.platformConfigs || {})[platformKey] || {};
      const rootService = cfg.accountService && typeof cfg.accountService === 'object'
        ? cfg.accountService
        : {};
      const platformService = platformCfg.accountService && typeof platformCfg.accountService === 'object'
        ? platformCfg.accountService
        : {};
      const timeoutSource = platformService.timeoutSec
        || rootService.timeoutSec
        || platformService.timeoutMs
        || rootService.timeoutMs
        || 8;
      const urls = collectUrlCandidates(
        normalizeAccountServiceUrl,
        process.env.ACCOUNT_SERVICE_URL,
        process.env.SERVER_BASE,
        platformService.url,
        platformService.urls,
        rootService.url,
        rootService.urls,
        platformCfg.accountServiceUrl,
        platformCfg.accountServiceUrls,
        cfg.accountServiceUrl,
        cfg.accountServiceUrls,
        getServerBase()
      ).filter((candidate) => isServerBaseAllowedForMode(candidate));
      return {
        url: urls[0] || '',
        urls,
        timeoutMs: normalizeTimeoutMs(timeoutSource, 8000),
      };
    } catch (error) {
      logger.warn?.('[配置] 读取单平台账号服务配置失败:', error?.message || error);
      return { url: '', urls: [], timeoutMs: 8000 };
    }
  }

  async function requestAccountService(action, payload = {}) {
    try {
      const service = resolveAccountServiceConfig();
      const serviceUrls = service.urls.length > 0 ? service.urls : (service.url ? [service.url] : []);
      if (serviceUrls.length === 0) return { ok: false, message: '未配置账号服务地址' };

      let lastMessage = '';
      for (const rawUrl of serviceUrls) {
        try {
          const endpoint = new URL(rawUrl);
          endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/${String(action || '').replace(/^\/+/, '')}`;
          endpoint.search = '';
          const response = await postJson(endpoint.toString(), payload, service.timeoutMs);
          const body = response?.body && typeof response.body === 'object' ? response.body : {};
          if (body.ok === true) {
            const publishAddresses = (source) => {
              if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
              const published = { ...source };
              for (const field of [
                'serverBase',
                'server_base',
                'address_HTTP',
                'addressHttp',
                'address_http',
                'address',
                'client_address',
                'clientAddress',
              ]) {
                if (typeof published[field] === 'string' && published[field].trim()) {
                  published[field] = publishLoopbackAddress(published[field], endpoint.toString());
                }
              }
              return published;
            };
            const publishedBody = publishAddresses(body);
            for (const field of ['validation', 'result', 'data']) {
              if (publishedBody[field] && typeof publishedBody[field] === 'object') {
                publishedBody[field] = publishAddresses(publishedBody[field]);
              }
            }
            const firstPublishedAddress = (source) => String(
              source?.serverBase
              || source?.server_base
              || source?.address_HTTP
              || source?.addressHttp
              || source?.address_http
              || source?.client_address
              || source?.clientAddress
              || source?.address
              || ''
            ).trim();
            const publishedServerBase = firstPublishedAddress(publishedBody)
              || firstPublishedAddress(publishedBody.validation)
              || firstPublishedAddress(publishedBody.result)
              || firstPublishedAddress(publishedBody.data);
            if (publishedServerBase) {
              publishedBody.serverBase = publishedServerBase;
              publishedBody.server_base = publishedServerBase;
            } else {
              const servicePath = endpoint.pathname.replace(/\/api\/account\/[^/]+\/?$/, '');
              publishedBody.serverBase = `${endpoint.protocol}//${endpoint.host}${servicePath}`.replace(/\/+$/, '');
              publishedBody.server_base = publishedBody.serverBase;
            }
            return publishedBody;
          }
          lastMessage = body.message || body.error || response?.raw || lastMessage;
          if (response?.status && response.status < 500) {
            return { ...body, ok: false, message: lastMessage || '账号操作失败' };
          }
        } catch (error) {
          lastMessage = error?.message || String(error);
        }
      }
      return { ok: false, message: lastMessage || '账号服务暂时不可用' };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  }

  async function authenticateAccount(payload = {}) {
    return requestAccountService(payload.mode === 'register' ? 'register' : 'login', payload);
  }

  function applyResolvedConfigToStore({ resolved }) {
    const resolvedHttpBase = String(
      resolved.serverBase
      || resolved.address_HTTP
      || resolved.addressHttp
      || resolved.address_http
      || resolved.client_address
      || resolved.clientAddress
      || resolved.address
      || ''
    ).trim();
    if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
      const runtimeConfig = { serverBase: resolvedHttpBase };
      if (resolved.platformName) runtimeConfig.platformName = resolved.platformName;
      if (Array.isArray(resolved.allowedPlatforms) && resolved.allowedPlatforms.length > 0) {
        runtimeConfig.allowedPlatforms = resolved.allowedPlatforms;
      }
      const woolPlatforms = resolved.woolPlatforms ?? resolved.wool_platforms;
      if (Array.isArray(woolPlatforms)) {
        runtimeConfig.woolPlatforms = woolPlatforms;
      }
      if (String(resolved.targetUrl || '').trim()) runtimeConfig.targetUrl = String(resolved.targetUrl).trim();
      if (String(resolved.tutorialUrl || '').trim()) runtimeConfig.tutorialUrl = String(resolved.tutorialUrl).trim();
      licenseCache.setRuntimeConfig(runtimeConfig);
    }

    try {
      const resolvedTcpMeta = resolved.tcp && typeof resolved.tcp === 'object'
        ? resolved.tcp
        : resolveTcpAddressMeta(resolved.address_TCP || resolved.addressTcp || resolved.address_tcp || '');
      if (resolvedTcpMeta) {
        setRuntimeTcpConfig({
          host: resolvedTcpMeta.host || '',
          port: resolvedTcpMeta.port || 0,
          transport: resolvedTcpMeta.transport || {},
        });
      } else {
        setRuntimeTcpConfig(null);
      }
      setRuntimeServerBase(resolvedHttpBase);
    } catch (error) {
      logger.warn?.('[配置] 写入运行时服务器配置失败:', error?.message || error);
    }
    return {};
  }

  return {
    detectPlatformKeyFromRuntime,
    readPlatformsConfigSafe,
    getPlatformDefaultConfig,
    resolveServerBaseFromAddress,
    publishLoopbackAddress,
    normalizeAccountServiceUrl,
    resolveAccountServiceConfig,
    authenticateAccount,
    applyResolvedConfigToStore,
  };
}

module.exports = {
  createServerResolver,
};
