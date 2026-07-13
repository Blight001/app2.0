const RUNTIME_TYPES = Object.freeze({
  ELECTRON: 'electron',
  CHROMIUM: 'chromium',
});

const RUNTIME_STATUS = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  WAITING_PIPE: 'waiting-pipe',
  WAITING_WINDOW: 'waiting-window',
  ATTACHING: 'attaching',
  READY: 'ready',
  HIDDEN: 'hidden',
  CRASHED: 'crashed',
  STOPPING: 'stopping',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [RUNTIME_STATUS.STOPPED]: [RUNTIME_STATUS.STARTING],
  [RUNTIME_STATUS.STARTING]: [RUNTIME_STATUS.WAITING_PIPE, RUNTIME_STATUS.WAITING_WINDOW, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED],
  [RUNTIME_STATUS.WAITING_PIPE]: [RUNTIME_STATUS.WAITING_WINDOW, RUNTIME_STATUS.ATTACHING, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED],
  [RUNTIME_STATUS.WAITING_WINDOW]: [RUNTIME_STATUS.ATTACHING, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED],
  [RUNTIME_STATUS.ATTACHING]: [RUNTIME_STATUS.READY, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED],
  [RUNTIME_STATUS.READY]: [RUNTIME_STATUS.HIDDEN, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED],
  [RUNTIME_STATUS.HIDDEN]: [RUNTIME_STATUS.READY, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.CRASHED],
  [RUNTIME_STATUS.CRASHED]: [RUNTIME_STATUS.STARTING, RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.STOPPED],
  [RUNTIME_STATUS.STOPPING]: [RUNTIME_STATUS.STOPPED, RUNTIME_STATUS.CRASHED],
});

const DEFAULT_BOUNDS = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

function normalizeRuntimeType(value, fallback = RUNTIME_TYPES.ELECTRON) {
  return String(value || '').trim().toLowerCase() === RUNTIME_TYPES.CHROMIUM
    ? RUNTIME_TYPES.CHROMIUM
    : fallback;
}

function normalizeBounds(bounds = {}) {
  return {
    x: Math.max(0, Math.round(Number(bounds.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds.y) || 0)),
    width: Math.max(0, Math.round(Number(bounds.width) || 0)),
    height: Math.max(0, Math.round(Number(bounds.height) || 0)),
  };
}

function createRuntimeState(profileId, runtimeType, patch = {}) {
  return {
    profileId: String(profileId || '').trim(),
    runtimeType: normalizeRuntimeType(runtimeType),
    status: RUNTIME_STATUS.STOPPED,
    pid: 0,
    browserHwnd: null,
    hostHwnd: null,
    parentHwnd: null,
    pipeName: '',
    sessionId: '',
    bridgeConnected: false,
    embedded: false,
    bounds: { ...DEFAULT_BOUNDS },
    dpi: 96,
    lastHeartbeatAt: 0,
    lastError: null,
    startedAt: 0,
    stoppedAt: 0,
    crashCount: 0,
    ...patch,
  };
}

function canTransition(from, to) {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

module.exports = {
  ALLOWED_TRANSITIONS,
  DEFAULT_BOUNDS,
  RUNTIME_STATUS,
  RUNTIME_TYPES,
  canTransition,
  createRuntimeState,
  normalizeBounds,
  normalizeRuntimeType,
};
