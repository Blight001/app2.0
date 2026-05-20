const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

let registrationAppProcess = null;

// 获取/读取/解析：resolveRegistrationAppRoot的具体业务逻辑。
function resolveRegistrationAppRoot() {
  return path.resolve(__dirname, '..', '..', 'assets', 'extensions', 'registration');
}

// 获取/读取/解析：resolveRegistrationLaunchTarget的具体业务逻辑。
function resolveRegistrationLaunchTarget() {
  const registrationAppRoot = resolveRegistrationAppRoot();
  const isDevElectron = Boolean(process.defaultApp)
    || /electron(?:\.exe)?$/i.test(path.basename(process.execPath || ''));

  if (isDevElectron && fs.existsSync(registrationAppRoot)) {
    return {
      command: process.execPath,
      args: [registrationAppRoot, '--web-ui', '--headless-web', '--no-web-ui-open'],
      cwd: registrationAppRoot,
      mode: 'directory',
    };
  }

  return {
    command: process.execPath,
    args: ['--registration-app', '--web-ui', '--headless-web', '--no-web-ui-open'],
    mode: 'bridge-flag',
  };
}

// 创建/初始化：createElectronEnv的具体业务逻辑。
function createElectronEnv(baseEnv = process.env) {
  const nextEnv = { ...baseEnv };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  return nextEnv;
}

// 处理：waitForHttpHealth的具体业务逻辑。
function waitForHttpHealth(url, timeoutMs = 30000, intervalMs = 500, logger = console) {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  const poll = () => new Promise((resolve) => {
    const client = String(url || '').startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      const ok = response.statusCode >= 200 && response.statusCode < 500;
      response.resume();
      resolve(ok);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(2000, () => {
      try { request.destroy(); } catch (_) {}
      resolve(false);
    });
  });

  return (async () => {
    while (Date.now() < deadline) {
      if (await poll()) {
        return { ok: true, ready: true, url };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    logger.warn?.('[Registration] 等待注册器健康检查超时:', url);
    return { ok: false, ready: false, url, message: 'registration web ui not ready' };
  })();
}

// 监听/绑定：attachRegistrationProcessLogging的具体业务逻辑。
function attachRegistrationProcessLogging(child, logger = console) {
  const prefix = '[Registration]';

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
    if (registrationAppProcess === child) {
      registrationAppProcess = null;
    }
    logger.log?.(`${prefix} 进程已退出: code=${code}, signal=${signal || 'none'}`);
  });

  child.on('error', (error) => {
    if (registrationAppProcess === child) {
      registrationAppProcess = null;
    }
    logger.error?.(`${prefix} 启动失败: ${error?.message || error}`);
  });
}

// 启动/打开/显示：startRegistrationApp的具体业务逻辑。
function startRegistrationApp(logger = console) {
  if (registrationAppProcess && registrationAppProcess.exitCode === null && !registrationAppProcess.killed) {
    logger.log?.('[启动] 注册器进程已在运行');
    return {
      ok: true,
      alreadyRunning: true,
      started: false,
      process: registrationAppProcess,
    };
  }

  const { command, args, cwd, mode } = resolveRegistrationLaunchTarget();
  logger.log?.(`[启动] 正在启动注册器进程 (${mode}): ${command} ${args.join(' ')}`);

  const child = spawn(command, args, {
    cwd,
    env: createElectronEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  registrationAppProcess = child;
  attachRegistrationProcessLogging(child, logger);
  return {
    ok: true,
    alreadyRunning: false,
    started: true,
    process: child,
    mode,
  };
}

// 启动/打开/显示：startRegistrationAppAndWaitReady的具体业务逻辑。
async function startRegistrationAppAndWaitReady(logger = console, healthUrl = 'http://127.0.0.1:18765/health') {
  const result = startRegistrationApp(logger);
  if (result && result.ok === false) {
    return result;
  }

  const readyResult = await waitForHttpHealth(healthUrl, 30000, 500, logger);
  if (!readyResult.ok) {
    return {
      ok: false,
      started: !!result?.started,
      alreadyRunning: !!result?.alreadyRunning,
      message: readyResult.message || 'registration web ui not ready',
    };
  }

  return {
    ok: true,
    started: !!result?.started,
    alreadyRunning: !!result?.alreadyRunning,
    ready: true,
  };
}

// 停止/关闭/清理：stopRegistrationApp的具体业务逻辑。
function stopRegistrationApp(logger = console) {
  const child = registrationAppProcess;
  registrationAppProcess = null;

  if (!child) {
    return Promise.resolve({ ok: true, stopped: false });
  }

  return new Promise((resolve) => {
    let settled = false;
    let forceKillTimer = null;
// 处理：finish的具体业务逻辑。
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      resolve(result);
    };

// 监听/绑定：onClose的具体业务逻辑。
    const onClose = (code, signal) => {
      finish({ ok: true, stopped: true, code, signal });
    };

// 监听/绑定：onError的具体业务逻辑。
    const onError = (error) => {
      logger.warn?.('[退出] 关闭注册器进程失败:', error?.message || error);
      finish({ ok: false, error: error?.message || String(error) });
    };

    child.once('close', onClose);
    child.once('error', onError);

    if (child.exitCode !== null || child.killed) {
      clearTimeout(forceKillTimer);
      finish({ ok: true, stopped: true, code: child.exitCode, signal: null });
      return;
    }

    try {
      child.kill();
    } catch (error) {
      logger.warn?.('[退出] 杀死注册器进程失败:', error?.message || error);
      finish({ ok: false, error: error?.message || String(error) });
      return;
    }

    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          logger.warn?.('[退出] 强制终止注册器进程失败:', error?.message || error);
        }
      }
    }, 3000);
  });
}

module.exports = {
  startRegistrationApp,
  startRegistrationAppAndWaitReady,
  stopRegistrationApp,
};
