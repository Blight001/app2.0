'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createBrowserAutomationExternalGateway } = require('./browser-automation-external-gateway');
const { APP_BROWSER_PID_HEADER, jsonResponse, readJson } = require('./browser-automation-http');
const { normalizeCardCacheState } = require('./browser-automation-normalizers');

const DEFAULT_PORT = 18765;
const BRIDGE_PROTOCOL_VERSION = 1;
const CONNECTION_TTL_MS = 45000;
const CARD_CACHE_SCHEMA_VERSION = 1;
const CARD_CACHE_FILE_NAME = 'automation-cards.json';

function createCardCacheStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || path.join(process.cwd(), 'automation')));
  const filePath = path.join(dataDir, CARD_CACHE_FILE_NAME);

  function read() {
    if (!fs.existsSync(filePath)) return { exists: false, state: { items: [], selectedId: '' } };
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

class BrowserAutomationBridgeRuntime {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.host = '127.0.0.1';
    this.port = Number(options.port || process.env.AI_FREE_AUTOMATION_BRIDGE_PORT || DEFAULT_PORT);
    this.cardCacheStore = createCardCacheStore({ dataDir: options.cardCacheDir });
    this.nativeBrowserService = options.createNativeBrowserService?.({
      cardStore: this.cardCacheStore,
    }) || null;
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

  async handle(req, res) {
    const url = new URL(req.url, `http://${this.host}:${this.port}`);
    if (await this.externalMcpGateway.handle(req, res, url)) return;
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return jsonResponse(res, 200, {
          ok: true,
          service: 'ai-free-native-browser-automation',
          connections: this.listConnections().length,
        });
      }
      if (req.method === 'GET' && url.pathname === '/v1/card-cache') {
        return jsonResponse(res, 200, { ok: true, ...this.cardCacheStore.read() });
      }
      if (req.method === 'PUT' && url.pathname === '/v1/card-cache') {
        const data = await readJson(req);
        const state = this.cardCacheStore.write(data?.state || data);
        return jsonResponse(res, 200, { ok: true, exists: true, state });
      }
      jsonResponse(res, 404, { ok: false, message: '接口不存在' });
    } catch (error) {
      jsonResponse(res, 400, { ok: false, message: error?.message || String(error) });
    }
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
    this.logger.log?.(`[AutomationBridge] 软件原生浏览器自动化已启动: http://${this.host}:${this.port}`);
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
    return this.nativeBrowserService?.listConnections?.() || [];
  }

  getConnection(id) {
    return this.nativeBrowserService?.getConnection?.(id) || null;
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
    if (!this.nativeBrowserService?.getConnection?.(connectionId)) {
      return Promise.reject(new Error('所选 AI-FREE 浏览器已经关闭'));
    }
    return this.nativeBrowserService.dispatch(connectionId, tool, args, options);
  }

  async stop() {
    this.externalMcpGateway.unpublish();
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

  listExternalMcpTools() {
    return this.externalMcpGateway.listTools();
  }

  callExternalMcpTool(name, args = {}) {
    return this.externalMcpGateway.callTool(name, args);
  }
}

function createBrowserAutomationBridge(options = {}) {
  const runtime = new BrowserAutomationBridgeRuntime(options);
  return {
    configureExternalMcp: (context) => runtime.configureExternalMcp(context),
    callExternalMcpTool: (...args) => runtime.callExternalMcpTool(...args),
    dispatch: (...args) => runtime.dispatch(...args),
    getConnection: (...args) => runtime.getConnection(...args),
    getCardCacheState: () => runtime.getCardCacheState(),
    listConnections: () => runtime.listConnections(),
    listExternalMcpTools: () => runtime.listExternalMcpTools(),
    selectCard: (...args) => runtime.selectCard(...args),
    setCardCacheState: (...args) => runtime.setCardCacheState(...args),
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
  BRIDGE_PROTOCOL_VERSION,
  CARD_CACHE_FILE_NAME,
  CONNECTION_TTL_MS,
  DEFAULT_PORT,
  createBrowserAutomationBridge,
  createCardCacheStore,
  normalizeCardCacheState,
};
