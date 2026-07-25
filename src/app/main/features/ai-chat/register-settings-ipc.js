'use strict';

function safe(handler) {
  return async (_event, payload = {}) => {
    try { return await handler(payload, _event); } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  };
}

function registerAiSettingsIpc({
  ipc,
  service,
  resolveService = (_event) => service,
}) {
  ipc.handle('get-ai-control-settings', safe((_payload, event) => (
    resolveService(event).getSettings()
  )));
  ipc.handle('set-ai-control-settings', safe((payload, event) => (
    resolveService(event).setSettings(payload)
  )));
  ipc.handle('get-ai-control-custom-api', safe((_payload, event) => (
    resolveService(event).getCustomApi()
  )));
  ipc.handle('set-ai-control-custom-api', safe((payload, event) => (
    resolveService(event).setCustomApi(payload)
  )));
}

module.exports = { registerAiSettingsIpc };
