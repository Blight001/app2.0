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
    .map((item) => `“${String(item.name || 'AI自动化浏览器')}”（browser_id: ${item.id}）`)
    .join('、');
  return { findConnectionByRef, describeConnections };
}

function withBrowserRouteParam(tool) {
  const schema = tool?.input_schema && typeof tool.input_schema === 'object'
    ? tool.input_schema
    : { type: 'object', properties: {} };
  const required = Array.isArray(schema.required) ? schema.required : [];
  return {
    ...tool,
    input_schema: {
      ...schema,
      required: [...new Set([...required, 'browser_id'])],
      properties: {
        ...(schema.properties && typeof schema.properties === 'object' ? schema.properties : {}),
        browser_id: {
          type: 'string',
          description: '目标浏览器：填所选浏览器的连接 ID 或名称。当前已选择多个浏览器，每次调用都必须指定，不同浏览器的标签页与页面状态相互独立。',
        },
      },
    },
  };
}

function collectConnectionTools(connections, windowTools, multiBrowser) {
  const seenToolNames = new Set();
  const definitions = [];
  for (const item of connections) {
    for (const tool of (Array.isArray(item.tools) ? item.tools : [])) {
      const toolName = String(tool?.name || '');
      if (!toolName || windowTools?.has(toolName) || seenToolNames.has(toolName)) continue;
      seenToolNames.add(toolName);
      definitions.push(multiBrowser ? withBrowserRouteParam(tool) : tool);
    }
  }
  return definitions;
}

function createMcpContext(tools, connections, resolver) {
  if (!tools.length) return null;
  const availableNames = tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean);
  const toolNames = availableNames.join('、');
  const available = new Set(availableNames);
  const routing = connections.length > 1
    ? `当前连接：${resolver.describeConnections()}。调用每一个浏览器工具时都必须传 browser_id；根据用户提到的窗口名称选择并在连续步骤中保持同一 ID，除非用户明确切换。目标仍不明确时先询问，禁止猜测。`
    : (connections.length === 1
      ? `当前浏览器为 ${resolver.describeConnections()}；browser_id 可省略，但用户明确指定其他窗口时不要假装已控制该窗口。`
      : '当前没有可用的浏览器自动化连接，不要调用或虚构浏览器工具。');
  const workflow = [];
  if (available.has('browser_tab')) workflow.push('使用 browser_tab 确认、切换或导航标签页');
  if (available.has('browser_observe') && available.has('browser_action')) {
    workflow.push('网页操作前先用 browser_observe 获取当前状态，再用 browser_action 操作；导航、切换标签页或页面明显变化后重新 observe，禁止跨浏览器或跨页面复用旧 ref');
  } else if (available.has('browser_observe')) workflow.push('用 browser_observe 读取当前页面，不虚构未返回的元素');
  if (available.has('browser_wait')) workflow.push('仅在页面确实需要加载或等待元素时使用 browser_wait');
  const browserWorkflow = workflow.length
    ? `${workflow.join('；')}。操作失败时根据错误调整策略，不要原样盲目重试。`
    : '';
  return {
    role: 'system',
    content: `你可以使用这些 AI-FREE MCP 工具：${toolNames}。${routing}${browserWorkflow}`
      + '只调用目录中真实存在的工具并严格遵守参数 schema。software_window 仅管理软件窗口：其 list 返回的 history_id、tab_id 和 name 不能直接当作 browser_id；要聚焦已打开窗口，调用 software_window 的 open，并传 history_id 或唯一名称。'
      + 'browser_tab/browser_observe/browser_action/browser_wait 等浏览器工具只能使用当前连接列表明确给出的 browser_id；窗口已打开不等于其 MCP 已连接或已被当前 AI 选中。'
      + '当用户目标明确且操作安全时直接完成，不要为已知信息反复询问；涉及删除、覆盖、提交、支付或发送等重要动作时，以用户授权范围为准。'
      + '必须根据工具返回值判断下一步，未收到成功结果前不得声称操作完成；完成后用简洁自然语言说明实际结果，不要暴露内部调用格式。',
    ai_free_card_context: true,
  };
}

function buildChatToolContext(options = {}) {
  const { connections, windowTools, selectedAutomationCard, automationCardId, initialMessages } = options;
  const multiBrowser = connections.length > 1;
  const resolver = createConnectionResolver(connections);
  const tools = [...(windowTools?.tools || []), ...collectConnectionTools(connections, windowTools, multiBrowser)];
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
  const mcpContext = createMcpContext(tools, connections, resolver);
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
