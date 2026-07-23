'use strict';

const { createAiBrowserWindowTools } = require('../../services/ai-browser-window-tools');
const { createAiSandboxFileTools } = require('../../services/ai-sandbox-file-tools');
const { createAiSoftwareUiTools } = require('../../services/ai-software-ui-tools');
const { createChatRunRegistry } = require('./chat-run-registry');
const { prepareChatRequest } = require('./chat-request-context');
const { runChatConversation } = require('./chat-conversation-runner');
const { enrichBrowserConnectionNames } = require('./connection-names');
const { clonePromptValue, createPromptDiagnostics } = require('./chat-prompt-diagnostics');

function namedBrowserConnections(deps) {
  const bridge = deps.browserAutomationBridge;
  const connections = (bridge?.listConnections?.() || [])
    .map((item) => bridge.getConnection?.(item.id))
    .filter(Boolean);
  return enrichBrowserConnectionNames(
    connections,
    typeof deps.getTabs === 'function' ? deps.getTabs() : [],
    deps.browserRuntimeManager?.listStates?.() || [],
  );
}

async function waitForBrowserConnection(deps, target = {}, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const wantedName = String(target.name || '').trim().toLowerCase();
  const wantedProfile = String(target.tabId || target.profileId || '').trim();
  do {
    const found = namedBrowserConnections(deps).find((item) => (
      (wantedProfile && String(item.profileId || '') === wantedProfile)
      || (wantedName && String(item.name || '').trim().toLowerCase() === wantedName)
    ));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return null;
}

function createBaseWindowTools(deps, cache, licenseCache, logger) {
  if (!cache.browser && deps.browserWindowUi) {
    cache.browser = createAiBrowserWindowTools({
      ui: deps.browserWindowUi,
      licenseCache,
      logger,
      waitForBrowserConnection: (target) => waitForBrowserConnection(deps, target),
    });
  }
  if (!cache.files) cache.files = createAiSandboxFileTools({ sandboxDir: deps.aiSandboxDir });
  return [cache.browser, cache.files].filter(Boolean);
}

function combineWindowTools(sources) {
  if (!sources.length) return null;
  return {
    tools: sources.flatMap((source) => source.tools),
    has: (name) => sources.some((source) => source.has(name)),
    execute: (name, args) => {
      const source = sources.find((candidate) => candidate.has(name));
      if (!source) throw new Error(`暂无该 MCP 调用：${name}`);
      return source.execute(name, args);
    },
  };
}

function activeSoftwareTools(deps, cache, target) {
  if (!target) {
    cache.activeSoftware = null;
    return null;
  }
  const key = [
    String(target.profileId || ''),
    String(target.hwnd || ''),
    Number(target.pid || 0),
  ].join(':');
  if (cache.activeSoftware?.key !== key) {
    cache.activeSoftware = {
      key,
      tools: createAiSoftwareUiTools({
        windowBridge: deps.browserRuntimeManager?.windowBridge,
        target,
      }),
    };
  }
  return cache.activeSoftware.tools;
}

function createWindowToolProvider(deps, licenseCache, logger) {
  const cache = { browser: null, files: null, activeSoftware: null };
  return (selection = null) => {
    try {
      const profileId = deps.getActiveTabId?.();
      const activeTarget = deps.browserRuntimeManager?.externalApp?.getAutomationTarget?.(profileId);
      const target = selection && typeof selection === 'object'
        ? selection.softwareTarget
        : activeTarget;
      const software = selection && typeof selection === 'object'
        ? createAiSoftwareUiTools({
          windowBridge: deps.browserRuntimeManager?.windowBridge,
          target,
        })
        : activeSoftwareTools(deps, cache, target);
      const sources = [...createBaseWindowTools(deps, cache, licenseCache, logger), software]
        .filter((source) => source?.tools?.length);
      return combineWindowTools(sources);
    } catch (error) {
      logger.warn?.('[AI窗口工具] 初始化失败:', error?.message || error);
      return null;
    }
  };
}

function createAiChatService(deps = {}) {
  const {
    readStoreConfigSafe,
    licenseCache,
    logger = console,
  } = deps;
    const chatRuns = createChatRunRegistry();
    let lastPromptRequest = null;
    const getAiBrowserWindowTools = createWindowToolProvider(deps, licenseCache, logger);

    async function insert(_event, input = {}) {
      const requestId = String(input.requestId || '').trim();
      const content = String(input.content || '').trim();
      if (!requestId || !content) return { ok: false, message: '缺少要插入的对话内容' };
      return chatRuns.insert(_event, requestId, content);
    }

    async function stop(_event, input = {}) {
      const requestId = String(input.requestId || '').trim();
      return chatRuns.stop(_event, requestId);
    }

    async function chat(_event, input = {}) {
      let activeRun = null;
      let activeRunKey = '';
      try {
        const request = prepareChatRequest(deps, _event, input, chatRuns, getAiBrowserWindowTools);
        request.capturePromptSnapshot = (snapshot) => {
          lastPromptRequest = clonePromptValue(snapshot);
        };
        activeRunKey = request.key || '';
        activeRun = request.run || null;
        if (request.error) return request.error;
        return await runChatConversation(request, readStoreConfigSafe);
      } catch (error) {
        if (activeRun?.stopped || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
          return { ok: true, stopped: true, messages: [], message: { role: 'assistant', content: '' } };
        }
        return { ok: false, message: error?.message || String(error) };
      } finally {
        chatRuns.finish(activeRunKey, activeRun);
      }
    }

    function getPromptDiagnostics(_event, input = {}) {
      return createPromptDiagnostics(
        deps, input, getAiBrowserWindowTools, lastPromptRequest,
      );
    }

    return { chat, getPromptDiagnostics, getWindowTools: getAiBrowserWindowTools, insert, stop };
}

module.exports = {
  combineWindowTools,
  createAiChatService,
  createWindowToolProvider,
  namedBrowserConnections,
  waitForBrowserConnection,
};
