const path = require('path');
const { app } = require('electron');
const fs = require('fs');

// 集中配置与常量（可通过环境变量覆盖）

// 开发环境默认配置
let DREAM_TARGET_URL = 'https://dreamina.capcut.com/ai-tool/home?';
let RUNTIME_TCP_CONFIG = null;
let RUNTIME_SERVER_BASE = '';

function isHttpCompatModeEnabled() {
  const flag = String(
    process.env.FORCE_HTTP_COMPAT_MODE
    || process.env.NETWORK_COMPAT_MODE
    || process.env.DISABLE_TCP_CONNECTION
    || process.env.NO_TCP
    || ''
  ).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'http', 'http-only', 'compat', 'compat-mode'].includes(flag);
}

const DEFAULT_TCP_TRANSPORT = {
  preferred: 'tls',
  allowHttpFallback: true,
  allowPlainFallback: false,
  tls: {
    enabled: true,
    rejectUnauthorized: false,
  },
};

// 规范化 TCP 端口，非法值回退到默认端口。
function normalizeTcpPort(port, fallback = 58113) {
  const resolved = Number(port);
  if (!Number.isFinite(resolved) || resolved <= 0) {
    return fallback;
  }
  return Math.round(resolved);
}

// 读取平台配置文件，用于 sideUrl 等启动入口配置。
function readPlatformsConfigSafe() {
  try {
    const candidates = [
      path.join(app.getAppPath ? app.getAppPath() : '', 'config', 'platforms-config.json'),
      path.join(process.cwd(), 'config', 'platforms-config.json'),
      path.join(__dirname, '../../../../config/platforms-config.json'),
      path.join(__dirname, '../../../../platforms-config.json'),
    ].filter(Boolean);

    for (const configPath of candidates) {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(raw || '{}');
    }
  } catch (_) {}
  return {};
}

// 将 sideUrl 归一成可直接访问的完整 URL，不额外补路径。
function normalizeSideUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    url.hash = '';
    return url.toString();
  } catch (_) {
    return value;
  }
}

