console.log('========================================');
console.log('HeySure VPN 正在启动...');
console.log('========================================');

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
global.app = app;
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const axios = require('axios');
const YAML = require('yaml');
// tray/background functionality removed

// Backend Manager - 后端进程管理
let goBackendProcess = null;
const SELF_CONFIG_NAME = 'self.yaml';
const RUNTIME_CONFIG_NAME = 'config.yaml';
const API_SECRET = process.env.HEYSURE_API_TOKEN || '';
let API_TOKEN = API_SECRET;
const API_PORT = Number(process.env.HEYSURE_API_PORT || 9090);
const API_HOST = process.env.HEYSURE_API_HOST || '127.0.0.1';
const DNS_PORT = Number(process.env.HEYSURE_DNS_PORT || 10530);
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;
const CONTROL_HOST = process.env.HEYSURE_CONTROL_HOST || '127.0.0.1';
const CONTROL_PORT = Number(process.env.HEYSURE_CONTROL_PORT || 9777);
const CONTROL_TOKEN = process.env.HEYSURE_CONTROL_TOKEN || API_SECRET || '';
const HEADLESS_MODE = ['1', 'true', 'yes'].includes(String(process.env.HEYSURE_HEADLESS || '').toLowerCase());
let controlServer = null;
let activeConfigMeta = {
  source: '',
  sourceType: '',
  runtimePath: '',
  importedAt: null,
  configName: '',
};

function getCoreSearchBases() {
  const candidateBases = [];
  if (app.isPackaged) {
    candidateBases.push(process.resourcesPath || '');
    try {
      candidateBases.push(path.join(path.dirname(app.getPath('exe')), 'resources'));
    } catch (e) {
      // ignore
    }
  } else {
    candidateBases.push(process.cwd());
    candidateBases.push(__dirname);
  }
  return candidateBases.filter(Boolean);
}

function copyDirectoryRecursive(src, dest, { overwrite = false } = {}) {
  if (!src || !dest || !fs.existsSync(src)) return false;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath, { overwrite });
      continue;
    }

    if (!overwrite && fs.existsSync(destPath)) {
      continue;
    }

    try {
      fs.copyFileSync(srcPath, destPath);
    } catch (error) {
      console.warn('[Backend] 复制文件失败:', srcPath, '->', destPath, error?.message || error);
    }
  }

  return true;
}

function isDirectoryWritable(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function getRuntimeCoreBase() {
  try {
    return path.join(app.getPath('userData'), 'core');
  } catch (_) {
    return path.join(process.cwd(), 'core');
  }
}

function resolveBundledCoreDir() {
  const bases = getCoreSearchBases();
  for (const base of bases) {
    const candidate = path.join(base, 'resource', 'extensions', 'clash-mini', 'core');
    if (
      fs.existsSync(path.join(candidate, 'verge-mihomo.exe')) ||
      fs.existsSync(path.join(candidate, 'config.yaml')) ||
      fs.existsSync(path.join(candidate, 'self.yaml'))
    ) {
      return candidate;
    }
  }
  return null;
}

function prepareRuntimeCoreDir() {
  const bundledCoreDir = resolveBundledCoreDir();
  if (!bundledCoreDir || !fs.existsSync(bundledCoreDir)) {
    return null;
  }

  if (isDirectoryWritable(bundledCoreDir)) {
    return bundledCoreDir;
  }

  const runtimeCoreDir = getRuntimeCoreBase();
  try {
    fs.mkdirSync(runtimeCoreDir, { recursive: true });
    if (path.resolve(runtimeCoreDir) !== path.resolve(bundledCoreDir)) {
      copyDirectoryRecursive(bundledCoreDir, runtimeCoreDir, { overwrite: false });
    }
  } catch (error) {
    console.warn('[Backend] 准备运行目录失败:', error?.message || error);
    return null;
  }

  return runtimeCoreDir;
}

function resolveCoreDir() {
  const runtimeCoreDir = getRuntimeCoreBase();
  if (
    fs.existsSync(path.join(runtimeCoreDir, SELF_CONFIG_NAME)) ||
    fs.existsSync(path.join(runtimeCoreDir, RUNTIME_CONFIG_NAME)) ||
    fs.existsSync(path.join(runtimeCoreDir, 'verge-mihomo.exe'))
  ) {
    return runtimeCoreDir;
  }

  const bundledCoreDir = resolveBundledCoreDir();
  if (bundledCoreDir) {
    return bundledCoreDir;
  }

  return runtimeCoreDir;
}

function getRuntimeConfigPath(coreDir) {
  return path.join(coreDir, RUNTIME_CONFIG_NAME);
}

function normalizeRuntimeConfig(parsed) {
  const config = parsed && typeof parsed === 'object' ? parsed : {};
  config['external-controller'] = `${API_HOST}:${API_PORT}`;
  if (!config.dns) config.dns = {};
  config.dns.listen = `127.0.0.1:${DNS_PORT}`;
  if (!Object.prototype.hasOwnProperty.call(config, 'secret') || !config.secret) {
    config.secret = API_SECRET;
  }
  API_TOKEN = config.secret || '';
  return config;
}

function writeRuntimeConfig(coreDir, config, meta = {}) {
  const target = getRuntimeConfigPath(coreDir);
  const configText = YAML.stringify(normalizeRuntimeConfig(config));
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== configText) {
    fs.writeFileSync(target, configText, 'utf8');
    console.log(`[Backend] 已写入运行配置: ${target}`);
  }
  activeConfigMeta = {
    source: meta.source || activeConfigMeta.source || '',
    sourceType: meta.sourceType || activeConfigMeta.sourceType || '',
    runtimePath: target,
    importedAt: meta.importedAt || activeConfigMeta.importedAt || new Date().toISOString(),
    configName: meta.configName || activeConfigMeta.configName || path.basename(meta.source || '') || path.basename(target),
  };
  return target;
}

