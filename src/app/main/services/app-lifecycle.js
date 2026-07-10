const path = require('path');
const { spawn } = require('child_process');
const { setLicenseRuntimeConfig } = require('../utils/runtime-config');

// 启动/打开/显示：launchIndependentCommand的具体业务逻辑。
function launchIndependentCommand(target, logger = console) {
  const resolvedTarget = String(target || '').trim();
  if (!resolvedTarget) {
    throw new Error('启动目标为空');
  }

  const ext = path.extname(resolvedTarget).toLowerCase();
  const cwd = path.dirname(resolvedTarget);
  const isWindows = process.platform === 'win32';

  let command = resolvedTarget;
  let args = [];

  // Windows 下直接 spawn 可执行文件有时仍会被 Electron 的退出流程一起带走。
  // 对 exe / bat / cmd 统一改用系统 shell 的 start，让更新包真正脱离当前进程树。
  if (isWindows && (ext === '.exe' || ext === '.bat' || ext === '.cmd')) {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '""', resolvedTarget];
  } else if (isWindows && ext === '.ps1') {
    command = 'powershell.exe';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolvedTarget];
  }

  logger.warn?.('[退出] 准备独立启动更新包', {
    target: resolvedTarget,
    cwd,
    command,
    args,
  });

  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.once('error', (error) => {
    logger.warn?.('[退出] 独立启动更新包失败:', error?.message || error);
  });

  try { child.unref(); } catch (_) {}

  logger.log?.('[退出] 已独立拉起更新包进程', {
    pid: child.pid ?? null,
    target: resolvedTarget,
  });

  return { pid: child.pid ?? null, target: resolvedTarget, command, args };
}

