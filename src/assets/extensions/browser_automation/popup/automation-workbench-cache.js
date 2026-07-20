'use strict';

function resolveSoftwareCacheSettings(stored) {
    const settings = stored?.['agent-settings'];
    return settings && typeof settings === 'object' ? settings : {};
}

function softwareCacheAbortSignal() {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
}

async function getSoftwareCardCacheBrowserProcessId() {
    if (softwareCardCacheBrowserProcessId) return softwareCardCacheBrowserProcessId;
    if (!chrome.processes || typeof chrome.processes.getProcessInfo !== 'function') return 0;
    try {
        const processInfo = await chrome.processes.getProcessInfo([], false);
        const processes = Array.isArray(processInfo) ? processInfo : Object.values(processInfo || {});
        const browserProcess = processes.find((process) => String(process?.type || '').toLowerCase() === 'browser');
        softwareCardCacheBrowserProcessId = Number(browserProcess?.osProcessId || 0) || 0;
        return softwareCardCacheBrowserProcessId;
    } catch (_error) {
        return 0;
    }
}

async function requestSoftwareCardCacheDirect(path, options = {}) {
    const stored = await chrome.storage.local.get('agent-settings');
    const settings = resolveSoftwareCacheSettings(stored);
    const baseUrl = String(settings.localBridgeUrl || 'http://127.0.0.1:18765').replace(/\/+$/, '');
    const headers = { ...(options.headers || {}) };
    const appBrowserToken = String(globalThis.AI_FREE_BROWSER_ENVIRONMENT?.appBrowserToken || '').trim();
    if (!appBrowserToken) throw new Error('此插件仅允许在 AI-FREE 软件内置浏览器中使用');
    headers['X-AI-Free-Browser-Token'] = appBrowserToken;
    headers['X-AI-Free-Browser-Pid'] = String(await getSoftwareCardCacheBrowserProcessId());
    if (options.body != null) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: softwareCacheAbortSignal()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.message || `软件卡片库 HTTP ${response.status}`);
    }
    return data;
}

function normalizeSoftwareCardCacheResponse(source = {}) {
    const items = Array.isArray(source?.state?.items)
        ? source.state.items.map((item, index) => normalizeCardCacheEntry(item, index))
        : [];
    const requestedSelectedId = String(source?.state?.selectedId || '').trim();
    return {
        items,
        selectedId: items.some((item) => item.id === requestedSelectedId)
            ? requestedSelectedId
            : String(items[0]?.id || '').trim()
    };
}

async function loadBackgroundCardCache() {
    const response = await chrome.runtime.sendMessage({ type: 'card-cache-persistent-get' });
    if (!response || response.success !== true) {
        throw new Error(response?.error || '读取软件卡片库失败');
    }
    if (response.state?.persisted === false) {
        throw new Error(response.state?.persistError || '后台尚未同步软件卡片库');
    }
    return normalizeSoftwareCardCacheResponse(response);
}

async function loadDirectCardCache(local) {
    const direct = local.persistPending
        ? await requestSoftwareCardCacheDirect('/v1/card-cache', {
            method: 'PUT',
            body: JSON.stringify({ state: { items: local.items, selectedId: local.selectedId } })
        })
        : await requestSoftwareCardCacheDirect('/v1/card-cache');
    const normalized = normalizeSoftwareCardCacheResponse(direct);
    await saveLocalCardCacheState(normalized.items, normalized.selectedId, false);
    return normalized;
}

async function loadCardCacheState() {
    let backgroundError = null;
    try {
        return await loadBackgroundCardCache();
    } catch (error) {
        backgroundError = error;
    }

    const local = await loadLocalCardCacheState();
    try {
        return await loadDirectCardCache(local);
    } catch (directError) {
        local.persisted = false;
        local.persistError = directError?.message || backgroundError?.message || '读取软件卡片库失败';
        return local;
    }
}

function resolveCardCacheSelection(items, selectedId) {
    const requestedId = String(selectedId || '').trim();
    const normalizedId = items.some((item) => item.id === requestedId)
        ? requestedId
        : String(items[0]?.id || '').trim();
    const selectedItem = items.find((item) => item.id === normalizedId) || items[0] || {};
    return { normalizedId, selectedItem };
}

