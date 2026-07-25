'use strict';

/**
 * @param {Record<string, any>} options
 */
function createWorkspaceAppShellDeps(options) {
  const { getWorkspaceShell, getSoftwareWorkspace } = options || {};
  if (typeof getWorkspaceShell !== 'function') {
    throw new TypeError('缺少 Workspace Shell 访问器');
  }
  if (typeof getSoftwareWorkspace !== 'function') {
    throw new TypeError('缺少 Software Workspace 访问器');
  }

  function requireWorkspaceShell() {
    const workspaceShell = getWorkspaceShell();
    if (!workspaceShell) throw new Error('Workspace Shell 尚未装配');
    return workspaceShell;
  }

  return Object.freeze({
    authorizeIpc: (...args) => requireWorkspaceShell().authorizeIpc(...args),
    bootstrapWorkspaceShell: () => requireWorkspaceShell().bootstrap(),
    deferBrowserBootstrap: true,
    getSoftwareWorkspace,
  });
}

module.exports = { createWorkspaceAppShellDeps };
