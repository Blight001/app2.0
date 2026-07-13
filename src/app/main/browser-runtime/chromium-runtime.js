const crypto = require('crypto');
const { spawn } = require('child_process');
const { BrowserRuntime } = require('./browser-runtime');
const { ChromiumCommandClient, createPipeName } = require('./chromium-command-client');
const { ChromiumHealthMonitor } = require('./chromium-health');
const { launchChromium } = require('./chromium-launcher');
const { prepareSessionImport } = require('./session-import');
const { normalizeBounds, RUNTIME_STATUS, RUNTIME_TYPES } = require('./runtime-types');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(child.exitCode !== null), Math.max(100, timeoutMs));
    child.once('exit', onExit);
  });
}

function terminateProcessTree(pid, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
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
    }, Math.max(1000, timeoutMs));
    killer.once('error', () => finish(false));
    killer.once('exit', (code) => finish(code === 0 || code === 128));
  });
}

class ChromiumRuntime extends BrowserRuntime {
  constructor(options = {}) {
    super(options);
    this.store = options.store;
    this.windowBridge = options.windowBridge;
    this.getParentWindow = options.getParentWindow;
    this.resourcesPath = options.resourcesPath;
    this.instances = new Map();
  }

  async launchProfile(rawProfile = {}, rawBounds = {}) {
    const profileId = String(rawProfile.profileId || rawProfile.id || '').trim();
    if (!profileId) throw new Error('缺少 Profile ID');
    const existing = this.store.getState(profileId);
    if (existing && ['ready', 'hidden'].includes(existing.status)) {
      await this.resize(profileId, rawBounds);
      await this.show(profileId);
      return this.getState(profileId);
    }
    const bounds = normalizeBounds(rawBounds);
    const paths = this.store.ensureProfile({ ...rawProfile, profileId, runtimeType: RUNTIME_TYPES.CHROMIUM });
    this.store.acquireLock(profileId, { runtimeType: RUNTIME_TYPES.CHROMIUM });
    this.store.createState(profileId, RUNTIME_TYPES.CHROMIUM, { bounds, status: RUNTIME_STATUS.STARTING, startedAt: Date.now() });

    let hostHwnd = null;
    let commandClient = null;
    try {
      const parentWindow = this.getParentWindow?.();
      if (!parentWindow || parentWindow.isDestroyed?.()) throw new Error('Electron 主窗口不可用');
      const parentHwnd = parentWindow.getNativeWindowHandle();
      hostHwnd = this.windowBridge.createHostWindow({ parentHwnd, ...bounds });
      const pipeName = createPipeName(profileId);
      const launchToken = crypto.randomBytes(32).toString('hex');
      commandClient = new ChromiumCommandClient({ profileId, pipeName, launchToken, logger: this.logger });
      await commandClient.listen();
      this.store.transition(profileId, RUNTIME_STATUS.WAITING_PIPE, { hostHwnd, pipeName });

      const profile = { ...rawProfile, profileId };
      const launched = launchChromium({
        profile, paths, bounds, hostHwnd, pipeName, launchToken,
        resourcesPath: this.resourcesPath, executablePath: profile.executablePath, logger: this.logger,
      });
      const child = launched.child;
      commandClient.setExpectedPid(child.pid);
      const instance = {
        profile, paths, child, commandClient, hostHwnd, parentWindow,
        expectedExit: false, monitor: null, parentFocusHandler: null,
      };
      this.instances.set(profileId, instance);
      this.store.patchState(profileId, { pid: child.pid });
      this.bindInstance(profileId, instance);

      const browserHwnd = await this.waitForBrowserWindow(profileId, instance);
      const prototypeMode = String(process.env.AI_FREE_CHROMIUM_HANDSHAKE || '').toLowerCase() === 'prototype';
      const handshakeState = this.store.getState(profileId);
      if (!prototypeMode && (!handshakeState?.bridgeConnected || !handshakeState?.sessionId || !browserHwnd)) {
        const handshakeError = new Error('AI-FREE Chromium Fork 握手状态不完整');
        handshakeError.code = 'CHROMIUM_HANDSHAKE_INCOMPLETE';
        throw handshakeError;
      }
      this.store.transition(profileId, RUNTIME_STATUS.ATTACHING, { browserHwnd });
      const attached = this.windowBridge.attachChildWindow({
        hostHwnd,
        childHwnd: browserHwnd,
        childPid: child.pid,
        title: 'AI-FREE 浏览器',
      });
      if (!attached || !this.windowBridge.isChildWindowAttached(hostHwnd, browserHwnd)) {
        const attachError = new Error('外部浏览器未能嵌入 AI-FREE 软件窗口');
        attachError.code = 'CHROMIUM_HWND_ATTACH_FAILED';
        throw attachError;
      }
      this.windowBridge.setChildWindowTitle(browserHwnd, 'AI-FREE 浏览器');
      this.windowBridge.setHostBounds(hostHwnd, bounds);
      this.windowBridge.showHostWindow(hostHwnd);
      this.store.transition(profileId, RUNTIME_STATUS.READY, {
        productName: 'AI-FREE 浏览器',
        embedded: true,
        lastHeartbeatAt: Date.now(),
      });
      instance.monitor = new ChromiumHealthMonitor({
        isWindowAlive: (hwnd) => this.windowBridge.isWindowAlive(hwnd),
        onFailure: (error) => this.markCrashed(profileId, error),
      });
      instance.monitor.start(() => this.store.getState(profileId));
      this.bindParentWindowFocus(profileId, instance);
      this.emit('state-changed', this.getState(profileId));
      return this.getState(profileId);
    } catch (error) {
      await this.cleanupFailedLaunch(profileId, { hostHwnd, commandClient, error });
      throw error;
    }
  }