async function saveLocalCardCacheState(items = [], selectedId = '', persistPending = true) {
    const normalizedItems = Array.isArray(items) ? items.map((item, index) => normalizeCardCacheEntry(item, index)) : [];
    const { normalizedId, selectedItem } = resolveCardCacheSelection(normalizedItems, selectedId);
    await chrome.storage.local.set({
        [AUTOMATION_CARD_CACHE_LIST_KEY]: normalizedItems,
        [AUTOMATION_CARD_SELECTED_ID_KEY]: normalizedId,
        [AUTOMATION_CARD_CACHE_KEY]: selectedItem.cardData || {},
        [AUTOMATION_CARD_CACHE_NAME_KEY]: selectedItem.cardName || '',
        [AUTOMATION_CARD_CACHE_TIME_KEY]: selectedItem.savedAt || '',
        [AUTOMATION_CARD_PERSIST_PENDING_KEY]: persistPending === true
    });
    return {
        items: normalizedItems,
        selectedId: normalizedId
    };
}

async function saveBackgroundCardCache(normalized) {
    const response = await chrome.runtime.sendMessage({
        type: 'card-cache-persistent-set',
        payload: normalized
    });
    if (!response || response.success !== true || response.persisted !== true) {
        throw new Error(response?.error || '保存软件卡片库失败');
    }
    const savedItems = Array.isArray(response.state?.items)
        ? response.state.items.map((item, index) => normalizeCardCacheEntry(item, index))
        : [];
    return saveLocalCardCacheState(savedItems, response.state?.selectedId, false);
}

async function saveDirectCardCache(normalized) {
    const direct = await requestSoftwareCardCacheDirect('/v1/card-cache', {
        method: 'PUT',
        body: JSON.stringify({ state: normalized })
    });
    const saved = normalizeSoftwareCardCacheResponse(direct);
    return saveLocalCardCacheState(saved.items, saved.selectedId, false);
}

async function saveCardCacheState(items = [], selectedId = '') {
    const normalized = await saveLocalCardCacheState(items, selectedId, true);
    let backgroundError = null;
    try {
        return await saveBackgroundCardCache(normalized);
    } catch (error) {
        backgroundError = error;
    }

    // 后台 worker 可能正在随插件刷新而重载。弹窗具备同样的 loopback
    // 访问权限，直接写一次软件桥接，避免导入结果只停留在当前 Profile。
    try {
        return await saveDirectCardCache(normalized);
    } catch (directError) {
        // 本地镜像已经标为待同步，但不能再把“仅当前浏览器暂存”伪装成保存成功。
        const reason = directError?.message || backgroundError?.message || '保存软件卡片库失败';
        throw new Error(`${reason}（已暂存在当前浏览器，尚未完成跨窗口保存）`);
    }
}

function resolveUpsertCardId(cardData, options, state) {
    if (options.id) return options.id;
    if (options.append !== true && state.selectedId) return state.selectedId;
    return buildCardCacheId(cardData, options.fileName || cardData.name);
}

function mergeCardCacheItem(items, nextItem, existingIndex) {
    const nextItems = items.slice();
    if (existingIndex >= 0) nextItems.splice(existingIndex, 1, nextItem);
    else nextItems.push(nextItem);
    return nextItems;
}

async function refreshCardCacheUi() {
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    await renderCardCacheList(state);
    return state;
}

async function selectCardCacheItem(cardId) {
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const selectedId = String(cardId || '').trim();
    const item = state.items.find((entry) => String(entry.id || '').trim() === selectedId) || null;
    if (!item) {
        throw new Error('未找到可选中的自动化卡片');
    }

    await saveCardCacheState(state.items, item.id);
    if (isSidebarLayout()) {
        renderSidebarCardEditor(item.cardData);
        syncSidebarEditorToHiddenJson();
    } else {
        setCardEditorValue(item.cardData);
    }
    await renderCardCacheList({
        items: state.items,
        selectedId: item.id
    });
    return item;
}

async function upsertCardCache(cardData, options = {}) {
    const safeCardData = normalizeCardData(cardData, cardData?.name || options.fileName || 'automation', { allowEmptySteps: true });
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    // append=true 必须始终新增。旧逻辑会用当前 selectedId 查找，导致批量导入时
    // 后一张卡片把前一张替换掉。
    const requestedId = String(options.id || '').trim();
    const existingId = requestedId || (options.append === true ? '' : state.selectedId);
    const existingIndex = existingId ? state.items.findIndex((item) => item.id === existingId) : -1;
    const nextItem = normalizeCardCacheEntry({
        id: resolveUpsertCardId(safeCardData, options, state),
        cardData: safeCardData,
        cardName: safeCardData.name,
        sourceName: options.fileName || safeCardData.name,
        savedAt: new Date().toISOString()
    });

    const nextItems = mergeCardCacheItem(state.items, nextItem, existingIndex);

    const nextSelectedId = options.select === false ? state.selectedId || nextItem.id : nextItem.id;
    await saveCardCacheState(nextItems, nextSelectedId);
    await renderCardCacheList({ items: nextItems, selectedId: nextSelectedId });
    return {
        cardData: safeCardData,
        cardName: safeCardData.name,
        id: nextItem.id,
        selectedId: nextSelectedId
    };
}

