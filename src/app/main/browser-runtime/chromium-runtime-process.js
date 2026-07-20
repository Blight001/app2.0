'use strict';

const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  captureChromiumSessionFiles,
  loadStableChromiumSession,
  persistStableChromiumSession,
  restoreChromiumSessionFiles,
  snapshotHasRestorableSession,
} = require('./chromium-launcher');
const { RUNTIME_STATUS } = require('./runtime-types');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sessionSnapshotDigest(snapshot) {
  if (!snapshot?.files?.length) return '';
  const hash = crypto.createHash('sha256');
  for (const file of [...snapshot.files].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(String(file.name || ''));
    hash.update(file.data);
  }
  return hash.digest('hex');
}

async function waitForSettledChromiumSession(paths, timeoutMs = 3000) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 3000);
  let previousDigest = '';
  let stableReads = 0;
  let latestSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = captureChromiumSessionFiles(paths, null);
    const digest = sessionSnapshotDigest(snapshot);
    if (digest && digest === previousDigest) {
      stableReads += 1;
      latestSnapshot = snapshot;
      if (stableReads >= 3) return latestSnapshot;
    } else {
      previousDigest = digest;
      stableReads = digest ? 1 : 0;
      latestSnapshot = snapshot;
    }
    await delay(100);
  }
  return latestSnapshot;
}

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

async function stopChromiumProfile(runtime, profileId, options = {}) {
  const id = String(profileId);
  const state = runtime.store.getState(id);
  const instance = runtime.instances.get(id);
  if (!state) return null;
  if (![RUNTIME_STATUS.STOPPING, RUNTIME_STATUS.STOPPED].includes(state.status)) {
    runtime.store.transition(id, RUNTIME_STATUS.STOPPING);
  }
  if (instance) await shutdownChromiumInstance(runtime, id, instance, options);
  destroyEmbeddedWindow(runtime, state);
  runtime.instances.delete(id);
  runtime.store.releaseLock(id);
  runtime.store.patchState(id, {
    status: RUNTIME_STATUS.STOPPED,
    stoppedAt: Date.now(),
    browserHwnd: null,
    hostHwnd: null,
    pid: 0,
    sessionId: '',
    bridgeConnected: false,
    embedded: false,
  });
  runtime.emit('state-changed', runtime.getState(id));
  return runtime.getState(id);
}

async function shutdownChromiumInstance(runtime, id, instance, options) {
  const preserveSession = options.preserveSession !== false;
  const preCloseSnapshot = preserveSession ? captureChromiumSessionFiles(instance.paths, null) : null;
  const stableSnapshot = preserveSession ? loadStableChromiumSession(instance.paths, runtime.logger) : null;
  instance.expectedExit = true;
  instance.monitor?.stop();
  runtime.unbindParentWindowFocus(instance);
  try { await instance.commandClient.send('close-browser', {}, { timeoutMs: 3000 }); } catch (_) {}
  await waitForGracefulChromiumExit(instance, options);
  if (instance.child.exitCode === null) await forceChromiumExit(instance, options);
  if (instance.child.exitCode === null) throwChromiumExitTimeout(id);
  if (preserveSession) await preserveChromiumSession(runtime, id, instance, preCloseSnapshot, stableSnapshot);
  try { await instance.commandClient.close(); } catch (_) {}
}

async function waitForGracefulChromiumExit(instance, options) {
  const deadline = Date.now() + Math.max(500, Number(options.timeoutMs) || 4000);
  while (instance.child.exitCode === null && Date.now() < deadline) await delay(100);
}

async function forceChromiumExit(instance, options) {
  if (options.force === false) {
    try { instance.child.kill(); } catch (_) {}
  } else {
    await terminateProcessTree(instance.child.pid);
  }
  await waitForChildExit(instance.child, 5000);
}

function throwChromiumExitTimeout(id) {
  const error = /** @type {Error & {code?: string}} */ (new Error(`Chromium Profile ${id} 进程未能在超时内退出`));
  error.code = 'CHROMIUM_PROCESS_EXIT_TIMEOUT';
  throw error;
}

async function preserveChromiumSession(runtime, id, instance, preCloseSnapshot, stableSnapshot) {
  const postCloseSnapshot = await waitForSettledChromiumSession(instance.paths, 3000);
  if (snapshotHasRestorableSession(postCloseSnapshot)) {
    persistStableChromiumSession(instance.paths, postCloseSnapshot, runtime.logger);
    return;
  }
  const recoverySnapshot = snapshotHasRestorableSession(preCloseSnapshot) ? preCloseSnapshot : stableSnapshot;
  if (recoverySnapshot && restoreChromiumSessionFiles(recoverySnapshot, runtime.logger)) {
    persistStableChromiumSession(instance.paths, recoverySnapshot, runtime.logger);
    runtime.logger?.warn?.(`[ChromiumRuntime] ${id} 退出结果无活动标签，已恢复稳定 Session`);
  }
}

function destroyEmbeddedWindow(runtime, state) {
  if (state.browserHwnd) {
    try { runtime.windowBridge.detachChildWindow({ hostHwnd: state.hostHwnd, childHwnd: state.browserHwnd }); } catch (_) {}
  }
  if (state.hostHwnd) {
    try { runtime.windowBridge.destroyHostWindow(state.hostHwnd); } catch (_) {}
  }
}

module.exports = {
  stopChromiumProfile,
  terminateProcessTree,
  waitForChildExit,
  waitForSettledChromiumSession,
};
