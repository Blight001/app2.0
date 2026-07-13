const { BrowserRuntime } = require('./browser-runtime');
const { createRuntimeState, normalizeBounds, RUNTIME_STATUS, RUNTIME_TYPES } = require('./runtime-types');

class ElectronRuntime extends BrowserRuntime {
  constructor(options = {}) {
    super(options);
    this.entries = new Map();
  }

  register(profileId, view, bounds = {}) {
    const state = createRuntimeState(profileId, RUNTIME_TYPES.ELECTRON, {
      status: RUNTIME_STATUS.READY,
      bounds: normalizeBounds(bounds),
      startedAt: Date.now(),
    });
    this.entries.set(String(profileId), { view, state });
    return state;
  }

  async launchProfile(profile, bounds) {
    if (!profile?.view) throw new Error('ElectronRuntime 需要 BrowserView');
    return this.register(profile.profileId || profile.id, profile.view, bounds);
  }

  async attach(profileId) { return this.getState(profileId); }
  async show(profileId) {
    const entry = this.entries.get(String(profileId));
    if (entry) entry.state.status = RUNTIME_STATUS.READY;
    return entry?.state || null;
  }
  async hide(profileId) {
    const entry = this.entries.get(String(profileId));
    if (entry) entry.state.status = RUNTIME_STATUS.HIDDEN;
    return entry?.state || null;
  }
  async resize(profileId, bounds) {
    const entry = this.entries.get(String(profileId));
    if (!entry) return null;
    entry.state.bounds = normalizeBounds(bounds);
    entry.view?.setBounds?.(entry.state.bounds);
    return entry.state;
  }
  async focus(profileId) { this.entries.get(String(profileId))?.view?.webContents?.focus?.(); }
  async getState(profileId) { return this.entries.get(String(profileId))?.state || null; }
  async reload(profileId) { this.entries.get(String(profileId))?.view?.webContents?.reloadIgnoringCache?.(); }
  async stop(profileId) {
    const entry = this.entries.get(String(profileId));
    if (!entry) return null;
    entry.state.status = RUNTIME_STATUS.STOPPED;
    entry.state.stoppedAt = Date.now();
    this.entries.delete(String(profileId));
    return entry.state;
  }
}

module.exports = { ElectronRuntime };