function loadYamlConfig(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`配置文件内容无效: ${filePath}`);
  }
  return parsed;
}

function syncSelfYamlToRuntimeConfig(coreDir) {
  const source = path.join(coreDir, SELF_CONFIG_NAME);
  const target = path.join(coreDir, RUNTIME_CONFIG_NAME);
  if (!fs.existsSync(source)) {
    throw new Error(`未找到配置文件 ${source}`);
  }
  const parsed = loadYamlConfig(source);
  const runtimePath = writeRuntimeConfig(coreDir, parsed, {
    source,
    sourceType: 'legacy-self-yaml',
    configName: SELF_CONFIG_NAME,
  });
  console.log(`[Backend] 已同步 ${SELF_CONFIG_NAME} -> ${RUNTIME_CONFIG_NAME}`);
  return runtimePath;
}

function importConfigToRuntime(coreDir, { path: sourcePath, content, name } = {}) {
  let parsed;
  let source = '';
  if (typeof content === 'string' && content.trim()) {
    parsed = YAML.parse(content);
    source = name || 'inline-config';
  } else if (sourcePath) {
    source = sourcePath;
    parsed = loadYamlConfig(sourcePath);
  } else {
    throw new Error('缺少配置内容或配置文件路径');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('配置内容解析失败');
  }
  const runtimePath = writeRuntimeConfig(coreDir, parsed, {
    source,
    sourceType: sourcePath ? 'file' : 'inline',
    importedAt: new Date().toISOString(),
    configName: name || path.basename(source || RUNTIME_CONFIG_NAME) || RUNTIME_CONFIG_NAME,
  });
  return {
    ok: true,
    runtimePath,
    configName: path.basename(runtimePath),
    source,
  };
}

function readRuntimeConfig(coreDir) {
  const configPath = path.join(coreDir, RUNTIME_CONFIG_NAME);
  if (!fs.existsSync(configPath)) return {};
  try {
    return YAML.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function getManualGroupName(coreDir) {
  const config = readRuntimeConfig(coreDir);
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const manualGroup = groups.find(group => group && group.type === 'select' && group.name);
  return manualGroup?.name || groups[0]?.name || '节点选择';
}

function getCurrentConfigSnapshot(coreDir) {
  const runtimePath = getRuntimeConfigPath(coreDir);
  let runtimeConfig = {};
  try {
    if (fs.existsSync(runtimePath)) {
      runtimeConfig = loadYamlConfig(runtimePath);
    }
  } catch (_) {}
  return {
    activeConfigMeta,
    runtimePath,
    hasRuntimeConfig: fs.existsSync(runtimePath),
    hasLegacySelfConfig: fs.existsSync(path.join(coreDir, SELF_CONFIG_NAME)),
    proxyGroups: Array.isArray(runtimeConfig['proxy-groups']) ? runtimeConfig['proxy-groups'].map(g => g?.name).filter(Boolean) : [],
  };
}

function normalizeProxyNameList(input) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const n = String(name || '').trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      push(value);
      return;
    }
    if (typeof value === 'object') {
      if (Array.isArray(value.proxies)) value.proxies.forEach(walk);
      if (Array.isArray(value.all)) value.all.forEach(walk);
      if (Array.isArray(value.nodes)) value.nodes.forEach(walk);
      if (Array.isArray(value.items)) value.items.forEach(walk);
      if (Array.isArray(value.children)) value.children.forEach(walk);
      if (Array.isArray(value.groups)) value.groups.forEach(walk);
      if (value.name) push(value.name);
      if (value.now && typeof value.now === 'string') push(value.now);
      if (value.type && typeof value.type === 'string' && value.type !== 'select') {
        // ignore
      }
      for (const [k, v] of Object.entries(value)) {
        if (['name', 'type', 'now', 'all', 'proxies', 'nodes', 'items', 'children', 'groups', 'history'].includes(k)) continue;
        if (typeof v === 'string' || typeof v === 'number') push(v);
      }
    }
  };

  walk(input);
  return out;
}

function extractDelayValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const m = value.match(/(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
    return null;
  }
  if (value && typeof value === 'object') {
    if (typeof value.delay === 'number' && Number.isFinite(value.delay) && value.delay >= 0) return value.delay;
    if (typeof value.delay === 'string') {
      const parsed = extractDelayValue(value.delay);
      if (parsed != null) return parsed;
    }
    if (typeof value.latency === 'number' && Number.isFinite(value.latency) && value.latency >= 0) return value.latency;
    if (typeof value.history === 'object') {
      const parsed = extractDelayValue(value.history);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

function normalizeDelayMap(input, names = []) {
  const map = {};
  const nameSet = new Set((names || []).map(n => String(n || '').trim()).filter(Boolean));

  const assign = (name, value) => {
    const n = String(name || '').trim();
    if (!n) return;
    const delay = extractDelayValue(value);
    if (delay != null && (!nameSet.size || nameSet.has(n))) {
      map[n] = delay;
    }
  };

  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'number' || typeof value === 'string') return;
    if (typeof value !== 'object') return;

    if (Array.isArray(value.results)) {
      value.results.forEach(walk);
    }
    if (Array.isArray(value.history)) {
      value.history.forEach(walk);
    }
    if (Array.isArray(value.proxies)) {
      value.proxies.forEach(item => {
        if (typeof item === 'string' || typeof item === 'number') {
          assign(item, item);
        } else if (item && typeof item === 'object') {
          assign(item.name || item.proxy || item.group || item.id, item.delay ?? item.latency ?? item.value ?? item);
        }
      });
    }
    for (const [k, v] of Object.entries(value)) {
      if (['results', 'history', 'proxies', 'now', 'name', 'type', 'all', 'nodes', 'items', 'children', 'groups'].includes(k)) continue;
      if (typeof v === 'number' || typeof v === 'string') assign(k, v);
      else if (v && typeof v === 'object' && (v.delay != null || v.latency != null)) assign(k, v.delay ?? v.latency ?? v);
    }
    if (value.name && (value.delay != null || value.latency != null)) {
      assign(value.name, value.delay ?? value.latency);
    }
  };

  walk(input);
  return map;
}

/**
 * 启动 Go 后端可执行文件
 * @returns {import('child_process').ChildProcess | null} 返回子进程实例或 null
 */
function startGoBackend() {
  const exeName = 'verge-mihomo.exe';
  const coreDir = prepareRuntimeCoreDir() || resolveCoreDir();
  const exePath = coreDir ? path.join(coreDir, exeName) : null;

  if (exePath) {
    console.log(`[Backend] 检查后端候选路径: ${exePath}`);
  }

  if (!exePath) {
    console.error('[Backend] 错误: 未找到后端可执行文件');
    dialog.showErrorBox('启动失败', `未找到后端程序 ${exeName}，请确保它被包含在安装包的 core 文件夹中。`);
    app.quit();
    return null;
  }

  if (!fs.existsSync(exePath)) {
    console.error(`[Backend] 错误: 后端可执行文件不存在: ${exePath}`);
    dialog.showErrorBox('启动失败', `未找到后端程序 ${exeName}，请确保它被包含在安装包的 core 文件夹中。`);
    app.quit();
    return null;
  }

  try {
    const runtimePath = getRuntimeConfigPath(coreDir);
    if (fs.existsSync(runtimePath)) {
      try {
        const parsed = loadYamlConfig(runtimePath);
        writeRuntimeConfig(coreDir, parsed, {
          source: activeConfigMeta.source || runtimePath,
          sourceType: activeConfigMeta.sourceType || 'runtime',
          configName: activeConfigMeta.configName || path.basename(runtimePath),
        });
      } catch (err) {
        console.warn('[Backend] 现有运行配置无效，尝试 legacy self.yaml:', err?.message || err);
        syncSelfYamlToRuntimeConfig(coreDir);
      }
    } else if (activeConfigMeta.source && fs.existsSync(activeConfigMeta.source)) {
      importConfigToRuntime(coreDir, { path: activeConfigMeta.source, name: activeConfigMeta.configName });
    } else if (fs.existsSync(path.join(coreDir, SELF_CONFIG_NAME))) {
      syncSelfYamlToRuntimeConfig(coreDir);
    } else {
      console.warn('[Backend] 未找到可用配置，控制面将保持可用，等待主动导入配置。');
      return null;
    }
  } catch (err) {
    console.error('[Backend] 准备运行配置失败:', err?.message || err);
    return null;
  }

  console.log(`[Backend] 使用后端程序: ${exePath}`);
  console.log('[Backend] 正在启动后端服务...');
  goBackendProcess = spawn(exePath, ['-d', coreDir], {
    stdio: 'pipe',
    cwd: coreDir
  });

  goBackendProcess.stdout.on('data', (data) => {
    console.log(`[Backend STDOUT]: ${data.toString().trim()}`);
  });

  goBackendProcess.stderr.on('data', (data) => {
    console.error(`[Backend STDERR]: ${data.toString().trim()}`);
  });

  goBackendProcess.on('close', (code) => {
    console.log(`[Backend] 后端进程已退出，退出码: ${code}`);
    const isQuitting = global.willQuit || false;
    if (!isQuitting) {
      dialog.showErrorBox('后端服务意外终止', '核心服务已停止运行，请重启应用。');
    }
    goBackendProcess = null;
  });

  goBackendProcess.on('error', (err) => {
    console.error('[Backend] 启动后端进程失败:', err);
    dialog.showErrorBox('启动失败', `无法启动后端程序: ${err.message}`);
    goBackendProcess = null;
  });

  return goBackendProcess;
}

function getBackendProcess() {
  return goBackendProcess;
}

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000, // 增加默认超时时间
});

