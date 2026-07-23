'use strict';

const { createHash } = require('crypto');

function publicEntry(entry, iconDataUrl = '') {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    iconDataUrl,
    experimental: entry.experimental === true,
    running: entry.running === true,
  };
}

function runningWindowId(window) {
  const identity = `${String(window.hwnd || '')}:${Number(window.pid || 0)}`;
  return `window-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

function executablePathOf(window) {
  return String(window?.executablePath || '').trim();
}

function normalizeVisibleWindow(window) {
  const hwnd = String(window?.hwnd || '').trim();
  const pid = Number(window?.pid || 0);
  const title = String(window?.title || '').trim().slice(0, 240);
  if (!/^\d+$/.test(hwnd) || !Number.isInteger(pid) || pid <= 0 || !title) return null;
  const processName = String(window?.processName || '').trim().slice(0, 80);
  const executablePath = executablePathOf(window);
  return {
    id: runningWindowId({ hwnd, pid }),
    name: title,
    description: processName || '桌面软件',
    experimental: true,
    running: true,
    existingWindowHwnd: hwnd,
    existingWindowPid: pid,
    executablePath,
  };
}

class SoftwareCatalog {
  constructor(options = {}) {
    this.listVisibleWindows = options.listVisibleWindows || (() => []);
    this.resolveIconDataUrl = options.resolveIconDataUrl || (async () => '');
    this.iconCache = new Map();
    this.runningWindows = new Map();
  }

  async listAvailable() {
    const entries = this.refreshRunningWindows();
    return Promise.all(entries.map(async (entry) => (
      publicEntry(entry, await this.getIconDataUrl(entry.executablePath))
    )));
  }

  async getIconDataUrl(executablePath) {
    if (!executablePath) return '';
    if (!this.iconCache.has(executablePath)) {
      const pending = Promise.resolve(this.resolveIconDataUrl(executablePath))
        .then((value) => String(value || ''))
        .catch(() => '');
      this.iconCache.set(executablePath, pending);
    }
    return this.iconCache.get(executablePath);
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
