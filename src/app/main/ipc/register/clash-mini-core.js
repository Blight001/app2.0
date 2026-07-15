const { app: electronApp, net } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { writeDebugConsoleOnly } = require('../../runtime/debug-console-log');
const YAML = require('yaml');
const { getCoreDir } = require('../../config');
const {
  readStoreConfigSafe,
  toBoolean,
} = require('./store-utils');

const CLASH_MINI_DIR_NAME = 'clash-mini';
const LOCAL_GEO_FILES = ['geoip.metadb', 'geosite.dat', 'country.mmdb'];
const LOCAL_PROVIDER_FILES = [
  'cn_ip.mrs',
  'cn_domain.mrs',
  'private_domain.mrs',
  'geolocation-!cn.mrs',
];
const LOCAL_ASSET_MARKER_FILE = '.bundled-assets.json';
let clashMiniRuntimePrepPromise = null;
let clashMiniRuntimePrepResult = null;

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
      console.warn('[IPC] 复制 Clash Mini 文件失败:', srcPath, '->', destPath, error?.message || error);
    }
  }
  return true;
}

async function copyDirectoryRecursiveAsync(src, dest, { overwrite = false } = {}) {
  if (!src || !dest) return false;
  try {
    await fs.promises.access(src);
  } catch (_) {
    return false;
  }

  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursiveAsync(srcPath, destPath, { overwrite });
      return;
    }
    if (!overwrite) {
      try {
        await fs.promises.access(destPath);
        return;
      } catch (_) {}
    }
    await fs.promises.copyFile(srcPath, destPath);
  }));
  return true;
}

function getClashMiniAppRoots() {
  const roots = [];
  try { roots.push(path.join(process.resourcesPath || '', CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(path.join(path.dirname(process.execPath || ''), 'resources', CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(path.join(process.cwd(), 'resources', CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(path.join(__dirname, '..', '..', '..', '..', '..', 'resources', CLASH_MINI_DIR_NAME)); } catch (_) {}
  return Array.from(new Set(roots.filter(Boolean)));
}

function getClashMiniCoreRoots() {
  return getClashMiniAppRoots().map((root) => path.join(root, 'core'));
}

function resolveBundledClashMiniCoreDir() {
  for (const root of getClashMiniCoreRoots()) {
    if (!root) continue;
    if (
      fs.existsSync(path.join(root, 'verge-mihomo.exe')) ||
      fs.existsSync(path.join(root, 'config.yaml')) ||
      fs.existsSync(path.join(root, 'self.yaml'))
    ) {
      return root;
    }
  }
  return getClashMiniCoreRoots()[0] || null;
}

function getClashMiniRuntimeRoot() {
  try {
    return path.join(electronApp.getPath('appData'), CLASH_MINI_DIR_NAME);
  } catch (_) {
    return path.join(getCoreDir(), CLASH_MINI_DIR_NAME);
  }
}

function resolveClashMiniCoreDir() {
  const runtimeRoot = getClashMiniRuntimeRoot();
  try {
    if (runtimeRoot && fs.existsSync(runtimeRoot)) {
      if (
        fs.existsSync(path.join(runtimeRoot, 'verge-mihomo.exe')) ||
        fs.existsSync(path.join(runtimeRoot, 'config.yaml')) ||
        fs.existsSync(path.join(runtimeRoot, 'self.yaml'))
      ) {
        return runtimeRoot;
      }
    }
  } catch (_) {}

  for (const root of getClashMiniCoreRoots()) {
    if (!root) continue;
    if (
      fs.existsSync(path.join(root, 'verge-mihomo.exe')) ||
      fs.existsSync(path.join(root, 'config.yaml')) ||
      fs.existsSync(path.join(root, 'self.yaml'))
    ) {
      return root;
    }
  }
  return getClashMiniCoreRoots()[0] || null;
}

function resolveClashMiniExecutable(coreDir) {
  if (!coreDir) return null;
  const candidate = path.join(coreDir, 'verge-mihomo.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

function getLocalAssetRelativePaths() {
  return [
    ...LOCAL_GEO_FILES,
    ...LOCAL_PROVIDER_FILES.map((name) => path.join('providers', name)),
  ];
}

function buildLocalAssetManifest(bundledCore) {
  const files = [];
  for (const relativePath of getLocalAssetRelativePaths()) {
    const src = path.join(bundledCore, relativePath);
    try {
      const stat = fs.statSync(src);
      files.push({
        path: relativePath.replace(/\\/g, '/'),
        size: stat.size,
        mtimeMs: Math.trunc(stat.mtimeMs),
      });
    } catch (_) {}
  }
  return {
    signature: files.map((item) => `${item.path}:${item.size}:${item.mtimeMs}`).join('|'),
    files,
  };
}

function readLocalAssetMarker(runtimeDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runtimeDir, LOCAL_ASSET_MARKER_FILE), 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

function writeLocalAssetMarker(runtimeDir, manifest) {
  const markerPath = path.join(runtimeDir, LOCAL_ASSET_MARKER_FILE);
  fs.writeFileSync(markerPath, `${JSON.stringify(manifest)}\n`, 'utf8');
}

async function writeLocalAssetMarkerAsync(runtimeDir, manifest) {
  const markerPath = path.join(runtimeDir, LOCAL_ASSET_MARKER_FILE);
  await fs.promises.writeFile(markerPath, `${JSON.stringify(manifest)}\n`, 'utf8');
}

function isLocalAssetSizeCurrent(runtimeDir, item) {
  try {
    return fs.statSync(path.join(runtimeDir, item.path)).size === item.size;
  } catch (_) {
    return false;
  }
}

// 内置 Geo 库/规则集以内置版本为准。版本未变化且文件大小正确时跳过复制，
// 版本升级或检测到残缺文件时再覆盖，兼顾启动速度与离线分流稳定性。
function syncLocalGeoAssets(runtimeDir) {
  const bundledCore = resolveBundledClashMiniCoreDir();
  if (!bundledCore) {
    return { ok: false, copied: [], missing: [], error: '未找到内置 core 目录' };
  }

  const manifest = buildLocalAssetManifest(bundledCore);
  const marker = readLocalAssetMarker(runtimeDir);
  const markerMatches = !!manifest.signature && marker?.signature === manifest.signature;
  const copied = [];
  const skipped = [];
  const missing = [];
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      copied,
      missing,
      error: error?.message || String(error),
    };
  }

  const copyAsset = (relativePath) => {
    const src = path.join(bundledCore, relativePath);
    const dest = path.join(runtimeDir, relativePath);
    if (!fs.existsSync(src)) {
      missing.push(relativePath.replace(/\\/g, '/'));
      return;
    }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const manifestItem = manifest.files.find((item) => item.path === relativePath.replace(/\\/g, '/'));
      if ((markerMatches || !marker) && manifestItem && isLocalAssetSizeCurrent(runtimeDir, manifestItem)) {
        skipped.push(relativePath.replace(/\\/g, '/'));
        return;
      }
      if (path.resolve(src) !== path.resolve(dest)) {
        fs.copyFileSync(src, dest);
      }
      copied.push(relativePath.replace(/\\/g, '/'));
    } catch (_) {
      missing.push(relativePath.replace(/\\/g, '/'));
    }
  };

  for (const relativePath of getLocalAssetRelativePaths()) copyAsset(relativePath);

  if (missing.length === 0 && manifest.signature) {
    try {
      writeLocalAssetMarker(runtimeDir, manifest);
    } catch (error) {
      return { ok: false, copied, skipped, missing, error: error?.message || String(error) };
    }
  }

  return { ok: missing.length === 0, copied, skipped, missing };
}

async function syncLocalGeoAssetsAsync(runtimeDir) {
  const bundledCore = resolveBundledClashMiniCoreDir();
  if (!bundledCore) {
    return { ok: false, copied: [], skipped: [], missing: [], error: '未找到内置 core 目录' };
  }

  const manifest = buildLocalAssetManifest(bundledCore);
  const marker = readLocalAssetMarker(runtimeDir);
  const markerMatches = !!manifest.signature && marker?.signature === manifest.signature;
  const copied = [];
  const skipped = [];
  const missing = [];
  await fs.promises.mkdir(runtimeDir, { recursive: true });

  await Promise.all(getLocalAssetRelativePaths().map(async (relativePath) => {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const src = path.join(bundledCore, relativePath);
    const dest = path.join(runtimeDir, relativePath);
    let sourceStat;
    try {
      sourceStat = await fs.promises.stat(src);
    } catch (_) {
      missing.push(normalizedPath);
      return;
    }
    const manifestItem = { path: normalizedPath, size: sourceStat.size };
    if ((markerMatches || !marker) && isLocalAssetSizeCurrent(runtimeDir, manifestItem)) {
      skipped.push(normalizedPath);
      return;
    }
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      if (path.resolve(src) !== path.resolve(dest)) {
        await fs.promises.copyFile(src, dest);
      }
      copied.push(normalizedPath);
    } catch (_) {
      missing.push(normalizedPath);
    }
  }));

  if (missing.length === 0 && manifest.signature) {
    try {
      await writeLocalAssetMarkerAsync(runtimeDir, manifest);
    } catch (error) {
      return { ok: false, copied, skipped, missing, error: error?.message || String(error) };
    }
  }

  return { ok: missing.length === 0, copied, skipped, missing };
}

async function prepareClashMiniRuntimeDirAsync() {
  if (
    clashMiniRuntimePrepResult?.ok
    && clashMiniRuntimePrepResult.exePath
    && fs.existsSync(clashMiniRuntimePrepResult.exePath)
  ) {
    return { ...clashMiniRuntimePrepResult, cached: true };
  }
  if (clashMiniRuntimePrepPromise) return clashMiniRuntimePrepPromise;

  const task = (async () => {
    const startedAt = Date.now();
    const sourceDir = resolveBundledClashMiniCoreDir();
    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return { ok: false, error: `未找到 Clash Mini 源目录: ${sourceDir || 'unknown'}` };
    }
    const runtimeDir = getClashMiniRuntimeRoot();
    try {
      await fs.promises.mkdir(runtimeDir, { recursive: true });
      if (path.resolve(runtimeDir) !== path.resolve(sourceDir)) {
        await copyDirectoryRecursiveAsync(sourceDir, runtimeDir, { overwrite: false });
      }
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }

    const exePath = resolveClashMiniExecutable(runtimeDir);
    if (!exePath) {
      return { ok: false, error: 'Clash Mini 运行目录中未找到 verge-mihomo.exe' };
    }
    const assetSync = await syncLocalGeoAssetsAsync(runtimeDir);
    const result = {
      ok: true,
      sourceDir,
      runtimeDir,
      exePath,
      assetSync,
      elapsedMs: Date.now() - startedAt,
    };
    if (assetSync.ok) clashMiniRuntimePrepResult = result;
    return result;
  })();

  clashMiniRuntimePrepPromise = task;
  try {
    return await task;
  } finally {
    if (clashMiniRuntimePrepPromise === task) clashMiniRuntimePrepPromise = null;
  }
}

function purgeClashMiniRuntimeConfigFiles(coreDir) {
  const targets = [
    path.join(coreDir, 'config.yaml'),
    path.join(coreDir, 'self.yaml'),
    path.join(coreDir, 'profiles.yaml'),
  ];
  const removed = [];
  const failed = [];

  for (const target of targets) {
    try {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        removed.push(path.basename(target));
      }
    } catch (error) {
      failed.push({ file: path.basename(target), error: error?.message || String(error) });
    }
  }

  return { ok: failed.length === 0, removed, failed };
}

function parseYamlMaybe(value) {
  if (typeof value === 'string') {
    try {
      return YAML.parse(value);
    } catch (_) {
      return null;
    }
  }
  return value && typeof value === 'object' ? value : null;
}

function looksLikeRuntimeClashConfig(value) {
  const parsed = parseYamlMaybe(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return Array.isArray(parsed.proxies)
    || Array.isArray(parsed['proxy-groups'])
    || Array.isArray(parsed.rules)
    || typeof parsed['mixed-port'] !== 'undefined'
    || typeof parsed.port !== 'undefined'
    || typeof parsed['external-controller'] !== 'undefined';
}

function looksLikeProfilesIndex(value) {
  const parsed = parseYamlMaybe(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (Array.isArray(parsed.items) || typeof parsed.current !== 'undefined' || typeof parsed.getCurrentProfile !== 'undefined') {
    return true;
  }
  if (typeof parsed.uid === 'string' && typeof parsed.type === 'string' && typeof parsed.file === 'string') {
    return true;
  }
  return false;
}

function readYamlIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

// config.yaml/self.yaml 会被端点、密钥、分组等多个读取器在测速轮询等热路径里反复
// 读取。按文件 mtime+size 缓存解析结果，避免每次控制请求都重新读盘并解析整份配置。
const clashMiniRuntimeConfigCache = new Map();

function readClashMiniRuntimeConfig(coreDir) {
  if (!coreDir) return {};
  const cached = clashMiniRuntimeConfigCache.get(coreDir);
  for (const fileName of ['config.yaml', 'self.yaml']) {
    const filePath = path.join(coreDir, fileName);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      continue;
    }
    if (cached
      && cached.filePath === filePath
      && cached.mtimeMs === stat.mtimeMs
      && cached.size === stat.size) {
      return cached.value;
    }
    let parsed = null;
    try {
      parsed = YAML.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      clashMiniRuntimeConfigCache.set(coreDir, {
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        value: parsed,
      });
      return parsed;
    }
  }
  clashMiniRuntimeConfigCache.delete(coreDir);
  return {};
}

function getClashMiniProxyEndpoint(coreDir) {
  const config = readClashMiniRuntimeConfig(coreDir);
  const host = '127.0.0.1';
  const mixedPort = Number(config['mixed-port'] || config.mixed_port);
  const httpPort = Number(config.port || config.http_port);
  const socksPort = Number(config['socks-port'] || config.socks_port);
  const port = [mixedPort, httpPort, socksPort, 7890].find((n) => Number.isFinite(n) && n > 0) || 7890;
  return { host, port };
}

function getClashMiniControlEndpoint(coreDir) {
  const config = readClashMiniRuntimeConfig(coreDir);
  const raw = String(config['external-controller'] || config.external_controller || '').trim();
  const [hostPart, portPart] = raw.split(':');
  const host = hostPart || '127.0.0.1';
  const port = Number(portPart);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 9090,
  };
}

function getClashMiniControlSecret(coreDir) {
  const config = readClashMiniRuntimeConfig(coreDir);
  return String(config.secret || config['control-secret'] || '').trim();
}

function getClashMiniManualGroupName(coreDir) {
  const config = readClashMiniRuntimeConfig(coreDir);
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const manualGroup = groups.find((group) => group && group.type === 'select' && group.name);
  return manualGroup?.name || groups[0]?.name || '节点选择';
}

function getClashMiniConfigProxyNames(coreDir) {
  const config = readClashMiniRuntimeConfig(coreDir);
  return Array.isArray(config.proxies)
    ? config.proxies.map((item) => String(item?.name || '').trim()).filter(Boolean)
    : [];
}

function buildClashMiniControlUrl(coreDir, pathname) {
  const endpoint = getClashMiniControlEndpoint(coreDir);
  const cleanPath = String(pathname || '').startsWith('/') ? String(pathname || '') : `/${String(pathname || '')}`;
  return `http://${endpoint.host}:${endpoint.port}${cleanPath}`;
}

function buildClashMiniControlHeaders(coreDir) {
  const secret = getClashMiniControlSecret(coreDir);
  const headers = {};
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return headers;
}

function extractDelayValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (match) return Number(match[1]);
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

function normalizeProxyNameList(input) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const value = String(name || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
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
      if (Array.isArray(value.all)) value.all.forEach(walk);
      if (Array.isArray(value.proxies)) value.proxies.forEach(walk);
      if (Array.isArray(value.nodes)) value.nodes.forEach(walk);
      if (value.name) push(value.name);
      if (value.now && typeof value.now === 'string') push(value.now);
      for (const [key, nested] of Object.entries(value)) {
        if (['all', 'proxies', 'nodes', 'name', 'now', 'type', 'history'].includes(key)) continue;
        walk(nested);
      }
    }
  };

  walk(input);
  return out;
}

