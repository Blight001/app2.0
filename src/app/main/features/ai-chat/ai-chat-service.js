'use strict';

const { createAiBrowserWindowTools } = require('../../services/ai-browser-window-tools');
const { createChatRunRegistry } = require('./chat-run-registry');
const { prepareChatRequest } = require('./chat-request-context');
const { runChatConversation } = require('./chat-conversation-runner');

function createAiChatService(deps = {}) {
  const {
    readStoreConfigSafe,
    licenseCache,
    logger = console,
  } = deps;
    const chatRuns = createChatRunRegistry();

    // 软件端默认的"外层"浏览器窗口控制工具：不依赖任何浏览器插件连接，
    // 每次对话都会注入，让 AI 能列出/打开/新建/重命名/关闭软件的浏览器窗口。
    let aiBrowserWindowTools = null;
    const getAiBrowserWindowTools = () => {
      if (aiBrowserWindowTools) return aiBrowserWindowTools;
      if (!deps.browserWindowUi) return null;
      try {
        aiBrowserWindowTools = createAiBrowserWindowTools({
          ui: deps.browserWindowUi,
          licenseCache,
          logger,
        });
      } catch (error) {
        logger.warn?.('[AI窗口工具] 初始化失败:', error?.message || error);
      }
      return aiBrowserWindowTools;
    };

    async function insert(_event, input = {}) {
      const requestId = String(input.requestId || '').trim();
      const content = String(input.content || '').trim().slice(0, 12000);
      if (!requestId || !content) return { ok: false, message: '缺少要插入的对话内容' };
      return chatRuns.insert(_event, requestId, content);
    }

    async function stop(_event, input = {}) {
      const requestId = String(input.requestId || '').trim();
      return chatRuns.stop(_event, requestId);
    }

    async function chat(_event, input = {}) {
      let activeRun = null;
      let activeRunKey = '';
      try {
        const request = prepareChatRequest(deps, _event, input, chatRuns, getAiBrowserWindowTools);
        activeRunKey = request.key || '';
        activeRun = request.run || null;
        if (request.error) return request.error;
        return await runChatConversation(request, readStoreConfigSafe);
      } catch (error) {
        if (activeRun?.stopped || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
          return { ok: true, stopped: true, messages: [], message: { role: 'assistant', content: '' } };
        }
        return { ok: false, message: error?.message || String(error) };
      } finally {
        chatRuns.finish(activeRunKey, activeRun);
      }
    }

    return { chat, getWindowTools: getAiBrowserWindowTools, insert, stop };
}

module.exports = { createAiChatService };
