'use strict';

const { limitAiControlMessages } = require('../../lib/ai-control-message-window');

function createConnectionResolver(connections) {
  const findConnectionByRef = (ref) => {
    const wanted = String(ref || '').trim();
    if (!wanted) return null;
    const byId = connections.find((item) => String(item.id) === wanted);
    if (byId) return byId;
    const lower = wanted.toLowerCase();
    const byName = connections.filter((item) => String(item.name || '').trim().toLowerCase() === lower
      || String(item.pluginName || '').trim().toLowerCase() === lower);
    if (byName.length > 1) return { ambiguous: true, ref: wanted };
    return byName[0] || null;
  };
  const describeConnections = () => connections
    .map((item) => `“${String(item.name || 'AI自动化浏览器')}”（change_browser: ${item.id}）`)
    .join('、');
  return { findConnectionByRef, describeConnections };
}

function withBrowserRouteParam(tool) {
  const schema = tool?.input_schema && typeof tool.input_schema === 'object'
    ? tool.input_schema
    : { type: 'object', properties: {} };
  return {
    ...tool,
    input_schema: {
      ...schema,
      properties: {
        ...(schema.properties && typeof schema.properties === 'object' ? schema.properties : {}),
        change_browser: {
          type: 'string',
          description: '可选。切换唯一的当前控制浏览器，填写连接 ID 或唯一名称；省略则继续控制当前浏览器。',
        },
      },
    },
  };
}

function collectConnectionTools(connections, windowTools) {
  const seenToolNames = new Set();
  const definitions = [];
  for (const item of connections) {
    for (const tool of (Array.isArray(item.tools) ? item.tools : [])) {
      const toolName = String(tool?.name || '');
      if (!toolName || windowTools?.has(toolName) || seenToolNames.has(toolName)) continue;
      seenToolNames.add(toolName);
      definitions.push(withBrowserRouteParam(tool));
    }
  }
  return definitions;
}

function appendDownloadWorkflow(workflow, available) {
  if (!available.has('browser_observe') || !available.has('browser_download')) return;
  workflow.push('下载前用 browser_observe 找真实 downloadUrl，再交给 browser_download');
}

function createSoftwareUiWorkflow(available, softwareTarget) {
  const name = String(softwareTarget?.name || '当前软件').replace(/[\r\n\t]+/g, ' ').slice(0, 80);
  return available.has('software_ui')
    ? `software_ui 已绑定“${name}”：先 observe；click 走鼠标，invoke 才走 UIA；界面变化后重取 ref。`
    : '';
}

function createMcpContext(tools, connections, resolver, controlledConnectionId, softwareTarget) {
  if (!tools.length) return null;
  const availableNames = tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
  const toolNames = availableNames.join('、');
  const available = new Set(availableNames);
  const controlled = connections.find((item) => String(item?.id || '') === String(controlledConnectionId || ''));
  const routing = connections.length > 1
    ? `可用连接：${resolver.describeConnections()}。当前只控制“${String(controlled?.name || controlled?.id || '未知')}”。AI 同一时间最多控制一个浏览器；要操作其他浏览器，必须在下一次浏览器工具调用中传 change_browser（连接 ID 或唯一名称），切换后后续调用沿用新目标。禁止同时控制多个目标或猜测目标。`
    : (connections.length === 1
      ? `当前唯一控制浏览器为 ${resolver.describeConnections()}；无需传 change_browser，除非之后出现新的可用连接。`
      : '当前没有可用的浏览器自动化连接，不要调用或虚构浏览器工具。');
  const workflow = [];
  if (available.has('browser_tab')) workflow.push('用 browser_tab 管理网页标签');
  if (available.has('browser_observe') && available.has('browser_action')) {
    workflow.push('网页先 observe 再 action，页面变化后刷新 ref');
  } else if (available.has('browser_observe')) workflow.push('用 browser_observe 读取网页');
  if (available.has('browser_wait')) workflow.push('仅在确需加载时 wait');
  appendDownloadWorkflow(workflow, available);
  if (available.has('sandbox_files')) {
    workflow.push('本地文件先用 sandbox_files 获取路径');
  }
  const browserWorkflow = workflow.length
    ? `${workflow.join('；')}。`
    : '';
  const softwareWorkflow = createSoftwareUiWorkflow(available, softwareTarget);
  return {
    role: 'system',
    content: `工具：${toolNames}。${routing}${browserWorkflow}${softwareWorkflow}`
      + 'software_window 只管理 AI-FREE 浏览器窗口；网页工具仅控制当前浏览器，切换用 change_browser。'
      + '严格按 schema 和返回结果行动；页面或窗口变化后不要复用旧 ref。重要修改须在用户授权内，未成功不得声称完成。',
    ai_free_card_context: true,
  };
}

function buildChatToolContext(options = {}) {
  const {
    connections, controlledConnectionId, windowTools, selectedAutomationCard,
    automationCardId, initialMessages, softwareTarget,
  } = options;
  const resolver = createConnectionResolver(connections);
  const tools = [...(windowTools?.tools || []), ...collectConnectionTools(connections, windowTools)];
  const cardName = String(
    selectedAutomationCard?.cardName || selectedAutomationCard?.cardData?.name || automationCardId,
  ).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  const cardContext = selectedAutomationCard && connections.length
    ? {
      role: 'system',
      content: `AI 控制当前选中的自动化卡片名称为 ${JSON.stringify(cardName)}，ID 为 ${JSON.stringify(automationCardId.slice(0, 200))}。当用户要求查看、修改或运行当前卡片时，优先通过 manage_card 使用该 ID；不要擅自改用其他卡片。`,
      ai_free_card_context: true,
    }
    : null;
  const mcpContext = createMcpContext(
    tools, connections, resolver, controlledConnectionId, softwareTarget,
  );
  return {
    ...resolver,
    tools,
    modelMessages: limitAiControlMessages([
      ...(mcpContext ? [mcpContext] : []),
      ...(cardContext ? [cardContext] : []),
      ...initialMessages,
    ]),
  };
}

module.exports = { buildChatToolContext, createConnectionResolver, createMcpContext, withBrowserRouteParam };
