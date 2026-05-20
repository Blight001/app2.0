const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 启动/打开/显示：startToonflowBridge的具体业务逻辑。
function startToonflowBridge() {
  const candidates = [
    path.resolve(process.resourcesPath || '', 'resource', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
    path.resolve(path.dirname(process.execPath || ''), 'resources', 'resource', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
  ].filter(Boolean);

  const found = candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (_) { return false; }
  });

  if (!found) {
    console.error('[Toonflow-bridge] 未找到 Toonflow 入口，候选路径:', candidates);
    try { app.exit(1); } catch (_) {}
    return;
  }

  try {
    require(found);
  } catch (error) {
    console.error('[Toonflow-bridge] 启动 Toonflow 失败:', error?.stack || error?.message || error);
    try { app.exit(1); } catch (_) {}
  }
}

if (process.argv.some((arg) => String(arg || '').toLowerCase() === '--toonflow-app')) {
  startToonflowBridge();
  return;
}

const { initializeRunFileLogger } = require('../utils/logger');
const { startAiCanvasProServer } = require('../ai-canvas-pro-launcher');

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
  if (process.argv.includes('--registration-app')) {
    const { startRegistrationBridge } = require('../bootstrap');
    startRegistrationBridge();
    return;
  }

  const { createMainApp } = require('../composition/create-main-app');
  try {
    const result = startAiCanvasProServer(console);
    if (result && result.ok === false) {
      if (result.missing) {
        console.info('[启动] AI-CanvasPro 拓展未安装，已跳过预启动');
      } else {
        console.warn('[启动] AI-CanvasPro 预启动失败:', result.error || result.message || 'unknown');
      }
    }
  } catch (error) {
    console.warn('[启动] AI-CanvasPro 预启动异常:', error?.message || error);
  }
  const mainApp = createMainApp();
  mainApp.start();
}

startApp();
