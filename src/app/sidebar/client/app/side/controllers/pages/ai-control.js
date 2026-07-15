(function initAIControlPage() {
  const state = {
    messages: [],
    sessionList: [],
    currentSession: null,
    currentBrowserId: '',
    browserSelectionExplicitlyDisabled: false,
    accountAuthenticated: false,
    loading: false,
    generatingTitle: false,
    quota: null,
    lastQuotaCost: null,
    mcpCallLimit: 100,
    mcpCallLimitDraft: '100',
    mcpCallLimitMin: 1,
    mcpCallLimitMax: 1000,
    mcpSettingsLoaded: false,
    mcpSettingsLoading: false,
    mcpSettingsSaving: false,
    mcpSettingsStatus: '',
    mcpSettingsStatusType: '',
  };

  const HISTORY_LS_PREFIX = 'ai-free.ai-chat-history.v1.';
  const el = (id) => document.getElementById(id);

  function currentMessages() {
    return state.messages;
  }

  function makeSessionId() {
    try {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch (_) {}
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function historyLocalScope() {
    const username = String(el('account-username-display')?.value || '').trim();
    const deviceId = String(el('device-id')?.value || '').trim();
    return username || deviceId || 'local';
  }

  function readLocalHistoryStore() {
    try {
      const raw = localStorage.getItem(HISTORY_LS_PREFIX + historyLocalScope());
      if (!raw) return { version: 1, sessions: [], currentId: '' };
      const data = JSON.parse(raw);
      return {
        version: 1,
        sessions: Array.isArray(data?.sessions) ? data.sessions : [],
        currentId: String(data?.currentId || ''),
      };
    } catch (_) {
      return { version: 1, sessions: [], currentId: '' };
    }
  }

  function writeLocalHistoryStore(store) {
    try {
      localStorage.setItem(HISTORY_LS_PREFIX + historyLocalScope(), JSON.stringify({
        version: 1,
        sessions: Array.isArray(store?.sessions) ? store.sessions : [],
        currentId: String(store?.currentId || ''),
      }));
      return true;
    } catch (error) {
      console.warn('[AI 控制] localStorage 历史写入失败:', error?.message || error);
      return false;
    }
  }

  function sessionSummaryLocal(session) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    return {
      id: String(session?.id || ''),
      title: String(session?.title || '新对话'),
      titleGenerated: session?.titleGenerated === true,
      modelId: String(session?.modelId || ''),
      browserConnectionId: String(session?.browserConnectionId || ''),
      preview: String(session?.preview || ''),
      messageCount: messages.length,
      createdAt: Number(session?.createdAt) || Date.now(),
      updatedAt: Number(session?.updatedAt) || Date.now(),
    };
  }

  function upsertLocalSession(session) {
    if (!session?.id) return;
    const store = readLocalHistoryStore();
    const next = {
      ...session,
      messages: Array.isArray(session.messages) ? session.messages : [],
      updatedAt: Date.now(),
    };
    // 对话内容被全部撤回/删除后，也要清掉之前落盘的旧记录。
    if (!next.messages.length) {
      deleteLocalSession(next.id);
      return;
    }
    const index = store.sessions.findIndex((item) => String(item.id) === String(next.id));
    if (index >= 0) store.sessions[index] = next;
    else store.sessions.unshift(next);
    store.sessions = store.sessions
      .filter((item) => Array.isArray(item.messages) && item.messages.length)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      .slice(0, 80);
    store.currentId = next.id;
    writeLocalHistoryStore(store);
  }

  function deleteLocalSession(sessionId) {
    const store = readLocalHistoryStore();
    const id = String(sessionId || '');
    store.sessions = store.sessions.filter((item) => String(item.id) !== id);
    if (store.currentId === id) store.currentId = store.sessions[0]?.id || '';
    writeLocalHistoryStore(store);
    return store;
  }

  function renameLocalSession(sessionId, title) {
    const store = readLocalHistoryStore();
    const id = String(sessionId || '');
    const session = store.sessions.find((item) => String(item.id) === id);
    if (!session) return null;
    session.title = String(title || '').trim().slice(0, 40);
    session.titleGenerated = true;
    writeLocalHistoryStore(store);
    return session;
  }

  function getLocalSession(sessionId) {
    const store = readLocalHistoryStore();
    const found = store.sessions.find((item) => String(item.id) === String(sessionId || ''));
    if (!found) return null;
    store.currentId = found.id;
    writeLocalHistoryStore(store);
    return found;
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

  function confirmDestructiveAction(message, onConfirm) {
    const run = async () => {
      try {
        await onConfirm();
      } catch (error) {
        setStatus(error?.message || String(error), 'warning');
      }
    };
    const modal = window.MessageModal;
    if (modal?.showConfirmDialog) {
      modal.showConfirmDialog(message, run, null, 'warning');
      return;
    }
    // 弹窗模块尚未就绪时保留浏览器原生确认，避免无确认直接执行破坏性操作。
    if (typeof window.confirm === 'function' && window.confirm(message)) {
      void run();
    }
  }

  function isQuotaFailure(message) {
    return /AI\s*对话额度(?:不足|已用尽)|对话额度(?:不足|已用尽)|额度(?:不足|已用尽).*联系管理员/.test(String(message || ''));
  }

  function isQuotaExhausted(quota = state.quota) {
    if (!quota || quota.unlimited === true) return false;
    const total = Number(quota.quota);
    const used = Number(quota.used || 0);
    const remaining = Number(quota.remaining ?? (total - used));
    return Number.isFinite(remaining) && remaining <= 0;
  }

  function showChatBusinessError(message) {
    const text = String(message || '对话请求失败');
    if (window.MessageModal?.showWarningMessage) {
      window.MessageModal.showWarningMessage(text);
      return;
    }
    setStatus(text);
  }

  function formatQuota(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return '0';
    if (Number.isInteger(number)) return String(number);
    return number.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  }

  function selectedModelMultiplier() {
    const option = el('ai-chat-model')?.selectedOptions?.[0];
    const multiplier = Number(option?.dataset?.quotaMultiplier || 0);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 0;
  }

  function provisionalTitle(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '新对话';
    return cleaned.slice(0, 20) + (cleaned.length > 20 ? '…' : '');
  }

  function sanitizeGeneratedTitle(raw) {
    let title = String(raw || '').trim();
    title = title.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    title = title
      .replace(/^["'「『【\[]+|["'」』】\]]+$/g, '')
      .replace(/^(标题|题目)[:：\s]*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) return '';
    return title.slice(0, 24);
  }

  function formatRelativeTime(ts) {
    const time = Number(ts) || 0;
    if (!time) return '';
    const diff = Date.now() - time;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)} 天前`;
    try {
      return new Date(time).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return '';
    }
  }

  /* ---------------- 自定义下拉 ---------------- */
  function getSelectShell(select) {
    return select?.closest?.('.ai-select') || null;
  }

  function closeAllSelects(exceptShell = null) {
    document.querySelectorAll('.ai-select.open').forEach((shell) => {
      if (exceptShell && shell === exceptShell) return;
      closeSelect(shell);
    });
  }

  function closeSelect(shell) {
    if (!shell) return;
    shell.classList.remove('open');
    const trigger = shell.querySelector('.ai-select-trigger');
    const menu = shell.querySelector('.ai-select-menu');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  }

  function openSelect(shell) {
    if (!shell) return;
    const trigger = shell.querySelector('.ai-select-trigger');
    const menu = shell.querySelector('.ai-select-menu');
    const select = shell.querySelector('select');
    if (!trigger || !menu) return;
    // 历史下拉无 native select；其余下拉依赖 native select 状态
    if (select && (select.disabled || trigger.disabled)) return;
    if (!select && trigger.disabled) return;
    closeAllSelects(shell);
    shell.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    const selected = menu.querySelector('[aria-selected="true"]');
    (selected || menu.querySelector('.ai-select-option'))?.focus?.();
  }

  function optionDisplayText(option) {
    if (!option) return '';
    const name = String(option.textContent || '');
    const multiplier = option.dataset?.quotaMultiplier;
    if (!multiplier) return name;
    return `${name} ×${formatQuota(multiplier)}`;
  }

  function updateBrowserMcpSettingUi() {
    const input = el('ai-browser-mcp-call-limit');
    const button = el('ai-browser-mcp-call-limit-save');
    const status = el('ai-browser-mcp-call-limit-status');
    if (input) {
      input.min = String(state.mcpCallLimitMin);
      input.max = String(state.mcpCallLimitMax);
      if (document.activeElement !== input) input.value = state.mcpCallLimitDraft;
      input.disabled = state.mcpSettingsLoading || state.mcpSettingsSaving;
    }
    if (button) {
      button.disabled = state.mcpSettingsLoading || state.mcpSettingsSaving;
      button.textContent = state.mcpSettingsSaving ? '保存中' : '保存';
    }
    if (status) {
      status.textContent = state.mcpSettingsLoading ? '读取中…' : state.mcpSettingsStatus;
      status.dataset.type = state.mcpSettingsStatusType;
    }
  }

  async function loadAiControlSettings() {
    if (state.mcpSettingsLoading || state.mcpSettingsLoaded || !window.electronAPI?.invoke) return;
    state.mcpSettingsLoading = true;
    state.mcpSettingsStatus = '';
    state.mcpSettingsStatusType = '';
    updateBrowserMcpSettingUi();
    try {
      const response = await window.electronAPI.invoke('get-ai-control-settings');
      if (!response?.ok) throw new Error(response?.error || '读取 MCP 设置失败');
      const min = Number(response?.limits?.mcpCallLimit?.min);
      const max = Number(response?.limits?.mcpCallLimit?.max);
      const value = Number(response?.settings?.mcpCallLimit);
      if (Number.isFinite(min)) state.mcpCallLimitMin = min;
      if (Number.isFinite(max)) state.mcpCallLimitMax = max;
      if (Number.isFinite(value)) {
        state.mcpCallLimit = value;
        state.mcpCallLimitDraft = String(value);
      }
      state.mcpSettingsLoaded = true;
    } catch (error) {
      state.mcpSettingsStatus = error?.message || String(error);
      state.mcpSettingsStatusType = 'error';
    } finally {
      state.mcpSettingsLoading = false;
      updateBrowserMcpSettingUi();
    }
  }

  async function saveAiControlSettings() {
    const input = el('ai-browser-mcp-call-limit');
    if (!input || state.mcpSettingsSaving || !window.electronAPI?.invoke) return;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < state.mcpCallLimitMin || value > state.mcpCallLimitMax) {
      state.mcpSettingsStatus = `请输入 ${state.mcpCallLimitMin}–${state.mcpCallLimitMax} 的整数`;
      state.mcpSettingsStatusType = 'error';
      updateBrowserMcpSettingUi();
      input.focus();
      return;
    }
    state.mcpSettingsSaving = true;
    state.mcpSettingsStatus = '';
    state.mcpSettingsStatusType = '';
    updateBrowserMcpSettingUi();
    try {
      const response = await window.electronAPI.invoke('set-ai-control-settings', { mcpCallLimit: value });
      if (!response?.ok) throw new Error(response?.error || '保存 MCP 设置失败');
      state.mcpCallLimit = Number(response?.settings?.mcpCallLimit) || value;
      state.mcpCallLimitDraft = String(state.mcpCallLimit);
      state.mcpSettingsLoaded = true;
      state.mcpSettingsStatus = '已保存';
      state.mcpSettingsStatusType = 'success';
    } catch (error) {
      state.mcpSettingsStatus = error?.message || String(error);
      state.mcpSettingsStatusType = 'error';
    } finally {
      state.mcpSettingsSaving = false;
      updateBrowserMcpSettingUi();
    }
  }

  function appendBrowserMcpSetting(menu) {
    const item = document.createElement('li');
    item.className = 'ai-browser-mcp-setting';

    const label = document.createElement('label');
    label.htmlFor = 'ai-browser-mcp-call-limit';
    label.textContent = 'MCP 调用上限';

    const editor = document.createElement('div');
    editor.className = 'ai-browser-mcp-setting-editor';
    const input = document.createElement('input');
    input.id = 'ai-browser-mcp-call-limit';
    input.type = 'number';
    input.step = '1';
    input.inputMode = 'numeric';
    input.value = state.mcpCallLimitDraft;
    input.setAttribute('aria-label', 'MCP 调用上限');
    input.addEventListener('input', () => {
      state.mcpCallLimitDraft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      void saveAiControlSettings();
    });
    const unit = document.createElement('span');
    unit.textContent = '次';
    const button = document.createElement('button');
    button.id = 'ai-browser-mcp-call-limit-save';
    button.type = 'button';
    button.textContent = '保存';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void saveAiControlSettings();
    });
    editor.append(input, unit, button);

    const status = document.createElement('span');
    status.id = 'ai-browser-mcp-call-limit-status';
    status.className = 'ai-browser-mcp-setting-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    item.append(label, editor, status);
    menu.appendChild(item);
    updateBrowserMcpSettingUi();
  }

  function syncSelectUi(select) {
    const shell = getSelectShell(select);
    if (!shell || !select) return;
    const trigger = shell.querySelector('.ai-select-trigger');
    const valueEl = shell.querySelector('.ai-select-value');
    const menu = shell.querySelector('.ai-select-menu');
    if (!trigger || !valueEl || !menu) return;

    const disabled = !!select.disabled;
    trigger.disabled = disabled;

    const options = Array.from(select.options || []);
    const selected = options.find((opt) => opt.selected) || options[0] || null;
    valueEl.textContent = optionDisplayText(selected);
    if (shell.dataset.aiSelect === 'browser') {
      shell.classList.toggle('has-selection', Boolean(select.value));
      trigger.title = selected?.textContent || '选择浏览器插件';
    }

    const activeBrowserSetting = shell.dataset.aiSelect === 'browser'
      && document.activeElement?.closest?.('.ai-browser-mcp-setting');
    if (activeBrowserSetting) {
      updateBrowserMcpSettingUi();
      return;
    }
    const existingMcpInput = shell.dataset.aiSelect === 'browser'
      ? menu.querySelector('#ai-browser-mcp-call-limit')
      : null;
    if (existingMcpInput) state.mcpCallLimitDraft = existingMcpInput.value;
    menu.innerHTML = '';
    if (shell.dataset.aiSelect === 'browser') appendBrowserMcpSetting(menu);
    options.forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ai-select-option';
      item.role = 'option';
      item.dataset.value = option.value;
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      if (option.disabled) {
        item.disabled = true;
        item.setAttribute('aria-disabled', 'true');
      }

      const label = document.createElement('span');
      label.className = 'ai-select-option-label';
      label.textContent = option.textContent || '';
      item.appendChild(label);

      const multiplier = option.dataset?.quotaMultiplier;
      if (multiplier) {
        const meta = document.createElement('span');
        meta.className = 'ai-select-option-meta';
        meta.textContent = `×${formatQuota(multiplier)}`;
        item.appendChild(meta);
      }

      item.addEventListener('click', (event) => {
        event.preventDefault();
        if (item.disabled) return;
        const next = String(item.dataset.value ?? '');
        if (select.value !== next) {
          select.value = next;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          syncSelectUi(select);
        }
        closeSelect(shell);
      });

      menu.appendChild(item);
    });
  }

  function bindSelectShell(shell) {
    if (!shell || shell.dataset.bound === '1') return;
    shell.dataset.bound = '1';
    const select = shell.querySelector('select');
    const trigger = shell.querySelector('.ai-select-trigger');
    const menu = shell.querySelector('.ai-select-menu');
    if (!select || !trigger || !menu) return;

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (trigger.disabled || select.disabled) return;
      if (shell.classList.contains('open')) closeSelect(shell);
      else {
        openSelect(shell);
        if (shell.dataset.aiSelect === 'browser') void loadAiControlSettings();
      }
    });

    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSelect(shell);
      } else if (event.key === 'Escape') {
        closeSelect(shell);
      }
    });

    menu.addEventListener('keydown', (event) => {
      const items = Array.from(menu.querySelectorAll('.ai-select-option:not([disabled])'));
      if (!items.length) return;
      const current = document.activeElement;
      const index = items.indexOf(current);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[Math.min(items.length - 1, Math.max(0, index) + 1)]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[Math.max(0, (index < 0 ? items.length : index) - 1)]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSelect(shell);
        trigger.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    });

    select.addEventListener('change', () => syncSelectUi(select));
    syncSelectUi(select);
  }

  function bindHistorySelectShell() {
    const shell = el('ai-chat-history-select');
    if (!shell || shell.dataset.bound === '1') return;
    shell.dataset.bound = '1';
    const trigger = shell.querySelector('.ai-select-trigger');
    const menu = shell.querySelector('.ai-select-menu');
    if (!trigger || !menu) return;

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (shell.classList.contains('open')) {
        closeSelect(shell);
      } else {
        void refreshHistoryList().finally(() => openSelect(shell));
      }
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void refreshHistoryList().finally(() => openSelect(shell));
      } else if (event.key === 'Escape') {
        closeSelect(shell);
      }
    });
  }

  function initCustomSelects() {
    document.querySelectorAll('.ai-select').forEach((shell) => {
      // 历史下拉没有 native select，单独绑定
      if (shell.dataset.aiSelect === 'history' || shell.id === 'ai-chat-history-select') return;
      bindSelectShell(shell);
    });
    bindHistorySelectShell();
    document.addEventListener('pointerdown', (event) => {
      const shell = event.target?.closest?.('.ai-select');
      if (!shell) closeAllSelects();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAllSelects();
    });
  }

  /* ---------------- 额度圆环 ---------------- */
  function renderQuota(quota) {
    state.quota = window.AiFreeQuotaDisplay?.normalizeAIQuota?.(quota) || quota || null;
    window.renderAccountAiUsage?.(state.quota);
    const widget = el('ai-chat-quota');
    const ring = el('ai-chat-quota-ring');
    const valueEl = el('ai-chat-quota-value');
    if (!widget || !ring || !valueEl) return;

    const lastCost = state.lastQuotaCost == null ? '' : ` · 本次 ${formatQuota(state.lastQuotaCost)}`;
    const multiplier = selectedModelMultiplier();
    const multiplierTip = multiplier ? ` · 倍率 ×${formatQuota(multiplier)}` : '';

    if (!state.quota) {
      ring.style.setProperty('--quota-progress', '0%');
      valueEl.textContent = '--';
      widget.title = '选择模型后即可开始对话';
      syncSendState();
      return;
    }

    if (state.quota.unlimited) {
      ring.style.setProperty('--quota-progress', '100%');
      valueEl.textContent = '∞';
      widget.title = `对话额度：不限量 · 已使用 ${formatQuota(state.quota.used)} 点${multiplierTip}${lastCost}`;
      syncSendState();
      return;
    }

    const total = Math.max(0, Number(state.quota.quota) || 0);
    const remaining = Math.max(0, Number(state.quota.remaining ?? (total - Number(state.quota.used || 0))));
    const percent = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
    ring.style.setProperty('--quota-progress', `${percent}%`);
    valueEl.textContent = `${Math.round(percent)}`;
    widget.title = `剩余 ${formatQuota(remaining)} / ${formatQuota(total)} 点 · 已使用 ${formatQuota(state.quota.used)}${multiplierTip}${lastCost}`;
    syncSendState();
  }

  /* ---------------- 对话历史（下拉） ---------------- */
  function currentSessionTitle() {
    return String(state.currentSession?.title || '新对话');
  }

  function updateSessionTitleUi() {
    const valueEl = el('ai-chat-history-value');
    const trigger = el('ai-chat-history-trigger');
    const title = currentSessionTitle();
    if (valueEl) valueEl.textContent = title;
    if (trigger) trigger.title = title;
  }

  function renderHistoryList() {
    const menu = el('ai-chat-history-menu');
    const shell = el('ai-chat-history-select');
    if (!menu) return;
    updateSessionTitleUi();
    menu.innerHTML = '';

    const sessions = Array.isArray(state.sessionList) ? state.sessionList : [];
    const currentId = String(state.currentSession?.id || '');
    const hasCurrentInList = sessions.some((item) => String(item.id) === currentId);

    // 顶部固定：新建对话
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'ai-select-option-new';
    newBtn.setAttribute('role', 'option');
    newBtn.innerHTML = '<span class="ai-select-option-new-icon" aria-hidden="true">+</span><span>新建对话</span>';
    newBtn.addEventListener('click', (event) => {
      event.preventDefault();
      closeSelect(shell);
      void startNewConversation();
    });
    menu.appendChild(newBtn);

    const divider = document.createElement('div');
    divider.className = 'ai-select-option-divider';
    divider.setAttribute('role', 'separator');
    menu.appendChild(divider);

    // 当前草稿（尚未出现在历史列表）
    if (currentId && !hasCurrentInList && currentMessages().length) {
      const draft = document.createElement('button');
      draft.type = 'button';
      draft.className = 'ai-select-option ai-select-option-history';
      draft.setAttribute('aria-selected', 'true');
      draft.innerHTML = `
        <span class="ai-select-option-label">
          <span></span>
          <span class="ai-select-option-sub">当前对话</span>
        </span>
      `;
      draft.querySelector('.ai-select-option-label > span').textContent = currentSessionTitle();
      draft.addEventListener('click', (event) => {
        event.preventDefault();
        closeSelect(shell);
      });
      menu.appendChild(draft);
    }

    if (!sessions.length && !(currentId && !hasCurrentInList && currentMessages().length)) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'ai-select-option';
      empty.disabled = true;
      empty.textContent = '暂无历史对话';
      menu.appendChild(empty);
      return;
    }

    sessions.forEach((session) => {
      const item = document.createElement('div');
      item.className = 'ai-select-option ai-select-option-history';
      item.setAttribute('aria-selected', String(session.id) === currentId ? 'true' : 'false');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'ai-select-option-label';
      main.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:0;min-width:0;width:100%;';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = session.title || '新对话';
      const sub = document.createElement('span');
      sub.className = 'ai-select-option-sub';
      const metaParts = [
        formatRelativeTime(session.updatedAt),
        session.messageCount ? `${session.messageCount} 条` : '',
      ].filter(Boolean);
      sub.textContent = metaParts.join(' · ') || session.preview || '历史对话';
      main.appendChild(titleSpan);
      main.appendChild(sub);
      main.addEventListener('click', (event) => {
        event.preventDefault();
        closeSelect(shell);
        if (String(session.id) !== currentId) void loadSessionById(session.id);
      });

      const actions = document.createElement('div');
      actions.className = 'ai-select-option-actions';

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'ai-select-option-action ai-select-option-rename';
      rename.title = '重命名';
      rename.setAttribute('aria-label', '重命名对话');
      rename.textContent = '✎';
      rename.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        renameSessionById(session.id);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-select-option-action ai-select-option-del';
      del.title = '删除';
      del.setAttribute('aria-label', '删除对话');
      del.textContent = '×';
      del.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void deleteSessionById(session.id);
      });

      actions.append(rename, del);
      item.appendChild(main);
      item.appendChild(actions);
      menu.appendChild(item);
    });
  }

  function mergeSessionLists(primary, secondary) {
    const map = new Map();
    [...(primary || []), ...(secondary || [])].forEach((item) => {
      if (!item?.id) return;
      const prev = map.get(item.id);
      if (!prev || (Number(item.updatedAt) || 0) >= (Number(prev.updatedAt) || 0)) {
        map.set(item.id, item);
      }
    });
    return Array.from(map.values()).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  }

  async function refreshHistoryList() {
    const localStore = readLocalHistoryStore();
    const localSummaries = (localStore.sessions || [])
      .filter((item) => Array.isArray(item.messages) && item.messages.length)
      .map(sessionSummaryLocal);

    let remote = [];
    if (window.electronAPI?.invoke) {
      try {
        const result = await window.electronAPI.invoke('ai-control-history-list');
        if (result?.ok) remote = Array.isArray(result.sessions) ? result.sessions : [];
      } catch (error) {
        console.warn('[AI 控制] 读取历史失败:', error?.message || error);
      }
    }
    state.sessionList = mergeSessionLists(remote, localSummaries);
    renderHistoryList();
  }

  async function persistCurrentSession(extra = {}) {
    const modelId = String(el('ai-chat-model')?.value || state.currentSession?.modelId || '');
    if (!state.currentSession?.id) {
      state.currentSession = {
        id: makeSessionId(),
        title: '新对话',
        titleGenerated: false,
        modelId,
        browserConnectionId: state.currentBrowserId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    const payload = {
      id: state.currentSession.id,
      title: state.currentSession.title || '新对话',
      titleGenerated: state.currentSession.titleGenerated === true,
      modelId,
      browserConnectionId: state.currentBrowserId,
      messages: currentMessages(),
      createdAt: state.currentSession.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...extra,
    };

    // 1) 本地备份（始终写）
    upsertLocalSession(payload);

    // 2) 主进程持久化
    if (window.electronAPI?.invoke) {
      try {
        const result = await window.electronAPI.invoke('ai-control-history-save', {
          session: payload,
          setCurrent: true,
        });
        if (result?.ok && result.session) {
          state.currentSession = {
            ...result.session,
            messages: Array.isArray(result.session.messages) ? result.session.messages : payload.messages,
          };
          // 不强制覆盖内存中正在进行的 messages 引用，除非服务端返回了更完整列表
          if (Array.isArray(result.session.messages) && result.session.messages.length >= payload.messages.length) {
            state.messages = result.session.messages;
          }
          updateSessionTitleUi();
          await refreshHistoryList();
          return result.session;
        }
        if (result && result.ok === false) {
          console.warn('[AI 控制] 主进程保存历史失败:', result.message || result);
        }
      } catch (error) {
        console.warn('[AI 控制] 保存历史失败:', error?.message || error);
      }
    }

    // 主进程失败时仍用本地数据刷新列表
    state.currentSession = { ...state.currentSession, ...payload };
    updateSessionTitleUi();
    await refreshHistoryList();
    return payload;
  }

  function applySession(session) {
    state.currentSession = session || null;
    state.messages = Array.isArray(session?.messages) ? [...session.messages] : [];
    state.currentBrowserId = String(session?.browserConnectionId || state.currentBrowserId || '');
    const browserSelect = el('ai-chat-browser');
    if (browserSelect) {
      const exists = Array.from(browserSelect.options).some((opt) => opt.value === state.currentBrowserId);
      browserSelect.value = exists ? state.currentBrowserId : '';
      if (!exists) state.currentBrowserId = '';
      if (state.currentBrowserId) state.browserSelectionExplicitlyDisabled = false;
      syncSelectUi(browserSelect);
    }
    const modelSelect = el('ai-chat-model');
    if (modelSelect && session?.modelId) {
      const hasModel = Array.from(modelSelect.options).some((opt) => opt.value === session.modelId);
      if (hasModel) {
        modelSelect.value = session.modelId;
        syncSelectUi(modelSelect);
      }
    }
    updateSessionTitleUi();
    renderConversation();
    renderHistoryList();
    syncSendState();
  }

  async function loadSessionById(sessionId, options = {}) {
    if (!sessionId || state.loading) return false;
    try {
      // 切换前先保存当前
      if (!options.skipSaveCurrent && currentMessages().length
        && state.currentSession?.id && state.currentSession.id !== sessionId) {
        await persistCurrentSession();
      }

      let session = null;
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('ai-control-history-get', { id: sessionId });
        if (result?.ok && result.session) session = result.session;
      }
      if (!session) session = getLocalSession(sessionId);
      if (!session) throw new Error('对话不存在');
      applySession(session);
      closeAllSelects();
      el('ai-chat-input')?.focus();
      return true;
    } catch (error) {
      setStatus(error?.message || String(error), 'warning');
      return false;
    }
  }

  async function performDeleteSessionById(sessionId) {
    try {
      let nextCurrentId = '';
      let remoteSessions = null;
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('ai-control-history-delete', { id: sessionId });
        if (result?.ok) {
          nextCurrentId = String(result.currentId || '');
          remoteSessions = Array.isArray(result.sessions) ? result.sessions : [];
        } else if (result?.message && result.message !== '对话不存在') {
          throw new Error(result.message);
        }
      }
      const localStore = deleteLocalSession(sessionId);
      if (!nextCurrentId) nextCurrentId = String(localStore.currentId || '');

      if (remoteSessions) {
        state.sessionList = mergeSessionLists(remoteSessions, localStore.sessions.map(sessionSummaryLocal));
      } else {
        await refreshHistoryList();
      }

      if (state.currentSession?.id === sessionId) {
        // 删除当前对话时必须先清空内存引用，否则切换历史会把已删除对话再次保存回来。
        state.currentSession = null;
        state.messages = [];
        if (nextCurrentId && nextCurrentId !== sessionId) {
          const loaded = await loadSessionById(nextCurrentId, { skipSaveCurrent: true });
          if (!loaded) await startNewConversation({ skipSave: true });
        } else {
          await startNewConversation({ skipSave: true });
        }
      } else {
        renderHistoryList();
      }
      setStatus('对话已删除', 'success');
    } catch (error) {
      setStatus(error?.message || String(error), 'warning');
    }
  }

  async function performRenameSessionById(sessionId, requestedTitle) {
    const title = String(requestedTitle || '').trim().slice(0, 40);
    if (!title) {
      setStatus('对话名称不能为空', 'warning');
      return;
    }

    let remoteSession = null;
    if (window.electronAPI?.invoke) {
      const result = await window.electronAPI.invoke('ai-control-history-rename', {
        id: sessionId,
        title,
      });
      if (result?.ok) {
        remoteSession = result.session || null;
      } else if (result?.message && result.message !== '对话不存在') {
        throw new Error(result.message);
      }
    }

    const localSession = renameLocalSession(sessionId, title);
    if (!remoteSession && !localSession) throw new Error('对话不存在');

    if (String(state.currentSession?.id || '') === String(sessionId)) {
      state.currentSession.title = title;
      state.currentSession.titleGenerated = true;
      updateSessionTitleUi();
    }
    await refreshHistoryList();
    setStatus('对话已重命名', 'success');
  }

  function renameSessionById(sessionId) {
    if (!sessionId) return;
    const session = state.sessionList.find((item) => String(item.id) === String(sessionId));
    const currentTitle = String(session?.title || state.currentSession?.title || '新对话');
    closeSelect(el('ai-chat-history-select'));
    const modal = window.MessageModal;
    if (!modal?.showPromptDialog) {
      setStatus('重命名弹窗尚未就绪，请稍后重试', 'warning');
      return;
    }
    modal.showPromptDialog(
      '请输入新的对话名称',
      currentTitle,
      (title) => performRenameSessionById(sessionId, title),
      null,
      {
        title: '重命名对话',
        confirmText: '保存',
        maxLength: 40,
        placeholder: '对话名称',
      },
    );
  }

  function deleteSessionById(sessionId) {
    if (!sessionId) return;
    closeSelect(el('ai-chat-history-select'));
    const session = state.sessionList.find((item) => String(item.id) === String(sessionId));
    const title = String(session?.title || state.currentSession?.title || '该对话');
    confirmDestructiveAction(
      `确认删除对话“${title}”吗？删除后无法恢复。`,
      () => performDeleteSessionById(sessionId),
    );
  }

  async function startNewConversation(options = {}) {
    if (state.loading) return;
    if (!options.skipSave && currentMessages().length) {
      await persistCurrentSession();
    }
    state.currentSession = {
      id: makeSessionId(),
      title: '新对话',
      titleGenerated: false,
      modelId: String(el('ai-chat-model')?.value || ''),
      browserConnectionId: state.currentBrowserId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.messages = [];
    state.lastQuotaCost = null;
    setStatus('');
    updateSessionTitleUi();
    renderWelcome();
    await refreshHistoryList();
    syncSendState();
    el('ai-chat-input')?.focus();
  }

  function ensureSessionForSend() {
    if (state.currentSession?.id) return state.currentSession;
    state.currentSession = {
      id: makeSessionId(),
      title: '新对话',
      titleGenerated: false,
      modelId: String(el('ai-chat-model')?.value || ''),
      browserConnectionId: state.currentBrowserId,
      messages: state.messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return state.currentSession;
  }

  async function maybeGenerateTitle(modelId) {
    const session = state.currentSession;
    if (!session || session.titleGenerated || state.generatingTitle || isQuotaExhausted()) return;
    const userMsg = currentMessages().find((m) => m.role === 'user' && String(m.content || '').trim());
    const asstMsg = currentMessages().find((m) => m.role === 'assistant' && String(m.content || '').trim());
    if (!userMsg || !asstMsg || !modelId || !window.electronAPI?.invoke) return;

    if (!session.title || session.title === '新对话') {
      session.title = provisionalTitle(userMsg.content);
      updateSessionTitleUi();
      await persistCurrentSession({ title: session.title, titleGenerated: false });
    }

    state.generatingTitle = true;
    try {
      const result = await window.electronAPI.invoke('ai-control-chat', {
        modelId,
        quota: state.quota,
        disableTools: true,
        browserConnectionId: '',
        messages: [
          {
            role: 'system',
            content: '你是标题生成助手。根据对话内容生成一个简短中文标题。要求：不超过16个字，不要引号、标点装饰和解释，只输出标题本身。',
          },
          {
            role: 'user',
            content: `用户：${String(userMsg.content).slice(0, 240)}\n助手：${String(asstMsg.content).slice(0, 240)}\n请生成标题：`,
          },
        ],
      });
      if (result?.quota) renderQuota(result.quota);
      if (!result?.ok) return;
      const title = sanitizeGeneratedTitle(result.message?.content);
      if (!title || state.currentSession?.id !== session.id) return;
      state.currentSession.title = title;
      state.currentSession.titleGenerated = true;
      updateSessionTitleUi();
      await persistCurrentSession({
        title,
        titleGenerated: true,
      });
    } catch (error) {
      console.warn('[AI 控制] 标题生成失败:', error?.message || error);
    } finally {
      state.generatingTitle = false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeMarkdownUrl(value) {
    const url = String(value || '').trim();
    return /^(https?:|mailto:)/i.test(url) ? escapeHtml(url) : '';
  }

  function renderInlineMarkdown(value) {
    const tokens = [];
    const token = (html) => {
      const index = tokens.push(html) - 1;
      return `\uE000${index}\uE001`;
    };
    let text = String(value || '')
      .replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`))
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) => {
        const safeUrl = safeMarkdownUrl(url);
        return safeUrl
          ? token(`<img src="${safeUrl}" alt="${escapeHtml(alt)}" loading="lazy">`)
          : escapeHtml(alt);
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
        const safeUrl = safeMarkdownUrl(url);
        return safeUrl
          ? token(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${renderInlineMarkdown(label)}</a>`)
          : label;
      });
    text = escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
      // 流式传输时闭合标记可能尚未到达，隐藏残留的 Markdown 控制符。
      .replace(/\*\*|__|~~|`/g, '');
    return text.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] || '');
  }

  function renderMarkdown(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
      paragraph = [];
    };
    const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        flushParagraph();
        const language = line.trim().slice(3).trim().replace(/[^a-zA-Z0-9_+-]/g, '');
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
        output.push(`<pre class="ai-chat-code"><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
        flushParagraph();
        const headers = tableCells(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(tableCells(lines[index]));
          index += 1;
        }
        index -= 1;
        output.push(`<div class="ai-chat-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const heading = line.match(/^\s*(#{1,6})(?:\s+|(?=[^#\s]))(.+)$/);
      if (heading) {
        flushParagraph();
        const level = Math.min(6, heading[1].length);
        output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (/^\s*#{1,6}\s*$/.test(line)) {
        flushParagraph();
        continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushParagraph();
        output.push('<hr>');
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flushParagraph();
        const quote = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        index -= 1;
        output.push(`<blockquote>${quote.map(renderInlineMarkdown).join('<br>')}</blockquote>`);
        continue;
      }
      const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const tag = unordered ? 'ul' : 'ol';
        const items = [];
        const matcher = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
        while (index < lines.length) {
          const match = lines[index].match(matcher);
          if (!match) break;
          items.push(match[1]);
          index += 1;
        }
        index -= 1;
        output.push(`<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        continue;
      }
      paragraph.push(line);
    }
    flushParagraph();
    return output.join('');
  }

  function renderMarkdownInto(target, value) {
    if (target) target.innerHTML = renderMarkdown(value);
  }

  function formatActivityDetail(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value ?? null, null, 2); } catch (_) { return String(value ?? ''); }
  }

  function enableDetailsAnimation(details, content) {
    const summary = details.querySelector(':scope > summary');
    let heightAnimation = null;
    let contentAnimation = null;
    let targetOpen = details.open;
    let sequence = 0;

    const prefersReducedMotion = () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const settle = (open) => {
      details.open = open;
      targetOpen = open;
      summary.setAttribute('aria-expanded', String(open));
      details.classList.remove('is-animating');
      details.style.removeProperty('height');
      details.style.removeProperty('overflow');
    };
    const setOpen = (open, { animate = true } = {}) => {
      const nextOpen = Boolean(open);
      if (!heightAnimation && details.open === nextOpen) {
        targetOpen = nextOpen;
        summary.setAttribute('aria-expanded', String(nextOpen));
        return;
      }

      const currentHeight = details.getBoundingClientRect().height;
      const wasOpen = details.open;
      const contentStyle = window.getComputedStyle(content);
      const currentOpacity = wasOpen ? contentStyle.opacity : '0';
      const currentTransform = wasOpen
        ? (contentStyle.transform !== 'none' ? contentStyle.transform : 'translateY(0)')
        : 'translateY(-4px)';
      const animationId = ++sequence;

      heightAnimation?.cancel();
      contentAnimation?.cancel();
      heightAnimation = null;
      contentAnimation = null;
      targetOpen = nextOpen;
      summary.setAttribute('aria-expanded', String(nextOpen));

      if (!animate || prefersReducedMotion() || !details.isConnected) {
        settle(nextOpen);
        return;
      }

      details.style.removeProperty('height');
      details.open = nextOpen;
      const targetHeight = details.getBoundingClientRect().height;
      details.open = true;
      details.style.height = `${currentHeight}px`;
      details.style.overflow = 'hidden';
      details.classList.add('is-animating');

      heightAnimation = details.animate(
        [{ height: `${currentHeight}px` }, { height: `${targetHeight}px` }],
        { duration: 220, easing: 'cubic-bezier(.2, .7, .2, 1)' },
      );
      contentAnimation = content.animate(
        [
          { opacity: currentOpacity, transform: currentTransform },
          { opacity: nextOpen ? 1 : 0, transform: nextOpen ? 'translateY(0)' : 'translateY(-4px)' },
        ],
        { duration: nextOpen ? 180 : 140, easing: 'ease', fill: 'forwards' },
      );
      heightAnimation.onfinish = () => {
        if (animationId !== sequence) return;
        heightAnimation = null;
        contentAnimation?.cancel();
        contentAnimation = null;
        settle(nextOpen);
      };
    };

    summary.setAttribute('aria-expanded', String(targetOpen));
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      setOpen(!targetOpen);
    });
    return { setOpen };
  }

  function createToolActivity(tool = {}) {
    const card = document.createElement('details');
    card.className = `ai-chat-tool ${tool.status || 'running'}`;
    card.dataset.toolId = String(tool.id || '');
    const summary = document.createElement('summary');
    summary.innerHTML = '<span class="ai-chat-tool-icon" aria-hidden="true">⌁</span><span class="ai-chat-tool-kind">MCP</span><span class="ai-chat-tool-name"></span><span class="ai-chat-tool-status"></span><span class="ai-chat-disclosure" aria-hidden="true">›</span>';
    const detail = document.createElement('div');
    detail.className = 'ai-chat-tool-detail';
    card.append(summary, detail);
    const disclosure = enableDetailsAnimation(card, detail);

    const update = (next = {}) => {
      Object.assign(tool, next);
      const status = String(tool.status || 'running');
      card.className = `ai-chat-tool ${status}`;
      summary.querySelector('.ai-chat-tool-name').textContent = String(tool.name || 'MCP 工具');
      summary.querySelector('.ai-chat-tool-status').textContent =
        status === 'running' ? '调用中' : status === 'error' ? '调用失败' : '已完成';
      detail.innerHTML = '';
      if (tool.arguments !== undefined && tool.arguments !== '') {
        const label = document.createElement('span');
        label.className = 'ai-chat-tool-detail-label';
        label.textContent = '输入';
        const pre = document.createElement('pre');
        pre.textContent = formatActivityDetail(tool.arguments);
        detail.append(label, pre);
      }
      if (tool.result !== undefined && tool.result !== '') {
        const label = document.createElement('span');
        label.className = 'ai-chat-tool-detail-label';
        label.textContent = status === 'error' ? '错误' : '输出';
        const pre = document.createElement('pre');
        pre.textContent = formatActivityDetail(tool.result);
        detail.append(label, pre);
      }
    };
    update(tool);
    return { card, update, setOpen: disclosure.setOpen };
  }

  function createAssistantView(options = {}) {
    const container = el('ai-chat-messages');
    if (!container) return null;
    container.querySelector('.ai-chat-welcome')?.remove();
    const row = document.createElement('div');
    row.className = `ai-chat-message assistant${options.pending ? ' pending' : ''}`;
    const stack = document.createElement('div');
    stack.className = 'ai-chat-assistant-stack';

    const trace = document.createElement('div');
    trace.className = 'ai-chat-trace';
    stack.appendChild(trace);
    row.appendChild(stack);
    container.appendChild(row);

    let content = '';
    let answer = null;
    let answerRound = -1;
    const thinkingViews = new Map();
    const toolViews = new Map();
    const scroll = () => { container.scrollTop = container.scrollHeight; };
    const ensureAnswer = () => {
      if (answer) return answer;
      answer = document.createElement('div');
      answer.className = 'ai-chat-answer is-streaming';
      stack.appendChild(answer);
      return answer;
    };
    const finishThinking = (round) => {
      const view = thinkingViews.get(Number(round));
      if (!view || view.finished) return;
      view.element.classList.remove('is-streaming');
      view.label.textContent = '思考过程';
      view.setOpen(false);
      view.finished = true;
    };
    const discardEmptyThinking = (round) => {
      const roundId = Number(round) || 0;
      const view = thinkingViews.get(roundId);
      if (!view || view.content) return;
      view.element.remove();
      thinkingViews.delete(roundId);
    };
    const demoteAnswerToStep = () => {
      if (!content.trim() || !answer) return;
      const step = document.createElement('div');
      step.className = 'ai-chat-step-output';
      renderMarkdownInto(step, content);
      trace.appendChild(step);
      answer.remove();
      answer = null;
      content = '';
      answerRound = -1;
    };
    const appendStep = (value) => {
      if (!String(value || '').trim()) return;
      const step = document.createElement('div');
      step.className = 'ai-chat-step-output';
      renderMarkdownInto(step, value);
      trace.appendChild(step);
    };
    const api = {
      row,
      addReasoning(delta, round = 0) {
        const roundId = Number(round) || 0;
        if (answer && answerRound !== roundId) demoteAnswerToStep();
        let view = thinkingViews.get(roundId);
        if (!view) {
          thinkingViews.forEach((_, previousRound) => finishThinking(previousRound));
          const element = document.createElement('details');
          element.className = 'ai-chat-thinking is-streaming';
          element.open = true;
          const summary = document.createElement('summary');
          summary.innerHTML = '<span class="ai-chat-thinking-mark" aria-hidden="true">✦</span><span class="ai-chat-thinking-label">思考中</span><span class="ai-chat-disclosure" aria-hidden="true">›</span>';
          const text = document.createElement('div');
          text.className = 'ai-chat-thinking-text';
          element.append(summary, text);
          trace.appendChild(element);
          const disclosure = enableDetailsAnimation(element, text);
          view = {
            element,
            text,
            label: summary.querySelector('.ai-chat-thinking-label'),
            content: '',
            finished: false,
            setOpen: disclosure.setOpen,
          };
          thinkingViews.set(roundId, view);
        }
        view.content += String(delta || '');
        view.text.textContent = view.content;
        scroll();
      },
      addContent(delta, round = 0) {
        answerRound = Number(round) || 0;
        discardEmptyThinking(answerRound);
        finishThinking(answerRound);
        content += String(delta || '');
        renderMarkdownInto(ensureAnswer(), content);
        scroll();
      },
      setContent(value) {
        content = String(value || '');
        renderMarkdownInto(ensureAnswer(), content);
      },
      upsertTool(tool, round = 0) {
        const roundId = Number(round) || 0;
        const id = String(tool?.id || tool?.name || toolViews.size);
        let view = toolViews.get(id);
        if (!view) {
          discardEmptyThinking(roundId);
          finishThinking(roundId);
          demoteAnswerToStep();
          view = createToolActivity(tool);
          toolViews.set(id, view);
          trace.appendChild(view.card);
        } else {
          view.update(tool);
        }
        scroll();
      },
      hydrate({ traceEvents = [], reasoning: savedReasoning = '', toolEvents = [] } = {}) {
        if (traceEvents.length) {
          traceEvents.forEach((event, index) => {
            const parsedRound = Number(event?.round);
            const round = Number.isFinite(parsedRound) ? parsedRound : index;
            if (event?.type === 'reasoning') {
              api.addReasoning(event.content, round);
              finishThinking(round);
            } else if (event?.type === 'tool') {
              api.upsertTool(event.tool || {}, round);
            } else if (event?.type === 'step') {
              appendStep(event.content);
            }
          });
          return;
        }
        if (savedReasoning) {
          api.addReasoning(savedReasoning, 0);
          finishThinking(0);
        }
        toolEvents.forEach((tool, index) => api.upsertTool(tool, index + 1));
      },
      finalize() {
        row.classList.remove('pending');
        thinkingViews.forEach((view, round) => {
          if (view.content) finishThinking(round);
          else discardEmptyThinking(round);
        });
        answer?.classList.remove('is-streaming');
        scroll();
      },
    };
    api.hydrate({
      traceEvents: options.traceEvents || [],
      reasoning: options.reasoning,
      toolEvents: options.toolEvents || [],
    });
    if (options.content) api.addContent(options.content, Number.MAX_SAFE_INTEGER);
    if (!options.pending) api.finalize();
    scroll();
    return api;
  }

  async function copyTextToClipboard(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /** 从 userIndex 起，到下一条 user（不含）或数组末尾 */
  function findTurnEndExclusive(messages, userIndex) {
    let end = userIndex + 1;
    while (end < messages.length && messages[end]?.role !== 'user') end += 1;
    return end;
  }

  function resolveUserMessageIndex(row) {
    const fromAttr = Number(row?.dataset?.messageIndex);
    if (Number.isInteger(fromAttr) && fromAttr >= 0) return fromAttr;
    return -1;
  }

  async function copyUserBubble(row) {
    const text = String(row?.dataset?.content || row?.querySelector?.('.ai-chat-bubble')?.textContent || '');
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setStatus('已复制到剪贴板', 'success');
    } else {
      setStatus('复制失败，请手动选择文本', 'warning');
    }
  }

  async function performRecallUserBubble(row) {
    if (state.loading) {
      setStatus('请等待当前回复完成后再撤回', 'warning');
      return;
    }
    const userIndex = resolveUserMessageIndex(row);
    const messages = currentMessages();
    if (userIndex < 0 || userIndex >= messages.length || messages[userIndex]?.role !== 'user') {
      setStatus('无法定位该消息', 'warning');
      return;
    }
    const content = String(messages[userIndex].content || '');
    // 撤回：删除该气泡及之后的全部内容
    messages.splice(userIndex);
    const input = el('ai-chat-input');
    if (input) {
      input.value = content;
      resizeInput();
      syncSendState();
      reclaimAiInputFocus(input);
    }
    if (!messages.length) {
      if (state.currentSession) {
        state.currentSession.title = '新对话';
        state.currentSession.titleGenerated = false;
      }
      renderWelcome();
    } else {
      renderConversation();
    }
    updateSessionTitleUi();
    await persistCurrentSession();
  }

  function recallUserBubble(row) {
    if (state.loading) {
      setStatus('请等待当前回复完成后再撤回', 'warning');
      return;
    }
    const userIndex = resolveUserMessageIndex(row);
    const messages = currentMessages();
    if (userIndex < 0 || userIndex >= messages.length || messages[userIndex]?.role !== 'user') {
      setStatus('无法定位该消息', 'warning');
      return;
    }
    confirmDestructiveAction(
      '确认撤回这条消息吗？该消息及其之后的对话内容将被移除，消息内容会放回输入框。',
      () => performRecallUserBubble(row),
    );
  }

  async function performDeleteUserTurn(row) {
    if (state.loading) {
      setStatus('请等待当前回复完成后再删除', 'warning');
      return;
    }
    const userIndex = resolveUserMessageIndex(row);
    const messages = currentMessages();
    if (userIndex < 0 || userIndex >= messages.length || messages[userIndex]?.role !== 'user') {
      setStatus('无法定位该消息', 'warning');
      return;
    }
    // 删除：仅移除本轮用户消息及其对应 AI 回复（含中间 tool 消息），不影响后续轮次
    const end = findTurnEndExclusive(messages, userIndex);
    messages.splice(userIndex, end - userIndex);
    if (!messages.length) {
      if (state.currentSession) {
        state.currentSession.title = '新对话';
        state.currentSession.titleGenerated = false;
      }
      renderWelcome();
    } else {
      renderConversation();
    }
    updateSessionTitleUi();
    await persistCurrentSession();
  }

  function deleteUserTurn(row) {
    if (state.loading) {
      setStatus('请等待当前回复完成后再删除', 'warning');
      return;
    }
    const userIndex = resolveUserMessageIndex(row);
    const messages = currentMessages();
    if (userIndex < 0 || userIndex >= messages.length || messages[userIndex]?.role !== 'user') {
      setStatus('无法定位该消息', 'warning');
      return;
    }
    confirmDestructiveAction(
      '确认删除这轮对话吗？该条消息及其对应的 AI 回复将被删除，删除后无法恢复。',
      () => performDeleteUserTurn(row),
    );
  }

  function attachUserBubbleActions(row, content, messageIndex) {
    if (!row) return;
    row.dataset.messageIndex = String(messageIndex);
    row.dataset.content = String(content || '');

    const wrap = document.createElement('div');
    wrap.className = 'ai-chat-user-wrap';

    const actions = document.createElement('div');
    actions.className = 'ai-chat-user-actions';
    actions.setAttribute('aria-label', '消息操作');

    const makeBtn = (action, title, symbol) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-chat-msg-action';
      btn.dataset.action = action;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.innerHTML = `<span class="ai-chat-msg-action-icon" aria-hidden="true">${symbol}</span>`;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (action === 'copy') void copyUserBubble(row);
        else if (action === 'recall') void recallUserBubble(row);
        else if (action === 'delete') void deleteUserTurn(row);
      });
      return btn;
    };

    // 从左到右：复制、撤回、删除
    actions.append(
      makeBtn('copy', '复制', '❐'),
      makeBtn('recall', '撤回', '↩'),
      makeBtn('delete', '删除', '✕'),
    );

    const bubble = row.querySelector('.ai-chat-bubble');
    if (bubble) {
      wrap.append(actions, bubble);
      row.appendChild(wrap);
    }
  }

  function appendMessage(role, content, options = {}) {
    const container = el('ai-chat-messages');
    if (!container) return null;
    if (role === 'tool' || role === 'system') return null;
    if (role === 'assistant' && !String(content || '').trim() && !options.pending
      && !String(options.reasoning || '').trim() && !options.toolEvents?.length
      && !options.traceEvents?.length) return null;
    if (role === 'assistant') {
      return createAssistantView({ ...options, content });
    }
    container.querySelector('.ai-chat-welcome')?.remove();
    const row = document.createElement('div');
    row.className = `ai-chat-message ${role}${options.pending ? ' pending' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble';
    bubble.textContent = content;
    row.appendChild(bubble);
    if (role === 'user') {
      const messageIndex = Number.isInteger(options.messageIndex)
        ? options.messageIndex
        : currentMessages().length - 1;
      attachUserBubbleActions(row, content, messageIndex);
    }
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
    const browserText = state.currentBrowserId
      ? '已连接浏览器，AI 将在所选浏览器中执行操作。'
      : '当前未连接浏览器，将进行普通对话。';
    const logoUrl = window.aiFreeLogoAssets?.url || '../../assets/logo.ico';
    welcome.innerHTML = `<img class="ai-chat-welcome-icon" data-app-logo src="${logoUrl}" alt="" aria-hidden="true"><strong>有什么可以帮你？</strong><p>${browserText}</p>`;
    container.appendChild(welcome);
    updateSessionTitleUi();
  }

  function renderConversation() {
    const container = el('ai-chat-messages');
    if (!container) return;
    container.innerHTML = '';
    const messages = currentMessages();
    const visible = messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => {
        if (message.role === 'user') return true;
        if (message.role !== 'assistant') return false;
        return !!(String(message.content || '').trim()
          || String(message.reasoning || '').trim()
          || message.tool_events?.length
          || message.trace_events?.length);
      });
    if (!visible.length) {
      renderWelcome();
      return;
    }
    visible.forEach(({ message, index }) => {
      appendMessage(message.role, message.content, {
        messageIndex: index,
        reasoning: message.reasoning,
        toolEvents: message.tool_events,
        traceEvents: message.trace_events,
      });
    });
    updateSessionTitleUi();
  }

  function syncSendState() {
    const send = el('ai-chat-send');
    const input = el('ai-chat-input');
    const model = el('ai-chat-model');
    const modelUnavailable = state.accountAuthenticated && !model?.value;
    const quotaExhausted = state.accountAuthenticated && isQuotaExhausted();
    if (send) send.disabled = state.loading || modelUnavailable || quotaExhausted || !input?.value.trim();
  }

  async function loadModels() {
    const select = el('ai-chat-model');
    if (!select || !window.electronAPI?.invoke) return;
    const preferred = state.currentSession?.modelId || select.value;
    select.disabled = true;
    select.innerHTML = '<option value="">正在读取可用模型...</option>';
    syncSelectUi(select);
    setStatus('');
    try {
      try {
        const session = await window.electronAPI.invoke('account-get-session');
        state.accountAuthenticated = session?.authenticated === true;
      } catch (_) {
        state.accountAuthenticated = false;
      }
      syncSendState();
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
          option.textContent = String(model.name || model.model || model.id || '未命名模型');
          select.appendChild(option);
        });
        if (preferred && Array.from(select.options).some((opt) => opt.value === preferred)) {
          select.value = preferred;
        }
        select.disabled = false;
      }
      syncSelectUi(select);
      renderQuota(result.quota);
    } catch (error) {
      select.innerHTML = '<option value="">暂无可用模型</option>';
      select.disabled = true;
      syncSelectUi(select);
      renderQuota(null);
      setStatus(error?.message || String(error));
    }
    syncSendState();
  }

  // 兼容旧版将兑换入口放在 AI 控制页的结构；统一入口使用新的元素 ID，
  // 因此新版界面不会绑定这里的旧处理器。
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
      const displayQuota = window.AiFreeQuotaDisplay?.recordAIResetAfterRedeem?.(
        result.quota,
        result.added_quota,
      ) || result.quota;
      renderQuota(displayQuota);
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
        const browserName = String(connection.browserName || connection.name || 'AI自动化浏览器');
        option.textContent = `${browserName} · ${Number(connection.toolCount || 0)} 个工具`;
        option.title = browserName;
        select.appendChild(option);
      });
      const previousExists = Boolean(previous)
        && connections.some((item) => String(item.id) === previous);
      const firstConnectionId = String(connections[0]?.id || '');
      const nextBrowserId = previousExists
        ? previous
        : (state.browserSelectionExplicitlyDisabled ? '' : firstConnectionId);
      const selectionChanged = state.currentBrowserId !== nextBrowserId;
      select.value = nextBrowserId;
      state.currentBrowserId = select.value;
      if (state.currentBrowserId) state.browserSelectionExplicitlyDisabled = false;
      if (state.currentSession && !currentMessages().length) {
        state.currentSession.browserConnectionId = state.currentBrowserId;
      }
      select.title = connections.length ? `已连接 ${connections.length} 个浏览器插件` : '未发现浏览器插件，请确认扩展和 AI-FREE 已启动';
      syncSelectUi(select);
      if (selectionChanged && !currentMessages().length) renderWelcome();
    } catch (error) {
      const selectionChanged = Boolean(state.currentBrowserId);
      select.innerHTML = '<option value="">未发现浏览器插件</option>';
      state.currentBrowserId = '';
      if (state.currentSession && !currentMessages().length) {
        state.currentSession.browserConnectionId = '';
      }
      syncSelectUi(select);
      if (selectionChanged && !currentMessages().length) renderWelcome();
      console.warn('[AI 控制] 浏览器连接读取失败:', error?.message || error);
    }
  }

  function resizeInput() {
    const input = el('ai-chat-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  }

  function focusElement(input) {
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch (_) {
      try { input.focus(); } catch (__) {}
    }
  }

  /**
   * 侧栏是 WebContentsView：OS/Chromium 子窗口可能抢走键盘焦点，
   * 而 DOM 仍显示 textarea:focus，表现为“已聚焦但无法输入”。
   * 这里通过主进程把键盘焦点拉回侧栏 webContents，再回焦输入框。
   */
  function reclaimAiInputFocus(input) {
    if (!input || state._aiInputReclaiming) return;
    focusElement(input);
    if (!window.electronAPI?.invoke) return;

    const now = Date.now();
    // 短防抖：pointerdown/click 连续触发时只回收一次
    if (state._aiInputReclaimAt && now - state._aiInputReclaimAt < 120) return;
    state._aiInputReclaimAt = now;

    const token = Symbol('ai-input-focus');
    state._aiInputFocusToken = token;
    state._aiInputReclaiming = true;

    const refocus = () => {
      if (state._aiInputFocusToken !== token) return;
      // 若用户已点到别处，不要强行抢回
      if (document.activeElement && document.activeElement !== input) {
        const active = document.activeElement;
        if (active !== document.body && active !== document.documentElement) return;
      }
      focusElement(input);
    };

    // 等本轮 click 的原生聚焦完成后再向主进程要键盘焦点，避免互相打架
    window.setTimeout(() => {
      if (state._aiInputFocusToken !== token) {
        state._aiInputReclaiming = false;
        return;
      }
      void window.electronAPI.invoke('focus-sidebar-input').then(() => {
        refocus();
        requestAnimationFrame(refocus);
        window.setTimeout(refocus, 30);
        window.setTimeout(() => {
          refocus();
          state._aiInputReclaiming = false;
        }, 80);
      }).catch((error) => {
        console.warn('[AI 控制] 恢复输入框焦点失败:', error?.message || error);
        refocus();
        state._aiInputReclaiming = false;
      });
    }, 0);
  }

  function openPersonalLogin() {
    window.electronAPI?.send?.('open-account-center-popup');
  }

  async function ensureAuthenticatedForChat() {
    try {
      const session = await window.electronAPI?.invoke?.('account-get-session');
      state.accountAuthenticated = session?.authenticated === true;
      syncSendState();
      if (state.accountAuthenticated) return true;
    } catch (_) {}
    state.accountAuthenticated = false;
    syncSendState();
    openPersonalLogin();
    return false;
  }

  async function sendMessage() {
    if (state.loading) return;
    const input = el('ai-chat-input');
    const select = el('ai-chat-model');
    const content = String(input?.value || '').trim();
    if (!content) return;

    // 登录校验必须发生在写入对话和调用 AI 接口之前；未登录时统一打开头像使用的独立个人中心窗口。
    if (!await ensureAuthenticatedForChat()) return;
    if (!select?.value) return;

    // 每次发送前刷新服务端额度。额度查询不会请求模型，可避免使用页面里的旧额度继续发起对话。
    try {
      const quotaResult = await window.electronAPI?.invoke?.('ai-control-get-models');
      if (quotaResult?.quota) renderQuota(quotaResult.quota);
    } catch (_) {}
    if (isQuotaExhausted()) {
      showChatBusinessError('AI 对话额度已用尽，请联系管理员');
      syncSendState();
      return;
    }

    ensureSessionForSend();

    const messages = currentMessages();
    const wasFirstExchange = !messages.some((m) => m.role === 'assistant' && String(m.content || '').trim());
    messages.push({ role: 'user', content });
    const userRow = appendMessage('user', content, { messageIndex: messages.length - 1 });
    updateSessionTitleUi();
    input.value = '';
    resizeInput();
    state.loading = true;
    setStatus('');
    syncSendState();
    const streamView = createAssistantView({ pending: true });
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const streamListener = window.electronAPI?.on?.('ai-control-chat-event', (event) => {
      if (!event || event.requestId !== requestId) return;
      if (event.type === 'round_start') {
        streamView?.addReasoning('', event.round);
      }
      if (event.type === 'reasoning_delta') {
        streamView?.addReasoning(event.delta, event.round);
      }
      if (event.type === 'content_delta') {
        streamView?.addContent(event.delta, event.round);
      }
      if (event.type === 'tool_start' || event.type === 'tool_result') {
        streamView?.upsertTool(event.tool || {}, event.round);
      }
    });

    try {
      const result = await window.electronAPI.invoke('ai-control-chat', {
        modelId: select.value,
        messages,
        quota: state.quota,
        browserConnectionId: state.currentBrowserId,
        stream: true,
        requestId,
      });
      if (!result?.ok) {
        const failureMessage = String(result?.message || result?.error || '对话请求失败');
        if (/请先.*登录|未登录/.test(failureMessage)) {
          messages.pop();
          streamView?.row?.remove();
          openPersonalLogin();
          return;
        }
        if (isQuotaFailure(failureMessage)) {
          messages.pop();
          userRow?.remove();
          streamView?.row?.remove();
          if (!messages.length) renderWelcome();
          if (result?.quota) renderQuota(result.quota);
          showChatBusinessError(failureMessage);
          return;
        }
        throw new Error(failureMessage);
      }

      // 优先使用主进程返回的完整消息链（含工具调用）
      if (Array.isArray(result.messages) && result.messages.length) {
        state.messages = result.messages;
      } else {
        const reply = String(result.message?.content || '').trim();
        messages.push({ role: 'assistant', content: reply });
      }
      const replyText = String(result.message?.content || '').trim();
      const finalAssistant = [...state.messages].reverse().find((item) => item?.role === 'assistant');
      if (finalAssistant) {
        finalAssistant.reasoning = String(result.message?.reasoning || '');
        finalAssistant.tool_events = Array.isArray(result.message?.tool_events)
          ? result.message.tool_events
          : [];
        finalAssistant.trace_events = Array.isArray(result.message?.trace_events)
          ? result.message.trace_events
          : [];
      }
      streamView?.setContent(replyText || '模型未返回内容');
      streamView?.finalize();
      state.lastQuotaCost = result.quota_cost ?? result.quota_cost_increment ?? null;
      renderQuota(result.quota);

      if (state.currentSession) {
        state.currentSession.modelId = select.value;
        state.currentSession.browserConnectionId = state.currentBrowserId;
        if (!state.currentSession.title || state.currentSession.title === '新对话') {
          state.currentSession.title = provisionalTitle(content);
        }
      }
      await persistCurrentSession();
      if (wasFirstExchange) {
        void maybeGenerateTitle(select.value);
      }
    } catch (error) {
      messages.pop();
      const failureMessage = error?.message || String(error);
      if (isQuotaFailure(failureMessage)) {
        userRow?.remove();
        streamView?.row?.remove();
        if (!messages.length) renderWelcome();
        showChatBusinessError(failureMessage);
      } else {
        streamView?.addContent(`\n\n请求失败：${failureMessage}`);
        streamView?.finalize();
        setStatus(failureMessage);
      }
    } finally {
      if (streamListener) window.electronAPI?.off?.('ai-control-chat-event', streamListener);
      state.loading = false;
      syncSendState();
      updateSessionTitleUi();
      input?.focus();
    }
  }

  async function bootstrapHistory() {
    try {
      await refreshHistoryList();
      const localStore = readLocalHistoryStore();
      let currentId = String(localStore.currentId || '');

      if (window.electronAPI?.invoke) {
        try {
          const list = await window.electronAPI.invoke('ai-control-history-list');
          if (list?.ok && list.currentId) currentId = String(list.currentId);
        } catch (_) {}
      }

      if (currentId) {
        let session = null;
        if (window.electronAPI?.invoke) {
          const loaded = await window.electronAPI.invoke('ai-control-history-get', { id: currentId }).catch(() => null);
          if (loaded?.ok && loaded.session?.messages?.length) session = loaded.session;
        }
        if (!session) session = getLocalSession(currentId);
        if (session && Array.isArray(session.messages) && session.messages.length) {
          applySession(session);
          return;
        }
      }
    } catch (error) {
      console.warn('[AI 控制] 初始化历史失败:', error?.message || error);
    }
    await startNewConversation({ skipSave: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCustomSelects();
    el('ai-chat-redeem-gift')?.addEventListener('click', redeemGiftCode);
    el('ai-chat-gift-code')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        redeemGiftCode();
      }
    });
    window.addEventListener('ai-control-quota-updated', (event) => {
      state.lastQuotaCost = null;
      renderQuota(event?.detail || null);
      syncSendState();
    });
    el('ai-chat-model')?.addEventListener('change', () => {
      state.lastQuotaCost = null;
      renderQuota(state.quota);
      syncSendState();
      if (state.currentSession) {
        state.currentSession.modelId = String(el('ai-chat-model')?.value || '');
        if (currentMessages().length) void persistCurrentSession();
      }
    });
    el('ai-chat-browser')?.addEventListener('change', (event) => {
      state.currentBrowserId = String(event.target?.value || '');
      state.browserSelectionExplicitlyDisabled = !state.currentBrowserId;
      if (state.currentSession) {
        state.currentSession.browserConnectionId = state.currentBrowserId;
        if (currentMessages().length) void persistCurrentSession();
      }
      if (!currentMessages().length) renderWelcome();
      syncSendState();
    });
    el('ai-chat-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });
    const chatInput = el('ai-chat-input');
    // 用 pointerdown（捕获）尽早拉回侧栏键盘焦点，避免假聚焦
    chatInput?.addEventListener('pointerdown', () => reclaimAiInputFocus(chatInput), true);
    chatInput?.addEventListener('click', () => reclaimAiInputFocus(chatInput));
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
    // 首屏默认就是 AI 栏目时，主动拉一次侧栏键盘焦点
    window.setTimeout(() => {
      if (document.getElementById('ai-control-panel')?.classList.contains('active')) {
        reclaimAiInputFocus(chatInput);
      }
    }, 150);
    document.querySelector('[data-tab="ai-control-panel"]')?.addEventListener('click', () => {
      loadModels();
      loadBrowserConnections();
      void refreshHistoryList();
      window.setTimeout(() => reclaimAiInputFocus(el('ai-chat-input')), 50);
    });
    window.electronAPI?.on?.('account-session-updated', () => {
      loadModels();
      loadBrowserConnections();
      void bootstrapHistory();
    });
    loadModels();
    loadBrowserConnections();
    void bootstrapHistory();
    window.setInterval(loadBrowserConnections, 4000);
  });
})();