// 统一处理认证和错误
client.interceptors.request.use(config => {
  if (API_TOKEN) {
    config.headers.Authorization = `Bearer ${API_TOKEN}`;
  }
  try {
    const method = (config.method || 'GET').toUpperCase();
    const url = config.url || '';
    const data = config.data || {};

    // 生成简要说明
    let note = (() => {
      if (url === '/version') return '检查控制面';
      if (url === '/configs') return '读取或重载配置';
      if (url.startsWith('/proxies/') && url.includes('/delay')) return '测试节点延时';
      if (url.startsWith('/proxies/')) return '读取/切换代理组';
      if (url.startsWith('/providers/proxies')) return '读取/更新代理提供者';
      if (url === '/traffic') return '获取流量';
      return '';
    })();

    const shortUrl = (url || '').split('?')[0];
    if (shortUrl === '/traffic') return config;

    // 控制台也打印，确保在窗口销毁时仍可观察
    console.log(`[API] ${method} ${shortUrl}${note ? ' - ' + note : ''}`);
    if (global.mainWindow?.webContents && !global.mainWindow.webContents.isDestroyed()) {
      global.mainWindow.webContents.send('api-request-brief', { method, url: shortUrl, note });
      // 告诉渲染进程请求已开始（用于 UI 锁定）
      try { global.mainWindow.webContents.send('api-request-start', { method, url: shortUrl, note }); } catch(_) {}
    }
  } catch (_) {}
  return config;
});

client.interceptors.response.use(
  response => {
    // mihomo-api 的响应体就是数据
    // 在响应到达时通知渲染进程请求完成
    try {
      const shortUrl = (response.config.url || '').split('?')[0];
      if (global.mainWindow?.webContents && !global.mainWindow.webContents.isDestroyed()) {
        global.mainWindow.webContents.send('api-request-end', { method: (response.config.method||'GET').toUpperCase(), url: shortUrl, ok: true });
      }
    } catch(_) {}
    if (response.config.url.startsWith('/proxies') || response.config.url.startsWith('/version') || response.config.url.startsWith('/configs')) {
      return response.data;
    }
    return response.data;
  },
  error => {
    // 在错误时也通知渲染进程请求完成（失败）
    try {
      const cfg = error.config || {};
      const shortUrl = (cfg.url || '').split('?')[0];
      if (global.mainWindow?.webContents && !global.mainWindow.webContents.isDestroyed()) {
        global.mainWindow.webContents.send('api-request-end', { method: (cfg.method||'GET').toUpperCase(), url: shortUrl, ok: false, error: error.message });
      }
    } catch(_) {}
    if (error.response) {
      const data = error.response.data;
      let message = data?.msg || data?.error || data?.message || '请求失败';
      if (typeof data === 'string') message = data;
      return Promise.reject(new Error(`${message} (status: ${error.response.status})`));
    }
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new Error('请求超时'));
    }
    if (error.code === 'ECONNREFUSED') {
      return Promise.reject(new Error('连接被拒绝，请确认后端服务是否正在运行'));
    }
  return Promise.reject(error);
  }
);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectBestNode(names = [], testUrl = 'http://cp.cloudflare.com/generate_204', timeout = 5000) {
  const entries = await Promise.all((names || []).map(async (n) => {
    try {
      const r = await api.testProxyDelay(n, testUrl, timeout);
      const delayValue = extractDelayValue(r);
      return { name: n, delay: delayValue };
    } catch (error) {
      return { name: n, delay: null, error: error?.message || String(error) };
    }
  }));
  const valid = entries.filter(item => typeof item.delay === 'number' && Number.isFinite(item.delay) && item.delay > 0);
  valid.sort((a, b) => a.delay - b.delay);
  return {
    entries,
    best: valid[0] || null,
  };
}

// 封装 API 调用
const api = {
  /**
   * 一键启动
   */
  boot: (options) => client.post('/boot', options),

  /**
   * 安全关闭
   */
  shutdown: () => client.post('/shutdown'),

  /**
   * 获取状态
   */
  getStatus: () => client.get('/status'),

  /**
   * 启动核心
   */
  coreStart: () => client.post('/core/start'),

  /**
   * 停止核心
   */
  coreStop: () => client.post('/core/stop'),

  /**
   * 重载本地配置并重启
   */
  subscription: (url) => client.post('/subscription', { url }),

  /**
   * 获取节点列表
   */
  getProxies: () => client.get('/proxies'),

  /**
   * 选择手动节点
   */
  selectProxy: (name) => client.post('/select-proxy', { name }),

  /**
   * 刷新 Provider
   */
  refreshProvider: () => client.post('/refresh-provider'),

  /**
   * 测试节点延迟
   */
  testProxies: (names, url, timeout) => {
    const params = new URLSearchParams();
    try {
      if (Array.isArray(names) && names.length) params.set('names', names.join(','));
      if (url) params.set('url', url);
      if (timeout) params.set('timeout', String(timeout));
    } catch (_) {}
    const qs = params.toString();
    return client.get(`/test-proxies${qs ? '?' + qs : ''}`);
  },

  /**
   * 获取 mihomo 代理组信息（兼容旧版）
   */
  getMihomoProxies: (groupName) => client.get(`/proxies/${encodeURIComponent(groupName)}`),

  /**
   * 切换 mihomo 代理组（兼容旧版）
   */
  selectMihomoProxy: (groupName, name) => client.put(`/proxies/${encodeURIComponent(groupName)}`, { name }),

  /**
   * 获取 mihomo providers 状态
   */
  getMihomoProviders: () => client.get('/providers/proxies'),

  /**
   * 更新 mihomo provider
   */
  updateMihomoProvider: (name) => client.put(`/providers/proxies/${encodeURIComponent(name)}`),

  /**
   * 测试 mihomo 节点延迟
   */
  testMihomoDelay: (proxyName, testUrl, timeout) => client.get(`/proxies/${encodeURIComponent(proxyName)}/delay?timeout=${timeout}&url=${encodeURIComponent(testUrl)}`),
};

