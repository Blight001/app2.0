'use strict';

const { manageNativeCard } = require('./native-card-manager');
const { NATIVE_BROWSER_TOOL_DEFS } = require('./native-tool-definitions');

const READY_STATES = new Set(['ready', 'hidden']);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function text(value) {
  return String(value == null ? '' : value).trim();
}

function resultBody(response) {
  return response?.result && typeof response.result === 'object' ? response.result : (response || {});
}

function tabNameMap(getTabs) {
  const source = getTabs?.();
  const tabs = source instanceof Map ? Array.from(source.values()) : (Array.isArray(source) ? source : []);
  return new Map(tabs.map((tab) => [
    text(tab?.id),
    text(tab?.fixedTitle || tab?.tabTitle || tab?.title || tab?.id),
  ]));
}

function createConnection(state, names) {
  const profileId = text(state.profileId);
  const name = names.get(profileId) || `AI-FREE 浏览器 ${profileId.slice(0, 8)}`;
  return {
    id: `native:${profileId}`,
    instanceId: profileId,
    browserProcessId: Number(state.pid || 0),
    profileId,
    name,
    browserName: name,
    platform: 'ai-free-chromium-runtime',
    version: '1',
    toolCount: NATIVE_BROWSER_TOOL_DEFS.length,
    capabilities: NATIVE_BROWSER_TOOL_DEFS.map((tool) => tool.name),
    connectedAt: Number(state.startedAt || Date.now()),
    lastSeenAt: Number(state.lastHeartbeatAt || Date.now()),
    online: READY_STATES.has(text(state.status)),
  };
}

function normalizeTabPayload(args) {
  return {
    action: text(args.action).toLowerCase(),
    url: text(args.url),
    tabId: Number(args.tab_id ?? args.tabId ?? args.id) || 0,
  };
}

async function executeTab(runtime, profileId, args) {
  const payload = normalizeTabPayload(args);
  if (payload.action === 'replace') {
    const response = await runtime.navigate(profileId, payload.url);
    return { success: true, action: payload.action, url: payload.url, ...resultBody(response) };
  }
  const response = await runtime.sendCommand(profileId, 'manage-tabs', payload, { timeoutMs: 30000 });
  return { success: true, ...resultBody(response) };
}

async function executeAction(runtime, profileId, args) {
  if (text(args.action) === 'upload_file') {
    const session = resultBody(await runtime.sendCommand(
      profileId, 'get-session-data', {}, { timeoutMs: 30000 },
    ));
    await runtime.selectFiles(profileId, {
      paths: Array.isArray(args.paths) ? args.paths : [args.path].filter(Boolean),
      mode: args.mode,
      pageUrl: session.pageUrl || session.url,
    });
  }
  const response = await runtime.dispatchAutomation(profileId, 'perform-action', args);
  const result = resultBody(response);
  if (text(args.action) === 'type' && args.submit === true) {
    await runtime.dispatchAutomation(profileId, 'perform-action', { action: 'press_key', key: 'Enter' });
  }
  if (['click', 'double_click', 'right_click', 'type'].includes(text(args.action))) {
    result.cardStep = {
      type: text(args.action) === 'type' ? 'type' : 'click',
      name: text(args.action) === 'type' ? '输入内容' : '点击元素',
      selector: text(args.selector),
      ...(text(args.action) === 'type' ? { text: String(args.text ?? '') } : {}),
    };
  }
  return result;
}

async function executeWait(runtime, profileId, args) {
  const selector = text(args.selector);
  if (!selector) {
    const ms = Math.max(0, Math.min(120000, Number(args.ms) || 1000));
    await delay(ms);
    return { success: true, waitedMs: ms, cardStep: { type: 'wait', name: '固定等待', wait_ms: ms } };
  }
  const result = resultBody(await runtime.dispatchAutomation(profileId, 'perform-action', {
    action: 'wait',
    selector,
    timeout_ms: Number(args.timeout_ms) || 10000,
  }));
  return { ...result, cardStep: { type: 'wait', name: '等待元素', selector } };
}

async function executeDownload(runtime, profileId, downloadService, args) {
  const action = text(args.action || 'download').toLowerCase();
  if (action === 'info') return downloadService.execute({ action });
  const session = resultBody(await runtime.sendCommand(profileId, 'get-session-data', {}, { timeoutMs: 30000 }));
  if (action === 'save_session') return downloadService.execute({ ...args, action, session });
  return downloadService.execute({
    ...args,
    action,
    cookies: args.use_cookies === false ? [] : session.cookies,
    referer: session.pageUrl || session.url,
    user_agent: session.userAgent,
  });
}

