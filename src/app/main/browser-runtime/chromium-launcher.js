const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SESSION_FILE_PATTERN = /^(Session|Tabs)_(\d+)$/;

const FORBIDDEN_SWITCHES = new Set([
  '--no-sandbox',
  '--single-process',
  '--disable-web-security',
  '--disable-site-isolation-trials',
  '--allow-running-insecure-content',
]);

const GOOGLE_CREDENTIAL_ENV_MAP = Object.freeze({
  AI_FREE_GOOGLE_API_KEY: 'GOOGLE_API_KEY',
  AI_FREE_GOOGLE_CLIENT_ID: 'GOOGLE_DEFAULT_CLIENT_ID',
  AI_FREE_GOOGLE_CLIENT_SECRET: 'GOOGLE_DEFAULT_CLIENT_SECRET',
});

function buildChromiumEnvironment(baseEnv = process.env, overrides = {}) {
  const environment = { ...baseEnv, ...overrides };
  for (const [aiFreeName, chromiumName] of Object.entries(GOOGLE_CREDENTIAL_ENV_MAP)) {
    const chromiumValue = String(environment[chromiumName] || '').trim();
    const aiFreeValue = String(environment[aiFreeName] || '').trim();
    if (!chromiumValue && aiFreeValue) environment[chromiumName] = aiFreeValue;
  }
  return environment;
}

function normalizeExecutableCandidate(value) {
  const candidate = String(value || '').trim().replace(/^"|"$/g, '');
  return candidate ? path.resolve(candidate) : '';
}

