const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

let toonflowProcess = null;
let toonflowDetectedPort = null;

const TOONFLOW_STDERR_SUPPRESSION_PATTERNS = [
  /cpu_probe_win\.cc:\d+\] PdhAddEnglishCounter failed for '\\Processor\(_Total\)\\% Processor Time': Error \(0x13D\) while retrieving error\. \(0xC0000BB8\)/i,
  /PdhAddEnglishCounter failed for '\\Processor\(_Total\)\\% Processor Time'/i,
];

function shouldSuppressToonflowStderrLine(line = '') {
  const text = String(line || '').trim();
  if (!text) {
    return true;
  }
  return TOONFLOW_STDERR_SUPPRESSION_PATTERNS.some((pattern) => pattern.test(text));
}

// 创建/初始化：createNodeEnv的具体业务逻辑。
function createNodeEnv(baseEnv = process.env) {
  const nextEnv = { ...baseEnv };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  const nodePathParts = [
    path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
    path.resolve(process.resourcesPath || '', 'app.asar', 'node_modules'),
    path.resolve(process.resourcesPath || '', 'node_modules'),
    path.resolve(process.cwd(), 'node_modules'),
    path.resolve(path.dirname(process.execPath || ''), 'resources', 'app.asar.unpacked', 'node_modules'),
    path.resolve(path.dirname(process.execPath || ''), 'resources', 'app.asar', 'node_modules'),
  ].filter(Boolean);
  const extraNodePath = nodePathParts.join(path.delimiter);
  nextEnv.NODE_PATH = nextEnv.NODE_PATH ? `${nextEnv.NODE_PATH}${path.delimiter}${extraNodePath}` : extraNodePath;
  return nextEnv;
}

// 获取/读取/解析：resolveToonflowUserDataDir的具体业务逻辑。
function resolveToonflowUserDataDir() {
  try {
    if (app?.isPackaged) {
      const baseUserData = app?.getPath ? app.getPath('userData') : '';
      return path.resolve(baseUserData || path.dirname(process.resourcesPath || process.execPath || ''), 'Toonflow-data');
    }
    if (app?.getPath) {
      return path.resolve(app.getPath('userData'), '.toonflow-user-data');
    }
  } catch (_) {}
  return path.resolve(process.cwd(), '.toonflow-user-data');
}

// 获取/读取/解析：resolveToonflowServePath的具体业务逻辑。
function resolveToonflowServePath() {
  const packagedCandidates = [
    path.resolve(process.resourcesPath || '', 'resource', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
    path.resolve(path.dirname(process.execPath || ''), 'resources', 'resource', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
    path.resolve(process.cwd(), 'src', 'assets', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
  ].filter(Boolean);

  const devCandidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'extensions', 'Toonflow-app', 'data', 'electron', 'main.js'),
    ...packagedCandidates,
  ];

  const candidates = process.resourcesPath ? packagedCandidates : devCandidates;

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }

  return candidates[0];
}

// 监听/绑定：attachToonflowProcessLogging的具体业务逻辑。
function attachToonflowProcessLogging(child, logger = console) {
  const prefix = '[Toonflow]';
  let stderrBuffer = '';

  const emitStderrLine = (line) => {
    const text = String(line || '').trim();
    if (!text || shouldSuppressToonflowStderrLine(text)) {
      return;
    }
    logger.warn?.(`${prefix} ${text}`);
  };

  child.stdout?.on('data', (data) => {
    const text = String(data || '').trim();
    if (text) {
      const match = text.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i);
      if (match) {
        toonflowDetectedPort = Number(match[1]) || toonflowDetectedPort;
      }
      logger.log?.(`${prefix} ${text}`);
    }
  });

  child.stderr?.on('data', (data) => {
    stderrBuffer += String(data || '');
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      emitStderrLine(line);
    }
  });

  child.on('exit', (code, signal) => {
    if (stderrBuffer.trim()) {
      emitStderrLine(stderrBuffer);
      stderrBuffer = '';
    }
    if (toonflowProcess === child) {
      toonflowProcess = null;
    }
    toonflowDetectedPort = null;
    logger.log?.(`${prefix} 进程已退出: code=${code}, signal=${signal || 'none'}`);
  });

  child.on('error', (error) => {
    if (toonflowProcess === child) {
      toonflowProcess = null;
    }
    toonflowDetectedPort = null;
    logger.error?.(`${prefix} 启动失败: ${error?.message || error}`);
  });
}

