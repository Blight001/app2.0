const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createBrowserAutomationExternalGateway } = require('./browser-automation-external-gateway');
const {
  normalizeBrowserToolOutcome,
  normalizeCardCacheState,
} = require('./browser-automation-normalizers');

const DEFAULT_PORT = 18765;
const CONNECTION_TTL_MS = 3000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const APP_BROWSER_TOKEN_HEADER = 'x-ai-free-browser-token';
const APP_BROWSER_PID_HEADER = 'x-ai-free-browser-pid';
const CARD_CACHE_SCHEMA_VERSION = 1;
const CARD_CACHE_FILE_NAME = 'automation-cards.json';

function createBrowserToolError(message, details = {}) {
  /** @type {Error & {errorCode?: string, phase?: string, tool?: string, timeoutMs?: number}} */
  const error = new Error(String(message || '浏览器工具执行失败'));
  error.errorCode = String(details.errorCode || 'BROWSER_TOOL_FAILED');
  error.phase = String(details.phase || 'bridge');
  error.tool = String(details.tool || '');
  error.timeoutMs = Number(details.timeoutMs || 0) || 0;
  return error;
}

function createCardCacheStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || path.join(process.cwd(), 'extensions', 'browser_automation')));
  const filePath = path.join(dataDir, CARD_CACHE_FILE_NAME);

  function read() {
    if (!fs.existsSync(filePath)) {
      return { exists: false, state: { items: [], selectedId: '' } };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
    return { exists: true, state: normalizeCardCacheState(parsed) };
  }

  function write(source = {}) {
    const state = normalizeCardCacheState(source);
    fs.mkdirSync(dataDir, { recursive: true });
    const payload = {
      schemaVersion: CARD_CACHE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      ...state,
    };
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, filePath);
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      } catch (_) {}
    }
    return state;
  }

  return { dataDir, filePath, read, write };
}

