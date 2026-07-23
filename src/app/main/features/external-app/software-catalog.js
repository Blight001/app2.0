'use strict';

const { createHash } = require('crypto');

function publicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    iconText: entry.iconText,
    experimental: entry.experimental === true,
    running: entry.running === true,
  };
}

function runningWindowId(window) {
  const identity = `${String(window.hwnd || '')}:${Number(window.pid || 0)}`;
  return `window-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

function normalizeVisibleWindow(window) {
  const hwnd = String(window?.hwnd || '').trim();
  const pid = Number(window?.pid || 0);
  const title = String(window?.title || '').trim().slice(0, 240);
  if (!/^\d+$/.test(hwnd) || !Number.isInteger(pid) || pid <= 0 || !title) return null;
  const processName = String(window?.processName || '').trim().slice(0, 80);
  return {
    id: runningWindowId({ hwnd, pid }),
    name: title,
    description: processName ? `已打开窗口 · ${processName}` : '已打开的桌面窗口',
    iconText: title.slice(0, 1).toUpperCase(),
    experimental: true,
    running: true,
    existingWindowHwnd: hwnd,
    existingWindowPid: pid,
  };
}

class SoftwareCatalog {
  constructor(options = {}) {
    this.listVisibleWindows = options.listVisibleWindows || (() => []);
    this.runningWindows = new Map();
  }

  listAvailable() {
    return this.refreshRunningWindows().map(publicEntry);
  }

  refreshRunningWindows() {
    let visible = [];
    try {
      visible = this.listVisibleWindows();
    } catch (_) {
      visible = [];
    }
    const next = new Map();
    for (const value of Array.isArray(visible) ? visible : []) {
      const definition = normalizeVisibleWindow(value);
      if (definition && !next.has(definition.id)) next.set(definition.id, definition);
    }
    this.runningWindows = next;
    return [...next.values()];
  }

  getLaunchDefinition(softwareId) {
    const id = String(softwareId || '').trim();
    this.refreshRunningWindows();
    return this.runningWindows.get(id) || null;
  }
}

function createSoftwareCatalog(options) {
  return new SoftwareCatalog(options);
}

module.exports = {
  SoftwareCatalog,
  createSoftwareCatalog,
  normalizeVisibleWindow,
};
