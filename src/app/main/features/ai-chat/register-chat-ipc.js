'use strict';

const { createAiChatService } = require('./ai-chat-service');

function registerAiChatIpc({
  ipc,
  service: providedService,
  resolveService,
  ...deps
}) {
  const service = providedService || createAiChatService(deps);
  const resolve = typeof resolveService === 'function'
    ? resolveService
    : () => service;
  ipc.handle('ai-control-chat-insert', (event, input = {}) => (
    resolve(event).insert(event, input)
  ));
  ipc.handle('ai-control-chat-stop', (event, input = {}) => (
    resolve(event).stop(event, input)
  ));
  ipc.handle('ai-control-get-prompt-diagnostics', (event, input = {}) => (
    resolve(event).getPromptDiagnostics(event, input)
  ));
  ipc.handle('ai-control-chat', (event, input = {}) => resolve(event).chat(event, input));
  return service;
}

module.exports = { registerAiChatIpc };