async function fetchClashMiniProxyNames(coreDir, groupName) {
  let response = null;
  try {
    response = await invokeClashMiniControl(coreDir, 'get', `/proxies/${encodeURIComponent(groupName)}`, {
      timeoutMs: 15000,
    });
  } catch (error) {
    console.warn('[IPC] 获取 Clash Mini 节点列表失败，改用本地配置兜底:', error?.message || error);
  }

  const configNames = getClashMiniConfigProxyNames(coreDir);
  const configNameSet = new Set(configNames);
  const apiNames = normalizeProxyNameList(response?.all || response?.proxies || response)
    .filter((name) => configNameSet.has(name));
  const names = Array.from(new Set([...apiNames, ...configNames]));
  let current = String(response?.now || response?.name || '').trim();

  // A select group may currently point at a nested url-test/select group.
  // Resolve that chain for UI highlighting, but never expose the group name
  // itself as if it were a real proxy node.
  const visited = new Set();
  while (current && !configNameSet.has(current) && !visited.has(current)) {
    visited.add(current);
    try {
      const nested = await invokeClashMiniControl(coreDir, 'get', `/proxies/${encodeURIComponent(current)}`, {
        timeoutMs: 5000,
      });
      const next = String(nested?.now || '').trim();
      if (!next || next === current) break;
      current = next;
    } catch (_) {
      current = '';
      break;
    }
  }
  if (!configNameSet.has(current)) current = '';
  return {
    raw: response,
    names,
    current,
  };
}

async function probeClashMiniProxyDelay(coreDir, proxyName, testUrl, timeout) {
  const response = await invokeClashMiniControl(coreDir, 'get', `/proxies/${encodeURIComponent(proxyName)}/delay?timeout=${encodeURIComponent(timeout)}&url=${encodeURIComponent(testUrl)}`, {
    timeoutMs: Math.max(Number(timeout) || 5000, 8000),
  });
  return {
    raw: response,
    delay: extractDelayValue(response),
  };
}

