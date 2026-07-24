'use strict';

const { EventEmitter } = require('events');
const { CursorSidecarProcess } = require('./cursor-sidecar-process');
const {
  createCommand,
  normalizePoint,
  normalizeRect,
  normalizeTabId,
} = require('./cursor-sidecar-protocol');

class CursorSidecarService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
    this.process = options.process || new CursorSidecarProcess(options);
    this.client = null;
    this.targets = new Map();
    this.positions = new Map();
    this.sequences = new Map();
    this.pendingArrivals = new Map();
    this.activeTabId = '';
    this.startPromise = null;
    this.restartCount = 0;
    this.boundWindows = new WeakSet();
    this.disabled = process.platform !== 'win32';
    this.bindProcess();
  }

  bindProcess() {
    this.process.on('error', (error) => this.handleFailure(error));
    this.process.on('exit', (event) => {
      this.client = null;
      this.rejectArrivals('Cursor Sidecar 已退出');
      if (!event.expected) void this.restartOnce();
    });
  }

  bindMainWindow(window) {
    if (!window?.on || this.boundWindows.has(window)) return;
    this.boundWindows.add(window);
    for (const eventName of ['hide', 'minimize', 'closed']) {
      window.on(eventName, () => this.suspend());
    }
    for (const eventName of ['show', 'restore', 'focus']) {
      window.on(eventName, () => this.resume());
    }
  }

  async ensureStarted() {
    if (this.disabled) return null;
    if (this.client) return this.client;
    if (!this.startPromise) {
      this.startPromise = this.process.start()
        .then((client) => this.bindClient(client))
        .catch((error) => {
          this.handleFailure(error);
          return null;
        })
        .finally(() => { this.startPromise = null; });
    }
    return this.startPromise;
  }

  bindClient(client) {
    this.client = client;
    client.on('POSITION_SNAPSHOT', (event) => {
      if (event.tabId && event.positionPhysical) {
        const position = normalizePoint(event.positionPhysical);
        this.positions.set(event.tabId, position);
        const target = this.targets.get(event.tabId);
        if (target) target.initialPosition = position;
      }
    });
    client.on('ARRIVED', (event) => this.resolveArrival(event));
    client.on('TARGET_LOST', (event) => {
      if (event.tabId) this.emit('target-lost', { tabId: event.tabId });
    });
    client.on('RENDER_DEVICE_LOST', (event) => {
      this.logger.warn?.('[CursorSidecar] DirectComposition 设备已重建');
      this.emit('render-device-lost', event);
    });
    client.on('ERROR', (event) => {
      this.logger.warn?.('[CursorSidecar] 原生端错误:', event.code || event);
    });
    return client;
  }

  send(type, input = {}) {
    if (!this.client) return false;
    this.client.send(createCommand(type, this.client.sessionId, input));
    return true;
  }

  async registerTarget(input) {
    const tabId = normalizeTabId(input.tabId);
    const target = {
      tabId,
      targetHwnd: String(input.targetHwnd || ''),
      ownerHwnd: String(input.ownerHwnd || ''),
      rectPhysical: normalizeRect(input.rectPhysical),
      initialPosition: normalizePoint(
        this.positions.get(tabId) || input.initialPosition || {
          x: input.rectPhysical.x + input.rectPhysical.width / 2,
          y: input.rectPhysical.y + input.rectPhysical.height / 2,
        },
      ),
    };
    if (!/^\d+$/.test(target.targetHwnd) || !/^\d+$/.test(target.ownerHwnd)) {
      throw new Error('Cursor Sidecar HWND 无效');
    }
    this.targets.set(tabId, target);
    if (!await this.ensureStarted()) return false;
    this.send('REGISTER_TARGET', target);
    if (this.activeTabId === tabId) this.send('ACTIVATE_TARGET', { tabId });
    return true;
  }

  removeTarget(tabIdValue) {
    const tabId = normalizeTabId(tabIdValue);
    this.targets.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = '';
    return this.send('REMOVE_TARGET', { tabId });
  }

  async activateTarget(tabIdValue) {
    const tabId = normalizeTabId(tabIdValue);
    this.activeTabId = tabId;
    if (!await this.ensureStarted()) return false;
    const target = this.targets.get(tabId);
    if (target) this.send('REGISTER_TARGET', target);
    return this.send('ACTIVATE_TARGET', { tabId });
  }

  updateTargetRect(tabIdValue, rectPhysical) {
    const tabId = normalizeTabId(tabIdValue);
    const target = this.targets.get(tabId);
    if (!target) return false;
    target.rectPhysical = normalizeRect(rectPhysical);
    return this.send('UPDATE_TARGET_RECT', {
      tabId,
      rectPhysical: target.rectPhysical,
    });
  }

  async moveAndWait(tabIdValue, targetPhysical, options = {}) {
    const tabId = normalizeTabId(tabIdValue);
    if (!await this.ensureStarted() || !this.targets.has(tabId)) {
      return { displayed: false, reason: 'sidecar_unavailable' };
    }
    const sequenceId = (this.sequences.get(tabId) || 0) + 1;
    this.sequences.set(tabId, sequenceId);
    const requestedDuration = Number(options.durationMs);
    const durationMs = Math.max(
      0,
      Math.min(5000, Number.isFinite(requestedDuration) ? requestedDuration : 180),
    );
    const arrival = this.waitForArrival(tabId, sequenceId, durationMs + 350);
    this.send('MOVE_AUTOMATION', {
      tabId,
      sequenceId,
      targetPhysical: normalizePoint(targetPhysical),
      durationMs,
      easing: String(options.easing || 'ease-out'),
    });
    return arrival;
  }

  feedback(tabIdValue, sequenceId) {
    const tabId = normalizeTabId(tabIdValue);
    return this.send('CLICK_FEEDBACK', {
      tabId,
      sequenceId: Number(sequenceId || this.sequences.get(tabId) || 0),
    });
  }

  waitForArrival(tabId, sequenceId, timeoutMs) {
    const key = `${tabId}:${sequenceId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingArrivals.delete(key);
        resolve({ displayed: false, timedOut: true, tabId, sequenceId });
      }, timeoutMs);
      timer.unref?.();
      this.pendingArrivals.set(key, { resolve, timer });
    });
  }

  resolveArrival(event) {
    const key = `${event.tabId}:${Number(event.sequenceId)}`;
    const pending = this.pendingArrivals.get(key);
    if (!pending) return;
    this.pendingArrivals.delete(key);
    clearTimeout(pending.timer);
    const arrival = {
      displayed: true,
      tabId: event.tabId,
      sequenceId: Number(event.sequenceId),
    };
    pending.resolve(arrival);
    this.emit('arrived', arrival);
  }

  suspend() { return this.send('SUSPEND'); }
  resume() { return this.send('RESUME'); }

  rejectArrivals(reason) {
    for (const pending of this.pendingArrivals.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ displayed: false, reason });
    }
    this.pendingArrivals.clear();
  }

  async restartOnce() {
    if (this.disabled || this.restartCount >= 1) {
      this.disabled = true;
      return;
    }
    this.restartCount += 1;
    const client = await this.ensureStarted();
    if (!client) return;
    for (const target of this.targets.values()) {
      this.send('REGISTER_TARGET', target);
    }
    if (this.activeTabId) this.send('ACTIVATE_TARGET', { tabId: this.activeTabId });
  }

  handleFailure(error) {
    this.logger.warn?.('[CursorSidecar] 显示层不可用，真实输入继续:', error?.message || error);
    this.emit('failure', error);
  }

  async shutdown() {
    this.disabled = true;
    this.rejectArrivals('Cursor Sidecar 已关闭');
    await this.process.stop();
    this.client = null;
  }
}

function createCursorSidecarService(options) {
  return new CursorSidecarService(options);
}

module.exports = { CursorSidecarService, createCursorSidecarService };
