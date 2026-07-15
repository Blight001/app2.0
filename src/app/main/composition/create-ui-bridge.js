const { createAppConsoleBridge } = require('../runtime/app-console');

// 创建/初始化：createUiBridge的具体业务逻辑。
function createUiBridge({ getSideView, getControlPanelWindow, getConsoleWindow }) {
  let sideView = null;
  let controlPanelWindow = null;
  let consoleWindow = null;

  const appConsoleBridge = createAppConsoleBridge({
    historyLimit: 500,
    getSenders: () => {
      sideView = getSideView();
      controlPanelWindow = typeof getControlPanelWindow === 'function' ? getControlPanelWindow() : null;
      consoleWindow = typeof getConsoleWindow === 'function' ? getConsoleWindow() : null;
      const senders = [];
      if (sideView && sideView.webContents && !sideView.webContents.isDestroyed()) {
        senders.push(sideView.webContents);
      }
      if (controlPanelWindow && controlPanelWindow.webContents && !controlPanelWindow.webContents.isDestroyed()) {
        senders.push(controlPanelWindow.webContents);
      }
      if (consoleWindow && consoleWindow.webContents && !consoleWindow.webContents.isDestroyed()) {
        senders.push(consoleWindow.webContents);
      }
      return senders;
    },
    getDebugSenders: () => {
      consoleWindow = typeof getConsoleWindow === 'function' ? getConsoleWindow() : null;
      if (consoleWindow && consoleWindow.webContents && !consoleWindow.webContents.isDestroyed()) {
        return [consoleWindow.webContents];
      }
      return [];
    },
  });

  appConsoleBridge.install();
  // 供底层网络模块使用，刻意不回退到 console.*，避免调试专用日志泄漏到终端。
  global.__APP_DEBUG_CONSOLE_WRITE__ = (level, args) => appConsoleBridge.pushDebugOnly(level, args);
  global.__APP_CONSOLE_HISTORY__ = appConsoleBridge.getHistory;

// 处理：sendToSide的具体业务逻辑。
  function sendToSide(channel, ...args) {
    try {
      let delivered = false;
      sideView = getSideView();
      controlPanelWindow = typeof getControlPanelWindow === 'function' ? getControlPanelWindow() : null;
      if (sideView && sideView.webContents && !sideView.webContents.isDestroyed()) {
        sideView.webContents.send(channel, ...args);
        delivered = true;
      }
      if (controlPanelWindow && controlPanelWindow.webContents && !controlPanelWindow.webContents.isDestroyed()) {
        controlPanelWindow.webContents.send(channel, ...args);
        delivered = true;
      }
      return delivered;
    } catch (_) {
      return false;
    }
  }

  return {
    sendToSide,
    getAppConsoleHistory: () => appConsoleBridge.getHistory(),
    getDebugConsoleHistory: () => appConsoleBridge.getDebugHistory(),
  };
}

module.exports = {
  createUiBridge,
};
