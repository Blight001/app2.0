const crypto = require('crypto');
const http = require('http');

const DEFAULT_PORT = 18765;
const CONNECTION_TTL_MS = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function jsonResponse(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  let server = null;

  function cleanup() {
    const cutoff = Date.now() - CONNECTION_TTL_MS;
    for (const [id, connection] of connections) {
      if (connection.lastSeenAt < cutoff) connections.delete(id);
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
      online: Date.now() - connection.lastSeenAt < CONNECTION_TTL_MS,
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

      const connection = getAuthorizedConnection(req, url);
      if (!connection) return jsonResponse(res, 401, { ok: false, message: '浏览器插件连接已失效，请重新连接' });

      if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
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
          if (data.error || data.success === false) pending.reject(new Error(String(data.error || '浏览器工具执行失败')));
          else pending.resolve(data.result);
        }
        return jsonResponse(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/v1/task-progress') {
        return jsonResponse(res, 200, { ok: true });
      }

      return jsonResponse(res, 404, { ok: false, message: '接口不存在' });
    } catch (error) {
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

  function dispatch(connectionId, tool, args = {}, options = {}) {
    cleanup();
    const connection = connections.get(String(connectionId || '').trim());
    if (!connection) return Promise.reject(new Error('所选浏览器插件已离线，请刷新连接列表'));
    const taskId = crypto.randomUUID();
    const timeoutMs = Math.max(1000, Math.min(30 * 60 * 1000, Number(options.timeoutMs) || 180000));
    connection.queue.push({ taskId, tool: String(tool || ''), args: args && typeof args === 'object' ? args : {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingTasks.delete(taskId);
        reject(new Error(`浏览器工具 ${tool} 执行超时`));
      }, timeoutMs);
      pendingTasks.set(taskId, { connectionId: connection.id, resolve, reject, timer });
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

  return { dispatch, getConnection, listConnections, start, stop, host, port };
}

module.exports = { CONNECTION_TTL_MS, DEFAULT_PORT, createBrowserAutomationBridge };
