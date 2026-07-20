'use strict';

function resolveProtectedRuntimeRoot(deps) {
  try {
    if (typeof deps.app?.getPath === 'function') return deps.path.join(deps.app.getPath('userData'), deps.protectedRuntimeDirName);
  } catch (_) {}
  return deps.path.join(process.cwd(), `.${deps.protectedRuntimeDirName}`);
}

function isBuiltinBrowserAutomationPlugin(deps, plugin) {
  return plugin?.builtin === true
    && deps.path.basename(String(plugin.path || '')).toLowerCase() === deps.browserAutomationDirName;
}

function buildProtectedRuntimeContext(deps, plugin, sourcePath, accessToken) {
  const runtimeRoot = resolveProtectedRuntimeRoot(deps);
  const runtimeSessionId = deps.hashId(`browser-automation-session|${accessToken}`);
  const runtimeSessionRoot = deps.path.join(runtimeRoot, runtimeSessionId);
  const runtimePath = deps.path.join(runtimeSessionRoot, deps.browserAutomationDirName);
  const signature = deps.hashId([
    sourcePath, plugin?.runtimeSignature || '', accessToken, 'protected-browser-automation-v1',
  ].join('|'));
  return { accessToken, runtimeRoot, runtimeSessionId, runtimeSessionRoot, runtimePath, signature, sourcePath };
}

function isProtectedCopyCurrent(deps, state, context) {
  return state.signature === context.signature
    && state.runtimePath === context.runtimePath
    && deps.fs.existsSync(deps.path.join(context.runtimePath, 'manifest.json'));
}

function cleanupStaleRuntimeCopies(deps, state, context) {
  if (state.runtimeRootPrepared) return;
  for (const entry of deps.fs.readdirSync(context.runtimeRoot, { withFileTypes: true })) {
    if (entry.name === context.runtimeSessionId) continue;
    const stalePath = deps.path.join(context.runtimeRoot, entry.name);
    if (!deps.isPathInside(context.runtimeRoot, stalePath)) continue;
    try { deps.fs.rmSync(stalePath, { recursive: true, force: true }); } catch (error) {
      deps.logger.warn?.('[Extensions] 清理旧自动化插件运行副本失败:', error?.message || error);
    }
  }
  state.runtimeRootPrepared = true;
}

function writeProtectedEnvironment(deps, context) {
  const environmentPath = deps.path.join(context.runtimePath, deps.browserAutomationEnvFile);
  const environmentSource = [
    '// 由 AI-FREE 主进程生成；软件重启后此临时凭据立即失效。',
    `globalThis.AI_FREE_BROWSER_ENVIRONMENT = Object.freeze(${JSON.stringify({
      protectedRuntime: true,
      appBrowserToken: context.accessToken,
    })});`,
    '',
  ].join('\n');
  deps.fs.writeFileSync(environmentPath, environmentSource, { encoding: 'utf8', mode: 0o600 });
}

function createProtectedCopy(deps, state, context) {
  try {
    deps.fs.mkdirSync(context.runtimeRoot, { recursive: true });
    cleanupStaleRuntimeCopies(deps, state, context);
    deps.fs.mkdirSync(context.runtimeSessionRoot, { recursive: true });
    if (deps.fs.existsSync(context.runtimePath)) {
      if (!deps.isPathInside(context.runtimeRoot, context.runtimePath)) throw new Error('受保护插件运行目录校验失败');
      deps.fs.rmSync(context.runtimePath, { recursive: true, force: true });
    }
    deps.copyDirectoryRecursive(context.sourcePath, context.runtimePath);
    writeProtectedEnvironment(deps, context);
    state.signature = context.signature;
    state.runtimePath = context.runtimePath;
    deps.logger.log?.('[Extensions] 已创建仅限当前软件进程使用的自动化插件运行副本');
    return context.runtimePath;
  } catch (error) {
    state.signature = '';
    state.runtimePath = '';
    deps.logger.error?.('[Extensions] 创建受保护自动化插件副本失败:', error?.message || error);
    return '';
  }
}

function prepareProtectedBrowserAutomationPath(deps, state, plugin) {
  const sourcePath = deps.normalizeAbsolutePath(plugin?.path);
  const accessToken = typeof deps.getBrowserAutomationAccessToken === 'function'
    ? String(deps.getBrowserAutomationAccessToken() || '').trim()
    : '';
  if (!sourcePath || !accessToken) return sourcePath;
  const context = buildProtectedRuntimeContext(deps, plugin, sourcePath, accessToken);
  if (isProtectedCopyCurrent(deps, state, context)) return context.runtimePath;
  return createProtectedCopy(deps, state, context);
}

function createProtectedExtensionRuntime(deps = {}) {
  const runtime = { ...deps, logger: deps.logger || console };
  const state = { signature: '', runtimePath: '', runtimeRootPrepared: false };
  return {
    isBuiltinBrowserAutomationPlugin: (plugin) => isBuiltinBrowserAutomationPlugin(runtime, plugin),
    prepareProtectedBrowserAutomationPath: (plugin) => prepareProtectedBrowserAutomationPath(runtime, state, plugin),
  };
}

module.exports = { createProtectedExtensionRuntime };
