// 创建/初始化：createServerResolver的具体业务逻辑。
function createServerResolver(deps = {}) {
  const {
    fs,
    path,
    postJson,
    getServerBase,
    extractValidationState,
    getValidationFailureMessage,
    readStoreConfigSafe,
    writeStoreConfigSafe,
    licenseCache,
    setRuntimeTcpConfig = () => {},
    setRuntimeServerBase = () => {},
    getCurrentPlatformLabel = () => '未知平台',
    logger = console,
  } = deps;

  const RESOLVER_STATE_TEXT_MAP = {
    active: '卡密有效',
    disabled: '卡密已被禁用',
    expired: '卡密已过期',
    not_found: '卡密不存在',
    pending: '卡密暂未生效',
    revoked: '卡密已被撤销',
  };

// 处理：detectPlatformKeyFromRuntime的具体业务逻辑。
  function detectPlatformKeyFromRuntime() {
    try {
      const cfg = readPlatformsConfigSafe();
      const defaultPlatform = String(cfg?.defaultPlatform || '').trim();
      if (defaultPlatform) return defaultPlatform;
    } catch (_) {}
    try {
      const fromEnv = String(process.env.PLATFORM || '').trim();
      if (fromEnv) return fromEnv;
    } catch (_) {}
    try {
      const pkg = require('../../../../package.json');
      const appName = String((pkg && pkg.name) || '').toLowerCase();
      if (appName.includes('seedance2.0') || appName.includes('seedance2_0')) return 'seedance2.0';
      if (appName.includes('xiaoyunque')) return 'xiaoyunque';
      if (appName.includes('banana')) return 'banana';
      if (appName.includes('local')) return 'local';
    } catch (_) {}
    return 'default';
  }

// 获取/读取/解析：readPlatformsConfigSafe的具体业务逻辑。
  function readPlatformsConfigSafe() {
    try {
      const candidates = [
        path.join(__dirname, '../../../../config/platforms-config.json'),
        path.join(__dirname, '../../../../platforms-config.json'),
      ];
      for (const platformsConfigPath of candidates) {
        if (!fs.existsSync(platformsConfigPath)) continue;
        return JSON.parse(fs.readFileSync(platformsConfigPath, 'utf8'));
      }
      return {};
    } catch (_) {
      return {};
    }
  }

// 获取/读取/解析：getPlatformDefaultConfig的具体业务逻辑。
  function getPlatformDefaultConfig(platformKey) {
    const cfg = readPlatformsConfigSafe();
    const platformConfigs = cfg.platformConfigs || {};
    if (platformConfigs[platformKey]) return platformConfigs[platformKey];
    const defaultPlatform = String(cfg.defaultPlatform || '').trim();
    if (defaultPlatform && platformConfigs[defaultPlatform]) return platformConfigs[defaultPlatform];
    const firstKey = Object.keys(platformConfigs)[0];
    return firstKey ? (platformConfigs[firstKey] || {}) : {};
  }

// 格式化/规范化：normalizeCardStatusSearchUrl的具体业务逻辑。
  function normalizeCardStatusSearchUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';

    const CARD_STATUS_SEARCH_PATH = '/api/server_vue/card-status/search';

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
      if (value.includes(CARD_STATUS_SEARCH_PATH)) {
        return value.replace(/\/+$/, '');
      }
      if (value.includes('/api/card/search_platform')) {
        return value.replace(/\/api\/card\/search_platform\/?$/, CARD_STATUS_SEARCH_PATH);
      }
      return `${value.replace(/\/+$/, '')}${CARD_STATUS_SEARCH_PATH}`;
    }
  }

// 获取/读取/解析：resolveHostFromAddress的具体业务逻辑。
  function resolveHostFromAddress(address) {
    const raw = String(address || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
      return url.hostname || '';
    } catch (_) {
      const stripped = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      return (stripped.split('/')[0] || '').split(':')[0] || '';
    }
  }

// 获取/读取/解析：resolveServerBaseFromAddress的具体业务逻辑。
  function resolveServerBaseFromAddress(address) {
    const raw = String(address || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
      return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
    } catch (_) {
      return raw.replace(/\/+$/, '');
    }
  }

