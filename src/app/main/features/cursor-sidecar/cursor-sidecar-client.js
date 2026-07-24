'use strict';

const { EventEmitter } = require('events');
const net = require('net');
const {
  PROTOCOL_VERSION,
  createFrameDecoder,
  encodeMessage,
} = require('./cursor-sidecar-protocol');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CursorSidecarClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.net = options.net || net;
    this.socket = null;
    this.sessionId = String(options.sessionId || '');
    this.token = String(options.token || '');
    this.pipePath = String(options.pipePath || '');
    this.heartbeat = null;
  }

  async connect(options = {}) {
    const attempts = Math.max(1, Number(options.attempts || 100));
    for (let remaining = attempts; remaining > 0; remaining -= 1) {
      try {
        await this.connectOnce();
        await this.hello(options.helloTimeoutMs || 2000);
        this.startHeartbeat();
        return this;
      } catch (error) {
        this.closeSocket();
        if (remaining === 1) throw error;
        await delay(20);
      }
    }
    return this;
  }

  connectOnce() {
    return new Promise((resolve, reject) => {
      const socket = this.net.connect(this.pipePath);
      socket.once('connect', () => {
        this.bindSocket(socket);
        resolve(undefined);
      });
      socket.once('error', reject);
    });
  }

  bindSocket(socket) {
    this.socket = socket;
    const decode = createFrameDecoder((message) => this.receive(message));
    socket.on('data', (chunk) => {
      try { decode(chunk); } catch (error) { this.emit('error', error); }
    });
    socket.on('error', (error) => this.emit('error', error));
    socket.on('close', () => {
      this.stopHeartbeat();
      if (this.socket === socket) this.socket = null;
      this.emit('disconnect');
    });
  }

  hello(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Cursor Sidecar 握手超时'));
      }, timeoutMs);
      const ready = () => { cleanup(); resolve(undefined); };
      const failed = (event) => {
        cleanup();
        reject(new Error(`Cursor Sidecar 拒绝握手: ${event.code || 'UNKNOWN'}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off('READY', ready);
        this.off('ERROR', failed);
      };
      this.once('READY', ready);
      this.once('ERROR', failed);
      this.send({
        type: 'HELLO',
        version: PROTOCOL_VERSION,
        pid: process.pid,
        token: this.token,
        sessionId: this.sessionId,
      });
    });
  }

  receive(message) {
    if (!message || message.sessionId !== this.sessionId) return;
    this.emit(String(message.type || 'UNKNOWN'), message);
    this.emit('event', message);
  }

  send(message) {
    if (!this.socket || this.socket.destroyed) {
      const error = /** @type {Error & {code?: string}} */ (
        new Error('Cursor Sidecar 尚未连接')
      );
      error.code = 'CURSOR_SIDECAR_DISCONNECTED';
      throw error;
    }
    this.socket.write(encodeMessage(message));
  }

  startHeartbeat() {
    this.stopHeartbeat();
    let requestId = 0;
    this.heartbeat = setInterval(() => {
      try {
        requestId += 1;
        this.send({
          type: 'PING',
          requestId: String(requestId),
          sessionId: this.sessionId,
        });
      } catch (_) {}
    }, 100);
    this.heartbeat.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  closeSocket() {
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
  }

  close() {
    try {
      this.send({ type: 'SHUTDOWN', sessionId: this.sessionId });
    } catch (_) {}
    this.closeSocket();
  }
}

module.exports = { CursorSidecarClient };