function getSystemChromiumCandidates(env = process.env) {
  const programFiles = String(env.ProgramFiles || '').trim();
  const programFilesX86 = String(env['ProgramFiles(x86)'] || '').trim();
  const localAppData = String(env.LOCALAPPDATA || '').trim();
  const joinIfRoot = (root, ...parts) => root ? path.join(root, ...parts) : '';
  return [
    joinIfRoot(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    joinIfRoot(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    joinIfRoot(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    joinIfRoot(programFiles, 'Chromium', 'Application', 'chrome.exe'),
    joinIfRoot(programFilesX86, 'Chromium', 'Application', 'chrome.exe'),
    joinIfRoot(localAppData, 'Chromium', 'Application', 'chrome.exe'),
    joinIfRoot(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    joinIfRoot(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
}

function resolveChromiumExecutable(options = {}) {
  const explicitResourcesPath = String(options.resourcesPath || '').trim();
  const resourcesPath = explicitResourcesPath || process.resourcesPath || '';
  const profile = options.profile || {};
  const prototypeMode = String(process.env.AI_FREE_CHROMIUM_HANDSHAKE || '').trim().toLowerCase() === 'prototype';
  const formalCandidates = [
    resourcesPath && path.join(resourcesPath, 'chromium', 'ai-free-browser.exe'),
    !explicitResourcesPath && (!process.resourcesPath || process.resourcesPath === resourcesPath)
      ? path.join(process.cwd(), 'resources', 'chromium', 'ai-free-browser.exe')
      : '',
  ];
  const candidates = [
    ...formalCandidates,
    ...(prototypeMode ? [
      resourcesPath && path.join(resourcesPath, 'chromium', 'chrome.exe'),
      options.executablePath,
      process.env.AI_FREE_CHROMIUM_PATH,
      ...getSystemChromiumCandidates(),
    ] : []),
  ].map(normalizeExecutableCandidate).filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  const error = new Error(prototypeMode
    ? '未找到可用于原型验证的 Chromium/Chrome/Edge'
    : '未找到打包的 AI-FREE Chromium Fork：resources/chromium/ai-free-browser.exe（正式模式禁止使用系统 Chrome 或外部路径）');
  error.code = 'CHROMIUM_EXECUTABLE_NOT_FOUND';
  error.candidates = candidates;
  throw error;
}

function assertSafeChromiumArgs(args = []) {
  for (const rawArg of args) {
    const arg = String(rawArg || '').trim().toLowerCase();
    const switchName = arg.split('=')[0];
    if (FORBIDDEN_SWITCHES.has(switchName)) {
      const error = new Error(`禁止使用不安全的 Chromium 参数: ${switchName}`);
      error.code = 'FORBIDDEN_CHROMIUM_SWITCH';
      throw error;
    }
    if (switchName === '--remote-debugging-address' && !/=(127\.0\.0\.1|localhost|::1)$/.test(arg)) {
      const error = new Error('Chromium 调试地址只能绑定回环接口');
      error.code = 'UNSAFE_DEBUG_ADDRESS';
      throw error;
    }
  }
}

function applyChromiumSessionStartupPolicy(paths = {}, logger = console, profile = {}) {
  const userDataDir = String(paths.chromiumData || '').trim();
  if (!userDataDir) return false;
  const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
  let preferences = {};
  try {
    if (fs.existsSync(preferencesPath)) {
      preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8') || '{}');
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
    }
  } catch (error) {
    logger?.warn?.('[ChromiumRuntime] Preferences 无法解析，保留原文件并跳过会话启动策略:', error?.message || error);
    return false;
  }

  preferences.session = preferences.session && typeof preferences.session === 'object'
    ? preferences.session
    : {};
  // 与本次启动意图保持一致。旧逻辑无条件写 5（新标签页），同时又传
  // --restore-last-session，两套策略相互冲突，可能最终得到空白页。
  preferences.session.restore_on_startup = profile.restoreLastSession === true ? 1 : 5;
  preferences.session.startup_urls = [];
  preferences.profile = preferences.profile && typeof preferences.profile === 'object'
    ? preferences.profile
    : {};
  preferences.profile.exit_type = 'Normal';
  preferences.profile.exited_cleanly = true;
  const acceptedLanguages = String(profile.acceptLanguage || profile.locale || '')
    .split(',')
    .map((item) => item.split(';')[0].trim())
    .filter(Boolean)
    .join(',');
  if (acceptedLanguages) {
    preferences.intl = preferences.intl && typeof preferences.intl === 'object'
      ? preferences.intl
      : {};
    preferences.intl.accept_languages = acceptedLanguages;
    preferences.intl.selected_languages = acceptedLanguages;
  }

  try {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    fs.writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf8');
    return true;
  } catch (error) {
    logger?.warn?.('[ChromiumRuntime] 写入单页启动策略失败:', error?.message || error);
    return false;
  }
}

function getChromiumSessionsDir(paths = {}) {
  return path.join(String(paths.chromiumData || ''), 'Default', 'Sessions');
}

function sessionFileTimestamp(name) {
  const match = SESSION_FILE_PATTERN.exec(String(name || ''));
  try { return match ? BigInt(match[2]) : 0n; } catch (_) { return 0n; }
}

function containsRestorableWebUrl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  return buffer.includes(Buffer.from('https://', 'ascii'))
    || buffer.includes(Buffer.from('http://', 'ascii'))
    || buffer.includes(Buffer.from('https://', 'utf16le'))
    || buffer.includes(Buffer.from('http://', 'utf16le'));
}

// Chromium 150 的 Session 文件由 SNSS 头和一串 SessionCommand 组成：
// uint16 commandSize + uint8 commandId + payload。只搜索 URL 会把已经追加
// TabClosed(16) 的旧导航误判成可恢复页面，因此这里按 Chromium 的命令顺序
// 还原“当前仍属于窗口的标签”集合。
function analyzeChromiumSession(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 4).toString('ascii') !== 'SNSS') {
    return { valid: false, liveTabCount: 0, hasWebUrl: false };
  }
  const windows = new Set();
  const tabs = new Map();
  let offset = 8;
  let valid = true;
  while (offset + 3 <= buffer.length) {
    const commandSize = buffer.readUInt16LE(offset);
    const commandEnd = offset + 2 + commandSize;
    if (commandSize < 1 || commandEnd > buffer.length) {
      valid = false;
      break;
    }
    const commandId = buffer[offset + 2];
    const payloadOffset = offset + 3;
    const payloadSize = commandSize - 1;
    if (commandId === 9 && payloadSize >= 4) {
      windows.add(buffer.readInt32LE(payloadOffset)); // SetWindowType
    } else if (commandId === 0 && payloadSize >= 8) {
      const windowId = buffer.readInt32LE(payloadOffset);
      const tabId = buffer.readInt32LE(payloadOffset + 4);
      tabs.set(tabId, windowId); // SetTabWindow
    } else if (commandId === 16 && payloadSize >= 4) {
      tabs.delete(buffer.readInt32LE(payloadOffset)); // TabClosed
    } else if (commandId === 17 && payloadSize >= 4) {
      const windowId = buffer.readInt32LE(payloadOffset); // WindowClosed
      windows.delete(windowId);
      for (const [tabId, tabWindowId] of tabs) {
        if (tabWindowId === windowId) tabs.delete(tabId);
      }
    }
    offset = commandEnd;
  }
  const liveTabCount = Array.from(tabs.values()).filter((windowId) => windows.has(windowId)).length;
  return {
    valid,
    liveTabCount,
    hasWebUrl: containsRestorableWebUrl(buffer),
  };
}

function hasRestorableSessionBuffer(buffer) {
  const analysis = analyzeChromiumSession(buffer);
  return analysis.valid && analysis.liveTabCount > 0 && analysis.hasWebUrl;
}

function snapshotHasRestorableSession(snapshot) {
  return Boolean(snapshot?.files?.some((file) => (
    String(file?.name || '').startsWith('Session_')
    && hasRestorableSessionBuffer(file.data)
  )));
}

function getStableSessionDir(paths = {}) {
  return path.join(String(paths.root || path.dirname(paths.chromiumData || '')), 'session-recovery-stable');
}

function persistStableChromiumSession(paths = {}, snapshot, logger = console) {
  if (!snapshotHasRestorableSession(snapshot)) return false;
  const stableDir = getStableSessionDir(paths);
  const temporaryDir = `${stableDir}.tmp`;
  try {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
    fs.mkdirSync(temporaryDir, { recursive: true });
    for (const file of snapshot.files) {
      if (SESSION_FILE_PATTERN.test(String(file?.name || '')) && Buffer.isBuffer(file.data)) {
        fs.writeFileSync(path.join(temporaryDir, file.name), file.data);
      }
    }
    fs.rmSync(stableDir, { recursive: true, force: true });
    fs.renameSync(temporaryDir, stableDir);
    return true;
  } catch (error) {
    logger?.warn?.('[ChromiumRuntime] 保存稳定 Session 备份失败:', error?.message || error);
    try { fs.rmSync(temporaryDir, { recursive: true, force: true }); } catch (_) {}
    return false;
  }
}

function loadStableChromiumSession(paths = {}, logger = console) {
  const stableDir = getStableSessionDir(paths);
  try {
    const files = fs.readdirSync(stableDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SESSION_FILE_PATTERN.test(entry.name))
      .map((entry) => ({ name: entry.name, data: fs.readFileSync(path.join(stableDir, entry.name)) }));
    const snapshot = { sessionsDir: getChromiumSessionsDir(paths), files };
    return snapshotHasRestorableSession(snapshot) ? snapshot : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') logger?.warn?.('[ChromiumRuntime] 读取稳定 Session 备份失败:', error?.message || error);
    return null;
  }
}

// 旧版 close-browser 会先关闭最后一个窗口，再正常退出 Chromium，导致最新
// Session 被写成 0 窗口。若上一组 Session 仍包含网页，则隔离空白的最新组，
// 让 Chromium 自动回退读取上一组有效会话。
function repairBlankLatestSession(paths = {}, logger = console) {
  const sessionsDir = getChromiumSessionsDir(paths);
  let entries = [];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SESSION_FILE_PATTERN.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        path: path.join(sessionsDir, entry.name),
        type: entry.name.startsWith('Session_') ? 'Session' : 'Tabs',
        timestamp: sessionFileTimestamp(entry.name),
      }));
  } catch (_) {
    return { repaired: false, removed: [] };
  }

  const sessionEntries = entries.filter((entry) => entry.type === 'Session')
    .sort((left, right) => left.timestamp > right.timestamp ? -1 : 1);
  if (sessionEntries.length < 2) return { repaired: false, removed: [] };
  let latestBuffer = null;
  try { latestBuffer = fs.readFileSync(sessionEntries[0].path); } catch (_) { return { repaired: false, removed: [] }; }
  if (hasRestorableSessionBuffer(latestBuffer)) return { repaired: false, removed: [] };

  const previousValid = sessionEntries.slice(1).find((entry) => {
    try { return hasRestorableSessionBuffer(fs.readFileSync(entry.path)); } catch (_) { return false; }
  });
  if (!previousValid) return { repaired: false, removed: [] };

  const latestSession = sessionEntries[0];
  const closestTabs = entries.filter((entry) => entry.type === 'Tabs')
    .sort((left, right) => {
      const leftDistance = left.timestamp > latestSession.timestamp
        ? left.timestamp - latestSession.timestamp
        : latestSession.timestamp - left.timestamp;
      const rightDistance = right.timestamp > latestSession.timestamp
        ? right.timestamp - latestSession.timestamp
        : latestSession.timestamp - right.timestamp;
      return leftDistance < rightDistance ? -1 : 1;
    })[0];
  const recoveryDir = path.join(String(paths.root || path.dirname(paths.chromiumData || sessionsDir)), 'session-recovery-discarded');
  const removed = [];
  try {
    fs.mkdirSync(recoveryDir, { recursive: true });
    for (const entry of [latestSession, closestTabs].filter(Boolean)) {
      const target = path.join(recoveryDir, `${Date.now()}-${entry.name}`);
      fs.renameSync(entry.path, target);
      removed.push(entry.name);
    }
    logger?.warn?.('[ChromiumRuntime] 已隔离空白的最新 Session，回退到上一组有效网页会话:', removed);
    return { repaired: true, removed };
  } catch (error) {
    logger?.warn?.('[ChromiumRuntime] 修复空白 Session 失败:', error?.message || error);
    return { repaired: false, removed };
  }
}