function renderSidebarEditorFromCurrentState() {
    if (!isSidebarLayout()) {
        return;
    }

    try {
        const cardData = collectSidebarCardDataFromForm() || parseEditorCardData(getCardEditorValue() || '{}', { allowEmptySteps: true });
        renderSidebarCardEditor(cardData);
        syncSidebarEditorToHiddenJson();
    } catch (_error) {
        renderSidebarCardEditor({ name: '未命名自动化卡片', steps: [] });
        syncSidebarEditorToHiddenJson();
    }
}

async function saveCardCache(cardData) {
    const result = await upsertCardCache(cardData, { select: true });
    return result.cardData;
}

async function saveEditorCardToCache() {
    const cardData = isSidebarLayout()
        ? getSidebarCardDataFromEditor()
        : parseEditorCardData(getCardEditorValue(), { allowEmptySteps: true });
    const saved = await saveCardCache(cardData);
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    await renderCardCacheList(state);
    return saved;
}


globalThis.CookieCaptureAutomationWorkbench = {
    sanitizeFilePart,
    buildPresetFileName,
    generateCookiePassword,
    setStatus,
    copyTextToClipboard,
    downloadJsonFile,
    showToast,
    showActionToast,
    openTutorialPage,
    loadLastMainPanel,
    saveLastMainPanel,
    activateMainPanel,
    setCardFileName,
    setCardCacheBadge,
    buildCardExportFileName,
    buildCardCacheId,
    normalizeCardCacheEntry,
    buildCardListLabel,
    renderCardCacheList,
    resolveStepVariableKey,
    getCardTypeStepVariables,
    renderCardRunInputs,
    collectCardRunInputs,
    loadCardRunInputsCache,
    saveCardRunInputsForCard,
    normalizeProgressValue,
    setDebugProgress,
    resetDebugProgress,
    scheduleDebugProgressAutoHide,
    clearDebugProgressAutoHideTimer,
    loadStandaloneProgressState,
    formatStepTypeLabel,
    setLoopButtonState,
    refreshLoopButtonState,
    sendStopAction,
    sendContinueAction,
    normalizeCardData,
    stringifyCardData,
    parseEditorCardData,
    setCardEditorValue,
    getCardEditorValue,
    isSidebarLayout,
    sanitizeSidebarStepIdPart,
    buildSidebarStepId,
    ensureSidebarStepIds,
    getSidebarStepId,
    normalizeSidebarFlowForSteps,
    computeSidebarFlowLayeredLayout,
    buildSidebarFlowEdgeGeometry,
    renderSidebarFlowCanvas,
    clearSidebarFlowNodeSelection,
    prepareSidebarFlowNodeContextSelection,
    positionSidebarNodeSettings,
    setSidebarFlowZoom,
    zoomSidebarFlowBy,
    resetSidebarFlowView,
    beginSidebarFlowCanvasPan,
    addSidebarStepToCanvas,
    selectSidebarFlowNode,
    setSidebarFlowConnectMode,
    toggleSidebarFlowConnectMode,
    addSidebarFlowEdge,
    handleSidebarFlowNodeClick,
    beginSidebarFlowPortDrag,
    deleteSidebarFlowEdge,
    deleteSelectedSidebarFlowNodes,
    applySidebarFlowAutoLayout,
    beginSidebarFlowNodeDrag,
    escapeHtml,
    normalizeSidebarPopupsInput,
    formatSidebarPopupsInput,
    decodeHtmlEntities,
    escapeCssIdentifier,
    escapeCssAttributeValue,
    escapeHasTextValue,
    normalizeSelectorText,
    looksLikeHtmlSnippet,
    buildStandardSelectorFromHtmlSnippet,
    normalizeSelectorInputValue,
    normalizeSidebarStepSelectorControl,
    updateSidebarEditorMeta,
    buildSidebarStepTemplate,
    collectSidebarStepExpansionState,
    buildSidebarStepSummary,
    buildSidebarStepCardHtml,
    updateSidebarStepSettingsVisibility,
    collectSidebarStepCards,
    readSidebarStepCard,
    collectSidebarSteps,
    resetSidebarStepStatuses,
    applyExecutionStatusToSidebarStep,
    syncSidebarEditorToHiddenJson,
    collectSidebarCardDataFromForm,
    renderSidebarCardEditor,
    getSidebarCardDataFromEditor,
    getCardDataForExport,
    exportCard,
    loadCardCacheState,
    saveCardCacheState,
    refreshCardCacheUi,
    selectCardCacheItem,
    upsertCardCache,
    renderSidebarEditorFromCurrentState,
    saveCardCache,
    saveEditorCardToCache
};