// 处理：waitForToonflowPort的具体业务逻辑。
function waitForToonflowPort(port = 10588, timeoutMs = 30000, logger = console) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
// 处理：probe的具体业务逻辑。
    const probe = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
// 处理：finish的具体业务逻辑。
      const finish = (result) => {
        try { socket.removeAllListeners(); } catch (_) {}
        try { socket.destroy(); } catch (_) {}
        resolve(result);
      };

      socket.once('connect', () => finish({ ok: true, ready: true, port }));
      socket.once('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          finish({ ok: false, ready: false, message: `Toonflow 端口 ${port} 在 ${timeoutMs}ms 内未就绪` });
          return;
        }
        setTimeout(probe, 500);
      });
    };

    probe();
  });
}

// 获取/读取/解析：getToonflowDetectedPort的具体业务逻辑。
function getToonflowDetectedPort() {
  return toonflowDetectedPort;
}

// 处理：waitForToonflowDetectedPort的具体业务逻辑。
function waitForToonflowDetectedPort(timeoutMs = 5000) {
  return waitForToonflowPort(10588, timeoutMs).then((result) => (result && result.ok ? 10588 : null));
}

// 启动/打开/显示：startToonflowServer的具体业务逻辑。
function startToonflowServer(logger = console) {
  if (toonflowProcess && toonflowProcess.exitCode === null && !toonflowProcess.killed) {
    toonflowDetectedPort = 10588;
    logger.log?.('[启动] Toonflow 后台服务已在运行');
    return {
      ok: true,
      alreadyRunning: true,
      started: false,
      process: toonflowProcess,
      port: toonflowDetectedPort,
    };
  }

  const scriptPath = resolveToonflowServePath();
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    const message = `未找到 Toonflow 后台服务入口: ${scriptPath || '(empty path)'}`;
    logger.warn?.(`[启动] ${message}`);
    return { ok: false, message };
  }

  toonflowDetectedPort = 10588;
  const cwd = path.resolve(scriptPath, '..', '..');
  const toonflowUserDataDir = resolveToonflowUserDataDir();
  try {
    if (!fs.existsSync(toonflowUserDataDir)) {
      fs.mkdirSync(toonflowUserDataDir, { recursive: true });
    }
  } catch (error) {
    logger.warn?.('[启动] 创建 Toonflow 数据目录失败:', error?.message || error);
  }
  logger.log?.(`[启动] 正在启动 Toonflow 后台服务: ${scriptPath}`);

  const child = spawn(process.execPath, [scriptPath, '--toonflow-app'], {
    cwd,
    env: {
      ...createNodeEnv(),
      TOONFLOW_BRIDGE: '1',
      TOONFLOW_USER_DATA_DIR: toonflowUserDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  toonflowProcess = child;
  attachToonflowProcessLogging(child, logger);
  return {
    ok: true,
    alreadyRunning: false,
    started: true,
    process: child,
    scriptPath,
    port: toonflowDetectedPort,
  };
}

// 停止/关闭/清理：stopToonflowServer的具体业务逻辑。
function stopToonflowServer(logger = console) {
  const child = toonflowProcess;
  toonflowProcess = null;
  toonflowDetectedPort = null;

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
      logger.warn?.('[退出] 关闭 Toonflow 后台服务失败:', error?.message || error);
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
      logger.warn?.('[退出] 杀死 Toonflow 后台服务失败:', error?.message || error);
      finish({ ok: false, error: error?.message || String(error) });
      return;
    }

    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          logger.warn?.('[退出] 强制终止 Toonflow 后台服务失败:', error?.message || error);
        }
      }
    }, 3000);
  });
}

module.exports = {
  resolveToonflowServePath,
  startToonflowServer,
  stopToonflowServer,
  getToonflowDetectedPort,
  waitForToonflowDetectedPort,
  waitForToonflowPort,
};