Object.assign(api, {
  getVersion: () => client.get('/version'),
  getConfigs: () => client.get('/configs'),
  reloadConfigs: () => client.put('/configs?force=true', { path: '', payload: '' }),
  getProxyGroup: (groupName) => client.get(`/proxies/${encodeURIComponent(groupName)}`),
  selectProxy: (groupName, name) => client.put(`/proxies/${encodeURIComponent(groupName)}`, { name }),
  getProviders: () => client.get('/providers/proxies'),
  refreshProvider: (name) => client.put(`/providers/proxies/${encodeURIComponent(name)}`),
  testProxyDelay: (proxyName, testUrl, timeout) => client.get(`/proxies/${encodeURIComponent(proxyName)}/delay?timeout=${timeout}&url=${encodeURIComponent(testUrl)}`),
  getConnections: () => client.get('/connections'),
});

Object.assign(api, {
  boot: () => api.reloadConfigs(),
  shutdown: () => Promise.resolve({ ok: true }),
  getStatus: () => api.getVersion(),
  coreStart: () => api.reloadConfigs(),
  coreStop: () => Promise.resolve({ ok: true }),
  subscription: () => api.reloadConfigs(),
  getProxies: (groupName) => api.getProxyGroup(groupName || getManualGroupName(resolveCoreDir())),
  selectProxy: (groupName, name) => {
    if (name === undefined) {
      name = groupName;
      groupName = getManualGroupName(resolveCoreDir());
    }
    return client.put(`/proxies/${encodeURIComponent(groupName)}`, { name });
  },
  refreshProvider: () => {
    const coreDir = resolveCoreDir();
    const groupName = getManualGroupName(coreDir);
    return api.getProviders().then((providers) => {
      const providerNames = Object.keys(providers?.providers || providers || {});
      return providerNames[0]
        ? client.put(`/providers/proxies/${encodeURIComponent(providerNames[0])}`)
        : { ok: true, groupName };
    });
  },
  testProxies: (names, url, timeout) => Promise.all((names || []).map(async (n) => {
    try {
      const r = await api.testProxyDelay(n, url, timeout);
      const delay = (r && (typeof r.delay === 'number' ? r.delay : (typeof r === 'number' ? r : null)));
      return [n, delay ?? null];
    } catch (_) {
      return [n, null];
    }
  })).then(entries => Object.fromEntries(entries)),
  getMihomoProxies: (groupName) => api.getProxyGroup(groupName),
  selectMihomoProxy: (groupName, name) => api.selectProxy(groupName, name),
  getMihomoProviders: () => api.getProviders(),
  updateMihomoProvider: (name) => api.refreshProvider(name),
  testMihomoDelay: (proxyName, testUrl, timeout) => api.testProxyDelay(proxyName, testUrl, timeout),
});

/**
 * CoreManager 现在是一个 API 客户端，负责与 Go 后端通信。
 * 所有核心管理、配置和进程操作都委托给 Go 后端处理。
 */
class CoreManager {
  constructor() {
    this.running = false;
    this.version = ''; // 版本信息现在由后端管理
    this.mainWindow = null; // 仍然用于日志转发（如果需要的话）
  }

  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * 检查核心是否正在运行。
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * 从后端获取并更新当前状态。
   */
  async syncState() {
    try {
      const version = await api.getVersion();
      this.running = true;
      this.version = typeof version === 'string' ? version : (version?.version || version?.data?.version || '');
      const config = await api.getConfigs().catch(() => ({}));
      return {
        core_running: true,
        proxy_enabled: false,
        version: this.version,
        config,
      };
    } catch (e) {
      // 后端可能尚未就绪：静默返回默认状态，避免启动期日志干扰
      this.running = false;
      return { core_running: false, proxy_enabled: false };
    }
  }

  /**
   * 启动核心并确保运行配置可用。
   * @param {object} options - 可传入配置内容、配置路径或保留为空以使用当前运行配置
   * @returns {Promise<any>}
   */
  async boot(options) {
    const coreDir = resolveCoreDir();
    try {
      if (options?.configContent || (options?.configPath && fs.existsSync(options.configPath))) {
        if (options.configContent) {
          importConfigToRuntime(coreDir, { content: options.configContent, name: options.configName });
        } else if (options.configPath && fs.existsSync(options.configPath)) {
          importConfigToRuntime(coreDir, { path: options.configPath, name: options.configName });
        }
      } else if (fs.existsSync(getRuntimeConfigPath(coreDir))) {
        const parsed = loadYamlConfig(getRuntimeConfigPath(coreDir));
        writeRuntimeConfig(coreDir, parsed, {
          source: activeConfigMeta.source || getRuntimeConfigPath(coreDir),
          sourceType: activeConfigMeta.sourceType || 'runtime',
          configName: activeConfigMeta.configName || path.basename(getRuntimeConfigPath(coreDir)),
        });
      } else if (fs.existsSync(path.join(coreDir, SELF_CONFIG_NAME))) {
        syncSelfYamlToRuntimeConfig(coreDir);
      } else {
        throw new Error('尚未导入配置文件');
      }
    } catch (error) {
      throw new Error(`配置准备失败: ${error.message}`);
    }

    if (!goBackendProcess) {
      startGoBackend();
    }

    const started = await this.waitForControlApi();
    if (!started) {
      throw new Error('控制面未就绪');
    }

    await api.reloadConfigs().catch(() => null);
    this.running = true;
    return { ok: true, configPath: path.join(coreDir, RUNTIME_CONFIG_NAME) };
  }

