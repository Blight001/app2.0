'use strict';

function parseToolArguments(call) {
  try { return JSON.parse(String(call?.function?.arguments || '{}')); } catch (_) { return {}; }
}

function resolvePluginTarget(args, connections, findConnectionByRef, describeConnections) {
  const reference = String(args?.browser_id ?? args?.browser_name ?? args?.browser ?? '').trim();
  if (reference) {
    const found = findConnectionByRef(reference);
    if (found?.ambiguous) {
      return { error: `存在多个名为 ${JSON.stringify(reference)} 的浏览器，请改用 browser_id 传连接 ID：${describeConnections()}` };
    }
    if (!found) return { error: `未找到名为 ${JSON.stringify(reference)} 的浏览器连接，可用浏览器：${describeConnections()}` };
    return { connection: found };
  }
  if (connections.length === 1) return { connection: connections[0] };
  return { error: `当前选择了 ${connections.length} 个浏览器，请通过 browser_id 参数指定目标浏览器（连接 ID 或名称），可用浏览器：${describeConnections()}` };
}

async function dispatchPluginTool(context, toolName, args) {
  const target = resolvePluginTarget(
    args,
    context.connections,
    context.findConnectionByRef,
    context.describeConnections,
  );
  if (target.error) {
    return { success: false, error: target.error, errorCode: 'BROWSER_ROUTE_NOT_FOUND', phase: 'tool_route', tool: toolName };
  }
  const dispatchArgs = { ...args };
  delete dispatchArgs.browser_id;
  delete dispatchArgs.browser_name;
  delete dispatchArgs.browser;
  const requestedSeconds = Number(args?.timeout_seconds || 0);
  const isCardRun = toolName === 'manage_card'
    && String(args?.action || '').trim().toLowerCase() === 'run';
  const timeoutMs = requestedSeconds > 0
    ? Math.min(1800, Math.max(1, requestedSeconds)) * 1000
    : (isCardRun ? 900000 : 180000);
  return context.waitForAbort(context.bridge.dispatch(target.connection.id, toolName, dispatchArgs, { timeoutMs }));
}

function normalizeToolFailure(error, toolName) {
  const message = String(error?.message || error || '浏览器工具执行失败').trim();
  return {
    success: false,
    error: message,
    errorReason: message,
    errorCode: String(error?.errorCode || error?.code || 'BROWSER_TOOL_FAILED'),
    phase: String(error?.phase || 'tool_dispatch'),
    tool: String(error?.tool || toolName),
    ...(Number(error?.timeoutMs || 0) > 0 ? { timeoutMs: Number(error.timeoutMs) } : {}),
  };
}

function prepareToolResult(toolResult, toolName) {
  const failed = toolResult?.success === false || toolResult?.ok === false;
  if (!failed) return { failed: false, result: toolResult, failure: '' };
  const failure = String(toolResult?.error || toolResult?.message || `${toolName} 执行失败`);
  return {
    failed: true,
    failure,
    result: {
      ...(toolResult && typeof toolResult === 'object' ? toolResult : {}),
      success: false,
      error: failure,
      recoverable: true,
      instruction: '本次浏览器操作失败。请根据错误调整参数或向用户说明，不要终止整个对话。',
    },
  };
}

function serializeToolResult(result, toolName) {
  try { return { content: JSON.stringify(result ?? null), failure: '' }; } catch (_) {
    const failure = `${toolName} 返回了无法序列化的结果`;
    return { content: JSON.stringify({ success: false, error: failure, recoverable: true }), failure };
  }
}

async function executeSingleTool(context, call) {
  const toolName = String(call?.function?.name || '').trim();
  const args = parseToolArguments(call);
  const activity = {
    id: String(call.id || ''),
    name: toolName,
    arguments: context.compactToolValue(args),
    status: 'running',
  };
  context.toolEvents.push(activity);
  context.traceEvents.push({ type: 'tool', round: context.round, tool: activity });
  context.emit({ type: 'tool_start', tool: { ...activity }, round: context.round });
  let toolResult;
  try {
    toolResult = context.windowTools?.has(toolName)
      ? await context.waitForAbort(context.windowTools.execute(toolName, args))
      : await dispatchPluginTool(context, toolName, args);
  } catch (error) {
    if (context.isStopped(error)) return { stopped: true };
    toolResult = normalizeToolFailure(error, toolName);
  }
  const prepared = prepareToolResult(toolResult, toolName);
  activity.status = prepared.failed ? 'error' : 'success';
  activity.result = context.compactToolValue(toolResult ?? null);
  context.emit({ type: 'tool_result', tool: { ...activity }, round: context.round });
  const serialized = serializeToolResult(prepared.result, toolName);
  context.modelMessages.push({
    role: 'tool',
    tool_call_id: String(call.id || ''),
    name: toolName,
    content: serialized.content,
  });
  return { failure: serialized.failure || prepared.failure };
}

async function executeToolCalls(context) {
  let unresolvedToolFailure = '';
  for (const call of context.toolCalls) {
    const result = await executeSingleTool(context, call);
    if (result.stopped) return { stopped: true, unresolvedToolFailure };
    if (result.failure) unresolvedToolFailure = result.failure;
  }
  return { stopped: false, unresolvedToolFailure };
}

module.exports = {
  dispatchPluginTool,
  executeSingleTool,
  executeToolCalls,
  normalizeToolFailure,
  parseToolArguments,
  prepareToolResult,
  resolvePluginTarget,
  serializeToolResult,
};
