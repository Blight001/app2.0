// IPC 请求 payload 运行时校验（阶段 2）。
// schema 只描述进程边界允许接收的形状；业务必填、权限和状态规则仍由 domain/service 判断。
// 校验错误不记录实际字段值，避免 API Key、Cookie、礼品码等敏感内容进入日志。
'use strict';

const { AppError } = require('./ipc-result');
const { getRequestSchema } = require('./ipc-channels');

const MAX_ID_LENGTH = 512;
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_LIST_LENGTH = 128;

class IpcPayloadError extends AppError {
  constructor(channel, path, reason) {
    const field = path || 'payload';
    super('IPC_INVALID_PAYLOAD', `请求参数无效：${field} ${reason}`, {
      retryable: false,
      details: { channel, path: field, reason },
    });
    this.name = 'IpcPayloadError';
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(channel, path, reason) {
  throw new IpcPayloadError(channel, path, reason);
}

function objectPayload(channel, payload, { optional = false } = {}) {
  if (payload === undefined && optional) return {};
  if (!isPlainObject(payload)) fail(channel, 'payload', '必须是对象');
  return payload;
}

function stringField(channel, object, key, options = {}) {
  const { required = false, maxLength = MAX_ID_LENGTH } = options;
  const value = object[key];
  if (value === undefined && !required) return;
  if (typeof value !== 'string') fail(channel, key, '必须是字符串');
  if (value.length > maxLength) fail(channel, key, `长度不能超过 ${maxLength}`);
}

function booleanField(channel, object, key) {
  if (object[key] !== undefined && typeof object[key] !== 'boolean') {
    fail(channel, key, '必须是布尔值');
  }
}

function stringListField(channel, object, key) {
  const list = object[key];
  if (list === undefined) return;
  if (!Array.isArray(list)) fail(channel, key, '必须是数组');
  if (list.length > MAX_LIST_LENGTH) fail(channel, key, `数量不能超过 ${MAX_LIST_LENGTH}`);
  if (list.some((item) => typeof item !== 'string' || item.length > MAX_ID_LENGTH)) {
    fail(channel, `${key}[]`, `必须是长度不超过 ${MAX_ID_LENGTH} 的字符串`);
  }
}

function validateHistorySession(channel, session) {
  if (!isPlainObject(session)) fail(channel, 'session', '必须是对象');
  for (const key of ['id', 'title', 'modelId', 'browserConnectionId', 'automationCardId', 'preview']) {
    stringField(channel, session, key, { maxLength: key === 'preview' ? MAX_TEXT_LENGTH : MAX_ID_LENGTH });
  }
  stringListField(channel, session, 'browserConnectionIds');
  if (session.messages !== undefined) {
    if (!Array.isArray(session.messages)) fail(channel, 'session.messages', '必须是数组');
    if (session.messages.length > MAX_LIST_LENGTH) {
      fail(channel, 'session.messages', `数量不能超过 ${MAX_LIST_LENGTH}`);
    }
  }
}

const IPC_PAYLOAD_SCHEMAS = Object.freeze({
  'ai.browser-selection': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'profileId');
    stringListField(channel, input, 'profileIds');
    return input;
  },
  'ai.card-selection': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'id');
    return input;
  },
  'ai.chat-insert': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'requestId');
    stringField(channel, input, 'content', { maxLength: MAX_TEXT_LENGTH });
    return input;
  },
  'ai.chat-stop': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'requestId');
    return input;
  },
  'ai.gift-code': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'code');
    return input;
  },
  'ai.history-create': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    for (const key of ['modelId', 'browserConnectionId', 'automationCardId']) stringField(channel, input, key);
    stringListField(channel, input, 'browserConnectionIds');
    return input;
  },
  'ai.history-id': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'id');
    return input;
  },
  'ai.history-rename': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    stringField(channel, input, 'id');
    stringField(channel, input, 'title', { maxLength: MAX_TEXT_LENGTH });
    return input;
  },
  'ai.history-save': (channel, payload) => {
    const input = objectPayload(channel, payload, { optional: true });
    booleanField(channel, input, 'setCurrent');
    validateHistorySession(channel, input.session === undefined ? input : input.session);
    return input;
  },
});

function hasIpcPayloadSchema(schemaName) {
  return typeof IPC_PAYLOAD_SCHEMAS[schemaName] === 'function';
}

function validateIpcPayload(channel, payload) {
  const schemaName = getRequestSchema(channel);
  if (!schemaName) return payload;
  const schema = IPC_PAYLOAD_SCHEMAS[schemaName];
  if (!schema) throw new Error(`IPC 通道 '${channel}' 引用了未登记 schema '${schemaName}'`);
  return schema(channel, payload);
}

function wrapLegacyIpcPayload(channel, handler) {
  return async (event, payload, ...rest) => {
    try {
      const validated = validateIpcPayload(channel, payload);
      return await handler(event, validated, ...rest);
    } catch (error) {
      if (!(error instanceof IpcPayloadError)) throw error;
      return { ok: false, code: error.code, message: error.message };
    }
  };
}

function wrapLegacyIpcEventPayload(channel, listener, logger = console) {
  return (event, payload, ...rest) => {
    try {
      const validated = validateIpcPayload(channel, payload);
      return listener(event, validated, ...rest);
    } catch (error) {
      if (!(error instanceof IpcPayloadError)) throw error;
      /** @type {{ path?: string, reason?: string }} */
      const details = error.details && typeof error.details === 'object' ? error.details : {};
      logger.warn?.(`[IPC] ${channel} 请求参数校验失败`, {
        channel,
        errorCode: error.code,
        path: details.path,
        reason: details.reason,
      });
      return undefined;
    }
  };
}

module.exports = {
  IPC_PAYLOAD_SCHEMAS,
  IpcPayloadError,
  hasIpcPayloadSchema,
  validateIpcPayload,
  wrapLegacyIpcPayload,
  wrapLegacyIpcEventPayload,
};
