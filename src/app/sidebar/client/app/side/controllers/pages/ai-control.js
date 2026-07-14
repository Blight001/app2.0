(function initAIControlPage() {
  const state = { messages: [], loading: false, quota: null };

  const el = (id) => document.getElementById(id);

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
    if (quota.unlimited) return `对话额度：不限量 · 已使用 ${quota.used || 0} 次`;
    return `对话额度：剩余 ${quota.remaining || 0} 次 · 已使用 ${quota.used || 0} / ${quota.quota || 0}`;
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
    welcome.innerHTML = '<span class="ai-chat-welcome-icon">✦</span><strong>有什么可以帮你？</strong><p>选择管理员配置的模型，然后开始对话。</p>';
    container.appendChild(welcome);
  }

  function syncSendState() {
    const send = el('ai-chat-send');
    const input = el('ai-chat-input');
    const model = el('ai-chat-model');
    const hasQuota = !state.quota || state.quota.unlimited || Number(state.quota.remaining) > 0;
    if (send) send.disabled = state.loading || !model?.value || !hasQuota || !input?.value.trim();
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
          option.textContent = String(model.name || model.model || model.id || '未命名模型');
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

  function resizeInput() {
    const input = el('ai-chat-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
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

    state.messages.push({ role: 'user', content });
    appendMessage('user', content);
    input.value = '';
    resizeInput();
    state.loading = true;
    setStatus('');
    syncSendState();
    const pending = appendMessage('assistant', '正在思考…', { pending: true });

    try {
      const result = await window.electronAPI.invoke('ai-control-chat', {
        modelId: select.value,
        messages: state.messages,
      });
      pending?.remove();
      if (!result?.ok) {
        const failureMessage = String(result?.message || result?.error || '对话请求失败');
        if (/请先.*登录|未登录/.test(failureMessage)) {
          state.messages.pop();
          openPersonalLogin();
          return;
        }
        if (isQuotaFailure(failureMessage)) {
          state.messages.pop();
          if (result?.quota) renderQuota(result.quota);
          showChatBusinessError(failureMessage);
          return;
        }
        throw new Error(failureMessage);
      }
      const reply = String(result.message?.content || '').trim();
      state.messages.push({ role: 'assistant', content: reply });
      appendMessage('assistant', reply || '模型未返回内容');
      renderQuota(result.quota);
    } catch (error) {
      pending?.remove();
      state.messages.pop();
      const failureMessage = error?.message || String(error);
      if (isQuotaFailure(failureMessage)) {
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
    el('ai-chat-refresh-models')?.addEventListener('click', loadModels);
    el('ai-chat-model')?.addEventListener('change', syncSendState);
    el('ai-chat-clear')?.addEventListener('click', () => {
      state.messages = [];
      setStatus('');
      renderWelcome();
      el('ai-chat-input')?.focus();
    });
    el('ai-chat-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });
    el('ai-chat-input')?.addEventListener('input', () => {
      resizeInput();
      syncSendState();
    });
    el('ai-chat-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    document.querySelector('[data-tab="ai-control-panel"]')?.addEventListener('click', loadModels);
    window.electronAPI?.on?.('account-session-updated', () => loadModels());
    loadModels();
  });
})();
