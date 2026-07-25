'use strict';

const { getChannelDomain } = require('../../contracts/ipc-channels');
const { AppError, fail } = require('../../contracts/ipc-result');

const allowedByDomain = Object.freeze({
  account: Object.freeze(['home', 'browser', 'software']),
  browser: Object.freeze(['browser']),
  license: Object.freeze(['home', 'browser']),
  network: Object.freeze(['browser']),
  software: Object.freeze(['software']),
  ui: Object.freeze(['home', 'browser']),
  updates: Object.freeze(['home', 'browser']),
  workspace: Object.freeze(['home', 'browser', 'software']),
});

function mixedDomainDenied(channel) {
  return fail(new AppError(
    'WORKSPACE_ACCESS_DENIED',
    `${channel} 只能由 Browser 或 Software Workspace 调用`,
    { retryable: false },
  ));
}

function createWorkspaceIpcAuthorizer(workspaceAccess) {
  if (typeof workspaceAccess?.authorize !== 'function') {
    throw new TypeError('workspaceAccess 缺少 authorize');
  }

  return function authorizeWorkspaceIpc(channel, event, kind, args = []) {
    const domain = getChannelDomain(channel, kind);
    if (domain === 'ai' || domain === 'automation') {
      const senderType = workspaceAccess.identify?.(event);
      const declaredType = args[0]?.workspaceType;
      if (declaredType && declaredType !== senderType) {
        return mixedDomainDenied(channel);
      }
      if (senderType !== 'browser' && senderType !== 'software') {
        return mixedDomainDenied(channel);
      }
      return workspaceAccess.authorize(event, senderType);
    }
    const allowedTypes = allowedByDomain[domain];
    if (!allowedTypes) return mixedDomainDenied(channel);
    return workspaceAccess.authorize(event, allowedTypes);
  };
}

module.exports = { createWorkspaceIpcAuthorizer };
