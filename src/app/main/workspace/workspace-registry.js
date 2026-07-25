'use strict';

const WORKSPACE_TYPES = Object.freeze(['home', 'browser', 'software']);
const workspaceTypeSet = new Set(WORKSPACE_TYPES);

function assertWorkspaceType(type) {
  if (!workspaceTypeSet.has(type)) {
    throw new TypeError(`未知工作域 '${String(type)}'`);
  }
}

function isDestroyed(target) {
  try {
    return target?.isDestroyed?.() === true;
  } catch (_) {
    return true;
  }
}

function collectSenders(descriptor) {
  const senders = new Set();
  const candidates = [
    descriptor.window?.webContents,
    descriptor.sideView?.webContents,
    ...(Array.isArray(descriptor.webContents) ? descriptor.webContents : []),
  ];
  for (const candidate of candidates) {
    if (candidate) senders.add(candidate);
  }
  return senders;
}

function publicWorkspace(record) {
  if (!record) return null;
  return Object.freeze({
    type: record.type,
    window: record.window,
    sideView: record.sideView,
    status: record.status,
  });
}

function createWorkspaceRegistry({ logger = console } = {}) {
  const records = new Map();

  async function disposeWorkspace(type, { closeWindow = false } = {}) {
    assertWorkspaceType(type);
    const record = records.get(type);
    if (!record) return false;
    records.delete(type);
    record.status = 'disposing';
    try {
      record.window?.removeListener?.('closed', record.onClosed);
      await record.dispose();
    } catch (error) {
      logger.warn?.(`[WorkspaceRegistry] ${type} dispose 失败:`, error?.message || error);
    } finally {
      record.status = 'disposed';
      if (closeWindow && !isDestroyed(record.window)) {
        try { record.window.close?.(); } catch (_) {}
      }
    }
    return true;
  }

  function register(type, descriptor = {}) {
    assertWorkspaceType(type);
    if (!descriptor.window) throw new TypeError(`${type} workspace 缺少 window`);
    if (records.has(type)) throw new Error(`${type} workspace 已注册`);
    const record = {
      type,
      window: descriptor.window,
      sideView: descriptor.sideView || null,
      status: descriptor.status || 'ready',
      dispose: typeof descriptor.dispose === 'function' ? descriptor.dispose : () => {},
      senders: collectSenders(descriptor),
      onClosed: null,
    };
    record.onClosed = () => {
      void disposeWorkspace(type).catch((error) => {
        logger.warn?.(`[WorkspaceRegistry] ${type} 关闭清理失败:`, error?.message || error);
      });
    };
    record.window.once?.('closed', record.onClosed);
    records.set(type, record);
    return publicWorkspace(record);
  }

  function get(type) {
    assertWorkspaceType(type);
    return publicWorkspace(records.get(type));
  }

  function setStatus(type, status) {
    assertWorkspaceType(type);
    const record = records.get(type);
    if (!record) return false;
    record.status = String(status || 'ready');
    return true;
  }

  function identifySender(senderOrEvent) {
    const sender = senderOrEvent?.sender || senderOrEvent;
    if (!sender || isDestroyed(sender)) return null;
    for (const record of records.values()) {
      if (record.senders.has(sender)) return record.type;
    }
    return null;
  }

  async function disposeAll(options) {
    const types = [...records.keys()];
    await Promise.all(types.map((type) => disposeWorkspace(type, options)));
  }

  return Object.freeze({
    register,
    get,
    setStatus,
    identifySender,
    disposeWorkspace,
    disposeAll,
    list: () => WORKSPACE_TYPES.map((type) => get(type)).filter(Boolean),
  });
}

module.exports = { WORKSPACE_TYPES, createWorkspaceRegistry };