// 把许可证记录压缩成适合持久化的最小结构。
function normalizeLicenseRecordForStore(entry = {}) {
  const keyValue = String(entry.keyValue || entry.key || '').trim();
  if (!keyValue) return null;
  return {
    id: String(entry.id || keyValue || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    keyValue,
  };
}

// 清理 store 中与许可证缓存无关的冗余字段，避免旧数据污染。
function pruneStoreLicenseFields(storeConfig = {}) {
  const next = { ...(storeConfig || {}) };
  let changed = false;

  if (next.userCredentials && typeof next.userCredentials === 'object') {
    const normalizedCredentials = {
      key: String(next.userCredentials.key || '').trim(),
    };
    if (JSON.stringify(next.userCredentials) !== JSON.stringify(normalizedCredentials)) {
      next.userCredentials = normalizedCredentials;
      changed = true;
    }
  }

  for (const field of [
    'tcp',
    'targetUrl',
    'tutorialUrl',
    'allowedPlatforms',
    'serverBase',
    'platformName',
    'licenseUsage',
    'licenseRegionInfo',
    'lastValidatedAt',
    'licenseValidated',
    'cardStatus',
    'cardExpiryDate',
    'systemProxyMode',
    'systemProxyEnabled',
    'validationSuccessCount',
    'magicStateRestoreReady',
    'removeWatermarkEnabled',
    'translateExtEnabled',
  ]) {
    if (Object.prototype.hasOwnProperty.call(next, field)) {
      delete next[field];
      changed = true;
    }
  }

  return { next, changed };
}

/**
 * 初始化核心目录：打包后将resources/core复制到用户数据目录
 */
// 初始化用户数据目录下的 core/store 结构，并清理旧版遗留数据。
function initializeCoreDirectory() {
  try {
    // 新策略：不再从 resources 复制整个 core 目录到用户数据目录。
    // 仅确保用户数据目录下的 core 结构存在，若缺失则创建最小需要的目录与默认 store。
    const userDataCoreDir = path.join(app.getPath('userData'), 'core');
    const storeDir = getStoreDir();

    // 确保 core 根目录存在
    if (!fs.existsSync(userDataCoreDir)) {
      fs.mkdirSync(userDataCoreDir, { recursive: true });
    }

    if (fs.existsSync(storeDir)) {
      try {
        const stat = fs.statSync(storeDir);
        if (stat.isFile()) {
          fs.unlinkSync(storeDir);
          console.log('[配置] 已清理旧的 store 文件');
        }
      } catch (e) {
        console.warn('[配置] 检查 store 目录失败:', e?.message || e);
      }
    }

    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    const storePath = getStorePath();

    try {
      if (fs.existsSync(storePath)) {
        const rawStore = fs.readFileSync(storePath, 'utf8');
        const parsedStore = JSON.parse(rawStore || '{}');
        const pruned = pruneStoreLicenseFields(parsedStore);
        if (pruned.changed) {
          fs.writeFileSync(storePath, JSON.stringify(pruned.next, null, 2), { encoding: 'utf8' });
          console.log('[配置] 已清理 store/content 中的卡密元数据，仅保留卡密记录');
        }
      }
    } catch (e) {
      console.warn('[配置] 清理 store/content 卡密元数据失败:', e?.message || e);
    }

    // 如果 store 不存在，则创建一个最小默认配置（避免覆盖已有用户配置）
    // 使用统一的 getStorePath()（位于用户数据根目录的 store/content），避免与其他模块期望位置不一致
    if (!fs.existsSync(storePath)) {
      // 先使用内置的默认值（若被意外替换破坏，请恢复此结构）
      // 默认值会在卡密验证成功后被覆盖为接口返回服务器配置
      let defaultStore = {
};
      

        fs.writeFileSync(storePath, JSON.stringify(defaultStore, null, 2), { encoding: 'utf8' });
        console.log('[配置] 已创建默认 store/content:', storePath);
    }
    return true;
  } catch (error) {
    console.error('[配置] 初始化核心目录失败:', error);
    return false;
  }
}

// TCP 服务器配置（从 store 获取）
// 读取当前 store 配置，失败时返回空对象。
function getStoreConfig() {
  try {
    const storePath = getStorePath();
    if (!fs.existsSync(storePath)) {
      console.warn('[配置] store不存在，使用默认配置');
      return {};
    }
    const storeData = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(storeData);
  } catch (error) {
    console.warn('[配置] 无法读取 store，使用默认配置:', error.message);
    return {};
  }
}

// 动态获取 TCP 配置（每次调用都会重新读取 store，保证在 initializeCoreDirectory 创建默认 store 后能及时生效）
// 生成当前可用的 TCP 配置，优先使用运行时覆盖值。
function getTcpConfig() {
  try {
    const httpCompatMode = isHttpCompatModeEnabled();
    if (RUNTIME_TCP_CONFIG && typeof RUNTIME_TCP_CONFIG === 'object') {
      const runtimeTransport = RUNTIME_TCP_CONFIG.transport || {};
      return {
        host: RUNTIME_TCP_CONFIG.host || '127.0.0.1',
        port: normalizeTcpPort(RUNTIME_TCP_CONFIG.port),
        transport: {
          preferred: httpCompatMode ? 'http' : String(runtimeTransport.preferred || 'tls').toLowerCase(),
          allowHttpFallback: RUNTIME_TCP_CONFIG.transport?.allowHttpFallback !== false,
          allowPlainFallback: false,
          tls: {
            enabled: true,
            rejectUnauthorized: runtimeTransport.tls?.rejectUnauthorized === true,
            caPath: runtimeTransport.tls?.caPath || '',
            certFingerprint: runtimeTransport.tls?.certFingerprint || '',
          },
        },
      };
    }

    const cfg = getStoreConfig();
    const tcpCfg = cfg.tcp || {};
    const transportCfg = tcpCfg.transport || cfg.transport || cfg.connectionTransport || {};
    const tlsCfg = transportCfg.tls || {};
    return {
      host: tcpCfg.host || '127.0.0.1',
      port: normalizeTcpPort(tcpCfg.port),
      transport: {
        preferred: httpCompatMode ? 'http' : String(transportCfg.preferred || 'tls').toLowerCase(),
        allowHttpFallback: transportCfg.allowHttpFallback !== false,
        allowPlainFallback: false,
        tls: {
          enabled: true,
          rejectUnauthorized: tlsCfg.rejectUnauthorized === true,
          caPath: String(tlsCfg.caPath || tlsCfg.ca_path || '').trim(),
          certFingerprint: String(tlsCfg.certFingerprint || tlsCfg.cert_fingerprint || '').trim(),
        },
      }
    };
  } catch (_) {
    return {
      host: '127.0.0.1',
      port: normalizeTcpPort(null),
      transport: { ...DEFAULT_TCP_TRANSPORT }
    };
  }
}

// 动态获取 HTTP 服务器 base（支持环境变量与 store）
// 解析当前 HTTP 服务基址，按环境变量、运行时值、store 逐层兜底。
function getServerBase() {
  try {
    const httpCompatMode = isHttpCompatModeEnabled();

    if (httpCompatMode && RUNTIME_SERVER_BASE && typeof RUNTIME_SERVER_BASE === 'string') {
      return RUNTIME_SERVER_BASE.replace(/\/+$/, '');
    }

    const envBase = process.env.SERVER_BASE;
    if (envBase && typeof envBase === 'string') {
      return envBase.replace(/\/+$/, '');
    }

    if (RUNTIME_SERVER_BASE && typeof RUNTIME_SERVER_BASE === 'string') {
      return RUNTIME_SERVER_BASE.replace(/\/+$/, '');
    }

    const cfg = getStoreConfig() || {};
    const directBase =
      cfg.serverBase ||
      cfg.server_base ||
      cfg.httpBase ||
      cfg.http_base ||
      cfg.apiBase ||
      cfg.api_base;
    if (directBase && typeof directBase === 'string') {
      return directBase.replace(/\/+$/, '');
    }

    const httpCfg = cfg.http || cfg.httpServer || cfg.server || cfg.api;
    if (httpCfg && typeof httpCfg === 'object') {
      const protocol = httpCfg.protocol || (httpCfg.https ? 'https' : 'http');
      const host = httpCfg.host || httpCfg.hostname;
      const port = httpCfg.port || httpCfg.httpPort || httpCfg.http_port;
      if (host) {
        return `${protocol}://${host}${port ? `:${port}` : ''}`.replace(/\/+$/, '');
      }
    }

    // 最后兜底：由 TCP 配置直接推导 HTTP 地址，保持返回端口原样
    const tcp = getTcpConfig();
    const host = tcp?.host;
    let port = Number(cfg.httpPort || cfg.http_port);
    if (!port && Number.isFinite(Number(tcp?.port))) {
      port = Number(tcp.port);
    }
    if (host) {
      return `http://${host}${port ? `:${port}` : ''}`.replace(/\/+$/, '');
    }
  } catch (_) {}
  return '';
}

// 读取当前平台的侧边栏入口地址。
function getSideUrl() {
  try {
    const cfg = readPlatformsConfigSafe() || {};
    const platformConfigs = cfg.platformConfigs || {};
    const defaultPlatform = String(cfg.defaultPlatform || '').trim();
    const platformCfg = (defaultPlatform && platformConfigs[defaultPlatform])
      || platformConfigs.default
      || platformConfigs[Object.keys(platformConfigs)[0]]
      || {};
    const rawSideUrl =
      platformCfg.sideUrl
      || cfg.sideUrl
      || platformCfg.sidebarUrl
      || cfg.sidebarUrl
      || '';
    return normalizeSideUrl(rawSideUrl);
  } catch (_) {
    return '';
  }
}

// 网络诊断配置
const NETWORK_DIAG_CONFIG = {
  CONNECTION_TIMEOUT: 30000, // 连接超时时间 (30秒)
  REQUEST_TIMEOUT: 5000,     // 请求超时时间 (5秒)
  RETRY_ATTEMPTS: 3,         // 重试次数
  RETRY_DELAY: 2000,         // 重试间隔 (2秒)
};

// ---- 动态URL设置 ----

// 设置动态获取的目标URL
// 更新即梦页面的目标地址，只接受合法 http(s) URL。
function setDreamTargetUrl(url) {
  if (url && typeof url === 'string' && url.startsWith('http')) {
    DREAM_TARGET_URL = url;
    console.log('[配置] DREAM_TARGET_URL 已更新为:', url);
  } else {
    console.warn('[配置] 无效的URL，保持原有值:', url);
  }
}

// 获取当前即梦页面目标地址。
function getDreamTargetUrl() {
  return DREAM_TARGET_URL;
}

// 设置运行时 TCP 配置，供登录后或动态下发场景覆盖 store。
function setRuntimeTcpConfig(tcpConfig = null) {
  if (!tcpConfig || typeof tcpConfig !== 'object') {
    RUNTIME_TCP_CONFIG = null;
    return null;
  }

  const host = String(tcpConfig.host || '').trim();
  const port = Number(tcpConfig.port);
  if (!host || !Number.isFinite(port) || port <= 0) {
    RUNTIME_TCP_CONFIG = null;
    return null;
  }

  RUNTIME_TCP_CONFIG = {
    host,
    port: normalizeTcpPort(port),
    transport: {
      preferred: String(tcpConfig.transport?.preferred || 'tls').toLowerCase(),
      allowHttpFallback: tcpConfig.transport?.allowHttpFallback !== false,
      allowPlainFallback: false,
      tls: {
        enabled: true,
        rejectUnauthorized: tcpConfig.transport?.tls?.rejectUnauthorized === true,
        caPath: String(tcpConfig.transport?.tls?.caPath || tcpConfig.transport?.tls?.ca_path || '').trim(),
        certFingerprint: String(tcpConfig.transport?.tls?.certFingerprint || tcpConfig.transport?.tls?.cert_fingerprint || '').trim(),
      },
    },
  };
  return { ...RUNTIME_TCP_CONFIG };
}

// 设置运行时 HTTP 基址覆盖值。
function setRuntimeServerBase(serverBase = '') {
  RUNTIME_SERVER_BASE = String(serverBase || '').trim();
  return RUNTIME_SERVER_BASE;
}

// ---- 路径配置 ----

// 获取核心目录路径（支持打包后环境）
// 查找 clash-mini core 的实际安装目录，兼容打包和开发环境。
function getCoreDir() {
  try {
    const candidates = [];

    if (app && app.isPackaged) {
      const installDir = path.dirname(app.getPath('exe'));
      candidates.push(path.join(process.resourcesPath || '', 'resource', 'extensions', 'clash-mini', 'core'));
      candidates.push(path.join(installDir, 'resources', 'resource', 'extensions', 'clash-mini', 'core'));
      candidates.push(path.join(process.resourcesPath || '', 'resource', 'core'));
      candidates.push(path.join(installDir, 'resources', 'resource', 'core'));
    } else {
      candidates.push(path.join(__dirname, '../../../assets/extensions/clash-mini/core'));
      candidates.push(path.join(process.cwd(), 'src', 'assets', 'extensions', 'clash-mini', 'core'));
      let currentDir = __dirname;
      while (currentDir !== path.parse(currentDir).root) {
        candidates.push(path.join(currentDir, 'core'));
        currentDir = path.dirname(currentDir);
      }
      candidates.push(path.join(__dirname, '../../../../core'));
      candidates.push(path.join(process.cwd(), 'core'));
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      const hasCoreFiles =
        fs.existsSync(path.join(candidate, 'verge-mihomo.exe')) ||
        fs.existsSync(path.join(candidate, 'config.yaml')) ||
        fs.existsSync(path.join(candidate, 'self.yaml'));
      if (hasCoreFiles) {
        return candidate;
      }
    }

    return candidates[candidates.length - 1] || path.join(__dirname, '../../../../core');
  } catch (_) {
    return path.join(__dirname, '../../../../core');
  }
}

// 获取 store 的稳定位置（始终放在用户数据根目录下的 store/content，避免放在 core 子目录）
// 获取 store 目录的稳定路径，始终优先放在用户数据目录。
function getStoreDir() {
  try {
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'store');
    }
    return path.join(__dirname, '../../../../core', 'store');
  } catch (_) {
    return path.join(__dirname, '../../../../core', 'store');
  }
}

// 获取 store/content 文件路径。
function getStorePath() {
  try {
    return path.join(getStoreDir(), 'content');
  } catch (_) {
    return path.join(__dirname, '../../../../core', 'store', 'content');
  }
}

module.exports = {
  DREAM_TARGET_URL,
  setDreamTargetUrl,
  getDreamTargetUrl,
  setRuntimeTcpConfig,
  setRuntimeServerBase,
  NETWORK_DIAG_CONFIG,
  // 路径相关
  getCoreDir,
  getStorePath,
  // 核心文件管理
  initializeCoreDirectory,
  getTcpConfig,
  getServerBase,
  getSideUrl,
};