function jsonResponse(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token, X-AI-Free-Browser-Token, X-AI-Free-Browser-Pid',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function constantTimeTokenEquals(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return actualBuffer.length > 0
    && actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

class BrowserAutomationBridgeRuntime {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.host = '127.0.0.1';
    this.port = Number(options.port || process.env.AI_FREE_AUTOMATION_BRIDGE_PORT || DEFAULT_PORT);
    this.connections = new Map();
    this.pendingTasks = new Map();
    this.cardCacheStore = createCardCacheStore({ dataDir: options.cardCacheDir });
    this.connectionTtlMs = Math.max(1000, Number(options.connectionTtlMs) || CONNECTION_TTL_MS);
    this.appBrowserToken = String(options.appBrowserToken || crypto.randomBytes(32).toString('hex'));
    this.isAllowedBrowserProcess = typeof options.isAllowedBrowserProcess === 'function'
      ? options.isAllowedBrowserProcess
      : null;
    this.server = null;
    this.externalMcpGateway = createBrowserAutomationExternalGateway({
      descriptorPath: options.externalMcpDescriptorPath,
      dispatch: (...args) => this.dispatch(...args),
      getConnection: (...args) => this.getConnection(...args),
      listConnections: () => this.listConnections(),
      getAccess: options.getExternalMcpAccess,
      logger: this.logger,
    });
  }

  hasValidAppBrowserToken(req) {
    return constantTimeTokenEquals(req.headers[APP_BROWSER_TOKEN_HEADER], this.appBrowserToken);
  }

  isManagedBrowserProcess(browserProcessId) {
    const pid = Number(browserProcessId || 0) || 0;
    if (!pid) return false;
    if (!this.isAllowedBrowserProcess) return true;
    try {
      return this.isAllowedBrowserProcess(pid) === true;
    } catch (_) {
      return false;
    }
  }

  removeConnection(id, reason = '浏览器插件已断开') {
    const connectionId = String(id || '').trim();
    if (!this.connections.delete(connectionId)) return false;
    for (const [taskId, pending] of this.pendingTasks) {
      if (pending.connectionId !== connectionId) continue;
      this.pendingTasks.delete(taskId);
      clearTimeout(pending.timer);
      pending.reject(createBrowserToolError(reason, {
        errorCode: 'BROWSER_CONNECTION_CLOSED',
        phase: 'bridge_connection',
        tool: pending.tool,
      }));
    }
    return true;
  }

  cleanup() {
    const cutoff = Date.now() - this.connectionTtlMs;
    for (const [id, connection] of this.connections) {
      if (connection.lastSeenAt < cutoff) this.removeConnection(id, '浏览器插件心跳已超时');
    }
  }

  publicConnection(connection) {
    return {
      id: connection.id,
      instanceId: connection.instanceId,
      browserProcessId: connection.browserProcessId,
      name: connection.name,
      platform: connection.platform,
      version: connection.version,
      toolCount: connection.tools.length,
      capabilities: connection.tools.map((tool) => String(tool?.name || '')).filter(Boolean),
      connectedAt: connection.connectedAt,
      lastSeenAt: connection.lastSeenAt,
      online: Date.now() - connection.lastSeenAt < this.connectionTtlMs,
    };
  }

  getAuthorizedConnection(req, url) {
    const id = String(url.searchParams.get('connection_id') || '').trim();
    const token = String(req.headers['x-bridge-token'] || url.searchParams.get('token') || '').trim();
    const connection = this.connections.get(id);
    if (!connection || !token || token !== connection.token) return null;
    if (Number(req.headers[APP_BROWSER_PID_HEADER] || 0) !== connection.browserProcessId) return null;
    connection.lastSeenAt = Date.now();
    return connection;
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://${this.host}:${this.port}`);
    if (await this.externalMcpGateway.handle(req, res, url)) return;
    const origin = String(req.headers.origin || '').trim();
    if (origin && !origin.startsWith('chrome-extension://')) {
      jsonResponse(res, 403, { ok: false, message: '仅允许浏览器扩展连接本机桥接' });
      return;
    }
    if (req.method === 'OPTIONS') {
      jsonResponse(res, 204, {});
      return;
    }
    if (!this.hasValidAppBrowserToken(req)) {
      jsonResponse(res, 403, { ok: false, message: '当前插件不属于 AI-FREE 受信浏览器环境' });
      return;
    }
    await this.handleManagedRequest(req, res, url);
  }

  async handleManagedRequest(req, res, url) {
    const browserProcessId = Number(req.headers[APP_BROWSER_PID_HEADER] || 0) || 0;
    if (!this.isManagedBrowserProcess(browserProcessId)) {
      jsonResponse(res, 403, { ok: false, message: '请求并非来自 AI-FREE 当前托管的内置浏览器' });
      return;
    }
    try {
      const handled = await this.handlePublicRoute(req, res, url, browserProcessId);
      if (handled) return;
      await this.handleConnectionRoute(req, res, url);
    } catch (error) {
      if (url.pathname === '/v1/card-cache') {
        this.logger.warn?.('[AutomationBridge] 软件卡片库请求失败:', error?.message || error);
      }
      jsonResponse(res, 400, { ok: false, message: error?.message || String(error) });
    }
  }

  async handlePublicRoute(req, res, url, browserProcessId) {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /health') {
      this.cleanup();
      jsonResponse(res, 200, {
        ok: true,
        service: 'ai-free-browser-automation-bridge',
        connections: this.connections.size,
      });
      return true;
    }
    if (route === 'POST /v1/register') {
      await this.register(req, res, browserProcessId);
      return true;
    }
    if (route === 'GET /v1/card-cache') {
      jsonResponse(res, 200, { ok: true, ...this.cardCacheStore.read() });
      return true;
    }
    if (route === 'PUT /v1/card-cache') {
      await this.saveCardCache(req, res);
      return true;
    }
    return false;
  }

  async register(req, res, requestBrowserProcessId) {
    const data = await readJson(req);
    const identifiers = {
      instanceId: String(data.instanceId || data.id || '').trim(),
      sessionId: String(data.sessionId || '').trim(),
      browserProcessId: Number(data.browserProcessId || 0) || 0,
    };
    if (!this.isValidRegistrationProcess(identifiers.browserProcessId, requestBrowserProcessId)) {
      this.rejectRegistration(res, identifiers.browserProcessId);
      return;
    }
    const existing = this.findRegisteredSession(identifiers);
    if (existing) {
      this.updateRegisteredSession(existing, data, identifiers.browserProcessId);
      this.sendRegistrationResponse(res, existing);
      return;
    }
    this.removeRefreshedSessions(identifiers.instanceId);
    const connection = this.createConnection(data, identifiers);
    this.connections.set(connection.id, connection);
    this.cleanup();
    this.logger.log?.(`[AutomationBridge] 浏览器插件已连接: ${connection.name} (${connection.id})`);
    this.sendRegistrationResponse(res, connection);
  }

  isValidRegistrationProcess(browserProcessId, requestBrowserProcessId) {
    return browserProcessId === requestBrowserProcessId
      && this.isManagedBrowserProcess(browserProcessId);
  }

  rejectRegistration(res, browserProcessId) {
    this.logger.warn?.(`[AutomationBridge] 已拒绝非受管浏览器进程连接: PID ${browserProcessId || 'unknown'}`);
    jsonResponse(res, 403, { ok: false, message: '仅允许 AI-FREE 当前托管的内置浏览器连接 MCP' });
  }

  findRegisteredSession({ instanceId, sessionId }) {
    if (!instanceId || !sessionId) return null;
    return Array.from(this.connections.values()).find((connection) => (
      connection.instanceId === instanceId && connection.sessionId === sessionId
    )) || null;
  }

  updateRegisteredSession(connection, data, browserProcessId) {
    connection.name = String(data.name || connection.name || 'AI自动化浏览器').trim();
    connection.browserProcessId = browserProcessId;
    connection.platform = String(data.platform || connection.platform || 'browser-extension').trim();
    connection.version = String(data.version || connection.version || '').trim();
    connection.tools = Array.isArray(data.toolDefs) ? data.toolDefs : connection.tools;
    connection.lastSeenAt = Date.now();
  }

  removeRefreshedSessions(instanceId) {
    if (!instanceId) return;
    for (const [existingId, existing] of this.connections) {
      if (existing.instanceId === instanceId) {
        this.removeConnection(existingId, '浏览器插件已刷新并建立新连接');
      }
    }
  }

  createConnection(data, identifiers) {
    const id = crypto.randomUUID();
    const now = Date.now();
    return {
      id,
      token: crypto.randomBytes(32).toString('hex'),
      instanceId: identifiers.instanceId || id,
      sessionId: identifiers.sessionId,
      browserProcessId: identifiers.browserProcessId,
      name: String(data.name || 'AI自动化浏览器').trim(),
      platform: String(data.platform || 'browser-extension').trim(),
      version: String(data.version || '').trim(),
      tools: Array.isArray(data.toolDefs) ? data.toolDefs : [],
      queue: [],
      connectedAt: now,
      lastSeenAt: now,
    };
  }

  sendRegistrationResponse(res, connection) {
    jsonResponse(res, 200, {
      ok: true,
      connectionId: connection.id,
      token: connection.token,
      pollIntervalMs: 650,
    });
  }

  async saveCardCache(req, res) {
    const data = await readJson(req);
    const state = this.cardCacheStore.write(data?.state || data);
    this.logger.log?.(`[AutomationBridge] 软件卡片库已保存: ${state.items.length} 张 (${this.cardCacheStore.filePath})`);
    jsonResponse(res, 200, { ok: true, exists: true, state });
  }

  async handleConnectionRoute(req, res, url) {
    const connection = this.getAuthorizedConnection(req, url);
    if (!connection) {
      jsonResponse(res, 401, { ok: false, message: '浏览器插件连接已失效，请重新连接' });
      return;
    }
    const route = `${req.method} ${url.pathname}`;
    if (!await this.routeConnectedRequest(route, req, res, connection)) {
      jsonResponse(res, 404, { ok: false, message: '接口不存在' });
    }
  }

  async routeConnectedRequest(route, req, res, connection) {
    if (route === 'POST /v1/heartbeat' || route === 'POST /v1/task-progress') {
      jsonResponse(res, 200, { ok: true });
      return true;
    }
    if (route === 'POST /v1/disconnect') {
      this.removeConnection(connection.id, '浏览器插件已主动断开');
      jsonResponse(res, 200, { ok: true });
      return true;
    }
    if (route === 'GET /v1/tasks') {
      jsonResponse(res, 200, { ok: true, tasks: connection.queue.splice(0, 4) });
      return true;
    }
    if (route === 'POST /v1/task-result') {
      await this.receiveTaskResult(req, res, connection);
      return true;
    }
    return false;
  }

  async receiveTaskResult(req, res, connection) {
    const data = await readJson(req);
    const taskId = String(data.taskId || '').trim();
    const pending = this.pendingTasks.get(taskId);
    if (pending && pending.connectionId === connection.id) {
      this.pendingTasks.delete(taskId);
      clearTimeout(pending.timer);
      pending.resolve(normalizeBrowserToolOutcome(data));
    }
    jsonResponse(res, 200, { ok: true });
  }

  async start() {
    if (this.server) return { host: this.host, port: this.port };
    this.server = http.createServer((req, res) => { void this.handle(req, res); });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve(undefined);
      });
    });
    this.publishExternalMcp();
    this.logger.log?.(`[AutomationBridge] 本机浏览器插件桥接已启动: http://${this.host}:${this.port}`);
    return { host: this.host, port: this.port };
  }

  publishExternalMcp() {
    try {
      this.externalMcpGateway.refreshPublication({ host: this.host, port: this.port });
    } catch (error) {
      this.logger.warn?.('[ExternalMCP] 无法发布 Codex 桥接描述文件:', error?.message || error);
    }
  }

  listConnections() {
    this.cleanup();
    return Array.from(this.connections.values()).map((connection) => this.publicConnection(connection));
  }

  getConnection(id) {
    this.cleanup();
    const connection = this.connections.get(String(id || '').trim());
    return connection ? { ...this.publicConnection(connection), tools: connection.tools } : null;
  }

  getCardCacheState() {
    return this.cardCacheStore.read();
  }

  setCardCacheState(state = {}) {
    return this.cardCacheStore.write(state);
  }

  selectCard(cardId) {
    const id = String(cardId || '').trim();
    if (!id) throw new Error('缺少要选择的自动化卡片 ID');
    const cached = this.cardCacheStore.read();
    const item = cached.state.items.find((entry) => String(entry?.id || '').trim() === id);
    if (!item) throw new Error(`自动化卡片不存在或已被删除: ${id}`);
    const state = this.cardCacheStore.write({ ...cached.state, selectedId: id });
    return { state, item };
  }

  dispatch(connectionId, tool, args = {}, options = {}) {
    this.cleanup();
    const connection = this.connections.get(String(connectionId || '').trim());
    if (!connection) return Promise.reject(createBrowserToolError('所选浏览器插件已离线，请刷新连接列表', {
      errorCode: 'BROWSER_CONNECTION_NOT_FOUND',
      phase: 'bridge_dispatch',
      tool,
    }));
    const taskId = crypto.randomUUID();
    const timeoutMs = Math.max(1000, Math.min(30 * 60 * 1000, Number(options.timeoutMs) || 180000));
    connection.queue.push({ taskId, tool: String(tool || ''), args: args && typeof args === 'object' ? args : {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        reject(createBrowserToolError(`浏览器工具 ${tool} 在 ${timeoutMs}ms 内未返回结果`, {
          errorCode: 'BROWSER_TOOL_TIMEOUT',
          phase: 'bridge_wait_result',
          tool,
          timeoutMs,
        }));
      }, timeoutMs);
      this.pendingTasks.set(taskId, {
        connectionId: connection.id,
        tool: String(tool || ''),
        resolve,
        reject,
        timer,
      });
    });
  }

  async stop() {
    this.externalMcpGateway.unpublish();
    for (const pending of this.pendingTasks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('软件正在退出，浏览器工具任务已取消'));
    }
    this.pendingTasks.clear();
    this.connections.clear();
    if (!this.server) return;
    const current = this.server;
    this.server = null;
    await new Promise((resolve) => current.close(() => resolve(undefined)));
  }

  refreshExternalMcpAccess() {
    if (!this.server) return false;
    return this.externalMcpGateway.refreshPublication({ host: this.host, port: this.port });
  }

  configureExternalMcp(context = {}) {
    this.externalMcpGateway.configure(context);
    return this.refreshExternalMcpAccess();
  }
}

function createBrowserAutomationBridge(options = {}) {
  const runtime = new BrowserAutomationBridgeRuntime(options);
  return {
    configureExternalMcp: (context) => runtime.configureExternalMcp(context),
    dispatch: (...args) => runtime.dispatch(...args),
    getConnection: (...args) => runtime.getConnection(...args),
    getCardCacheState: () => runtime.getCardCacheState(),
    listConnections: () => runtime.listConnections(),
    selectCard: (...args) => runtime.selectCard(...args),
    setCardCacheState: (...args) => runtime.setCardCacheState(...args),
    getAppBrowserToken: () => runtime.appBrowserToken,
    refreshExternalMcpAccess: () => runtime.refreshExternalMcpAccess(),
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    host: runtime.host,
    port: runtime.port,
    cardCacheFilePath: runtime.cardCacheStore.filePath,
  };
}

module.exports = {
  APP_BROWSER_PID_HEADER,
  APP_BROWSER_TOKEN_HEADER,
  CARD_CACHE_FILE_NAME,
  CONNECTION_TTL_MS,
  DEFAULT_PORT,
  createBrowserAutomationBridge,
  createCardCacheStore,
  constantTimeTokenEquals,
  normalizeCardCacheState,
  normalizeBrowserToolOutcome,
};
