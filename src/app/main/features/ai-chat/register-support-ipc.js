'use strict';

function registerAiSupportIpc({ ipc, service, resolveService }) {
  const resolve = typeof resolveService === 'function'
    ? resolveService
    : () => service;
  ipc.handle('ai-control-get-models', async (event) => {
    try {
      return await resolve(event).getModels();
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipc.handle('ai-control-get-browser-connections', async (event) => {
    try {
      return resolve(event).getBrowserConnections();
    } catch (error) {
      return { ok: false, message: error?.message || String(error), connections: [] };
    }
  });

  ipc.handle('ai-control-redeem-gift-code', async (event, input = {}) => {
    try {
      return await resolve(event).redeemGiftCode(input);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipc.handle('ai-control-get-automation-cards', async (event) => {
    try {
      return await resolve(event).getAutomationCards();
    } catch (error) {
      return { ok: false, message: error?.message || String(error), cards: [], selectedId: '' };
    }
  });

  async function callCardService(event, method, input) {
    try {
      return await resolve(event)[method](input || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
  ipc.handle('automation-card-get', (event, input) => callCardService(event, 'getAutomationCard', input));
  ipc.handle('automation-card-save', (event, input) => callCardService(event, 'saveAutomationCard', input));
  ipc.handle('automation-card-delete', (event, input) => callCardService(event, 'deleteAutomationCard', input));
  ipc.handle('automation-card-run', (event, input) => callCardService(event, 'runAutomationCard', input));
  ipc.handle('automation-card-stop', (event) => callCardService(event, 'stopAutomationCard'));

  ipc.on('ai-control-browser-selection-changed', (event, input = {}) => {
    resolve(event).broadcastBrowserSelection(input);
  });

  ipc.handle('ai-control-select-automation-card', async (event, input = {}) => {
    try {
      return resolve(event).selectAutomationCard(input);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });
}

module.exports = { registerAiSupportIpc };
