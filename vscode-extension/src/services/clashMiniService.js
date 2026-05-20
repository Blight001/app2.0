const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');
const httpClient = require('./httpClient');
const { normalizeDirectClashRuntimeConfig } = require('./clashConfig');

const CLASH_MINI_DIR_NAME = 'clash-mini';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readYamlIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function looksLikeRuntimeClashConfig(value) {
  const parsed = typeof value === 'string' ? YAML.parse(value) : value;
  return !!(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (
    Array.isArray(parsed.proxies)
    || Array.isArray(parsed['proxy-groups'])
    || Array.isArray(parsed.rules)
    || parsed['mixed-port'] !== undefined
    || parsed.port !== undefined
    || parsed['external-controller'] !== undefined
  ));
}

function copyDirectoryRecursive(src, dest, { overwrite = false } = {}) {
  if (!src || !dest || !fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath, { overwrite });
      continue;
    }
    if (!overwrite && fs.existsSync(destPath)) continue;
    fs.copyFileSync(srcPath, destPath);
  }
  return true;
}

function normalizeProbeTimeout(value, fallbackMs = 5000) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.max(200, Math.round(num)) : fallbackMs;
}

function normalizeProbeUrl(value, fallbackUrl = 'http://www.gstatic.com/generate_204') {
  const text = String(value || '').trim();
  if (!text) return fallbackUrl;
  try {
    return new URL(text).toString();
  } catch (_) {
    return fallbackUrl;
  }
}

function formatDelayText(delay) {
  const value = Number(delay);
  if (!Number.isFinite(value) || value <= 0) return '超时';
  return `${Math.round(value)}ms`;
}

function extractDelayValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
  }
  if (value && typeof value === 'object') {
    if (typeof value.delay === 'number') return value.delay;
    if (typeof value.latency === 'number') return value.latency;
    if (value.history) return extractDelayValue(value.history);
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
    }
  };
  walk(input);
  return out;
}

