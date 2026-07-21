'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXTERNAL_MCP_PREFIX = '/mcp/v1/';
const EXTERNAL_MCP_TOKEN_HEADER = 'x-ai-free-mcp-token';
const MAX_BODY_BYTES = 1024 * 1024;

function constantTimeEquals(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function jsonResponse(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
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

function normalizeSchema(tool = {}) {
  const source = tool.input_schema || tool.inputSchema || { type: 'object', properties: {} };
  return {
    ...source,
    type: 'object',
    properties: { ...(source.properties || {}) },
    required: Array.isArray(source.required) ? [...source.required] : [],
  };
}

function addBrowserRouting(tool = {}, requireBrowserId = false) {
  const inputSchema = normalizeSchema(tool);
  inputSchema.properties.browser_id = inputSchema.properties.browser_id || {
    type: 'string',
    description: 'AI-FREE 浏览器窗口的 MCP 连接 ID；存在多个窗口时必填，来自 ai_free_list_tools/connections。',
  };
  inputSchema.properties.browser_name = inputSchema.properties.browser_name || {
    type: 'string',
    description: '窗口名称；未提供 browser_id 时可按名称精确匹配。',
  };
  if (requireBrowserId && !inputSchema.required.includes('browser_id')) {
    inputSchema.required.push('browser_id');
  }
  return {
    name: String(tool.name || '').trim(),
    description: String(tool.description || '').trim(),
    inputSchema,
    destructive: tool.destructive === true,
    scope: 'browser-window',
  };
}

function normalizeSoftwareTool(tool = {}) {
  return {
    name: String(tool.name || '').trim(),
    description: String(tool.description || '').trim(),
    inputSchema: normalizeSchema(tool),
    destructive: tool.destructive === true,
    scope: 'software',
  };
}

function sanitizeCookieTool(tool) {
  if (tool.name !== 'save_cookies') return tool;
  const properties = { ...(tool.inputSchema.properties || {}) };
  delete properties.save_to_server;
  delete properties.server_url;
  delete properties.card_key;
  return { ...tool, inputSchema: { ...tool.inputSchema, properties } };
}

function publicConnection(connection = {}) {
  return {
    id: String(connection.id || ''),
    name: String(connection.browserName || connection.name || 'AI-FREE 浏览器窗口'),
    profileId: String(connection.profileId || ''),
    platform: String(connection.platform || ''),
    version: String(connection.version || ''),
    online: connection.online === true,
    capabilities: Array.isArray(connection.capabilities) ? [...connection.capabilities] : [],
  };
}

function resolveDispatchTimeout(toolName, args) {
  const requestedSeconds = Number(args.timeout_seconds || 0);
  if (requestedSeconds > 0) return Math.min(1800, Math.max(1, requestedSeconds)) * 1000;
  const isCardRun = toolName === 'manage_card' && String(args.action || '').trim().toLowerCase() === 'run';
  return isCardRun ? 900000 : 180000;
}

function sanitizeDispatchArgs(source = {}) {
  const args = { ...source };
  for (const key of [
    'browser_id', 'browser_name', 'browser', 'save_to_server', 'saveToServer',
    'server_url', 'serverUrl',
  ]) delete args[key];
  return args;
}

class BrowserAutomationExternalGateway {
  constructor(options = {}) {
    this.options = options;
    this.logger = options.logger || console;
    this.descriptorPath = path.resolve(String(options.descriptorPath || ''));
    this.token = String(options.token || crypto.randomBytes(32).toString('hex'));
    this.getConnections = typeof options.getConnections === 'function' ? options.getConnections : options.listConnections;
    this.getWindowTools = typeof options.getWindowTools === 'function' ? options.getWindowTools : () => null;
    this.getAccess = typeof options.getAccess === 'function'
      ? options.getAccess
      : (typeof options.hasAccess === 'function' ? options.hasAccess : () => false);
    this.publishedPid = 0;
    this.publishedAccessAllowed = false;
  }

  configure(context = {}) {
    if (typeof context.getConnections === 'function') this.getConnections = context.getConnections;
    if (typeof context.getWindowTools === 'function') this.getWindowTools = context.getWindowTools;
    if (typeof context.getAccess === 'function') this.getAccess = context.getAccess;
  }

  access() {
    try {
      const value = this.getAccess?.();
      const allowed = value === true || value?.isVip === true || value?.allowed === true;
      return { allowed, entitlement: 'vip' };
    } catch (error) {
      this.logger.warn?.('[ExternalMCP] 读取会员权限失败:', error?.message || error);
      return { allowed: false, entitlement: 'vip' };
    }
  }

  assertAccess() {
    if (this.access().allowed) return;
    /** @type {Error & {code?: string}} */
    const error = new Error('外部 MCP 网关仅限已在线验证的 VIP 会员使用');
    error.code = 'AI_FREE_MCP_VIP_REQUIRED';
    throw error;
  }

  connections() {
    try {
      const value = this.getConnections?.();
      return Array.isArray(value) ? value : [];
    } catch (error) {
      this.logger.warn?.('[ExternalMCP] 读取浏览器窗口连接失败:', error?.message || error);
      return [];
    }
  }

  listTools() {
    this.assertAccess();
    const tools = new Map();
    for (const tool of this.getWindowTools?.()?.tools || []) {
      const normalized = normalizeSoftwareTool(tool);
      if (normalized.name) tools.set(normalized.name, normalized);
    }
    const connections = this.connections();
    const requireBrowserId = connections.length > 1;
    for (const connection of connections) this.addConnectionTools(tools, connection, requireBrowserId);
    return { tools: Array.from(tools.values()), connections: connections.map(publicConnection) };
  }

  addConnectionTools(tools, connection, requireBrowserId = false) {
    const full = this.options.getConnection?.(connection.id);
    for (const tool of full?.tools || []) {
      const normalized = sanitizeCookieTool(addBrowserRouting(tool, requireBrowserId));
      if (normalized.name && !tools.has(normalized.name)) tools.set(normalized.name, normalized);
    }
  }

  resolveConnection(args = {}) {
    const items = this.connections();
    const reference = String(args.browser_id || args.browser_name || args.browser || '').trim();
    if (!reference) return this.resolveImplicitConnection(items);
    const exactId = items.find((item) => String(item.id || '') === reference);
    if (exactId) return exactId;
    const lowered = reference.toLocaleLowerCase();
    const matches = items.filter((item) => String(item.browserName || item.name || '').trim().toLocaleLowerCase() === lowered);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`存在多个名为「${reference}」的窗口，请改用 browser_id`);
    throw new Error(`未找到 AI-FREE 浏览器窗口: ${reference}`);
  }

  resolveImplicitConnection(items) {
    if (items.length === 1) return items[0];
    if (!items.length) throw new Error('当前没有已连接内部 MCP 的 AI-FREE 浏览器窗口');
    throw new Error(`当前有 ${items.length} 个浏览器窗口，请通过 browser_id 指定目标窗口`);
  }

  async callTool(name, rawArgs = {}) {
    this.assertAccess();
    const toolName = String(name || '').trim();
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};
    const windowTools = this.getWindowTools?.();
    if (windowTools?.has?.(toolName)) return windowTools.execute(toolName, args);
    const connection = this.resolveConnection(args);
    this.assertBrowserTool(connection, toolName, args);
    return this.options.dispatch(
      connection.id,
      toolName,
      sanitizeDispatchArgs(args),
      { timeoutMs: resolveDispatchTimeout(toolName, args) },
    );
  }

  assertBrowserTool(connection, toolName, args) {
    const full = this.options.getConnection?.(connection.id);
    if (!(full?.tools || []).some((tool) => String(tool?.name || '').trim() === toolName)) {
      throw new Error(`窗口「${publicConnection(connection).name}」不支持 MCP 工具: ${toolName}`);
    }
    if (toolName === 'save_cookies' && (args.save_to_server === true || args.server_url || args.serverUrl)) {
      throw new Error('外部 MCP 不允许回传或上传 Cookie 原始内容；可省略 save_to_server/server_url，仅保存到浏览器本机');
    }
  }

  authorized(req) {
    const authorization = String(req.headers.authorization || '');
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    return constantTimeEquals(req.headers[EXTERNAL_MCP_TOKEN_HEADER] || bearer, this.token);
  }

  async handle(req, res, url) {
    if (!String(url?.pathname || '').startsWith(EXTERNAL_MCP_PREFIX)) return false;
    if (!this.authorized(req)) {
      jsonResponse(res, 401, { ok: false, error: 'AI_FREE_MCP_UNAUTHORIZED', message: '外部 MCP 会话令牌无效' });
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/mcp/v1/status') {
      this.respondStatus(res);
      return true;
    }
    if (!this.access().allowed) {
      jsonResponse(res, 403, {
        ok: false,
        error: 'AI_FREE_MCP_VIP_REQUIRED',
        message: '外部 MCP 网关仅限已在线验证的 VIP 会员使用',
      });
      return true;
    }
    try {
      await this.handleAuthorized(req, res, url);
    } catch (error) {
      jsonResponse(res, 400, {
        ok: false,
        error: String(error?.errorCode || error?.code || 'AI_FREE_MCP_CALL_FAILED'),
        message: error?.message || String(error),
      });
    }
    return true;
  }

  async handleAuthorized(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /mcp/v1/tools') return jsonResponse(res, 200, { ok: true, ...this.listTools() });
    if (route === 'POST /mcp/v1/call') return this.respondCall(req, res);
    return jsonResponse(res, 404, { ok: false, error: 'AI_FREE_MCP_NOT_FOUND', message: '外部 MCP 接口不存在' });
  }

  respondStatus(res) {
    const access = this.access();
    const listed = access.allowed ? this.listTools() : { tools: [], connections: [] };
    jsonResponse(res, 200, {
      ok: true,
      service: 'ai-free-external-mcp-gateway',
      pid: process.pid,
      ready: access.allowed && Boolean(this.getWindowTools?.()),
      membershipRequired: !access.allowed,
      entitlement: access.entitlement,
      message: access.allowed ? '外部 MCP 网关已就绪' : '外部 MCP 网关仅限已在线验证的 VIP 会员使用',
      toolCount: listed.tools.length,
      connectionCount: listed.connections.length,
    });
  }

  async respondCall(req, res) {
    const body = await readJson(req);
    const result = await this.callTool(body.name, body.arguments || body.args || {});
    jsonResponse(res, 200, { ok: true, result });
  }

  publish({ host, port }) {
    if (!this.descriptorPath) return false;
    const accessAllowed = this.access().allowed;
    if (!this.publishedPid || accessAllowed !== this.publishedAccessAllowed) {
      this.token = crypto.randomBytes(32).toString('hex');
    }
    fs.mkdirSync(path.dirname(this.descriptorPath), { recursive: true });
    const payload = this.createDescriptor(host, port);
    const temporary = `${this.descriptorPath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.descriptorPath);
    try { fs.chmodSync(this.descriptorPath, 0o600); } catch (_) {}
    this.publishedPid = process.pid;
    this.publishedAccessAllowed = accessAllowed;
    this.logger.log?.(`[ExternalMCP] Codex 桥接已就绪: http://${host}:${port}/mcp/v1`);
    return true;
  }

  createDescriptor(host, port) {
    return {
      schemaVersion: 1,
      service: 'ai-free-external-mcp-gateway',
      entitlement: 'vip',
      membershipRequired: !this.access().allowed,
      endpoint: `http://${host}:${port}`,
      token: this.token,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    };
  }

  refreshPublication({ host, port }) {
    return this.publish({ host, port });
  }

  unpublish(options = {}) {
    if (!this.descriptorPath || (!this.publishedPid && options.force !== true)) return;
    try {
      const current = JSON.parse(fs.readFileSync(this.descriptorPath, 'utf8'));
      if (options.force === true || Number(current.pid || 0) === this.publishedPid) {
        fs.rmSync(this.descriptorPath, { force: true });
      }
    } catch (_) {}
    this.publishedPid = 0;
    this.publishedAccessAllowed = false;
  }
}

function createBrowserAutomationExternalGateway(options = {}) {
  return new BrowserAutomationExternalGateway(options);
}

module.exports = {
  EXTERNAL_MCP_PREFIX,
  EXTERNAL_MCP_TOKEN_HEADER,
  addBrowserRouting,
  constantTimeEquals,
  createBrowserAutomationExternalGateway,
  normalizeSchema,
  publicConnection,
  sanitizeCookieTool,
};
