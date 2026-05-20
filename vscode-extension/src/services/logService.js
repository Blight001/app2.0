class LogService {
  constructor({ maxEntries = 300 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.listeners = new Set();
  }

  onEntry(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  getEntries() {
    return this.entries.slice();
  }

  add(level, message, extra = {}) {
    const entry = {
      level: String(level || 'info').toLowerCase(),
      message: String(message || ''),
      timestamp: new Date().toISOString(),
      ...extra,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    for (const listener of this.listeners) {
      try { listener(entry); } catch (_) {}
    }
    return entry;
  }

  debug(message, extra) { return this.add('debug', message, extra); }
  info(message, extra) { return this.add('info', message, extra); }
  warn(message, extra) { return this.add('warn', message, extra); }
  error(message, extra) { return this.add('error', message, extra); }
  success(message, extra) { return this.add('success', message, extra); }
}

module.exports = {
  LogService,
};
