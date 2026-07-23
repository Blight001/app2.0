  async function refreshModelAccessState() {
    try {
      const session = await window.aiFree.account.getSession();
      state.accountAuthenticated = session?.authenticated === true;
      state.vipActive = window.isSidebarVipActive?.(session) === true;
    } catch (_) {
      state.accountAuthenticated = false;
      state.vipActive = false;
    }
  }

  function createModelOption(model) {
    const option = document.createElement('option');
    option.value = String(model.id || '');
    const customApi = model.custom_api === true;
    if (!customApi) {
      option.dataset.quotaMultiplier = String(Number(model.quota_multiplier || 1));
      option.dataset.tokensPerQuotaUnit = String(Number(model.tokens_per_quota_unit || 10000));
    }
    option.dataset.customApi = customApi ? 'true' : 'false';
    option.textContent = String(model.name || model.model || model.id || '未命名模型');
    return option;
  }

  function renderModelOptions(select, models, preferred) {
    select.innerHTML = '';
    if (!models.length) {
      select.innerHTML = '<option value="" disabled>管理员尚未配置模型</option>';
      select.disabled = false;
      return;
    }
    models.forEach((model) => select.appendChild(createModelOption(model)));
    if (preferred && Array.from(select.options).some((option) => option.value === preferred)) {
      select.value = preferred;
    }
    select.disabled = false;
  }

  async function loadModels(preferredModelId = '') {
    const select = el('ai-chat-model');
    const getModels = getAiModelsApi();
    if (!select || !getModels) return;
    const preferred = String(preferredModelId || state.currentSession?.modelId || select.value || '');
    select.disabled = true;
    select.innerHTML = '<option value="">正在读取可用模型...</option>';
    syncSelectUi(select);
    setStatus('');
    try {
      await refreshModelAccessState();
      syncSendState();
      const result = requireAiDataResult(await getModels(), '模型加载失败');
      const models = Array.isArray(result.models) ? result.models : [];
      renderModelOptions(select, models, preferred);
      syncSelectUi(select);
      renderQuota(result.quota);
    } catch (error) {
      select.innerHTML = '<option value="" disabled>暂无可用模型</option>';
      select.disabled = false;
      syncSelectUi(select);
      renderQuota(null);
      setStatus(aiDataErrorMessage(error));
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
    const redeem = getGiftCodeApi();
    if (!redeem) return;
    if (button) button.disabled = true;
    try {
      const result = requireAiDataResult(await redeem({ code }), '礼品码兑换失败');
      if (input) input.value = '';
      state.lastQuotaCost = null;
      const quotaRecorder = window.AiFreeQuotaDisplay?.recordAIResetAfterRedeem;
      const displayQuota = quotaRecorder?.(result.quota, result.added_quota) || result.quota;
      renderQuota(displayQuota);
      setStatus(result.message || '礼品码兑换成功', 'success');
    } catch (error) {
      setStatus(aiDataErrorMessage(error), 'warning');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function createBrowserConnectionOption(connection) {
    const option = document.createElement('option');
    option.value = String(connection.id || '');
    const browserName = String(connection.browserName || connection.name || 'AI自动化浏览器');
    option.textContent = `${browserName} · ${Number(connection.toolCount || 0)} 个工具`;
    option.title = browserName;
    return option;
  }

  function createSoftwareTargetOption(target) {
    const option = document.createElement('option');
    const profileId = String(target.profileId || '');
    option.value = `${SOFTWARE_TARGET_PREFIX}${profileId}`;
    option.dataset.targetType = 'software';
    option.textContent = `${String(target.name || '外部软件')} · 软件 UI`;
    option.title = `软件视觉控制 · PID ${Number(target.pid || 0)}`;
    return option;
  }

  function selectBrowserTarget(allIds, previousIds, softwareProfileId) {
    if (softwareProfileId) return '';
    const availableIds = new Set(allIds);
    const survivingId = previousIds.find((id) => availableIds.has(id)) || '';
    const previousAvailableIds = new Set(state.availableBrowserIds);
    const newIds = state.browserConnectionsInitialized
      ? allIds.filter((id) => !previousAvailableIds.has(id))
      : [];
    if (state.browserConnectionsInitialized) {
      return newIds.at(-1) || survivingId || allIds[0] || '';
    }
    if (state.browserSelectionTouched && survivingId) return survivingId;
    return allIds[0] || '';
  }

  function selectSoftwareTarget(softwareTargets, allSoftwareIds, previousSoftwareId) {
    if (allSoftwareIds.includes(previousSoftwareId)) return previousSoftwareId;
    if (!state.browserSelectionTouched) {
      const active = softwareTargets.find((item) => item?.isActive === true);
      if (active) return String(active.profileId || '');
    }
    return '';
  }

  function resolveControlSelection(connections, softwareTargets, previousIds, previousSoftwareId) {
    const allIds = normalizeBrowserIds(connections.map((item) => String(item.id || '')));
    const allSoftwareIds = normalizeBrowserIds(
      softwareTargets.map((item) => String(item.profileId || '')),
    );
    if (state.browserSelectionExplicitlyDisabled) {
      return { allIds, allSoftwareIds, selectedIds: [], softwareProfileId: '' };
    }
    const preferredSoftwareId = selectSoftwareTarget(
      softwareTargets, allSoftwareIds, previousSoftwareId,
    );
    const selectedId = selectBrowserTarget(allIds, previousIds, preferredSoftwareId);
    const selectedIds = selectedId ? [selectedId] : [];
    const softwareProfileId = preferredSoftwareId
      || (selectedIds.length ? '' : allSoftwareIds[0] || '');
    return {
      allIds,
      allSoftwareIds,
      selectedIds: softwareProfileId ? [] : selectedIds,
      softwareProfileId,
    };
  }

  function syncBrowserSessionSelection() {
    if (!state.currentSession || currentMessages().length) return;
    state.currentSession.browserConnectionId = state.currentBrowserIds[0] || '';
    state.currentSession.browserConnectionIds = [...state.currentBrowserIds];
    state.currentSession.softwareProfileId = state.currentSoftwareProfileId;
  }

  function applyBrowserConnections(
    select, connections, softwareTargets, previousIds, previousSoftwareId,
  ) {
    state.browserConnectionsSnapshot = browserConnectionsSnapshot(connections, softwareTargets);
    state.browserConnectionsError = '';
    state.browserConnectionProfileById = Object.fromEntries(connections.map((connection) => [
      String(connection?.id || ''),
      String(connection?.profileId || ''),
    ]));
    select.innerHTML = '<option value="">不使用控制目标</option>';
    connections.forEach((connection) => select.appendChild(createBrowserConnectionOption(connection)));
    softwareTargets.forEach((target) => select.appendChild(createSoftwareTargetOption(target)));
    const selection = resolveControlSelection(
      connections, softwareTargets, previousIds, previousSoftwareId,
    );
    const selectionChanged = selection.selectedIds.join(',') !== state.currentBrowserIds.join(',')
      || selection.softwareProfileId !== state.currentSoftwareProfileId;
    const { allIds, allSoftwareIds, selectedIds, softwareProfileId } = selection;
    state.availableBrowserIds = allIds;
    state.availableSoftwareProfileIds = allSoftwareIds;
    state.browserConnectionsInitialized = true;
    setSelectControlTarget(select, selectedIds, softwareProfileId);
    state.currentBrowserIds = selectedIds;
    state.currentSoftwareProfileId = softwareProfileId;
    if (selectedIds.length || softwareProfileId) state.browserSelectionExplicitlyDisabled = false;
    syncBrowserSessionSelection();
    select.title = connections.length || softwareTargets.length
      ? `可选 ${connections.length} 个浏览器和 ${softwareTargets.length} 个软件窗口`
      : '未发现可控制的浏览器或软件窗口';
    syncSelectUi(select);
    notifyBrowserSelection();
    if (selectionChanged && !currentMessages().length) renderWelcome();
  }

  function clearBrowserConnections(select, errorMessage) {
    const selectionChanged = Boolean(
      state.currentBrowserIds.length || state.currentSoftwareProfileId,
    );
    select.innerHTML = '<option value="">未发现控制目标</option>';
    state.currentBrowserIds = [];
    state.currentSoftwareProfileId = '';
    state.availableBrowserIds = [];
    state.availableSoftwareProfileIds = [];
    state.browserConnectionsInitialized = false;
    state.browserConnectionsSnapshot = '';
    state.browserConnectionsError = errorMessage;
    state.browserConnectionProfileById = {};
    syncBrowserSessionSelection();
    syncSelectUi(select);
    notifyBrowserSelection();
    if (selectionChanged && !currentMessages().length) renderWelcome();
    console.warn('[AI 控制] 浏览器连接读取失败:', errorMessage);
  }

  function shouldDeferDynamicDataRefresh() {
    if (!aiInputHasActiveDraft()) return false;
    state.dynamicDataRefreshQueued = true;
    return true;
  }

  function canLoadBrowserConnections(select) {
    return Boolean(select && getBrowserConnectionsApi() && !state.browserConnectionsLoading);
  }

  function shouldApplyBrowserConnections(connections, softwareTargets) {
    const snapshot = browserConnectionsSnapshot(connections, softwareTargets);
    return !state.browserConnectionsInitialized
      || snapshot !== state.browserConnectionsSnapshot
      || Boolean(state.browserConnectionsError);
  }

  function shouldClearBrowserConnections(errorMessage) {
    return state.browserConnectionsInitialized
      || Boolean(state.currentBrowserIds.length)
      || Boolean(state.currentSoftwareProfileId)
      || state.browserConnectionsError !== errorMessage;
  }

  async function loadBrowserConnections() {
    const select = el('ai-chat-browser');
    const getConnections = getBrowserConnectionsApi();
    if (!canLoadBrowserConnections(select)) return;
    if (shouldDeferDynamicDataRefresh()) return;
    state.browserConnectionsLoading = true;
    const previousIds = normalizeBrowserIds([...getSelectBrowserIds(select), ...state.currentBrowserIds]);
    const previousSoftwareId = getSelectSoftwareProfileId(select)
      || state.currentSoftwareProfileId;
    try {
      const result = requireAiDataResult(await getConnections(), '浏览器连接读取失败');
      if (shouldDeferDynamicDataRefresh()) return;
      const connections = Array.isArray(result.connections) ? result.connections : [];
      const softwareTargets = Array.isArray(result.softwareTargets) ? result.softwareTargets : [];
      // 心跳轮询只负责发现连接变化。列表内容没变时不重建 select/menu，
      // 也不重复广播到主窗口，避免打断 textarea 的中文输入法合成状态。
      if (!shouldApplyBrowserConnections(connections, softwareTargets)) return;
      applyBrowserConnections(
        select, connections, softwareTargets, previousIds, previousSoftwareId,
      );
    } catch (error) {
      if (shouldDeferDynamicDataRefresh()) return;
      const errorMessage = aiDataErrorMessage(error);
      if (!shouldClearBrowserConnections(errorMessage)) return;
      clearBrowserConnections(select, errorMessage);
    } finally {
      state.browserConnectionsLoading = false;
    }
  }

  function cardExists(cards, cardId) {
    return Boolean(cardId) && cards.some((card) => String(card.id) === cardId);
  }

  function resolveAutomationCardId(cards, preferredId, sharedId) {
    const explicitId = String(preferredId || '').trim();
    const requestedId = String(explicitId || state.currentCardId || '').trim();
    const requestedExists = cardExists(cards, requestedId);
    const sharedExists = cardExists(cards, sharedId);
    if (explicitId && requestedExists) return requestedId;
    if (sharedId && sharedId !== state.sharedAutomationCardId && sharedExists) return sharedId;
    if (requestedExists) return requestedId;
    if (sharedExists) return sharedId;
    return String(cards[0]?.id || '');
  }

  async function applyAutomationCards(result, preferredId) {
    const cards = Array.isArray(result.cards) ? result.cards : [];
    const sharedId = String(result.selectedId || '').trim();
    const snapshot = automationCardsSnapshot(cards, sharedId);
    let changed = snapshot !== state.automationCardsSnapshot || Boolean(state.automationCardsError);
    const previousCardId = state.currentCardId;
    state.automationCardsSnapshot = snapshot;
    state.automationCardsError = '';
    state.automationCards = cards;
    state.currentCardId = resolveAutomationCardId(cards, preferredId, sharedId);
    state.sharedAutomationCardId = sharedId;
    changed = changed || previousCardId !== state.currentCardId;
    if (state.currentCardId && state.currentCardId !== sharedId) {
      await selectAutomationCard(state.currentCardId, { persist: false, silent: true });
    }
    if (state.currentSession && !currentMessages().length) {
      state.currentSession.automationCardId = state.currentCardId;
    }
    return changed;
  }

  function refreshAutomationCardUi(uiChanged) {
    if (!uiChanged) return;
    if (aiInputHasActiveDraft()) {
      state.dynamicUiRefreshPending = true;
      return;
    }
    syncSelectUi(el('ai-chat-browser'));
    if (!currentMessages().length) renderWelcome();
  }

  function runQueuedAutomationCardRefresh() {
    if (!state.automationCardsRefreshQueued) return;
    const queuedPreferredId = state.automationCardsQueuedPreferredId;
    state.automationCardsRefreshQueued = false;
    state.automationCardsQueuedPreferredId = '';
    window.setTimeout(() => { void loadAutomationCards(queuedPreferredId); }, 0);
  }

  function queueAutomationCardRefresh(preferredId) {
    state.automationCardsRefreshQueued = true;
    if (preferredId) state.automationCardsQueuedPreferredId = String(preferredId);
  }

  async function loadAutomationCards(preferredId = '') {
    const getCards = getAutomationCardsApi();
    if (!getCards) return;
    if (shouldDeferDynamicDataRefresh()) return;
    if (state.automationCardsLoading) {
      queueAutomationCardRefresh(preferredId);
      return;
    }
    state.automationCardsLoading = true;
    let uiChanged = false;
    try {
      const result = requireAiDataResult(await getCards(), '自动化卡片读取失败');
      if (shouldDeferDynamicDataRefresh()) return;
      uiChanged = await applyAutomationCards(result, preferredId);
    } catch (error) {
      if (shouldDeferDynamicDataRefresh()) return;
      const errorMessage = aiDataErrorMessage(error);
      uiChanged = state.automationCardsError !== errorMessage;
      state.automationCardsError = errorMessage;
      console.warn('[AI 控制] 自动化卡片读取失败:', state.automationCardsError);
    } finally {
      state.automationCardsLoading = false;
      refreshAutomationCardUi(uiChanged);
      runQueuedAutomationCardRefresh();
    }
  }
  function aiDataErrorMessage(value, fallback = '') {
    return String(value?.message || value?.error || fallback || value || '');
  }

  function requireAiDataResult(result, fallback) {
    if (!result?.ok) throw new Error(aiDataErrorMessage(result, fallback));
    return result;
  }

  function getAiModelsApi() {
    return window.aiFree?.ai?.getModels;
  }

  function getGiftCodeApi() {
    return window.aiFree?.ai?.redeemGiftCode;
  }

  function getBrowserConnectionsApi() {
    return window.aiFree?.ai?.getBrowserConnections;
  }

  function getAutomationCardsApi() {
    return window.aiFree?.ai?.getAutomationCards;
  }