  bindInstance(profileId, instance) {
    instance.commandClient.on('hello', (message) => {
      this.store.patchState(profileId, { bridgeConnected: true, sessionId: message.sessionId, lastHeartbeatAt: Date.now() });
    });
    instance.commandClient.on('heartbeat', () => this.store.patchState(profileId, { lastHeartbeatAt: Date.now() }));
    instance.commandClient.on('event', (message) => this.emit('runtime-event', { profileId, ...message }));
    instance.child.once('error', (error) => this.markCrashed(profileId, { code: 'CHROMIUM_PROCESS_ERROR', message: error.message }));
    instance.child.once('exit', (code, signal) => {
      if (!instance.expectedExit) this.markCrashed(profileId, { code: 'CHROMIUM_PROCESS_EXITED', message: `Chromium 已退出 (${code ?? signal})`, exitCode: code });
    });
  }

  bindParentWindowFocus(profileId, instance) {
    const parentWindow = instance?.parentWindow;
    if (!parentWindow?.on || instance.parentFocusHandler) return;
    const raiseEmbeddedHost = () => {
      setImmediate(() => {
        const state = this.store.getState(profileId);
        if (state?.status !== RUNTIME_STATUS.READY || !state.hostHwnd) return;
        try {
          this.windowBridge.showHostWindow(state.hostHwnd);
          this.windowBridge.setHostBounds(state.hostHwnd, state.bounds);
        } catch (error) {
          this.logger?.warn?.(`[ChromiumRuntime] 恢复嵌入窗口 Z-order 失败: ${error.message}`);
        }
      });
    };
    instance.parentFocusHandler = raiseEmbeddedHost;
    parentWindow.on('focus', raiseEmbeddedHost);
  }

  unbindParentWindowFocus(instance) {
    if (!instance?.parentFocusHandler) return;
    try { instance.parentWindow?.off?.('focus', instance.parentFocusHandler); } catch (_) {}
    instance.parentFocusHandler = null;
  }

