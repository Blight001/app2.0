const path = require('path');
const { ChromiumRuntime } = require('./chromium-runtime');
const { ChromiumWindowBridge } = require('./chromium-window-bridge');
const { ExternalAppRuntime } = require('./external-app-runtime');
const { ProfileRuntimeStore } = require('./profile-runtime-store');
const { cleanupLocalModels } = require('./chromium-local-model-policy');
const { RUNTIME_TYPES } = require('./runtime-types');
const { selectRuntimeFilesByProcessId } = require('./runtime-file-selection');
const { selectRuntimeFiles } = require('./runtime-file-selection');
const {
  MOUSE_ACTIONS,
  dispatchRuntimeAutomation,
  normalizeRuntimeAutomation,
} = require('./runtime-automation');

class BrowserRuntimeManager {
  constructor(options = {}) {
    const userDataDir = options.userDataDir;
    this.logger = options.logger || console;
    this.sandboxDir = options.sandboxDir ? path.resolve(String(options.sandboxDir)) : '';
    this.store = options.store || new ProfileRuntimeStore({
      rootDir: path.join(userDataDir, 'chromium-profiles'),
      downloadsDir: this.sandboxDir,
      logger: this.logger,
    });
    this.localModelCleanup = cleanupLocalModels(this.store.rootDir, this.logger);
    this.windowBridge = options.windowBridge || new ChromiumWindowBridge({
      logger: this.logger,
      resourcesPath: options.resourcesPath,
    });
    this.chromium = options.chromiumRuntime || new ChromiumRuntime({
      logger: this.logger,
      store: this.store,
      windowBridge: this.windowBridge,
      getParentWindow: options.getParentWindow,
      resourcesPath: options.resourcesPath,
    });
    this.externalApp = options.externalAppRuntime || new ExternalAppRuntime({
      logger: this.logger,
      windowBridge: this.windowBridge,
      getParentWindow: options.getParentWindow,
    });
    this.cursorSidecarService = options.cursorSidecarService || null;
  }