function requestJson(url, { method = 'GET', data = null, headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = data == null ? null : JSON.stringify(data);
    const req = http.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        ...headers,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = text;
        try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = payload && typeof payload === 'object'
            ? (payload.error || payload.message || `控制接口请求失败 (${res.statusCode})`)
            : `控制接口请求失败 (${res.statusCode})`;
          reject(new Error(String(message)));
          return;
        }
        resolve(payload);
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

class ClashMiniService {
  constructor(context, deps = {}) {
    this.context = context;
    this.logService = deps.logService || null;
    this.proxyController = deps.proxyController || null;
    this.processRef = null;
    this.pid = null;
    this.coreDir = '';
    this.exePath = '';
    this.configPath = '';
    this.proxyAppliedByApp = false;
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  emit(channel, payload) {
    for (const listener of this.listeners) {
      try { listener(channel, payload); } catch (_) {}
    }
  }

  log(level, text, extra = {}) {
    const entry = {
      level,
      text: String(text || ''),
      timestamp: new Date().toISOString(),
      ...extra,
    };
    this.emit('clash-mini-log', entry);
    this.emit('clash-mini-status', this.getStatus());
    try {
      this.logService?.add?.(level, text, { source: 'clash-mini', ...extra });
    } catch (_) {}
    return entry;
  }

  resolveBundledCoreDir() {
    const extensionRoot = this.context.extensionPath;
    const repoRoot = path.resolve(extensionRoot, '..');
    const candidates = [
      path.join(repoRoot, 'src', 'assets', 'extensions', CLASH_MINI_DIR_NAME, 'core'),
      path.join(extensionRoot, 'resources', CLASH_MINI_DIR_NAME, 'core'),
    ];
    return candidates.find((candidate) => (
      fs.existsSync(path.join(candidate, 'verge-mihomo.exe'))
      || fs.existsSync(path.join(candidate, 'config.yaml'))
      || fs.existsSync(path.join(candidate, 'self.yaml'))
    )) || candidates[0];
  }

  getRuntimeRoot() {
    return path.join(this.context.globalStorageUri.fsPath, CLASH_MINI_DIR_NAME);
  }

  prepareRuntimeDir() {
    const sourceDir = this.resolveBundledCoreDir();
    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return { ok: false, error: `未找到 Clash Mini 源目录: ${sourceDir || 'unknown'}` };
    }
    const runtimeDir = this.getRuntimeRoot();
    fs.mkdirSync(runtimeDir, { recursive: true });
    if (path.resolve(runtimeDir) !== path.resolve(sourceDir)) {
      copyDirectoryRecursive(sourceDir, runtimeDir, { overwrite: false });
    }
    const exePath = path.join(runtimeDir, 'verge-mihomo.exe');
    if (!fs.existsSync(exePath)) {
      return { ok: false, error: 'Clash Mini 运行目录中未找到 verge-mihomo.exe' };
    }
    return { ok: true, sourceDir, runtimeDir, exePath };
  }

  ensureRuntimeConfig(coreDir) {
    const runtimeConfigPath = path.join(coreDir, 'config.yaml');
    const legacyConfigPath = path.join(coreDir, 'self.yaml');
    const profilesIndexPath = path.join(coreDir, 'profiles.yaml');
    const runtimeConfig = readYamlIfExists(runtimeConfigPath);
    if (looksLikeRuntimeClashConfig(runtimeConfig)) {
      return { ok: true, configPath: runtimeConfigPath };
    }
    const legacyConfig = readYamlIfExists(legacyConfigPath);
    if (looksLikeRuntimeClashConfig(legacyConfig)) {
      fs.writeFileSync(runtimeConfigPath, YAML.stringify(legacyConfig), 'utf8');
      return { ok: true, configPath: runtimeConfigPath };
    }
    const profilesConfig = readYamlIfExists(profilesIndexPath);
    if (looksLikeRuntimeClashConfig(profilesConfig)) {
      fs.writeFileSync(runtimeConfigPath, YAML.stringify(profilesConfig), 'utf8');
      return { ok: true, configPath: runtimeConfigPath };
    }
    return { ok: false, error: '未找到可启动的 Clash 运行配置，请先验证卡密后开启网络魔法以从服务器获取配置', configPath: runtimeConfigPath };
  }

  getProxyEndpoint(coreDir) {
    const config = readYamlIfExists(path.join(coreDir, 'config.yaml')) || readYamlIfExists(path.join(coreDir, 'self.yaml')) || {};
    const mixedPort = Number(config['mixed-port'] || config.mixed_port);
    const httpPort = Number(config.port || config.http_port);
    const socksPort = Number(config['socks-port'] || config.socks_port);
    const port = [mixedPort, httpPort, socksPort, 7890].find((n) => Number.isFinite(n) && n > 0) || 7890;
    return { host: '127.0.0.1', port };
  }

  getControlEndpoint(coreDir) {
    const config = readYamlIfExists(path.join(coreDir, 'config.yaml')) || readYamlIfExists(path.join(coreDir, 'self.yaml')) || {};
    const raw = String(config['external-controller'] || config.external_controller || '').trim();
    const [hostPart, portPart] = raw.split(':');
    const port = Number(portPart);
    return {
      host: hostPart || '127.0.0.1',
      port: Number.isFinite(port) && port > 0 ? port : 9090,
    };
  }

  getControlHeaders(coreDir) {
    const config = readYamlIfExists(path.join(coreDir, 'config.yaml')) || readYamlIfExists(path.join(coreDir, 'self.yaml')) || {};
    const secret = String(config.secret || config['control-secret'] || '').trim();
    return secret ? { Authorization: `Bearer ${secret}` } : {};
  }

  buildControlUrl(coreDir, pathname) {
    const endpoint = this.getControlEndpoint(coreDir);
    const cleanPath = String(pathname || '').startsWith('/') ? String(pathname || '') : `/${String(pathname || '')}`;
    return `http://${endpoint.host}:${endpoint.port}${cleanPath}`;
  }

  async invokeControl(coreDir, method, pathname, { data = null, timeoutMs = 30000 } = {}) {
    return requestJson(this.buildControlUrl(coreDir, pathname), {
      method,
      data,
      timeoutMs,
      headers: this.getControlHeaders(coreDir),
    });
  }

  async waitForControlApi(coreDir, timeoutMs = 15000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
    while (Date.now() < deadline) {
      for (const probePath of ['/version', '/proxies', '/configs']) {
        try {
          await this.invokeControl(coreDir, 'GET', probePath, { timeoutMs: 2000 });
          return true;
        } catch (_) {}
      }
      await sleep(300);
    }
    return false;
  }

  isRunning() {
    return !!(this.processRef && this.processRef.exitCode == null && !this.processRef.killed);
  }

  getStatus() {
    const running = this.isRunning();
    return {
      ok: true,
      running,
      enabled: running && this.proxyAppliedByApp,
      pid: this.pid || null,
      coreDir: this.coreDir || '',
      exePath: this.exePath || '',
      configPath: this.configPath || '',
      startedByApp: running,
      proxyAppliedByApp: this.proxyAppliedByApp,
      systemProxyEnabled: false,
      preferredEnabled: false,
    };
  }

  // 开启/关闭 VS Code 全局 http.proxy，使内置浏览器走本地混合端口
  async applyBrowserProxy(enable) {
    if (!this.proxyController) return { ok: false, error: 'proxyController 不可用' };
    if (enable) {
      const coreDir = this.coreDir || this.getRuntimeRoot();
      const { port } = this.getProxyEndpoint(coreDir);
      const result = await this.proxyController.enable(port);
      this.proxyAppliedByApp = result.ok === true;
      return result;
    }
    const result = await this.proxyController.disable();
    this.proxyAppliedByApp = false;
    return result;
  }

  async start(params = {}) {
    if (this.isRunning()) {
      await this.applyBrowserProxy(true).catch(() => {});
      this.log('info', 'Clash Mini 已在运行，已确保 VS Code 走本地代理端口');
      return { ok: true, alreadyRunning: true, ...this.getStatus() };
    }

    const prep = this.prepareRuntimeDir();
    if (!prep.ok) {
      this.log('error', prep.error || '准备 Clash Mini 运行目录失败');
      return prep;
    }

    // 优先从服务器获取配置；失败时若已有本地 config.yaml 则降级使用
    if (params.key && params.serverBase) {
      const applied = await this.fetchAndApplyConfig(params);
      if (!applied.ok) {
        const fallback = this.ensureRuntimeConfig(prep.runtimeDir);
        if (!fallback.ok) {
          this.log('error', applied.error || '从服务器获取 Clash 配置失败');
          return applied;
        }
        this.log('warn', `${applied.error}；改用已存在的本地配置`);
      }
    }

    const configResult = this.ensureRuntimeConfig(prep.runtimeDir);
    if (!configResult.ok) {
      this.log('error', configResult.error);
      return configResult;
    }

    this.coreDir = prep.runtimeDir;
    this.exePath = prep.exePath;
    this.configPath = configResult.configPath;
    this.log('info', `启动命令: ${path.basename(prep.exePath)} -d ${prep.runtimeDir}`);

    const child = spawn(prep.exePath, ['-d', prep.runtimeDir], {
      cwd: prep.runtimeDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.processRef = child;
    this.pid = child.pid || null;

    child.stdout?.on('data', (data) => {
      const text = String(data || '').trim();
      if (text) this.log('info', text, { stream: 'stdout' });
    });
    child.stderr?.on('data', (data) => {
      const text = String(data || '').trim();
      if (text) this.log('warn', text, { stream: 'stderr' });
    });
    child.on('close', (code, signal) => {
      this.processRef = null;
      this.pid = null;
      this.applyBrowserProxy(false).catch(() => {});
      this.log(code === 0 ? 'info' : 'warn', `Clash Mini 进程已退出，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
    });
    child.on('error', (error) => {
      this.processRef = null;
      this.pid = null;
      this.applyBrowserProxy(false).catch(() => {});
      this.log('error', `Clash Mini 启动失败: ${error?.message || error}`);
    });

    const proxyResult = await this.applyBrowserProxy(true).catch(() => ({ ok: false }));
    const proxyNote = proxyResult.ok ? `，VS Code 已走本地代理 ${proxyResult.proxyUrl}` : '，但设置 VS Code 代理失败';
    this.log('info', `Clash Mini 已启动，PID: ${this.pid || 'unknown'}${proxyNote}`);
    return { ok: true, started: true, ...this.getStatus() };
  }

  async stop() {
    const child = this.processRef;
    if (!child || !this.isRunning()) {
      await this.applyBrowserProxy(false).catch(() => {});
      return { ok: true, stopped: false, ...this.getStatus() };
    }
    const pid = this.pid;
    this.log('info', `正在停止 Clash Mini，PID: ${pid || 'unknown'}`);
    try { child.kill(); } catch (_) {}
    if (process.platform === 'win32' && pid) {
      setTimeout(() => {
        try {
          if (child.exitCode == null && !child.killed) {
            spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          }
        } catch (_) {}
      }, 800);
    }
    this.processRef = null;
    this.pid = null;
    await this.applyBrowserProxy(false).catch(() => {});
    this.log('info', 'Clash Mini 已停止，已还原 VS Code 代理设置');
    return { ok: true, stopped: true, ...this.getStatus() };
  }

  getManualGroupName(coreDir) {
    const config = readYamlIfExists(path.join(coreDir, 'config.yaml')) || readYamlIfExists(path.join(coreDir, 'self.yaml')) || {};
    const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
    const manualGroup = groups.find((group) => group && group.type === 'select' && group.name);
    return manualGroup?.name || groups[0]?.name || '节点选择';
  }

  getConfigProxyNames(coreDir, groupName) {
    const config = readYamlIfExists(path.join(coreDir, 'config.yaml')) || readYamlIfExists(path.join(coreDir, 'self.yaml')) || {};
    const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
    const group = groups.find((item) => String(item?.name || '').trim() === String(groupName || '').trim())
      || groups.find((item) => item && item.type === 'select')
      || groups[0]
      || null;
    const fromGroup = Array.isArray(group?.proxies) ? group.proxies : [];
    const fromProxies = Array.isArray(config.proxies)
      ? config.proxies.map((item) => String(item?.name || '').trim()).filter(Boolean)
      : [];
    return Array.from(new Set([...fromGroup, ...fromProxies].map((item) => String(item || '').trim()).filter(Boolean)));
  }

  async fetchProxyNames(coreDir, groupName) {
    let response = null;
    try {
      response = await this.invokeControl(coreDir, 'GET', `/proxies/${encodeURIComponent(groupName)}`, { timeoutMs: 15000 });
    } catch (_) {}
    const apiNames = normalizeProxyNameList(response?.all || response?.proxies || response);
    const configNames = this.getConfigProxyNames(coreDir, groupName);
    return {
      raw: response,
      names: Array.from(new Set([...apiNames, ...configNames])),
      current: String(response?.now || response?.name || '').trim(),
    };
  }

  async probeDelay(coreDir, proxyName, testUrl, timeout) {
    const response = await this.invokeControl(
      coreDir,
      'GET',
      `/proxies/${encodeURIComponent(proxyName)}/delay?timeout=${encodeURIComponent(timeout)}&url=${encodeURIComponent(testUrl)}`,
      { timeoutMs: Math.max(Number(timeout) || 5000, 8000) },
    );
    return extractDelayValue(response);
  }

  async getProxyOptions(options = {}) {
    if (!this.isRunning()) {
      return { ok: false, error: 'Clash Mini 未运行', running: false, groupName: '节点选择', names: [], current: '' };
    }
    const coreDir = this.coreDir || this.getRuntimeRoot();
    const groupName = String(options.groupName || this.getManualGroupName(coreDir)).trim() || '节点选择';
    const ready = await this.waitForControlApi(coreDir, 15000);
    if (!ready) {
      return { ok: false, error: 'Clash Mini 控制接口未就绪', running: true, groupName, names: [], current: '' };
    }
    const groupInfo = await this.fetchProxyNames(coreDir, groupName);
    const names = Array.from(new Set((Array.isArray(options.names) && options.names.length > 0 ? options.names : groupInfo.names)
      .map((item) => String(item || '').trim())
      .filter(Boolean)));
    const includeDelays = options.includeDelays !== false;
    const latencyUrl = normalizeProbeUrl(options.url);
    const timeout = normalizeProbeTimeout(options.timeout);
    const proxies = [];
    for (const name of names) {
      if (!includeDelays) {
        proxies.push({ name, delay: null, delayText: '测速中...', ok: false, selected: name === groupInfo.current });
        continue;
      }
      try {
        const delay = await this.probeDelay(coreDir, name, latencyUrl, timeout);
        proxies.push({ name, delay, delayText: formatDelayText(delay), ok: Number.isFinite(Number(delay)) && Number(delay) > 0, selected: name === groupInfo.current });
      } catch (error) {
        proxies.push({ name, delay: null, delayText: '超时', ok: false, error: error?.message || String(error), selected: name === groupInfo.current });
      }
    }
    return { ok: true, running: true, groupName, current: groupInfo.current, names, url: latencyUrl, timeout, proxies };
  }

  async testMinLatency(options = {}) {
    if (!this.isRunning()) {
      const started = await this.start();
      if (!started.ok) return started;
    }
    const coreDir = this.coreDir || this.getRuntimeRoot();
    const groupName = String(options.groupName || this.getManualGroupName(coreDir)).trim() || '节点选择';
    const latencyUrl = normalizeProbeUrl(options.url);
    const timeout = normalizeProbeTimeout(options.timeout);
    const ready = await this.waitForControlApi(coreDir, 15000);
    if (!ready) return { ok: false, error: 'Clash Mini 控制接口未就绪' };
    const groupInfo = await this.fetchProxyNames(coreDir, groupName);
    const names = Array.from(new Set((Array.isArray(options.names) && options.names.length > 0 ? options.names : groupInfo.names)
      .map((item) => String(item || '').trim())
      .filter(Boolean)));
    if (!names.length) return { ok: false, error: `分组 ${groupName} 中没有可测试的节点` };

    const entries = [];
    let best = null;
    this.emit('clash-mini-latency-progress', { phase: 'start', groupName, total: names.length, url: latencyUrl, timeout });
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      try {
        const delay = await this.probeDelay(coreDir, name, latencyUrl, timeout);
        const entry = { name, delay: Number.isFinite(Number(delay)) ? Number(delay) : null, delayText: formatDelayText(delay) };
        entries.push(entry);
        if (entry.delay != null && entry.delay > 0 && (!best || entry.delay < best.delay)) {
          best = { name, delay: entry.delay };
        }
        this.emit('clash-mini-latency-progress', { phase: 'probe', groupName, index, completed: index + 1, name, delay: entry.delay, bestName: best?.name || '', bestDelay: best?.delay || null });
      } catch (error) {
        entries.push({ name, delay: null, delayText: '超时', error: error?.message || String(error) });
        this.emit('clash-mini-latency-progress', { phase: 'probe', groupName, index, completed: index + 1, name, delay: null, error: error?.message || String(error), bestName: best?.name || '', bestDelay: best?.delay || null });
      }
    }
    if (!best) {
      this.emit('clash-mini-latency-progress', { phase: 'done', groupName, entries, bestName: '', bestDelay: null });
      return { ok: false, error: '未找到可用的最低延时节点', entries, groupName, url: latencyUrl, timeout };
    }
    await this.invokeControl(coreDir, 'PUT', `/proxies/${encodeURIComponent(groupName)}`, { data: { name: best.name }, timeoutMs: 10000 });
    this.log('info', `最低延时节点已选中: ${best.name} (${best.delay}ms)`);
    this.emit('clash-mini-latency-progress', { phase: 'done', groupName, entries, bestName: best.name, bestDelay: best.delay });
    return { ok: true, running: true, entries, groupName, url: latencyUrl, timeout, best, bestName: best.name, bestDelay: best.delay };
  }

  async switchProxy(options = {}) {
    if (!this.isRunning()) return { ok: false, error: 'Clash Mini 未运行', running: false };
    const coreDir = this.coreDir || this.getRuntimeRoot();
    const groupName = String(options.groupName || this.getManualGroupName(coreDir)).trim() || '节点选择';
    const nodeName = String(options.nodeName || options.name || '').trim();
    if (!nodeName) return { ok: false, error: '未提供要切换的节点名称' };
    const ready = await this.waitForControlApi(coreDir, 15000);
    if (!ready) return { ok: false, error: 'Clash Mini 控制接口未就绪' };
    await this.invokeControl(coreDir, 'PUT', `/proxies/${encodeURIComponent(groupName)}`, { data: { name: nodeName }, timeoutMs: 10000 });
    this.log('info', `节点已切换: ${groupName} -> ${nodeName}`);
    return { ok: true, running: true, groupName, current: nodeName, name: nodeName };
  }

  // 把服务器返回的配置（直配 YAML / base64 / vmess 订阅）规范化后写入 config.yaml
  applyServerConfig(rawContent) {
    const prep = this.prepareRuntimeDir();
    if (!prep.ok) return prep;
    const normalized = normalizeDirectClashRuntimeConfig(rawContent);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error || 'Clash 配置解析失败' };
    }
    const configPath = path.join(prep.runtimeDir, 'config.yaml');
    // 写入前清理旧的运行配置，避免残留
    for (const stale of ['config.yaml', 'self.yaml', 'profiles.yaml']) {
      try { fs.rmSync(path.join(prep.runtimeDir, stale), { force: true }); } catch (_) {}
    }
    fs.writeFileSync(configPath, normalized.content, 'utf8');
    this.configPath = configPath;
    this.log('info', `已从服务器配置生成 Clash 运行配置：${configPath}`);
    return { ok: true, configPath };
  }

  // 从客户端 HTTP 服务获取 Clash 配置：直配内容优先，空则回退到订阅链接拉取
  async fetchAndApplyConfig({ key, deviceId, serverBase } = {}) {
    if (!serverBase) return { ok: false, error: '缺少服务器地址，无法获取 Clash 配置' };
    if (!key) return { ok: false, error: '缺少卡密，无法获取 Clash 配置' };
    this.log('info', '正在从服务器获取 Clash 配置...');
    let config;
    try {
      config = await httpClient.getClientConfig(serverBase, { key, deviceId });
    } catch (error) {
      return { ok: false, error: `获取 Clash 配置失败: ${error?.message || error}` };
    }
    let content = String(config.content || '').trim();
    if (!content && config.proxySubscriptionUrl) {
      try {
        this.log('info', `直配内容为空，尝试订阅链接：${config.proxySubscriptionUrl}`);
        content = await httpClient.fetchSubscriptionContent(config.proxySubscriptionUrl, serverBase);
      } catch (error) {
        return { ok: false, error: `订阅链接获取失败: ${error?.message || error}` };
      }
    }
    if (!content) {
      return { ok: false, error: '服务器未返回可用的 Clash 配置' };
    }
    return this.applyServerConfig(content);
  }

  // 重新从服务器拉取线路配置；若正在运行则重启以应用新配置
  async refresh(params = {}) {
    const applied = await this.fetchAndApplyConfig(params);
    if (!applied.ok) return applied;
    if (this.isRunning()) {
      this.log('info', '线路配置已更新，正在重启 Clash Mini...');
      await this.stop();
      return this.start(params);
    }
    this.log('info', '线路配置已更新（Clash Mini 未运行）');
    return { ok: true, refreshed: true, configPath: applied.configPath, ...this.getStatus() };
  }

  dispose() {
    void this.stop();
  }
}

module.exports = {
  ClashMiniService,
};
