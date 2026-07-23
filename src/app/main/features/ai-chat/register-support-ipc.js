'use strict';

function registerAiSupportIpc({ ipc, service }) {
  ipc.handle('ai-control-get-models', async () => {
    try {
      return await service.getModels();
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipc.handle('ai-control-get-browser-connections', async () => {
    try {
      return service.getBrowserConnections();
    } catch (error) {
      return { ok: false, message: error?.message || String(error), connections: [] };
    }
  });

  ipc.handle('ai-control-redeem-gift-code', async (_event, input = {}) => {
    try {
      return await service.redeemGiftCode(input);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipc.handle('ai-control-get-automation-cards', async () => {
    try {
      return await service.getAutomationCards();
    } catch (error) {
      return { ok: false, message: error?.message || String(error), cards: [], selectedId: '' };
    }
  });

  async function callCardService(method, input) {
    try {
      return await service[method](input || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
  ipc.handle('automation-card-get', (_event, input) => callCardService('getAutomationCard', input));
  ipc.handle('automation-card-save', (_event, input) => callCardService('saveAutomationCard', input));
  ipc.handle('automation-card-delete', (_event, input) => callCardService('deleteAutomationCard', input));
  ipc.handle('automation-card-run', (_event, input) => callCardService('runAutomationCard', input));
  ipc.handle('automation-card-stop', () => callCardService('stopAutomationCard'));

  ipc.on('ai-control-browser-selection-changed', (_event, input = {}) => {
    service.broadcastBrowserSelection(input);
  });

  ipc.handle('ai-control-select-automation-card', async (_event, input = {}) => {
    try {
      return service.selectAutomationCard(input);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });
}

module.exports = { registerAiSupportIpc };
