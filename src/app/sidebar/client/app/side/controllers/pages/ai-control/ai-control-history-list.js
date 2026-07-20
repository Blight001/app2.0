  function firstQuotaValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '') || null;
  }

  function quotaNumber(value) {
    return Number(value) || 0;
  }

  function setQuotaDisplay(ring, valueEl, widget, progress, value, title) {
    ring.style.setProperty('--quota-progress', progress);
    valueEl.textContent = value;
    widget.title = title;
    syncSendState();
  }

  function renderQuota(quota) {
    state.quota = firstQuotaValue(window.AiFreeQuotaDisplay?.normalizeAIQuota?.(quota), quota);
    window.renderAccountAiUsage?.(state.quota);
    const widget = el('ai-chat-quota');
    const ring = el('ai-chat-quota-ring');
    const valueEl = el('ai-chat-quota-value');
    if (!widget || !ring || !valueEl) return;

    const lastCost = state.lastQuotaCost == null ? '' : ` · 本次 ${formatQuota(state.lastQuotaCost)}`;
    const multiplier = selectedModelMultiplier();
    const multiplierTip = multiplier ? ` · 倍率 ×${formatQuota(multiplier)}` : '';

    if (selectedModelIsCustom()) {
      return setQuotaDisplay(ring, valueEl, widget, '100%', 'API', '自定义 API 不消耗软件端 AI 额度');
    }

    if (!state.quota) {
      return setQuotaDisplay(ring, valueEl, widget, '0%', '--', '选择模型后即可开始对话');
    }

    if (state.quota.unlimited) {
      const title = `对话额度：不限量 · 已使用 ${formatQuota(state.quota.used)} 点${multiplierTip}${lastCost}`;
      return setQuotaDisplay(ring, valueEl, widget, '100%', '∞', title);
    }

    const total = Math.max(0, quotaNumber(state.quota.quota));
    const used = quotaNumber(state.quota.used);
    const remaining = Math.max(0, Number(state.quota.remaining ?? (total - used)));
    const percent = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
    const title = `剩余 ${formatQuota(remaining)} / ${formatQuota(total)} 点 · 已使用 ${formatQuota(state.quota.used)}${multiplierTip}${lastCost}`;
    return setQuotaDisplay(ring, valueEl, widget, `${percent}%`, `${Math.round(percent)}`, title);
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

  function createNewConversationButton(shell) {
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
    return newBtn;
  }

  function createHistoryDivider() {
    const divider = document.createElement('div');
    divider.className = 'ai-select-option-divider';
    divider.setAttribute('role', 'separator');
    return divider;
  }

  function createDraftHistoryButton(shell) {
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
    return draft;
  }

  function createEmptyHistoryButton() {
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'ai-select-option';
    empty.disabled = true;
    empty.textContent = '暂无历史对话';
    return empty;
  }

  function createHistoryMainButton(session, currentId, shell) {
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'ai-select-option-label';
    main.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:0;min-width:0;width:100%;';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = session.title || '新对话';
    const sub = document.createElement('span');
    sub.className = 'ai-select-option-sub';
    const metaParts = [formatRelativeTime(session.updatedAt), session.messageCount ? `${session.messageCount} 条` : ''].filter(Boolean);
    sub.textContent = metaParts.join(' · ') || session.preview || '历史对话';
    main.append(titleSpan, sub);
    main.addEventListener('click', (event) => {
      event.preventDefault();
      closeSelect(shell);
      if (String(session.id) !== currentId) void loadSessionById(session.id);
    });
    return main;
  }

  function createHistoryActions(session) {
    const actions = document.createElement('div');
    actions.className = 'ai-select-option-actions';
    for (const action of ['rename', 'delete']) {
      const isRename = action === 'rename';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ai-select-option-action ${isRename ? 'ai-select-option-rename' : 'ai-select-option-del'}`;
      button.title = isRename ? '重命名' : '删除';
      button.setAttribute('aria-label', isRename ? '重命名对话' : '删除对话');
      button.textContent = isRename ? '✎' : '×';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isRename) renameSessionById(session.id);
        else void deleteSessionById(session.id);
      });
      actions.appendChild(button);
    }
    return actions;
  }

  function createHistoryItem(session, currentId, shell) {
    const item = document.createElement('div');
    item.className = 'ai-select-option ai-select-option-history';
    item.setAttribute('aria-selected', String(session.id) === currentId ? 'true' : 'false');
    item.append(createHistoryMainButton(session, currentId, shell), createHistoryActions(session));
    return item;
  }

  function renderHistoryList() {
    const menu = el('ai-chat-history-menu');
    const shell = el('ai-chat-history-select');
    if (!menu) return;
    updateSessionTitleUi();
    menu.innerHTML = '';
    const sessions = Array.isArray(state.sessionList) ? state.sessionList : [];
    const currentId = String(state.currentSession?.id || '');
    const showDraft = Boolean(currentId && !sessions.some((item) => String(item.id) === currentId) && currentMessages().length);
    menu.append(createNewConversationButton(shell), createHistoryDivider());
    if (showDraft) menu.appendChild(createDraftHistoryButton(shell));
    if (!sessions.length && !showDraft) {
      menu.appendChild(createEmptyHistoryButton());
      return;
    }
    sessions.forEach((session) => menu.appendChild(createHistoryItem(session, currentId, shell)));
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
    if (window.aiFree?.ai?.historyList) {
      try {
        const result = await window.aiFree.ai.historyList();
        if (result?.ok) remote = Array.isArray(result.sessions) ? result.sessions : [];
      } catch (error) {
        console.warn('[AI 控制] 读取历史失败:', error?.message || error);
      }
    }
    state.sessionList = mergeSessionLists(remote, localSummaries);
    renderHistoryList();
  }

  function ensureCurrentSession(modelId) {
    if (!state.currentSession?.id) {
      state.currentSession = {
        id: makeSessionId(),
        title: '新对话',
        titleGenerated: false,
        modelId,
        browserConnectionId: state.currentBrowserIds[0] || '',
        browserConnectionIds: [...state.currentBrowserIds],
        automationCardId: state.currentCardId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }

  function buildCurrentSessionPayload(modelId, extra) {
    return {
      id: state.currentSession.id,
      title: state.currentSession.title || '新对话',
      titleGenerated: state.currentSession.titleGenerated === true,
      modelId,
      browserConnectionId: state.currentBrowserIds[0] || '',
      browserConnectionIds: [...state.currentBrowserIds],
      automationCardId: state.currentCardId,
      messages: currentMessages(),
      createdAt: state.currentSession.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...extra,
    };
  }

  function applySavedSession(saved, payload) {
    const savedMessages = Array.isArray(saved.messages) ? saved.messages : payload.messages;
    state.currentSession = { ...saved, messages: savedMessages };
    if (Array.isArray(saved.messages) && saved.messages.length >= payload.messages.length) {
      state.messages = saved.messages;
    }
    updateSessionTitleUi();
  }

  async function saveSessionToMain(payload) {
    if (!window.aiFree?.ai?.historySave) return null;
    try {
      const result = await window.aiFree.ai.historySave({ session: payload, setCurrent: true });
      if (result?.ok && result.session) return result.session;
      if (result?.ok === false) console.warn('[AI 控制] 主进程保存历史失败:', result.message || result);
    } catch (error) {
      console.warn('[AI 控制] 保存历史失败:', error?.message || error);
    }
    return null;
  }

  async function persistCurrentSession(extra = {}) {
    const modelId = String(el('ai-chat-model')?.value || state.currentSession?.modelId || '');
    ensureCurrentSession(modelId);
    const payload = buildCurrentSessionPayload(modelId, extra);
    upsertLocalSession(payload);
    const saved = await saveSessionToMain(payload);
    if (saved) {
      applySavedSession(saved, payload);
      await refreshHistoryList();
      return saved;
    }

    state.currentSession = { ...state.currentSession, ...payload };
    updateSessionTitleUi();
    await refreshHistoryList();
    return payload;
  }
