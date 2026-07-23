'use strict';

{
  function closeDialog(dialog) {
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute('aria-hidden', 'true');
  }

  function createAutomationDialogs(options = {}) {
    const dialogs = () => document.querySelectorAll('.automation-dialog');

    function closeAll() {
      dialogs().forEach(closeDialog);
    }

    function open(dialog, openOptions = {}) {
      if (!dialog) return;
      closeAll();
      dialog.hidden = false;
      dialog.setAttribute('aria-hidden', 'false');
      const focusTarget = openOptions.focusTarget || dialog.querySelector('.automation-dialog-close');
      requestAnimationFrame(() => {
        focusTarget?.focus();
        if (openOptions.renderCanvas) options.renderCanvas?.();
      });
    }

    function bind(nodes) {
      nodes.editButton.addEventListener('click', () => {
        open(nodes.editDialog, { focusTarget: nodes.name });
      });
      nodes.jsonButton.addEventListener('click', () => open(nodes.jsonDialog));
      document.querySelectorAll('[data-automation-dialog-close]').forEach((button) => {
        button.addEventListener('click', () => closeDialog(button.closest('.automation-dialog')));
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAll();
      });
    }

    return Object.freeze({ bind, closeAll, open });
  }

  window.AutomationDialogs = Object.freeze({ create: createAutomationDialogs });
}
