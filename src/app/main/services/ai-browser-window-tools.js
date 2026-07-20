// 软件端 AI 默认自带的"外层"浏览器窗口控制工具。
//
// 与浏览器插件（扩展）上报的页面内工具不同，这组工具不依赖任何插件连接，
// 始终注入 AI 控制对话，直接操作软件自身的独立浏览器窗口：
// 列出窗口记录、从记录打开、新建、重命名、关闭。
// 底层复用 ipc/register/settings 的浏览器历史（browserHistory）读写逻辑，
// 保证 AI 操作与设置页/标签栏手工操作看到的是同一份数据。

const {
  DEFAULT_BROWSER_WINDOW_NAME,
  DEFAULT_BROWSER_WINDOW_URL,
  createBrowserHistoryId,
  makeUniqueBrowserName,
  openBrowserHistoryRecord,
  readBrowserHistorySafe,
  renameBrowserHistoryRecord,
  serializeBrowserHistory,
  syncOpenTabsToBrowserHistory,
  writeBrowserHistorySafe,
} = require('../features/browser/browser-history-service');
const { readStoreConfigSafe } = require('../ipc/register/store-utils');
const { normalizeAiFreeBrowserSettings } = require('../utils/ai-free-browser-settings');
const { FREE_BROWSER_WINDOW_LIMIT, resolveVipAccess } = require('../utils/vip-access');

const SOFTWARE_WINDOW_TOOL_PREFIX = 'software_window_';

function text(value) {
  return String(value || '').trim();
}

function optionalField(value, key) {
  const normalized = text(value);
  return normalized ? { [key]: normalized } : {};
}

function slimHistoryItem(item = {}) {
  return {
    history_id: text(item.id),
    name: text(item.name),
    url: text(item.url),
    is_open: item?.isOpen === true,
    is_active: item?.isActive === true,
    tab_id: text(item.tabId),
    ...optionalField(item.kind, 'kind'),
    ...optionalField(item.accountId, 'account_id'),
    ...optionalField(item.lastError, 'last_error'),
    created_at: Number(item.createdAt) || 0,
    last_opened_at: Number(item.lastOpenedAt) || 0,
  };
}

function createToolDefinitions() {
  const locateProps = {
    history_id: { type: 'string', description: `窗口记录 ID（推荐，来自 ${SOFTWARE_WINDOW_TOOL_PREFIX}list）` },
    name: { type: 'string', description: '窗口名称（未提供 history_id 时按名称精确匹配）' },
  };
  return [
    {
      name: `${SOFTWARE_WINDOW_TOOL_PREFIX}list`, destructive: false,
      description: '【软件窗口】列出软件内全部独立浏览器窗口记录（含未打开的历史记录）及其打开/激活状态。只读；操作窗口前建议先调用本工具获取 history_id。',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: `${SOFTWARE_WINDOW_TOOL_PREFIX}open`, destructive: false,
      description: '【软件窗口】从记录中打开一个浏览器窗口（恢复其环境与会话）；若窗口已经打开则切换为当前活动窗口。',
      input_schema: { type: 'object', properties: { ...locateProps }, required: [] },
    },
    {
      name: `${SOFTWARE_WINDOW_TOOL_PREFIX}create`, destructive: true,
      description: '【软件窗口】新建一个独立浏览器窗口并立即打开。可指定窗口名称和初始网址（http/https）；名称重复时自动追加序号。',
      input_schema: {
        type: 'object', required: [],
        properties: {
          name: { type: 'string', description: `窗口名称，默认「${DEFAULT_BROWSER_WINDOW_NAME}」` },
          url: { type: 'string', description: '可选，初始打开的 http/https 网址；留空使用默认起始页' },
        },
      },
    },
    {
      name: `${SOFTWARE_WINDOW_TOOL_PREFIX}rename`, destructive: true,
      description: '【软件窗口】重命名一个浏览器窗口记录（已打开的窗口标签标题同步更新）。',
      input_schema: {
        type: 'object', required: ['new_name'],
        properties: { ...locateProps, new_name: { type: 'string', description: '新的窗口名称' } },
      },
    },
    {
      name: `${SOFTWARE_WINDOW_TOOL_PREFIX}close`, destructive: true,
      description: '【软件窗口】关闭一个已打开的浏览器窗口。窗口记录保留，之后可以再用 software_window_open 从记录中重新打开。',
      input_schema: { type: 'object', properties: { ...locateProps }, required: [] },
    },
  ];
}