// 获取/读取/解析：resolveTcpAddressMeta的具体业务逻辑。
  function resolveTcpAddressMeta(address) {
    const raw = String(address || '').trim();
    if (!raw) return null;

    try {
      const url = new URL(raw.includes('://') ? raw : `tcp://${raw}`);
      const host = String(url.hostname || '').trim();
      const port = Number(url.port);
      if (!host || !Number.isFinite(port) || port <= 0) {
        return null;
      }
      return {
        host,
        port: Math.round(port),
      };
    } catch (_) {
      const stripped = raw.replace(/^tcp:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const [hostPart, portPart] = stripped.split(':');
      const port = Number(portPart);
      if (!hostPart || !Number.isFinite(port) || port <= 0) {
        return null;
      }
      return {
        host: hostPart.trim(),
        port: Math.round(port),
      };
    }
  }

// (registration launcher removed) tcp url builder removed

// 处理：isCardExpiredByDate的具体业务逻辑。
  function isCardExpiredByDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime() <= Date.now();
    }

    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnly) {
      const endOfDay = new Date(`${dateOnly[1]}T23:59:59.999`);
      if (!Number.isNaN(endOfDay.getTime())) {
        return endOfDay.getTime() <= Date.now();
      }
    }

    return false;
  }

// 获取/读取/解析：resolveCardStatusSearchConfig的具体业务逻辑。
  function resolveCardStatusSearchConfig() {
    try {
// 格式化/规范化：normalizeTimeoutMs的具体业务逻辑。
      const normalizeTimeoutMs = (value, fallbackMs = 8000) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return fallbackMs;
        if (num < 1000) return Math.round(num * 1000);
        return Math.round(num);
      };

// 处理：collectUrlCandidates的具体业务逻辑。
      const collectUrlCandidates = (...groups) => {
        const seen = new Set();
        const result = [];
        for (const group of groups) {
          const values = Array.isArray(group) ? group : [group];
          for (const value of values) {
            const normalized = normalizeCardStatusSearchUrl(value);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            result.push(normalized);
          }
        }
        return result;
      };

      const platformKey = detectPlatformKeyFromRuntime();
      const cfg = readPlatformsConfigSafe();
// 处理：platformCfg的具体业务逻辑。
      const platformCfg = (cfg.platformConfigs || {})[platformKey] || {};
      const rootResolver = cfg.localResolver || {};
      const platformResolver = platformCfg.localResolver || {};

// 处理：timeoutSource的具体业务逻辑。
      const timeoutSource = (
        platformCfg.cardStatusSearchTimeoutSec
        || cfg.cardStatusSearchTimeoutSec
        || platformCfg.cardStatusSearchTimeoutMs
        || cfg.cardStatusSearchTimeoutMs
        || platformCfg.localResolverTimeoutSec
        || cfg.localResolverTimeoutSec
        || platformCfg.localResolverTimeoutMs
        || cfg.localResolverTimeoutMs
        || platformResolver.timeoutSec
        || rootResolver.timeoutSec
        || platformResolver.timeoutMs
        || rootResolver.timeoutMs
        || 8
      );

      const candidateUrls = [
        process.env.SERVER_VUE_CARD_STATUS_SEARCH_URL,
        platformCfg.cardStatusSearchUrl,
        cfg.cardStatusSearchUrl,
        platformResolver.url,
        rootResolver.url,
        platformCfg.cardQueryUrl,
        cfg.cardQueryUrl,
        platformCfg.serverBase,
        cfg.serverBase,
        getServerBase(),
      ];

      const configuredUrls = collectUrlCandidates(
        process.env.SERVER_VUE_CARD_STATUS_SEARCH_URL,
        platformResolver.url,
        platformResolver.urls,
        rootResolver.url,
        rootResolver.urls,
        platformCfg.cardStatusSearchUrl,
        platformCfg.cardStatusSearchUrls,
        cfg.cardStatusSearchUrl,
        cfg.cardStatusSearchUrls,
        platformResolver.fallbackUrls,
        rootResolver.fallbackUrls,
        platformCfg.cardQueryUrl,
        cfg.cardQueryUrl,
        platformCfg.serverBase,
        cfg.serverBase
      );

      for (const candidate of [...configuredUrls, ...candidateUrls]) {
        if (candidate) {
          return {
            url: candidate,
            urls: configuredUrls.length > 0 ? configuredUrls : [candidate],
            timeoutMs: normalizeTimeoutMs(timeoutSource, 8000),
          };
        }
      }

      const fallbackServerBase = getServerBase();
      if (fallbackServerBase) {
        const normalizedFallback = normalizeCardStatusSearchUrl(fallbackServerBase);
        return {
          url: normalizedFallback,
          urls: normalizedFallback ? [normalizedFallback] : [],
          timeoutMs: normalizeTimeoutMs(timeoutSource, 8000),
        };
      }
    } catch (e) {
      logger.warn?.('[配置] 读取卡密搜索配置失败:', e?.message || e);
    }

    return null;
  }

