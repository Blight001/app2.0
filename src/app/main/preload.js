// preload.js

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
const { contextBridge, ipcRenderer } = require('electron');

// Expose all APIs in a single call to avoid conflicts
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  on: (channel, func) => {
    // Deliberately strip event as it includes `sender`
    const wrapped = (event, ...args) => func(...args);
    ipcRenderer.on(channel, wrapped);
    return wrapped;
  },
  off: (channel, func) => ipcRenderer.removeListener(channel, func),
  removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
});

contextBridge.exposeInMainWorld('env', {
  NODE_ENV: process.env.NODE_ENV || ''
});

contextBridge.exposeInMainWorld('electron', {
  openDreamPage: (payload) => ipcRenderer.invoke('open-dream-page', payload),
  ensureSidebarVisible: () => ipcRenderer.send('ensure-sidebar-visible'),
  startClashMini: (options) => ipcRenderer.invoke('start-clash-mini', options),
  stopClashMini: () => ipcRenderer.invoke('stop-clash-mini'),
  getClashMiniStatus: () => ipcRenderer.invoke('get-clash-mini-status'),
  getAppConsoleHistory: () => ipcRenderer.invoke('get-app-console-history'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  startAppUpdate: (payload) => ipcRenderer.invoke('start-app-update', payload),
});

// --- 监听缩放更新事件并转发到页面上下文 ---
ipcRenderer.on('active-zoom', (event, zoomFactor) => {
  // 通过 postMessage 发送到页面上下文
  window.postMessage({ type: 'active-zoom', zoomFactor }, '*');
});
  
