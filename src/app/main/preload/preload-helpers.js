'use strict';

function invokeChannel(ipcRenderer, channel) {
  return (data) => ipcRenderer.invoke(channel, data);
}

function sendChannel(ipcRenderer, channel) {
  return (data) => ipcRenderer.send(channel, data);
}

function subscribeChannel(ipcRenderer, channel) {
  return (listener) => {
    if (typeof listener !== 'function') {
      throw new TypeError(`${channel} listener 必须是函数`);
    }
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };
}

function freezeDomains(domains) {
  const frozen = {};
  for (const [name, methods] of Object.entries(domains)) {
    frozen[name] = Object.freeze({ ...methods });
  }
  return Object.freeze(frozen);
}

function createWorkspaceApi(ipcRenderer) {
  return {
    getType: invokeChannel(ipcRenderer, 'workspace-get-type'),
  };
}

function exposeAiFree(contextBridge, domains) {
  contextBridge.exposeInMainWorld('aiFree', freezeDomains(domains));
}

module.exports = {
  createWorkspaceApi,
  exposeAiFree,
  freezeDomains,
  invokeChannel,
  sendChannel,
  subscribeChannel,
};