class AiBrowserWindowTools {
  constructor(deps) {
    this.ui = deps.ui;
    this.licenseCache = deps.licenseCache || null;
    this.logger = deps.logger || console;
    if (!this.ui || typeof this.ui.getTabs !== 'function') {
      throw new Error('AI 窗口工具缺少 ui 桥接（getTabs 等）');
    }
  }

  listSerialized() {
    const history = syncOpenTabsToBrowserHistory(this.ui);
    return serializeBrowserHistory(history, this.ui);
  }

  resolveRecord(args = {}, serialized = this.listSerialized()) {
    const historyId = text(args.history_id);
    if (historyId) {
      const byId = serialized.find((item) => text(item?.id) === historyId);
      if (!byId) throw new Error(`浏览器窗口记录不存在: ${historyId}，请先用 ${SOFTWARE_WINDOW_TOOL_PREFIX}list 查看`);
      return byId;
    }
    const name = text(args.name);
    if (!name) throw new Error('请提供 history_id 或 name 来定位浏览器窗口');
    const matches = serialized.filter((item) => text(item?.name).toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!matches.length) throw new Error(`没有名为「${name}」的浏览器窗口记录，请先用 ${SOFTWARE_WINDOW_TOOL_PREFIX}list 查看`);
    if (matches.length > 1) {
      const ids = matches.map((item) => text(item?.id)).join(', ');
      throw new Error(`有 ${matches.length} 个窗口都叫「${name}」（${ids}），请改用 history_id 指定`);
    }
    return matches[0];
  }

  findOpenTab(record) {
    const historyId = text(record?.id);
    return Array.from(this.ui.getTabs()?.values?.() || []).find((tab) => (
      text(tab?.browserHistoryId) === historyId
      || (record.profileId && text(tab?.id) === text(record.profileId))
      || (record.accountId && text(tab?.accountId) === text(record.accountId))
    )) || null;
  }

  async list() {
    const items = this.listSerialized().map(slimHistoryItem);
    return { success: true, total: items.length, open_count: items.filter((item) => item.is_open).length, items };
  }

  async open(args = {}) {
    const record = this.resolveRecord(args);
    const opened = await openBrowserHistoryRecord(this.ui, record.id);
    return {
      success: true, history_id: text(opened.historyId || record.id), tab_id: text(opened.tabId),
      name: text(opened.name || record.name), already_open: opened.alreadyOpen === true,
    };
  }