// 批量测速：一次 GET /group/{组名}/delay 让内核并发测完整组节点，
// 总耗时约等于单节点超时上限，远快于外部逐节点循环。
// 返回 { 节点名: 延迟ms } 映射（失败节点会被内核省略）。
// 老内核不支持该端点时抛错（404），由调用方回退逐节点方案。
async function probeClashMiniGroupDelay(coreDir, groupName, testUrl, timeout) {
  const probeTimeout = Math.max(Number(timeout) || 5000, 1000);
  const response = await invokeClashMiniControl(
    coreDir,
    'get',
    `/group/${encodeURIComponent(groupName)}/delay?timeout=${encodeURIComponent(probeTimeout)}&url=${encodeURIComponent(testUrl)}`,
    // 内核要等最慢节点超时后才返回，HTTP 侧留足余量。
    { timeoutMs: probeTimeout + 10000 },
  );
  return response && typeof response === 'object' && !Array.isArray(response) ? response : {};
}

function formatClashMiniDelayText(delay) {
  const value = Number(delay);
  if (!Number.isFinite(value) || value <= 0) return '超时';
  return `${Math.round(value)}ms`;
}

async function collectClashMiniProxyDelays(coreDir, names, latencyUrl, timeout, concurrency = 8) {
  const uniqueNames = Array.from(new Set((Array.isArray(names) ? names : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  if (uniqueNames.length === 0) {
    return [];
  }

  const poolSize = Math.max(
    1,
    Math.min(uniqueNames.length, Number.isFinite(Number(concurrency)) && Number(concurrency) > 0 ? Math.floor(Number(concurrency)) : 8),
  );

  const entries = new Array(uniqueNames.length);
  let cursor = 0;
  const workers = Array.from({ length: poolSize }, async () => {
    while (cursor < uniqueNames.length) {
      const currentIndex = cursor++;
      const name = uniqueNames[currentIndex];
      try {
        const probe = await probeClashMiniProxyDelay(coreDir, name, latencyUrl, timeout);
        const delay = Number(probe.delay);
        entries[currentIndex] = {
          name,
          delay: Number.isFinite(delay) ? delay : null,
          delayText: formatClashMiniDelayText(delay),
          ok: Number.isFinite(delay) && delay > 0,
        };
      } catch (error) {
        entries[currentIndex] = {
          name,
          delay: null,
          delayText: '超时',
          ok: false,
          error: error?.message || String(error),
        };
      }
    }
  });

  await Promise.all(workers);
  return entries.filter(Boolean);
}

function normalizeProbeTimeout(value, fallbackMs = 2000) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.max(200, Math.round(num));
  return fallbackMs;
}

const DEFAULT_LATENCY_PROBE_URL = 'https://www.gstatic.com/generate_204';

function normalizeProbeUrl(value, fallbackUrl = DEFAULT_LATENCY_PROBE_URL) {
  const text = String(value || '').trim() || String(fallbackUrl || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return String(fallbackUrl || '').trim();
    }
    // 浏览器主要依赖 HTTPS。HTTP 204 可能被透明代理/节点入口直接应答，
    // 即使节点的 TLS 上游已经超时仍会得到很低的“延迟”。统一用 HTTPS
    // 才能把 TLS 建连纳入健康检查，避免自动选中实际不可用的节点。
    if (url.protocol === 'http:') {
      return DEFAULT_LATENCY_PROBE_URL;
    }
    return url.toString();
  } catch (_) {
    return String(fallbackUrl || '').trim();
  }
}

function readClashProbeSettings() {
  for (const rootDir of getClashMiniProfileRoots()) {
    try {
      const profilesIndexPath = path.join(rootDir, 'profiles.yaml');
      if (!fs.existsSync(profilesIndexPath)) {
        continue;
      }

      const profilesIndexRaw = fs.readFileSync(profilesIndexPath, 'utf8');
      const profilesIndex = YAML.parse(profilesIndexRaw) || {};
      const currentUid = String(profilesIndex.current || '').trim();
      const items = Array.isArray(profilesIndex.items) ? profilesIndex.items : [];

      let currentItem = null;
      if (currentUid) {
        currentItem = items.find((item) => String(item?.uid || '').trim() === currentUid) || null;
      }
      if (!currentItem && currentUid) {
        currentItem = items.find((item) => String(item?.file || '').trim().replace(/\.ya?ml$/i, '') === currentUid) || null;
      }

      const candidateFiles = [];
      if (currentItem && currentItem.file) {
        candidateFiles.push(path.join(rootDir, 'profiles', currentItem.file));
        candidateFiles.push(path.join(rootDir, currentItem.file));
      }
      if (currentUid) {
        candidateFiles.push(path.join(rootDir, 'profiles', `${currentUid}.yaml`));
        candidateFiles.push(path.join(rootDir, `${currentUid}.yaml`));
      }

      let profilePath = '';
      for (const candidatePath of candidateFiles) {
        if (candidatePath && fs.existsSync(candidatePath)) {
          profilePath = candidatePath;
          break;
        }
      }
      if (!profilePath) {
        continue;
      }

      const profileRaw = fs.readFileSync(profilePath, 'utf8');
      const profile = YAML.parse(profileRaw) || {};
      const latencyTimeoutMs = normalizeProbeTimeout(profile['cfw-latency-timeout'], 2000);
      const latencyUrl = normalizeProbeUrl(profile['cfw-latency-url'], DEFAULT_LATENCY_PROBE_URL);
      const connBreakStrategy = toBoolean(profile['cfw-conn-break-strategy'], false);

      return {
        rootDir,
        profilesIndexPath,
        profilePath,
        profile,
        profileName: String(currentItem?.name || currentUid || '').trim(),
        profileUid: currentUid,
        latencyTimeoutMs,
        latencyUrl,
        connBreakStrategy,
      };
    } catch (error) {
      console.warn('[IPC] 读取 Clash Mini profile 配置失败:', error?.message || error);
    }
  }

  return null;
}

function probeLatencyUrl(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const safeUrl = normalizeProbeUrl(url, '');
    if (!safeUrl) {
      resolve({ ok: false, error: 'latency url missing', elapsedMs: 0, statusCode: null });
      return;
    }

    let finished = false;
    const startedAt = Date.now();
    let request = null;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      try {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      } catch (_) {}
      try {
        request?.abort?.();
      } catch (_) {}
      resolve({
        ok: !!result?.ok,
        statusCode: Number.isFinite(Number(result?.statusCode)) ? Number(result.statusCode) : null,
        elapsedMs: Number.isFinite(Number(result?.elapsedMs)) ? Math.max(0, Math.round(Number(result.elapsedMs))) : Math.max(0, Date.now() - startedAt),
        error: result?.error ? String(result.error) : '',
      });
    };

    let timeoutHandle = null;
    try {
      request = net.request({
        method: 'GET',
        url: safeUrl,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'User-Agent': 'AI-FREE/ClashLatencyProbe',
        },
      });

      timeoutHandle = setTimeout(() => {
        finish({
          ok: false,
          error: `请求超时（${timeoutMs}ms）`,
          elapsedMs: Date.now() - startedAt,
          statusCode: null,
        });
      }, timeoutMs);

      request.on('response', (response) => {
        const statusCode = response?.statusCode;
        response.on('error', (error) => {
          finish({
            ok: false,
            error: error?.message || String(error),
            elapsedMs: Date.now() - startedAt,
            statusCode,
          });
        });
        response.on('aborted', () => {
          finish({
            ok: false,
            error: '响应已中止',
            elapsedMs: Date.now() - startedAt,
            statusCode,
          });
        });
        response.on('end', () => {
          finish({
            ok: typeof statusCode === 'number' && statusCode >= 200 && statusCode < 400,
            elapsedMs: Date.now() - startedAt,
            statusCode,
          });
        });
        try {
          if (typeof response.resume === 'function') {
            response.resume();
          }
        } catch (_) {}
      });

      request.on('error', (error) => {
        finish({
          ok: false,
          error: error?.message || String(error),
          elapsedMs: Date.now() - startedAt,
          statusCode: null,
        });
      });

      request.end();
    } catch (error) {
      finish({
        ok: false,
        error: error?.message || String(error),
        elapsedMs: Date.now() - startedAt,
        statusCode: null,
      });
    }
  });
}

