'use strict';

const OWNER_FILE_NAME = '.ai-free-owner.json';
const STAGING_MARKER = '.staging-';
const STAGING_STALE_MS = 5 * 60 * 1000;
const UNKNOWN_OWNER_STALE_MS = 24 * 60 * 60 * 1000;

function resolveProtectedRuntimeRoot(deps) {
  try {
    if (typeof deps.app?.getPath === 'function') {
      return deps.path.join(deps.app.getPath('userData'), deps.protectedRuntimeDirName);
    }
  } catch (_) {}
  return deps.path.join(process.cwd(), `.${deps.protectedRuntimeDirName}`);
}

function isBuiltinBrowserAutomationPlugin(deps, plugin) {
  return plugin?.builtin === true
    && deps.path.basename(String(plugin.path || '')).toLowerCase() === deps.browserAutomationDirName;
}

function buildProtectedRuntimeContext(deps, plugin, sourcePath, accessToken) {
  const runtimeRoot = resolveProtectedRuntimeRoot(deps);
  const signature = deps.hashId([
    sourcePath, plugin?.runtimeSignature || '', accessToken, 'protected-browser-automation-v2',
  ].join('|'));
  const runtimeSessionId = deps.hashId(`browser-automation-session|${accessToken}|${signature}`);
  const runtimeSessionRoot = deps.path.join(runtimeRoot, runtimeSessionId);
  const runtimePath = deps.path.join(runtimeSessionRoot, deps.browserAutomationDirName);
  return { accessToken, runtimeRoot, runtimeSessionId, runtimeSessionRoot, runtimePath, signature, sourcePath };
}

function hasManifest(deps, directory) {
  try { return deps.fs.existsSync(deps.path.join(directory, 'manifest.json')); } catch (_) { return false; }
}

function isProtectedCopyCurrent(deps, state, context) {
  return state.signature === context.signature
    && state.runtimePath === context.runtimePath
    && hasManifest(deps, context.runtimePath);
}

function isProcessAlive(pid) {
  const processId = Number(pid);
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readOwner(deps, directory) {
  try {
    return JSON.parse(deps.fs.readFileSync(deps.path.join(directory, OWNER_FILE_NAME), 'utf8'));
  } catch (_) {
    return null;
  }
}

function directoryAgeMs(deps, directory) {
  try { return Math.max(0, deps.now() - deps.fs.statSync(directory).mtimeMs); } catch (_) { return 0; }
}

function canRemoveStaleCopy(deps, directory, name) {
  const age = directoryAgeMs(deps, directory);
  if (name.includes(STAGING_MARKER)) return age >= STAGING_STALE_MS;
  const owner = readOwner(deps, directory);
  if (owner?.pid) return !deps.isProcessAlive(owner.pid);
  return age >= UNKNOWN_OWNER_STALE_MS;
}

function cleanupStaleRuntimeCopies(deps, state, context) {
  if (state.runtimeRootPrepared) return;
  let entries = [];
  try { entries = deps.fs.readdirSync(context.runtimeRoot, { withFileTypes: true }); } catch (_) {}
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === context.runtimeSessionId) continue;
    const stalePath = deps.path.join(context.runtimeRoot, entry.name);
    if (!deps.isPathInside(context.runtimeRoot, stalePath) || !canRemoveStaleCopy(deps, stalePath, entry.name)) continue;
    try { deps.fs.rmSync(stalePath, { recursive: true, force: true }); } catch (error) {
      deps.logger.warn?.('[Extensions] 清理旧自动化插件运行副本失败:', error?.message || error);
    }
  }
  state.runtimeRootPrepared = true;
}

function writeProtectedEnvironment(deps, runtimePath, accessToken) {
  const environmentPath = deps.path.join(runtimePath, deps.browserAutomationEnvFile);
  const environmentSource = [
    '// 由 AI-FREE 主进程生成；软件重启后此临时凭据立即失效。',
    `globalThis.AI_FREE_BROWSER_ENVIRONMENT = Object.freeze(${JSON.stringify({
      protectedRuntime: true,
      appBrowserToken: accessToken,
    })});`,
    '',
  ].join('\n');
  deps.fs.writeFileSync(environmentPath, environmentSource, { encoding: 'utf8', mode: 0o600 });
}

