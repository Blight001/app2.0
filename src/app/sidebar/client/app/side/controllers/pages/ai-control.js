(function initAIControlPage() {
  const state = {
    conversations: new Map([['', []]]),
    currentBrowserId: '',
    loading: false,
    quota: null,
    lastQuotaCost: null,
  };

  const el = (id) => document.getElementById(id);

  function currentMessages() {
    if (!state.conversations.has(state.currentBrowserId)) state.conversations.set(state.currentBrowserId, []);
    return state.conversations.get(state.currentBrowserId);
  }

  function setStatus(message, type = 'error') {
    const target = el('ai-chat-status');
    if (target) {
      target.textContent = '';
      target.dataset.type = '';
    }

    const text = String(message || '').trim();
    if (!text) return;

    const modal = window.MessageModal;
    if (type === 'warning' && modal?.showWarningMessage) {
      modal.showWarningMessage(text);
    } else if (type === 'info' && modal?.showInfoMessage) {
      modal.showInfoMessage(text);
    } else if (type === 'success' && modal?.showSuccessMessage) {
      modal.showSuccessMessage(text);
    } else if (modal?.showErrorMessage) {
      modal.showErrorMessage(text);
    } else {
      console.error('[AI 对话]', text);
    }
  }

  function isQuotaFailure(message) {
    return /AI\s*对话额度不足|对话额度不足|额度不足.*联系管理员/.test(String(message || ''));
  }

  function showChatBusinessError(message) {
    const text = String(message || '对话请求失败');
    if (window.MessageModal?.showWarningMessage) {
      window.MessageModal.showWarningMessage(text);
      return;
    }
    setStatus(text);
  }

  function quotaText(quota) {
    if (!quota) return '选择模型后即可开始对话';
    const multiplier = selectedModelMultiplier();
    const tokenBase = selectedTokenBase();
    const multiplierText = multiplier && tokenBase
      ? ` · 每 ${formatQuota(tokenBase)} Token ×${formatQuota(multiplier)}`
      : '';
    const lastCostText = state.lastQuotaCost == null ? '' : ` · 本次消耗 ${formatQuota(state.lastQuotaCost)} 点`;
    if (quota.unlimited) return `对话额度：不限量 · 已使用 ${formatQuota(quota.used)} 点${multiplierText}${lastCostText}`;
    return `对话额度：剩余 ${formatQuota(quota.remaining)} 点 · 已使用 ${formatQuota(quota.used)} / ${formatQuota(quota.quota)} 点${multiplierText}${lastCostText}`;
  }

  function formatQuota(value) {
    const number = Number(value || 0);
    if (Number.isInteger(number)) return String(number);
    return number.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  }

  function selectedModelMultiplier() {
    const option = el('ai-chat-model')?.selectedOptions?.[0];
    const multiplier = Number(option?.dataset?.quotaMultiplier || 0);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 0;
  }

  function selectedTokenBase() {
    const option = el('ai-chat-model')?.selectedOptions?.[0];
    const tokenBase = Number(option?.dataset?.tokensPerQuotaUnit || 0);
    return Number.isFinite(tokenBase) && tokenBase > 0 ? tokenBase : 0;
  }

  function renderQuota(quota) {
    state.quota = quota || null;
    const target = el('ai-chat-quota');
    if (target) target.textContent = quotaText(state.quota);
    syncSendState();
  }

  function appendMessage(role, content, options = {}) {
    const container = el('ai-chat-messages');
    if (!container) return null;
    container.querySelector('.ai-chat-welcome')?.remove();
    const row = document.createElement('div');
    row.className = `ai-chat-message ${role}${options.pending ? ' pending' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble';
    bubble.textContent = content;
    row.appendChild(bubble);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
    return row;
  }

  function renderWelcome() {
    const container = el('ai-chat-messages');
    if (!container) return;
    container.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'ai-chat-welcome';
    const browserText = state.currentBrowserId ? '当前对话只控制所选浏览器。' : '当前未连接浏览器，将进行普通对话。';
    welcome.innerHTML = `<span class="ai-chat-welcome-icon">✦</span><strong>有什么可以帮你？</strong><p>${browserText}</p>`;
    container.appendChild(welcome);
  }

  function renderConversation() {
    const container = el('ai-chat-messages');
    if (!container) return;
    container.innerHTML = '';
    const messages = currentMessages();
    if (!messages.length) {
      renderWelcome();
      return;
    }
    messages.forEach((message) => appendMessage(message.role, message.content));
  }

  function syncSendState() {
    const send = el('ai-chat-send');
    const input = el('ai-chat-input');
    const model = el('ai-chat-model');
    if (send) send.disabled = state.loading || !model?.value || !input?.value.trim();
  }

  async function loadModels() {
    const select = el('ai-chat-model');
    if (!select || !window.electronAPI?.invoke) return;
    select.disabled = true;
    select.innerHTML = '<option value="">正在读取可用模型...</option>';
    setStatus('');
    try {
      const result = await window.electronAPI.invoke('ai-control-get-models');
      if (!result?.ok) throw new Error(result?.message || result?.error || '模型加载失败');
      const models = Array.isArray(result.models) ? result.models : [];
      select.innerHTML = '';
      if (!models.length) {
        select.innerHTML = '<option value="">管理员尚未配置模型</option>';
      } else {
        models.forEach((model) => {
          const option = document.createElement('option');
          option.value = String(model.id || '');
          const multiplier = Number(model.quota_multiplier || 1);
          const tokenBase = Number(model.tokens_per_quota_unit || 10000);
          option.dataset.quotaMultiplier = String(multiplier);
          option.dataset.tokensPerQuotaUnit = String(tokenBase);
          option.textContent = `${String(model.name || model.model || model.id || '未命名模型')}（每 ${formatQuota(tokenBase)} Token ×${formatQuota(multiplier)}）`;
          select.appendChild(option);
        });
        select.disabled = false;
      }
      renderQuota(result.quota);
    } catch (error) {
      select.innerHTML = '<option value="">暂无可用模型</option>';
      renderQuota(null);
      setStatus(error?.message || String(error));
    }
    syncSendState();
  }

  async function redeemGiftCode() {
    const input = el('ai-chat-gift-code');
    const button = el('ai-chat-redeem-gift');
    const code = String(input?.value || '').trim();
    if (!code) {
      setStatus('请输入礼品码', 'warning');
      return;
    }
    if (!window.electronAPI?.invoke) return;
    if (button) button.disabled = true;
    try {
      const result = await window.electronAPI.invoke('ai-control-redeem-gift-code', { code });
      if (!result?.ok) throw new Error(result?.message || result?.error || '礼品码兑换失败');
      if (input) input.value = '';
      state.lastQuotaCost = null;
      renderQuota(result.quota);
      setStatus(result.message || '礼品码兑换成功', 'success');
    } catch (error) {
      setStatus(error?.message || String(error), 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadBrowserConnections() {
    const select = el('ai-chat-browser');
    if (!select || !window.electronAPI?.invoke) return;
    const previous = select.value || state.currentBrowserId;
    try {
      const result = await window.electronAPI.invoke('ai-control-get-browser-connections');
      if (!result?.ok) throw new Error(result?.message || '浏览器连接读取失败');
      const connections = Array.isArray(result.connections) ? result.connections : [];
      select.innerHTML = '<option value="">不连接浏览器</option>';
      connections.forEach((connection) => {
        const option = document.createElement('option');
        option.value = String(connection.id || '');
        const connectionSuffix = String(connection.id || '').slice(0, 6);
        option.textContent = `${String(connection.name || 'AI自动化浏览器')}${connectionSuffix ? ` · ${connectionSuffix}` : ''} · ${Number(connection.toolCount || 0)} 个工具`;
        select.appendChild(option);
      });
      select.value = connections.some((item) => String(item.id) === previous) ? previous : '';
      if (state.currentBrowserId !== select.value) {
        state.currentBrowserId = select.value;
        renderConversation();
      }
      select.title = connections.length ? `已连接 ${connections.length} 个浏览器插件` : '未发现浏览器插件，请确认扩展和 AI-FREE 已启动';
    } catch (error) {
      select.innerHTML = '<option value="">未发现浏览器插件</option>';
      state.currentBrowserId = '';
      renderConversation();
      console.warn('[AI 控制] 浏览器连接读取失败:', error?.message || error);
    }
  }

  function resizeInput() {
    const input = el('ai-chat-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  }

  function reclaimAiInputFocus(input) {
    if (!input) return;
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    if (!window.electronAPI?.invoke) return;
    void window.electronAPI.invoke('focus-sidebar-input').then(() => {
      requestAnimationFrame(() => {
        try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
      });
    }).catch((error) => {
      console.warn('[AI 控制] 恢复输入框焦点失败:', error?.message || error);
    });
  }

  function openPersonalLogin() {
    const personalTab = document.querySelector('[data-tab="personal-center-panel"]');
    if (personalTab) {
      personalTab.click();
    } else {
      document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
      el('personal-center-panel')?.classList.add('active');
    }
    document.querySelector('[data-auth-mode="login"]')?.click();
    window.MessageModal?.showWarningMessage?.('请先登录');
  }

  async function ensureAuthenticatedForChat() {
    try {
      const session = await window.electronAPI?.invoke?.('account-get-session');
      if (session?.authenticated === true) return true;
    } catch (_) {}
    openPersonalLogin();
    return false;
  }

  async function sendMessage() {
    if (state.loading) return;
    const input = el('ai-chat-input');
    const select = el('ai-chat-model');
    const content = String(input?.value || '').trim();
    if (!content || !select?.value) return;

    // 登录校验必须发生在写入对话和调用 AI 接口之前，未登录时仅切换栏目并显示本地弹窗。
    if (!await ensureAuthenticatedForChat()) return;

    const messages = currentMessages();
    messages.push({ role: 'user', content });
    const userRow = appendMessage('user', content);
    input.value = '';
    resizeInput();
    state.loading = true;
    setStatus('');
    syncSendState();
    const pending = appendMessage('assistant', '正在思考…', { pending: true });

    try {
      const result = await window.electronAPI.invoke('ai-control-chat', {
        modelId: select.value,
        messages,
        browserConnectionId: state.currentBrowserId,
      });
      pending?.remove();
      if (!result?.ok) {
        const failureMessage = String(result?.message || result?.error || '对话请求失败');
        if (/请先.*登录|未登录/.test(failureMessage)) {
          messages.pop();
          openPersonalLogin();
          return;
        }
        if (isQuotaFailure(failureMessage)) {
          messages.pop();
          userRow?.remove();
          if (!messages.length) renderWelcome();
          if (result?.quota) renderQuota(result.quota);
          showChatBusinessError(failureMessage);
          return;
        }
        throw new Error(failureMessage);
      }
      const reply = String(result.message?.content || '').trim();
      messages.push({ role: 'assistant', content: reply });
      appendMessage('assistant', reply || '模型未返回内容');
      state.lastQuotaCost = result.quota_cost ?? result.quota_cost_increment ?? null;
      renderQuota(result.quota);
    } catch (error) {
      pending?.remove();
      messages.pop();
      const failureMessage = error?.message || String(error);
      if (isQuotaFailure(failureMessage)) {
        userRow?.remove();
        if (!messages.length) renderWelcome();
        showChatBusinessError(failureMessage);
      } else {
        setStatus(failureMessage);
      }
    } finally {
      state.loading = false;
      syncSendState();
      input?.focus();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    el('ai-chat-refresh-models')?.addEventListener('click', () => {
      loadModels();
      loadBrowserConnections();
    });
    el('ai-chat-redeem-gift')?.addEventListener('click', redeemGiftCode);
    el('ai-chat-gift-code')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        redeemGiftCode();
      }
    });
    el('ai-chat-model')?.addEventListener('change', () => {
      state.lastQuotaCost = null;
      renderQuota(state.quota);
      syncSendState();
    });
    el('ai-chat-browser')?.addEventListener('change', (event) => {
      state.currentBrowserId = String(event.target?.value || '');
      renderConversation();
      syncSendState();
    });
    el('ai-chat-clear')?.addEventListener('click', () => {
      state.conversations.set(state.currentBrowserId, []);
      state.lastQuotaCost = null;
      setStatus('');
      renderWelcome();
      el('ai-chat-input')?.focus();
    });
    el('ai-chat-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });
    const chatInput = el('ai-chat-input');
    chatInput?.addEventListener('pointerdown', () => reclaimAiInputFocus(chatInput));
    chatInput?.addEventListener('input', () => {
      resizeInput();
      syncSendState();
    });
    chatInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    document.querySelector('[data-tab="ai-control-panel"]')?.addEventListener('click', () => {
      loadModels();
      loadBrowserConnections();
    });
    window.electronAPI?.on?.('account-session-updated', () => {
      loadModels();
      loadBrowserConnections();
    });
    loadModels();
    loadBrowserConnections();
    window.setInterval(loadBrowserConnections, 4000);
  });
})();
