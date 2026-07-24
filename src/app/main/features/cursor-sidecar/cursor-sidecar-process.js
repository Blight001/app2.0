'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { resolveCursorAssetPath } = require('../../config/paths');
const { CursorSidecarClient } = require('./cursor-sidecar-client');

function resolveRuntimeCandidates(options = {}) {
  const resourcesPath = String(options.resourcesPath || process.resourcesPath || '').trim();
  const workingDirectory = path.resolve(options.workingDirectory || process.cwd());
  return [...new Set([
    resourcesPath && path.join(resourcesPath, 'cursor-runtime'),
    path.join(workingDirectory, 'resources', 'cursor-runtime'),
  ].filter(Boolean))];
}

function verifyRuntime(directory, fileSystem = fs) {
  const executablePath = path.join(directory, 'ai-free-cursor-host.exe');
  const manifestPath = path.join(directory, 'cursor-runtime-manifest.json');
  if (!fileSystem.existsSync(executablePath) || !fileSystem.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fileSystem.readFileSync(manifestPath, 'utf8'));
  const executable = fileSystem.readFileSync(executablePath);
  const actual = crypto.createHash('sha256').update(executable).digest('hex');
  if (manifest.schemaVersion !== 1 || manifest.protocolVersion !== '1'
      || manifest.executable !== path.basename(executablePath)
      || manifest.sha256 !== actual) {
    const error = /** @type {Error & {code?: string}} */ (
      new Error('Cursor Sidecar manifest 或 SHA-256 校验失败')
    );
    error.code = 'CURSOR_SIDECAR_INTEGRITY_FAILED';
    throw error;
  }
  return { executablePath, manifestPath, manifest };
}

class CursorSidecarProcess extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawn = options.spawn || spawn;
    this.Client = options.Client || CursorSidecarClient;
    this.logger = options.logger || console;
    this.runtimeCandidates = resolveRuntimeCandidates(options);
    this.resourcesPath = options.resourcesPath;
    this.workingDirectory = options.workingDirectory;
    this.child = null;
    this.client = null;
    this.stopping = false;
  }

  resolveRuntime() {
    for (const directory of this.runtimeCandidates) {
      const runtime = verifyRuntime(directory);
      if (runtime) return runtime;
    }
    const error = /** @type {Error & {code?: string, candidates?: string[]}} */ (
      new Error('Cursor Sidecar 运行资源缺失，请执行 npm run build:cursor-host')
    );
    error.code = 'CURSOR_SIDECAR_NOT_BUILT';
    error.candidates = this.runtimeCandidates;
    throw error;
  }

  async start() {
    if (this.client) return this.client;
    const runtime = this.resolveRuntime();
    const sessionId = crypto.randomBytes(16).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const pipeName = `ai_free_cursor_${sessionId}`;
    let cursorAssetPath = '';
    try {
      cursorAssetPath = resolveCursorAssetPath({
        resourcesPath: this.resourcesPath,
        workingDirectory: this.workingDirectory,
      });
    } catch (error) {
      this.logger.warn?.(
        '[CursorSidecar] ANI 资源不可用，使用内置静态指针:',
        error?.message || error,
      );
    }
    this.stopping = false;
    const argumentsList = [
      '--pipe', pipeName,
      '--token', token,
      '--session', sessionId,
    ];
    if (cursorAssetPath) {
      argumentsList.push('--cursor-asset', cursorAssetPath);
    }
    const child = this.spawn(
      runtime.executablePath,
      argumentsList,
      { stdio: 'ignore', windowsHide: true },
    );
    this.child = child;
    child.once('error', (error) => this.emit('error', error));
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.client?.closeSocket?.();
      this.client = null;
      this.emit('exit', { code, signal, expected: this.stopping });
    });
    const client = new this.Client({
      sessionId,
      token,
      pipePath: `\\\\.\\pipe\\${pipeName}`,
    });
    client.on('error', (error) => this.emit('error', error));
    try {
      await client.connect();
    } catch (error) {
      this.stopping = true;
      try { child.kill(); } catch (_) {}
      throw error;
    }
    this.client = client;
    return client;
  }

  async stop(timeoutMs = 1000) {
    this.stopping = true;
    const child = this.child;
    this.client?.close();
    this.client = null;
    if (!child) return;
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    if (this.child === child) {
      try { child.kill(); } catch (_) {}
    }
  }
}

module.exports = {
  CursorSidecarProcess,
  resolveRuntimeCandidates,
  verifyRuntime,
};
