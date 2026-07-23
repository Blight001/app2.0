'use strict';

function errorMessage(error) {
  return error?.message || String(error);
}

function registerExternalAppIPC(ctx) {
  const ipc = ctx.ipc.scope('features/external-app');
  ipc.handle('list-available-software', async () => {
    try {
      return { ok: true, data: ctx.ui.listAvailableSoftware?.() || [] };
    } catch (error) {
      return { ok: false, error: errorMessage(error), data: [] };
    }
  });
  ipc.handle('open-external-software', async (_event, payload = {}) => {
    try {
      const tabId = await ctx.ui.openExternalApp?.(String(payload.softwareId || ''));
      return tabId ? { ok: true, data: { tabId } } : { ok: false, error: '软件嵌入功能不可用' };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}

module.exports = { registerExternalAppIPC };
