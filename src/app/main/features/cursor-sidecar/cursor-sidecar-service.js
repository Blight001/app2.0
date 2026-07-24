'use strict';

const { EventEmitter } = require('events');
const { CursorSidecarProcess } = require('./cursor-sidecar-process');
const {
  createCommand,
  normalizePoint,
  normalizeRect,
  normalizeTabId,
} = require('./cursor-sidecar-protocol');

function normalizeButton(value) {
  return String(value || 'left').toLowerCase() === 'right' ? 'right' : 'left';
}

class CursorSidecarService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
    this.process = options.process || new CursorSidecarProcess(options);
    this.client = null;
    this.targets = new Map();
    this.positions = new Map();
    this.pendingArrivals = new Map();
    this.activeTabId = '';
    this.nextSequenceId = 0;
    this.hostSuppressed = false;
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
    for (const eventName of ['blur', 'hide', 'minimize', 'closed']) {
      window.on(eventName, () => this.suppressHost());
    }
    for (const eventName of ['show', 'restore', 'focus']) {
      window.on(eventName, () => { void this.restoreHost(); });
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
    client.on('ARRIVED', (event) => this.resolveArrival(event));
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
    const rectPhysical = normalizeRect(input.rectPhysical);
    const previous = this.targets.get(tabId);
    const savedPosition = this.positions.get(tabId);
    const translatedPosition = previous && savedPosition ? {
      x: savedPosition.x + rectPhysical.x - previous.rectPhysical.x,
      y: savedPosition.y + rectPhysical.y - previous.rectPhysical.y,
    } : null;
    const initialPosition = normalizePoint(
      translatedPosition || savedPosition || input.initialPosition || {
        x: rectPhysical.x + rectPhysical.width / 2,
        y: rectPhysical.y + rectPhysical.height / 2,
      },
    );
    this.targets.set(tabId, {
      tabId,
      rectPhysical,
      initialPosition,
      visible: previous?.visible !== false,
      button: previous?.button || '',
    });
    this.positions.set(tabId, initialPosition);
    if (!await this.ensureStarted()) return false;
    if (this.activeTabId === tabId) this.applyActiveTargetState();
    return true;
  }

  removeTarget(tabIdValue) {
    const tabId = normalizeTabId(tabIdValue);
    this.targets.delete(tabId);
    this.positions.delete(tabId);
    if (this.activeTabId !== tabId) return true;
    this.activeTabId = '';
    return this.hideCursor();
  }

  async activateTarget(tabIdValue) {
    const tabId = normalizeTabId(tabIdValue);
    const switching = Boolean(this.activeTabId && this.activeTabId !== tabId);
    this.activeTabId = tabId;
    if (!await this.ensureStarted()) return false;
    return this.applyActiveTargetState(switching);
  }

  updateTargetRect(tabIdValue, rectPhysical) {
    const tabId = normalizeTabId(tabIdValue);
    const target = this.targets.get(tabId);
    if (!target) return false;
    const nextRect = normalizeRect(rectPhysical);
    const position = this.positions.get(tabId);
    if (position) {
      this.positions.set(tabId, normalizePoint({
        x: position.x + nextRect.x - target.rectPhysical.x,
        y: position.y + nextRect.y - target.rectPhysical.y,
      }));
    }
    target.rectPhysical = nextRect;
    target.initialPosition = this.positions.get(tabId);
    if (this.activeTabId === tabId) this.applyActiveTargetState();
    return true;
  }

  setTargetVisibility(tabIdValue, visible) {
    const tabId = normalizeTabId(tabIdValue);
    const target = this.targets.get(tabId);
    if (!target) return false;
    target.visible = Boolean(visible);
    if (this.activeTabId === tabId) this.applyActiveTargetState();
    return true;
  }

  showCursor(positionPhysical) {
    const input = positionPhysical
      ? { positionPhysical: normalizePoint(positionPhysical) }
      : {};
    return this.send('SHOW_CURSOR', input);
  }

  hideCursor() {
    return this.send('HIDE_CURSOR');
  }

  applyActiveTargetState(switching = false) {
    const target = this.targets.get(this.activeTabId);
    if (this.hostSuppressed || !target?.visible) return this.hideCursor();
    if (switching) this.hideCursor();
    const shown = this.showCursor(this.positions.get(this.activeTabId));
    if (target.button) {
      this.send('POINTER_DOWN', { button: target.button });
    }
    return shown;
  }

  async showActiveCursor() {
    if (!this.activeTabId || !await this.ensureStarted()) return false;
    return this.applyActiveTargetState();
  }

  suppressHost() {
    this.hostSuppressed = true;
    return this.hideCursor();
  }

  async restoreHost() {
    this.hostSuppressed = false;
    return this.showActiveCursor();
  }

  async moveAndWait(tabIdValue, targetPhysical, options = {}) {
    const tabId = normalizeTabId(tabIdValue);
    if (!await this.ensureStarted() || !this.targets.has(tabId)) {
      return { displayed: false, reason: 'sidecar_unavailable' };
    }
    const point = normalizePoint(targetPhysical);
    const sequenceId = ++this.nextSequenceId;
    const requestedDuration = Number(options.durationMs);
    const durationMs = Math.max(
      0,
      Math.min(5000, Number.isFinite(requestedDuration) ? requestedDuration : 180),
    );
    this.activeTabId = tabId;
    this.showCursor(this.positions.get(tabId) || point);
    const arrival = this.waitForArrival(tabId, sequenceId, durationMs + 350);
    this.send('MOVE_CURSOR', {
      tabId,
      sequenceId,
      targetPhysical: point,
      durationMs,
      easing: String(options.easing || 'ease-out'),
    });
    const result = await arrival;
    if (result.displayed) this.positions.set(tabId, point);
    return result;
  }

  feedback(tabIdValue, sequenceId, button = 'left') {
    const tabId = normalizeTabId(tabIdValue);
    return this.send('CLICK_EFFECT', {
      tabId,
      sequenceId: Number(sequenceId || this.nextSequenceId || 0),
      button: normalizeButton(button),
    });
  }

  pointerDown(button = 'left') {
    const normalized = normalizeButton(button);
    const target = this.targets.get(this.activeTabId);
    if (target) target.button = normalized;
    return this.send('POINTER_DOWN', { button: normalized });
  }

  pointerUp(button = 'left') {
    const normalized = normalizeButton(button);
    const target = this.targets.get(this.activeTabId);
    if (target?.button === normalized) target.button = '';
    return this.send('POINTER_UP', { button: normalized });
  }

  async dragAndWait(tabIdValue, startPhysical, endPhysical, options = {}) {
    const start = await this.moveAndWait(tabIdValue, startPhysical, {
      durationMs: options.startDurationMs ?? 120,
      easing: options.easing,
    });
    if (!start.displayed) return start;
    this.pointerDown('left');
    try {
      return await this.moveAndWait(tabIdValue, endPhysical, {
        durationMs: options.durationMs ?? 260,
        easing: options.easing || 'ease-in-out',
      });
    } finally {
      this.pointerUp('left');
    }
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
    if (await this.ensureStarted()) this.showActiveCursor();
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

module.exports = {
  CursorSidecarService,
  createCursorSidecarService,
  normalizeButton,
};
