'use strict';

const { createAiModelService } = require('./ai-model-service');
const { createAutomationCardService } = require('./automation-card-service');
const { enrichBrowserConnectionNames } = require('./connection-names');

function normalizeControlSelection(input = {}) {
  const profileId = String(input?.profileId || '').trim();
  const profileIds = [...new Set((Array.isArray(input?.profileIds) ? input.profileIds : [profileId])
    .map((value) => String(value || '').trim()).filter(Boolean))];
  return {
    profileId: profileIds[0] || '',
    profileIds,
    softwareProfileId: String(input?.softwareProfileId || '').trim(),
  };
}

function createAiSupportService(deps = {}) {
  const modelService = createAiModelService(deps);
  const cardService = createAutomationCardService({
    bridge: deps.browserAutomationBridge,
    now: deps.now,
    logger: deps.logger,
    onProgress: deps.onAutomationProgress,
  });

  function getBrowserConnections() {
    const connections = deps.browserAutomationBridge?.listConnections?.() || [];
    const tabs = deps.getTabs?.() || [];
    const runtimeStates = deps.browserRuntimeManager?.listStates?.() || [];
    const activeProfileId = String(deps.getActiveTabId?.() || '');
    const softwareTargets = (
      deps.browserRuntimeManager?.externalApp?.listAutomationTargets?.() || []
    ).map((target) => ({
      profileId: String(target.profileId || ''),
      name: String(target.name || '外部软件'),
      pid: Number(target.pid || 0),
      isActive: String(target.profileId || '') === activeProfileId,
      toolCount: 1,
    }));
    return {
      ok: true,
      connections: enrichBrowserConnectionNames(connections, tabs, runtimeStates),
      softwareTargets,
    };
  }

  async function redeemGiftCode(input = {}) {
    const credentials = deps.readStoreConfigSafe()?.userCredentials || {};
    const key = String(credentials.key || '').trim();
    const deviceId = String(await deps.computeDeviceId() || '').trim();
    const code = String(input.code || '').trim();
    if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
    if (!code) return { ok: false, message: '请输入礼品码' };
    const httpClient = deps.getGlobalHttpClient?.();
    if (!httpClient || typeof httpClient.redeemAIControlGiftCode !== 'function') {
      return { ok: false, message: 'AI 服务尚未就绪' };
    }
    return httpClient.redeemAIControlGiftCode(key, deviceId, code);
  }

  function broadcastBrowserSelection(input = {}) {
    const selection = normalizeControlSelection(input);
    const mainWindow = deps.getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed?.() || mainWindow.webContents?.isDestroyed?.()) return false;
    mainWindow.webContents.send('ai-control-browser-selection-changed', selection);
    return true;
  }

  return {
    broadcastBrowserSelection,
    deleteAutomationCard: cardService.deleteAutomationCard,
    getAutomationCard: cardService.getAutomationCard,
    getAutomationCards: cardService.getAutomationCards,
    getBrowserConnections,
    getModels: modelService.getModels,
    redeemGiftCode,
    runAutomationCard: cardService.runAutomationCard,
    saveAutomationCard: cardService.saveAutomationCard,
    selectAutomationCard: cardService.selectAutomationCard,
    stopAutomationCard: cardService.stopAutomationCard,
  };
}

module.exports = { createAiSupportService };
