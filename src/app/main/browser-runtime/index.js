const path = require('path');
const { ChromiumRuntime } = require('./chromium-runtime');
const { ChromiumWindowBridge } = require('./chromium-window-bridge');
const { ElectronRuntime } = require('./electron-runtime');
const { ProfileRuntimeStore } = require('./profile-runtime-store');
const { normalizeRuntimeType, RUNTIME_TYPES } = require('./runtime-types');

class BrowserRuntimeManager {
  constructor(options = {}) {
    const userDataDir = options.userDataDir;
    this.logger = options.logger || console;
    this.store = options.store || new ProfileRuntimeStore({ rootDir: path.join(userDataDir, 'chromium-profiles'), logger: this.logger });
    this.windowBridge = options.windowBridge || new ChromiumWindowBridge({ logger: this.logger });
    this.electron = options.electronRuntime || new ElectronRuntime({ logger: this.logger });
    this.chromium = options.chromiumRuntime || new ChromiumRuntime({
      logger: this.logger,
      store: this.store,
      windowBridge: this.windowBridge,
      getParentWindow: options.getParentWindow,
      resourcesPath: options.resourcesPath,
    });
  }

  resolveType(profile = {}) {
    return normalizeRuntimeType(profile.runtimeType || process.env.AI_FREE_BROWSER_RUNTIME, RUNTIME_TYPES.ELECTRON);
  }
  runtimeFor(type) { return normalizeRuntimeType(type) === RUNTIME_TYPES.CHROMIUM ? this.chromium : this.electron; }
  async launchProfile(profile, bounds) { return this.runtimeFor(this.resolveType(profile)).launchProfile(profile, bounds); }
  async show(profileId, type) { return this.runtimeFor(type).show(profileId); }
  async hide(profileId, type) { return this.runtimeFor(type).hide(profileId); }
  async resize(profileId, type, bounds) { return this.runtimeFor(type).resize(profileId, bounds); }
  async focus(profileId, type) { return this.runtimeFor(type).focus(profileId); }
  async reload(profileId, type) { return this.runtimeFor(type).reload(profileId); }
  async navigate(profileId, type, url) { return this.runtimeFor(type).navigate?.(profileId, url); }
  async importSession(profileId, sessionData) { return this.chromium.importSession(profileId, sessionData); }
  async setCookies(profileId, cookies) { return this.chromium.setCookies(profileId, cookies); }
  async restart(profileId, options) { return this.chromium.restart(profileId, options); }
  async stop(profileId, type, options) { return this.runtimeFor(type).stop(profileId, options); }
  async stopAll(options) { return this.chromium.stopAll(options); }
  getState(profileId) { return this.store.getState(profileId); }
  listStates() { return this.store.listStates(); }
  deleteProfile(profileId) { return this.store.deleteProfile(profileId); }
  isChromiumAvailable() { return this.windowBridge.isAvailable(); }
}

function createBrowserRuntimeManager(options) { return new BrowserRuntimeManager(options); }

module.exports = { BrowserRuntimeManager, createBrowserRuntimeManager, RUNTIME_TYPES };
