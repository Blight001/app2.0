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

function buildChromiumArgs(options = {}) {
  const profile = options.profile || {};
  const paths = options.paths || {};
  const bounds = options.bounds || {};
  const args = [
    `--user-data-dir=${paths.chromiumData}`,
    `--download-default-directory=${paths.downloads}`,
    `--hs-profile-id=${profile.profileId}`,
    `--hs-runtime-pipe=${options.pipeName}`,
    `--hs-runtime-token=${options.launchToken}`,
    '--hs-embed-mode=child-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-backgrounding-occluded-windows',
  ];
  if (options.hostHwnd) args.push(`--hs-embed-parent-hwnd=${options.hostHwnd}`);
  if (profile.proxyServer) args.push(`--proxy-server=${profile.proxyServer}`);
  if (profile.proxyBypassList) args.push(`--proxy-bypass-list=${profile.proxyBypassList}`);
  if (profile.locale) args.push(`--lang=${profile.locale}`);
  if (profile.userAgent) args.push(`--user-agent=${profile.userAgent}`);
  if (Number(bounds.width) > 0 && Number(bounds.height) > 0) {
    args.push(`--window-size=${Math.round(bounds.width)},${Math.round(bounds.height)}`);
  }
  const extensionPaths = (profile.extensionPaths || []).map((item) => path.resolve(String(item || ''))).filter((item) => fs.existsSync(item));
  if (extensionPaths.length) args.push(`--load-extension=${extensionPaths.join(',')}`);
  if (profile.remoteDebuggingPipe === true) args.push('--remote-debugging-pipe');
  args.push(...(Array.isArray(profile.extraArgs) ? profile.extraArgs : []));
  if (profile.initialUrl) args.push(String(profile.initialUrl));
  assertSafeChromiumArgs(args);
  return args;
}

function launchChromium(options = {}) {
  const executablePath = resolveChromiumExecutable(options);
  const args = buildChromiumArgs(options);
  const child = spawn(executablePath, args, {
    cwd: path.dirname(executablePath),
    windowsHide: false,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildChromiumEnvironment(process.env, options.env || {}),
  });
  options.logger?.info?.(`[AI-FREE] 已启动外部浏览器内核: ${executablePath}`);
  options.logger?.info?.(`[ChromiumRuntime] PID=${child.pid} Profile=${options.profile?.profileId || ''}`);
  child.stdout?.on('data', (chunk) => options.logger?.log?.(`[Chromium:${child.pid}] ${String(chunk).trimEnd()}`));
  child.stderr?.on('data', (chunk) => options.logger?.warn?.(`[Chromium:${child.pid}] ${String(chunk).trimEnd()}`));
  return { child, executablePath, args };
}

module.exports = {
  FORBIDDEN_SWITCHES,
  assertSafeChromiumArgs,
  buildChromiumArgs,
  buildChromiumEnvironment,
  getSystemChromiumCandidates,
  launchChromium,
  resolveChromiumExecutable,
};
