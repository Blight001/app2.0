'use strict';

const SOFTWARE_APP_TOOL = Object.freeze({
  name: 'software_app',
  destructive: true,
  description: '列出、打开、切换或关闭 Software Workspace 中的软件实例。',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'open', 'switch', 'close'],
      },
      software_id: { type: 'string', maxLength: 200 },
      tab_id: { type: 'string', maxLength: 200 },
    },
  },
});

function createAiSoftwareWindowTools(options = {}) {
  const ui = options.ui;
  const tools = ui ? [SOFTWARE_APP_TOOL] : [];
  const requireTabId = (args) => {
    const tabId = String(args.tab_id || '').trim();
    if (!tabId) throw new Error('缺少 tab_id');
    return tabId;
  };
  const actions = {
    list: async () => ({ items: await ui.listAvailableSoftware() }),
    open: async (args) => {
      const softwareId = String(args.software_id || '').trim();
      if (!softwareId) throw new Error('缺少 software_id');
      return { tabId: await ui.openExternalApp(softwareId) };
    },
    switch: async (args) => {
      const tabId = requireTabId(args);
      await ui.switchTab(tabId);
      return { switched: true, tabId };
    },
    close: async (args) => {
      const tabId = requireTabId(args);
      await ui.closeTab(tabId);
      return { closed: true, tabId };
    },
  };

  async function execute(name, args = {}) {
    if (name !== SOFTWARE_APP_TOOL.name || !ui) {
      throw new Error(`暂无该软件窗口调用：${name}`);
    }
    const action = String(args.action || '').trim();
    const handler = actions[action];
    if (!handler) throw new Error(`不支持的软件窗口动作: ${action || '空'}`);
    return handler(args);
  }

  return Object.freeze({
    tools,
    has: (name) => Boolean(ui && name === SOFTWARE_APP_TOOL.name),
    execute,
  });
}

module.exports = {
  SOFTWARE_APP_TOOL,
  createAiSoftwareWindowTools,
};
