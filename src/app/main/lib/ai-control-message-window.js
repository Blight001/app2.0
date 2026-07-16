'use strict';

const MAX_AI_CONTROL_MESSAGES = 40;

function toolCallIds(message) {
  if (String(message?.role || '') !== 'assistant' || !Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.map((call) => String(call?.id || '').trim()).filter(Boolean);
}

function groupValidMessages(messages = []) {
  const source = Array.isArray(messages) ? messages.filter((item) => item && typeof item === 'object') : [];
  const groups = [];
  for (let index = 0; index < source.length; index += 1) {
    const message = source[index];
    const role = String(message?.role || '');
    if (role === 'tool') continue;

    const ids = toolCallIds(message);
    if (!ids.length) {
      groups.push([message]);
      continue;
    }

    const tools = [];
    let cursor = index + 1;
    while (cursor < source.length && String(source[cursor]?.role || '') === 'tool') {
      tools.push(source[cursor]);
      cursor += 1;
    }
    const returnedIds = new Set(tools.map((item) => String(item?.tool_call_id || '').trim()).filter(Boolean));
    if (ids.every((id) => returnedIds.has(id))) {
      groups.push([message, ...tools]);
    } else {
      // 旧记录可能刚好从工具调用中间被截断。移除不完整的 tool_calls，
      // 保留可读文本，避免 OpenAI 兼容接口因孤立工具消息拒绝整个请求。
      const { tool_calls: _discarded, ...plainAssistant } = message;
      if (String(plainAssistant.content || '').trim()) groups.push([plainAssistant]);
    }
    index = cursor - 1;
  }
  return groups;
}

function limitAiControlMessages(messages = [], maxMessages = MAX_AI_CONTROL_MESSAGES) {
  const limit = Math.max(1, Math.floor(Number(maxMessages) || MAX_AI_CONTROL_MESSAGES));
  const groups = groupValidMessages(messages);
  const leadingSystemGroups = [];
  while (groups.length && String(groups[0]?.[0]?.role || '') === 'system') {
    const group = groups.shift();
    if (leadingSystemGroups.reduce((sum, item) => sum + item.length, 0) + group.length <= limit) {
      leadingSystemGroups.push(group);
    }
  }

  const reserved = leadingSystemGroups.reduce((sum, group) => sum + group.length, 0);
  let remaining = limit - reserved;
  const recentGroups = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group.length > remaining) continue;
    recentGroups.unshift(group);
    remaining -= group.length;
    if (remaining <= 0) break;
  }
  return [...leadingSystemGroups, ...recentGroups].flat();
}

module.exports = {
  MAX_AI_CONTROL_MESSAGES,
  groupValidMessages,
  limitAiControlMessages,
};