async function waitForClashMiniControlApi(coreDir, timeoutMs = 15000, shouldCancel = null) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
  const probePaths = ['/version', '/proxies', '/configs'];
  const headers = buildClashMiniControlHeaders(coreDir);

  while (Date.now() < deadline) {
    if (typeof shouldCancel === 'function' && shouldCancel()) return false;
    const probeTimeout = Math.max(100, Math.min(750, deadline - Date.now()));
    const responses = await Promise.all(probePaths.map((probePath) => (
      axios.get(buildClashMiniControlUrl(coreDir, probePath), {
        timeout: probeTimeout,
        headers,
        validateStatus: () => true,
      }).catch(() => null)
    )));
    if (responses.some((response) => response && typeof response.status === 'number' && response.status < 500)) {
      return true;
    }

    if (typeof shouldCancel === 'function' && shouldCancel()) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

async function invokeClashMiniControl(coreDir, method, pathname, { data = null, timeoutMs = 30000 } = {}) {
  const url = buildClashMiniControlUrl(coreDir, pathname);
  const headers = buildClashMiniControlHeaders(coreDir);
  const response = await axios({
    method,
    url,
    data,
    timeout: timeoutMs,
    headers,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const payload = response.data && typeof response.data === 'object' ? response.data : {};
    const message = payload.error || payload.message || `控制接口请求失败 (${response.status})`;
    throw new Error(String(message));
  }
  return response.data;
}

// Mihomo 的运行模式可以通过控制接口被其他客户端临时切换。每次接管核心时
// 都重新确认 rule，避免磁盘配置正确但当前进程仍停留在 global/direct。
async function ensureClashMiniRuleMode(coreDir) {
  try {
    const current = await invokeClashMiniControl(coreDir, 'get', '/configs', { timeoutMs: 5000 });
    const currentMode = String(current?.mode || '').trim().toLowerCase();
    if (currentMode === CLASH_MINI_RULE_MODE) {
      return { ok: true, changed: false, mode: CLASH_MINI_RULE_MODE };
    }
    await invokeClashMiniControl(coreDir, 'patch', '/configs', {
      data: { mode: CLASH_MINI_RULE_MODE },
      timeoutMs: 5000,
    });
    return { ok: true, changed: true, mode: CLASH_MINI_RULE_MODE, previousMode: currentMode };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function getClashMiniProfileRoots() {
  const roots = [];
  try { roots.push(path.join(electronApp.getPath('appData'), CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(getCoreDir()); } catch (_) {}
  return Array.from(new Set(roots.filter(Boolean)));
}

function resolveClashMiniProfileFile(coreDir, profilesIndex) {
  const items = Array.isArray(profilesIndex?.items) ? profilesIndex.items : [];
  const currentUid = String(profilesIndex?.current || profilesIndex?.getCurrentProfile || '').trim();
  const currentItem = (currentUid && items.length > 0)
    ? items.find((item) => String(item?.uid || '').trim() === currentUid)
    : null;
  const candidateNames = [];
  if (currentItem?.file) candidateNames.push(String(currentItem.file).trim());
  if (currentUid) candidateNames.push(`${currentUid}.yaml`);
  if (currentItem?.uid) candidateNames.push(`${String(currentItem.uid).trim()}.yaml`);

  const roots = [path.join(coreDir, 'profiles'), coreDir];
  for (const root of roots) {
    for (const name of candidateNames) {
      if (!name) continue;
      const filePath = path.join(root, name);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return null;
}

const MIN_USABLE_GEO_DATABASE_SIZE = 1024 * 1024;
const CLASH_MINI_RULE_MODE = 'rule';
const CLASH_MINI_DOMESTIC_DIRECT_RULES = [
  // AI-FREE owns the embedded Chromium version. Keep Chromium component and
  // model update traffic away from paid proxy nodes even if a subscription
  // contains broader Google proxy rules later in the rule list.
  'DOMAIN-SUFFIX,gvt1.com,DIRECT',
  'DOMAIN,dl.google.com,DIRECT',
  'DOMAIN,clients2.google.com,DIRECT',
  'DOMAIN,update.googleapis.com,DIRECT',
  'DOMAIN,android.clients.google.com,DIRECT',
  'DOMAIN,content-autofill.googleapis.com,DIRECT',
  'DOMAIN,optimizationguide-pa.googleapis.com,DIRECT',
  'DOMAIN-SUFFIX,baidu.com,DIRECT',
  'DOMAIN-SUFFIX,baidubce.com,DIRECT',
  'DOMAIN-SUFFIX,bdstatic.com,DIRECT',
  'DOMAIN-SUFFIX,bdimg.com,DIRECT',
  'DOMAIN-SUFFIX,cn,DIRECT',
  'GEOSITE,CN,DIRECT',
  'GEOIP,CN,DIRECT,no-resolve',
];

// Mihomo 会在控制端口监听前同步初始化 GEOIP/GEOSITE 数据。首次启动时如果
// 本地没有数据库且 GitHub 不可达，进程会卡在下载阶段，形成“代理尚未启动，
// 但启动代理又需要先下载”的死锁。数据库存在时保留完整分流；数据库缺失时
// 只移除依赖 Geo 数据的规则，让代理先以现有域名/IP/MATCH 规则离线启动。
function hasUsableClashMiniGeoFile(coreDir, candidates) {
  if (!coreDir) return false;
  return candidates.some((name) => {
    try {
      return fs.statSync(path.join(coreDir, name)).size >= MIN_USABLE_GEO_DATABASE_SIZE;
    } catch (_) {
      return false;
    }
  });
}

function getClashMiniGeoDatabaseAvailability(coreDir, config = {}) {
  const geodataMode = config && config['geodata-mode'] === true;
  const geoIpCandidates = geodataMode
    ? ['GeoIP.dat', 'geoip.dat']
    : ['geoip.metadb'];
  return {
    geoIp: hasUsableClashMiniGeoFile(coreDir, geoIpCandidates),
    geoSite: hasUsableClashMiniGeoFile(coreDir, ['GeoSite.dat', 'geosite.dat']),
  };
}

function repairMalformedHttpsUrls(value, stats) {
  if (typeof value === 'string') {
    const repaired = value.replace(/^https:\/{3,}(?=[^/])/i, 'https://');
    if (repaired !== value) stats.fixedUrls += 1;
    return repaired;
  }
  if (Array.isArray(value)) {
    return value.map((item) => repairMalformedHttpsUrls(item, stats));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, repairMalformedHttpsUrls(item, stats)]),
    );
  }
  return value;
}

// 将服务器下发的远程 Geo/规则配置改写为随包内置文件，确保启动和分流
// 不依赖 jsDelivr 或其它外部下载源。
function localizeGeoAndProviders(config, coreDir, stats) {
  const hasLocalAsset = (relativePath) => {
    try {
      return fs.statSync(path.join(coreDir, relativePath)).size > 0;
    } catch (_) {
      return false;
    }
  };
  const next = { ...config };

  if (next['geo-auto-update'] !== false) {
    next['geo-auto-update'] = false;
    stats.geoLocalized = true;
  }

  if (hasLocalAsset('geoip.metadb') && hasLocalAsset('geosite.dat') && next['geox-url']) {
    delete next['geox-url'];
    stats.geoLocalized = true;
  }

  const providerFileByName = {
    cn_ip: 'providers/cn_ip.mrs',
    cn_domain: 'providers/cn_domain.mrs',
    private_domain: 'providers/private_domain.mrs',
    'geolocation-!cn': 'providers/geolocation-!cn.mrs',
  };
  const providerFileBySourceSuffix = {
    '/geo/geoip/cn.mrs': 'providers/cn_ip.mrs',
    '/geo/geosite/cn.mrs': 'providers/cn_domain.mrs',
    '/geo/geosite/private.mrs': 'providers/private_domain.mrs',
    '/geo/geosite/geolocation-!cn.mrs': 'providers/geolocation-!cn.mrs',
  };
  const resolveProviderFile = (name, definition) => {
    const byName = providerFileByName[name]
      || providerFileByName[String(name || '').trim().toLowerCase().replace(/-/g, '_')];
    if (byName) return byName;

    // 服务器可能改 provider key，但 URL 仍指向同一份 MetaCubeX 规则。
    // 按上游路径识别可避免因 key 别名而漏掉本地化。
    const sourceUrl = String(definition?.url || '').trim().toLowerCase()
      .split(/[?#]/, 1)[0].replace(/\\/g, '/');
    const sourceSuffix = Object.keys(providerFileBySourceSuffix)
      .find((suffix) => sourceUrl.endsWith(suffix));
    return sourceSuffix ? providerFileBySourceSuffix[sourceSuffix] : null;
  };
  const providers = next['rule-providers'];
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    const localized = {};
    for (const [name, definition] of Object.entries(providers)) {
      const relativePath = resolveProviderFile(name, definition);
      if (relativePath
        && hasLocalAsset(relativePath)
        && definition
        && typeof definition === 'object'
        && !Array.isArray(definition)) {
        const { url, interval, proxy, ...rest } = definition;
        const localDefinition = {
          ...rest,
          type: 'file',
          path: `./${relativePath}`,
          format: rest.format || 'mrs',
        };
        localized[name] = localDefinition;
        if (url !== undefined
          || interval !== undefined
          || proxy !== undefined
          || definition.type !== localDefinition.type
          || definition.path !== localDefinition.path
          || definition.format !== localDefinition.format) {
          stats.providersLocalized += 1;
        }
      } else {
        localized[name] = definition;
      }
    }
    next['rule-providers'] = localized;
  }

  return next;
}

function normalizeClashMiniStartupConfig(config, coreDir) {
  const stats = {
    changed: false,
    controlFieldAdded: false,
    ruleModeForced: false,
    domesticDirectRulesAdded: 0,
    fixedUrls: 0,
    geoLocalized: false,
    providersLocalized: 0,
    removedGeoRules: 0,
    offlineMatchDirectRulesRewritten: 0,
    disabledDnsGeoFilter: false,
    geoDatabaseAvailable: false,
    geoIpDatabaseAvailable: false,
    geoSiteDatabaseAvailable: false,
  };
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { config, ...stats };
  }

  let next = repairMalformedHttpsUrls(config, stats);
  next = localizeGeoAndProviders(next, coreDir, stats);
  if (String(next.mode || '').trim().toLowerCase() !== CLASH_MINI_RULE_MODE) {
    next = { ...next, mode: CLASH_MINI_RULE_MODE };
    stats.ruleModeForced = true;
  }

  const geoAvailability = getClashMiniGeoDatabaseAvailability(coreDir, next);
  stats.geoIpDatabaseAvailable = geoAvailability.geoIp;
  stats.geoSiteDatabaseAvailable = geoAvailability.geoSite;
  stats.geoDatabaseAvailable = geoAvailability.geoIp && geoAvailability.geoSite;

  const currentRules = Array.isArray(next.rules) ? next.rules.slice() : [];
  const normalizedRules = new Set(
    currentRules
      .filter((rule) => typeof rule === 'string')
      .map((rule) => rule.replace(/\s+/g, '').toUpperCase()),
  );
  const missingDomesticRules = CLASH_MINI_DOMESTIC_DIRECT_RULES
    .filter((rule) => geoAvailability.geoSite || !/^GEOSITE,/i.test(rule))
    .filter((rule) => geoAvailability.geoIp || !/^GEOIP,/i.test(rule))
    .filter((rule) => !normalizedRules.has(rule.replace(/\s+/g, '').toUpperCase()));
  if (missingDomesticRules.length > 0) {
    // 国内直连规则必须位于订阅中的 MATCH/兜底规则之前，否则 rule 模式
    // 仍会表现成所有请求都走节点。
    next = { ...next, rules: [...missingDomesticRules, ...currentRules] };
    stats.domesticDirectRulesAdded = missingDomesticRules.length;
  }

  stats.controlFieldAdded = !String(next['external-controller'] || next.external_controller || '').trim();
  next = ensureClashMiniControlFields(next);

  if (!stats.geoDatabaseAvailable) {
    if (Array.isArray(next.rules)) {
      const rules = next.rules
        .filter((rule) => {
          const dependsOnMissingGeoIp = !geoAvailability.geoIp
            && typeof rule === 'string'
            && /(?:^|[,(])\s*GEOIP\s*,/i.test(rule);
          const dependsOnMissingGeoSite = !geoAvailability.geoSite
            && typeof rule === 'string'
            && /(?:^|[,(])\s*GEOSITE\s*,/i.test(rule);
          const dependsOnGeoData = dependsOnMissingGeoIp || dependsOnMissingGeoSite;
          if (dependsOnGeoData) stats.removedGeoRules += 1;
          return !dependsOnGeoData;
        })
        .map((rule) => {
          // GeoIP 缺失时无法判断未列入域名规则的网站是否位于中国大陆。
          // 若继续保留订阅的 MATCH,代理组，所有无法判断的国内网站都会
          // 落入远程节点，表现得与全局代理相同。明确列出的海外/AI 域名
          // 规则仍在 MATCH 之前，因此离线兜底应让未知流量优先直连。
          if (!geoAvailability.geoIp
            && typeof rule === 'string'
            && /^\s*MATCH\s*,/i.test(rule)
            && !/^\s*MATCH\s*,\s*DIRECT(?:\s*,|\s*$)/i.test(rule)) {
            stats.offlineMatchDirectRulesRewritten += 1;
            return 'MATCH,DIRECT';
          }
          return rule;
        });
      next = { ...next, rules };
    }

    if (next.dns && typeof next.dns === 'object' && !Array.isArray(next.dns)) {
      const dns = { ...next.dns };
      const fallbackFilter = dns['fallback-filter'];
      if (fallbackFilter && typeof fallbackFilter === 'object' && !Array.isArray(fallbackFilter)) {
        const normalizedFilter = { ...fallbackFilter };
        if (!geoAvailability.geoIp
          && (normalizedFilter.geoip !== false || 'geoip-code' in normalizedFilter)) {
          normalizedFilter.geoip = false;
          delete normalizedFilter['geoip-code'];
          stats.disabledDnsGeoFilter = true;
        }
        if (!geoAvailability.geoSite && 'geosite' in normalizedFilter) {
          delete normalizedFilter.geosite;
          stats.disabledDnsGeoFilter = true;
        }
        dns['fallback-filter'] = normalizedFilter;
      }

      const nameserverPolicy = dns['nameserver-policy'];
      if (!geoAvailability.geoSite
        && nameserverPolicy
        && typeof nameserverPolicy === 'object'
        && !Array.isArray(nameserverPolicy)) {
        const entries = Object.entries(nameserverPolicy);
        const retained = entries.filter(([key]) => !/(?:^|,)\s*geosite:/i.test(key));
        if (retained.length !== entries.length) {
          dns['nameserver-policy'] = Object.fromEntries(retained);
          stats.disabledDnsGeoFilter = true;
        }
      }
      next = { ...next, dns };
    }
  }

  stats.changed = stats.controlFieldAdded
    || stats.ruleModeForced
    || stats.domesticDirectRulesAdded > 0
    || stats.fixedUrls > 0
    || stats.removedGeoRules > 0
    || stats.offlineMatchDirectRulesRewritten > 0
    || stats.disabledDnsGeoFilter
    || stats.geoLocalized
    || stats.providersLocalized > 0;
  return { config: next, ...stats };
}

function getClashMiniCompatibilitySummary(normalized) {
  const { config: _config, ...summary } = normalized || {};
  return summary;
}

function normalizeAndWriteClashMiniRuntimeConfig(coreDir, runtimeConfigPath, config) {
  const normalized = normalizeClashMiniStartupConfig(config, coreDir);
  if (normalized.changed) {
    fs.writeFileSync(runtimeConfigPath, YAML.stringify(normalized.config), 'utf8');
    if (!normalized.geoDatabaseAvailable && (
      normalized.removedGeoRules > 0
      || normalized.offlineMatchDirectRulesRewritten > 0
      || normalized.disabledDnsGeoFilter
    )) {
      console.warn(
        '[IPC] Clash Mini 未找到可用 Geo 数据库，已启用离线启动兼容配置:',
        `移除 ${normalized.removedGeoRules} 条 Geo 规则，`
          + `将 ${normalized.offlineMatchDirectRulesRewritten} 条最终 MATCH 改为直连`,
      );
    }
    if (normalized.fixedUrls > 0) {
      console.warn('[IPC] Clash Mini 已修复配置中的异常 HTTPS 地址:', normalized.fixedUrls);
    }
  }
  return normalized;
}

function ensureClashMiniRuntimeConfig(coreDir) {
  const runtimeConfigPath = path.join(coreDir, 'config.yaml');
  const legacyConfigPath = path.join(coreDir, 'self.yaml');
  const profilesIndexPath = path.join(coreDir, 'profiles.yaml');

  const runtimeConfig = readYamlIfExists(runtimeConfigPath);
  if (looksLikeRuntimeClashConfig(runtimeConfig)) {
    const normalized = normalizeAndWriteClashMiniRuntimeConfig(coreDir, runtimeConfigPath, runtimeConfig);
    return {
      ok: true,
      configPath: runtimeConfigPath,
      source: runtimeConfigPath,
      repaired: normalized.changed,
      offlineGeoFallback: !normalized.geoDatabaseAvailable,
    };
  }

  const profilesYaml = readYamlIfExists(profilesIndexPath);
  if (looksLikeRuntimeClashConfig(profilesYaml)) {
    const normalized = normalizeAndWriteClashMiniRuntimeConfig(coreDir, runtimeConfigPath, profilesYaml);
    if (!normalized.changed) fs.writeFileSync(runtimeConfigPath, YAML.stringify(normalized.config), 'utf8');
    return { ok: true, configPath: runtimeConfigPath, source: profilesIndexPath, repaired: true, offlineGeoFallback: !normalized.geoDatabaseAvailable };
  }

  if (looksLikeProfilesIndex(profilesYaml)) {
    const profileFilePath = resolveClashMiniProfileFile(coreDir, profilesYaml);
    if (profileFilePath) {
      const profileConfig = readYamlIfExists(profileFilePath);
      if (looksLikeRuntimeClashConfig(profileConfig)) {
        const normalized = normalizeAndWriteClashMiniRuntimeConfig(coreDir, runtimeConfigPath, profileConfig);
        if (!normalized.changed) fs.writeFileSync(runtimeConfigPath, YAML.stringify(normalized.config), 'utf8');
        return { ok: true, configPath: runtimeConfigPath, source: profileFilePath, repaired: true, offlineGeoFallback: !normalized.geoDatabaseAvailable };
      }
    }
  }

  const legacyConfig = readYamlIfExists(legacyConfigPath);
  if (looksLikeRuntimeClashConfig(legacyConfig)) {
    const normalized = normalizeAndWriteClashMiniRuntimeConfig(coreDir, runtimeConfigPath, legacyConfig);
    if (!normalized.changed) fs.writeFileSync(runtimeConfigPath, YAML.stringify(normalized.config), 'utf8');
    return { ok: true, configPath: runtimeConfigPath, source: legacyConfigPath, repaired: true, offlineGeoFallback: !normalized.geoDatabaseAvailable };
  }

  return {
    ok: false,
    error: '未找到可启动的 Clash 运行配置',
    configPath: runtimeConfigPath,
  };
}

function extractDirectClashConfigContent(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('---')) return trimmed;
    if (/^(proxies|proxy-groups|rules|port|mixed-port|external-controller)\s*:/m.test(trimmed)) {
      return trimmed;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.config === 'string') return parsed.config;
        if (typeof parsed.data === 'string') return parsed.data;
        if (typeof parsed.content === 'string') return parsed.content;
      }
    } catch (_) {}
    return trimmed;
  }
  if (typeof value === 'object') {
    if (typeof value.clashConfig === 'string') return value.clashConfig;
    if (typeof value.clash_config === 'string') return value.clash_config;
    if (typeof value.config === 'string') return value.config;
    if (typeof value.data === 'string') return value.data;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.configContent === 'string') return value.configContent;
    if (typeof value.yaml_content === 'string') return value.yaml_content;
    if (typeof value.yamlContent === 'string') return value.yamlContent;
    if (typeof value.profiles_yaml_content === 'string') return value.profiles_yaml_content;
    if (typeof value.red_yaml_content === 'string') return value.red_yaml_content;
  }
  return '';
}

function tryDecodeBase64Text(text) {
  const raw = String(text || '').replace(/\s+/g, '');
  if (!raw || raw.length < 32 || raw.length % 4 !== 0) {
    return '';
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
    return '';
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!decoded) return '';
    if (/[\uFFFD]/.test(decoded)) return '';
    return decoded;
  } catch (_) {
    return '';
  }
}

function looksLikeSubscriptionPayload(text) {
  const value = String(text || '').trim();
  return /^(vmess|vless|trojan|ss|ssr):\/\//im.test(value);
}

function decodeSubscriptionItemName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch (_) {
    return raw;
  }
}

