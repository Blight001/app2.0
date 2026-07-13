const { app: electronApp, net } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');
const { getCoreDir } = require('../../config');
const {
  readStoreConfigSafe,
  toBoolean,
} = require('./store-utils');

const CLASH_MINI_DIR_NAME = 'clash-mini';

// 复制/克隆：copyDirectoryRecursive的具体业务逻辑。
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

// 获取/读取/解析：getClashMiniAppRoots的具体业务逻辑。
function getClashMiniAppRoots() {
  const roots = [];
  try { roots.push(path.join(process.resourcesPath || '', CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(path.join(path.dirname(process.execPath || ''), 'resources', CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(path.join(process.cwd(), 'resources', CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(path.join(__dirname, '..', '..', '..', '..', '..', 'resources', CLASH_MINI_DIR_NAME)); } catch (_) {}
  return Array.from(new Set(roots.filter(Boolean)));
}

// 获取/读取/解析：getClashMiniCoreRoots的具体业务逻辑。
function getClashMiniCoreRoots() {
  return getClashMiniAppRoots().map((root) => path.join(root, 'core'));
}

// 获取/读取/解析：resolveBundledClashMiniCoreDir的具体业务逻辑。
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

// 获取/读取/解析：getClashMiniRuntimeRoot的具体业务逻辑。
function getClashMiniRuntimeRoot() {
  try {
    return path.join(electronApp.getPath('appData'), CLASH_MINI_DIR_NAME);
  } catch (_) {
    return path.join(getCoreDir(), CLASH_MINI_DIR_NAME);
  }
}

// 获取/读取/解析：resolveClashMiniCoreDir的具体业务逻辑。
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

// 获取/读取/解析：resolveClashMiniExecutable的具体业务逻辑。
function resolveClashMiniExecutable(coreDir) {
  if (!coreDir) return null;
  const candidate = path.join(coreDir, 'verge-mihomo.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

// 创建/初始化：prepareClashMiniRuntimeDir的具体业务逻辑。
function prepareClashMiniRuntimeDir() {
  const sourceDir = resolveBundledClashMiniCoreDir();
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return { ok: false, error: `未找到 Clash Mini 源目录: ${sourceDir || 'unknown'}` };
  }

  const runtimeDir = getClashMiniRuntimeRoot();
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    if (path.resolve(runtimeDir) !== path.resolve(sourceDir)) {
      copyDirectoryRecursive(sourceDir, runtimeDir, { overwrite: false });
    }
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }

  const exePath = resolveClashMiniExecutable(runtimeDir);
  if (!exePath) {
    return { ok: false, error: 'Clash Mini 运行目录中未找到 verge-mihomo.exe' };
  }

  return { ok: true, sourceDir, runtimeDir, exePath };
}

// 移除/删除：purgeClashMiniRuntimeConfigFiles的具体业务逻辑。
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

// 处理：logTextChunks的具体业务逻辑。
function logTextChunks(prefix, text, chunkSize = 900) {
  const value = String(text || '');
  if (!value) {
    console.log(prefix, '(empty)');
    return;
  }

  const clean = value.replace(/\r\n/g, '\n');
  const total = Math.max(1, Math.ceil(clean.length / chunkSize));
  for (let index = 0; index < total; index += 1) {
    const start = index * chunkSize;
    const chunk = clean.slice(start, start + chunkSize);
    console.log(`${prefix} (${index + 1}/${total}):`);
    console.log(chunk);
  }
}

// 获取/读取/解析：parseYamlMaybe的具体业务逻辑。
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

// 处理：looksLikeRuntimeClashConfig的具体业务逻辑。
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

// 处理：looksLikeProfilesIndex的具体业务逻辑。
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

// 获取/读取/解析：readYamlIfExists的具体业务逻辑。
function readYamlIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

// 获取/读取/解析：getClashMiniProxyEndpoint的具体业务逻辑。
function getClashMiniProxyEndpoint(coreDir) {
  const config = readYamlIfExists(path.join(coreDir, 'config.yaml'))
    || readYamlIfExists(path.join(coreDir, 'self.yaml'))
    || {};
  const host = '127.0.0.1';
  const mixedPort = Number(config['mixed-port'] || config.mixed_port);
  const httpPort = Number(config.port || config.http_port);
  const socksPort = Number(config['socks-port'] || config.socks_port);
  const port = [mixedPort, httpPort, socksPort, 7890].find((n) => Number.isFinite(n) && n > 0) || 7890;
  return { host, port };
}

// 获取/读取/解析：getClashMiniControlEndpoint的具体业务逻辑。
function getClashMiniControlEndpoint(coreDir) {
  const config = readYamlIfExists(path.join(coreDir, 'config.yaml'))
    || readYamlIfExists(path.join(coreDir, 'self.yaml'))
    || {};
  const raw = String(config['external-controller'] || config.external_controller || '').trim();
  const [hostPart, portPart] = raw.split(':');
  const host = hostPart || '127.0.0.1';
  const port = Number(portPart);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 9090,
  };
}

// 获取/读取/解析：getClashMiniControlSecret的具体业务逻辑。
function getClashMiniControlSecret(coreDir) {
  const config = readYamlIfExists(path.join(coreDir, 'config.yaml'))
    || readYamlIfExists(path.join(coreDir, 'self.yaml'))
    || {};
  return String(config.secret || config['control-secret'] || '').trim();
}

// 获取/读取/解析：getClashMiniManualGroupName的具体业务逻辑。
function getClashMiniManualGroupName(coreDir) {
  const config = readYamlIfExists(path.join(coreDir, 'config.yaml'))
    || readYamlIfExists(path.join(coreDir, 'self.yaml'))
    || {};
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const manualGroup = groups.find((group) => group && group.type === 'select' && group.name);
  return manualGroup?.name || groups[0]?.name || '节点选择';
}

// 获取/读取/解析：getClashMiniConfigProxyNames的具体业务逻辑。
function getClashMiniConfigProxyNames(coreDir, groupName) {
  const config = readYamlIfExists(path.join(coreDir, 'config.yaml'))
    || readYamlIfExists(path.join(coreDir, 'self.yaml'))
    || {};
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const targetGroupName = String(groupName || '').trim();
  const group = groups.find((item) => String(item?.name || '').trim() === targetGroupName)
    || groups.find((item) => item && item.type === 'select')
    || groups[0]
    || null;
  const fromGroup = Array.isArray(group?.proxies) ? group.proxies : [];
  const fromProxies = Array.isArray(config.proxies)
    ? config.proxies.map((item) => String(item?.name || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...fromGroup, ...fromProxies].map((item) => String(item || '').trim()).filter(Boolean)));
}

// 创建/初始化：buildClashMiniControlUrl的具体业务逻辑。
function buildClashMiniControlUrl(coreDir, pathname) {
  const endpoint = getClashMiniControlEndpoint(coreDir);
  const cleanPath = String(pathname || '').startsWith('/') ? String(pathname || '') : `/${String(pathname || '')}`;
  return `http://${endpoint.host}:${endpoint.port}${cleanPath}`;
}

// 创建/初始化：buildClashMiniControlHeaders的具体业务逻辑。
function buildClashMiniControlHeaders(coreDir) {
  const secret = getClashMiniControlSecret(coreDir);
  const headers = {};
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return headers;
}

// 获取/读取/解析：extractDelayValue的具体业务逻辑。
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

// 格式化/规范化：normalizeProxyNameList的具体业务逻辑。
function normalizeProxyNameList(input) {
  const out = [];
  const seen = new Set();
// 处理：push的具体业务逻辑。
  const push = (name) => {
    const value = String(name || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

// 处理：walk的具体业务逻辑。
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

// 获取/读取/解析：fetchClashMiniProxyNames的具体业务逻辑。
async function fetchClashMiniProxyNames(coreDir, groupName) {
  let response = null;
  try {
    response = await invokeClashMiniControl(coreDir, 'get', `/proxies/${encodeURIComponent(groupName)}`, {
      timeoutMs: 15000,
    });
  } catch (error) {
    console.warn('[IPC] 获取 Clash Mini 节点列表失败，改用本地配置兜底:', error?.message || error);
  }

  const apiNames = normalizeProxyNameList(response?.all || response?.proxies || response);
  const configNames = getClashMiniConfigProxyNames(coreDir, groupName);
  const names = Array.from(new Set([...apiNames, ...configNames]));
  const current = String(response?.now || response?.name || '').trim();
  return {
    raw: response,
    names,
    current,
  };
}

// 处理：probeClashMiniProxyDelay的具体业务逻辑。
async function probeClashMiniProxyDelay(coreDir, proxyName, testUrl, timeout) {
  const response = await invokeClashMiniControl(coreDir, 'get', `/proxies/${encodeURIComponent(proxyName)}/delay?timeout=${encodeURIComponent(timeout)}&url=${encodeURIComponent(testUrl)}`, {
    timeoutMs: Math.max(Number(timeout) || 5000, 8000),
  });
  return {
    raw: response,
    delay: extractDelayValue(response),
  };
}

// 格式化/规范化：formatClashMiniDelayText的具体业务逻辑。
function formatClashMiniDelayText(delay) {
  const value = Number(delay);
  if (!Number.isFinite(value) || value <= 0) return '超时';
  return `${Math.round(value)}ms`;
}

// 处理：collectClashMiniProxyDelays的具体业务逻辑。
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

// 格式化/规范化：normalizeProbeTimeout的具体业务逻辑。
function normalizeProbeTimeout(value, fallbackMs = 2000) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.max(200, Math.round(num));
  return fallbackMs;
}

// 格式化/规范化：normalizeProbeUrl的具体业务逻辑。
function normalizeProbeUrl(value, fallbackUrl = 'http://www.gstatic.com/generate_204') {
  const text = String(value || '').trim();
  if (!text) return fallbackUrl;
  try {
    const url = new URL(text);
    return url.toString();
  } catch (_) {
    return fallbackUrl;
  }
}

// 获取/读取/解析：readClashProbeSettings的具体业务逻辑。
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
      const latencyUrl = normalizeProbeUrl(profile['cfw-latency-url'], 'http://www.gstatic.com/generate_204');
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

// 处理：probeLatencyUrl的具体业务逻辑。
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

// 处理：finish的具体业务逻辑。
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

// 处理：waitForClashMiniControlApi的具体业务逻辑。
async function waitForClashMiniControlApi(coreDir, timeoutMs = 15000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
  const probePaths = ['/version', '/proxies', '/configs'];
  const headers = buildClashMiniControlHeaders(coreDir);

  while (Date.now() < deadline) {
    for (const probePath of probePaths) {
      try {
        const response = await axios.get(buildClashMiniControlUrl(coreDir, probePath), {
          timeout: 2000,
          headers,
          validateStatus: () => true,
        });
        if (response && typeof response.status === 'number' && response.status < 500) {
          return true;
        }
      } catch (_) {}
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

// 处理：invokeClashMiniControl的具体业务逻辑。
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

// 获取/读取/解析：getClashMiniProfileRoots的具体业务逻辑。
function getClashMiniProfileRoots() {
  const roots = [];
  try { roots.push(path.join(electronApp.getPath('appData'), CLASH_MINI_DIR_NAME)); } catch (_) {}
  try { roots.push(getCoreDir()); } catch (_) {}
  return Array.from(new Set(roots.filter(Boolean)));
}

// 获取/读取/解析：resolveClashMiniProfileFile的具体业务逻辑。
function resolveClashMiniProfileFile(coreDir, profilesIndex) {
  const items = Array.isArray(profilesIndex?.items) ? profilesIndex.items : [];
  const currentUid = String(profilesIndex?.current || profilesIndex?.getCurrentProfile || '').trim();
// 处理：currentItem的具体业务逻辑。
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

// 校验/保护：ensureClashMiniRuntimeConfig的具体业务逻辑。
function ensureClashMiniRuntimeConfig(coreDir) {
  const runtimeConfigPath = path.join(coreDir, 'config.yaml');
  const legacyConfigPath = path.join(coreDir, 'self.yaml');
  const profilesIndexPath = path.join(coreDir, 'profiles.yaml');

  const runtimeConfig = readYamlIfExists(runtimeConfigPath);
  if (looksLikeRuntimeClashConfig(runtimeConfig)) {
    return { ok: true, configPath: runtimeConfigPath, source: runtimeConfigPath, repaired: false };
  }

  const profilesYaml = readYamlIfExists(profilesIndexPath);
  if (looksLikeRuntimeClashConfig(profilesYaml)) {
    fs.writeFileSync(runtimeConfigPath, YAML.stringify(profilesYaml), 'utf8');
    return { ok: true, configPath: runtimeConfigPath, source: profilesIndexPath, repaired: true };
  }

  if (looksLikeProfilesIndex(profilesYaml)) {
    const profileFilePath = resolveClashMiniProfileFile(coreDir, profilesYaml);
    if (profileFilePath) {
      const profileConfig = readYamlIfExists(profileFilePath);
      if (looksLikeRuntimeClashConfig(profileConfig)) {
        fs.writeFileSync(runtimeConfigPath, YAML.stringify(profileConfig), 'utf8');
        return { ok: true, configPath: runtimeConfigPath, source: profileFilePath, repaired: true };
      }
    }
  }

  const legacyConfig = readYamlIfExists(legacyConfigPath);
  if (looksLikeRuntimeClashConfig(legacyConfig)) {
    fs.writeFileSync(runtimeConfigPath, YAML.stringify(legacyConfig), 'utf8');
    return { ok: true, configPath: runtimeConfigPath, source: legacyConfigPath, repaired: true };
  }

  return {
    ok: false,
    error: '未找到可启动的 Clash 运行配置',
    configPath: runtimeConfigPath,
  };
}

// 获取/读取/解析：extractDirectClashConfigContent的具体业务逻辑。
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

// 处理：tryDecodeBase64Text的具体业务逻辑。
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

// 处理：looksLikeSubscriptionPayload的具体业务逻辑。
function looksLikeSubscriptionPayload(text) {
  const value = String(text || '').trim();
  return /^(vmess|vless|trojan|ss|ssr):\/\//im.test(value);
}

// 处理：decodeSubscriptionItemName的具体业务逻辑。
function decodeSubscriptionItemName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch (_) {
    return raw;
  }
}

// 处理：safeBase64UrlDecode的具体业务逻辑。
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

// 格式化/规范化：sanitizeProxyName的具体业务逻辑。
function sanitizeProxyName(name, fallback) {
  const value = decodeSubscriptionItemName(name || fallback || '').replace(/\s+/g, ' ').trim();
  return value || String(fallback || 'proxy').trim() || 'proxy';
}

// 获取/读取/解析：parseVmessSubscriptionLine的具体业务逻辑。
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

// 获取/读取/解析：parseSubscriptionProxyList的具体业务逻辑。
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

// 创建/初始化：buildClashRuntimeConfigFromSubscription的具体业务逻辑。
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

// 校验/保护：ensureClashMiniControlFields的具体业务逻辑。
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

// 格式化/规范化：normalizeDirectClashRuntimeConfig的具体业务逻辑。
function normalizeDirectClashRuntimeConfig(rawContent) {
  const text = extractDirectClashConfigContent(rawContent);
  if (!text) {
    return { ok: false, error: '空的 Clash 配置内容', rawContent: '' };
  }
  try {
    const parsed = YAML.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, content: YAML.stringify(ensureClashMiniControlFields(parsed)), rawContent: text };
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
        return { ok: true, content: YAML.stringify(ensureClashMiniControlFields(parsed)), rawContent: decodedBase64 };
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

  if (typeof text === 'string') {
    const decodedBase64 = tryDecodeBase64Text(text);
    if (decodedBase64) {
      const converted = buildClashRuntimeConfigFromSubscription(decodedBase64);
      if (converted) {
        return {
          ok: true,
          content: YAML.stringify(converted),
          rawContent: decodedBase64,
        };
      }
    }
  }

  return { ok: false, error: 'Clash 配置解析失败', rawContent: text };
}

// 处理：importDirectClashRuntimeConfig的具体业务逻辑。
function importDirectClashRuntimeConfig(coreDir, payload, sourceLabel = 'server-config') {
  const rawContent = extractDirectClashConfigContent(payload);
  const normalized = normalizeDirectClashRuntimeConfig(rawContent);
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
    console.log('[IPC] Clash 运行配置生成预览:', generatedPreview);
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

let clashNeedRestore = false;
let clashStartedByApp = false;
let clashMiniProcess = null;
let clashMiniPid = null;
let clashMiniCoreDir = null;
let clashMiniExePath = null;
let clashMiniConfigPath = null;
let clashMiniProxyAppliedByApp = false;
let runtimeLicenseCache = null;

// 设置/更新/持久化：setRuntimeLicenseCache的具体业务逻辑。
function setRuntimeLicenseCache(next) {
  runtimeLicenseCache = next || null;
}

// 处理：isClashMiniProcessRunning的具体业务逻辑。
function isClashMiniProcessRunning() {
  return !!(clashMiniProcess && clashMiniProcess.exitCode == null && !clashMiniProcess.killed);
}

// 获取/读取/解析：getClashMiniStatus的具体业务逻辑。
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
    systemProxyEnabled: false,
    preferredEnabled: false,
  };
}

// 处理：emitClashMiniLog的具体业务逻辑。
function emitClashMiniLog(ui, level, message, extra = {}) {
  const text = String(message || '').trim();
  const prefix = '[Clash Mini]';
  const entry = {
    level,
    text,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  try {
    if (level === 'error') {
      console.error(prefix, text, extra);
    } else if (level === 'warn') {
      console.warn(prefix, text, extra);
    } else {
      console.log(prefix, text, extra);
    }
  } catch (_) {}

  try {
    ui?.sendToSide?.('clash-mini-log', entry);
  } catch (_) {}
  try {
    ui?.sendToSide?.('clash-mini-status', getClashMiniStatus());
  } catch (_) {}
  return entry;
}

// 处理：detectNetworkMagicStatus的具体业务逻辑。
async function detectNetworkMagicStatus() {
  const runtimeConfig = runtimeLicenseCache && typeof runtimeLicenseCache.getRuntimeConfig === 'function'
    ? runtimeLicenseCache.getRuntimeConfig()
    : {};
  const fallbackEnabled = runtimeConfig.systemProxyEnabled !== false;
  return {
    ok: true,
    enabled: fallbackEnabled,
    source: 'runtime',
    externalClashRunning: false,
    clashMiniRunning: isClashMiniProcessRunning(),
    runningClashClient: isClashMiniProcessRunning(),
    anyClashProcessRunning: isClashMiniProcessRunning(),
    appManagedClashRunning: isClashMiniProcessRunning(),
    matchedProcesses: [],
    systemProxyEnabled: fallbackEnabled,
    networkReachable: false,
    probe: null,
    profile: null,
    detectedEnabled: fallbackEnabled,
  };
}

// 启动/打开/显示：startClashMiniProcess的具体业务逻辑。
async function startClashMiniProcess(ui, options = {}) {
  if (isClashMiniProcessRunning()) {
    let browserProxySyncResult = null;
    if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
      browserProxySyncResult = await Promise.resolve(ui.applyClashMiniBrowserProxy(true)).catch(() => null);
    }
    clashMiniProxyAppliedByApp = browserProxySyncResult && browserProxySyncResult.ok === true;
    const browserProxyMessage = browserProxySyncResult && browserProxySyncResult.ok === true
      ? `，浏览器代理已同步${Number.isFinite(Number(browserProxySyncResult.updated)) ? `(${Number(browserProxySyncResult.updated)} 个标签页)` : ''}`
      : '';
    emitClashMiniLog(ui, 'info', `Clash Mini 已重新运行${browserProxyMessage}`);
    return { ok: true, alreadyRunning: true, ...getClashMiniStatus() };
  }

  const runtimePrep = prepareClashMiniRuntimeDir();
  if (!runtimePrep.ok) {
    emitClashMiniLog(ui, 'error', runtimePrep.error || '准备 Clash Mini 运行目录失败');
    return { ok: false, error: runtimePrep.error || '准备 Clash Mini 运行目录失败' };
  }

  const configResult = ensureClashMiniRuntimeConfig(runtimePrep.runtimeDir);
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

    let browserProxySyncResult = null;
    if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
      browserProxySyncResult = await Promise.resolve(ui.applyClashMiniBrowserProxy(true)).catch(() => null);
    }
    clashMiniProxyAppliedByApp = browserProxySyncResult && browserProxySyncResult.ok === true;
    const browserProxyMessage = browserProxySyncResult && browserProxySyncResult.ok === true
      ? `，浏览器代理已同步${Number.isFinite(Number(browserProxySyncResult.updated)) ? `(${Number(browserProxySyncResult.updated)} 个标签页)` : ''}`
      : '';

    clashMiniProcess.on('close', (code, signal) => {
      clashMiniProcess = null;
      clashMiniPid = null;
      clashMiniCoreDir = null;
      clashMiniExePath = null;
      clashMiniConfigPath = null;
      clashStartedByApp = false;
      clashMiniProxyAppliedByApp = false;
      if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
        Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
      }
      emitClashMiniLog(ui, code === 0 ? 'info' : 'warn', `Clash Mini 进程已退出，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
    });

    clashMiniProcess.on('error', (error) => {
      clashMiniProcess = null;
      clashMiniPid = null;
      clashMiniCoreDir = null;
      clashMiniExePath = null;
      clashMiniConfigPath = null;
      clashStartedByApp = false;
      clashMiniProxyAppliedByApp = false;
      if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
        Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
      }
      emitClashMiniLog(ui, 'error', `Clash Mini 启动失败: ${error?.message || error}`);
    });

    const status = getClashMiniStatus();
    emitClashMiniLog(ui, 'info', `Clash Mini 已启动，PID: ${clashMiniPid || 'unknown'}${browserProxyMessage || '，浏览器代理已切换到本地混合端口'}`);
    return { ok: true, started: true, ...status };
  } catch (error) {
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

// 停止/关闭/清理：stopClashMiniProcess的具体业务逻辑。
async function stopClashMiniProcess(ui) {
  if (!isClashMiniProcessRunning()) {
    if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
      await Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
    }
    return { ok: true, stopped: false, ...getClashMiniStatus() };
  }

  const pid = clashMiniPid;
  const processRef = clashMiniProcess;
  emitClashMiniLog(ui, 'info', `正在停止 Clash Mini，PID: ${pid || 'unknown'}`);
  try {
    if (processRef && typeof processRef.kill === 'function') {
      processRef.kill();
    }
  } catch (error) {
    emitClashMiniLog(ui, 'warn', `直接结束进程失败: ${error?.message || error}`);
  }

  if (process.platform === 'win32' && pid) {
    setTimeout(() => {
      try {
        if (processRef && processRef.exitCode == null && !processRef.killed) {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        }
      } catch (_) {}
    }, 800);
  }

  clashMiniProcess = null;
  clashMiniPid = null;
  clashMiniCoreDir = null;
  clashMiniExePath = null;
  clashMiniConfigPath = null;
  clashStartedByApp = false;
  if (ui && typeof ui.applyClashMiniBrowserProxy === 'function') {
    await Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => {});
  }
  clashMiniProxyAppliedByApp = false;
  if (runtimeLicenseCache && typeof runtimeLicenseCache.setRuntimeConfig === 'function') {
    runtimeLicenseCache.setRuntimeConfig({ systemProxyEnabled: false });
  }
  emitClashMiniLog(ui, 'info', 'Clash Mini 已停止');
  return { ok: true, stopped: true, ...getClashMiniStatus() };
}

// 停止/关闭/清理：cleanupClashMiniRuntimeConfig的具体业务逻辑。
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
  detectNetworkMagicStatus,
  emitClashMiniLog,
  extractDirectClashConfigContent,
  fetchClashMiniProxyNames,
  formatClashMiniDelayText,
  getClashMiniManualGroupName,
  getClashMiniProxyEndpoint,
  getClashMiniRuntimeRoot,
  getClashMiniStatus,
  importDirectClashRuntimeConfig,
  invokeClashMiniControl,
  normalizeProbeTimeout,
  normalizeProbeUrl,
  probeClashMiniProxyDelay,
  prepareClashMiniRuntimeDir,
  readClashProbeSettings,
  resolveClashMiniCoreDir,
  setRuntimeLicenseCache,
  cleanupClashMiniRuntimeConfig,
  startClashMiniProcess,
  stopClashMiniProcess,
  waitForClashMiniControlApi,
};
