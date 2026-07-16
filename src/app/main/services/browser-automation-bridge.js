const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DEFAULT_PORT = 18765;
const CONNECTION_TTL_MS = 3000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CARD_CACHE_SCHEMA_VERSION = 1;
const CARD_CACHE_FILE_NAME = 'automation-cards.json';

function normalizeCardCacheState(source = {}) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const items = Array.isArray(value.items)
    ? value.items.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
  const requestedSelectedId = String(value.selectedId || '').trim();
  const selectedId = items.some((item) => String(item.id || '').trim() === requestedSelectedId)
    ? requestedSelectedId
    : String(items[0]?.id || '').trim();
  return { items, selectedId };
}

function normalizeBrowserToolOutcome(source = {}) {
  const payload = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const rawResult = payload.result;
  const result = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
    ? { ...rawResult }
    : (rawResult === undefined ? {} : { value: rawResult });
  const failed = payload.success === false || Boolean(payload.error)
    || result.success === false || result.ok === false;
  if (!failed) return rawResult;

  // 扩展会把步骤、错误码和失败现场放在 result 中。不能因为外层
  // success=false 就 reject 并丢掉 result，否则 UI 最终只能看到兜底文案。
  const error = String(
    result.error || result.errorReason || result.message || payload.error || '浏览器工具执行失败',
  ).trim() || '浏览器工具执行失败';
  const errorCode = String(
    result.errorCode || result.code || payload.errorCode || 'BROWSER_TOOL_FAILED',
  ).trim() || 'BROWSER_TOOL_FAILED';
  return {
    ...result,
    success: false,
    error,
    errorReason: String(result.errorReason || error),
    errorCode,
  };
}