  async waitForBrowserWindow(profileId, instance) {
    const allowPrototype = String(process.env.AI_FREE_CHROMIUM_HANDSHAKE || '').toLowerCase() === 'prototype';
    const timeoutMs = Math.max(3000, Number(instance.profile.launchTimeoutMs) || 20000);
    let helloWindow = String(instance.commandClient.lastHello?.browserHwnd || '');
    instance.commandClient.once('hello', (message) => { helloWindow = String(message.browserHwnd || ''); });
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (helloWindow) return helloWindow;
      if (allowPrototype) {
        const found = this.windowBridge.findMainWindowByProcessId(instance.child.pid);
        if (found) return found;
      }
      if (instance.child.exitCode !== null) throw new Error('Chromium 在创建窗口前退出');
      await delay(100);
    }
    const error = new Error(allowPrototype ? '等待 Chromium 主窗口超时' : '等待 Chromium Fork 命名管道握手超时');
    error.code = 'CHROMIUM_WINDOW_TIMEOUT';
    throw error;
  }

  async attach(profileId) { return this.getState(profileId); }
  async show(profileId) {
    const state = this.store.getState(profileId);
    if (!state?.hostHwnd) return state;
    this.windowBridge.showHostWindow(state.hostHwnd);
    if (state.status === RUNTIME_STATUS.HIDDEN) this.store.transition(profileId, RUNTIME_STATUS.READY);
    return this.getState(profileId);
  }
  async hide(profileId) {
    const state = this.store.getState(profileId);
    if (!state?.hostHwnd) return state;
    this.windowBridge.hideHostWindow(state.hostHwnd);
    if (state.status === RUNTIME_STATUS.READY) this.store.transition(profileId, RUNTIME_STATUS.HIDDEN);
    return this.getState(profileId);
  }
  async resize(profileId, rawBounds) {
    const state = this.store.getState(profileId);
    if (!state) return null;
    const bounds = normalizeBounds(rawBounds);
    if (state.hostHwnd) this.windowBridge.setHostBounds(state.hostHwnd, bounds);
    this.store.patchState(profileId, { bounds });
    return this.getState(profileId);
  }
  async focus(profileId) {
    const state = this.store.getState(profileId);
    return state?.browserHwnd ? this.windowBridge.focusChildWindow(state.browserHwnd) : false;
  }
  async getState(profileId) { const state = this.store.getState(profileId); return state ? { ...state } : null; }
  getReadyInstance(profileId) {
    const id = String(profileId || '').trim();
    const state = this.store.getState(id);
    const instance = this.instances.get(id);
    if (!instance || !state || ![RUNTIME_STATUS.READY, RUNTIME_STATUS.HIDDEN].includes(state.status)) {
      const error = new Error(`Chromium Profile ${id || '<empty>'} 尚未就绪`);
      error.code = 'CHROMIUM_RUNTIME_NOT_READY';
      throw error;
    }
    return instance;
  }

  async reload(profileId) { return this.getReadyInstance(profileId).commandClient.send('reload'); }
  async navigate(profileId, url) {
    return this.getReadyInstance(profileId).commandClient.send('navigate', { url: String(url || '') }, { timeoutMs: 30000 });
  }

  async importSession(profileId, rawSession = {}) {
    const instance = this.getReadyInstance(profileId);
    const prepared = prepareSessionImport(rawSession);
    const commandClient = instance.commandClient;
    this.logger?.info?.(`[ChromiumRuntime] importSession ${profileId}: clear-session`);
    const clearResult = await commandClient.send('clear-session', {}, { timeoutMs: 30000 });
    let cookieResult = { result: { imported: 0 } };
    if (prepared.cookies.length > 0) {
      this.logger?.info?.(`[ChromiumRuntime] importSession ${profileId}: set-cookies (${prepared.cookies.length})`);
      cookieResult = await commandClient.send('set-cookies', {
        cookies: prepared.cookies,
        targetUrl: prepared.targetUrl,
      }, { timeoutMs: 30000 });
    }
    const storageResults = [];
    for (const entry of prepared.browserStorage) {
      this.logger?.info?.(`[ChromiumRuntime] importSession ${profileId}: set-storage ${entry.origin}`);
      storageResults.push(await commandClient.send('set-storage', {
        ...entry,
        targetUrl: prepared.targetUrl,
      }, { timeoutMs: 30000 }));
    }
    this.logger?.info?.(`[ChromiumRuntime] importSession ${profileId}: navigate ${prepared.targetUrl}`);
    const navigation = await commandClient.send('navigate', {
      url: prepared.targetUrl,
    }, { timeoutMs: 30000 });
    return {
      ok: true,
      profileId: String(profileId),
      targetUrl: prepared.targetUrl,
      cookiesImported: Number(cookieResult?.result?.imported || 0),
      storageOriginsImported: storageResults.length,
      storageResults: storageResults.map((item) => item.result || {}),
      clearResult: clearResult.result || {},
      navigation: navigation.result || {},
    };
  }

  async restart(profileId) {
    const id = String(profileId);
    const instance = this.instances.get(id);
    const state = this.store.getState(id);
    if (!instance || !state) throw new Error(`Chromium Profile ${id} 不存在`);
    const profile = { ...instance.profile };
    const bounds = { ...state.bounds };
    await this.stop(id, { timeoutMs: 3000 });
    return this.launchProfile(profile, bounds);
  }

  async stop(profileId, options = {}) {
    const id = String(profileId);
    const state = this.store.getState(id);
    const instance = this.instances.get(id);
    if (!state) return null;
    if (![RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.STOPPED].includes(state.status)) this.store.transition(id, RUNTIME_STATUS.STOPPING);
    if (instance) {
      instance.expectedExit = true;
      instance.monitor?.stop();
      this.unbindParentWindowFocus(instance);
      try { await instance.commandClient.send('close-browser', {}, { timeoutMs: 3000 }); } catch (_) {}
      const deadline = Date.now() + Math.max(500, Number(options.timeoutMs) || 4000);
      while (instance.child.exitCode === null && Date.now() < deadline) await delay(100);
      if (instance.child.exitCode === null) {
        if (options.force === false) {
          try { instance.child.kill(); } catch (_) {}
        } else {
          await terminateProcessTree(instance.child.pid);
        }
        await waitForChildExit(instance.child, 5000);
      }
      if (instance.child.exitCode === null) {
        const error = new Error(`Chromium Profile ${id} 进程未能在超时内退出`);
        error.code = 'CHROMIUM_PROCESS_EXIT_TIMEOUT';
        throw error;
      }
      try { await instance.commandClient.close(); } catch (_) {}
    }
    if (state.browserHwnd) try { this.windowBridge.detachChildWindow({ hostHwnd: state.hostHwnd, childHwnd: state.browserHwnd }); } catch (_) {}
    if (state.hostHwnd) try { this.windowBridge.destroyHostWindow(state.hostHwnd); } catch (_) {}
    this.instances.delete(id);
    this.store.releaseLock(id);
    this.store.patchState(id, {
      status: RUNTIME_STATUS.STOPPED,
      stoppedAt: Date.now(),
      browserHwnd: null,
      hostHwnd: null,
      pid: 0,
      sessionId: '',
      bridgeConnected: false,
      embedded: false,
    });
    this.emit('state-changed', this.getState(id));
    return this.getState(id);
  }

  async stopAll(options = {}) { return Promise.all(this.store.listStates().filter((s) => s.runtimeType === RUNTIME_TYPES.CHROMIUM).map((s) => this.stop(s.profileId, options))); }

  async cleanupFailedLaunch(profileId, context) {
    const instance = this.instances.get(String(profileId));
    this.unbindParentWindowFocus(instance);
    if (instance?.child && instance.child.exitCode === null) {
      try { instance.child.kill(); } catch (_) {}
    }
    this.instances.delete(String(profileId));
    try { await context.commandClient?.close(); } catch (_) {}
    try { if (context.hostHwnd) this.windowBridge.destroyHostWindow(context.hostHwnd); } catch (_) {}
    this.store.releaseLock(profileId);
    const state = this.store.getState(profileId);
    if (state) this.store.patchState(profileId, {
      status: RUNTIME_STATUS.CRASHED,
      sessionId: '',
      bridgeConnected: false,
      embedded: false,
      lastError: { code: context.error.code || 'CHROMIUM_LAUNCH_FAILED', message: context.error.message },
    });
  }

  markCrashed(profileId, error) {
    const state = this.store.getState(profileId);
    if (!state || [RUNTIME_STATUS.STOPPED, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED].includes(state.status)) return;
    try { this.windowBridge.hideHostWindow(state.hostHwnd); } catch (_) {}
    this.store.patchState(profileId, { status: RUNTIME_STATUS.CRASHED, browserHwnd: null, bridgeConnected: false, embedded: false, lastError: error, crashCount: Number(state.crashCount || 0) + 1 });
    this.emit('crashed', this.getState(profileId));
  }
}

module.exports = { ChromiumRuntime };
