'use strict';

const { withBrowserRouteParam } = require('./chat-tool-context');
const IMAGE_TOOL_NAMES = new Set(['browser_screenshot', 'software_ui']);

function parseToolArguments(call) {
  const raw = String(call?.function?.arguments || '{}');
  try {
    const args = JSON.parse(raw);
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { args: {}, error: 'arguments 必须是 JSON 对象' };
    }
    return { args, error: '' };
  } catch (_) {
    return { args: {}, error: 'arguments 不是有效的 JSON' };
  }
}

function browserReference(args = {}) {
  return String(args.change_browser ?? args.browser_id ?? args.browser_name ?? args.browser ?? '').trim();
}

function resolvePluginTarget(args, connections, findConnectionByRef, describeConnections, controlledConnectionId = '') {
  const reference = browserReference(args);
  if (reference) {
    const found = findConnectionByRef(reference);
    if (found?.ambiguous) {
      return { error: `存在多个名为 ${JSON.stringify(reference)} 的浏览器，请在 change_browser 中传连接 ID：${describeConnections()}` };
    }
    if (!found) {
      return { error: `未在当前 AI 已选且在线的浏览器中找到 ${JSON.stringify(reference)}。`
        + `software_window 的 history_id/tab_id 不能代替 change_browser；可用浏览器：${describeConnections()}` };
    }
    return { connection: found };
  }
  const controlled = connections.find((item) => String(item?.id || '') === String(controlledConnectionId || ''));
  if (controlled) return { connection: controlled };
  if (connections.length === 1) return { connection: connections[0] };
  return { error: `当前没有唯一的控制浏览器，请通过 change_browser 指定目标（连接 ID 或名称）：${describeConnections()}` };
}

async function dispatchPluginTool(context, toolName, args) {
  const target = resolvePluginTarget(
    args,
    context.connections,
    context.findConnectionByRef,
    context.describeConnections,
    context.browserControl?.connectionId,
  );
  if (target.error) {
    return { success: false, error: target.error, errorCode: 'BROWSER_ROUTE_NOT_FOUND', phase: 'tool_route', tool: toolName };
  }
  const dispatchArgs = { ...args };
  delete dispatchArgs.change_browser;
  delete dispatchArgs.browser_id;
  delete dispatchArgs.browser_name;
  delete dispatchArgs.browser;
  if (context.browserControl && context.browserControl.connectionId !== target.connection.id) {
    context.browserControl.connectionId = target.connection.id;
    context.emit?.({ type: 'browser_control_changed', connectionId: target.connection.id, name: target.connection.name || '' });
  }
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

function findConnectionByName(connections, name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return connections.find((item) => String(item?.name || '').trim().toLowerCase() === wanted) || null;
}

function nextWindowControl(context, action, resultName) {
  const current = context.connections.find((item) => item?.id === context.browserControl.connectionId) || null;
  const matched = findConnectionByName(context.connections, resultName);
  if (['open', 'create'].includes(action)) return matched || current;
  if (action === 'close' && matched?.id === current?.id) {
    return context.connections.find((item) => item?.id !== matched.id) || null;
  }
  return current;
}

function appendReadyConnectionTools(context, connection) {
  if (!Array.isArray(context.toolDefinitions)) return;
  const known = new Set(context.toolDefinitions.map((tool) => String(tool?.name || '')));
  for (const tool of (Array.isArray(connection.tools) ? connection.tools : [])) {
    const name = String(tool?.name || '').trim();
    if (!name || known.has(name) || context.windowTools?.has?.(name)) continue;
    context.toolDefinitions.push(withBrowserRouteParam(tool));
    known.add(name);
  }
}

function readyWindowConnection(context, toolResult) {
  const id = String(toolResult?.control_browser_id || '').trim();
  if (!id) return null;
  const existing = context.connections.find((item) => String(item?.id || '') === id);
  const live = existing || context.bridge?.getConnection?.(id);
  if (!live) return null;
  const connection = existing || {
    ...live, name: String(toolResult?.control_browser_name || live.name || '').trim(),
  };
  if (!existing) context.connections.push(connection);
  appendReadyConnectionTools(context, connection);
  return connection;
}

function syncWindowToolControl(context, toolName, args, toolResult) {
  if (toolName !== 'software_window' || toolResult?.success === false || !context.browserControl) return;
  const action = String(args?.action || '').trim().toLowerCase();
  const next = readyWindowConnection(context, toolResult)
    || nextWindowControl(context, action, toolResult?.name);
  if (!next || next.id === context.browserControl.connectionId) return;
  context.browserControl.connectionId = next.id;
  context.emit?.({ type: 'browser_control_changed', connectionId: next.id, name: next.name || '' });
}

function serializeToolResult(result, toolName) {
  let serializedResult = result ?? null;
  let imageMessage = null;
  if (IMAGE_TOOL_NAMES.has(toolName) && result?.success === true
      && /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(result.dataUrl || ''))) {
    const { dataUrl, ...metadata } = result;
    serializedResult = { ...metadata, image_attached: true };
    imageMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: toolName === 'software_ui'
            ? '以下图片是绑定软件窗口的最新状态；坐标只对对应 observation_id 有效。'
            : '以下图片是 browser_screenshot 刚刚截取的页面，请直接分析图片内容。',
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
      ai_free_transient_image: true,
    };
  }
  try { return { content: JSON.stringify(serializedResult), failure: '', imageMessage }; } catch (_) {
    const failure = `${toolName} 返回了无法序列化的结果`;
    return {
      content: JSON.stringify({ success: false, error: failure, recoverable: true }),
      failure,
      imageMessage: null,
    };
  }
}