function createBrowserToolError(message, details = {}) {
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
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

function createBrowserAutomationBridge(options = {}) {
  const logger = options.logger || console;
  const host = '127.0.0.1';
  const port = Number(options.port || process.env.AI_FREE_AUTOMATION_BRIDGE_PORT || DEFAULT_PORT);
  const connections = new Map();
  const pendingTasks = new Map();
  const cardCacheStore = createCardCacheStore({ dataDir: options.cardCacheDir });
  const connectionTtlMs = Math.max(1000, Number(options.connectionTtlMs) || CONNECTION_TTL_MS);
  let server = null;

  function removeConnection(id, reason = '浏览器插件已断开') {
    const connectionId = String(id || '').trim();
    if (!connections.delete(connectionId)) return false;
    for (const [taskId, pending] of pendingTasks) {
      if (pending.connectionId !== connectionId) continue;
      pendingTasks.delete(taskId);
      clearTimeout(pending.timer);
      pending.reject(createBrowserToolError(reason, {
        errorCode: 'BROWSER_CONNECTION_CLOSED',
        phase: 'bridge_connection',
        tool: pending.tool,
      }));
    }
    return true;
  }

  function cleanup() {
    const cutoff = Date.now() - connectionTtlMs;
    for (const [id, connection] of connections) {
      if (connection.lastSeenAt < cutoff) removeConnection(id, '浏览器插件心跳已超时');
    }
  }

  function publicConnection(connection) {
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
      online: Date.now() - connection.lastSeenAt < connectionTtlMs,
    };
  }

  function getAuthorizedConnection(req, url) {
    const id = String(url.searchParams.get('connection_id') || '').trim();
    const token = String(req.headers['x-bridge-token'] || url.searchParams.get('token') || '').trim();
    const connection = connections.get(id);
    if (!connection || !token || token !== connection.token) return null;
    connection.lastSeenAt = Date.now();
    return connection;
  }

  async function handle(req, res) {
    const origin = String(req.headers.origin || '').trim();
    if (origin && !origin.startsWith('chrome-extension://')) {
      return jsonResponse(res, 403, { ok: false, message: '仅允许浏览器扩展连接本机桥接' });
    }
    if (req.method === 'OPTIONS') return jsonResponse(res, 204, {});
    const url = new URL(req.url, `http://${host}:${port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        cleanup();
        return jsonResponse(res, 200, { ok: true, service: 'ai-free-browser-automation-bridge', connections: connections.size });
      }

      if (req.method === 'POST' && url.pathname === '/v1/register') {
        const data = await readJson(req);
        const instanceId = String(data.instanceId || data.id || '').trim();
        const sessionId = String(data.sessionId || '').trim();
        for (const existing of connections.values()) {
          if (instanceId && sessionId && existing.instanceId === instanceId && existing.sessionId === sessionId) {
            existing.name = String(data.name || existing.name || 'AI自动化浏览器').trim();
            existing.browserProcessId = Number(data.browserProcessId || existing.browserProcessId || 0) || 0;
            existing.platform = String(data.platform || existing.platform || 'browser-extension').trim();
            existing.version = String(data.version || existing.version || '').trim();
            existing.tools = Array.isArray(data.toolDefs) ? data.toolDefs : existing.tools;
            existing.lastSeenAt = Date.now();
            return jsonResponse(res, 200, {
              ok: true,
              connectionId: existing.id,
              token: existing.token,
              pollIntervalMs: 650,
            });
          }
        }
        // 扩展刷新会生成新 sessionId，但仍属于同一个浏览器实例。
        // 新连接登记时立即清除旧会话，避免 AI 控制里短时间出现两个目标浏览器。
        for (const [existingId, existing] of connections) {
          if (instanceId && existing.instanceId === instanceId) {
            removeConnection(existingId, '浏览器插件已刷新并建立新连接');
          }
        }
        const id = crypto.randomUUID();
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        const connection = {
          id,
          token,
          instanceId: instanceId || id,
          sessionId,
          browserProcessId: Number(data.browserProcessId || 0) || 0,
          name: String(data.name || 'AI自动化浏览器').trim(),
          platform: String(data.platform || 'browser-extension').trim(),
          version: String(data.version || '').trim(),
          tools: Array.isArray(data.toolDefs) ? data.toolDefs : [],
          queue: [],
          connectedAt: now,
          lastSeenAt: now,
        };
        connections.set(id, connection);
        cleanup();
        logger.log?.(`[AutomationBridge] 浏览器插件已连接: ${connection.name} (${id})`);
        return jsonResponse(res, 200, { ok: true, connectionId: id, token, pollIntervalMs: 650 });
      }

      // 卡片库是软件级持久数据，不应依赖某个浏览器工具连接先完成注册。
      // 入口仍受上方 chrome-extension:// Origin 与 loopback 监听地址约束。
      if (req.method === 'GET' && url.pathname === '/v1/card-cache') {
        const cached = cardCacheStore.read();
        return jsonResponse(res, 200, { ok: true, ...cached });
      }

      if (req.method === 'PUT' && url.pathname === '/v1/card-cache') {
        const data = await readJson(req);
        const state = cardCacheStore.write(data?.state || data);
        logger.log?.(`[AutomationBridge] 软件卡片库已保存: ${state.items.length} 张 (${cardCacheStore.filePath})`);
        return jsonResponse(res, 200, { ok: true, exists: true, state });
      }

      const connection = getAuthorizedConnection(req, url);
      if (!connection) return jsonResponse(res, 401, { ok: false, message: '浏览器插件连接已失效，请重新连接' });

      if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
        return jsonResponse(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/v1/disconnect') {
        removeConnection(connection.id, '浏览器插件已主动断开');
        return jsonResponse(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/v1/tasks') {
        const tasks = connection.queue.splice(0, 4);
        return jsonResponse(res, 200, { ok: true, tasks });
      }

      if (req.method === 'POST' && url.pathname === '/v1/task-result') {
        const data = await readJson(req);
        const taskId = String(data.taskId || '').trim();
        const pending = pendingTasks.get(taskId);
        if (pending && pending.connectionId === connection.id) {
          pendingTasks.delete(taskId);
          clearTimeout(pending.timer);
          pending.resolve(normalizeBrowserToolOutcome(data));
        }
        return jsonResponse(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/v1/task-progress') {
        return jsonResponse(res, 200, { ok: true });
      }

      return jsonResponse(res, 404, { ok: false, message: '接口不存在' });
    } catch (error) {
      if (url.pathname === '/v1/card-cache') {
        logger.warn?.('[AutomationBridge] 软件卡片库请求失败:', error?.message || error);
      }
      return jsonResponse(res, 400, { ok: false, message: error?.message || String(error) });
    }
  }

  async function start() {
    if (server) return { host, port };
    server = http.createServer((req, res) => { void handle(req, res); });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    logger.log?.(`[AutomationBridge] 本机浏览器插件桥接已启动: http://${host}:${port}`);
    return { host, port };
  }

  function listConnections() {
    cleanup();
    return Array.from(connections.values()).map(publicConnection);
  }

  function getConnection(id) {
    cleanup();
    const connection = connections.get(String(id || '').trim());
    return connection ? { ...publicConnection(connection), tools: connection.tools } : null;
  }

  function getCardCacheState() {
    return cardCacheStore.read();
  }

  function setCardCacheState(state = {}) {
    return cardCacheStore.write(state);
  }

  function selectCard(cardId) {
    const id = String(cardId || '').trim();
    if (!id) throw new Error('缺少要选择的自动化卡片 ID');
    const cached = cardCacheStore.read();
    const item = cached.state.items.find((entry) => String(entry?.id || '').trim() === id);
    if (!item) throw new Error(`自动化卡片不存在或已被删除: ${id}`);
    const state = cardCacheStore.write({ ...cached.state, selectedId: id });
    return { state, item };
  }

  function dispatch(connectionId, tool, args = {}, options = {}) {
    cleanup();
    const connection = connections.get(String(connectionId || '').trim());
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
        pendingTasks.delete(taskId);
        reject(createBrowserToolError(`浏览器工具 ${tool} 在 ${timeoutMs}ms 内未返回结果`, {
          errorCode: 'BROWSER_TOOL_TIMEOUT',
          phase: 'bridge_wait_result',
          tool,
          timeoutMs,
        }));
      }, timeoutMs);
      pendingTasks.set(taskId, { connectionId: connection.id, tool: String(tool || ''), resolve, reject, timer });
    });
  }

  async function stop() {
    for (const pending of pendingTasks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('软件正在退出，浏览器工具任务已取消'));
    }
    pendingTasks.clear();
    connections.clear();
    if (!server) return;
    const current = server;
    server = null;
    await new Promise((resolve) => current.close(() => resolve()));
  }

  return {
    dispatch,
    getConnection,
    getCardCacheState,
    listConnections,
    selectCard,
    setCardCacheState,
    start,
    stop,
    host,
    port,
    cardCacheFilePath: cardCacheStore.filePath,
  };
}

module.exports = {
  CARD_CACHE_FILE_NAME,
  CONNECTION_TTL_MS,
  DEFAULT_PORT,
  createBrowserAutomationBridge,
  createCardCacheStore,
  normalizeCardCacheState,
  normalizeBrowserToolOutcome,
};
