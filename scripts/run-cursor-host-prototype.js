'use strict';

const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
const { buildCursorHost, outputFile } = require('./build-cursor-host');
const {
  createFrameDecoder,
  encodeMessage,
} = require('../src/app/main/features/cursor-sidecar/cursor-sidecar-protocol');

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
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
