const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let aiCanvasProProcess = null;
const AI_CANVAS_PRO_EXE_NAME = 'AI-CanvasPro-Server.exe';
const AI_CANVAS_PRO_RELATIVE_DIR = path.join('extensions_app', 'AI-CanvasPro');

function getAiCanvasProMissingMessage() {
  return '请先下载 AI-CanvasPro 拓展到 extensions_app 后再使用无限画布';
}

// 创建/初始化：createElectronEnv的具体业务逻辑。
function createElectronEnv(baseEnv = process.env) {
  const nextEnv = { ...baseEnv };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  return nextEnv;
}

// 获取/读取/解析：resolveAiCanvasProExePath的具体业务逻辑。
function resolveAiCanvasProExePath() {
  const packagedCandidates = [
    path.resolve(process.cwd(), AI_CANVAS_PRO_RELATIVE_DIR, AI_CANVAS_PRO_EXE_NAME),
    path.resolve(path.dirname(process.execPath || ''), AI_CANVAS_PRO_RELATIVE_DIR, AI_CANVAS_PRO_EXE_NAME),
    path.resolve(path.dirname(process.execPath || ''), '..', AI_CANVAS_PRO_RELATIVE_DIR, AI_CANVAS_PRO_EXE_NAME),
    path.resolve(path.dirname(process.resourcesPath || ''), AI_CANVAS_PRO_RELATIVE_DIR, AI_CANVAS_PRO_EXE_NAME),
    path.resolve(path.dirname(process.resourcesPath || ''), '..', AI_CANVAS_PRO_RELATIVE_DIR, AI_CANVAS_PRO_EXE_NAME),
    path.resolve(__dirname, '..', '..', '..', AI_CANVAS_PRO_RELATIVE_DIR, AI_CANVAS_PRO_EXE_NAME),
  ].filter(Boolean);
  const candidates = packagedCandidates;

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }

  return candidates[0];
}

// 读取/判断：isAiCanvasProInstalled的具体业务逻辑。
function isAiCanvasProInstalled() {
  const exePath = resolveAiCanvasProExePath();
  if (!exePath) return false;
  try {
    return fs.existsSync(exePath);
  } catch (_) {
    return false;
  }
}

// 监听/绑定：attachAiCanvasProProcessLogging的具体业务逻辑。
function attachAiCanvasProProcessLogging(child, logger = console) {
  const prefix = '[AI-CanvasPro]';

  child.stdout?.on('data', (data) => {
    const text = String(data || '').trim();
    if (text) {
      logger.log?.(`${prefix} ${text}`);
    }
  });

  child.stderr?.on('data', (data) => {
    const text = String(data || '').trim();
    if (text) {
      logger.warn?.(`${prefix} ${text}`);
    }
  });

  child.on('exit', (code, signal) => {
    if (aiCanvasProProcess === child) {
      aiCanvasProProcess = null;
    }
    logger.log?.(`${prefix} 进程已退出: code=${code}, signal=${signal || 'none'}`);
  });

  child.on('error', (error) => {
    if (aiCanvasProProcess === child) {
      aiCanvasProProcess = null;
    }
    logger.error?.(`${prefix} 启动失败: ${error?.message || error}`);
  });
}

// 启动/打开/显示：startAiCanvasProServer的具体业务逻辑。
function startAiCanvasProServer(logger = console) {
  if (aiCanvasProProcess && aiCanvasProProcess.exitCode === null && !aiCanvasProProcess.killed) {
    logger.log?.('[启动] AI-CanvasPro 后台服务已在运行');
    return {
      ok: true,
      alreadyRunning: true,
      started: false,
      process: aiCanvasProProcess,
    };
  }

  const exePath = resolveAiCanvasProExePath();
  if (!exePath || !isAiCanvasProInstalled()) {
    return {
      ok: false,
      missing: true,
      message: getAiCanvasProMissingMessage(),
    };
  }
  const cwd = path.dirname(exePath);
  logger.log?.(`[启动] 正在启动 AI-CanvasPro 后台服务: ${exePath}`);

  const child = spawn(exePath, [], {
    cwd,
    env: createElectronEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  aiCanvasProProcess = child;
  attachAiCanvasProProcessLogging(child, logger);
  return {
    ok: true,
    alreadyRunning: false,
    started: true,
    process: child,
    exePath,
  };
}

// 停止/关闭/清理：stopAiCanvasProServer的具体业务逻辑。
function stopAiCanvasProServer(logger = console) {
  const child = aiCanvasProProcess;
  aiCanvasProProcess = null;

  if (!child) {
    return Promise.resolve({ ok: true, stopped: false });
  }

  return new Promise((resolve) => {
    let settled = false;
// 处理：finish的具体业务逻辑。
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

// 监听/绑定：onClose的具体业务逻辑。
    const onClose = (code, signal) => {
      finish({ ok: true, stopped: true, code, signal });
    };

// 监听/绑定：onError的具体业务逻辑。
    const onError = (error) => {
      logger.warn?.('[退出] 关闭 AI-CanvasPro 后台服务失败:', error?.message || error);
      finish({ ok: false, error: error?.message || String(error) });
    };

    child.once('close', onClose);
    child.once('error', onError);

    if (child.exitCode !== null || child.killed) {
      finish({ ok: true, stopped: true, code: child.exitCode, signal: null });
      return;
    }

    try {
      child.kill();
    } catch (error) {
      logger.warn?.('[退出] 杀死 AI-CanvasPro 后台服务失败:', error?.message || error);
      finish({ ok: false, error: error?.message || String(error) });
      return;
    }

    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          logger.warn?.('[退出] 强制终止 AI-CanvasPro 后台服务失败:', error?.message || error);
        }
      }
    }, 3000);
  });
}

module.exports = {
  startAiCanvasProServer,
  stopAiCanvasProServer,
  resolveAiCanvasProExePath,
  isAiCanvasProInstalled,
  getAiCanvasProMissingMessage,
};