function createRuntimeAdapter(manager, downloadService) {
  return {
    dispatchAutomation: (profileId, command, input) => manager.dispatchAutomation(profileId, command, input),
    navigate: (profileId, url) => manager.navigate(profileId, 'chromium', url),
    selectFiles: (profileId, selection) => manager.selectFiles(profileId, selection),
    sendCommand: (profileId, command, input, options) => manager.sendChromiumCommand(profileId, command, input, options),
    saveSession: (input) => downloadService.execute(input),
    saveScreenshot: (dataUrl, input) => downloadService.saveScreenshot(dataUrl, input),
  };
}

async function dispatchBrowserTool(service, connectionId, profileId, tool, args) {
  if (tool === 'browser_tab') return executeTab(service.runtime, profileId, args);
  if (tool === 'browser_observe') {
    const observed = resultBody(await service.runtime.dispatchAutomation(profileId, 'observe-page', args));
    service.observeSelectors.set(connectionId, new Map((observed.items || [])
      .map((item) => [text(item?.id), text(item?.selector)])
      .filter(([id, selector]) => id && selector)));
    return observed;
  }
  if (tool === 'browser_screenshot') {
    return resultBody(await service.runtime.dispatchAutomation(profileId, 'capture-screenshot', args));
  }
  if (tool === 'browser_action') {
    const selector = text(args.selector)
      || service.observeSelectors.get(connectionId)?.get(text(args.ref))
      || '';
    return executeAction(service.runtime, profileId, { ...args, selector });
  }
  if (tool === 'browser_wait') return executeWait(service.runtime, profileId, args);
  if (tool === 'browser_download') {
    return executeDownload(service.runtime, profileId, service.downloadService, args);
  }
  throw new Error(`AI-FREE 浏览器不支持工具: ${tool}`);
}

class NativeBrowserToolService {
  constructor(options = {}) {
    this.manager = options.browserRuntimeManager;
    this.getTabs = options.getTabs;
    this.cardStore = options.cardStore;
    this.downloadService = options.downloadService;
    this.runtime = createRuntimeAdapter(this.manager, this.downloadService);
    this.cardRuns = new Map();
    this.observeSelectors = new Map();
  }

  listConnections() {
    const names = tabNameMap(this.getTabs);
    return (this.manager?.listStates?.() || [])
      .filter((state) => READY_STATES.has(text(state?.status)) && Number(state?.pid || 0) > 0)
      .map((state) => createConnection(state, names));
  }

  getConnection(id) {
    const connection = this.listConnections().find((item) => item.id === text(id));
    return connection ? { ...connection, tools: NATIVE_BROWSER_TOOL_DEFS } : null;
  }

  async dispatch(connectionId, tool, args = {}) {
    const connection = this.getConnection(connectionId);
    if (!connection) throw new Error('所选 AI-FREE 浏览器已经关闭');
    const profileId = connection.profileId;
    if (tool !== 'manage_card') {
      return dispatchBrowserTool(this, connectionId, profileId, tool, args);
    }
    return this.dispatchCard(connectionId, profileId, args);
  }

  async dispatchCard(connectionId, profileId, args) {
    const action = text(args.action).toLowerCase();
    if (action === 'stop') {
      const active = this.cardRuns.get(connectionId);
      active?.abort();
      return { success: true, stopped: Boolean(active), connectionId };
    }
    if (action !== 'run') {
      return manageNativeCard({ store: this.cardStore, runtime: this.runtime, profileId }, args);
    }
    if (this.cardRuns.has(connectionId)) throw new Error('该浏览器已有自动化卡片正在运行');
    const controller = new AbortController();
    this.cardRuns.set(connectionId, controller);
    try {
      return await manageNativeCard(
        { store: this.cardStore, runtime: this.runtime, profileId },
        { ...args, signal: controller.signal },
      );
    } finally {
      if (this.cardRuns.get(connectionId) === controller) this.cardRuns.delete(connectionId);
    }
  }
}

function createNativeBrowserToolService(options) {
  return new NativeBrowserToolService(options);
}

module.exports = { createNativeBrowserToolService, createConnection, normalizeTabPayload };