function safeBase64UrlDecode(input) {
  const raw = String(input || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!raw) return '';
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
  } catch (_) {
    return '';
  }
}

function sanitizeProxyName(name, fallback) {
  const value = decodeSubscriptionItemName(name || fallback || '').replace(/\s+/g, ' ').trim();
  return value || String(fallback || 'proxy').trim() || 'proxy';
}

function parseVmessSubscriptionLine(line, index) {
  const raw = String(line || '').trim();
  if (!raw.startsWith('vmess://')) return null;

  const payload = safeBase64UrlDecode(raw.slice('vmess://'.length));
  if (!payload) return null;

  let json = null;
  try {
    json = JSON.parse(payload);
  } catch (_) {
    return null;
  }

  const server = String(json.add || json.server || '').trim();
  const port = Number(json.port);
  const uuid = String(json.id || json.uuid || '').trim();
  if (!server || !Number.isFinite(port) || port <= 0 || !uuid) {
    return null;
  }

  const proxyName = sanitizeProxyName(json.ps, `${server}:${port}-${index + 1}`);
  const network = String(json.net || 'tcp').trim().toLowerCase();
  const hostHeader = String(json.host || json.headers?.Host || '').trim();
  const pathValue = String(json.path || '').trim();
  const tlsEnabled = ['1', 'true', 'tls', 'on', 'yes'].includes(String(json.tls || '').trim().toLowerCase());
  const servername = String(json.sni || json.servername || hostHeader || server).trim();
  const proxy = {
    name: proxyName,
    type: 'vmess',
    server,
    port,
    uuid,
    alterId: Number.isFinite(Number(json.aid)) ? Number(json.aid) : 0,
    cipher: String(json.cipher || 'auto').trim() || 'auto',
    udp: json.udp !== false,
    tls: tlsEnabled,
  };

  if (tlsEnabled && servername) {
    proxy.servername = servername;
  }
  if (String(json.skip_cert_verify || '').toLowerCase() === 'true' || json.skipCertVerify === true) {
    proxy['skip-cert-verify'] = true;
  }

  if (network === 'ws') {
    proxy.network = 'ws';
    proxy['ws-opts'] = { path: pathValue || '/' };
    if (hostHeader) {
      proxy['ws-opts'].headers = { Host: hostHeader };
    }
  } else if (network === 'h2' || network === 'http') {
    proxy.network = 'http';
    proxy['http-opts'] = { path: pathValue ? [pathValue] : ['/'] };
    if (hostHeader) {
      proxy['http-opts'].headers = { Host: hostHeader };
    }
  } else if (network === 'grpc') {
    proxy.network = 'grpc';
    proxy['grpc-opts'] = {
      'grpc-service-name': pathValue.replace(/^\//, ''),
    };
  } else if (network && network !== 'tcp') {
    proxy.network = network;
  }

  return proxy;
}

function parseSubscriptionProxyList(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && !line.startsWith('#'));

  const proxies = [];
  lines.forEach((line, index) => {
    const proxy = parseVmessSubscriptionLine(line, index);
    if (proxy) {
      proxies.push(proxy);
    }
  });
  return proxies;
}

