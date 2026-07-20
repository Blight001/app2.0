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
  return {
    ...tool,
    input_schema: {
      ...schema,
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
  const browserContext = multiBrowser
    ? {
      role: 'system',
      content: `AI 控制当前同时连接了 ${connections.length} 个浏览器：${resolver.describeConnections()}。`
        + '调用浏览器插件工具（browser_tab/browser_observe/browser_action/browser_wait/manage_card/save_cookies 等）时，'
        + '必须通过 browser_id 参数指定目标浏览器（填连接 ID 或浏览器名称）。'
        + '不同浏览器的标签页、页面状态与登录会话相互独立；用户提到某个浏览器名称时，就在对应浏览器上执行操作。',
      ai_free_card_context: true,
    }
    : null;
  return {
    ...resolver,
    tools,
    modelMessages: limitAiControlMessages([
      ...(browserContext ? [browserContext] : []),
      ...(cardContext ? [cardContext] : []),
      ...initialMessages,
    ]),
  };
}

module.exports = { buildChatToolContext, createConnectionResolver, withBrowserRouteParam };