  /**
   * 停止核心。
   * @returns {Promise<any>}
   */
  async stop() {
    const backendProcess = getBackendProcess();
    if (backendProcess) {
      try {
        backendProcess.kill('SIGTERM');
      } catch (_) {}
    }
    goBackendProcess = null;
    this.running = false;
    return { ok: true };
  }

  /**
   * 安全关闭所有服务并退出程序。
   * @returns {Promise<any>}
   */
  async shutdown() {
    const backendProcess = getBackendProcess();
    if (backendProcess) {
      try {
        backendProcess.kill('SIGTERM');
      } catch (_) {}
    }
    goBackendProcess = null;
    this.running = false;
    return { ok: true };
  }

  /**
   * 在手动分组中选择一个节点。
   * @param {string} nodeName
   */
  async setManualNode(nodeName) {
    const groupName = getManualGroupName(resolveCoreDir());
    try {
      return await client.put(`/group/${encodeURIComponent(groupName)}`, { name: nodeName });
    } catch (_) {
      return api.selectProxy(groupName, nodeName);
    }
  }

  /**
   * 获取手动代理分组的节点列表。
   */
  async getProviderProxies() {
    const groupName = getManualGroupName(resolveCoreDir());
    let data = null;
    try {
      data = await client.get(`/group/${encodeURIComponent(groupName)}`);
    } catch (_) {
      data = null;
    }
    if (!data) {
      try {
        data = await api.getProxyGroup(groupName);
      } catch (_) {
        data = null;
      }
    }
    const all = normalizeProxyNameList(data);
    const now = String(data?.now || data?.name || '').trim();
    return { all, now, rawType: Array.isArray(data) ? 'array' : typeof data };
  }

  /**
   * 刷新所有 proxy-provider。
   */
  async updateProvider() {
    const providers = await api.getProviders().catch(() => null);
    const names = Object.keys(providers?.providers || providers?.data?.providers || {});
    const first = names[0];
    if (first) {
      return api.refreshProvider(first);
    }
    return { ok: true };
  }

  /**
   * 测试指定节点的延迟。
   * @param {string[]} names - 节点名称数组
   * @param {string} testUrl
   * @param {number} timeout
   */
  async testDelays(names = [], testUrl = 'http://cp.cloudflare.com/generate_204', timeout = 5000) {
    const groupName = getManualGroupName(resolveCoreDir());

    try {
      const data = await client.get(`/group/${encodeURIComponent(groupName)}/delay?url=${encodeURIComponent(testUrl)}&timeout=${timeout}`);
      const map = normalizeDelayMap(data, names);
      if (Object.keys(map).length > 0) {
        return map;
      }
    } catch (e) {
      console.warn('[延时测试] group delay 失败，回退到单节点测试:', e?.message || e);
    }

    const entries = await Promise.all((names || []).map(async (n) => {
      try {
        const r = await api.testProxyDelay(n, testUrl, timeout);
        const delay = extractDelayValue(r);
        return [n, delay ?? null];
      } catch (e) {
        console.warn(`[延时测试] ${n} 失败:`, e?.message || e);
        return [n, null];
      }
    }));
    return Object.fromEntries(entries);
  }

  async selectBestNode({ names = [], testUrl = 'http://cp.cloudflare.com/generate_204', timeout = 5000, groupName = null, apply = true } = {}) {
    const sourceNames = Array.isArray(names) && names.length ? names : (await this.getProviderProxies()).all;
    const result = await collectBestNode(sourceNames, testUrl, timeout);
    if (result.best && apply) {
      if (groupName) {
        await api.selectProxy(groupName, result.best.name);
      } else {
        await this.setManualNode(result.best.name);
      }
    }
    return result;
  }

  async waitForControlApi(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await api.getVersion();
        return true;
      } catch (_) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    return false;
  }
}

function getControlTokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return (req.headers['x-control-token'] || '').toString().trim();
}

