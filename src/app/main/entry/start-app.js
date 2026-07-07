const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const { initializeRunFileLogger } = require('../utils/logger');

// 停止/关闭/清理：cleanupUpdateStorageRootOnStartup的具体业务逻辑。
function cleanupUpdateStorageRootOnStartup() {
  const targets = [
    path.resolve(
      (() => {
        try {
          return app.getPath('userData');
        } catch (_) {
          return path.resolve(process.cwd(), '.user-data');
        }
      })(),
      'ai-free-update',
    ),
    path.resolve(process.cwd(), 'src', 'assets', 'ai-free-update'),
  ];
  const results = [];

  for (const target of targets) {
    try {
      if (!fs.existsSync(target)) {
        results.push({ ok: true, removed: false, target });
        continue;
      }

      fs.rmSync(target, { recursive: true, force: true });
      console.log('[启动] 已清理更新缓存目录:', target);
      results.push({ ok: true, removed: true, target });
    } catch (error) {
      console.warn('[启动] 清理更新缓存目录失败:', error?.message || error);
      results.push({ ok: false, removed: false, target, message: error?.message || String(error) });
    }
  }

  return {
    ok: results.every((item) => item.ok !== false),
    results,
  };
}

// 启动/打开/显示：startApp的具体业务逻辑。
function startApp() {
  initializeRunFileLogger({ app, prefix: 'run' });
  console.log('[启动] 主进程已加载，准备初始化应用');
  cleanupUpdateStorageRootOnStartup();

  const { createMainApp } = require('../composition/create-main-app');
  const mainApp = createMainApp();
  mainApp.start();
}

startApp();