// 格式化/规范化：normalizeCardStatusSearchResponse的具体业务逻辑。
  function normalizeCardStatusSearchResponse(resp) {
// 处理：body的具体业务逻辑。
    const body = (resp && resp.body && typeof resp.body === 'object')
      ? resp.body
      : ((resp && typeof resp === 'object') ? resp : {});
    const card = body.card && typeof body.card === 'object' ? body.card : {};
    const server = body.server && typeof body.server === 'object' ? body.server : {};

    const activationCode = String(
      body.activation_code
      || body.activationCode
      || body.card
      || body.card_code
      || card.card_code
      || card.activation_code
      || card.activationCode
      || body.key
      || ''
    ).trim();

    const expiryDate = String(
      body.expiry_date
      || body.expiryDate
      || body.expire_at
      || body.expireAt
      || body.expires_at
      || body.expiresAt
      || card.expiry_date
      || card.expiryDate
      || card.expire_at
      || card.expireAt
      || card.expires_at
      || card.expiresAt
      || card.expiration_date
      || card.expirationDate
      || ''
    ).trim();

    const rawState = extractValidationState(body)
      || extractValidationState(card)
      || (body.success === true || body.ok === true ? 'active' : '');
    const expiredByDate = isCardExpiredByDate(expiryDate);
    const effectiveState = expiredByDate && rawState === 'active'
      ? 'expired'
      : (rawState || (expiredByDate ? 'expired' : ''));
    const stateText = RESOLVER_STATE_TEXT_MAP[effectiveState] || '';

    const failureMessage = effectiveState === 'active'
      ? ''
      : (
          expiredByDate
            ? '卡密已过期'
            : getValidationFailureMessage(
                body,
                getValidationFailureMessage(
                  card,
                  body.error || body.message || body.msg || stateText || '卡密无效'
                )
              )
        );

    const serverAddress = String(
      body.address
      || body.address_HTTP
      || body.addressHttp
      || body.address_http
      || server.address
      || server.address_HTTP
      || server.addressHttp
      || server.address_http
      || body.client_address
      || body.clientAddress
      || server.server_address
      || body.server_address
      || body.serverBase
      || body.server_base
      || ''
    ).trim();

    const serverAddressHttp = String(
      body.address_HTTP
      || body.addressHttp
      || body.address_http
      || server.address_HTTP
      || server.addressHttp
      || server.address_http
      || body.serverBase
      || body.server_base
      || server.server_address
      || body.address
      || body.client_address
      || body.clientAddress
      || server.address
      || server.server_address
      || body.server_address
      || body.serverBase
      || body.server_base
      || ''
    ).trim();

    const serverBase = resolveServerBaseFromAddress(serverAddressHttp)
      || resolveServerBaseFromAddress(serverAddress)
      || String(body.address_HTTP || body.addressHttp || body.address_http || body.address || body.serverBase || body.server_base || '').trim();
    const tcpAddress = String(
      body.address_TCP
      || body.addressTcp
      || body.address_tcp
      || server.address_TCP
      || server.addressTcp
      || server.address_tcp
      || ''
    ).trim();
    const tcpMetaFromAddress = resolveTcpAddressMeta(tcpAddress);
    const host = resolveHostFromAddress(tcpAddress)
      || String(server.server_ip || server.ip || body.server_ip || body.ip || body.host || '').trim();
// 处理：tcpSource的具体业务逻辑。
    const tcpSource = (body.tcp && typeof body.tcp === 'object')
      ? body.tcp
      : ((server && typeof server.tcp === 'object') ? server.tcp : {});
    const tcpHost = String(
      tcpSource.host
      || tcpSource.hostname
      || body.tcp_host
      || body.tcpHost
      || tcpMetaFromAddress?.host
      || ''
    ).trim();
    const tcpPort = Number(
      tcpSource.port
      || body.tcp_port
      || body.tcpPort
      || tcpMetaFromAddress?.port
      || 0
    );
// 处理：tcpTransportSource的具体业务逻辑。
    const tcpTransportSource = (tcpSource.transport && typeof tcpSource.transport === 'object')
      ? tcpSource.transport
      : ((body.transport && typeof body.transport === 'object') ? body.transport : {});
    const serverId = String(server.id || body.server_id || body.serverId || '').trim();
    const platformName = String(
      body.platform
      || body.platform_name
      || body.platformName
      || server.name
      || server.platform
      || ''
    ).trim();
    const status = String(
      body.status
      || body.state
      || card.status
      || card.state
      || effectiveState
      || ''
    ).trim();

    return {
      ok: body.success === true || body.ok === true || effectiveState === 'active',
      data: {
        activationCode,
        state: effectiveState || 'unknown',
        status: status || (effectiveState || 'unknown'),
        message: effectiveState === 'active'
          ? (stateText || '卡密有效')
          : (failureMessage || stateText || '卡密无效'),
        expiryDate,
        expiredByDate,
        host,
        address: String(body.address || server.address || '').trim(),
        address_HTTP: serverBase,
        addressHttp: serverBase,
        address_TCP: tcpAddress,
        addressTcp: tcpAddress,
        tcp: (tcpHost && Number.isFinite(tcpPort) && tcpPort > 0)
          ? {
              host: tcpHost,
              port: Math.round(tcpPort),
              transport: {
                preferred: String(tcpTransportSource.preferred || tcpTransportSource.mode || 'tls').toLowerCase(),
                allowHttpFallback: tcpTransportSource.allowHttpFallback !== false,
                allowPlainFallback: false,
                tls: {
                  enabled: true,
                  rejectUnauthorized: tcpTransportSource.tls?.rejectUnauthorized === true,
                  caPath: String(tcpTransportSource.tls?.caPath || tcpTransportSource.tls?.ca_path || '').trim(),
                  certFingerprint: String(tcpTransportSource.tls?.certFingerprint || tcpTransportSource.tls?.cert_fingerprint || '').trim(),
                },
              },
            }
          : null,
        serverBase,
        serverId,
        platformName,
        card,
        server,
        responseStatus: resp && typeof resp.status === 'number' ? resp.status : null,
        responseOk: resp && resp.ok === true,
      },
      error: effectiveState === 'active' ? '' : (failureMessage || stateText || '卡密无效'),
    };
  }