function buildClashRuntimeConfigFromSubscription(text) {
  const content = String(text || '').trim();
  const decodedBase64 = tryDecodeBase64Text(content);
  const subscriptionText = looksLikeSubscriptionPayload(content)
    ? content
    : (looksLikeSubscriptionPayload(decodedBase64) ? decodedBase64 : '');
  if (!subscriptionText) {
    return null;
  }

  const proxies = parseSubscriptionProxyList(subscriptionText);
  if (!proxies.length) {
    return null;
  }

  const proxyNames = proxies.map((item) => item.name).filter(Boolean);
  return {
    port: 7890,
    'socks-port': 7891,
    'mixed-port': 7890,
    mode: 'rule',
    'log-level': 'info',
    'allow-lan': true,
    'external-controller': '127.0.0.1:9090',
    proxies,
    'proxy-groups': [
      {
        name: '节点选择',
        type: 'select',
        proxies: [...proxyNames, 'DIRECT'],
      },
    ],
    rules: ['MATCH,节点选择'],
  };
}

function ensureClashMiniControlFields(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config;
  }

  const next = { ...config };
  if (!String(next['external-controller'] || next.external_controller || '').trim()) {
    next['external-controller'] = '127.0.0.1:9090';
  }
  return next;
}

function normalizeDirectClashRuntimeConfig(rawContent, options = {}) {
  const text = extractDirectClashConfigContent(rawContent);
  if (!text) {
    return { ok: false, error: '空的 Clash 配置内容', rawContent: '' };
  }
  try {
    const parsed = YAML.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized = normalizeClashMiniStartupConfig(parsed, options.coreDir);
      return {
        ok: true,
        content: YAML.stringify(normalized.config),
        rawContent: text,
        compatibility: getClashMiniCompatibilitySummary(normalized),
      };
    }
    if (typeof parsed === 'string') {
      const stringConverted = buildClashRuntimeConfigFromSubscription(parsed);
      if (stringConverted) {
        return {
          ok: true,
          content: YAML.stringify(stringConverted),
          rawContent: parsed,
        };
      }
    }
  } catch (_) {}

  const decodedBase64 = tryDecodeBase64Text(text);
  if (decodedBase64) {
    try {
      const parsed = YAML.parse(decodedBase64);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const normalized = normalizeClashMiniStartupConfig(parsed, options.coreDir);
        return {
          ok: true,
          content: YAML.stringify(normalized.config),
          rawContent: decodedBase64,
          compatibility: getClashMiniCompatibilitySummary(normalized),
        };
      }
      if (typeof parsed === 'string') {
        const stringConverted = buildClashRuntimeConfigFromSubscription(parsed);
        if (stringConverted) {
          return {
            ok: true,
            content: YAML.stringify(stringConverted),
            rawContent: parsed,
          };
        }
      }
    } catch (_) {}

    const converted = buildClashRuntimeConfigFromSubscription(decodedBase64);
    if (converted) {
      return {
        ok: true,
        content: YAML.stringify(converted),
        rawContent: decodedBase64,
      };
    }
  }

  const converted = buildClashRuntimeConfigFromSubscription(text);
  if (converted) {
    return {
      ok: true,
      content: YAML.stringify(converted),
      rawContent: text,
    };
  }

  return { ok: false, error: 'Clash 配置解析失败', rawContent: text };
}