function compactToolActivityResult(context, result, toolName) {
  if (IMAGE_TOOL_NAMES.has(toolName) && result?.dataUrl) {
    const { dataUrl: _dataUrl, ...metadata } = result;
    return context.compactToolValue({ ...metadata, image_attached: true });
  }
  return context.compactToolValue(result ?? null);
}

function appendPendingImage(context, imageMessage) {
  if (imageMessage) context.pendingImageMessages?.push(imageMessage);
}

async function executeSingleTool(context, call) {
  const toolName = String(call?.function?.name || '').trim();
  const parsedArguments = parseToolArguments(call);
  const args = parsedArguments.args;
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
  if (parsedArguments.error) {
    toolResult = normalizeToolFailure({
      message: `MCP 调用格式错误：${parsedArguments.error}`,
      errorCode: 'MCP_ARGUMENTS_INVALID',
      phase: 'tool_parse',
    }, toolName);
  } else try {
    toolResult = context.windowTools?.has(toolName)
      ? await context.waitForAbort(context.windowTools.execute(toolName, args))
      : await dispatchPluginTool(context, toolName, args);
    syncWindowToolControl(context, toolName, args, toolResult);
  } catch (error) {
    if (context.isStopped(error)) return { stopped: true };
    toolResult = normalizeToolFailure(error, toolName);
  }
  const prepared = prepareToolResult(toolResult, toolName);
  activity.status = prepared.failed ? 'error' : 'success';
  activity.result = compactToolActivityResult(context, toolResult, toolName);
  context.emit({ type: 'tool_result', tool: { ...activity }, round: context.round });
  const serialized = serializeToolResult(prepared.result, toolName);
  context.modelMessages.push({
    role: 'tool',
    tool_call_id: String(call.id || ''),
    name: toolName,
    content: serialized.content,
  });
  appendPendingImage(context, serialized.imageMessage);
  return { failure: serialized.failure || prepared.failure };
}

async function executeToolCalls(context) {
  let unresolvedToolFailure = '';
  const pendingImageMessages = [];
  const executionContext = { ...context, pendingImageMessages };
  for (const call of context.toolCalls) {
    const result = await executeSingleTool(executionContext, call);
    if (result.stopped) return { stopped: true, unresolvedToolFailure };
    if (result.failure) unresolvedToolFailure = result.failure;
  }
  context.modelMessages.push(...pendingImageMessages);
  return { stopped: false, unresolvedToolFailure };
}

module.exports = {
  browserReference,
  dispatchPluginTool,
  executeSingleTool,
  executeToolCalls,
  normalizeToolFailure,
  parseToolArguments,
  prepareToolResult,
  resolvePluginTarget,
  serializeToolResult,
  syncWindowToolControl,
};
