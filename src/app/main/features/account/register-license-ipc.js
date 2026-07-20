'use strict';

function registerLicenseIpc({ ipc, service }) {
  ipc.handle('license-get-device-id', () => service.getDeviceId());
  ipc.handle('get-vip-plans', () => service.getVipPlans());
  ipc.handle('redeem-vip-gift-code', (_event, input = {}) => service.redeemVipGiftCode(input));
  ipc.handle('redeem-wool-gift-code', (_event, input = {}) => service.redeemWoolGiftCode(input));
  ipc.handle('license-get-saved-key', () => service.getSavedKey());
  ipc.handle('license-get-records', () => service.getRecords());
  ipc.handle('license-clear-records', () => service.clearRecords());
  ipc.handle('license-delete-record', (_event, input = {}) => service.deleteRecord(input));
  ipc.handle('license-close-window', async () => ({ ok: true }));
}

module.exports = { registerLicenseIpc };
