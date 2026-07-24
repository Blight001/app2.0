'use strict';

const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
const { buildCursorHost, outputFile } = require('./build-cursor-host');

const MAXIMUM_MESSAGE_BYTES = 64 * 1024;

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function encodeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  if (json.length > MAXIMUM_MESSAGE_BYTES) throw new Error('Cursor Host 消息超过 64 KiB');
  const frame = Buffer.allocUnsafe(json.length + 4);
  frame.writeUInt32LE(json.length, 0);
  json.copy(frame, 4);
  return frame;
}

function createFrameDecoder(onMessage) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const size = pending.readUInt32LE(0);
      if (size === 0 || size > MAXIMUM_MESSAGE_BYTES) {
        throw new Error('Cursor Host 返回了非法消息长度');
      }
      if (pending.length < size + 4) return;
      onMessage(JSON.parse(pending.subarray(4, size + 4).toString('utf8')));
      pending = pending.subarray(size + 4);
    }
  };
}

function connectWithRetry(pipePath, attempts = 100) {
  return new Promise((resolve, reject) => {
    const connect = (remaining) => {
      const socket = net.connect(pipePath);
      socket.once('connect', () => resolve(socket));
      socket.once('error', (error) => {
        socket.destroy();
        if (remaining <= 1) reject(error);
        else setTimeout(() => connect(remaining - 1), 20);
      });
    };
    connect(attempts);
  });
}

async function runPrototype() {
  const ownerHwnd = readOption('--owner-hwnd');
  const targetHwnd = readOption('--target-hwnd');
  if (!/^\d+$/.test(ownerHwnd) || !/^\d+$/.test(targetHwnd)) {
    throw new Error('请提供十进制 --owner-hwnd 和 --target-hwnd');
  }
  if (!require('fs').existsSync(outputFile)) buildCursorHost();
  const sessionId = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');
  const pipeName = `ai_free_cursor_${sessionId}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const child = spawn(outputFile, [
    '--pipe', pipeName,
    '--token', token,
    '--session', sessionId,
    '--owner-hwnd', ownerHwnd,
    '--target-hwnd', targetHwnd,
  ], { stdio: 'ignore', windowsHide: true });
  const socket = await connectWithRetry(pipePath);
  socket.on('data', createFrameDecoder((message) => {
    if (message.type === 'ERROR') {
      console.error(`[cursor-prototype] Sidecar 错误: ${message.code}`);
    }
  }));
  socket.write(encodeMessage({
    type: 'HELLO',
    version: '1',
    pid: process.pid,
    token,
    sessionId,
  }));
  let requestId = 0;
  const heartbeat = setInterval(() => {
    if (socket.destroyed) return;
    requestId += 1;
    socket.write(encodeMessage({
      type: 'PING',
      requestId: String(requestId),
      sessionId,
    }));
  }, 100);
  console.log(`[cursor-prototype] 已连接 Sidecar PID ${child.pid}，按 Ctrl+C 退出`);
  const shutdown = () => {
    clearInterval(heartbeat);
    if (!socket.destroyed) {
      socket.end(encodeMessage({ type: 'SHUTDOWN', sessionId }));
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  child.once('exit', (code) => {
    clearInterval(heartbeat);
    socket.destroy();
    process.exitCode = code || 0;
  });
}

if (require.main === module) {
  runPrototype().catch((error) => {
    console.error(`[cursor-prototype] ${error?.stack || error}`);
    process.exitCode = 1;
  });
}

module.exports = { createFrameDecoder, encodeMessage };