function importDirectClashRuntimeConfig(coreDir, payload, sourceLabel = 'server-config') {
  // 服务器配置可能在 Mihomo 首次启动前导入；必须先同步资产再规范化，
  // 否则缺 Geo 的离线兜底会提前把 MATCH,节点组 固化成 MATCH,DIRECT。
  const assetSync = syncLocalGeoAssets(coreDir);
  if (!assetSync.ok) {
    const details = assetSync.missing.length > 0
      ? assetSync.missing.join(', ')
      : (assetSync.error || '未知错误');
    console.warn(`[IPC] Clash Mini 本地 Geo/规则资产缺失: ${details}（将回退到离线兜底）`);
  }
  const rawContent = extractDirectClashConfigContent(payload);
  const normalized = normalizeDirectClashRuntimeConfig(rawContent, { coreDir });
  if (!normalized.ok) {
    return {
      ...normalized,
      rawContent,
    };
  }

  try {
    const runtimeConfigPath = path.join(coreDir, 'config.yaml');
    fs.mkdirSync(coreDir, { recursive: true });
    const purgeResult = purgeClashMiniRuntimeConfigFiles(coreDir);
    fs.writeFileSync(runtimeConfigPath, normalized.content, 'utf8');
    const generatedPreview = String(normalized.content || '').replace(/\s+/g, ' ').trim().slice(0, 360);
    return {
      ok: true,
      runtimeConfigPath,
      source: sourceLabel,
      refreshed: true,
      purgeResult,
      generatedPreview,
      generatedContent: normalized.content,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

let clashStartedByApp = false;
let clashMiniProcess = null;
let clashMiniPid = null;
let clashMiniCoreDir = null;
let clashMiniExePath = null;
let clashMiniConfigPath = null;
let clashMiniProxyAppliedByApp = false;
let runtimeLicenseCache = null;
let clashMiniStartPromise = null;
let clashMiniStopPromise = null;
let clashMiniStartGeneration = 0;
const intentionallyStoppedClashProcesses = new WeakSet();

function isClashMiniStartCancelled(startGeneration) {
  return startGeneration !== clashMiniStartGeneration || global._isShuttingDown === true;
}

function buildClashMiniStartCancelledResult() {
  return {
    ...getClashMiniStatus(),
    ok: false,
    cancelled: true,
    error: 'Clash Mini 启动已取消',
  };
}

function hasClashMiniProcessExited(processRef) {
  return !processRef || processRef.exitCode != null || processRef.signalCode != null;
}

function waitForClashMiniProcessExit(processRef, timeoutMs) {
  if (hasClashMiniProcessExited(processRef)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processRef.removeListener('exit', onExit);
      processRef.removeListener('close', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(hasClashMiniProcessExited(processRef)), timeoutMs);
    processRef.once('exit', onExit);
    processRef.once('close', onExit);
  });
}

function forceKillClashMiniProcessTree(pid, processRef) {
  if (process.platform !== 'win32' || !pid) return Promise.resolve(false);

  return new Promise((resolve) => {
    let killer;
    try {
      killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (_) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try { killer.kill(); } catch (_) {}
      finish(false);
    }, 5000);
    killer.once('error', () => finish(false));
    killer.once('close', (code) => finish(code === 0 || hasClashMiniProcessExited(processRef)));
  });
}

function setRuntimeLicenseCache(next) {
  runtimeLicenseCache = next || null;
}

function isClashMiniProcessRunning() {
  // killed 仅表示已经调用过 ChildProcess.kill()，不能用它判断 OS 进程已退出。
  return !!(clashMiniProcess && !hasClashMiniProcessExited(clashMiniProcess));
}

function getClashMiniStatus() {
  const actualEnabled = clashMiniProxyAppliedByApp === true;
  return {
    ok: true,
    running: isClashMiniProcessRunning(),
    enabled: isClashMiniProcessRunning() && actualEnabled,
    pid: clashMiniPid || null,
    coreDir: clashMiniCoreDir || '',
    exePath: clashMiniExePath || '',
    configPath: clashMiniConfigPath || '',
    startedByApp: clashStartedByApp === true,
    proxyAppliedByApp: actualEnabled,
  };
}

function isClashMiniNetworkRequestLog(text, extra = {}) {
  if (!extra || !extra.stream) return false;
  return /(?:msg=)?["']?\[(?:TCP|UDP|DNS)\]/i.test(String(text || ''));
}

function emitClashMiniLog(ui, level, message, extra = {}) {
  const text = String(message || '').trim();
  const prefix = '[Clash Mini]';
  const debugOnly = isClashMiniNetworkRequestLog(text, extra);
  const entry = {
    level,
    text,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  if (debugOnly) {
    writeDebugConsoleOnly(level, prefix, text, extra);
  } else {
    try {
      if (level === 'error') {
        console.error(prefix, text, extra);
      } else if (level === 'warn') {
        console.warn(prefix, text, extra);
      } else {
        console.log(prefix, text, extra);
      }
    } catch (_) {}
  }

  if (!debugOnly) {
    try {
      ui?.sendToSide?.('clash-mini-log', entry);
    } catch (_) {}
    try {
      ui?.sendToSide?.('clash-mini-status', getClashMiniStatus());
    } catch (_) {}
  }
  return entry;
}

async function startClashMiniProcessOnce(ui, options = {}, startGeneration = clashMiniStartGeneration) {
  const startCancelled = () => isClashMiniStartCancelled(startGeneration);
  if (startCancelled()) return buildClashMiniStartCancelledResult();

  if (isClashMiniProcessRunning()) {
    const runningCoreDir = clashMiniCoreDir || getClashMiniRuntimeRoot();
    const controlApiReady = await waitForClashMiniControlApi(runningCoreDir, 10000, startCancelled);
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    if (!controlApiReady) {
      const message = 'Mihomo 进程存在但控制端口不可用，已停止异常进程';
      emitClashMiniLog(ui, 'error', message);
      await stopClashMiniProcess(ui, { waitForPendingStart: false });
      return { ok: false, error: message, controlApiReady: false };
    }
    const ruleModeResult = await ensureClashMiniRuleMode(runningCoreDir);
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    if (!ruleModeResult.ok) {
      const message = `Mihomo 无法切换到规则模式：${ruleModeResult.error || '未知错误'}`;
      emitClashMiniLog(ui, 'error', message);
      return { ok: false, error: message, controlApiReady: true };
    }
    let browserProxySyncResult = null;
    if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
      browserProxySyncResult = await Promise.resolve(ui.applyClashMiniBrowserProxy(true)).catch(() => null);
    }
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    clashMiniProxyAppliedByApp = browserProxySyncResult && browserProxySyncResult.ok === true;
    const browserProxyMessage = browserProxySyncResult && browserProxySyncResult.ok === true
      ? `，浏览器代理已同步${Number.isFinite(Number(browserProxySyncResult.updated)) ? `(${Number(browserProxySyncResult.updated)} 个标签页)` : ''}`
      : '';
    emitClashMiniLog(ui, 'info', `Clash Mini 已重新运行${browserProxyMessage}`);
    return { ok: true, alreadyRunning: true, ...getClashMiniStatus() };
  }

  const runtimePrep = await prepareClashMiniRuntimeDirAsync();
  if (startCancelled()) return buildClashMiniStartCancelledResult();
  if (!runtimePrep.ok) {
    emitClashMiniLog(ui, 'error', runtimePrep.error || '准备 Clash Mini 运行目录失败');
    return { ok: false, error: runtimePrep.error || '准备 Clash Mini 运行目录失败' };
  }

  if (!runtimePrep.assetSync?.ok) {
    const details = runtimePrep.assetSync?.missing?.length > 0
      ? runtimePrep.assetSync.missing.join(', ')
      : (runtimePrep.assetSync?.error || '未知错误');
    emitClashMiniLog(ui, 'warn', `本地 Geo/规则资产缺失: ${details}（将回退到离线兜底）`);
  }

  const configResult = ensureClashMiniRuntimeConfig(runtimePrep.runtimeDir);
  if (startCancelled()) return buildClashMiniStartCancelledResult();
  if (!configResult.ok) {
    emitClashMiniLog(ui, 'error', configResult.error || '未找到可启动的 Clash 运行配置');
    return { ok: false, error: configResult.error || '未找到可启动的 Clash 运行配置' };
  }

  const exePath = resolveClashMiniExecutable(runtimePrep.runtimeDir);
  if (!exePath) {
    emitClashMiniLog(ui, 'error', '未找到 verge-mihomo.exe');
    return { ok: false, error: '未找到 verge-mihomo.exe' };
  }

  try {
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    clashMiniCoreDir = runtimePrep.runtimeDir;
    clashMiniExePath = exePath;
    clashMiniConfigPath = configResult.configPath || path.join(runtimePrep.runtimeDir, 'config.yaml');

    emitClashMiniLog(ui, 'info', `启动命令: ${path.basename(exePath)} -d ${runtimePrep.runtimeDir}`);
    clashMiniProcess = spawn(exePath, ['-d', runtimePrep.runtimeDir], {
      cwd: runtimePrep.runtimeDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    clashMiniPid = clashMiniProcess.pid || null;
    clashStartedByApp = true;
    const spawnedProcess = clashMiniProcess;

    if (clashMiniProcess.stdout) {
      clashMiniProcess.stdout.on('data', (data) => {
        const text = String(data || '').trim();
        if (text) emitClashMiniLog(ui, 'info', text, { stream: 'stdout' });
      });
    }
    if (clashMiniProcess.stderr) {
      clashMiniProcess.stderr.on('data', (data) => {
        const text = String(data || '').trim();
        if (text) emitClashMiniLog(ui, 'warn', text, { stream: 'stderr' });
      });
    }

    // 必须在任何异步等待之前绑定退出事件，避免可执行文件启动失败时产生
    // 未处理的 ChildProcess error，并确保浏览器代理能恢复为直连。
    spawnedProcess.on('close', (code, signal) => {
      const intentionalStop = intentionallyStoppedClashProcesses.has(spawnedProcess);
      intentionallyStoppedClashProcesses.delete(spawnedProcess);
      if (clashMiniProcess === spawnedProcess) {
        clashMiniProcess = null;
        clashMiniPid = null;
        clashMiniCoreDir = null;
        clashMiniExePath = null;
        clashMiniConfigPath = null;
        clashStartedByApp = false;
        clashMiniProxyAppliedByApp = false;
      }
      // 主动停止流程已经同步撤销代理并重启 Chromium，退出事件不能再做
      // 第二次同步，否则会把刚重启完成的浏览器再次关闭。
      if (!intentionalStop && !isClashMiniProcessRunning() && ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
        Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
      }
      const exitLevel = intentionalStop || code === 0 ? 'info' : 'warn';
      const exitReason = intentionalStop ? '已按请求停止' : '进程已退出';
      emitClashMiniLog(ui, exitLevel, `Clash Mini ${exitReason}，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
    });

    spawnedProcess.on('error', (error) => {
      const intentionalStop = intentionallyStoppedClashProcesses.has(spawnedProcess);
      intentionallyStoppedClashProcesses.delete(spawnedProcess);
      // ChildProcess 的 error 后通常还会继续触发 close；保留标记让 close
      // 只做收尾和日志，不重复撤销浏览器代理。
      intentionallyStoppedClashProcesses.add(spawnedProcess);
      if (clashMiniProcess === spawnedProcess) {
        clashMiniProcess = null;
        clashMiniPid = null;
        clashMiniCoreDir = null;
        clashMiniExePath = null;
        clashMiniConfigPath = null;
        clashStartedByApp = false;
        clashMiniProxyAppliedByApp = false;
      }
      if (!intentionalStop && !isClashMiniProcessRunning() && ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
        Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
      }
      emitClashMiniLog(ui, 'error', `Clash Mini 启动失败: ${error?.message || error}`);
    });

    const controlApiReady = await waitForClashMiniControlApi(runtimePrep.runtimeDir, 30000, startCancelled);
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    if (!controlApiReady || !isClashMiniProcessRunning()) {
      const message = 'Mihomo 控制端口未能在 30 秒内启动，请检查 Clash YAML 配置或端口占用';
      emitClashMiniLog(ui, 'error', message);
      await stopClashMiniProcess(ui, { waitForPendingStart: false });
      return { ok: false, error: message, controlApiReady: false };
    }

    const ruleModeResult = await ensureClashMiniRuleMode(runtimePrep.runtimeDir);
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    if (!ruleModeResult.ok) {
      const message = `Mihomo 无法切换到规则模式：${ruleModeResult.error || '未知错误'}`;
      emitClashMiniLog(ui, 'error', message);
      await stopClashMiniProcess(ui, { waitForPendingStart: false });
      return { ok: false, error: message, controlApiReady: true };
    }

    let browserProxySyncResult = null;
    if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
      browserProxySyncResult = await Promise.resolve(ui.applyClashMiniBrowserProxy(true)).catch(() => null);
    }
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    clashMiniProxyAppliedByApp = browserProxySyncResult && browserProxySyncResult.ok === true;
    const browserProxyMessage = browserProxySyncResult && browserProxySyncResult.ok === true
      ? `，浏览器代理已同步${Number.isFinite(Number(browserProxySyncResult.updated)) ? `(${Number(browserProxySyncResult.updated)} 个标签页)` : ''}`
      : '';

    const status = getClashMiniStatus();
    emitClashMiniLog(ui, 'info', `Clash Mini 已启动，PID: ${clashMiniPid || 'unknown'}${browserProxyMessage || '，浏览器代理已切换到本地混合端口'}`);
    return { ok: true, started: true, ...status };
  } catch (error) {
    if (startCancelled()) return buildClashMiniStartCancelledResult();
    emitClashMiniLog(ui, 'error', `启动 Clash Mini 失败: ${error?.message || error}`);
    clashMiniProcess = null;
    clashMiniPid = null;
    clashMiniCoreDir = null;
    clashMiniExePath = null;
    clashMiniConfigPath = null;
    clashStartedByApp = false;
    clashMiniProxyAppliedByApp = false;
    return { ok: false, error: error?.message || String(error) };
  }
}

// 自动预热、账号验证和手动点击可能同时请求启动。所有调用方共享同一个任务，
// 防止后到的请求把“正在初始化”的 Mihomo 误判为异常进程并提前终止。
function startClashMiniProcess(ui, options = {}) {
  if (clashMiniStartPromise) {
    return clashMiniStartPromise;
  }

  const startGeneration = ++clashMiniStartGeneration;
  const sharedPromise = startClashMiniProcessOnce(ui, options, startGeneration).finally(() => {
    if (clashMiniStartPromise === sharedPromise) {
      clashMiniStartPromise = null;
    }
  });
  clashMiniStartPromise = sharedPromise;
  return sharedPromise;
}

async function stopClashMiniProcessOnce(ui, pendingStartPromise = null) {
  // 停止请求可能发生在资源复制/配置生成阶段，此时还没有 ChildProcess。
  // 等启动任务看到 generation 变化并自行退出，避免停止流程返回后又拉起核心。
  if (pendingStartPromise) {
    await pendingStartPromise.catch(() => {});
  }

  if (!isClashMiniProcessRunning()) {
    if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
      await Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
    }
    return { ok: true, stopped: false, ...getClashMiniStatus() };
  }

  const pid = clashMiniPid;
  const processRef = clashMiniProcess;
  if (processRef && typeof processRef === 'object') {
    intentionallyStoppedClashProcesses.add(processRef);
  }
  emitClashMiniLog(ui, 'info', `正在停止 Clash Mini，PID: ${pid || 'unknown'}`);

  // 先让浏览器脱离本地代理，再结束 Mihomo。反过来会让所有仍在传输的
  // Chromium socket 同时收到 ECONNRESET，并可能在退出期形成未处理异常。
  if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
    await Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
  }
  clashMiniProxyAppliedByApp = false;

  try {
    if (processRef && typeof processRef.kill === 'function') {
      processRef.kill();
    }
  } catch (error) {
    emitClashMiniLog(ui, 'warn', `直接结束进程失败: ${error?.message || error}`);
  }

  // ChildProcess.killed 只表示 kill() 请求已经发出，并不代表 Windows 已经释放
  // 可执行文件。必须等待 exit/close；超时后再结束整个进程树。
  let exited = await waitForClashMiniProcessExit(processRef, 1500);
  if (!exited && process.platform === 'win32' && pid) {
    emitClashMiniLog(ui, 'warn', `Clash Mini 未及时退出，正在强制结束进程树，PID: ${pid}`);
    await forceKillClashMiniProcessTree(pid, processRef);
    exited = await waitForClashMiniProcessExit(processRef, 3000);
  }

  if (exited && clashMiniProcess === processRef) {
    clashMiniProcess = null;
    clashMiniPid = null;
    clashMiniCoreDir = null;
    clashMiniExePath = null;
    clashMiniConfigPath = null;
    clashStartedByApp = false;
  }
  if (runtimeLicenseCache && typeof runtimeLicenseCache.setRuntimeConfig === 'function') {
    runtimeLicenseCache.setRuntimeConfig({ systemProxyEnabled: false });
  }
  if (!exited) {
    const error = `Clash Mini 进程未能在超时内退出，PID: ${pid || 'unknown'}`;
    emitClashMiniLog(ui, 'error', error);
    return { ...getClashMiniStatus(), ok: false, stopped: false, error };
  }
  emitClashMiniLog(ui, 'info', 'Clash Mini 已停止，进程资源已释放');
  return { ok: true, stopped: true, ...getClashMiniStatus() };
}

function stopClashMiniProcess(ui, options = {}) {
  if (clashMiniStopPromise) return clashMiniStopPromise;

  // 启动流程自身发现失败时也会调用停止；该路径不能等待自身 promise。
  // 外部停止/应用退出则等待取消后的启动任务收敛，避免代理切换互相覆盖。
  const pendingStartPromise = options?.waitForPendingStart === false ? null : clashMiniStartPromise;
  // 同步失效当前启动任务，确保它不会跨过下一处 await 后继续 spawn/应用代理。
  clashMiniStartGeneration += 1;
  const sharedPromise = stopClashMiniProcessOnce(ui, pendingStartPromise).finally(() => {
    if (clashMiniStopPromise === sharedPromise) {
      clashMiniStopPromise = null;
    }
  });
  clashMiniStopPromise = sharedPromise;
  return sharedPromise;
}

function cleanupClashMiniRuntimeConfig(coreDir) {
  if (!coreDir || !fs.existsSync(coreDir)) {
    return { ok: true, removed: [], failed: [] };
  }

  return purgeClashMiniRuntimeConfigFiles(coreDir);
}

module.exports = {
  CLASH_MINI_DIR_NAME,
  copyDirectoryRecursive,
  collectClashMiniProxyDelays,
  emitClashMiniLog,
  extractDirectClashConfigContent,
  fetchClashMiniProxyNames,
  getClashMiniConfigProxyNames,
  getClashMiniManualGroupName,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
  getClashMiniStatus,
  importDirectClashRuntimeConfig,
  isClashMiniNetworkRequestLog,
  ensureClashMiniRuleMode,
  invokeClashMiniControl,
  normalizeClashMiniStartupConfig,
  normalizeDirectClashRuntimeConfig,
  normalizeProbeTimeout,
  normalizeProbeUrl,
  probeClashMiniGroupDelay,
  probeClashMiniProxyDelay,
  prepareClashMiniRuntimeDirAsync,
  readClashProbeSettings,
  resolveClashMiniCoreDir,
  setRuntimeLicenseCache,
  syncLocalGeoAssets,
  cleanupClashMiniRuntimeConfig,
  startClashMiniProcess,
  stopClashMiniProcess,
  waitForClashMiniControlApi,
};
