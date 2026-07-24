'use strict';

const MAXIMUM_MESSAGE_BYTES = 64 * 1024;
const PROTOCOL_VERSION = '1';

function encodeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  if (!json.length || json.length > MAXIMUM_MESSAGE_BYTES) {
    throw new Error('Cursor Sidecar 消息超过 64 KiB');
  }
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
      if (!size || size > MAXIMUM_MESSAGE_BYTES) {
        throw new Error('Cursor Sidecar 返回了非法消息长度');
      }
      if (pending.length < size + 4) return;
      const json = pending.subarray(4, size + 4).toString('utf8');
      onMessage(JSON.parse(json));
      pending = pending.subarray(size + 4);
    }
  };
}

function normalizeTabId(value) {
  const result = String(value || '').trim();
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(result)) {
    const error = /** @type {Error & {code?: string}} */ (
      new Error('Cursor Sidecar 栏目 ID 不安全')
    );
    error.code = 'CURSOR_TAB_ID_INVALID';
    throw error;
  }
  return result;
}

function normalizePoint(value = {}) {
  const x = Math.round(Number(value.x));
  const y = Math.round(Number(value.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Cursor Sidecar 需要有效物理坐标');
  }
  return { x, y };
}

function normalizeRect(value = {}) {
  const point = normalizePoint(value);
  const width = Math.round(Number(value.width));
  const height = Math.round(Number(value.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)
      || width <= 0 || height <= 0) {
    throw new Error('Cursor Sidecar 需要有效物理区域');
  }
  return { ...point, width, height };
}

function createCommand(type, sessionId, input = {}) {
  return { type, sessionId, ...input };
}

module.exports = {
  MAXIMUM_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  createCommand,
  createFrameDecoder,
  encodeMessage,
  normalizePoint,
  normalizeRect,
  normalizeTabId,
};