  resolveType(profile = {}) {
    // 网页窗口统一使用项目内置的 AI-FREE Chromium Fork。Electron 只承载
    // 应用外壳与侧栏，不能再被选作网页浏览运行时。
    return profile.runtimeType === RUNTIME_TYPES.EXTERNAL_APP
      ? RUNTIME_TYPES.EXTERNAL_APP
      : RUNTIME_TYPES.CHROMIUM;
  }
  runtimeFor(type) {
    return type === RUNTIME_TYPES.EXTERNAL_APP ? this.externalApp : this.chromium;
  }
  setCursorSidecarService(service) { this.cursorSidecarService = service || null; }
  nativeHandleValue(value) {
    const direct = String(
      typeof value === 'string' || typeof value === 'number' ? value : '',
    ).trim();
    if (/^\d+$/.test(direct)) return direct;
    const buffer = Buffer.isBuffer(value)
      ? value
      : value?.getNativeWindowHandle?.();
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
    return buffer.length >= 8
      ? buffer.readBigUInt64LE(0).toString()
      : String(buffer.readUInt32LE(0));
  }
  async syncCursorTarget(profileId, type) {
    const service = this.cursorSidecarService;
    if (!service) return false;
    try {
      const runtime = this.runtimeFor(type);
      const state = await runtime.getState(profileId);
      const instance = runtime.instances?.get?.(String(profileId));
      if (!state?.browserHwnd || !instance) return false;
      const rectPhysical = this.windowBridge.getWindowBounds(state.browserHwnd);
      const ownerHwnd = this.nativeHandleValue(instance.parentHwnd) ||
        this.nativeHandleValue(instance.parentWindow);
      if (!rectPhysical || !ownerHwnd) return false;
      service.bindMainWindow?.(instance.parentWindow);
      return await service.registerTarget({
        tabId: profileId,
        targetHwnd: state.browserHwnd,
        ownerHwnd,
        rectPhysical,
      });
    } catch (error) {
      this.logger.warn?.(
        '[CursorSidecar] 目标同步失败，浏览器继续运行:',
        error?.message || error,
      );
      return false;
    }
  }
  async launchProfile(profile, bounds) {
    const type = this.resolveType(profile);
    const state = await this.runtimeFor(type).launchProfile(profile, bounds);
    await this.syncCursorTarget(state?.profileId || profile.profileId, type);
    await this.cursorSidecarService?.activateTarget?.(
      state?.profileId || profile.profileId,
    );
    return state;
  }
  async show(profileId, type) {
    const state = await this.runtimeFor(type).show(profileId);
    this.cursorSidecarService?.setTargetVisibility?.(profileId, true);
    await this.syncCursorTarget(profileId, type);
    await this.cursorSidecarService?.activateTarget?.(profileId);
    return state;
  }
  async hide(profileId, type) {
    const state = await this.runtimeFor(type).hide(profileId);
    this.cursorSidecarService?.setTargetVisibility?.(profileId, false);
    return state;
  }
  async resize(profileId, type, bounds) {
    const state = await this.runtimeFor(type).resize(profileId, bounds);
    await this.syncCursorTarget(profileId, type);
    return state;
  }
  async focus(profileId, type) { return this.runtimeFor(type).focus(profileId); }
  releaseFocus(profileId, type) { return this.runtimeFor(type).releaseFocus(profileId); }
  async reload(profileId, type) { return this.runtimeFor(type).reload(profileId); }
  async navigate(profileId, type, url) { return this.runtimeFor(type).navigate?.(profileId, url); }
  async dispatchInput(profileId, input) { return this.chromium.dispatchInput(profileId, input); }
  async dispatchInputByProcessId(processId, input) {
    return this.chromium.dispatchInputByProcessId(processId, input);
  }
  async dispatchAutomationByProcessId(processId, command, input) {
    return this.chromium.dispatchAutomationByProcessId(processId, command, input);
  }
  async dispatchAutomation(profileId, command, input) {
    if (command === 'perform-action' && MOUSE_ACTIONS.has(String(input?.action || ''))) {
      return this.dispatchMouseAutomation(profileId, input);
    }
    return dispatchRuntimeAutomation(this.chromium, profileId, command, input);
  }
  async dispatchMouseAutomation(profileId, input) {
    const payload = normalizeRuntimeAutomation('perform-action', input);
    return this.chromium.enqueueProfileOperation(profileId, async () => {
      const client = this.chromium.getReadyInstance(profileId).commandClient;
      let resolved;
      try {
        resolved = await client.send('resolve-action-target', payload, {
          timeoutMs: payload.timeoutMs + 2000,
        });
      } catch (_) {
        return client.send('perform-action', payload, {
          timeoutMs: payload.timeoutMs + 2000,
        });
      }
      const body = resolved?.result || resolved || {};
      const targetPhysical = body.targetPhysical;
      if (!targetPhysical) {
        return client.send('perform-action', payload, {
          timeoutMs: payload.timeoutMs + 2000,
        });
      }
      const display = await this.cursorSidecarService?.moveAndWait?.(
        profileId, targetPhysical, { durationMs: input?.cursorDurationMs },
      );
      const committed = await client.send('commit-resolved-action', {
        action: payload.action,
        resolvedInput: body.resolvedInput,
      }, { timeoutMs: payload.timeoutMs + 2000 });
      if (display?.sequenceId) {
        const button = payload.action === 'right_click' ? 'right' : 'left';
        this.cursorSidecarService?.feedback?.(
          profileId, display.sequenceId, button,
        );
      }
      return committed;
    });
  }
  async sendChromiumCommand(profileId, command, input, options) {
    return this.chromium.enqueueProfileOperation(profileId, () => (
      this.chromium.getReadyInstance(profileId).commandClient.send(command, input, options)
    ));
  }
  async selectFiles(profileId, selection) {
    return selectRuntimeFiles(this.chromium, profileId, selection, { sandboxDir: this.sandboxDir });
  }
  async selectFilesByProcessId(processId, selection) {
    return selectRuntimeFilesByProcessId(this.chromium, processId, selection, { sandboxDir: this.sandboxDir });
  }
  async importSession(profileId, sessionData) { return this.chromium.importSession(profileId, sessionData); }
  async setCookies(profileId, cookies) { return this.chromium.setCookies(profileId, cookies); }
  async restart(profileId, options) { return this.chromium.restart(profileId, options); }
  async clearData(profileId) { return this.chromium.clearData(profileId); }
  async stop(profileId, type, options) {
    this.cursorSidecarService?.removeTarget?.(profileId);
    return this.runtimeFor(type).stop(profileId, options);
  }
  async stopAll(options) {
    const [chromium, externalApps] = await Promise.all([
      this.chromium.stopAll(options),
      this.externalApp.stopAll(options),
    ]);
    await this.windowBridge.disposeExternalAutomation?.();
    return [...chromium, ...externalApps];
  }
  getState(profileId) {
    return this.externalApp.getState(profileId) || this.store.getState(profileId);
  }
  listStates() { return this.store.listStates(); }
  getCachedBrowserProfile(profileId, cacheKey) {
    return this.store.readBrowserProfileCache?.(profileId, cacheKey) || null;
  }
  cacheBrowserProfile(profileId, cacheKey, profile) {
    return this.store.writeBrowserProfileCache?.(profileId, cacheKey, profile) || false;
  }
  isManagedBrowserProcess(processId) {
    const pid = Number(processId || 0) || 0;
    if (!pid) return false;
    for (const instance of this.chromium.instances.values()) {
      if (Number(instance?.child?.pid || 0) === pid && instance.child.exitCode === null) {
        return true;
      }
    }
    return false;
  }
  deleteProfile(profileId) { return this.store.deleteProfile(profileId); }
  async deleteProfileAsync(profileId) {
    if (typeof this.store.deleteProfileAsync === 'function') {
      return this.store.deleteProfileAsync(profileId);
    }
    return this.store.deleteProfile(profileId);
  }
  async waitForLocalModelCleanup() { return this.localModelCleanup; }
  isChromiumAvailable() { return this.windowBridge.isAvailable(); }
}

function createBrowserRuntimeManager(options) { return new BrowserRuntimeManager(options); }

module.exports = { BrowserRuntimeManager, createBrowserRuntimeManager, RUNTIME_TYPES };
