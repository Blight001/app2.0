'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const DEFAULT_TIMEOUT_MS = 8000;

class ExternalAppAutomationClient {
  constructor(options = {}) {
    this.bindingPath = String(options.bindingPath || '');
    this.workerPath = options.workerPath
      || path.join(__dirname, 'external-app-automation-worker.js');
    this.Worker = options.Worker || Worker;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new this.Worker(this.workerPath, {
      workerData: { bindingPath: this.bindingPath },
    });
    worker.on('message', (message) => this.receive(message));
    worker.on('error', (error) => this.failAll(error));
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null;
      if (code !== 0) this.failAll(new Error(`软件自动化工作线程异常退出 (${code})`));
    });
    worker.unref?.();
    this.worker = worker;
    return worker;
  }

  execute(method, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`软件自动化操作超时: ${method}`));
      }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, options });
    });
  }

  receive(message) {
    const pending = this.pending.get(Number(message?.id || 0));
    if (!pending) return;
    this.pending.delete(Number(message.id));
    clearTimeout(pending.timer);
    if (message.error) {
      const error = /** @type {Error & {code?: string}} */ (
        new Error(String(message.error.message || '软件自动化失败'))
      );
      if (message.error.code) error.code = message.error.code;
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async dispose() {
    const worker = this.worker;
    this.worker = null;
    this.failAll(new Error('软件自动化工作线程已关闭'));
    if (worker) await worker.terminate();
  }
}

module.exports = { ExternalAppAutomationClient };