function captureChromiumSessionFiles(paths = {}, logger = console) {
  const sessionsDir = getChromiumSessionsDir(paths);
  try {
    const files = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SESSION_FILE_PATTERN.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        data: fs.readFileSync(path.join(sessionsDir, entry.name)),
      }));
    return files.length ? { sessionsDir, files } : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') logger?.warn?.('[ChromiumRuntime] 捕获 Session 快照失败:', error?.message || error);
    return null;
  }
}

function prepareChromiumSessionRecovery(paths = {}, logger = console) {
  repairBlankLatestSession(paths, logger);
  let snapshot = captureChromiumSessionFiles(paths, logger);
  if (snapshotHasRestorableSession(snapshot)) {
    persistStableChromiumSession(paths, snapshot, logger);
    return { restorable: true, source: 'profile' };
  }
  snapshot = loadStableChromiumSession(paths, logger);
  if (snapshot && restoreChromiumSessionFiles(snapshot, logger)) {
    logger?.warn?.('[ChromiumRuntime] 当前 Session 无活动标签，已恢复启动前的稳定备份');
    return { restorable: true, source: 'stable-backup' };
  }
  return { restorable: false, source: 'none' };
}

function restoreChromiumSessionFiles(snapshot, logger = console) {
  if (!snapshot?.sessionsDir || !Array.isArray(snapshot.files) || snapshot.files.length === 0) return false;
  try {
    fs.mkdirSync(snapshot.sessionsDir, { recursive: true });
    for (const entry of fs.readdirSync(snapshot.sessionsDir, { withFileTypes: true })) {
      if (entry.isFile() && SESSION_FILE_PATTERN.test(entry.name)) {
        fs.rmSync(path.join(snapshot.sessionsDir, entry.name), { force: true });
      }
    }
    for (const file of snapshot.files) {
      const target = path.join(snapshot.sessionsDir, file.name);
      const temporary = `${target}.ai-free-tmp`;
      fs.writeFileSync(temporary, file.data);
      fs.renameSync(temporary, target);
    }
    return true;
  } catch (error) {
    logger?.warn?.('[ChromiumRuntime] 恢复退出前 Session 快照失败:', error?.message || error);
    return false;
  }
}