// 获取/读取/解析：getLocalResolverConfig的具体业务逻辑。
  function getLocalResolverConfig() {
    try {
// 格式化/规范化：normalizeTimeoutMs的具体业务逻辑。
      const normalizeTimeoutMs = (value, fallbackMs = 8000) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return fallbackMs;
        if (num < 1000) return Math.round(num * 1000);
        return Math.round(num);
      };

      const envUrl = process.env.LOCAL_SERVER_RESOLVER_URL;
      if (envUrl && typeof envUrl === 'string') {
        return { url: envUrl, method: 'POST', timeoutMs: 8000 };
      }

      const platformKey = detectPlatformKeyFromRuntime();
      const cfg = readPlatformsConfigSafe();
// 处理：platformResolver的具体业务逻辑。
      const platformResolver = ((cfg.platformConfigs || {})[platformKey] || {}).localResolver || {};
      const rootResolver = cfg.localResolver || {};
// 处理：platformCardQueryUrl的具体业务逻辑。
      const platformCardQueryUrl = ((cfg.platformConfigs || {})[platformKey] || {}).cardQueryUrl;
      const rootCardQueryUrl = cfg.cardQueryUrl;
      const resolvedUrl = platformCardQueryUrl || rootCardQueryUrl
        || ((cfg.platformConfigs || {})[platformKey] || {}).localResolverUrl
        || cfg.localResolverUrl
        || platformResolver.url
        || rootResolver.url;
      if (resolvedUrl) {
// 获取/读取/解析：resolvedTimeout的具体业务逻辑。
        const resolvedTimeout = (
          ((cfg.platformConfigs || {})[platformKey] || {}).localResolverTimeoutSec
          || cfg.localResolverTimeoutSec
          || ((cfg.platformConfigs || {})[platformKey] || {}).localResolverTimeoutMs
          || cfg.localResolverTimeoutMs
          || platformResolver.timeoutSec
          || rootResolver.timeoutSec
          || platformResolver.timeoutMs
          || rootResolver.timeoutMs
          || 8
        );
        return {
          url: resolvedUrl,
          method: String(
            ((cfg.platformConfigs || {})[platformKey] || {}).localResolverMethod
            || cfg.localResolverMethod
            || platformResolver.method
            || rootResolver.method
            || 'POST'
          ).toUpperCase(),
          timeoutMs: normalizeTimeoutMs(resolvedTimeout, 8000),
          headers: platformResolver.headers || rootResolver.headers || undefined
        };
      }

      const store = readStoreConfigSafe();
      const storeResolver = store.localResolver || {};
      if (store.localResolverUrl || storeResolver.url) {
        const rawTimeout = store.localResolverTimeoutSec || storeResolver.timeoutSec || store.localResolverTimeoutMs || storeResolver.timeoutMs || 8;
        return {
          url: store.localResolverUrl || storeResolver.url,
          method: (store.localResolverMethod || storeResolver.method || 'POST').toUpperCase(),
          timeoutMs: normalizeTimeoutMs(rawTimeout, 8000),
          headers: storeResolver.headers || undefined
        };
      }
    } catch (e) {
      logger.warn?.('[配置] 读取本地解析器配置失败:', e?.message || e);
    }
    return null;
  }

