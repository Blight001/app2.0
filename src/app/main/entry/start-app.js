const { app } = require('electron');

const { cleanupUpdateStorageRoot } = require('../services/app-updater');
const { initializeRunFileLogger } = require('../utils/logger');

// 启动/打开/显示：startApp的具体业务逻辑。
function startApp() {
  initializeRunFileLogger({ app, prefix: 'run' });
  console.log('[启动] 主进程已加载，准备初始化应用');
  cleanupUpdateStorageRoot(null, console);

  const { startMainApp } = require('../bootstrap');
  startMainApp();
}

startApp();