function writeRuntimeOwner(deps, runtimeSessionRoot, context) {
  const owner = {
    pid: deps.processId,
    createdAt: new Date(deps.now()).toISOString(),
    runtimeSessionId: context.runtimeSessionId,
  };
  deps.fs.writeFileSync(
    deps.path.join(runtimeSessionRoot, OWNER_FILE_NAME),
    JSON.stringify(owner),
    { encoding: 'utf8', mode: 0o600 },
  );
}

function createStagingContext(deps, context) {
  const suffix = deps.hashId(`${deps.processId}|${deps.now()}|${context.signature}`);
  const root = `${context.runtimeSessionRoot}${STAGING_MARKER}${deps.processId}-${suffix}`;
  return { root, runtimePath: deps.path.join(root, deps.browserAutomationDirName) };
}

function publishStagingCopy(deps, context, staging) {
  if (hasManifest(deps, context.runtimePath)) {
    deps.fs.rmSync(staging.root, { recursive: true, force: true });
    return context.runtimePath;
  }
  if (deps.fs.existsSync(context.runtimeSessionRoot)) {
    deps.fs.rmSync(context.runtimeSessionRoot, { recursive: true, force: true });
  }
  deps.fs.renameSync(staging.root, context.runtimeSessionRoot);
  if (!hasManifest(deps, context.runtimePath)) throw new Error('受保护插件原子发布后缺少 manifest.json');
  return context.runtimePath;
}

function createProtectedCopy(deps, state, context) {
  const staging = createStagingContext(deps, context);
  try {
    if (!hasManifest(deps, context.sourcePath)) throw new Error(`内置自动化插件源目录不完整: ${context.sourcePath}`);
    deps.fs.mkdirSync(context.runtimeRoot, { recursive: true });
    cleanupStaleRuntimeCopies(deps, state, context);
    if (hasManifest(deps, context.runtimePath)) return rememberProtectedCopy(state, context);
    deps.fs.mkdirSync(staging.root, { recursive: true });
    deps.copyDirectoryRecursive(context.sourcePath, staging.runtimePath);
    writeProtectedEnvironment(deps, staging.runtimePath, context.accessToken);
    writeRuntimeOwner(deps, staging.root, context);
    publishStagingCopy(deps, context, staging);
    deps.logger.log?.('[Extensions] 已原子创建仅限当前软件进程使用的自动化插件运行副本');
    return rememberProtectedCopy(state, context);
  } catch (error) {
    try { deps.fs.rmSync(staging.root, { recursive: true, force: true }); } catch (_) {}
    state.signature = '';
    state.runtimePath = '';
    deps.logger.error?.('[Extensions] 创建受保护自动化插件副本失败:', error?.message || error);
    return '';
  }
}

function rememberProtectedCopy(state, context) {
  state.signature = context.signature;
  state.runtimePath = context.runtimePath;
  return context.runtimePath;
}

function prepareProtectedBrowserAutomationPath(deps, state, plugin) {
  const sourcePath = deps.normalizeAbsolutePath(plugin?.path);
  if (!sourcePath || !hasManifest(deps, sourcePath)) {
    deps.logger.error?.('[Extensions] 内置自动化插件缺失，已阻止 Chromium 加载无效目录:', sourcePath || '(空路径)');
    return '';
  }
  const accessToken = typeof deps.getBrowserAutomationAccessToken === 'function'
    ? String(deps.getBrowserAutomationAccessToken() || '').trim()
    : '';
  if (!accessToken) return sourcePath;
  const context = buildProtectedRuntimeContext(deps, plugin, sourcePath, accessToken);
  if (isProtectedCopyCurrent(deps, state, context)) return context.runtimePath;
  return createProtectedCopy(deps, state, context);
}

function createProtectedExtensionRuntime(deps = {}) {
  const runtime = {
    ...deps,
    isProcessAlive: deps.isProcessAlive || isProcessAlive,
    logger: deps.logger || console,
    now: deps.now || Date.now,
    processId: Number(deps.processId) || process.pid,
  };
  const state = { signature: '', runtimePath: '', runtimeRootPrepared: false };
  return {
    isBuiltinBrowserAutomationPlugin: (plugin) => isBuiltinBrowserAutomationPlugin(runtime, plugin),
    prepareProtectedBrowserAutomationPath: (plugin) => prepareProtectedBrowserAutomationPath(runtime, state, plugin),
  };
}

module.exports = { createProtectedExtensionRuntime };
