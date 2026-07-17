// preload：window.electronAPI 契约白名单适配层（阶段 2C）。
// 迁移期策略（方案 §3.2）：未在 contracts/ipc-channels.js 登记的通道
// 仍然放行，但打印废弃告警——先建立可观测性，调用方迁移完成后再改为阻断。
// 注意：push 白名单来自主进程 send 调用的静态扫描，个别经间接引用发送的
// 通道可能漏登记，表现为告警噪音而非功能故障；发现后在 contracts 补登记。
const { contextBridge, ipcRenderer } = require('electron');

// 沙箱化 preload（Electron 20+ 默认 sandbox:true）无法 require 项目内模块，
// 此时降级为纯放行（无白名单校验），不影响功能；sandbox:false 的窗口才有告警能力。
let contractsChecks = null;
try {
  const contracts = require('../contracts/ipc-channels');
  contractsChecks = {
    isRegisteredInvoke: contracts.isRegisteredInvoke,
    isRegisteredEvent: contracts.isRegisteredEvent,
    isRegisteredPush: contracts.isRegisteredPush,
  };
} catch (_) {}
const isRegisteredInvoke = (ch) => (contractsChecks ? contractsChecks.isRegisteredInvoke(ch) : true);
const isRegisteredEvent = (ch) => (contractsChecks ? contractsChecks.isRegisteredEvent(ch) : true);
const isRegisteredPush = (ch) => (contractsChecks ? contractsChecks.isRegisteredPush(ch) : true);

const warned = new Set();
function warnOnce(kind, channel) {
  const key = `${kind}:${channel}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[preload] ${kind} 通道 '${channel}' 未在 contracts/ipc-channels.js 登记（迁移期放行，请补登记）`);
}

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    if (!isRegisteredEvent(channel)) warnOnce('send', channel);
    return ipcRenderer.send(channel, data);
  },
  invoke: (channel, data) => {
    if (!isRegisteredInvoke(channel)) warnOnce('invoke', channel);
    return ipcRenderer.invoke(channel, data);
  },
  on: (channel, func) => {
    if (!isRegisteredPush(channel)) warnOnce('on', channel);
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
