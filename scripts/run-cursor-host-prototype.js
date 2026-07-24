'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { buildCursorHost, outputFile } = require('./build-cursor-host');
const {
  PROTOCOL_VERSION,
  createFrameDecoder,
  encodeMessage,
} = require('../src/app/main/features/cursor-sidecar/cursor-sidecar-protocol');

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

function command(socket, sessionId, type, input = {}) {
  socket.write(encodeMessage({ type, sessionId, ...input }));
}

function demo(socket, sessionId) {
  command(socket, sessionId, 'SHOW_CURSOR', {
    positionPhysical: { x: 500, y: 350 },
  });
  command(socket, sessionId, 'MOVE_CURSOR', {
    tabId: 'prototype',
    sequenceId: 1,
    targetPhysical: { x: 800, y: 500 },
    durationMs: 600,
    easing: 'ease-in-out',
  });
  setTimeout(() => command(socket, sessionId, 'CLICK_EFFECT', {
    tabId: 'prototype',
    sequenceId: 1,
    button: 'left',
  }), 700);
  setTimeout(() => {
    command(socket, sessionId, 'POINTER_DOWN', { button: 'left' });
    command(socket, sessionId, 'MOVE_CURSOR', {
      tabId: 'prototype',
      sequenceId: 2,
      targetPhysical: { x: 600, y: 650 },
      durationMs: 800,
      easing: 'ease-in-out',
    });
  }, 1100);
  setTimeout(() => {
    command(socket, sessionId, 'POINTER_UP', { button: 'left' });
    command(socket, sessionId, 'CLICK_EFFECT', {
      tabId: 'prototype',
      sequenceId: 2,
      button: 'right',
    });
  }, 2000);
}

async function runPrototype() {
  if (!fs.existsSync(outputFile)) buildCursorHost({ stage: false });
  const sessionId = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');
  const pipeName = `ai_free_cursor_${sessionId}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const child = spawn(outputFile, [
    '--pipe', pipeName,
    '--token', token,
    '--session', sessionId,
  ], { stdio: 'ignore', windowsHide: true });
  const socket = await connectWithRetry(pipePath);
  socket.on('data', createFrameDecoder((message) => {
    if (message.type === 'READY') demo(socket, sessionId);
    if (message.type === 'ERROR') {
      console.error(`[cursor-prototype] Sidecar 错误: ${message.code}`);
    }
  }));
  command(socket, sessionId, 'HELLO', {
    version: PROTOCOL_VERSION,
    pid: process.pid,
    token,
  });
  let requestId = 0;
  const heartbeat = setInterval(() => {
    requestId += 1;
    command(socket, sessionId, 'PING', { requestId: String(requestId) });
  }, 100);
  console.log(`[cursor-prototype] 已连接 UI Cursor PID ${child.pid}，按 Ctrl+C 退出`);
  const shutdown = () => {
    clearInterval(heartbeat);
    if (!socket.destroyed) {
      command(socket, sessionId, 'SHUTDOWN');
      socket.end();
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