function isControlAuthorized(req) {
  if (!CONTROL_TOKEN) return true;
  return getControlTokenFromRequest(req) === CONTROL_TOKEN;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('请求体必须是 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function startControlServer() {
  if (controlServer) return controlServer;

  controlServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Control-Token');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || `${CONTROL_HOST}:${CONTROL_PORT}`}`);
      if (!isControlAuthorized(req) && url.pathname !== '/health') {
        sendJson(res, 401, { ok: false, error: '未授权' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        const coreDir = resolveCoreDir();
        sendJson(res, 200, {
          ok: true,
          data: {
            running: !!getBackendProcess(),
            control: { host: CONTROL_HOST, port: CONTROL_PORT },
            api: { host: API_HOST, port: API_PORT },
            config: getCurrentConfigSnapshot(coreDir),
          },
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/config') {
        const coreDir = resolveCoreDir();
        sendJson(res, 200, { ok: true, data: getCurrentConfigSnapshot(coreDir) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/config/import') {
        const body = await readJsonBody(req);
        const result = importConfigToRuntime(resolveCoreDir(), body);
        if (getBackendProcess()) {
          try {
            await api.reloadConfigs();
          } catch (_) {}
        }
        sendJson(res, 200, { ok: true, data: result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/core/start') {
        const body = await readJsonBody(req);
        const result = await coreManager.boot(body);
        sendJson(res, 200, { ok: true, data: result });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/core/stop') {
        const result = await coreManager.stop();
        sendJson(res, 200, { ok: true, data: result });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/proxies') {
        const data = await coreManager.getProviderProxies();
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/proxies/test') {
        const body = await readJsonBody(req);
        const data = await coreManager.testDelays(body.names || [], body.url || 'http://cp.cloudflare.com/generate_204', Number(body.timeout || 5000));
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/proxies/select') {
        const body = await readJsonBody(req);
        const groupName = body.groupName || getManualGroupName(resolveCoreDir());
        const data = await api.selectProxy(groupName, body.name);
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/proxies/select-best') {
        const body = await readJsonBody(req);
        const result = await coreManager.selectBestNode({
          names: body.names || [],
          testUrl: body.url || 'http://cp.cloudflare.com/generate_204',
          timeout: Number(body.timeout || 5000),
          groupName: body.groupName || null,
          apply: body.apply !== false,
        });
        sendJson(res, 200, { ok: true, data: result });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/version') {
        const version = await api.getVersion();
        sendJson(res, 200, { ok: true, data: version });
        return;
      }

      sendJson(res, 404, { ok: false, error: '未找到接口' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  });

  controlServer.on('error', (error) => {
    console.error('[Control] 控制接口启动失败:', error?.message || error);
  });

  controlServer.listen(CONTROL_PORT, CONTROL_HOST, () => {
    console.log(`[Control] 本地控制接口已启动: http://${CONTROL_HOST}:${CONTROL_PORT}`);
  });

  return controlServer;
}

// 移除菜单栏
app.on('ready', () => {
  Menu.setApplicationMenu(null);
});

console.log('[启动] 模块加载完成');

global.mainWindow = null;
const coreManager = new CoreManager();

global.willQuit = false;

/**
 * 清理 core 目录中的临时/缓存文件，用于启动或关闭时清理残留数据。
 * - 删除 core/providers 下的所有文件
 * - 删除 core/cache.db
 */
function performCoreCleanup() {
  try {
    const coreDir = resolveCoreDir();
    const providersDir = path.join(coreDir, 'providers');
    const cacheDb = path.join(coreDir, 'cache.db');

    // 更可靠地删除 providers 目录下的所有条目（逐个删除），然后确保目录存在
    if (fs.existsSync(providersDir)) {
      try {
        const entries = fs.readdirSync(providersDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(providersDir, entry.name);
          try {
            fs.rmSync(entryPath, { recursive: true, force: true });
            console.log('[清理] 已删除 providers 条目：', entry.name);
          } catch (err) {
            console.warn('[清理] 删除 providers 条目失败：', entry.name, err?.message || err);
          }
        }
        // 确保 providers 目录存在（删除条目后保留空目录）
        try {
          fs.mkdirSync(providersDir, { recursive: true });
        } catch (err) {
          console.warn('[清理] 重新创建 providers 目录失败：', err?.message || err);
        }
      } catch (err) {
        // 如果读取目录失败，退回到删除整个目录再重建（兼容性回退）
        console.warn('[清理] 读取 providers 目录失败，尝试整体删除并重建：', err?.message || err);
        try {
          fs.rmSync(providersDir, { recursive: true, force: true });
          fs.mkdirSync(providersDir, { recursive: true });
        } catch (err2) {
          console.warn('[清理] 回退删除 providers 目录失败：', err2?.message || err2);
        }
      }
    } else {
      // 如果目录不存在，直接创建空目录，保证程序期望的路径存在
      try {
        fs.mkdirSync(providersDir, { recursive: true });
      } catch (err) {
        console.warn('[清理] 创建 providers 目录失败：', err?.message || err);
      }
    }

    // 删除 cache.db
    if (fs.existsSync(cacheDb)) {
      try {
        fs.unlinkSync(cacheDb);
        console.log('[清理] 已删除 cache.db');
      } catch (err) {
        console.warn('[清理] 删除 cache.db 失败：', err?.message || err);
      }
    }

    console.log('[清理] core 目录清理完成');
  } catch (err) {
    console.error('[清理] 执行 core 清理时发生错误：', err?.message || err);
  }
}


function createWindow() {
  global.mainWindow = new BrowserWindow({
    width: 500,
    height: 380,
    frame: true,
    resizable: true,
    title: 'HeySure VPN',
    icon: path.join(__dirname, '..', 'assets', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload_clash.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    backgroundColor: '#0f172a'
  });

  global.mainWindow.loadFile(path.join(__dirname, 'renderer_clash', 'index_clash.html'));

  // Allow normal close behavior; do not hide to tray.
  global.mainWindow.on('close', () => {});
}



app.whenReady().then(async () => {
  console.log('[启动] 应用 UI 就绪');
  app.setName('HeySure VPN');
  Menu.setApplicationMenu(null);
  startControlServer();

  // 仅在非 headless 模式下创建 UI
  if (!HEADLESS_MODE) {
    createWindow();
  } else {
    console.log('[启动] 已启用 headless 模式，跳过窗口创建');
  }
  // 注册 ipc handlers
  registerIpcHandlers(coreManager);

  // 启动后端（UI 已经显示，spawn 非阻塞）
  try {
    // 启动前先清理 core 下残留数据，避免使用过期 providers / cache / config
    try {
      performCoreCleanup();
    } catch (err) {
      console.warn('[启动] 执行 core 清理时出现错误：', err?.message || err);
    }

    startGoBackend();
    console.log('[启动] 已触发后端启动');
  } catch (e) {
    console.error('[启动] 启动后端失败:', e?.message || e);
  }

  // 不再维护托盘菜单

  // Custom window controls
  ipcMain.on('minimize-window', () => {
    global.mainWindow?.minimize();
  });

  ipcMain.on('maximize-window', () => {
    if (global.mainWindow?.isMaximized()) {
      global.mainWindow?.unmaximize();
    } else {
      global.mainWindow?.maximize();
    }
  });

  ipcMain.on('close-window', () => {
    // 直接关闭窗口（不隐藏到托盘）
    try { global.mainWindow?.close(); } catch (_) {}
  });

  ipcMain.on('quit-app', async () => {
    if (global._isShuttingDown) return;
    global._isShuttingDown = true;
    global.willQuit = true;
    console.log('[退出] 收到退出指令，开始优雅关停...');
    try {
      await coreManager.shutdown();
      console.log('[退出] 已调用 /shutdown 完成关停');
      try {
        performCoreCleanup();
      } catch (err) {
        console.warn('[退出] 退出流程中清理 core 失败：', err?.message || err);
      }
    } catch (err) {
      console.error('[退出] /shutdown 失败，尝试强制终止后端:', err?.message || err);
      const backendProcess = getBackendProcess();
      if (backendProcess) {
        try { backendProcess.kill('SIGTERM'); } catch {}
      }
    } finally {
      app.exit(0);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  // 统一走优雅关闭流程：阻止默认退出，先调用 /shutdown，再真正退出
  if (global._isShuttingDown) {
    return; // 已在关停流程中，放行
  }
  e.preventDefault();

  console.log('[退出] 开始清理资源...');
  global._isShuttingDown = true;
  global.willQuit = true;

  try {
    await coreManager.shutdown();
    console.log('[退出] 后端服务已通过 API 关闭');
  } catch (err) {
    console.error('[退出] 请求后端关闭失败，将强制终止:', err.message);
    // 如果 API 调用失败（例如后端已崩溃），则强制终止进程
    const backendProcess = getBackendProcess();
    if (backendProcess) {
      console.log('[退出] 强制终止后端进程...');
      backendProcess.kill('SIGTERM');
    }
  } finally {
    // 确保最终能退出进程，退出前尝试清理 core 目录
    try {
      performCoreCleanup();
    } catch (err) {
      console.warn('[退出] before-quit 中清理 core 失败：', err?.message || err);
    }
    setTimeout(() => {
      app.exit(0);
    }, 50);
  }
});

// IPC 处理器注册函数
function registerIpcHandlers(coreManager) {
  ipcMain.handle('get-initial-state', async () => {
    const coreDir = resolveCoreDir();
    return {
      ok: true,
      data: {
        configFile: activeConfigMeta.configName || RUNTIME_CONFIG_NAME,
        hasSelfConfig: fs.existsSync(path.join(coreDir, SELF_CONFIG_NAME)),
        hasRuntimeConfig: fs.existsSync(path.join(coreDir, RUNTIME_CONFIG_NAME)),
        coreRunning: coreManager.isRunning() || !!getBackendProcess(),
        activeConfig: activeConfigMeta,
      }
    };
  });

  ipcMain.handle('import-config-file', async (_evt, payload) => {
    try {
      const result = await importConfigToRuntime(resolveCoreDir(), payload || {});
      if (getBackendProcess()) {
        try {
          await api.reloadConfigs();
        } catch (_) {}
      }
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('pick-and-import-config', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择配置文件',
        properties: ['openFile'],
        filters: [
          { name: 'YAML 配置', extensions: ['yaml', 'yml'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: false, error: '已取消选择' };
      }
      const imported = await importConfigToRuntime(resolveCoreDir(), { path: result.filePaths[0] });
      if (getBackendProcess()) {
        try {
          await api.reloadConfigs();
        } catch (_) {}
      }
      return { ok: true, data: imported };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('start-core', async () => {
    try {
      const coreDir = resolveCoreDir();
      const options = {
        configPath: getRuntimeConfigPath(coreDir),
        configName: activeConfigMeta.configName || path.basename(getRuntimeConfigPath(coreDir)),
      };
      await coreManager.boot(options);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('stop-core', async () => {
    try {
      await coreManager.stop();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('get-proxies', async () => {
    try {
      const data = await coreManager.getProviderProxies();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('refresh-provider', async () => {
    try {
      const data = await coreManager.updateProvider();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('test-proxies', async (_evt, names, url, timeout) => {
    try {
      const data = await coreManager.testDelays(names, url, timeout);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('select-proxy', async (_evt, name) => {
    try {
      await coreManager.setManualNode(name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('select-best-node', async (_evt, options) => {
    try {
      const data = await coreManager.selectBestNode(options || {});
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

}
