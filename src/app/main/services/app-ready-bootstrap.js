const { createAiSupportService } = require('../features/ai-chat/ai-support-service');
const { createAiChatService } = require('../features/ai-chat/ai-chat-service');
const { registerAiHistoryIpc } = require('../features/ai-chat/register-history-ipc');
const {
  createAiChatHistoryRepository,
  createDomainHistoryRepository,
} = require('../features/ai-chat/history-repository');
const { registerAiSupportIpc } = require('../features/ai-chat/register-support-ipc');
const { registerAiChatIpc } = require('../features/ai-chat/register-chat-ipc');
const { createAccountService } = require('../features/account/account-service');
const { registerAccountIpc } = require('../features/account/register-account-ipc');
const { createLicenseService } = require('../features/account/license-service');
const { registerLicenseIpc } = require('../features/account/register-license-ipc');
const { createMembershipService } = require('../features/account/membership-service');
const { registerAiServerDeviceIpc } = require('../features/ai-chat/register-ai-server-device-ipc');
const {
  normalizeSoftwareCardData,
} = require('../features/external-app/software-card-data');
const {
  createSoftwareHistoryRepository,
} = require('../features/ai-chat/software-history-repository');
const {
  scopeAiControlStore,
} = require('../features/ai-chat/ai-settings-service');

function registerConsoleHistoryIpc(deps, ipc) {
  try {
    ipc.handle('get-app-console-history', async () => {
      try {
        const provider = typeof deps.getDebugConsoleHistory === 'function'
          ? deps.getDebugConsoleHistory
          : deps.getAppConsoleHistory;
        const history = typeof provider === 'function' ? provider() : [];
        return { ok: true, history: Array.isArray(history) ? history : [] };
      } catch (error) {
        return { ok: false, error: error?.message || String(error), history: [] };
      }
    });
  } catch (error) {
    deps.logger.warn?.('[启动] 注册调试控制台历史 IPC 失败:', error?.message || error);
  }
}

function openDevConsole(deps) {
  if (!deps.isDevMode || typeof deps.createDevConsoleWindow !== 'function') return;
  try {
    deps.createDevConsoleWindow();
  } catch (error) {
    deps.logger.warn?.('[启动] 预创建调试控制台失败:', error?.message || error);
  }
}

function scheduleCoreDirectoryInitialization(deps) {
  setImmediate(() => {
    try {
      const ok = deps.initializeCoreDirectory();
      const method = ok ? 'log' : 'warn';
      deps.logger[method]?.(`[配置] initializeCoreDirectory ${ok ? '执行完成' : '返回 false'}`);
    } catch (error) {
      deps.logger.warn?.('[配置] initializeCoreDirectory 执行异常:', error?.message || error);
    }
  });
}

function scheduleUpdateStorageCleanup(deps) {
  setImmediate(() => {
    try {
      if (typeof deps.cleanupUpdateStorageRoot !== 'function') return;
      const result = deps.cleanupUpdateStorageRoot();
      const method = result?.ok ? 'log' : 'warn';
      deps.logger[method]?.(`[更新] 启动后更新缓存清理${result?.ok ? '完成' : '未完成'}:`, result);
    } catch (error) {
      deps.logger.warn?.('[更新] 启动后更新缓存清理异常:', error?.message || error);
    }
  });
}

function scheduleDeviceIdLog(deps) {
  setImmediate(async () => {
    try {
      deps.logger.log?.('[启动] 设备号:', await deps.computeDeviceId());
    } catch (error) {
      deps.logger.warn?.('[启动] 打印设备号失败:', error?.message || error);
    }
  });
}

