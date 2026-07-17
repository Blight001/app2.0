'use strict';

const MAX_AI_CONTROL_MESSAGES = 40;
// The backend currently rejects more than 50,000 content characters. Keep a
// margin for the model prompt, tool definitions and JSON framing.
const MAX_AI_CONTROL_CHARS = 42000;
const MAX_AI_CONTEXT_SUMMARY_CHARS = 6000;
const AI_CONTEXT_SUMMARY_PREFIX = '[自动压缩的早期对话]\n';
const PREVIOUS_TOOL_RESULT_PREFIX = '[较早的工具返回值已自动压缩';
const MAX_PREVIOUS_TOOL_RESULT_CHARS = 600;

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

function messageChars(message) {
  return String(message?.content || '').length;
}

function groupChars(group) {
  return group.reduce((sum, message) => sum + messageChars(message), 0);
}

function truncateMiddle(value, limit) {
  const text = String(value || '');
  const size = Math.max(0, Math.floor(Number(limit) || 0));
  if (text.length <= size) return text;
  if (size <= 1) return text.slice(0, size);
  const marker = '\n…（内容已自动压缩）…\n';
  if (size <= marker.length + 20) return `${text.slice(0, Math.max(0, size - 1))}…`;
  const available = size - marker.length;
  const head = Math.ceil(available * 0.7);
  return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
}

function compactGroup(group, budget) {
  const source = group.map((message) => ({ ...message }));
  const limit = Math.max(0, Math.floor(Number(budget) || 0));
  if (groupChars(source) <= limit) return source;

  const originalSizes = source.map(messageChars);
  const contentLimits = originalSizes.map((size) => Math.min(size, 120));
  let remaining = Math.max(0, limit - contentLimits.reduce((sum, size) => sum + size, 0));
  // Give unused space to the newest messages first. Recent tool results and the
  // latest user request are normally more useful than old intermediate text.
  for (let index = source.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const extra = Math.min(remaining, originalSizes[index] - contentLimits[index]);
    contentLimits[index] += extra;
    remaining -= extra;
  }
  return source.map((message, index) => ({
    ...message,
    content: truncateMiddle(message.content, contentLimits[index]),
  }));
}

function compactPreviousToolResults(groups) {
  // A trailing tool group is about to be consumed by the next model round and
  // must remain intact. Tool results followed by later conversation are stale
  // observations, so reclaim their space before dropping user/assistant text.
  const protectedIndex = groups.length
    && String(groups.at(-1)?.at(-1)?.role || '') === 'tool'
    ? groups.length - 1
    : -1;
  return groups.map((group, groupIndex) => group.map((message) => {
    if (groupIndex === protectedIndex || String(message?.role || '') !== 'tool') return message;
    const content = String(message?.content || '');
    if (content.length <= MAX_PREVIOUS_TOOL_RESULT_CHARS
      || content.startsWith(PREVIOUS_TOOL_RESULT_PREFIX)) return message;
    const header = `${PREVIOUS_TOOL_RESULT_PREFIX}，原长度 ${content.length} 字符]\n`;
    return {
      ...message,
      content: `${header}${truncateMiddle(
        content,
        Math.max(0, MAX_PREVIOUS_TOOL_RESULT_CHARS - header.length),
      )}`,
    };
  }));
}

function summaryLine(message) {
  const role = String(message?.role || '');
  let label = { system: '系统', user: '用户', assistant: '助手', tool: '工具结果' }[role] || role;
  if (role === 'tool' && message?.name) label += `(${String(message.name).slice(0, 64)})`;
  const toolNames = role === 'assistant' && Array.isArray(message?.tool_calls)
    ? message.tool_calls.map((call) => String(call?.function?.name || '').trim()).filter(Boolean)
    : [];
  let content = String(message?.content || '').replace(/\s+/g, ' ').trim();
  if (content.startsWith(AI_CONTEXT_SUMMARY_PREFIX.trim())) {
    content = content.slice(AI_CONTEXT_SUMMARY_PREFIX.trim().length).trim();
  }
  content = truncateMiddle(content, role === 'tool' ? 500 : 900);
  const toolSuffix = toolNames.length ? ` [调用工具: ${toolNames.join(', ')}]` : '';
  return `${label}: ${content || '(无文本)'}${toolSuffix}`;
}

function buildContextSummary(droppedGroups, maxChars) {
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (!droppedGroups.length || limit < 80) return null;
  const entries = droppedGroups.flat().map((message, index) => ({
    index,
    role: String(message?.role || ''),
    line: summaryLine(message),
  }));
  const header = `${AI_CONTEXT_SUMMARY_PREFIX}共压缩 ${entries.length} 条较早消息；以下为提要，最近对话保持原文：\n`;
  let selected = [];
  let used = header.length;

  // Preserve the original objective when possible, then fill the remaining
  // summary budget with the newest part of the discarded context.
  const firstUser = entries.find((entry) => entry.role === 'user');
  if (firstUser) {
    const line = truncateMiddle(firstUser.line, Math.min(1200, Math.max(0, limit - used - 1)));
    if (line) {
      selected.push({ ...firstUser, line });
      used += line.length + 1;
    }
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (firstUser && entry.index === firstUser.index) continue;
    const available = limit - used - 1;
    if (available <= 40) break;
    const line = truncateMiddle(entry.line, available);
    selected.push({ ...entry, line });
    used += line.length + 1;
  }
  selected.sort((left, right) => left.index - right.index);
  return {
    role: 'assistant',
    content: truncateMiddle(`${header}${selected.map((entry) => entry.line).join('\n')}`, limit),
    ai_context_summary: true,
  };
}