// 监听/绑定：registerAppLifecycle的具体业务逻辑。
function registerAppLifecycle(deps = {}) {
  const {
    app,
    ipcMain,
    fs,
    getStorePath,
    initializeCoreDirectory,
    getCurrentPlatformLabel,
    readStoreConfigSafe,
    writeStoreConfigSafe,
    writeLicenseRecordsSafe,
    readLicenseRecordsSafe,
    computeDeviceId,
    licenseCache,
    bootstrapMainApp,
    createLicenseWindow,
    sendToSide,
    cleanupAllBrowserSessionData,
    cleanupBrowserPartitionsRootDir,
    cleanupUpdateStorageRoot,
    shortcutManager,
    createDevConsoleWindow,
    getAppConsoleHistory,
    isDevMode = false,
    getGlobalHttpClient,
    isSwitchingToLicenseRef,
    isMainBootstrappedRef,
    getLicenseWindow,
    BrowserWindow,
    createMainWindow,
    logger = console,
  } = deps;
  const skipLicenseWindow = ['1', 'true', 'yes', 'main'].includes(
    String(process.env.SKIP_LICENSE_WINDOW || process.env.APP_BOOT_MODE || '').trim().toLowerCase(),
  ) || process.argv.includes('--skip-license-window') || process.argv.includes('--dev-main');
// 获取/读取/解析：resolveLicenseWindow的具体业务逻辑。
  const resolveLicenseWindow = () => (typeof getLicenseWindow === 'function' ? getLicenseWindow() : deps.licenseWindow);
  const {
    saveLicenseCredentialsSafe,
  } = require('../ipc/register/store-utils');
  const {
    cleanupClashMiniRuntimeConfig,
    getClashMiniRuntimeRoot,
  } = require('../ipc/register/clash-mini-core');

  app.whenReady().then(async () => {
    // The development console is loaded before bootstrapMainApp registers the
    // full IPC set. Make its history request available before loading its page.
    if (isDevMode) {
      try {
        ipcMain.removeHandler('get-app-console-history');
        ipcMain.handle('get-app-console-history', async () => {
          try {
            const history = typeof getAppConsoleHistory === 'function' ? getAppConsoleHistory() : [];
            return { ok: true, history: Array.isArray(history) ? history : [] };
          } catch (error) {
            return { ok: false, error: error?.message || String(error), history: [] };
          }
        });
      } catch (e) {
        logger.warn?.('[启动] 注册调试控制台历史 IPC 失败:', e?.message || e);
      }
    }

    if (isDevMode && typeof createDevConsoleWindow === 'function') {
      try {
        createDevConsoleWindow();
      } catch (e) {
        logger.warn?.('[启动] 预创建调试控制台失败:', e?.message || e);
      }
    }

    const startLicenseWindowEarly = !skipLicenseWindow;

    if (startLicenseWindowEarly) {
      try {
        createLicenseWindow();
      } catch (e) {
        logger.warn?.('[启动] 预创建首屏卡密窗口失败:', e?.message || e);
      }
    }

    setImmediate(() => {
      try {
        const ok = initializeCoreDirectory();
        if (ok) {
          logger.log?.('[配置] initializeCoreDirectory 执行完成');
        } else {
          logger.warn?.('[配置] initializeCoreDirectory 返回 false');
        }
      } catch (e) {
        logger.warn?.('[配置] initializeCoreDirectory 执行异常:', e?.message || e);
      }
    });

    setImmediate(() => {
      try {
        if (typeof cleanupUpdateStorageRoot !== 'function') return;
        const cleanupResult = cleanupUpdateStorageRoot();
        if (cleanupResult && cleanupResult.ok) {
          logger.log?.('[更新] 启动后更新缓存清理完成:', cleanupResult);
        } else {
          logger.warn?.('[更新] 启动后更新缓存清理未完成:', cleanupResult);
        }
      } catch (e) {
        logger.warn?.('[更新] 启动后更新缓存清理异常:', e?.message || e);
      }
    });

    setImmediate(async () => {
      try {
        const deviceId = await computeDeviceId();
        logger.log?.('[启动] 设备号:', deviceId);
      } catch (e) {
        logger.warn?.('[启动] 打印设备号失败:', e?.message || e);
      }
    });

    ipcMain.handle('license-get-device-id', async () => {
      return await computeDeviceId();
    });

    ipcMain.handle('license-get-saved-key', async () => {
      if (licenseCache && typeof licenseCache.getCredentials === 'function') {
        const cachedKey = String(licenseCache.getCredentials().key || '').trim();
        if (cachedKey) return cachedKey;
      }

      try {
        const storeConfig = readStoreConfigSafe();
        const records = typeof readLicenseRecordsSafe === 'function' ? readLicenseRecordsSafe() : [];
        const recentRecordKey = String(records?.[0]?.keyValue || records?.[0]?.key || '').trim();
        if (recentRecordKey) return recentRecordKey;

        const storedKey = String(storeConfig?.userCredentials?.key || '').trim();
        if (storedKey) return storedKey;
      } catch (_) {
      }
      return '';
    });

    ipcMain.handle('license-get-records', async () => {
      try {
        return {
          ok: true,
          records: readLicenseRecordsSafe(),
          currentPlatformName: getCurrentPlatformLabel(),
        };
      } catch (e) {
        return { ok: false, error: e?.message || String(e), records: [], currentPlatformName: getCurrentPlatformLabel() };
      }
    });

    ipcMain.handle('license-clear-records', async () => {
      try {
        writeLicenseRecordsSafe([]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    });

    ipcMain.handle('license-delete-record', async (_event, { keyValue, id } = {}) => {
      try {
        const records = readLicenseRecordsSafe();
        const targetKey = String(keyValue || '').trim();
        const targetId = String(id || '').trim();

        if (!targetKey && !targetId) {
          return { ok: false, error: '缺少要删除的卡密' };
        }

        const nextRecords = records.filter((item) => {
          const itemKey = String(item?.keyValue || item?.key || '').trim();
          const itemId = String(item?.id || '').trim();
          const matchesId = targetId && itemId && itemId === targetId;
          const matchesKey = targetKey && itemKey === targetKey;
          return !(matchesId || matchesKey);
        });

        if (nextRecords.length === records.length) {
          return { ok: false, error: '未找到要删除的卡密' };
        }

        writeLicenseRecordsSafe(nextRecords);

        const currentSavedKey = String(readStoreConfigSafe()?.userCredentials?.key || '').trim();
        if (currentSavedKey && (currentSavedKey === targetKey || nextRecords.every((item) => String(item?.keyValue || '').trim() !== currentSavedKey))) {
          const nextStoreConfig = { ...readStoreConfigSafe() };
          if (nextStoreConfig.userCredentials && typeof nextStoreConfig.userCredentials === 'object') {
            nextStoreConfig.userCredentials = {
              ...nextStoreConfig.userCredentials,
              key: '',
            };
          }
          writeStoreConfigSafe(nextStoreConfig);
          if (licenseCache && typeof licenseCache.setCredentials === 'function') {
            licenseCache.setCredentials({ key: '' });
          }
        }

        return { ok: true, removed: records.length - nextRecords.length };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    });

    ipcMain.handle('license-validate-and-init', async (_event, { key, deviceId }) => {
      try {
        if (!key || !String(key).trim()) {
          return { ok: false, message: '请输入卡密' };
        }
        key = String(key).trim();
        if (!deviceId) {
          deviceId = await computeDeviceId();
        }

        const resolved = await deps.resolveServerConfigForKey({ key });
        if (!resolved.ok) {
          const resolverError = String(resolved.error || '');
          const emptyResultHints = [
            '未返回可用服务器地址',
            '未返回服务器地址',
            '接口未返回可用服务器地址',
            '卡密已匹配，但接口未返回可用服务器地址',
          ];
          const canContinue = emptyResultHints.some((hint) => resolverError.includes(hint));
          if (!canContinue) {
            return { ok: false, message: resolved.error || '卡密搜索失败' };
          }
          logger.warn?.('[卡密搜索] 未返回可用服务器地址，但未发现明确失败状态，继续进入软件:', resolverError || 'unknown');
        } else if (resolved.data) {
          deps.applyResolvedConfigToStore({ resolved: resolved.data });
          if (licenseCache && typeof licenseCache.setValidationState === 'function') {
            licenseCache.setValidationState({
              key,
              deviceId,
              validated: true,
              bound: true,
              licenseValidated: true,
              result: resolved.data,
              message: resolved.data.message || '卡密有效',
            });
          }

        }

        saveLicenseCredentialsSafe({
          readStoreConfigSafe,
          writeStoreConfigSafe,
          licenseCache,
        }, key, deviceId);

        try {
          const { normalizeValidationRuntimeConfig } = require('../lib/http-client');
          const runtimeConfig = normalizeValidationRuntimeConfig(resolved.data || {});
          setLicenseRuntimeConfig(licenseCache, runtimeConfig);
          if (typeof deps.refreshAllowedPlatformsAndNotify === 'function') {
            void deps.refreshAllowedPlatformsAndNotify().catch((refreshErr) => {
              logger.warn?.('[启动] 异步刷新平台名称失败:', refreshErr?.message || refreshErr);
            });
          }
        } catch (refreshErr) {
          logger.warn?.('[启动] 验证后刷新平台名称失败:', refreshErr?.message || refreshErr);
        }

        try {
          if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
            licenseCache.setRuntimeConfig({
              autoValidatePending: true,
            });
          }
        } catch (flagErr) {
          logger.warn?.('[启动] 写入自动验证标记失败:', flagErr?.message || flagErr);
        }

        try {
          await bootstrapMainApp();
        } catch (bootstrapErr) {
          try {
            if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
              licenseCache.setRuntimeConfig({
                autoValidatePending: false,
              });
            }
          } catch (_) {}
          throw bootstrapErr;
        }

        const licenseWindow = resolveLicenseWindow();
        if (licenseWindow && !licenseWindow.isDestroyed()) {
          try { licenseWindow.close(); } catch (_) {}
        }

        deps.revealMainWindow?.();
        try {
          if (typeof deps.sendToSide === 'function') {
            deps.sendToSide('license-credentials-updated', {
              key,
              deviceId,
            });
          }
        } catch (_) {}

        deps.appendLicenseRecord({
          key,
          status: 'success',
          platformName: String(resolved.data?.platformName || '').trim(),
        });

        return {
          ok: true,
          message: resolved.data?.message || '卡密有效'
        };
      } catch (e) {
        return { ok: false, message: e?.message || String(e) };
      }
    });

    ipcMain.handle('license-close-window', async () => {
      try {
        const licenseWindow = resolveLicenseWindow();
        if (licenseWindow && !licenseWindow.isDestroyed()) {
          licenseWindow.close();
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || String(e) };
      }
    });

    if (skipLicenseWindow) {
      logger.log?.('[启动] 调试模式：跳过首屏卡密窗口，直接进入主界面');
      try {
        await bootstrapMainApp();
      } catch (e) {
        logger.warn?.('[启动] 调试模式直接进入主界面失败:', e?.message || e);
        createLicenseWindow();
      }
      return;
    }

    const licenseWindow = resolveLicenseWindow();
    if (licenseWindow && !licenseWindow.isDestroyed()) {
      try {
        if (licenseWindow.isMinimized()) licenseWindow.restore();
        licenseWindow.show();
        licenseWindow.focus();
      } catch (e) {
        logger.warn?.('[启动] 显示首屏卡密窗口失败:', e?.message || e);
      }
    }
  });

  app.on('before-quit', (event) => {
    if (global._mainAppExiting) {
      return;
    }
    global._mainAppExiting = true;
    try { event.preventDefault(); } catch (_) {}

    void (async () => {
      logger.log?.('[退出] 主进程开始退出流程...');
      global._isShuttingDown = true;
      global.willQuit = true;
      const pendingUpdateInstallTarget = String(global._pendingUpdateInstallTarget || '').trim();
      const pendingUpdateInstallVersion = String(global._pendingUpdateInstallVersion || '').trim();
      const isUpdateExit = Boolean(pendingUpdateInstallTarget);

      const hardExitTimeoutMs = isUpdateExit ? 8000 : 20000;
      const hardExitTimer = setTimeout(() => {
        logger.log?.('[退出] 清理超时，执行强制退出...');
        app.exit(0);
      }, hardExitTimeoutMs);

      try {
        try {
          logger.log?.('[退出] 关闭所有窗口...');
          for (const win of BrowserWindow.getAllWindows()) {
            try { win.close(); } catch (_) {}
          }
        } catch (e) {
          logger.warn?.('[退出] 关闭窗口失败:', e?.message || e);
        }

        try {
          logger.log?.('[退出] 清理全局快捷键...');
          shortcutManager.unregister();
        } catch (e) {
          logger.warn?.('[退出] 清理快捷键失败:', e?.message || e);
        }

        try {
          const globalHttpClient = getGlobalHttpClient?.() || null;
          if (globalHttpClient) {
            globalHttpClient.close();
          }
        } catch (e) {
          logger.warn?.('[退出] 释放 HTTP 客户端失败:', e?.message || e);
        }

        if (!isUpdateExit) {
          try {
            logger.log?.('[退出] 清理浏览器缓存...');
            const cleanupResult = await cleanupAllBrowserSessionData({ source: '应用退出', force: true });
            logger.log?.('[退出] 浏览器缓存清理完成:', cleanupResult);
          } catch (e) {
            logger.warn?.('[退出] 清理浏览器缓存失败:', e?.message || e);
          }

          try {
            logger.log?.('[退出] 删除 Partitions 根目录...');
            const partitionsCleanupResult = await cleanupBrowserPartitionsRootDir();
            logger.log?.('[退出] Partitions 根目录清理完成:', partitionsCleanupResult);
          } catch (e) {
            logger.warn?.('[退出] 删除 Partitions 根目录失败:', e?.message || e);
          }

          try {
            logger.log?.('[退出] 清理 Clash Mini 运行配置...');
            const runtimeRoot = typeof getClashMiniRuntimeRoot === 'function' ? getClashMiniRuntimeRoot() : '';
            const clashCleanupResult = typeof cleanupClashMiniRuntimeConfig === 'function'
              ? cleanupClashMiniRuntimeConfig(runtimeRoot)
              : { ok: false, error: 'cleanupClashMiniRuntimeConfig unavailable' };
            logger.log?.('[退出] Clash Mini 运行配置清理完成:', clashCleanupResult);
          } catch (e) {
            logger.warn?.('[退出] 清理 Clash Mini 运行配置失败:', e?.message || e);
          }
        } else {
          logger.log?.('[退出] 更新退出模式：跳过浏览器缓存和深度清理');
        }

        logger.log?.('[退出] 清理完成，退出应用...');
      } catch (error) {
        logger.error?.('[退出] 退出清理流程失败:', error);
      } finally {
        clearTimeout(hardExitTimer);
        if (isUpdateExit) {
          const target = pendingUpdateInstallTarget;
          global._pendingUpdateInstallTarget = '';
          global._pendingUpdateInstallVersion = '';
          try {
            if (target) {
              logger.log?.('[退出] 发现待安装更新包，准备在退出后启动:', {
                version: pendingUpdateInstallVersion,
                target,
              });
              void launchIndependentCommand(target, logger);
            }
          } catch (error) {
            logger.warn?.('[退出] 启动待安装更新包失败:', error?.message || error);
          }

        }
        app.exit(0);
      }
    })().catch((error) => {
      logger.error?.('[退出] 未处理的退出异常:', error);
      try { app.exit(1); } catch (_) {}
    });
  });

  app.on('window-all-closed', async () => {
    if (typeof deps.isSwitchingToLicense === 'function' && deps.isSwitchingToLicense()) return;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (typeof deps.isMainBootstrapped === 'function' && deps.isMainBootstrapped()) {
        createMainWindow();
      } else {
        createLicenseWindow();
      }
    }
  });

}

module.exports = {
  registerAppLifecycle,
};
