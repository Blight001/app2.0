'use strict';

function configureSoftwareWorkspaceShell() {
  if (window.env?.WORKSPACE_TYPE !== 'software') return;
  document.documentElement.classList.add('software-workspace');
  document.querySelectorAll('[data-workspace-domain="browser"]')
    .forEach((element) => element.remove());
  const emptyState = document.getElementById('browser-empty-state');
  emptyState?.setAttribute('aria-label', '尚未打开软件实例');
  const emptyTitle = document.getElementById('workspace-empty-title');
  const emptyHint = document.getElementById('workspace-empty-hint');
  if (emptyTitle) emptyTitle.textContent = '尚未嵌入软件';
  if (emptyHint) emptyHint.textContent = '请从右侧“软件配置”中选择软件并点击“嵌入”';
}

configureSoftwareWorkspaceShell();