function limitAiControlMessages(
  messages = [],
  maxMessages = MAX_AI_CONTROL_MESSAGES,
  maxChars = MAX_AI_CONTROL_CHARS,
) {
  const limit = Math.max(1, Math.floor(Number(maxMessages) || MAX_AI_CONTROL_MESSAGES));
  const charLimit = Math.max(1000, Math.floor(Number(maxChars) || MAX_AI_CONTROL_CHARS));
  const groups = groupValidMessages(messages);
  const leadingSystemGroups = [];
  while (groups.length && String(groups[0]?.[0]?.role || '') === 'system' && leadingSystemGroups.length < 4) {
    const group = groups.shift();
    if (leadingSystemGroups.reduce((sum, item) => sum + item.length, 0) + group.length <= limit) {
      leadingSystemGroups.push(group);
    }
  }

  const previousSummaryGroups = [];
  let conversationGroups = [];
  for (const group of groups) {
    const content = String(group?.[0]?.content || '');
    if (content.startsWith(AI_CONTEXT_SUMMARY_PREFIX)) previousSummaryGroups.push(group);
    else conversationGroups.push(group);
  }

  const systemBudget = Math.min(8000, Math.floor(charLimit * 0.25));
  const compactedSystemGroups = [];
  let remainingSystemBudget = systemBudget;
  for (const group of leadingSystemGroups) {
    if (remainingSystemBudget <= 0) break;
    const compacted = compactGroup(group, remainingSystemBudget);
    compactedSystemGroups.push(compacted);
    remainingSystemBudget -= groupChars(compacted);
  }
  const reservedMessages = compactedSystemGroups.reduce((sum, group) => sum + group.length, 0);
  const reservedChars = compactedSystemGroups.reduce((sum, group) => sum + groupChars(group), 0);
  const initiallyOverLimit = previousSummaryGroups.length > 0
    || conversationGroups.reduce((sum, group) => sum + group.length, reservedMessages) > limit
    || conversationGroups.reduce((sum, group) => sum + groupChars(group), reservedChars) > charLimit;
  if (initiallyOverLimit) {
    conversationGroups = compactPreviousToolResults(conversationGroups);
  }
  const requiresSummary = previousSummaryGroups.length > 0
    || conversationGroups.reduce((sum, group) => sum + group.length, reservedMessages) > limit
    || conversationGroups.reduce((sum, group) => sum + groupChars(group), reservedChars) > charLimit;
  const summaryReserve = requiresSummary
    ? Math.min(MAX_AI_CONTEXT_SUMMARY_CHARS, Math.max(800, Math.floor(charLimit * 0.14)))
    : 0;
  let remainingMessages = Math.max(0, limit - reservedMessages - (requiresSummary ? 1 : 0));
  let remainingChars = Math.max(0, charLimit - reservedChars - summaryReserve);
  const recentGroups = [];
  const droppedConversationGroups = [];
  for (let index = conversationGroups.length - 1; index >= 0; index -= 1) {
    const group = conversationGroups[index];
    if (group.length > remainingMessages) {
      droppedConversationGroups.unshift(group);
      continue;
    }
    const size = groupChars(group);
    if (size <= remainingChars) {
      recentGroups.unshift(group);
      remainingMessages -= group.length;
      remainingChars -= size;
      continue;
    }
    if (!recentGroups.length && remainingChars > 0) {
      const compacted = compactGroup(group, remainingChars);
      recentGroups.unshift(compacted);
      remainingMessages -= compacted.length;
      remainingChars -= groupChars(compacted);
    } else {
      droppedConversationGroups.unshift(group);
    }
  }

  const recentChars = recentGroups.reduce((sum, group) => sum + groupChars(group), 0);
  const summaryBudget = Math.min(
    MAX_AI_CONTEXT_SUMMARY_CHARS,
    Math.max(0, charLimit - reservedChars - recentChars),
  );
  const summary = buildContextSummary(
    [...previousSummaryGroups, ...droppedConversationGroups],
    summaryBudget,
  );
  return [
    ...compactedSystemGroups.flat(),
    ...(summary ? [summary] : []),
    ...recentGroups.flat(),
  ];
}

module.exports = {
  AI_CONTEXT_SUMMARY_PREFIX,
  MAX_AI_CONTROL_CHARS,
  MAX_AI_CONTROL_MESSAGES,
  groupValidMessages,
  limitAiControlMessages,
};