function createAndRegisterAccountServices(deps, ipc) {
  const accountService = createAccountService({
    authenticateAccount: deps.authenticateAccount,
    computeDeviceId: deps.computeDeviceId,
    readStoreConfigSafe: deps.readStoreConfigSafe,
    writeStoreConfigSafe: deps.writeStoreConfigSafe,
    licenseCache: deps.licenseCache,
    getGlobalHttpClient: deps.getGlobalHttpClient,
    applyResolvedConfigToStore: deps.applyResolvedConfigToStore,
    refreshAnnouncements: deps.refreshAnnouncements,
    refreshAllowedPlatformsAndNotify: deps.refreshAllowedPlatformsAndNotify,
    sendToSide: deps.sendToSide,
    setRuntimeServerBase: deps.setRuntimeServerBase,
    setRuntimeTcpConfig: deps.setRuntimeTcpConfig,
    stopProxy: deps.stopClashMiniProcess,
    logger: deps.logger,
  });
  registerAccountIpc({ ipc, service: accountService });
  const licenseService = createLicenseService({
    computeDeviceId: deps.computeDeviceId,
    getCurrentPlatformLabel: deps.getCurrentPlatformLabel,
    getGlobalHttpClient: deps.getGlobalHttpClient,
    licenseCache: deps.licenseCache,
    readLicenseRecordsSafe: deps.readLicenseRecordsSafe,
    readStoreConfigSafe: deps.readStoreConfigSafe,
    refreshAllowedPlatformsAndNotify: deps.refreshAllowedPlatformsAndNotify,
    sendToSide: deps.sendToSide,
    writeLicenseRecordsSafe: deps.writeLicenseRecordsSafe,
    writeStoreConfigSafe: deps.writeStoreConfigSafe,
  });
  registerLicenseIpc({ ipc, service: licenseService });
  return accountService;
}

function createAiDomainDeps(deps) {
  const software = deps.softwareWorkspace;
  return {
    browser: { ...deps, workspaceType: deps.workspaceType || '' },
    software: software ? {
    ...deps,
    workspaceType: 'software',
    browserAutomationBridge: software.automationBridge,
    browserWindowUi: null,
    cursorSidecarService: null,
    getTabs: () => software.state.tabs,
    getActiveTabId: software.state.getActiveTabId,
    getMainWindow: software.state.getWindow,
    normalizeAutomationCardData: normalizeSoftwareCardData,
    sendToSide: software.sendToSide,
    softwareWindowUi: software.softwareWindowUi,
    readStoreConfigSafe: () => scopeAiControlStore(
      deps.readStoreConfigSafe(),
      'softwareAiControlSettings',
    ),
    } : null,
  };
}

function createDomainSupport(deps, serviceDeps) {
  return createAiSupportService({
    ...serviceDeps,
    readStoreConfigSafe: serviceDeps.readStoreConfigSafe,
    computeDeviceId: deps.computeDeviceId,
    licenseCache: deps.licenseCache,
    getGlobalHttpClient: deps.getGlobalHttpClient,
    logger: deps.logger,
    onAutomationProgress: (payload) => serviceDeps.sendToSide?.(
      'automation-card-progress',
      serviceDeps.workspaceType
        ? { ...payload, domain: serviceDeps.workspaceType }
        : payload,
    ),
  });
}

function createDomainResolver(deps, browserService, softwareService) {
  const resolveDomain = (event) => deps.getWorkspaceType?.(event)
    || deps.workspaceType
    || 'browser';
  return (event) => (
    resolveDomain(event) === 'software' && softwareService
      ? softwareService
      : browserService
  );
}

function registerDomainHistory(deps, ipc) {
  const repository = createAiChatHistoryRepository();
  const repositories = {
    browser: createDomainHistoryRepository(repository, deps.workspaceType),
    software: deps.softwareWorkspace
      ? createSoftwareHistoryRepository({
        directory: deps.softwareWorkspace.aiHistoryDirectory,
        fs: deps.fs,
        legacyRepository: repository,
      })
      : createDomainHistoryRepository(repository, 'software'),
  };
  registerAiHistoryIpc({
    ipc,
    historyRepository: repositories.browser,
    resolveRepository: (event) => (
      deps.getWorkspaceType?.(event) === 'software'
        ? repositories.software
        : repositories.browser
    ),
    getCredentials: () => deps.readStoreConfigSafe()?.userCredentials || {},
  });
}