// 格式化/规范化：normalizeResolverResponse的具体业务逻辑。
  function normalizeResolverResponse(resp, platformKey) {
// 处理：body的具体业务逻辑。
    const body = (resp && resp.body) || {};
    const matchedServers = Array.isArray(body.matches)
      ? body.matches
      : (Array.isArray(body.matched_servers) ? body.matched_servers : []);
    const queryResults = Array.isArray(body.query_results) ? body.query_results : [];
    const count = Number(body.count || 0) || matchedServers.length;

    let selectedResult = queryResults.find((item) => item && item.ok === true && item.found !== false && item.valid !== false) || null;
    if (!selectedResult) {
      selectedResult = queryResults.find((item) => item && item.ok === true && item.valid !== false) || null;
    }
    let selectedServer = null;

    if (selectedResult) {
      const selectedIp = selectedResult.server_ip || selectedResult?.server?.server_ip || selectedResult?.server?.ip;
      if (selectedIp) {
        selectedServer = matchedServers.find((s) => s && (s.server_ip === selectedIp || s.ip === selectedIp)) || null;
      }
      if (!selectedServer && selectedResult.server && typeof selectedResult.server === 'object') {
        const sid = selectedResult.server.id;
        if (sid) {
          selectedServer = matchedServers.find((s) => s && s.id === sid) || null;
        }
      }
    }

    if (!selectedServer) {
      selectedServer = matchedServers[0] || null;
    }
    if (!selectedResult && queryResults.length > 0) {
      selectedResult = queryResults[0];
    }

    const failureStateCandidates = ['disabled', 'expired', 'not_found', 'pending', 'revoked'];
    const preferredStateSource = [selectedResult, ...queryResults, body]
      .filter((item) => item && typeof item === 'object')
      .find((item) => failureStateCandidates.includes(extractValidationState(item)))
      || selectedResult
      || queryResults[0]
      || body;
    const state = extractValidationState(preferredStateSource)
      || extractValidationState(body)
      || (body.valid === true || body.is_valid === true || body.success === true || body.ok === true ? 'active' : '');
    const failureMessage = getValidationFailureMessage(
      preferredStateSource,
      getValidationFailureMessage(body, body.error || body.message || body.msg || '')
    );

// 处理：address的具体业务逻辑。
    const address = (selectedServer && selectedServer.address)
      || (selectedResult && selectedResult.address)
      || (selectedResult && selectedResult.server && selectedResult.server.address)
      || body.address
      || '';
// 处理：host的具体业务逻辑。
    let host = (selectedServer && (selectedServer.server_ip || selectedServer.ip))
      || (selectedResult && (selectedResult.server_ip || (selectedResult.server && (selectedResult.server.server_ip || selectedResult.server.ip))))
      || body.server_ip
      || body.ip
      || body.host
      || '';

    let serverBase = '';
    if (address) {
      try {
        const u = new URL(address);
        serverBase = `${u.protocol}//${u.host}`;
        if (!host) host = u.hostname || '';
      } catch (_) {
        serverBase = address;
      }
    }

    const platformDefault = getPlatformDefaultConfig(platformKey);
    const port = Number(platformDefault?.tcp?.port || 58113);
// 处理：platformName的具体业务逻辑。
    const platformName = (selectedServer && (selectedServer.platform || selectedServer.name))
      || (selectedResult && (selectedResult.platform || selectedResult.platform_name))
      || body.platform
      || body.platform_name
      || body.platformName;
// 处理：status的具体业务逻辑。
    const status = (selectedServer && selectedServer.status)
      || (selectedResult && selectedResult.status)
      || body.status
      || '';
    const found = !!host
      || !!serverBase
      || count > 0
      || matchedServers.length > 0
      || !!(selectedResult && (selectedResult.found === true || selectedResult.ok === true))
      || body.valid === true
      || body.is_valid === true
      || body.success === true
      || body.ok === true
      || state === 'active';
// 处理：serverId的具体业务逻辑。
    const serverId = (selectedServer && selectedServer.id) || '';
    const effectiveState = state || (found ? 'active' : 'unknown');
    const resolvedMessage = failureMessage
      || body.error
      || body.message
      || body.msg
      || '';
    return {
      host,
      port,
      serverBase,
      platformName,
      serverId,
      status,
      state: effectiveState,
      found,
      count,
      message: resolvedMessage
    };
  }