function buildChromiumArgs(options = {}) {
  const profile = options.profile || {};
  const paths = options.paths || {};
  const bounds = options.bounds || {};
  const runtimeProfileId = String(options.runtimeProfileId || profile.profileId || '').trim();
  const args = [
    `--user-data-dir=${paths.chromiumData}`,
    `--download-default-directory=${paths.downloads}`,
    `--hs-profile-id=${runtimeProfileId}`,
    `--hs-runtime-pipe=${options.pipeName}`,
    `--hs-runtime-token=${options.launchToken}`,
    '--hs-embed-mode=child-window',
    '--no-first-run',
    '--no-default-browser-check',
    // The embedded runtime is updated by AI-FREE itself. Chromium's own
    // component/model updater can otherwise download hundreds of megabytes
    // through the currently selected proxy while every page is idle.
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-session-crashed-bubble',
    '--disable-backgrounding-occluded-windows',
  ];
  if (options.hostHwnd) args.push(`--hs-embed-parent-hwnd=${options.hostHwnd}`);
  if (profile.proxyServer) args.push(`--proxy-server=${profile.proxyServer}`);
  if (profile.proxyBypassList) args.push(`--proxy-bypass-list=${profile.proxyBypassList}`);
  if (profile.locale) args.push(`--lang=${profile.locale}`);
  if (profile.timezoneId) args.push(`--hs-timezone-id=${profile.timezoneId}`);
  if (profile.userAgent) args.push(`--user-agent=${profile.userAgent}`);
  if (Number(bounds.width) > 0 && Number(bounds.height) > 0) {
    args.push(`--window-size=${Math.round(bounds.width)},${Math.round(bounds.height)}`);
  }
  const extensionPaths = (profile.extensionPaths || []).map((item) => path.resolve(String(item || ''))).filter((item) => fs.existsSync(item));
  if (extensionPaths.length) args.push(`--load-extension=${extensionPaths.join(',')}`);
  if (profile.remoteDebuggingPipe === true) args.push('--remote-debugging-pipe');
  if (profile.restoreLastSession === true) args.push('--restore-last-session');
  args.push(...(Array.isArray(profile.extraArgs) ? profile.extraArgs : []));
  // Chromium 在握手完成前还是独立顶层窗口。强制放到虚拟屏幕外，且放在
  // 自定义参数之后，避免用户参数覆盖；嵌入后 native host 会重新定位。
  args.push('--window-position=-32000,-32000');
  if (profile.initialUrl) args.push(String(profile.initialUrl));
  assertSafeChromiumArgs(args);
  return args;
}

