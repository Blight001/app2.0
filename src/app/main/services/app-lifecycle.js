const path = require('path');
const { spawn } = require('child_process');
const { setLicenseRuntimeConfig } = require('../utils/runtime-config');
const { installShutdownUncaughtExceptionGuard } = require('../utils/logger');
const {
  buildStoredAccountSession,
  normalizeAccountSession,
} = require('../utils/account-session');
const {
  getServerMode,
  isServerBaseAllowedForMode,
} = require('../utils/server-mode');
const {
  CUSTOM_AI_MODEL_ID,
  getAiControlMcpCallLimit,
  getCustomAiApiConfig,
  isCustomAiApiConfigured,
  isCustomAiModelId,
} = require('../utils/ai-control-settings');
const { sendCustomAIControlMessage } = require('./custom-ai-api');
const { createAiBrowserWindowTools } = require('./ai-browser-window-tools');
const { createVipRequiredResult, resolveVipAccess } = require('../utils/vip-access');
const {
  MAX_AI_CONTROL_MESSAGES,
  limitAiControlMessages,
} = require('../lib/ai-control-message-window');

const BROWSER_CONNECTION_START_MATCH_WINDOW_MS = 60 * 1000;

function enrichBrowserConnectionNames(connections = [], tabs = [], runtimeStates = []) {
  const stateByProfileId = new Map((Array.isArray(runtimeStates) ? runtimeStates : [])
    .map((state) => [String(state?.profileId || ''), state]));
  const browserByPid = new Map();
  const browserCandidates = [];
  const tabItems = tabs instanceof Map ? Array.from(tabs.values()) : (Array.isArray(tabs) ? tabs : []);

  for (const tab of tabItems) {
    if (String(tab?.runtimeType || '') !== 'chromium') continue;
    const state = stateByProfileId.get(String(tab?.id || ''));
    const pid = Number(state?.pid || 0) || 0;
    const browserName = String(tab?.fixedTitle || tab?.tabTitle || '').trim();
    if (!browserName) continue;
    const candidate = {
      pid,
      profileId: String(state?.profileId || tab?.id || ''),
      browserName,
      startedAt: Number(state?.startedAt || 0) || 0,
    };
    browserCandidates.push(candidate);
    if (pid) browserByPid.set(pid, candidate);
  }

  const connectionItems = Array.isArray(connections) ? connections : [];
  const browserByConnectionId = new Map();
  const usedProfileIds = new Set();

  for (const connection of connectionItems) {
    const candidate = browserByPid.get(Number(connection?.browserProcessId || 0) || 0);
    if (!candidate) continue;
    browserByConnectionId.set(String(connection?.id || ''), candidate);
    usedProfileIds.add(candidate.profileId);
  }

  // 旧 Profile 可能尚未授予 processes 权限，插件无法上报浏览器 PID。
  // 浏览器运行时启动与插件登记紧邻发生，以时间差做一次一对一兼容匹配。
  const fallbackPairs = [];
  for (const connection of connectionItems) {
    const connectionId = String(connection?.id || '');
    if (browserByConnectionId.has(connectionId)) continue;
    const connectedAt = Number(connection?.connectedAt || 0) || 0;
    if (!connectedAt) continue;
    for (const candidate of browserCandidates) {
      if (usedProfileIds.has(candidate.profileId) || !candidate.startedAt) continue;
      const distance = Math.abs(connectedAt - candidate.startedAt);
      if (distance <= BROWSER_CONNECTION_START_MATCH_WINDOW_MS) {
        fallbackPairs.push({ connectionId, candidate, distance });
      }
    }
  }
  fallbackPairs.sort((left, right) => left.distance - right.distance);
  const usedConnectionIds = new Set(browserByConnectionId.keys());
  for (const pair of fallbackPairs) {
    if (usedConnectionIds.has(pair.connectionId) || usedProfileIds.has(pair.candidate.profileId)) continue;
    browserByConnectionId.set(pair.connectionId, pair.candidate);
    usedConnectionIds.add(pair.connectionId);
    usedProfileIds.add(pair.candidate.profileId);
  }

  return connectionItems.map((connection) => {
    const browser = browserByConnectionId.get(String(connection?.id || ''));
    const browserName = browser?.browserName || '';
    return browserName
      ? {
        ...connection,
        pluginName: connection.name,
        profileId: browser.profileId,
        browserName,
        name: browserName,
      }
      : connection;
  });
}

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
    getDebugConsoleHistory,
    getGlobalHttpClient,
    isSwitchingToLicenseRef,
    isMainBootstrappedRef,
    BrowserWindow,
    createMainWindow,
    getMainWindow,
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
    // 独立调试控制台早于 bootstrapMainApp 加载，先注册历史接口；打包版本也启用。
    try {
      ipcMain.removeHandler('get-app-console-history');
      ipcMain.handle('get-app-console-history', async () => {
        try {
          const history = typeof getDebugConsoleHistory === 'function'
            ? getDebugConsoleHistory()
            : (typeof getAppConsoleHistory === 'function' ? getAppConsoleHistory() : []);
          return { ok: true, history: Array.isArray(history) ? history : [] };
        } catch (error) {
          return { ok: false, error: error?.message || String(error), history: [] };
        }
      });
    } catch (e) {
      logger.warn?.('[启动] 注册调试控制台历史 IPC 失败:', e?.message || e);
    }

    if (typeof createDevConsoleWindow === 'function') {
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
        const store = readStoreConfigSafe();
        const credentials = store?.userCredentials || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        const customApi = getCustomAiApiConfig(store);
        const hasVipAccess = resolveVipAccess(credentials).isVip;
        const customModel = hasVipAccess && isCustomAiApiConfigured(customApi)
          ? {
            id: CUSTOM_AI_MODEL_ID,
            name: customApi.name,
            model: customApi.model,
            custom_api: true,
          }
          : null;
        if ((!key || !deviceId) && customModel) {
          return { ok: true, models: [customModel], quota: null };
        }
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.getAIControlModels !== 'function') {
          return customModel
            ? { ok: true, models: [customModel], quota: null, remoteError: 'AI 服务尚未就绪' }
            : { ok: false, message: 'AI 服务尚未就绪' };
        }
        const result = await httpClient.getAIControlModels(key, deviceId);
        if (!result?.ok) {
          return customModel
            ? { ok: true, models: [customModel], quota: null, remoteError: result?.message || result?.error || '' }
            : result;
        }
        return {
          ...result,
          models: [
            ...(Array.isArray(result.models) ? result.models : []),
            ...(customModel ? [customModel] : []),
          ],
        };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('ai-control-get-browser-connections', async () => {
      try {
        const bridge = deps.browserAutomationBridge;
        const connections = bridge && typeof bridge.listConnections === 'function'
          ? bridge.listConnections()
          : [];
        const tabs = typeof deps.getTabs === 'function' ? deps.getTabs() : [];
        const runtimeStates = deps.browserRuntimeManager
          && typeof deps.browserRuntimeManager.listStates === 'function'
          ? deps.browserRuntimeManager.listStates()
          : [];
        return {
          ok: true,
          connections: enrichBrowserConnectionNames(connections, tabs, runtimeStates),
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

    let legacyCardImportLastAttemptAt = 0;
    async function importLegacyCardsFromConnectedBrowsers(bridge) {
      if (!bridge?.dispatch || !bridge?.setCardCacheState) return null;
      const now = Date.now();
      if (now - legacyCardImportLastAttemptAt < 15000) return null;
      legacyCardImportLastAttemptAt = now;
      const imported = [];
      const connections = bridge.listConnections?.() || [];
      for (const connection of connections) {
        const fullConnection = bridge.getConnection?.(connection.id);
        const supportsCards = Array.isArray(fullConnection?.tools)
          && fullConnection.tools.some((tool) => String(tool?.name || '') === 'manage_card');
        if (!supportsCards) continue;
        try {
          const listed = await bridge.dispatch(connection.id, 'manage_card', { action: 'list' }, { timeoutMs: 10000 });
          for (const summary of Array.isArray(listed?.items) ? listed.items : []) {
            const id = String(summary?.id || '').trim();
            if (!id) continue;
            const detail = await bridge.dispatch(connection.id, 'manage_card', { action: 'get', id }, { timeoutMs: 10000 });
            if (!detail?.cardData || typeof detail.cardData !== 'object') continue;
            imported.push({
              id,
              cardData: detail.cardData,
              cardName: String(detail.cardName || detail.cardData.name || id),
              savedAt: String(detail.savedAt || summary.savedAt || new Date().toISOString()),
            });
          }
        } catch (error) {
          console.warn('[AutomationBridge] 从旧浏览器迁移卡片失败:', connection.id, error?.message || error);
        }
      }
      if (!imported.length) return null;
      const current = bridge.getCardCacheState?.()?.state || { items: [], selectedId: '' };
      const byId = new Map((Array.isArray(current.items) ? current.items : []).map((item) => [String(item?.id || ''), item]));
      for (const item of imported) {
        const previous = byId.get(item.id);
        if (!previous || Date.parse(item.savedAt || '') >= Date.parse(previous.savedAt || '')) byId.set(item.id, item);
      }
      const items = Array.from(byId.values()).filter((item) => item?.id);
      const selectedId = String(current.selectedId || imported[0]?.id || items[0]?.id || '');
      const state = bridge.setCardCacheState({ items, selectedId });
      console.log(`[AutomationBridge] 已从在线旧浏览器迁移 ${imported.length} 张卡片到软件卡片库`);
      return state;
    }

    ipcMain.handle('ai-control-get-automation-cards', async () => {
      try {
        const bridge = deps.browserAutomationBridge;
        let cached = bridge?.getCardCacheState?.() || { exists: false, state: { items: [], selectedId: '' } };
        if (!Array.isArray(cached?.state?.items) || cached.state.items.length === 0) {
          const migrated = await importLegacyCardsFromConnectedBrowsers(bridge);
          if (migrated) cached = { exists: true, state: migrated };
        }
        const items = Array.isArray(cached?.state?.items) ? cached.state.items : [];
        return {
          ok: true,
          selectedId: String(cached?.state?.selectedId || ''),
          cards: items.map((item) => ({
            id: String(item?.id || ''),
            name: String(item?.cardName || item?.cardData?.name || item?.id || '未命名卡片'),
            stepCount: Array.isArray(item?.cardData?.steps) ? item.cardData.steps.length : 0,
            savedAt: String(item?.savedAt || ''),
          })).filter((item) => item.id),
        };
      } catch (error) {
        return { ok: false, message: error?.message || String(error), cards: [], selectedId: '' };
      }
    });

    ipcMain.on('ai-control-browser-selection-changed', (_event, input = {}) => {
      const profileId = String(input?.profileId || '').trim();
      const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (!mainWindow || mainWindow.isDestroyed?.() || mainWindow.webContents?.isDestroyed?.()) return;
      mainWindow.webContents.send('ai-control-browser-selection-changed', { profileId });
    });

    ipcMain.handle('ai-control-select-automation-card', async (_event, input = {}) => {
      try {
        const selected = deps.browserAutomationBridge?.selectCard?.(input?.id);
        if (!selected?.item) throw new Error('软件卡片库不可用');
        return {
          ok: true,
          selectedId: String(selected.state?.selectedId || ''),
          card: {
            id: String(selected.item.id || ''),
            name: String(selected.item.cardName || selected.item.cardData?.name || selected.item.id || '未命名卡片'),
            stepCount: Array.isArray(selected.item.cardData?.steps) ? selected.item.cardData.steps.length : 0,
          },
        };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('get-vip-plans', async () => {
      try {
        const credentials = normalizeAccountSession(readStoreConfigSafe()?.userCredentials || {});
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.getVipPlans !== 'function') {
          return { ok: false, message: 'VIP 套餐服务尚未就绪' };
        }
        return await httpClient.getVipPlans(key, deviceId);
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('redeem-vip-gift-code', async (_event, input = {}) => {
      try {
        const currentStore = readStoreConfigSafe() || {};
        const credentials = normalizeAccountSession(currentStore.userCredentials || {});
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        const code = String(input.code || '').trim();
        if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
        if (!code) return { ok: false, message: '请输入礼品码' };
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.redeemVipGiftCode !== 'function') {
          return { ok: false, message: 'VIP 礼品码服务尚未就绪' };
        }
        const redeemed = await httpClient.redeemVipGiftCode(key, deviceId, code);
        if (!redeemed?.ok) return redeemed;

        let validation = {
          ...(credentials.validation || {}),
          is_vip: true,
          vip_active: true,
          vip_tier: redeemed.vip_tier || 'vip',
          vip_expiry_date: redeemed.vip_expiry_date || null,
        };
        if (typeof httpClient.validateKey === 'function') {
          const refreshed = await httpClient.validateKey(key, deviceId);
          if (refreshed?.valid === true || refreshed?.ok === true) validation = refreshed;
        }
        const account = {
          ...(credentials.account || {}),
          is_vip: true,
          vip_active: true,
          vip_tier: validation.vip_tier || redeemed.vip_tier || 'vip',
          vip_expiry_date: validation.vip_expiry_date ?? redeemed.vip_expiry_date ?? null,
        };
        const storedSession = buildStoredAccountSession({
          current: currentStore.userCredentials || {},
          username: credentials.username,
          key,
          deviceId,
          platformName: credentials.platformName,
          serverBase: credentials.serverBase,
          serverMode: credentials.serverMode,
          account,
          validation,
        });
        writeStoreConfigSafe({ ...currentStore, userCredentials: storedSession });
        licenseCache?.setValidationState?.({
          key,
          deviceId,
          bound: true,
          validated: true,
          licenseValidated: true,
          result: validation,
          message: redeemed.message || 'VIP 开通成功',
        });
        const session = {
          authenticated: true,
          username: credentials.username,
          platformName: credentials.platformName,
          account,
          validation,
        };
        deps.sendToSide?.('account-session-updated', session);
        return { ...redeemed, validation, session };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    ipcMain.handle('redeem-wool-gift-code', async (_event, input = {}) => {
      try {
        const credentials = readStoreConfigSafe()?.userCredentials || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        const code = String(input.code || '').trim();
        if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
        if (!code) return { ok: false, message: '请输入礼品码' };
        const httpClient = getGlobalHttpClient?.();
        if (!httpClient || typeof httpClient.redeemWoolGiftCode !== 'function') {
          return { ok: false, message: '羊毛礼品码服务尚未就绪' };
        }
        const redeemed = await httpClient.redeemWoolGiftCode(key, deviceId, code);
        if (!redeemed?.ok) return redeemed;

        // 兑换可能新增平台或改变平台额度，立即重新验证并刷新主进程缓存和侧边栏。
        let validation = null;
        if (typeof httpClient.validateKey === 'function') {
          validation = await httpClient.validateKey(key, deviceId);
          if (validation?.valid === true || validation?.ok === true) {
            const { normalizeValidationRuntimeConfig } = require('../lib/http-client');
            setLicenseRuntimeConfig(licenseCache, normalizeValidationRuntimeConfig(validation));
            licenseCache?.setValidationState?.({
              key,
              deviceId,
              bound: true,
              validated: true,
              licenseValidated: true,
              result: validation,
              message: redeemed.message || '羊毛礼品码兑换成功',
            });
            await Promise.resolve(deps.refreshAllowedPlatformsAndNotify?.());
          }
        }
        return { ...redeemed, validation };
      } catch (error) {
        return { ok: false, message: error?.message || String(error) };
      }
    });

    const activeAiChatRuns = new Map();
    const aiChatRunKey = (event, requestId) => `${event?.sender?.id || 0}:${String(requestId || '').trim()}`;

    // 软件端默认的"外层"浏览器窗口控制工具：不依赖任何浏览器插件连接，
    // 每次对话都会注入，让 AI 能列出/打开/新建/重命名/关闭软件的浏览器窗口。
    let aiBrowserWindowTools = null;
    const getAiBrowserWindowTools = () => {
      if (aiBrowserWindowTools) return aiBrowserWindowTools;
      if (!deps.browserWindowUi) return null;
      try {
        aiBrowserWindowTools = createAiBrowserWindowTools({
          ui: deps.browserWindowUi,
          licenseCache,
          logger,
        });
      } catch (error) {
        logger.warn?.('[AI窗口工具] 初始化失败:', error?.message || error);
      }
      return aiBrowserWindowTools;
    };

    ipcMain.handle('ai-control-chat-insert', async (_event, input = {}) => {
      const requestId = String(input.requestId || '').trim();
      const content = String(input.content || '').trim().slice(0, 12000);
      if (!requestId || !content) return { ok: false, message: '缺少要插入的对话内容' };
      const run = activeAiChatRuns.get(aiChatRunKey(_event, requestId));
      if (!run || run.stopped) return { ok: false, message: '当前 AI 回复已经结束' };
      run.insertedMessages.push({ role: 'user', content });
      return { ok: true, queued: run.insertedMessages.length };
    });

    ipcMain.handle('ai-control-chat-stop', async (_event, input = {}) => {
      const requestId = String(input.requestId || '').trim();
      const run = activeAiChatRuns.get(aiChatRunKey(_event, requestId));
      if (!run) return { ok: true, stopped: false };
      run.stopped = true;
      run.controller.abort();
      return { ok: true, stopped: true };
    });

    ipcMain.handle('ai-control-chat', async (_event, input = {}) => {
      let activeRun = null;
      let activeRunKey = '';
      try {
        const store = readStoreConfigSafe();
        const credentials = store?.userCredentials || {};
        const key = String(credentials.key || '').trim();
        const deviceId = String(credentials.deviceId || '').trim();
        const modelId = String(input.modelId || '').trim();
        const useCustomApi = isCustomAiModelId(modelId);
        const customApi = getCustomAiApiConfig(store);
        if (useCustomApi && !resolveVipAccess(credentials).isVip) {
          return createVipRequiredResult('自定义模型');
        }
        if (useCustomApi && !isCustomAiApiConfigured(customApi)) {
          return { ok: false, message: '自定义 API 尚未配置完整，请重新配置' };
        }
        if (!useCustomApi && (!key || !deviceId)) return { ok: false, message: '请先在个人中心登录账号' };
        const httpClient = getGlobalHttpClient?.();
        if (!useCustomApi && (!httpClient || typeof httpClient.sendAIControlMessage !== 'function')) {
          return { ok: false, message: 'AI 服务尚未就绪' };
        }
        const initialMessages = Array.isArray(input.messages) ? input.messages : [];
        const quota = input.quota && typeof input.quota === 'object' ? input.quota : null;
        if (!useCustomApi && quota && quota.unlimited !== true) {
          const total = Number(quota.quota);
          const used = Number(quota.used || 0);
          const remaining = Number(quota.remaining ?? (total - used));
          if (Number.isFinite(remaining) && remaining <= 0) {
            return { ok: false, message: 'AI 对话额度已用尽，请联系管理员', quota };
          }
        }
        const connectionId = String(input.browserConnectionId || '').trim();
        const automationCardId = String(input.automationCardId || '').trim();
        const disableTools = input.disableTools === true;
        const useStream = input.stream === true;
        const requestId = String(input.requestId || '').trim();
        if (useStream && requestId) {
          activeRunKey = aiChatRunKey(_event, requestId);
          activeRun = {
            controller: new AbortController(),
            insertedMessages: [],
            stopped: false,
          };
          activeAiChatRuns.set(activeRunKey, activeRun);
        }
        const emit = (payload) => {
          if (!useStream || !requestId || !_event.sender || _event.sender.isDestroyed()) return;
          _event.sender.send('ai-control-chat-event', { requestId, ...payload });
        };
        const bridge = deps.browserAutomationBridge;
        const connection = !disableTools && connectionId ? bridge?.getConnection?.(connectionId) : null;
        if (!disableTools && connectionId && !connection) {
          return { ok: false, message: '所选浏览器插件已离线，请刷新后重新选择' };
        }

        let selectedAutomationCard = null;
        if (!disableTools && automationCardId) {
          try {
            selectedAutomationCard = bridge?.selectCard?.(automationCardId)?.item || null;
          } catch (error) {
            return { ok: false, message: error?.message || '所选自动化卡片不存在，请刷新后重新选择' };
          }
        }

        const windowTools = disableTools ? null : getAiBrowserWindowTools();
        // 插件工具若与默认窗口工具重名，以本地窗口工具为准（派发时本地优先）。
        const connectionToolDefs = (connection?.tools || [])
          .filter((tool) => !windowTools?.has(String(tool?.name || '')));
        const tools = [...(windowTools?.tools || []), ...connectionToolDefs];
        const selectedAutomationCardName = String(
          selectedAutomationCard?.cardName || selectedAutomationCard?.cardData?.name || automationCardId,
        ).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
        const selectedAutomationCardId = automationCardId.slice(0, 200);
        const cardContextMessage = selectedAutomationCard && connection
          ? {
            role: 'system',
            content: `AI 控制当前选中的自动化卡片名称为 ${JSON.stringify(selectedAutomationCardName)}，ID 为 ${JSON.stringify(selectedAutomationCardId)}。当用户要求查看、修改或运行当前卡片时，优先通过 manage_card 使用该 ID；不要擅自改用其他卡片。`,
            ai_free_card_context: true,
          }
          : null;
        let modelMessages = limitAiControlMessages(cardContextMessage
          ? [cardContextMessage, ...initialMessages]
          : [...initialMessages]);
        const compactToolValue = (value) => {
          let serialized = '';
          try { serialized = JSON.stringify(value ?? null); } catch (_) { serialized = String(value ?? ''); }
          return serialized.length > 12000 ? `${serialized.slice(0, 12000)}…` : value;
        };
        let runId = '';
        let latestQuota = null;
        let reasoningLog = '';
        let streamedRoundContent = '';
        let streamedRoundReasoning = '';
        const toolEvents = [];
        const traceEvents = [];
        const mcpCallLimit = getAiControlMcpCallLimit(readStoreConfigSafe());
        let mcpCallCount = 0;
        let unresolvedToolFailure = '';
        const isStopped = (error) => activeRun?.stopped || activeRun?.controller.signal.aborted
          || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';
        const waitForAbort = (promise) => {
          if (!activeRun) return promise;
          if (activeRun.controller.signal.aborted) {
            const error = new Error('AI 输出已停止');
            error.name = 'AbortError';
            return Promise.reject(error);
          }
          return new Promise((resolve, reject) => {
            const signal = activeRun.controller.signal;
            const onAbort = () => {
              const error = new Error('AI 输出已停止');
              error.name = 'AbortError';
              reject(error);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            Promise.resolve(promise).then(
              (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
              },
              (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
              },
            );
          });
        };
        const takeInsertedMessages = (notify = true) => {
          if (!activeRun?.insertedMessages.length) return false;
          const inserted = activeRun.insertedMessages.splice(0);
          modelMessages.push(...inserted);
          if (notify) emit({ type: 'user_inserted', count: inserted.length });
          return true;
        };
        const buildStoppedResult = () => {
          takeInsertedMessages(false);
          const partialReasoning = String(streamedRoundReasoning || '');
          const partialContent = String(streamedRoundContent || '');
          const stoppedTraceEvents = partialReasoning
            ? [...traceEvents, { type: 'reasoning', round: traceEvents.length, content: partialReasoning }]
            : [...traceEvents];
          const cleanMessages = modelMessages
            .filter((message) => message?.ai_free_card_context !== true && message?.role !== 'tool')
            .map((message) => message?.role === 'assistant'
              ? { role: 'assistant', content: String(message.content || '') }
              : message)
            .filter((message) => message?.role !== 'assistant' || String(message.content || '').trim());
          const stoppedMessage = {
            role: 'assistant',
            content: partialContent,
            reasoning: `${reasoningLog}${reasoningLog && partialReasoning ? '\n\n' : ''}${partialReasoning}`,
            tool_events: toolEvents,
            trace_events: stoppedTraceEvents,
            stopped: true,
          };
          if (partialContent.trim() || stoppedMessage.reasoning.trim() || toolEvents.length) {
            cleanMessages.push({ role: 'assistant', content: partialContent });
          }
          const stoppedResult = {
            ok: true,
            stopped: true,
            quota: latestQuota,
            messages: limitAiControlMessages(cleanMessages),
            message: stoppedMessage,
          };
          emit({ type: 'stopped', message: stoppedMessage, quota: latestQuota });
          return stoppedResult;
        };
        const finishAfterToolFailure = (failureMessage) => {
          const detail = String(failureMessage || unresolvedToolFailure || '浏览器插件执行失败').trim().slice(0, 1000);
          const content = `浏览器插件操作失败：${detail}\n\n当前对话已保留，你可以检查浏览器连接或调整操作后重试。`;
          const finalMessages = limitAiControlMessages([
            ...modelMessages.filter((message) => message?.ai_free_card_context !== true),
            { role: 'assistant', content },
          ]);
          const finalResult = {
            ok: true,
            recoveredFromToolError: true,
            quota: latestQuota,
            messages: finalMessages,
            message: {
              role: 'assistant',
              content,
              reasoning: reasoningLog,
              tool_events: toolEvents,
              trace_events: traceEvents,
            },
          };
          emit({ type: 'done', message: finalResult.message, quota: finalResult.quota });
          return finalResult;
        };
        for (let round = 0; ; round += 1) {
          if (isStopped()) return buildStoppedResult();
          takeInsertedMessages();
          streamedRoundContent = '';
          streamedRoundReasoning = '';
          emit({ type: 'round_start', round });
          modelMessages = limitAiControlMessages(modelMessages);
          let result;
          try {
            result = useCustomApi
              ? await sendCustomAIControlMessage(customApi, modelMessages, {
                tools,
                signal: activeRun?.controller.signal,
              })
              : useStream && typeof httpClient.streamAIControlMessage === 'function'
                ? await httpClient.streamAIControlMessage(
                key,
                deviceId,
                modelId,
                modelMessages,
                { tools, runId, signal: activeRun?.controller.signal },
                (streamEvent) => {
                  if (streamEvent?.type === 'content_delta') streamedRoundContent += String(streamEvent.delta || '');
                  if (streamEvent?.type === 'reasoning_delta') streamedRoundReasoning += String(streamEvent.delta || '');
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
          } catch (error) {
            if (isStopped(error)) return buildStoppedResult();
            if (unresolvedToolFailure) return finishAfterToolFailure(error?.message || unresolvedToolFailure);
            throw error;
          }
          if (isStopped()) return buildStoppedResult();
          if (!result?.ok) {
            if (unresolvedToolFailure) {
              return finishAfterToolFailure(result?.message || result?.error || unresolvedToolFailure);
            }
            emit({ type: 'error', message: result?.message || result?.error || '对话请求失败' });
            return result;
          }
          unresolvedToolFailure = '';
          latestQuota = result.quota || latestQuota;
          runId = String(result.run_id || runId || '');
          const roundReasoning = String(result.message?.reasoning || '');
          if (roundReasoning) {
            reasoningLog += `${reasoningLog ? '\n\n' : ''}${roundReasoning}`;
            traceEvents.push({ type: 'reasoning', round, content: roundReasoning });
          }
          const toolCalls = Array.isArray(result.message?.tool_calls) ? result.message.tool_calls : [];
          if (!toolCalls.length) {
            modelMessages.push({
              role: 'assistant',
              content: String(result.message?.content || ''),
            });
            if (takeInsertedMessages()) continue;
            const finalMessages = limitAiControlMessages(
              modelMessages.filter((message) => message?.ai_free_card_context !== true),
            );
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
          const needsPluginConnection = toolCalls.some(
            (call) => !windowTools?.has(String(call?.function?.name || '').trim()),
          );
          if (needsPluginConnection && (!connection || !bridge?.dispatch)) {
            return finishAfterToolFailure('模型请求了浏览器插件工具，但当前没有选择可用的浏览器插件');
          }

          if (toolCalls.length >= MAX_AI_CONTROL_MESSAGES) {
            return finishAfterToolFailure(`模型单轮请求了 ${toolCalls.length} 个浏览器工具，超过可安全处理的数量`);
          }

          if (mcpCallCount + toolCalls.length > mcpCallLimit) {
            return {
              ok: false,
              message: `MCP 工具调用次数已达到上限（${mcpCallLimit} 次），已停止本轮任务`,
              quota: latestQuota,
              messages: modelMessages,
            };
          }

          modelMessages.push({
            role: 'assistant',
            content: String(result.message?.content || ''),
            tool_calls: toolCalls,
          });
          // 本轮模型输出已经完整进入消息链；后续若在 MCP 执行中停止，不要把同一段流式正文重复保存。
          streamedRoundContent = '';
          streamedRoundReasoning = '';
          const roundContent = String(result.message?.content || '').trim();
          if (roundContent) traceEvents.push({ type: 'step', round, content: roundContent });
          for (const call of toolCalls) {
            mcpCallCount += 1;
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
              if (windowTools?.has(toolName)) {
                toolResult = await waitForAbort(windowTools.execute(toolName, args));
              } else {
                const requestedSeconds = Number(args?.timeout_seconds || 0);
                const isCardRun = toolName === 'manage_card'
                  && String(args?.action || '').trim().toLowerCase() === 'run';
                toolResult = await waitForAbort(bridge.dispatch(connection.id, toolName, args, {
                  timeoutMs: requestedSeconds > 0
                    ? Math.min(1800, Math.max(1, requestedSeconds)) * 1000
                    : (isCardRun ? 900000 : 180000),
                }));
              }
            } catch (error) {
              if (isStopped(error)) return buildStoppedResult();
              const errorMessage = String(error?.message || error || '浏览器工具执行失败').trim();
              toolResult = {
                success: false,
                error: errorMessage,
                errorReason: errorMessage,
                errorCode: String(error?.errorCode || error?.code || 'BROWSER_TOOL_FAILED'),
                phase: String(error?.phase || 'tool_dispatch'),
                tool: String(error?.tool || toolName),
                ...(Number(error?.timeoutMs || 0) > 0 ? { timeoutMs: Number(error.timeoutMs) } : {}),
              };
            }
            const toolFailed = toolResult?.success === false || toolResult?.ok === false;
            activity.status = toolFailed ? 'error' : 'success';
            activity.result = compactToolValue(toolResult ?? null);
            emit({ type: 'tool_result', tool: { ...activity }, round });
            if (toolFailed) {
              unresolvedToolFailure = String(toolResult?.error || toolResult?.message || `${toolName} 执行失败`);
              toolResult = {
                ...(toolResult && typeof toolResult === 'object' ? toolResult : {}),
                success: false,
                error: unresolvedToolFailure,
                recoverable: true,
                instruction: '本次浏览器操作失败。请根据错误调整参数或向用户说明，不要终止整个对话。',
              };
            }
            let serializedToolResult = '';
            try {
              serializedToolResult = JSON.stringify(toolResult ?? null);
            } catch (_) {
              unresolvedToolFailure = `${toolName} 返回了无法序列化的结果`;
              serializedToolResult = JSON.stringify({
                success: false,
                error: unresolvedToolFailure,
                recoverable: true,
              });
            }
            modelMessages.push({
              role: 'tool',
              tool_call_id: String(call.id || ''),
              name: toolName,
              content: serializedToolResult,
            });
          }
          takeInsertedMessages();
        }
      } catch (error) {
        if (activeRun?.stopped || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
          return { ok: true, stopped: true, messages: [], message: { role: 'assistant', content: '' } };
        }
        return { ok: false, message: error?.message || String(error) };
      } finally {
        if (activeRunKey && activeAiChatRuns.get(activeRunKey) === activeRun) {
          activeAiChatRuns.delete(activeRunKey);
        }
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

    ipcMain.handle('ai-control-history-rename', async (_event, input = {}) => {
      try {
        return aiChatHistory.renameSession(historyCredentials(), input?.id, input?.title);
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
        // 退出账号只撤销软件账号会话，不终止已经打开的 Chromium 环境。
        // 浏览器页面继续保留，由用户自行关闭；应用真正退出时仍会统一 stopAll。
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
      // Node 的 uncaughtExceptionMonitor 只能记日志，不能阻止 Electron 弹出
      // 主进程异常框；退出期需要真正接住 Mihomo 断连产生的 ECONNRESET。
      installShutdownUncaughtExceptionGuard();
      // 让仍在等待 IPC（例如 Clash Mini 启动）的侧边栏把随后到达的取消/
      // 连接重置识别为正常退出，避免在窗口关闭前弹出错误框。
      try { sendToSide?.('app-shutting-down', { reason: 'quit' }); } catch (_) {}
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
          await deps.browserAutomationBridge?.stop?.();
        } catch (e) {
          logger.warn?.('[退出] 关闭浏览器插件桥接失败:', e?.message || e);
        }

        try {
          if (deps.browserRuntimeManager && typeof deps.browserRuntimeManager.stopAll === 'function') {
            logger.log?.('[退出] 正在优雅关闭 Chromium Profile...');
            await deps.browserRuntimeManager.stopAll({ timeoutMs: isUpdateExit ? 2000 : 5000 });
          }
        } catch (e) {
          logger.warn?.('[退出] Chromium Profile 关闭失败:', e?.message || e);
        }

        // Chromium 必须先于代理核心退出，否则它的活动连接会在 Mihomo 被杀时
        // 同时触发 ECONNRESET。启动任务也会由 stopClashMiniProcess 取消并收敛。
        try {
          logger.log?.('[退出] 正在关闭 Clash Mini...');
          const clashStopResult = await stopClashMiniProcess({ sendToSide });
          if (clashStopResult?.ok === false) {
            logger.warn?.('[退出] Clash Mini 未完全退出:', clashStopResult.error || clashStopResult);
          } else {
            logger.log?.('[退出] Clash Mini 已关闭');
          }
        } catch (e) {
          logger.warn?.('[退出] 关闭 Clash Mini 失败:', e?.message || e);
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
  BROWSER_CONNECTION_START_MATCH_WINDOW_MS,
  enrichBrowserConnectionNames,
  registerAppLifecycle,
};
