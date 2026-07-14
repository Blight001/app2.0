const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
  preferences.session.restore_on_startup = 5;
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
  applyChromiumSessionStartupPolicy(options.paths, options.logger, options.profile);
  const args = buildChromiumArgs(options);
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
  forwardChromiumOutput,
  getSystemChromiumCandidates,
  launchChromium,
  resolveChromiumExecutable,
  shouldIgnoreChromiumDiagnostic,
};
