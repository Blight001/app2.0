'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const {
  exposeAiFree,
  invokeChannel,
} = require('./preload-helpers');

exposeAiFree(contextBridge, {
  home: {
    openBrowser: invokeChannel(ipcRenderer, 'workspace-open-browser'),
    openSoftware: invokeChannel(ipcRenderer, 'workspace-open-software'),
  },
  account: {
    authenticate: invokeChannel(ipcRenderer, 'account-authenticate'),
    getSession: invokeChannel(ipcRenderer, 'account-get-session'),
    logout: invokeChannel(ipcRenderer, 'account-logout'),
  },
  license: {
    getDeviceId: invokeChannel(ipcRenderer, 'license-get-device-id'),
    getRecords: invokeChannel(ipcRenderer, 'license-get-records'),
    getSavedKey: invokeChannel(ipcRenderer, 'license-get-saved-key'),
  },
  updates: {},
  ui: {},
});
