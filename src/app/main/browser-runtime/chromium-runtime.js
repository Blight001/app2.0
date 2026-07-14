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
    // 代理切换会重启 Chromium；账号打开流程同时会导航、注入会话并刷新。
    // 同一个 Profile 的这些操作必须排队，否则重启到一半会被误判为“尚未就绪”。
    this.profileOperationQueues = new Map();
  }

  enqueueProfileOperation(profileId, operation) {
    const id = String(profileId || '').trim();
    const previous = this.profileOperationQueues.get(id) || Promise.resolve();
    const queued = previous.catch(() => {}).then(operation);
    let tracked = null;
    tracked = queued.finally(() => {
      if (this.profileOperationQueues.get(id) === tracked) {
        this.profileOperationQueues.delete(id);
      }
    });
    this.profileOperationQueues.set(id, tracked);
    return tracked;
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
    // Chromium Fork uses an ASCII-only switch API for the handshake Profile ID.
    // Business IDs may contain Chinese text (for example, "豆包::account"), so
    // use the store's normalized filesystem ID only for the bridge protocol.
    const runtimeProfileId = String(paths.id || '').trim();
    this.store.acquireLock(profileId, { runtimeType: RUNTIME_TYPES.CHROMIUM });
    this.store.createState(profileId, RUNTIME_TYPES.CHROMIUM, { bounds, status: RUNTIME_STATUS.STARTING, startedAt: Date.now() });

    let hostHwnd = null;
    let commandClient = null;
    try {
      const parentWindow = this.getParentWindow?.();
      if (!parentWindow || parentWindow.isDestroyed?.()) throw new Error('Electron 主窗口不可用');
      const parentHwnd = parentWindow.getNativeWindowHandle();
      hostHwnd = this.windowBridge.createHostWindow({ parentHwnd, ...bounds });
      // Also hide explicitly so an older packaged native binding cannot expose
      // its black host surface while Chromium is still handshaking.
      this.windowBridge.hideHostWindow(hostHwnd);
      const pipeName = createPipeName(profileId);
      const launchToken = crypto.randomBytes(32).toString('hex');
      commandClient = new ChromiumCommandClient({ profileId: runtimeProfileId, pipeName, launchToken, logger: this.logger });
      await commandClient.listen();
      this.store.transition(profileId, RUNTIME_STATUS.WAITING_PIPE, { hostHwnd, pipeName });

      const profile = { ...rawProfile, profileId };
      const launched = launchChromium({
        profile, paths, bounds, hostHwnd, pipeName, launchToken, runtimeProfileId,
        resourcesPath: this.resourcesPath, executablePath: profile.executablePath, logger: this.logger,
      });
      const child = launched.child;
      commandClient.setExpectedPid(child.pid);
      const instance = {
        profile, paths, child, commandClient, hostHwnd, parentWindow, runtimeProfileId,
        expectedExit: false, monitor: null, parentFocusHandler: null,
        visualSyncTimers: new Set(),
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
        title: 'AI-FREE',
      });
      if (!attached || !this.windowBridge.isChildWindowAttached(hostHwnd, browserHwnd)) {
        const attachError = new Error('外部浏览器未能嵌入 AI-FREE 软件窗口');
        attachError.code = 'CHROMIUM_HWND_ATTACH_FAILED';
        throw attachError;
      }
      this.windowBridge.setChildWindowTitle(browserHwnd, 'AI-FREE');
      this.windowBridge.setHostBounds(hostHwnd, bounds);
      this.windowBridge.showHostWindow(hostHwnd);
      this.store.transition(profileId, RUNTIME_STATUS.READY, {
        productName: 'AI-FREE',
        embedded: true,
        lastHeartbeatAt: Date.now(),
      });
      this.scheduleVisualSync(profileId);
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

  clearVisualSyncTimers(instance) {
    if (!instance?.visualSyncTimers) return;
    for (const timer of instance.visualSyncTimers) clearTimeout(timer);
    instance.visualSyncTimers.clear();
  }

  scheduleVisualSync(profileId, delays = [0, 50, 180, 400]) {
    const instance = this.instances.get(String(profileId || ''));
    if (!instance?.hostHwnd) return;
    this.clearVisualSyncTimers(instance);
    for (const delayMs of delays) {
      const timer = setTimeout(() => {
        instance.visualSyncTimers.delete(timer);
        const state = this.store.getState(profileId);
        if (state?.status !== RUNTIME_STATUS.READY || !state.hostHwnd) return;
        try {
          // Re-apply bounds before showing: Electron may have completed a
          // Run one layout pass after the native child was attached.
          this.windowBridge.setHostBounds(state.hostHwnd, state.bounds);
          this.windowBridge.showHostWindow(state.hostHwnd);
        } catch (error) {
          this.logger?.warn?.(`[ChromiumRuntime] 嵌入窗口首帧同步失败: ${error.message}`);
        }
      }, Math.max(0, Number(delayMs) || 0));
      instance.visualSyncTimers.add(timer);
    }
  }

  bindInstance(profileId, instance) {
    instance.commandClient.on('hello', (message) => {
      this.store.patchState(profileId, { bridgeConnected: true, sessionId: message.sessionId, lastHeartbeatAt: Date.now() });
    });
    instance.commandClient.on('heartbeat', () => this.store.patchState(profileId, { lastHeartbeatAt: Date.now() }));
    // Keep the transport-only ASCII ID out of application-facing runtime events.
    instance.commandClient.on('event', (message) => this.emit('runtime-event', { ...message, profileId }));
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
          this.windowBridge.setHostBounds(state.hostHwnd, state.bounds);
          this.windowBridge.showHostWindow(state.hostHwnd);
          this.scheduleVisualSync(profileId, [40, 160]);
        } catch (error) {
          this.logger?.warn?.(`[ChromiumRuntime] 恢复嵌入窗口 Z-order 失败: ${error.message}`);
        }
      });
    };
    instance.parentFocusHandler = raiseEmbeddedHost;
    parentWindow.on('focus', raiseEmbeddedHost);
  }

  unbindParentWindowFocus(instance) {
    this.clearVisualSyncTimers(instance);
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
    this.windowBridge.setHostBounds(state.hostHwnd, state.bounds);
    this.windowBridge.showHostWindow(state.hostHwnd);
    if (state.status === RUNTIME_STATUS.HIDDEN) this.store.transition(profileId, RUNTIME_STATUS.READY);
    this.scheduleVisualSync(profileId, [0, 50, 180]);
    return this.getState(profileId);
  }
  async hide(profileId) {
    const state = this.store.getState(profileId);
    if (!state?.hostHwnd) return state;
    this.clearVisualSyncTimers(this.instances.get(String(profileId || '')));
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
    if (state.status === RUNTIME_STATUS.READY) {
      this.scheduleVisualSync(profileId, [30, 140]);
    }
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

  async reload(profileId) {
    return this.enqueueProfileOperation(profileId, () => this.reloadNow(profileId));
  }

  async reloadNow(profileId) {
    try {
      return await this.getReadyInstance(profileId).commandClient.send('reload');
    } catch (error) {
      if (error?.code !== 'RUNTIME_COMMAND_TIMEOUT') throw error;
      // The reload command has already reached Chromium. Its response is sent
      // only after the page finishes loading, so a slow site can exceed the
      // bridge deadline even though the refresh itself is proceeding normally.
      this.logger?.warn?.(
        `[ChromiumRuntime] reload ${profileId}: 页面仍在加载，忽略 Runtime Bridge 回包超时`,
      );
      return {
        ok: true,
        result: {
          pending: true,
          timedOut: true,
          message: '页面仍在加载',
        },
      };
    }
  }
  async navigate(profileId, url) {
    return this.enqueueProfileOperation(profileId, () => (
      this.getReadyInstance(profileId).commandClient.send('navigate', { url: String(url || '') }, { timeoutMs: 30000 })
    ));
  }

  async importSession(profileId, rawSession = {}) {
    return this.enqueueProfileOperation(profileId, () => this.importSessionNow(profileId, rawSession));
  }

  async importSessionNow(profileId, rawSession = {}) {
    const instance = this.getReadyInstance(profileId);
    const prepared = prepareSessionImport(rawSession);
    const commandClient = instance.commandClient;
    if (prepared.skippedCookies > 0 || prepared.skippedStorageOrigins > 0) {
      this.logger?.warn?.(
        `[ChromiumRuntime] importSession ${profileId}: 跳过与目标站点无关的数据 `
        + `(Cookie ${prepared.skippedCookies} 个, Storage ${prepared.skippedStorageOrigins} 个)`,
      );
    }
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
    const navigateAfterImport = rawSession.navigateAfterImport !== false;
    let navigation = { result: { skipped: true } };
    if (navigateAfterImport) {
      this.logger?.info?.(`[ChromiumRuntime] importSession ${profileId}: navigate ${prepared.targetUrl}`);
      try {
        navigation = await commandClient.send('navigate', {
          url: prepared.targetUrl,
        }, { timeoutMs: 30000 });
      } catch (error) {
        const message = String(error?.message || '');
        const navigationTimedOut = ['NAVIGATION_TIMEOUT', 'RUNTIME_COMMAND_TIMEOUT'].includes(error?.code);
        const navigationInterrupted = error?.code === 'NAVIGATION_FAILED'
          && (/页面加载失败:\s*-3(?:\s|$)/.test(message) || /ERR_ABORTED/i.test(message));
        if (!navigationTimedOut && !navigationInterrupted) throw error;
        // navigate has already been delivered to Chromium. A slow page can keep
        // loading after the bridge response deadline. ERR_ABORTED (-3) also means
        // that the site replaced this navigation (usually a redirect), not that
        // the destination is unreachable. Neither condition should tear down a
        // valid imported session or turn browser startup into a hard failure.
        this.logger?.warn?.(
          navigationInterrupted
            ? `[ChromiumRuntime] importSession ${profileId}: 页面导航被站点重定向，保留浏览器并等待最终页面`
            : `[ChromiumRuntime] importSession ${profileId}: 页面加载超过等待时间，保留浏览器并继续加载`,
        );
        navigation = {
          result: {
            pending: true,
            timedOut: navigationTimedOut,
            interrupted: navigationInterrupted,
            message: navigationInterrupted
              ? '页面正在重定向，已保留浏览器窗口'
              : '页面仍在加载，已保留浏览器窗口',
          },
        };
      }
    }
    return {
      ok: true,
      profileId: String(profileId),
      targetUrl: prepared.targetUrl,
      cookiesImported: Number(cookieResult?.result?.imported || 0),
      cookiesSkipped: prepared.skippedCookies,
      storageOriginsImported: storageResults.length,
      storageOriginsSkipped: prepared.skippedStorageOrigins,
      storageResults: storageResults.map((item) => item.result || {}),
      clearResult: clearResult.result || {},
      navigation: navigation.result || {},
    };
  }

  async setCookies(profileId, rawCookies = []) {
    return this.enqueueProfileOperation(profileId, () => this.setCookiesNow(profileId, rawCookies));
  }

  async setCookiesNow(profileId, rawCookies = []) {
    const instance = this.getReadyInstance(profileId);
    const groups = new Map();
    for (const cookie of Array.isArray(rawCookies) ? rawCookies : []) {
      let targetUrl = String(cookie?.url || '').trim();
      if (!targetUrl && cookie?.domain) targetUrl = `https://${String(cookie.domain).replace(/^\./, '')}/`;
      try {
        const parsed = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        const key = parsed.origin;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ...cookie, url: targetUrl });
      } catch (_) {}
    }
    let imported = 0;
    let skipped = 0;
    for (const [targetUrl, cookies] of groups) {
      const prepared = prepareSessionImport({ targetUrl, cookies });
      skipped += prepared.skippedCookies;
      if (!prepared.cookies.length) continue;
      const response = await instance.commandClient.send('set-cookies', {
        cookies: prepared.cookies,
        targetUrl: prepared.targetUrl,
      }, { timeoutMs: 30000 });
      imported += Number(response?.result?.imported || 0);
    }
    return { ok: true, imported, skipped };
  }

  async restart(profileId, options = {}) {
    return this.enqueueProfileOperation(profileId, () => this.restartNow(profileId, options));
  }

  async restartNow(profileId, options = {}) {
    const id = String(profileId);
    const instance = this.instances.get(id);
    const state = this.store.getState(id);
    if (!instance || !state) throw new Error(`Chromium Profile ${id} 不存在`);
    const profile = { ...instance.profile };
    const rememberedInitialUrl = String(profile.initialUrl || '');
    const rememberedRestoreLastSession = profile.restoreLastSession === true;
    // 内部重启（插件开关、指纹参数更新）必须只恢复现有会话。若再次把
    // initialUrl 作为命令行参数传给 Chromium，Chrome 会在恢复旧标签后
    // 额外新建同一网址，表现为“记忆页面 + 重复打开”。
    if (options.reopenInitialUrl !== true) {
      profile.initialUrl = '';
      profile.restoreLastSession = true;
    }
    const bounds = { ...state.bounds };
    await this.stop(id, { timeoutMs: 3000 });
    const runtimeState = await this.launchProfile(profile, bounds);
    const restartedInstance = this.instances.get(id);
    if (restartedInstance?.profile) {
      restartedInstance.profile.initialUrl = rememberedInitialUrl;
      restartedInstance.profile.restoreLastSession = rememberedRestoreLastSession;
    }
    return runtimeState;
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
