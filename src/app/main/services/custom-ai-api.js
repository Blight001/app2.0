const axios = require('axios');
const { normalizeCustomAiApiConfig } = require('../utils/ai-control-settings');

function resolveChatCompletionsUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error('自定义 API 地址无效，请填写完整的 HTTP(S) 地址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('自定义 API 仅支持 HTTP(S) 地址');
  }
  parsed.hash = '';
  parsed.search = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(pathname)) {
    parsed.pathname = pathname;
  } else if (/\/v\d+$/i.test(pathname)) {
    parsed.pathname = `${pathname}/chat/completions`;
  } else {
    parsed.pathname = `${pathname}/v1/chat/completions`.replace(/\/{2,}/g, '/');
  }
  return parsed.toString();
}

function normalizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = String(message?.role || 'user');
    const normalized = { role, content: message?.content ?? '' };
    if (role === 'assistant' && Array.isArray(message?.tool_calls)) {
      normalized.tool_calls = message.tool_calls;
    }
    if (role === 'tool') {
      normalized.tool_call_id = String(message?.tool_call_id || '');
      if (message?.name) normalized.name = String(message.name);
    }
    return normalized;
  });
}

function normalizeResponseContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content.map((part) => {
    if (typeof part === 'string') return part;
    return String(part?.text || part?.content || '');
  }).join('');
}

async function sendCustomAIControlMessage(config, messages, options = {}) {
  const normalized = normalizeCustomAiApiConfig(config);
  if (!normalized.enabled || !normalized.baseUrl || !normalized.model) {
    return { ok: false, message: '自定义 API 尚未配置完整' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (normalized.apiKey) headers.Authorization = `Bearer ${normalized.apiKey}`;
  const payload = {
    model: normalized.model,
    messages: normalizeMessages(messages),
    stream: false,
  };
  if (Array.isArray(options.tools) && options.tools.length) payload.tools = options.tools;

  try {
    const response = await axios.post(resolveChatCompletionsUrl(normalized.baseUrl), payload, {
      headers,
      signal: options.signal,
      timeout: 240000,
      maxContentLength: 20 * 1024 * 1024,
      validateStatus: () => true,
    });
    const data = response?.data && typeof response.data === 'object' ? response.data : {};
    if (response.status < 200 || response.status >= 300) {
      const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
      return { ok: false, message: `自定义 API 请求失败：${detail}` };
    }
    const message = data?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') {
      return { ok: false, message: '自定义 API 返回格式无效：缺少 choices[0].message' };
    }
    return {
      ok: true,
      message: {
        role: 'assistant',
        content: normalizeResponseContent(message.content),
        reasoning: String(message.reasoning_content || message.reasoning || ''),
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      },
      usage: data.usage || null,
      custom_api: true,
    };
  } catch (error) {
    return { ok: false, message: `自定义 API 请求失败：${error?.message || String(error)}` };
  }
}

module.exports = {
  normalizeMessages,
  resolveChatCompletionsUrl,
  sendCustomAIControlMessage,
};