  assertCanCreate(requestedUrl) {
    const isVip = resolveVipAccess(this.licenseCache?.getSnapshot?.() || {}).isVip;
    if (!isVip && Number(this.ui.getTabs()?.size || 0) >= FREE_BROWSER_WINDOW_LIMIT) {
      throw new Error(`普通用户最多同时打开 ${FREE_BROWSER_WINDOW_LIMIT} 个独立浏览器窗口，请开通 VIP 后再试`);
    }
    if (typeof this.ui.addTab !== 'function') throw new Error('新建浏览器窗口功能不可用');
    if (requestedUrl && !/^https?:\/\//i.test(requestedUrl)) throw new Error('url 只支持 http/https 网址；留空则使用默认起始页');
  }

  resolveStartUrl(requestedUrl, settings) {
    if (requestedUrl) return requestedUrl;
    return settings.homepage?.mode === 'custom' && settings.homepage?.url
      ? settings.homepage.url
      : DEFAULT_BROWSER_WINDOW_URL;
  }

  async create(args = {}) {
    const requestedUrl = text(args.url);
    this.assertCanCreate(requestedUrl);
    const history = syncOpenTabsToBrowserHistory(this.ui);
    const settings = normalizeAiFreeBrowserSettings(readStoreConfigSafe()?.aiFreeBrowserSettings || {});
    const id = createBrowserHistoryId();
    const name = makeUniqueBrowserName(args.name || DEFAULT_BROWSER_WINDOW_NAME, history);
    const url = this.resolveStartUrl(requestedUrl, settings);
    const record = { id, name, url, runtimeType: 'chromium', settings, createdAt: Date.now(), lastOpenedAt: Date.now() };
    history.push(record);
    if (!writeBrowserHistorySafe(history)) throw new Error('浏览器历史未能写入本地配置');
    try {
      const tabId = await this.ui.addTab(record.url, {
        tabId: `browser-tab-${id.replace(/[^a-z0-9_-]/gi, '_')}`, fixedTitle: record.name,
        browserHistoryId: record.id, runtimeType: 'chromium', browserSettings: record.settings,
        resolveProfileInBackground: true, showLoadingPage: true, focusBrowser: false,
      });
      if (!tabId) throw new Error('新建浏览器窗口失败');
      this.ui.sendToSide?.('browser-history-changed');
      return { success: true, history_id: id, tab_id: String(tabId), name, url };
    } catch (error) {
      writeBrowserHistorySafe(readBrowserHistorySafe().filter((item) => item.id !== id));
      this.ui.sendToSide?.('browser-history-changed');
      throw error;
    }
  }

  async rename(args = {}) {
    const newName = text(args.new_name);
    if (!newName) throw new Error('缺少新名称 new_name');
    const record = this.resolveRecord(args);
    const renamed = renameBrowserHistoryRecord(this.ui, record.id, newName);
    return {
      success: true, history_id: text(renamed.historyId || record.id), name: text(renamed.name || newName),
      previous_name: text(record.name), tab_id: text(renamed.tabId),
    };
  }

  async close(args = {}) {
    const record = this.resolveRecord(args);
    const openTab = this.findOpenTab(record);
    if (!openTab?.id) {
      return { success: true, closed: false, history_id: text(record.id), name: text(record.name), note: '该窗口当前没有打开，记录保持不变' };
    }
    if (typeof this.ui.closeTab !== 'function') throw new Error('当前浏览器窗口无法关闭');
    await this.ui.closeTab(openTab.id);
    this.ui.sendToSide?.('browser-history-changed');
    return { success: true, closed: true, history_id: text(record.id), name: text(record.name), tab_id: text(openTab.id) };
  }

  createApi() {
    const tools = createToolDefinitions();
    const toolNames = new Set(tools.map((tool) => tool.name));
    const handlers = {
      [`${SOFTWARE_WINDOW_TOOL_PREFIX}list`]: this.list.bind(this),
      [`${SOFTWARE_WINDOW_TOOL_PREFIX}open`]: this.open.bind(this),
      [`${SOFTWARE_WINDOW_TOOL_PREFIX}create`]: this.create.bind(this),
      [`${SOFTWARE_WINDOW_TOOL_PREFIX}rename`]: this.rename.bind(this),
      [`${SOFTWARE_WINDOW_TOOL_PREFIX}close`]: this.close.bind(this),
    };
    return {
      tools,
      has: (name) => toolNames.has(text(name)),
      execute: async (name, args = {}) => {
        const toolName = text(name);
        const handler = handlers[toolName];
        if (!handler) throw new Error(`未知的软件窗口工具: ${toolName}`);
        this.logger.log?.(`[AI窗口工具] 执行 ${toolName}`);
        return handler(args && typeof args === 'object' ? args : {});
      },
    };
  }
}

function createAiBrowserWindowTools(deps = {}) {
  return new AiBrowserWindowTools(deps).createApi();
}

module.exports = {
  SOFTWARE_WINDOW_TOOL_PREFIX,
  createAiBrowserWindowTools,
};
