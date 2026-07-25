'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const {
  createWorkspaceApi,
  exposeAiFree,
  invokeChannel,
  sendChannel,
  subscribeChannel,
} = require('./preload-helpers');

const invokeSoftwareChannel = (channel) => (data = {}) => ipcRenderer.invoke(
  channel,
  { ...data, workspaceType: 'software' },
);

exposeAiFree(contextBridge, {
  software: {
    list: invokeChannel(ipcRenderer, 'list-available-software'),
    open: invokeChannel(ipcRenderer, 'open-external-software'),
  },
  softwareAi: {
    chat: invokeSoftwareChannel('ai-control-chat'),
    chatInsert: invokeSoftwareChannel('ai-control-chat-insert'),
    chatStop: invokeSoftwareChannel('ai-control-chat-stop'),
    getAutomationCards: invokeSoftwareChannel('ai-control-get-automation-cards'),
    getBrowserConnections: invokeSoftwareChannel('ai-control-get-browser-connections'),
    getModels: invokeSoftwareChannel('ai-control-get-models'),
    getPromptDiagnostics: invokeSoftwareChannel('ai-control-get-prompt-diagnostics'),
    getSession: invokeChannel(ipcRenderer, 'account-get-session'),
    getCustomApi: invokeSoftwareChannel('get-ai-control-custom-api'),
    getServerDeviceStatus: invokeSoftwareChannel('get-ai-server-device-status'),
    getSettings: invokeSoftwareChannel('get-ai-control-settings'),
    historyCreate: invokeSoftwareChannel('ai-control-history-create'),
    historyDelete: invokeSoftwareChannel('ai-control-history-delete'),
    historyGet: invokeSoftwareChannel('ai-control-history-get'),
    historyList: invokeSoftwareChannel('ai-control-history-list'),
    historyRename: invokeSoftwareChannel('ai-control-history-rename'),
    historySave: invokeSoftwareChannel('ai-control-history-save'),
    redeemGiftCode: invokeSoftwareChannel('ai-control-redeem-gift-code'),
    selectAutomationCard: invokeSoftwareChannel('ai-control-select-automation-card'),
    setCustomApi: invokeSoftwareChannel('set-ai-control-custom-api'),
    setSettings: invokeSoftwareChannel('set-ai-control-settings'),
    loginServerDevice: invokeSoftwareChannel('login-ai-server-device'),
    logoutServerDevice: invokeSoftwareChannel('logout-ai-server-device'),
    emitBrowserSelectionChanged: sendChannel(
      ipcRenderer,
      'ai-control-browser-selection-changed',
    ),
    onBrowserSelectionChanged: subscribeChannel(
      ipcRenderer,
      'ai-control-browser-selection-changed',
    ),
    onChatEvent: subscribeChannel(ipcRenderer, 'ai-control-chat-event'),
    onServerDeviceStatus: subscribeChannel(ipcRenderer, 'ai-server-device-status'),
  },
  softwareAutomation: {
    deleteCard: invokeSoftwareChannel('automation-card-delete'),
    getCard: invokeSoftwareChannel('automation-card-get'),
    listCards: invokeSoftwareChannel('ai-control-get-automation-cards'),
    runCard: invokeSoftwareChannel('automation-card-run'),
    saveCard: invokeSoftwareChannel('automation-card-save'),
    selectCard: invokeSoftwareChannel('ai-control-select-automation-card'),
    stopCard: invokeSoftwareChannel('automation-card-stop'),
    onProgress: subscribeChannel(ipcRenderer, 'automation-card-progress'),
  },
  workspace: {
    ...createWorkspaceApi(ipcRenderer),
    closeTab: sendChannel(ipcRenderer, 'software-close-tab'),
    reorderTab: sendChannel(ipcRenderer, 'software-reorder-tab'),
    switchTab: sendChannel(ipcRenderer, 'software-switch-tab'),
    toggleSidebar: sendChannel(ipcRenderer, 'software-toggle-sidebar'),
    onTabsUpdated: subscribeChannel(ipcRenderer, 'software-tabs-updated'),
  },
});

contextBridge.exposeInMainWorld('env', Object.freeze({
  NODE_ENV: process.env.NODE_ENV || '',
  WORKSPACE_TYPE: 'software',
}));
