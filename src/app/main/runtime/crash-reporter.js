'use strict';

// 该模块只依赖 Node 内置模块，必须在任何业务模块加载前安装。
// 即使 bootstrap/配置/窗口创建阶段直接抛错，也能同步落盘并在下次启动补传。
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');

const REPORT_SCHEMA_VERSION = 1;
const UPLOAD_PATH = '/api/crash-reports';
const RETRY_INTERVAL_MS = 60 * 1000;
const MAX_NATIVE_DUMP_BYTES = 24 * 1024 * 1024;
const MAX_KEPT_SESSION_FILES = 40;

let singleton = null;

function safeString(value, fallback = '') {
  try {
    if (value instanceof Error) return value.stack || value.message || String(value);
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return fallback;
    return util.format(value);
  } catch (_) {
    return fallback;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function makeId() {
  try { return crypto.randomUUID(); } catch (_) {
    return `${Date.now()}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  }
}

function safeAppValue(app, method, fallback = '') {
  try {
    const value = app && typeof app[method] === 'function' ? app[method]() : '';
    return value ? String(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function resolveUserDataDir(app) {
  try {
    const value = app && typeof app.getPath === 'function' ? app.getPath('userData') : '';
    if (value) return value;
  } catch (_) {}
  const appName = safeAppValue(app, 'getName', process.env.ELECTRON_APP_NAME || 'ai-free');
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, appName);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', appName);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}

function writeJsonAtomicSync(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

// 日志必须足够完整才能定位问题，但认证信息绝不能离开设备。
function redactText(value) {
  let text = safeString(value);
  /** @type {Array<[RegExp, string]>} */
  const replacements = [
    [/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"']+/ig, '$1[REDACTED]'],
    [/(cookie\s*[:=]\s*)[^\r\n]+/ig, '$1[REDACTED]'],
    [/(set-cookie\s*[:=]\s*)[^\r\n]+/ig, '$1[REDACTED]'],
    [/(\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|admin[_-]?token|activation[_-]?code)\b\s*["']?\s*[:=]\s*["']?)[^\s,"'};]+/ig, '$1[REDACTED]'],
    [/(\btoken=)[^&\s]+/ig, '$1[REDACTED]'],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text;
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || typeof value === 'function') continue;
    if (/password|cookie|secret|token|authorization|activation.?code/i.test(key)) {
      result[key] = '[REDACTED]';
    } else if (value instanceof Error) {
      result[key] = redactText(value.stack || value.message);
    } else if (typeof value === 'object' && value !== null) {
      try { result[key] = JSON.parse(redactText(JSON.stringify(value))); } catch (_) { result[key] = redactText(value); }
    } else {
      result[key] = typeof value === 'string' ? redactText(value) : value;
    }
  }
  return result;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') || '';
}

class CrashReporterRuntime {
  /** @param {{app?: any, crashReporter?: any, ipcMain?: any}} [dependencies] */
  constructor({ app, crashReporter, ipcMain } = {}) {
    this.app = app;
    this.crashReporter = crashReporter;
    this.ipcMain = ipcMain;
    this.rootDir = path.join(resolveUserDataDir(app), 'crash-reports');
    this.pendingDir = path.join(this.rootDir, 'pending');
    this.sessionsDir = path.join(this.rootDir, 'sessions');
    this.dumpsDir = path.join(this.rootDir, 'dumps');
    this.ensureDirectories();
    this.installationId = this.resolveInstallationId();
    this.sessionId = makeId();
    this.startedAt = isoNow();
    this.sessionPath = path.join(this.sessionsDir, `${this.sessionId}.json`);
    this.currentLogPath = '';
    this.serverBase = '';
    this.startupPhase = 'early-main-load';
    this.flushPromise = null;
    this.heartbeatTimer = null;
    this.fatalCaptureInProgress = false;
    this.cleanExit = false;
    this.capture = this.enqueue.bind(this);
    this.markCleanExit = this.markCleanExit.bind(this);
  }

  ensureDirectories() {
    for (const dir of [this.rootDir, this.pendingDir, this.sessionsDir, this.dumpsDir]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
  }

  resolveInstallationId() {
    const filePath = path.join(this.rootDir, 'installation-id');
    let value = '';
    try { value = String(fs.readFileSync(filePath, 'utf8') || '').trim(); } catch (_) {}
    if (value) return value;
    value = makeId();
    try { fs.writeFileSync(filePath, value, { encoding: 'utf8', flag: 'wx' }); } catch (_) {}
    return value;
  }

  baseMetadata() {
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      installationId: this.installationId,
      sessionId: this.sessionId,
      appName: safeAppValue(this.app, 'getName', 'AI-FREE'),
      appVersion: safeAppValue(this.app, 'getVersion', process.env.npm_package_version || ''),
      isPackaged: Boolean(this.app?.isPackaged),
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: typeof os.version === 'function' ? os.version() : '',
      hostnameHash: crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16),
      processVersions: { ...process.versions },
      locale: Intl.DateTimeFormat().resolvedOptions().locale || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };
  }

  writeSessionState(extra = {}) {
    try {
      writeJsonAtomicSync(this.sessionPath, {
        sessionId: this.sessionId,
        installationId: this.installationId,
        startedAt: this.startedAt,
        lastSeenAt: isoNow(),
        cleanExit: this.cleanExit,
        reportedCrash: false,
        startupPhase: this.startupPhase,
        pid: process.pid,
        logFilePath: this.currentLogPath,
        ...extra,
      });
    } catch (_) {}
  }

  markCurrentSessionReported(reportId) {
    const state = readJsonSafe(this.sessionPath) || {};
    try {
      writeJsonAtomicSync(this.sessionPath, { ...state, reportedCrash: true, reportId, lastSeenAt: isoNow() });
    } catch (_) {}
  }

  buildIncident(type, error, details, options, reportId) {
    const rawError = error instanceof Error ? error : null;
    const message = redactText(firstValue(rawError?.message, safeString(error, type)));
    const stack = redactText(firstValue(rawError?.stack, details.stack));
    return {
      ...this.baseMetadata(),
      reportId,
      type: String(type || 'unknown'),
      severity: options.fatal ? 'fatal' : firstValue(options.severity, 'error'),
      eventTime: isoNow(),
      startupPhase: this.startupPhase,
      pid: process.pid,
      processType: firstValue(options.processType, 'browser'),
      message,
      stack,
      details: normalizeDetails(details),
      logFiles: this.currentLogPath ? [this.currentLogPath] : [],
      sessionStatePath: this.sessionPath,
      dumpDirectory: this.dumpsDir,
    };
  }

  enqueue(type, error, details = {}, options = {}) {
    if (options.fatal && this.fatalCaptureInProgress) return '';
    if (options.fatal) this.fatalCaptureInProgress = true;
    const reportId = makeId();
    try {
      const incident = this.buildIncident(type, error, details, options, reportId);
      writeJsonAtomicSync(path.join(this.pendingDir, `${reportId}.json`), incident);
      this.markCurrentSessionReported(reportId);
      this.appendEmergencyLog(type, incident);
      setImmediate(() => this.flushPendingReports().catch(() => {}));
      return reportId;
    } catch (_) {
      return '';
    } finally {
      if (options.fatal) setImmediate(() => { this.fatalCaptureInProgress = false; });
    }
  }

  appendEmergencyLog(type, incident) {
    try {
      const summary = firstValue(incident.stack, incident.message);
      fs.appendFileSync(path.join(this.rootDir, 'crash-emergency.log'), `[${incident.eventTime}] ${type}: ${summary}\n`, 'utf8');
    } catch (_) {}
  }

  recoverOldSession(oldPath, old) {
    if (!old || old.cleanExit || old.reportedCrash || old.sessionId === this.sessionId) return;
    const reportId = makeId();
    const incident = {
      ...this.baseMetadata(),
      reportId,
      sessionId: firstValue(old.sessionId),
      type: 'abnormal-exit',
      severity: 'fatal',
      eventTime: firstValue(old.lastSeenAt, old.startedAt, isoNow()),
      detectedAt: isoNow(),
      startupPhase: firstValue(old.startupPhase, 'unknown'),
      pid: old.pid || null,
      processType: 'browser',
      message: '软件上次运行未正常退出，可能发生原生崩溃、强制终止或断电',
      stack: '',
      details: { recoverySource: 'session-sentinel', previousStartedAt: firstValue(old.startedAt) },
      logFiles: old.logFilePath ? [old.logFilePath] : [],
      sessionStatePath: oldPath,
      dumpDirectory: this.dumpsDir,
    };
    writeJsonAtomicSync(path.join(this.pendingDir, `${reportId}.json`), incident);
    writeJsonAtomicSync(oldPath, { ...old, reportedCrash: true, reportId, detectedAt: isoNow() });
  }

  recoverAbnormalSessions() {
    try {
      const names = fs.readdirSync(this.sessionsDir).filter((name) => name.endsWith('.json'));
      for (const name of names) {
        const oldPath = path.join(this.sessionsDir, name);
        this.recoverOldSession(oldPath, readJsonSafe(oldPath));
      }
    } catch (_) {}
  }

  startNativeCrashReporter() {
    try {
      this.app?.setPath?.('crashDumps', this.dumpsDir);
      this.crashReporter?.start?.({
        companyName: 'AI-FREE', productName: 'AI-FREE', submitURL: 'http://127.0.0.1/',
        uploadToServer: false, compress: true,
        globalExtra: { installationId: this.installationId, sessionId: this.sessionId },
      });
    } catch (_) {}
  }

  collectNativeDump(incident) {
    try {
      const eventMs = Date.parse(incident.eventTime || '') || Date.now();
      const candidates = fs.readdirSync(this.dumpsDir)
        .filter((name) => /\.(dmp|zip)$/i.test(name))
        .map((name) => this.describeDump(name))
        .filter((item) => Math.abs(item.stat.mtimeMs - eventMs) <= 30 * 60 * 1000)
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      return this.serializeDump(candidates[0]);
    } catch (_) {
      return null;
    }
  }

  describeDump(name) {
    const filePath = path.join(this.dumpsDir, name);
    return { name, filePath, stat: fs.statSync(filePath) };
  }

  serializeDump(dump) {
    if (!dump) return null;
    if (dump.stat.size > MAX_NATIVE_DUMP_BYTES) {
      return { name: dump.name, size: dump.stat.size, omitted: 'native dump exceeds upload limit' };
    }
    return {
      name: dump.name, size: dump.stat.size, encoding: 'base64',
      content: fs.readFileSync(dump.filePath).toString('base64'),
    };
  }

  readLog(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return { name: path.basename(filePath), size: Buffer.byteLength(content), content: redactText(content) };
    } catch (error) {
      return { name: path.basename(filePath || 'run.log'), error: safeString(error?.message || error) };
    }
  }

  collectLogs(incident) {
    const paths = Array.isArray(incident.logFiles) ? incident.logFiles : [];
    const logs = paths.map((filePath) => this.readLog(filePath));
    const emergencyPath = path.join(this.rootDir, 'crash-emergency.log');
    try {
      if (fs.existsSync(emergencyPath)) logs.push(this.readLog(emergencyPath));
    } catch (_) {}
    return logs;
  }

  buildUploadPayload(incident) {
    return {
      ...incident,
      message: redactText(incident.message),
      stack: redactText(incident.stack),
      details: normalizeDetails(incident.details),
      logs: this.collectLogs(incident),
      nativeDump: this.collectNativeDump(incident),
    };
  }

  uploadPayload(payload) {
    return new Promise((resolve, reject) => {
      let target;
      try { target = new URL(`${this.serverBase.replace(/\/+$/, '')}${UPLOAD_PATH}`); } catch (error) { reject(error); return; }
      const body = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
      const transport = target.protocol === 'https:' ? https : http;
      const request = transport.request(target, {
        method: 'POST', timeout: 20000,
        headers: {
          'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length,
          'X-Crash-Report-Id': payload.reportId,
          'User-Agent': `AI-FREE/${payload.appVersion || 'unknown'}`,
        },
      }, (response) => this.receiveUploadResponse(response, resolve, reject));
      request.on('timeout', () => request.destroy(new Error('crash report upload timeout')));
      request.on('error', reject);
      request.end(body);
    });
  }

  receiveUploadResponse(response, resolve, reject) {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) return resolve(true);
      const text = Buffer.concat(chunks).toString('utf8').slice(0, 300);
      return reject(new Error(`crash report upload failed: HTTP ${response.statusCode} ${text}`));
    });
  }

  cleanupOldSessions() {
    try {
      const files = fs.readdirSync(this.sessionsDir).filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, mtime: fs.statSync(path.join(this.sessionsDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const item of files.slice(MAX_KEPT_SESSION_FILES)) fs.unlinkSync(path.join(this.sessionsDir, item.name));
    } catch (_) {}
  }

  async uploadPendingFiles() {
    let uploaded = 0;
    let failed = 0;
    let names = [];
    try { names = fs.readdirSync(this.pendingDir).filter((name) => name.endsWith('.json')).sort(); } catch (_) {}
    for (const name of names) {
      const filePath = path.join(this.pendingDir, name);
      const incident = readJsonSafe(filePath);
      if (!incident?.reportId) continue;
      try {
        await this.uploadPayload(this.buildUploadPayload(incident));
        fs.unlinkSync(filePath);
        uploaded += 1;
      } catch (error) {
        failed += 1;
        try { console.warn('[崩溃上报] 上传失败，稍后自动重试:', error?.message || error); } catch (_) {}
      }
    }
    this.cleanupOldSessions();
    return { uploaded, failed };
  }

  flushPendingReports() {
    if (this.flushPromise) return this.flushPromise;
    if (!this.serverBase) return Promise.resolve({ uploaded: 0, pending: true });
    this.flushPromise = this.uploadPendingFiles().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  attachRunLog(logFilePath) {
    this.currentLogPath = String(logFilePath || '');
    this.writeSessionState();
  }

  setStartupPhase(phase) {
    this.startupPhase = String(phase || 'unknown');
    this.writeSessionState();
  }

  configure(options = {}) {
    this.serverBase = String(options.serverBase || this.serverBase || '').trim().replace(/\/+$/, '');
    this.writeSessionState({ serverBaseConfigured: Boolean(this.serverBase) });
    return this.flushPendingReports();
  }

  markCleanExit() {
    this.cleanExit = true;
    this.writeSessionState({ cleanExit: true, endedAt: isoNow() });
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  installProcessHandlers() {
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      this.enqueue('uncaught-exception', error, { origin }, { fatal: true, processType: 'browser' });
    });
    process.on('unhandledRejection', (reason) => {
      this.enqueue('unhandled-rejection', reason, {}, { severity: 'error', processType: 'browser' });
    });
  }

  installAppHandlers() {
    this.app?.on?.('before-quit', this.markCleanExit);
    this.app?.on?.('render-process-gone', (_event, contents, details) => this.captureRendererGone(contents, details));
    this.app?.on?.('child-process-gone', (_event, details) => this.captureChildGone(details));
    this.app?.on?.('web-contents-created', (_event, contents) => this.watchWebContents(contents));
  }

  captureRendererGone(contents, details = {}) {
    this.enqueue('render-process-gone', details.reason || 'renderer process exited', {
      ...details, url: contents?.getURL?.() || '', webContentsId: contents?.id,
    }, { fatal: ['crashed', 'oom'].includes(details.reason), processType: 'renderer' });
  }

  captureChildGone(details = {}) {
    const type = details.type || 'child';
    const reason = details.reason || 'unknown';
    this.enqueue('child-process-gone', `${type} process exited: ${reason}`, details, {
      fatal: ['crashed', 'oom'].includes(reason), processType: type,
    });
  }

  watchWebContents(contents) {
    contents.on?.('unresponsive', () => this.enqueue('renderer-unresponsive', '渲染进程无响应', {
      url: contents.getURL?.() || '', webContentsId: contents.id,
    }, { severity: 'error', processType: 'renderer' }));
    contents.on?.('preload-error', (_event, preloadPath, error) => this.enqueue('preload-error', error, {
      preloadPath, url: contents.getURL?.() || '', webContentsId: contents.id,
    }, { severity: 'error', processType: 'renderer' }));
  }

  installIpcHandler() {
    this.ipcMain?.on?.('__ai_free_renderer_error__', (event, payload = {}) => {
      this.enqueue('renderer-javascript-error', payload.message || 'renderer JavaScript error', {
        stack: payload.stack || '', source: payload.source || '', line: payload.line || 0,
        column: payload.column || 0, url: event.sender?.getURL?.() || '', webContentsId: event.sender?.id,
      }, { severity: 'error', processType: 'renderer' });
    });
  }

  startTimers() {
    this.heartbeatTimer = setInterval(() => this.writeSessionState(), 15 * 1000);
    this.heartbeatTimer.unref?.();
    this.retryTimer = setInterval(() => this.flushPendingReports().catch(() => {}), RETRY_INTERVAL_MS);
    this.retryTimer.unref?.();
  }

  initialize() {
    this.recoverAbnormalSessions();
    this.writeSessionState();
    this.startNativeCrashReporter();
    this.installProcessHandlers();
    this.installAppHandlers();
    this.installIpcHandler();
    this.startTimers();
    return this;
  }
}

/** @param {Record<string, any>} [dependencies] */
function installEarlyCrashReporter(dependencies = {}) {
  if (singleton) return singleton;
  singleton = new CrashReporterRuntime(dependencies).initialize();
  return singleton;
}

function getCrashReporter() {
  return singleton;
}

module.exports = {
  getCrashReporter,
  installEarlyCrashReporter,
  redactText,
};
