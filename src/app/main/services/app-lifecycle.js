const path = require('path');
const { spawn } = require('child_process');
const { setLicenseRuntimeConfig } = require('../utils/runtime-config');
const {
  buildStoredAccountSession,
  normalizeAccountSession,
} = require('../utils/account-session');
const {
  getServerMode,
  isServerBaseAllowedForMode,
} = require('../utils/server-mode');

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
    BrowserWindow,
    createMainWindow,
    logger = console,
  } = deps;
  const {
    saveLicenseCredentialsSafe,
  } = require('../ipc/register/store-utils');
  const {
    cleanupClashMiniRuntimeConfig,
    getClashMiniRuntimeRoot,
    stopClashMiniProcess,
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

    ipcMain.handle('account-get-session', async () => {
      try {
        const credentials = normalizeAccountSession(readStoreConfigSafe()?.userCredentials || {});
        const authenticated = credentials.authenticated
          && credentials.serverMode === getServerMode()
          && isServerBaseAllowedForMode(credentials.serverBase);
        return {
          ok: true,
          username: credentials.username,
          platformName: credentials.platformName,
          account: credentials.account,
          validation: credentials.validation,
          authenticated,
        };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-get-models', async () => {
      try {
        const credentials = readStoreConfigSafe()?.userCredentials || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.getAIControlModels !== 'function') {
          return { ok: false, message: 'AI 服务尚未就绪' };
        }
        return await httpClient.getAIControlModels(key, deviceId);
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-get-browser-connections', async () => {
      try {
        const bridge = deps.browserAutomationBridge;
        return {
          ok: true,
          connections: bridge && typeof bridge.listConnections === 'function'
            ? bridge.listConnections()
            : [],
        };
      } catch (error) {
        return { ok: false, message: error?.message || String(error), connections: [] };
      }
    });

    ipcMain.handle('ai-control-redeem-gift-code', async (_event, input = {}) => {
      try {
        const credentials = readStoreConfigSafe()?.userCredentials || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        const code = String(input.code || '').trim();
        if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
        if (!code) return { ok: false, message: '请输入礼品码' };
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.redeemAIControlGiftCode !== 'function') {
          return { ok: false, message: 'AI 服务尚未就绪' };
        }
        return await httpClient.redeemAIControlGiftCode(key, deviceId, code);
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-chat', async (_event, input = {}) => {
      try {
        const credentials = readStoreConfigSafe()?.userCredentials || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.sendAIControlMessage !== 'function') {
          return { ok: false, message: 'AI 服务尚未就绪' };
        }
        const modelId = String(input.modelId || '').trim();
        const initialMessages = Array.isArray(input.messages) ? input.messages : [];
        const quota = input.quota && typeof input.quota === 'object' ? input.quota : null;
        if (quota && quota.unlimited !== true) {
          const total = Number(quota.quota);
          const used = Number(quota.used || 0);
          const remaining = Number(quota.remaining ?? (total - used));
          if (Number.isFinite(remaining) && remaining <= 0) {
            return { ok: false, message: 'AI 对话额度已用尽，请联系管理员', quota };
          }
        }
        const connectionId = String(input.browserConnectionId || '').trim();
        const disableTools = input.disableTools === true;
        const useStream = input.stream === true;
        const requestId = String(input.requestId || '').trim();
        const emit = (payload) => {
          if (!useStream || !requestId || !_event.sender || _event.sender.isDestroyed()) return;
          _event.sender.send('ai-control-chat-event', { requestId, ...payload });
        };
        const bridge = deps.browserAutomationBridge;
        const connection = !disableTools && connectionId ? bridge?.getConnection?.(connectionId) : null;
        if (!disableTools && connectionId && !connection) {
          return { ok: false, message: '所选浏览器插件已离线，请刷新后重新选择' };
        }

        const tools = connection?.tools || [];
        const modelMessages = [...initialMessages];
        const compactToolValue = (value) => {
          let serialized = '';
          try { serialized = JSON.stringify(value ?? null); } catch (_) { serialized = String(value ?? ''); }
          return serialized.length > 12000 ? `${serialized.slice(0, 12000)}…` : value;
        };
        let runId = '';
        let latestQuota = null;
        let reasoningLog = '';
        const toolEvents = [];
        const traceEvents = [];
        for (let round = 0; round < 12; round += 1) {
          emit({ type: 'round_start', round });
          const result = useStream && typeof httpClient.streamAIControlMessage === 'function'
            ? await httpClient.streamAIControlMessage(
              key,
              deviceId,
              modelId,
              modelMessages,
              { tools, runId },
              (streamEvent) => {
                if (!['result', 'error'].includes(streamEvent?.type)) {
                  emit({ ...streamEvent, round });
                }
              },
            )
            : await httpClient.sendAIControlMessage(
              key,
              deviceId,
              modelId,
              modelMessages,
              { tools, runId },
            );
          if (!result?.ok) {
            emit({ type: 'error', message: result?.message || result?.error || '对话请求失败' });
            return result;
          }
          latestQuota = result.quota || latestQuota;
          runId = String(result.run_id || runId || '');
          const roundReasoning = String(result.message?.reasoning || '');
          if (roundReasoning) {
            reasoningLog += `${reasoningLog ? '\n\n' : ''}${roundReasoning}`;
            traceEvents.push({ type: 'reasoning', round, content: roundReasoning });
          }
          const toolCalls = Array.isArray(result.message?.tool_calls) ? result.message.tool_calls : [];
          if (!toolCalls.length) {
            const finalMessages = [
              ...modelMessages,
              {
                role: 'assistant',
                content: String(result.message?.content || ''),
              },
            ];
            const finalResult = {
              ...result,
              quota: latestQuota,
              messages: finalMessages,
              message: {
                ...(result.message || {}),
                reasoning: reasoningLog,
                tool_events: toolEvents,
                trace_events: traceEvents,
              },
            };
            emit({ type: 'done', message: finalResult.message, quota: finalResult.quota });
            return finalResult;
          }
          if (!connection || !bridge?.dispatch) {
            return { ok: false, message: '模型请求了浏览器工具，但当前没有选择可用的浏览器插件' };
          }

          modelMessages.push({
            role: 'assistant',
            content: String(result.message?.content || ''),
            tool_calls: toolCalls,
          });
          const roundContent = String(result.message?.content || '').trim();
          if (roundContent) traceEvents.push({ type: 'step', round, content: roundContent });
          for (const call of toolCalls) {
            const toolName = String(call?.function?.name || '').trim();
            let args = {};
            try {
              args = JSON.parse(String(call?.function?.arguments || '{}'));
            } catch (_) {
              args = {};
            }
            const activity = {
              id: String(call.id || ''),
              name: toolName,
              arguments: compactToolValue(args),
              status: 'running',
            };
            toolEvents.push(activity);
            traceEvents.push({ type: 'tool', round, tool: activity });
            emit({ type: 'tool_start', tool: { ...activity }, round });
            let toolResult;
            try {
              const requestedSeconds = Number(args?.timeout_seconds || 0);
              toolResult = await bridge.dispatch(connection.id, toolName, args, {
                timeoutMs: requestedSeconds > 0 ? requestedSeconds * 1000 : 180000,
              });
            } catch (error) {
              toolResult = { success: false, error: error?.message || String(error) };
            }
            activity.status = toolResult?.success === false ? 'error' : 'success';
            activity.result = compactToolValue(toolResult ?? null);
            emit({ type: 'tool_result', tool: { ...activity }, round });
            modelMessages.push({
              role: 'tool',
              tool_call_id: String(call.id || ''),
              name: toolName,
              content: JSON.stringify(toolResult ?? null),
            });
          }
        }
        return { ok: false, message: '浏览器工具调用次数过多，已停止本轮任务', quota: latestQuota, messages: modelMessages };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    const aiChatHistory = require('../lib/ai-chat-history');
    const historyCredentials = () => readStoreConfigSafe()?.userCredentials || {};

    ipcMain.handle('ai-control-history-list', async () => {
      try {
        return aiChatHistory.listSessions(historyCredentials());
      } catch (error) {
        return { ok: false, message: error?.message || String(error), sessions: [] };
      }
    });

    ipcMain.handle('ai-control-history-get', async (_event, input = {}) => {
      try {
        return aiChatHistory.getSession(historyCredentials(), input?.id);
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-history-save', async (_event, input = {}) => {
      try {
        return aiChatHistory.saveSession(historyCredentials(), input?.session || input || {}, {
          setCurrent: input?.setCurrent !== false,
        });
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-history-delete', async (_event, input = {}) => {
      try {
        return aiChatHistory.deleteSession(historyCredentials(), input?.id);
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-history-create', async (_event, input = {}) => {
      try {
        return aiChatHistory.createSession(historyCredentials(), input || {});
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('account-authenticate', async (_event, input = {}) => {
      try {
        if (typeof deps.authenticateAccount !== 'function') {
          return { ok: false, message: '账号服务未就绪' };
        }
        const username = String(input.username || '').trim();
        const password = String(input.password || '');
        const mode = input.mode === 'register' ? 'register' : 'login';
        if (!username || !password) {
          return { ok: false, message: '请输入用户名和密码' };
        }
        const deviceId = String(input.deviceId || '').trim() || await computeDeviceId();
        const authenticated = await deps.authenticateAccount({
          mode,
          username,
          password,
          device_id: deviceId,
        });
        if (!authenticated?.ok) {
          return {
            ...(authenticated && typeof authenticated === 'object' ? authenticated : {}),
            ok: false,
            message: authenticated?.message || '账号验证失败',
            error: authenticated?.error,
          };
        }

        const key = String(authenticated.credential || '').trim();
        if (!key) {
          return { ok: false, message: '登录响应缺少内部凭据' };
        }
        const validation = authenticated.validation && typeof authenticated.validation === 'object'
          ? authenticated.validation
          : {};
        const resolved = {
          ...authenticated,
          ...validation,
          serverBase: authenticated.serverBase
            || authenticated.server_base
            || authenticated.address_HTTP
            || authenticated.addressHttp
            || authenticated.client_address
            || authenticated.clientAddress
            || validation.serverBase
            || validation.server_base
            || validation.address_HTTP
            || validation.addressHttp
            || validation.client_address
            || validation.clientAddress
            || '',
          platformName: authenticated.platform_name
            || authenticated.platformName
            || validation.platform_name
            || validation.platformName
            || '',
        };

        if (!isServerBaseAllowedForMode(resolved.serverBase)) {
          const modeText = getServerMode() === 'local' ? '本地调试' : '正式远程';
          return { ok: false, message: `账号服务返回的服务器地址与${modeText}模式不匹配` };
        }

        deps.applyResolvedConfigToStore({ resolved });
        saveLicenseCredentialsSafe({
          readStoreConfigSafe,
          writeStoreConfigSafe,
          licenseCache,
        }, key, deviceId);
        const currentStore = readStoreConfigSafe();
        const storedSession = buildStoredAccountSession({
          current: currentStore?.userCredentials || {},
          username,
          key,
          deviceId,
          platformName: String(resolved.platformName || '').trim(),
          serverBase: String(resolved.serverBase || '').trim(),
          serverMode: getServerMode(),
          account: authenticated.account || {},
          validation: resolved,
        });
        writeStoreConfigSafe({
          ...currentStore,
          userCredentials: storedSession,
        });

        if (licenseCache && typeof licenseCache.setValidationState === 'function') {
          licenseCache.setValidationState({
            key,
            deviceId,
            validated: true,
            bound: true,
            licenseValidated: true,
            result: resolved,
            message: authenticated.message || '登录成功',
          });
        }
        try {
          const { normalizeValidationRuntimeConfig } = require('../lib/http-client');
          setLicenseRuntimeConfig(licenseCache, normalizeValidationRuntimeConfig(resolved));
          licenseCache?.setRuntimeConfig?.({ autoValidatePending: false });
        } catch (_) {}

        const httpClient = getGlobalHttpClient?.();
        if (httpClient && Object.prototype.hasOwnProperty.call(httpClient, 'runtimeServerBase')) {
          httpClient.runtimeServerBase = String(resolved.serverBase || '').trim().replace(/\/+$/, '');
        }

        const validationState = licenseCache?.getValidationState?.() || resolved;
        // 平台通知、教程页和浏览器初始化都是登录后的附加动作，不阻塞登录响应。
        setImmediate(() => {
          void Promise.resolve(deps.refreshAllowedPlatformsAndNotify?.())
            .catch((refreshError) => {
              logger.warn?.('[账号] 登录后同步平台配置失败:', refreshError?.message || refreshError);
            });
        });
        deps.sendToSide?.('license-credentials-updated', {
          key,
          deviceId,
          username,
          account: authenticated.account || {},
          validation: validationState,
        });
        deps.sendToSide?.('account-session-updated', {
          authenticated: true,
          username,
          platformName: String(resolved.platformName || '').trim(),
          account: authenticated.account || {},
          validation: validationState,
        });
        return {
          ok: true,
          message: mode === 'register' ? '注册成功' : '登录成功',
          account: authenticated.account || {},
          platformName: resolved.platformName,
          validation: validationState,
        };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('account-logout', async () => {
      try {
        const currentStore = readStoreConfigSafe() || {};
        const nextStore = { ...currentStore };
        delete nextStore.userCredentials;
        writeStoreConfigSafe(nextStore);
        licenseCache?.setCredentials?.({ key: '', deviceId: '' });
        licenseCache?.clearValidationState?.();
        licenseCache?.setRuntimeConfig?.({
          serverBase: '',
          platformName: '',
          targetUrl: '',
          tutorialUrl: '',
          allowedPlatforms: [],
          autoValidatePending: false,
        });
        deps.setRuntimeServerBase?.('');
        deps.setRuntimeTcpConfig?.(null);
        const httpClient = getGlobalHttpClient?.();
        if (httpClient && Object.prototype.hasOwnProperty.call(httpClient, 'runtimeServerBase')) {
          httpClient.runtimeServerBase = '';
        }
        try {
          await stopClashMiniProcess({ sendToSide });
        } catch (error) {
          logger.warn?.('[账号] 退出时关闭 Clash Mini 失败:', error?.message || error);
        }
        try {
          await deps.browserRuntimeManager?.stopAll({ timeoutMs: 4000 });
        } catch (error) {
          logger.warn?.('[账号] 退出时关闭 Chromium 环境失败:', error?.message || error);
        }
        deps.sendToSide?.('license-credentials-updated', {
          key: '',
          deviceId: '',
          username: '',
          loggedOut: true,
        });
        deps.sendToSide?.('account-session-updated', { authenticated: false });
        return { ok: true, message: '已退出账号' };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
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

    ipcMain.handle('license-close-window', async () => {
      try {
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e?.message || String(e) };
      }
    });

    try {
      const credentials = normalizeAccountSession(readStoreConfigSafe()?.userCredentials || {});
      const currentServerMode = getServerMode();
      if (
        credentials.authenticated
        && credentials.serverMode === currentServerMode
        && isServerBaseAllowedForMode(credentials.serverBase, currentServerMode)
      ) {
        licenseCache?.setCredentials?.({ key: credentials.key, deviceId: credentials.deviceId });
        deps.applyResolvedConfigToStore?.({
          resolved: {
            ...credentials.validation,
            serverBase: credentials.serverBase,
            platformName: credentials.platformName,
          },
        });
        licenseCache?.setValidationState?.({
          key: credentials.key,
          deviceId: credentials.deviceId,
          validated: true,
          bound: true,
          licenseValidated: true,
          result: credentials.validation,
          message: '账号登录状态已恢复',
        });
        setLicenseRuntimeConfig(licenseCache, credentials.validation);
        licenseCache?.setRuntimeConfig?.({ autoValidatePending: false });
        logger.log?.('[账号] 已恢复账号登录状态:', credentials.username);
      } else if (credentials.authenticated) {
        logger.log?.(`[账号] 已忽略 ${credentials.serverMode} 模式的历史登录状态，当前为 ${currentServerMode} 模式`);
      }
      await bootstrapMainApp();
    } catch (e) {
      logger.error?.('[启动] 打开主界面失败:', e?.message || e);
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
          if (deps.browserRuntimeManager && typeof deps.browserRuntimeManager.stopAll === 'function') {
            logger.log?.('[退出] 正在优雅关闭 Chromium Profile...');
            await deps.browserRuntimeManager.stopAll({ timeoutMs: isUpdateExit ? 2000 : 5000 });
          }
        } catch (e) {
          logger.warn?.('[退出] Chromium Profile 关闭失败:', e?.message || e);
        }

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

        try {
          await deps.browserAutomationBridge?.stop?.();
        } catch (e) {
          logger.warn?.('[退出] 关闭浏览器插件桥接失败:', e?.message || e);
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
      createMainWindow();
    }
  });

}

module.exports = {
  registerAppLifecycle,
};
