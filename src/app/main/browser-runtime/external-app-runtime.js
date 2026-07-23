'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { normalizeBounds, RUNTIME_STATUS, RUNTIME_TYPES } = require('./runtime-types');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ExternalAppRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
    this.windowBridge = options.windowBridge;
    this.getParentWindow = options.getParentWindow;
    this.spawn = options.spawn || spawn;
    this.instances = new Map();
    this.states = new Map();
  }

  getState(profileId) {
    const state = this.states.get(String(profileId || ''));
    return state ? { ...state, bounds: { ...state.bounds } } : null;
  }

  getAutomationTarget(profileId) {
    const id = String(profileId || '');
    const state = this.states.get(id);
    const instance = this.instances.get(id);
    if (!state || !instance?.hwnd || ![RUNTIME_STATUS.READY, RUNTIME_STATUS.HIDDEN].includes(state.status)) {
      return null;
    }
    return {
      profileId: id,
      hwnd: instance.hwnd,
      pid: state.pid,
      name: String(instance.profile.displayName || instance.profile.name || '外部软件'),
    };
  }

  listAutomationTargets() {
    const targets = [];
    for (const profileId of this.instances.keys()) {
      const target = this.getAutomationTarget(profileId);
      if (target) targets.push(target);
    }
    return targets;
  }

  async launchProfile(profile = {}, rawBounds = {}) {
    const profileId = String(profile.profileId || '').trim();
    if (!profileId) throw new Error('缺少软件栏目 ID');
    if (this.instances.has(profileId)) return this.show(profileId);
    const executablePath = String(profile.executablePath || '').trim();
    const existingWindowHwnd = String(profile.existingWindowHwnd || '').trim();
    if (!executablePath && !existingWindowHwnd) throw new Error('软件窗口或可执行文件不可用');
    const bounds = normalizeBounds(rawBounds);
    const parentWindow = this.getParentWindow?.();
    if (!parentWindow || parentWindow.isDestroyed?.()) throw new Error('Electron 主窗口不可用');
    const instance = this.createInstance(profileId, profile, bounds, parentWindow);
    try {
      await this.completeLaunch(profileId, instance);
      return this.getState(profileId);
    } catch (error) {
      this.cleanupInstance(profileId, instance, true);
      throw error;
    }
  }

  createInstance(profileId, profile, bounds, parentWindow) {
    const parentHwnd = parentWindow.getNativeWindowHandle();
    const state = {
      profileId,
      runtimeType: RUNTIME_TYPES.EXTERNAL_APP,
      softwareId: String(profile.softwareId || ''),
      status: RUNTIME_STATUS.STARTING,
      pid: 0,
      browserHwnd: null,
      hostHwnd: null,
      embedded: false,
      docked: false,
      bounds,
      lastError: null,
      startedAt: Date.now(),
    };
    const instance = {
      profile: { ...profile, profileId },
      parentWindow,
      parentHwnd,
      child: null,
      hwnd: null,
      healthTimer: null,
      alignmentTimer: null,
      parentEventBindings: [],
      stopping: false,
    };
    this.states.set(profileId, state);
    this.instances.set(profileId, instance);
    return instance;
  }

  async completeLaunch(profileId, instance) {
    const hwnd = await this.resolveTargetWindow(profileId, instance);
    const childPid = this.windowBridge.getWindowProcessId(hwnd);
    if (!childPid) throw new Error('无法确认软件主窗口所属进程');
    this.patchState(profileId, { status: RUNTIME_STATUS.ATTACHING, pid: childPid, browserHwnd: hwnd });
    instance.hwnd = hwnd;
    const docked = this.windowBridge.dockExternalWindow({
      parentHwnd: instance.parentHwnd,
      childHwnd: hwnd,
      childPid,
      ...this.getState(profileId).bounds,
    });
    if (!docked || !this.windowBridge.isExternalWindowDocked(instance.parentHwnd, hwnd)) {
      throw new Error('软件主窗口未能停靠到 AI-FREE');
    }
    this.patchState(profileId, {
      status: RUNTIME_STATUS.READY,
      embedded: true,
      docked: true,
    });
    this.bindParentWindowEvents(profileId, instance);
    this.startHealthMonitor(profileId, instance);
    this.emit('state-changed', this.getState(profileId));
  }

  async resolveTargetWindow(profileId, instance) {
    const existingHwnd = String(instance.profile.existingWindowHwnd || '').trim();
    if (existingHwnd) {
      if (!this.windowBridge.isWindowAlive(existingHwnd)) {
        throw new Error('所选桌面窗口已经关闭，请刷新软件列表');
      }
      const actualPid = this.windowBridge.getWindowProcessId(existingHwnd);
      const expectedPid = Number(instance.profile.existingWindowPid || 0);
      if (!expectedPid || actualPid !== expectedPid) {
        throw new Error('所选桌面窗口身份已变化，请刷新软件列表');
      }
      return existingHwnd;
    }
    instance.child = this.launchProcess(instance.profile);
    return this.waitForMainWindow(profileId, instance);
  }

  launchProcess(profile) {
    return this.spawn(profile.executablePath, Array.isArray(profile.args) ? profile.args : [], {
      cwd: require('path').dirname(profile.executablePath),
      windowsHide: false,
      detached: false,
      stdio: 'ignore',
    });
  }

  async waitForMainWindow(profileId, instance) {
    const timeoutMs = Math.max(3000, Number(instance.profile.launchTimeoutMs) || 20000);
    const startedAt = Date.now();
    this.patchState(profileId, { status: RUNTIME_STATUS.WAITING_WINDOW, pid: instance.child?.pid || 0 });
    while (Date.now() - startedAt < timeoutMs) {
      if (this.instances.get(profileId) !== instance || instance.stopping) {
        throw new Error('软件栏目已在启动过程中关闭');
      }
      const byPid = instance.child?.pid
        ? this.windowBridge.findMainWindowByProcessId(instance.child.pid)
        : null;
      if (byPid) return byPid;
      await delay(100);
    }
    throw new Error(`等待 ${instance.profile.displayName || '软件'} 主窗口超时`);
  }

  startHealthMonitor(profileId, instance) {
    instance.healthTimer = setInterval(() => {
      if (instance.stopping) return;
      if (instance.hwnd && this.windowBridge.isWindowAlive(instance.hwnd)) {
        if (this.states.get(profileId)?.status === RUNTIME_STATUS.READY) {
          this.alignInstance(profileId, instance);
        }
        return;
      }
      this.markCrashed(profileId, new Error('嵌入的软件窗口已关闭'));
    }, 500);
    instance.healthTimer.unref?.();
  }

  bindParentWindowEvents(profileId, instance) {
    const bind = (eventName, handler) => {
      instance.parentWindow.on?.(eventName, handler);
      instance.parentEventBindings.push([eventName, handler]);
    };
    for (const eventName of ['move', 'resize', 'restore', 'maximize', 'unmaximize', 'show']) {
      bind(eventName, () => this.scheduleAlignment(profileId, instance));
    }
    for (const eventName of ['hide', 'minimize']) {
      bind(eventName, () => this.hideDockedWindow(instance));
    }
  }

  unbindParentWindowEvents(instance) {
    for (const [eventName, handler] of instance.parentEventBindings) {
      instance.parentWindow.off?.(eventName, handler);
    }
    instance.parentEventBindings = [];
    if (instance.alignmentTimer) clearTimeout(instance.alignmentTimer);
    instance.alignmentTimer = null;
  }

  scheduleAlignment(profileId, instance) {
    if (instance.stopping || instance.alignmentTimer) return;
    instance.alignmentTimer = setTimeout(() => {
      instance.alignmentTimer = null;
      this.alignInstance(profileId, instance);
    }, 16);
    instance.alignmentTimer.unref?.();
  }

  alignInstance(profileId, instance) {
    const state = this.states.get(profileId);
    if (!state || state.status !== RUNTIME_STATUS.READY
        || !instance.hwnd || instance.parentWindow.isDestroyed?.()
        || instance.parentWindow.isMinimized?.()
        || instance.parentWindow.isVisible?.() === false) return false;
    try {
      return this.windowBridge.dockExternalWindow({
        parentHwnd: instance.parentHwnd,
        childHwnd: instance.hwnd,
        childPid: state.pid,
        ...state.bounds,
      });
    } catch (error) {
      this.logger.warn?.('[ExternalApp] 对齐软件窗口失败:', error?.message || error);
      return false;
    }
  }

  hideDockedWindow(instance) {
    try {
      if (instance.hwnd) this.windowBridge.hideDockedExternalWindow(instance.hwnd);
    } catch (error) {
      this.logger.warn?.('[ExternalApp] 隐藏软件窗口失败:', error?.message || error);
    }
  }

  patchState(profileId, patch) {
    const state = this.states.get(profileId);
    if (state) Object.assign(state, patch);
  }

  async show(profileId) {
    const id = String(profileId || '');
    const state = this.states.get(id);
    const instance = this.instances.get(id);
    if (!state || !instance) return this.getState(profileId);
    if (state.status === RUNTIME_STATUS.HIDDEN) state.status = RUNTIME_STATUS.READY;
    this.alignInstance(id, instance);
    return this.getState(profileId);
  }

  async hide(profileId) {
    const id = String(profileId || '');
    const state = this.states.get(id);
    const instance = this.instances.get(id);
    if (!state || !instance) return this.getState(profileId);
    this.hideDockedWindow(instance);
    if (state.status === RUNTIME_STATUS.READY) state.status = RUNTIME_STATUS.HIDDEN;
    return this.getState(profileId);
  }

  async resize(profileId, rawBounds) {
    const state = this.states.get(String(profileId || ''));
    if (!state) return null;
    state.bounds = normalizeBounds(rawBounds);
    const instance = this.instances.get(String(profileId || ''));
    if (instance) this.alignInstance(String(profileId || ''), instance);
    return this.getState(profileId);
  }

  async focus(profileId) {
    const state = this.states.get(String(profileId || ''));
    return state?.browserHwnd ? this.windowBridge.focusChildWindow(state.browserHwnd) : false;
  }

  releaseFocus(profileId) {
    const state = this.states.get(String(profileId || ''));
    return state?.browserHwnd ? this.windowBridge.releaseChildWindowFocus(state.browserHwnd) : false;
  }

  async stop(profileId) {
    const id = String(profileId || '');
    const instance = this.instances.get(id);
    if (!instance) return null;
    instance.stopping = true;
    this.patchState(id, { status: RUNTIME_STATUS.STOPPING });
    this.cleanupInstance(id, instance, false);
    return { profileId: id, runtimeType: RUNTIME_TYPES.EXTERNAL_APP, status: RUNTIME_STATUS.STOPPED };
  }

  cleanupInstance(profileId, instance, failed) {
    if (instance.healthTimer) clearInterval(instance.healthTimer);
    this.unbindParentWindowEvents(instance);
    this.restoreInstanceWindow(instance);
    this.instances.delete(profileId);
    if (failed) this.states.delete(profileId);
    else this.states.set(profileId, {
      ...this.states.get(profileId),
      status: RUNTIME_STATUS.STOPPED,
      hostHwnd: null,
      browserHwnd: null,
      embedded: false,
      docked: false,
      stoppedAt: Date.now(),
    });
  }

  restoreInstanceWindow(instance) {
    try {
      if (instance.hwnd) this.windowBridge.restoreExternalWindow(instance.hwnd);
    } catch (error) {
      this.logger.warn?.('[ExternalApp] 恢复软件窗口失败:', error?.message || error);
    }
  }

  markCrashed(profileId, error) {
    const instance = this.instances.get(profileId);
    if (!instance || instance.stopping) return;
    instance.stopping = true;
    this.patchState(profileId, {
      status: RUNTIME_STATUS.CRASHED,
      embedded: false,
      docked: false,
      lastError: error,
    });
    if (instance.healthTimer) clearInterval(instance.healthTimer);
    this.unbindParentWindowEvents(instance);
    this.restoreInstanceWindow(instance);
    this.instances.delete(profileId);
    this.emit('crashed', this.getState(profileId));
  }

  async stopAll() {
    return Promise.all([...this.instances.keys()].map((profileId) => this.stop(profileId)));
  }
}

module.exports = { ExternalAppRuntime };