function launchChromium(options = {}) {
  const executablePath = resolveChromiumExecutable(options);
  let launchOptions = options;
  if (options.profile?.restoreLastSession === true) {
    const recovery = prepareChromiumSessionRecovery(options.paths, options.logger);
    const fallbackUrl = String(options.profile?.restoreFallbackUrl || '').trim();
    if (!recovery.restorable && /^https?:\/\//i.test(fallbackUrl)) {
      launchOptions = {
        ...options,
        profile: {
          ...options.profile,
          initialUrl: fallbackUrl,
          restoreLastSession: false,
        },
      };
      options.logger?.warn?.('[ChromiumRuntime] 未找到可恢复的活动标签，回退打开浏览器记录网址:', fallbackUrl);
    }
  }
  applyChromiumSessionStartupPolicy(launchOptions.paths, launchOptions.logger, launchOptions.profile);
  const args = buildChromiumArgs(launchOptions);
  const child = spawn(executablePath, args, {
    cwd: path.dirname(executablePath),
    // 让 WinMain 收到隐藏启动状态，避免 Browser HWND 在嵌入前闪现。
    // --window-position 是额外兜底，处理忽略初始 show state 的构建。
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildChromiumEnvironment(process.env, {
      ...(options.env || {}),
      ...(options.profile?.timezoneId ? { TZ: String(options.profile.timezoneId) } : {}),
    }),
  });
  options.logger?.info?.(`[AI-FREE] 已启动外部浏览器内核: ${executablePath}`);
  options.logger?.info?.(`[ChromiumRuntime] PID=${child.pid} Profile=${options.profile?.profileId || ''}`);
  forwardChromiumOutput(child.stdout, (line) => options.logger?.log?.(`[Chromium:${child.pid}] ${line}`));
  forwardChromiumOutput(
    child.stderr,
    (line) => options.logger?.warn?.(`[Chromium:${child.pid}] ${line}`),
    shouldIgnoreChromiumDiagnostic,
  );
  return { child, executablePath, args };
}

// Windows 未安装特定 Winsock 服务提供程序时 Chromium 会反复输出该诊断，
// 但它不会影响 DNS、页面加载或 Runtime Bridge，避免将它淹没有效日志。
function shouldIgnoreChromiumDiagnostic(line) {
  return /WSALookupServiceBegin failed with:\s*10108\b/.test(String(line || ''));
}

function forwardChromiumOutput(stream, emit, shouldIgnore = () => false) {
  if (!stream || typeof stream.on !== 'function') return;
  let pending = '';

  const flushLine = (line) => {
    const text = String(line || '').trimEnd();
    if (!text || shouldIgnore(text)) return;
    emit(text);
  };

  stream.on('data', (chunk) => {
    pending += String(chunk || '');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) flushLine(line);
  });
  stream.on('end', () => {
    flushLine(pending);
    pending = '';
  });
}

module.exports = {
  FORBIDDEN_SWITCHES,
  applyChromiumSessionStartupPolicy,
  assertSafeChromiumArgs,
  buildChromiumArgs,
  buildChromiumEnvironment,
  captureChromiumSessionFiles,
  forwardChromiumOutput,
  getSystemChromiumCandidates,
  launchChromium,
  loadStableChromiumSession,
  persistStableChromiumSession,
  prepareChromiumSessionRecovery,
  resolveChromiumExecutable,
  repairBlankLatestSession,
  restoreChromiumSessionFiles,
  snapshotHasRestorableSession,
  shouldIgnoreChromiumDiagnostic,
};
