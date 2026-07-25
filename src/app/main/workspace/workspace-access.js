'use strict';

const { AppError, fail, ok } = require('../../contracts/ipc-result');
const { WORKSPACE_TYPES } = require('./workspace-registry');

const validTypes = new Set(WORKSPACE_TYPES);

function normalizeAllowedTypes(allowedTypes) {
  const values = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
  if (!values.length || values.some((type) => !validTypes.has(type))) {
    throw new TypeError('allowedTypes 必须包含有效工作域');
  }
  return new Set(values);
}

function denied(message) {
  return fail(new AppError('WORKSPACE_ACCESS_DENIED', message, { retryable: false }));
}

function createWorkspaceAccessGuard(workspaceRegistry) {
  if (typeof workspaceRegistry?.identifySender !== 'function') {
    throw new TypeError('workspaceRegistry 缺少 identifySender');
  }

  function authorize(event, allowedTypes) {
    const allowed = normalizeAllowedTypes(allowedTypes);
    const workspaceType = workspaceRegistry.identifySender(event);
    if (!workspaceType) return denied('IPC 发送方不属于已注册工作域');
    if (!allowed.has(workspaceType)) {
      return denied(`${workspaceType} 工作域无权调用此 IPC`);
    }
    return ok({ workspaceType });
  }

  function wrap(allowedTypes, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler 必须是函数');
    const allowed = normalizeAllowedTypes(allowedTypes);
    return async (event, ...args) => {
      const authorization = authorize(event, [...allowed]);
      if (!authorization.ok) return authorization;
      return handler(event, ...args);
    };
  }

  return Object.freeze({
    authorize,
    identify: (event) => workspaceRegistry.identifySender(event),
    wrap,
  });
}

module.exports = { createWorkspaceAccessGuard };
