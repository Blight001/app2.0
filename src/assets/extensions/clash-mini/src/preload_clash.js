const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  importConfigFile: (payload) => ipcRenderer.invoke('import-config-file', payload),
  pickAndImportConfig: () => ipcRenderer.invoke('pick-and-import-config'),
  startCore: () => ipcRenderer.invoke('start-core'),
  stopCore: () => ipcRenderer.invoke('stop-core'),
  // nodes
  getProxies: () => ipcRenderer.invoke('get-proxies'),
  refreshProvider: () => ipcRenderer.invoke('refresh-provider'),
  testProxies: (names, url, timeout) => ipcRenderer.invoke('test-proxies', names, url, timeout),
  selectProxy: (name) => ipcRenderer.invoke('select-proxy', name),
  selectBestNode: (options) => ipcRenderer.invoke('select-best-node', options),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
  // events
  onCoreStatusChanged: (callback) => {
    ipcRenderer.on('core-status-changed', (_event, data) => callback(data));
  },
  onCoreLog: (callback) => {
    ipcRenderer.on('core-log', (_event, data) => callback(data));
  },
  onRefreshProviderProgress: (callback) => {
    ipcRenderer.on('refresh-provider-progress', (_event, data) => callback(data));
  },
  onSubscriptionUpdated: (callback) => {
    ipcRenderer.on('subscription-updated', (_event, data) => callback(data));
  },
  onAppReady: (callback) => {
    ipcRenderer.on('app-ready', (_event) => callback());
  },
  // API 请求简述事件
  onApiRequestBrief: (callback) => {
    ipcRenderer.on('api-request-brief', (_event, data) => callback(data));
  },
  onApiRequestStart: (callback) => {
    ipcRenderer.on('api-request-start', (_event, data) => callback(data));
  },
  onApiRequestEnd: (callback) => {
    ipcRenderer.on('api-request-end', (_event, data) => callback(data));
  }
});
