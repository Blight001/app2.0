const fs = require('fs');
const path = require('path');

function resolveBindingCandidates(options = {}) {
  const appRoot = path.resolve(options.appRoot || path.join(__dirname, '../../../../'));
  return [
    options.bindingPath,
    path.join(appRoot, 'native', 'browser-host', 'build', 'Release', 'browser_host.node'),
    process.resourcesPath && path.join(process.resourcesPath, 'native', 'browser-host', 'browser_host.node'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'browser-host', 'build', 'Release', 'browser_host.node'),
  ].filter(Boolean);
}

class ChromiumWindowBridge {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.binding = options.binding || null;
    this.candidates = resolveBindingCandidates(options);
  }

  load() {
    if (this.binding) return this.binding;
    if (process.platform !== 'win32') {
      const error = new Error('Chromium Win32 嵌入仅支持 Windows');
      error.code = 'UNSUPPORTED_PLATFORM';
      throw error;
    }
    const bindingPath = this.candidates.find((candidate) => fs.existsSync(candidate));
    if (!bindingPath) {
      const error = new Error('Win32 Browser Host 尚未编译，请执行 npm run build:native-host');
      error.code = 'NATIVE_BROWSER_HOST_NOT_BUILT';
      error.candidates = this.candidates;
      throw error;
    }
    this.binding = require(bindingPath);
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
  showHostWindow(hostHwnd) { return this.load().showHostWindow({ hostHwnd }); }
  hideHostWindow(hostHwnd) { return this.load().hideHostWindow({ hostHwnd }); }
  focusChildWindow(childHwnd) { return this.load().focusChildWindow({ childHwnd }); }
  isWindowAlive(hwnd) { return this.load().isWindowAlive({ hwnd }); }
  getWindowProcessId(hwnd) { return this.load().getWindowProcessId({ hwnd }); }
  findMainWindowByProcessId(pid) { return this.load().findMainWindowByProcessId({ pid }); }
  setChildWindowTitle(childHwnd, title = 'AI-FREE 浏览器') { return this.load().setChildWindowTitle({ childHwnd, title }); }
  isChildWindowAttached(hostHwnd, childHwnd) { return this.load().isChildWindowAttached({ hostHwnd, childHwnd }); }
}

module.exports = { ChromiumWindowBridge, resolveBindingCandidates };
