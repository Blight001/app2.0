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
  const label = getSummaryRoleLabel(role, message);
  const toolNames = getSummaryToolNames(role, message);
  let content = String(message?.content || '').replace(/\s+/g, ' ').trim();
  if (content.startsWith(AI_CONTEXT_SUMMARY_PREFIX.trim())) {
    content = content.slice(AI_CONTEXT_SUMMARY_PREFIX.trim().length).trim();
  }
  content = truncateMiddle(content, role === 'tool' ? 500 : 900);
  const toolSuffix = toolNames.length ? ` [调用工具: ${toolNames.join(', ')}]` : '';
  return `${label}: ${content || '(无文本)'}${toolSuffix}`;
}

function getSummaryRoleLabel(role, message) {
  const label = { system: '系统', user: '用户', assistant: '助手', tool: '工具结果' }[role] || role;
  return role === 'tool' && message?.name ? `${label}(${String(message.name).slice(0, 64)})` : label;
}

function getSummaryToolNames(role, message) {
  if (role !== 'assistant' || !Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.map((call) => String(call?.function?.name || '').trim()).filter(Boolean);
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
  const extracted = extractLeadingSystemGroups(groupValidMessages(messages), limit);
  const partitioned = partitionConversationGroups(extracted.remaining);
  const systemBudget = Math.min(8000, Math.floor(charLimit * 0.25));
  const compactedSystemGroups = compactGroupsWithinBudget(extracted.system, systemBudget);
  const reservedMessages = compactedSystemGroups.reduce((sum, group) => sum + group.length, 0);
  const reservedChars = compactedSystemGroups.reduce((sum, group) => sum + groupChars(group), 0);
  let conversationGroups = partitioned.conversation;
  const initiallyOverLimit = isAiMessageWindowOverLimit(
    partitioned.summaries, conversationGroups, reservedMessages, reservedChars, limit, charLimit,
  );
  if (initiallyOverLimit) {
    conversationGroups = compactPreviousToolResults(conversationGroups);
  }
  const requiresSummary = isAiMessageWindowOverLimit(
    partitioned.summaries, conversationGroups, reservedMessages, reservedChars, limit, charLimit,
  );
  const summaryReserve = requiresSummary
    ? Math.min(MAX_AI_CONTEXT_SUMMARY_CHARS, Math.max(800, Math.floor(charLimit * 0.14)))
    : 0;
  const selected = selectRecentMessageGroups(conversationGroups, {
    messages: Math.max(0, limit - reservedMessages - (requiresSummary ? 1 : 0)),
    chars: Math.max(0, charLimit - reservedChars - summaryReserve),
  });
  const recentChars = selected.recent.reduce((sum, group) => sum + groupChars(group), 0);
  const summaryBudget = Math.min(
    MAX_AI_CONTEXT_SUMMARY_CHARS,
    Math.max(0, charLimit - reservedChars - recentChars),
  );
  const summary = buildContextSummary(
    [...partitioned.summaries, ...selected.dropped],
    summaryBudget,
  );
  return [
    ...compactedSystemGroups.flat(),
    ...(summary ? [summary] : []),
    ...selected.recent.flat(),
  ];
}

function extractLeadingSystemGroups(groups, limit) {
  const remaining = groups.slice();
  const system = [];
  let used = 0;
  while (remaining.length && String(remaining[0]?.[0]?.role || '') === 'system' && system.length < 4) {
    const group = remaining.shift();
    if (used + group.length <= limit) {
      system.push(group);
      used += group.length;
    }
  }
  return { system, remaining };
}

function partitionConversationGroups(groups) {
  const summaries = [];
  const conversation = [];
  for (const group of groups) {
    const content = String(group?.[0]?.content || '');
    (content.startsWith(AI_CONTEXT_SUMMARY_PREFIX) ? summaries : conversation).push(group);
  }
  return { summaries, conversation };
}

function compactGroupsWithinBudget(groups, budget) {
  const compacted = [];
  let remaining = budget;
  for (const group of groups) {
    if (remaining <= 0) break;
    const next = compactGroup(group, remaining);
    compacted.push(next);
    remaining -= groupChars(next);
  }
  return compacted;
}

function isAiMessageWindowOverLimit(summaries, groups, reservedMessages, reservedChars, limit, charLimit) {
  const messageCount = groups.reduce((sum, group) => sum + group.length, reservedMessages);
  const charCount = groups.reduce((sum, group) => sum + groupChars(group), reservedChars);
  return summaries.length > 0 || messageCount > limit || charCount > charLimit;
}

function selectRecentMessageGroups(groups, budget) {
  let remainingMessages = budget.messages;
  let remainingChars = budget.chars;
  const recent = [];
  const dropped = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group.length > remainingMessages) {
      dropped.unshift(group);
      continue;
    }
    const size = groupChars(group);
    if (size <= remainingChars) {
      recent.unshift(group);
      remainingMessages -= group.length;
      remainingChars -= size;
    } else if (!recent.length && remainingChars > 0) {
      const compacted = compactGroup(group, remainingChars);
      recent.unshift(compacted);
      remainingMessages -= compacted.length;
      remainingChars -= groupChars(compacted);
    } else dropped.unshift(group);
  }
  return { recent, dropped };
}

module.exports = {
  AI_CONTEXT_SUMMARY_PREFIX,
  MAX_AI_CONTROL_CHARS,
  MAX_AI_CONTROL_MESSAGES,
  groupValidMessages,
  limitAiControlMessages,
};