function createAndRegisterAiServices(deps, ipc) {
  const domainDeps = createAiDomainDeps(deps);
  const browserSupport = createDomainSupport(deps, domainDeps.browser);
  const softwareSupport = domainDeps.software
    ? createDomainSupport(deps, domainDeps.software)
    : null;
  const resolveSupport = createDomainResolver(deps, browserSupport, softwareSupport);
  registerAiSupportIpc({
    ipc,
    service: browserSupport,
    resolveService: resolveSupport,
  });
  const browserChat = createAiChatService(domainDeps.browser);
  const softwareChat = domainDeps.software
    ? createAiChatService(domainDeps.software)
    : null;
  registerAiChatIpc({
    ipc,
    service: browserChat,
    resolveService: createDomainResolver(deps, browserChat, softwareChat),
  });
  deps.browserAutomationBridge?.configureExternalMcp?.({
    getConnections: () => browserSupport.getBrowserConnections().connections,
    getWindowTools: browserChat.getWindowTools,
  });
  if (deps.aiServerDeviceService) {
    registerAiServerDeviceIpc({ ipc, service: deps.aiServerDeviceService });
  }
  registerDomainHistory(deps, ipc);
  deps.setBrowserDomainDisposer?.(async () => {
    browserChat.dispose?.();
    try {
      await browserSupport.stopAutomationCard();
    } catch (error) {
      deps.logger.warn?.(
        '[BrowserWorkspace] 停止自动化任务失败:',
        error?.message || error,
      );
    }
  });
  deps.softwareWorkspace?.setDomainDisposer?.(async () => {
    softwareChat?.dispose?.();
    await softwareSupport?.stopAutomationCard?.();
  });
}

function createMembership(deps) {
  return createMembershipService({
    applyResolvedConfigToStore: deps.applyResolvedConfigToStore,
    getGlobalHttpClient: deps.getGlobalHttpClient,
    licenseCache: deps.licenseCache,
    logger: deps.logger,
    readStoreConfigSafe: deps.readStoreConfigSafe,
    refreshAllowedPlatformsAndNotify: deps.refreshAllowedPlatformsAndNotify,
    sendToSide: deps.sendToSide,
    writeStoreConfigSafe: deps.writeStoreConfigSafe,
  });
}

function ensureMembershipHttpClient(deps) {
  const current = deps.getGlobalHttpClient?.();
  if (current) return current;
  if (typeof deps.createHttpClient !== 'function') return null;
  const client = deps.createHttpClient({ mainWindow: null });
  deps.setGlobalHttpClient?.(client);
  return deps.getGlobalHttpClient?.() || client;
}

async function restoreMembership(deps) {
  ensureMembershipHttpClient(deps);
  return createMembership(deps).restore();
}

async function bootstrapReadyApp(deps, ipc) {
  registerConsoleHistoryIpc(deps, ipc);
  openDevConsole(deps);
  scheduleCoreDirectoryInitialization(deps);
  scheduleUpdateStorageCleanup(deps);
  scheduleDeviceIdLog(deps);
  const accountService = createAndRegisterAccountServices(deps, ipc);
  createAndRegisterAiServices({ ...deps, accountService }, ipc);
  try {
    await restoreMembership(deps);
    void deps.aiServerDeviceService?.startAutomatically?.().catch((error) => {
      deps.logger.warn?.('[AIServerDevice] 自动登录失败:', error?.message || error);
    });
    await deps.bootstrapMainApp();
  } catch (error) {
    deps.logger.error?.('[启动] 打开主界面失败:', error?.message || error);
  }
}

module.exports = { bootstrapReadyApp, restoreMembership };
