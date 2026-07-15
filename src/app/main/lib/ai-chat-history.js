/**
 * AI 对话历史本地存储（按登录账号隔离）
 */
const crypto = require('crypto');
const path = require('path');
const { app } = require('electron');
const { readJsonFileSafe, writeJsonFileSafe } = require('../utils/json-store');

const MAX_SESSIONS = 80;
const MAX_MESSAGES = 40;

function accountScope(credentials = {}) {
  const key = String(credentials.key || credentials.credential || '').trim();
  const username = String(credentials.username || '').trim();
  const deviceId = String(credentials.deviceId || credentials.device_id || '').trim();
  const seed = [key, username, deviceId].filter(Boolean).join('|') || 'anonymous';
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20);
}

function historyFilePath(scope) {
  let base = '';
  try {
    base = app?.getPath ? app.getPath('userData') : '';
  } catch (_) {
    base = '';
  }
  if (!base) base = path.join(__dirname, '../../../../');
  return path.join(base, 'ai-chat-history', `${scope || 'anonymous'}.json`);
}

function emptyStore() {
  return { version: 1, sessions: [], currentId: '' };
}

function readStore(scope) {
  const data = readJsonFileSafe(historyFilePath(scope), {
    fallback: emptyStore(),
    logPrefix: 'AIHistory',
  });
  if (!data || typeof data !== 'object') return emptyStore();
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return {
    version: 1,
    sessions,
    currentId: String(data.currentId || ''),
  };
}

function writeStore(scope, store) {
  return writeJsonFileSafe(historyFilePath(scope), store, {
    logPrefix: 'AIHistory',
  });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const messages = [];
  for (const item of raw.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') continue;
    const role = String(item.role || '').trim().toLowerCase();
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue;
    const message = {
      role,
      content: typeof item.content === 'string' ? item.content : String(item.content || ''),
    };
    if (role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls.length) {
      message.tool_calls = item.tool_calls;
    }
    if (role === 'assistant' && typeof item.reasoning === 'string') {
      message.reasoning = item.reasoning.slice(0, 50000);
    }
    if (role === 'assistant' && Array.isArray(item.tool_events)) {
      const compact = (value) => {
        let text = '';
        try { text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); } catch (_) { text = String(value ?? ''); }
        if (typeof text !== 'string') text = String(value ?? '');
        return text.length > 12000 ? `${text.slice(0, 12000)}\n…` : text;
      };
      message.tool_events = item.tool_events.slice(0, 32).map((entry) => ({
        id: String(entry?.id || ''),
        name: String(entry?.name || 'MCP 工具'),
        status: String(entry?.status || 'success'),
        arguments: compact(entry?.arguments),
        result: compact(entry?.result),
      }));
    }
    if (role === 'assistant' && Array.isArray(item.trace_events)) {
      const compact = (value) => {
        let text = '';
        try { text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); } catch (_) { text = String(value ?? ''); }
        if (typeof text !== 'string') text = String(value ?? '');
        return text.length > 12000 ? `${text.slice(0, 12000)}\n…` : text;
      };
      message.trace_events = item.trace_events.slice(0, 64).map((entry, index) => {
        const type = ['reasoning', 'tool', 'step'].includes(entry?.type) ? entry.type : 'step';
        if (type === 'tool') {
          return {
            type,
            round: Number(entry?.round) || 0,
            tool: {
              id: String(entry?.tool?.id || `tool-${index}`),
              name: String(entry?.tool?.name || 'MCP 工具'),
              status: String(entry?.tool?.status || 'success'),
              arguments: compact(entry?.tool?.arguments),
              result: compact(entry?.tool?.result),
            },
          };
        }
        return {
          type,
          round: Number(entry?.round) || 0,
          content: String(entry?.content || '').slice(0, 50000),
        };
      });
    }
    if (role === 'tool') {
      message.tool_call_id = String(item.tool_call_id || '');
      if (item.name) message.name = String(item.name);
    }
    messages.push(message);
  }
  return messages;
}

function previewFromMessages(messages) {
  const firstUser = (messages || []).find((m) => m.role === 'user' && String(m.content || '').trim());
  if (!firstUser) return '';
  return String(firstUser.content).replace(/\s+/g, ' ').trim().slice(0, 80);
}

function normalizeSession(raw = {}) {
  const id = String(raw.id || '').trim() || crypto.randomUUID();
  const messages = sanitizeMessages(raw.messages);
  const title = String(raw.title || '').trim() || '新对话';
  const now = Date.now();
  return {
    id,
    title: title.slice(0, 40),
    titleGenerated: raw.titleGenerated === true,
    modelId: String(raw.modelId || '').trim(),
    browserConnectionId: String(raw.browserConnectionId || '').trim(),
    messages,
    preview: String(raw.preview || previewFromMessages(messages) || '').slice(0, 80),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
  };
}