// 获取/读取/解析：resolveServerConfigForKey的具体业务逻辑。
  async function resolveServerConfigForKey({ key }) {
    try {
      const resolver = resolveCardStatusSearchConfig();
      const resolverUrls = Array.isArray(resolver?.urls) && resolver.urls.length > 0
        ? resolver.urls
        : (resolver?.url ? [resolver.url] : []);
      if (!resolver || resolverUrls.length === 0) {
        return { ok: false, error: '未找到卡密搜索接口配置' };
      }

      let lastError = '';
      for (const [index, resolverUrl] of resolverUrls.entries()) {
        try {
          const u = new URL(resolverUrl);
          logger.log?.(`[卡密搜索] 请求地址(${index + 1}/${resolverUrls.length}): ${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}${u.pathname || ''} (POST)`);
        } catch (_) {
          logger.log?.(`[卡密搜索] 请求地址(${index + 1}/${resolverUrls.length}):`, resolverUrl, '(POST)');
        }
        const requestUrl = new URL(resolverUrl);
        requestUrl.search = '';

        let resp;
        try {
          resp = await postJson(requestUrl.toString(), {
            activation_code: key,
            activationCode: key,
            card: key,
            card_code: key,
          }, resolver.timeoutMs || 8000);
        } catch (requestError) {
          lastError = requestError?.message || String(requestError);
          continue;
        }

        if (!resp || (!resp.ok && !(resp.body && typeof resp.body === 'object'))) {
          const rawErrorCode = String(resp?.body?.error || resp?.body?.code || resp?.body?.error_code || '').toLowerCase();
          const SEARCH_ERROR_TEXT_MAP = {
            invalid_passphrase: '搜索暗号错误',
            no_servers_configured: '未配置可查询服务器',
            activation_code_not_found: '未找到卡密',
            server_vue_lookup_failed: '卡密搜索失败',
            user_not_found: '未找到卡密',
          };
          lastError = SEARCH_ERROR_TEXT_MAP[rawErrorCode]
            || getValidationFailureMessage(resp?.body || resp, resp?.body?.error || resp?.body?.message || resp?.raw || '卡密查询接口请求失败');
          continue;
        }

        const normalized = normalizeCardStatusSearchResponse(resp);
        logger.log?.('[卡密搜索] 结果摘要:', {
          status: resp?.status ?? null,
          ok: resp?.ok === true,
          state: normalized.data?.state || 'unknown',
          message: normalized.data?.message || '',
          host: normalized.data?.host || '',
          address_HTTP: normalized.data?.address_HTTP || normalized.data?.addressHttp || normalized.data?.serverBase || '',
          address_TCP: normalized.data?.address_TCP || normalized.data?.addressTcp || '',
          responseOk: normalized.data?.responseOk === true,
        });

        const explicitFailureStates = new Set(['disabled', 'expired', 'not_found', 'pending', 'revoked']);
        const isExplicitFailure = explicitFailureStates.has(normalized.data?.state)
          || /卡密.*(禁用|过期|不存在|未生效|撤销)/.test(String(normalized.data?.message || normalized.error || ''));
        const failureText = normalized.data?.message || normalized.error || RESOLVER_STATE_TEXT_MAP[normalized.data?.state] || '卡密无效';

        if (isExplicitFailure) {
          return { ok: false, error: failureText };
        }
        if (!normalized.ok) {
          lastError = failureText || '卡密不存在或未生效';
          continue;
        }
        if (!normalized.data?.host && !normalized.data?.serverBase) {
          lastError = '卡密已匹配，但接口未返回可用服务器地址';
          continue;
        }
        return { ok: true, data: normalized.data };
      }

      return { ok: false, error: lastError || '卡密不存在或未生效' };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

// 设置/更新/持久化：applyResolvedConfigToStore的具体业务逻辑。
  function applyResolvedConfigToStore({ resolved }) {
    const next = {};
    const resolvedHttpBase = String(
      resolved.serverBase
      || resolved.address_HTTP
      || resolved.addressHttp
      || resolved.address_http
      || resolved.address
      || ''
    ).trim();
    if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
      const runtimeConfig = {
        serverBase: resolvedHttpBase,
      };
      if (resolved.platformName) {
        runtimeConfig.platformName = resolved.platformName;
      }
      if (Array.isArray(resolved.allowedPlatforms) && resolved.allowedPlatforms.length > 0) {
        runtimeConfig.allowedPlatforms = resolved.allowedPlatforms;
      }
      if (String(resolved.targetUrl || '').trim()) {
        runtimeConfig.targetUrl = String(resolved.targetUrl || '').trim();
      }
      if (String(resolved.tutorialUrl || '').trim()) {
        runtimeConfig.tutorialUrl = String(resolved.tutorialUrl || '').trim();
      }
      licenseCache.setRuntimeConfig(runtimeConfig);
    }
    try {
      const resolvedTcpMeta = resolved.tcp && typeof resolved.tcp === 'object'
        ? resolved.tcp
        : resolveTcpAddressMeta(
            resolved.address_TCP
            || resolved.addressTcp
            || resolved.address_tcp
            || ''
          );
      if (resolved.tcp && typeof resolved.tcp === 'object') {
        setRuntimeTcpConfig({
          host: resolved.tcp.host || '',
          port: resolved.tcp.port || 0,
          transport: resolved.tcp.transport || {},
        });
      } else if (resolvedTcpMeta) {
        setRuntimeTcpConfig({
          host: resolvedTcpMeta.host || '',
          port: resolvedTcpMeta.port || 0,
          transport: {},
        });
      } else {
        setRuntimeTcpConfig(null);
      }
      setRuntimeServerBase(resolvedHttpBase);
    } catch (e) {
      logger.warn?.('[配置] 写入运行时 TCP 配置失败:', e?.message || e);
    }

    return next;
  }

  return {
    detectPlatformKeyFromRuntime,
    readPlatformsConfigSafe,
    getPlatformDefaultConfig,
    normalizeCardStatusSearchUrl,
    resolveHostFromAddress,
    resolveServerBaseFromAddress,
    isCardExpiredByDate,
    resolveCardStatusSearchConfig,
    normalizeCardStatusSearchResponse,
    getLocalResolverConfig,
    normalizeResolverResponse,
    resolveServerConfigForKey,
    applyResolvedConfigToStore,
  };
}

module.exports = {
  createServerResolver,
};
