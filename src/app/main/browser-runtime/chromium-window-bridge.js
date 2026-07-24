const fs = require('fs');
const path = require('path');
const { ExternalAppAutomationClient } = require('./external-app-automation-client');

function resolveBindingCandidates(options = {}) {
  const appRoot = path.resolve(options.appRoot || path.join(__dirname, '../../../../'));
  const resourcesPath = String(options.resourcesPath || process.resourcesPath || '').trim();
  const workingDirectory = path.resolve(options.workingDirectory || process.cwd());
  return [...new Set([
    options.bindingPath,
    resourcesPath && path.join(resourcesPath, 'native', 'browser-host', 'browser_host.node'),
    resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', 'native', 'browser-host', 'build', 'Release', 'browser_host.node'),
    path.join(appRoot, 'native', 'browser-host', 'build', 'Release', 'browser_host.node'),
    // `npm start` executes the staged `.generated/app` tree while keeping the
    // project root as cwd. The native addon is intentionally built outside the
    // generated source tree, so development must also probe that project root.
    path.join(workingDirectory, 'native', 'browser-host', 'build', 'Release', 'browser_host.node'),
  ].filter(Boolean))];
}

class ChromiumWindowBridge {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.binding = options.binding || null;
    this.bindingPath = String(options.bindingPath || '');
    this.automationClient = options.automationClient || null;
    this.candidates = resolveBindingCandidates(options);
  }

  load() {
    if (this.binding) return this.binding;
    if (process.platform !== 'win32') {
      const error = /** @type {Error & {code?: string}} */ (new Error('Chromium Win32 嵌入仅支持 Windows'));
      error.code = 'UNSUPPORTED_PLATFORM';
      throw error;
    }
    const bindingPath = this.candidates.find((candidate) => fs.existsSync(candidate));
    if (!bindingPath) {
      const error = /** @type {Error & {code?: string, candidates?: string[]}} */ (new Error('Win32 Browser Host 尚未编译，请执行 npm run build:native-host'));
      error.code = 'NATIVE_BROWSER_HOST_NOT_BUILT';
      error.candidates = this.candidates;
      throw error;
    }
    try {
      this.binding = require(bindingPath);
      this.bindingPath = bindingPath;
    } catch (cause) {
      const error = /** @type {Error & {code?: string, bindingPath?: string, cause?: any}} */ (new Error(
        `Win32 Browser Host 加载失败: ${bindingPath}; `
        + `${cause?.message || cause}. 请确认安装包完整且未被安全软件隔离`,
      ));
      error.code = 'NATIVE_BROWSER_HOST_LOAD_FAILED';
      error.bindingPath = bindingPath;
      error.cause = cause;
      throw error;
    }
    return this.binding;
  }

  isAvailable() {
    try { this.load(); return true; } catch (_) { return false; }
  }

  setPerMonitorDpiAwareness() { return this.load().setPerMonitorDpiAwareness(); }
  createHostWindow(options) { return this.load().createHostWindow(options); }
  destroyHostWindow(hostHwnd) { return this.load().destroyHostWindow({ hostHwnd }); }
  attachChildWindow(options) { return this.load().attachChildWindow(options); }
  detachChildWindow(options) { return this.load().detachChildWindow(options); }
  setHostBounds(hostHwnd, bounds) { return this.load().setHostBounds({ hostHwnd, ...bounds }); }
  raiseHostWindow(hostHwnd) {
    const binding = this.load();
    // Keep development usable while a running Electron process still has the
    // previous native DLL loaded. The next native rebuild enables the repair.
    if (typeof binding.raiseHostWindow !== 'function') return true;
    return binding.raiseHostWindow({ hostHwnd });
  }
  showHostWindow(hostHwnd) { return this.load().showHostWindow({ hostHwnd }); }
  hideHostWindow(hostHwnd) { return this.load().hideHostWindow({ hostHwnd }); }
  focusChildWindow(childHwnd) { return this.load().focusChildWindow({ childHwnd }); }
  releaseChildWindowFocus(childHwnd) {
    const binding = this.load();
    if (typeof binding.releaseChildWindowFocus !== 'function') return true;
    return binding.releaseChildWindowFocus({ childHwnd });
  }
  isWindowAlive(hwnd) { return this.load().isWindowAlive({ hwnd }); }
  getWindowProcessId(hwnd) { return this.load().getWindowProcessId({ hwnd }); }
  requestWindowClose(hwnd) {
    const binding = this.load();
    return typeof binding.requestWindowClose === 'function'
      ? binding.requestWindowClose({ hwnd })
      : false;
  }
  findMainWindowByProcessId(pid) { return this.load().findMainWindowByProcessId({ pid }); }
  findMainWindowByExecutablePath(executablePath) {
    return this.load().findMainWindowByExecutablePath({ executablePath });
  }
  listVisibleTopLevelWindows() {
    const binding = this.load();
    return typeof binding.listVisibleTopLevelWindows === 'function'
      ? binding.listVisibleTopLevelWindows()
      : [];
  }
  setChildWindowTitle(childHwnd, title = 'AI-FREE') { return this.load().setChildWindowTitle({ childHwnd, title }); }
  isChildWindowAttached(hostHwnd, childHwnd) { return this.load().isChildWindowAttached({ hostHwnd, childHwnd }); }
  dockExternalWindow(options) { return this.load().dockExternalWindow(options); }
  hideDockedExternalWindow(childHwnd) {
    return this.load().hideDockedExternalWindow({ childHwnd });
  }
  restoreExternalWindow(childHwnd) {
    return this.load().restoreExternalWindow({ childHwnd });
  }
  isExternalWindowDocked(parentHwnd, childHwnd) {
    return this.load().isExternalWindowDocked({ parentHwnd, childHwnd });
  }
  getWindowPlacementSnapshot(hwnd) {
    return this.load().getWindowPlacementSnapshot({ hwnd });
  }
  performExternalWindowAction(options) {
    return this.load().performExternalWindowAction(options);
  }
  getAutomationClient() {
    this.load();
    if (!this.automationClient && this.bindingPath) {
      this.automationClient = new ExternalAppAutomationClient({
        bindingPath: this.bindingPath,
      });
    }
    return this.automationClient;
  }
  runExternalAutomation(method, options, fallback) {
    const client = this.getAutomationClient();
    return client
      ? client.execute(method, options)
      : Promise.resolve(fallback());
  }
  performExternalWindowActionAsync(options) {
    return this.runExternalAutomation(
      'performExternalWindowAction', options,
      () => this.performExternalWindowAction(options),
    );
  }
  captureExternalWindow(options) {
    return this.runExternalAutomation(
      'captureExternalWindow', options,
      () => this.load().captureExternalWindow(options),
    );
  }
  disposeExternalAutomation() {
    const client = this.automationClient;
    this.automationClient = null;
    return client?.dispose?.() || Promise.resolve();
  }
}

module.exports = { ChromiumWindowBridge, resolveBindingCandidates };