function sessionSummary(session) {
  return {
    id: session.id,
    title: session.title,
    titleGenerated: session.titleGenerated === true,
    modelId: session.modelId || '',
    browserConnectionId: session.browserConnectionId || '',
    preview: session.preview || '',
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function listSessions(credentials) {
  const scope = accountScope(credentials);
  const store = readStore(scope);
  const sessions = store.sessions
    .map((item) => normalizeSession(item))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(sessionSummary);
  return {
    ok: true,
    sessions,
    currentId: store.currentId || (sessions[0]?.id || ''),
  };
}

function getSession(credentials, sessionId) {
  const scope = accountScope(credentials);
  const store = readStore(scope);
  const id = String(sessionId || '').trim();
  const found = store.sessions.find((item) => String(item.id) === id);
  if (!found) return { ok: false, message: '对话不存在' };
  const session = normalizeSession(found);
  store.currentId = session.id;
  writeStore(scope, store);
  return { ok: true, session };
}

function saveSession(credentials, rawSession, options = {}) {
  const scope = accountScope(credentials);
  const store = readStore(scope);
  const session = normalizeSession(rawSession);
  session.preview = previewFromMessages(session.messages) || session.preview || '';
  session.updatedAt = Date.now();

  // 无消息的空会话不落盘；已有会话被删空时，同时移除旧记录。
  if (!session.messages.length && options.allowEmpty !== true) {
    const existingIndex = store.sessions.findIndex((item) => String(item.id) === session.id);
    if (existingIndex < 0) {
      return { ok: true, session, summary: sessionSummary(session), skipped: true };
    }
    store.sessions.splice(existingIndex, 1);
    if (store.currentId === session.id) store.currentId = store.sessions[0]?.id || '';
    const written = writeStore(scope, store);
    if (!written) {
      return { ok: false, message: '对话历史写入本地失败', session, summary: sessionSummary(session) };
    }
    return {
      ok: true,
      session,
      summary: sessionSummary(session),
      removed: true,
      currentId: store.currentId,
    };
  }

  const index = store.sessions.findIndex((item) => String(item.id) === session.id);
  if (index >= 0) store.sessions[index] = session;
  else store.sessions.unshift(session);

  store.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // 清理无消息的脏数据
  store.sessions = store.sessions.filter((item) => {
    const msgs = Array.isArray(item.messages) ? item.messages : [];
    return msgs.length > 0 || String(item.id) === session.id;
  });
  if (store.sessions.length > MAX_SESSIONS) {
    store.sessions = store.sessions.slice(0, MAX_SESSIONS);
  }
  if (options.setCurrent !== false) store.currentId = session.id;
  const written = writeStore(scope, store);
  if (!written) {
    return { ok: false, message: '对话历史写入本地失败', session, summary: sessionSummary(session) };
  }
  return { ok: true, session, summary: sessionSummary(session) };
}

function deleteSession(credentials, sessionId) {
  const scope = accountScope(credentials);
  const store = readStore(scope);
  const id = String(sessionId || '').trim();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((item) => String(item.id) !== id);
  if (store.sessions.length === before) {
    return { ok: false, message: '对话不存在' };
  }
  if (store.currentId === id) {
    store.currentId = store.sessions[0]?.id || '';
  }
  const written = writeStore(scope, store);
  if (!written) {
    return { ok: false, message: '对话历史写入本地失败' };
  }
  return {
    ok: true,
    currentId: store.currentId,
    sessions: store.sessions
      .map((item) => normalizeSession(item))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(sessionSummary),
  };
}

function renameSession(credentials, sessionId, rawTitle) {
  const scope = accountScope(credentials);
  const store = readStore(scope);
  const id = String(sessionId || '').trim();
  const title = String(rawTitle || '').trim().slice(0, 40);
  if (!title) return { ok: false, message: '对话名称不能为空' };
  const index = store.sessions.findIndex((item) => String(item.id) === id);
  if (index < 0) return { ok: false, message: '对话不存在' };

  const session = normalizeSession(store.sessions[index]);
  session.title = title;
  // 手动命名后不再让自动标题生成覆盖用户输入。
  session.titleGenerated = true;
  store.sessions[index] = session;
  const written = writeStore(scope, store);
  if (!written) return { ok: false, message: '对话历史写入本地失败' };
  return { ok: true, session, summary: sessionSummary(session) };
}

function createSession(credentials, partial = {}) {
  // 空会话只返回内存对象，真正有消息后再 saveSession 落盘
  const session = normalizeSession({
    id: crypto.randomUUID(),
    title: '新对话',
    titleGenerated: false,
    modelId: partial.modelId || '',
    browserConnectionId: partial.browserConnectionId || '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const scope = accountScope(credentials);
  const store = readStore(scope);
  store.currentId = session.id;
  writeStore(scope, store);
  return { ok: true, session, summary: sessionSummary(session) };
}

function setCurrent(credentials, sessionId) {
  const scope = accountScope(credentials);
  const store = readStore(scope);
  const id = String(sessionId || '').trim();
  if (id && !store.sessions.some((item) => String(item.id) === id)) {
    return { ok: false, message: '对话不存在' };
  }
  store.currentId = id;
  writeStore(scope, store);
  return { ok: true, currentId: id };
}

function provisionalTitleFromText(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '新对话';
  return cleaned.slice(0, 20) + (cleaned.length > 20 ? '…' : '');
}

module.exports = {
  MAX_SESSIONS,
  MAX_MESSAGES,
  listSessions,
  getSession,
  saveSession,
  deleteSession,
  renameSession,
  createSession,
  setCurrent,
  normalizeSession,
  provisionalTitleFromText,
};
