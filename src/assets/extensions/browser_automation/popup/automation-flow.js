try {
    const layout = new URL(window.location.href).searchParams.get('layout') === 'sidebar' ? 'sidebar' : 'popup';
    document.documentElement.dataset.layout = layout;
} catch (_error) {
    document.documentElement.dataset.layout = 'popup';
}

await import('./shared.js');
await import('./cookie-credentials.js');

const shared = globalThis.CookieCaptureShared || {};
const cookieModule = globalThis.CookieCaptureCookieCredentials || {};
const {
    formatCookieCredentialTime,
    padCookieCredentialDatePart,
    getTodayCookieCredentialDateKey,
    getCookieCredentialDateKey,
    getCookieCredentialDateFromKey,
    getCookieCredentialYesterdayKey,
    formatCookieCredentialDateLabel,
    formatCookieCredentialTimeLabel,
    buildCookieCredentialSearchText,
    normalizeCookieCredentialSearchQuery,
    cookieCredentialItemMatchesQuery,
    buildCookieCredentialCacheId,
    normalizeCookieCredentialCacheEntry,
    buildCookieCredentialListLabel,
    buildCookieCredentialClipboardText,
    buildCookieCredentialAccountPasswordText,
    buildCookieCredentialGroupAccountPasswordText,
    focusCookieCredentialEditPanel,
    closeCookieCredentialEditPanel,
    syncCookieCredentialEditUi,
    setCookieCredentialEditTarget,
    clearCookieCredentialEditTarget,
    loadCookieCredentialCacheState,
    saveCookieCredentialCacheState,
    loadCookieCredentialFilterState,
    saveCookieCredentialFilterState,
    setCookieCredentialSelectedDate,
    setCookieCredentialSearchQuery,
    getCookieCredentialSelectedDateValue,
    getCookieCredentialVisibleItems,
    buildCookieCredentialDateOptions,
    renderCookieCredentialDateFilterOptions,
    buildCookieCredentialEmptyMessage,
    renderCookieCredentialCacheList,
    refreshCookieCredentialCacheUi,
    rerenderCookieCredentialCacheUi,
    copyCookieCredentialItem,
    copyCookieCredentialAccountPasswordItem,
    copyCookieCredentialAccountPasswordGroup,
    editCookieCredentialItem,
    saveCookieCredentialEditRecord,
    deleteCookieCredentialItem,
    savePreset,
    loadPreset,
    saveCookieCredentialRecord,
    captureCurrentTab,
    clearCurrentPageCache
} = cookieModule;

const ACCOUNT_KEY = shared.STORAGE_KEYS.ACCOUNT_KEY;
const PASSWORD_KEY = shared.STORAGE_KEYS.PASSWORD_KEY;
const COOKIE_NOTE_KEY = shared.STORAGE_KEYS.COOKIE_NOTE_KEY;
const COOKIE_CARD_KEY = shared.STORAGE_KEYS.COOKIE_CARD_KEY;
const COOKIE_CREDENTIAL_CACHE_LIST_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_CACHE_LIST_KEY;
const COOKIE_CREDENTIAL_SELECTED_DATE_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_SELECTED_DATE_KEY;
const COOKIE_CREDENTIAL_SEARCH_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_SEARCH_KEY;
const COOKIE_CREDENTIAL_CACHE_MAX_ITEMS = 50;
const AUTOMATION_CARD_CACHE_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_KEY;
const AUTOMATION_CARD_CACHE_NAME_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_NAME_KEY;
const AUTOMATION_CARD_CACHE_TIME_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_TIME_KEY;
const AUTOMATION_CARD_CACHE_LIST_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_LIST_KEY;
const AUTOMATION_CARD_SELECTED_ID_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_SELECTED_ID_KEY;
const AUTOMATION_CARD_RUN_INPUTS_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_RUN_INPUTS_KEY;
const LAST_MAIN_PANEL_KEY = shared.STORAGE_KEYS.LAST_MAIN_PANEL_KEY;
const STANDALONE_PROGRESS_STATE_KEY = shared.STORAGE_KEYS.STANDALONE_PROGRESS_STATE_KEY;


const accountInput = document.getElementById('account');
const passwordInput = document.getElementById('password');
const cookieNoteInput = document.getElementById('cookie-note');
const cookieCardKeyInput = document.getElementById('cookie-card-key');
const generateCookiePasswordButton = document.getElementById('generate-cookie-password');
const copyAccountPasswordButton = document.getElementById('copy-account-password');
const saveCookieCredentialsButton = document.getElementById('save-cookie-credentials');
const cookieCredentialEditPanelNode = document.getElementById('cookie-credential-edit-panel');
const cookieCredentialEditPanelSubtitleNode = document.getElementById('cookie-credential-edit-panel-subtitle');
const editCookieAccountInput = document.getElementById('edit-account');
const editCookiePasswordInput = document.getElementById('edit-password');
const editCookieNoteInput = document.getElementById('edit-note');
const editCookieCardKeyInput = document.getElementById('edit-card-key');
const saveCookieCredentialEditButton = document.getElementById('save-cookie-credential-edit');
const cancelCookieEditButton = document.getElementById('cancel-cookie-edit');
const cookieCredentialDateFilterNode = document.getElementById('cookie-credential-date-filter');
const cookieCredentialSearchNode = document.getElementById('cookie-credential-search');
const captureButton = document.getElementById('capture');
const clearCurrentPageCacheButton = document.getElementById('clear-current-page-cache');
const statusNode = document.getElementById('status');
const cookieCredentialCountNode = document.getElementById('cookie-credential-count');
const cookieCredentialListNode = document.getElementById('cookie-credential-list');
const importCardButton = document.getElementById('import-card');
const loopCardButton = document.getElementById('loop-card');
const cardFileNameNode = document.getElementById('card-file-name');
const cardCacheBadgeNode = document.getElementById('card-cache-badge');
const cardCacheListNode = document.getElementById('card-cache-list');
const deleteCardButton = document.getElementById('delete-card');
const cardEditor = document.getElementById('card-editor');
const loadCardToEditorButton = document.getElementById('load-card-to-editor');
const saveCardEditorButton = document.getElementById('save-card-editor');
const exportCardButton = document.getElementById('export-card');
const appendStepButton = document.getElementById('append-step');
const stepTypeSelect = document.getElementById('step-type');
const stepNameInput = document.getElementById('step-name');
const stepSelectorInput = document.getElementById('step-selector');
const stepTextInput = document.getElementById('step-text');
const stepUrlInput = document.getElementById('step-url');
const stepTimeoutInput = document.getElementById('step-timeout');
const heroTutorialButton = document.getElementById('hero-tutorial');
const openCardSidebarButton = document.getElementById('open-card-sidebar');
const mainTabsNode = document.getElementById('main-tabs');
const mainTabButtons = Array.from(document.querySelectorAll('[data-main-tab]'));
const mainPanels = Array.from(document.querySelectorAll('[data-main-panel]'));
const toastStackNode = document.getElementById('toast-stack');
const sidebarEditorShell = document.getElementById('sidebar-editor-shell');
const sidebarCardNameInput = document.getElementById('sidebar-card-name');
const sidebarCardWebsiteInput = document.getElementById('sidebar-card-website');
const sidebarCardDescriptionInput = document.getElementById('sidebar-card-description');
const sidebarCardPointsInput = document.getElementById('sidebar-card-points');
const sidebarCardPopupsInput = document.getElementById('sidebar-card-popups');
const sidebarCardUploadServerUrlInput = document.getElementById('sidebar-card-upload-server-url');
const sidebarCardUploadCardKeyInput = document.getElementById('sidebar-card-upload-card-key');
const sidebarCardRawJsonInput = document.getElementById('sidebar-card-raw-json');
const sidebarStepTemplateSelect = document.getElementById('sidebar-step-template');
const sidebarAddStepButton = document.getElementById('sidebar-add-step');
const sidebarRefreshCardButton = document.getElementById('sidebar-refresh-card');
const sidebarCloseButton = document.getElementById('sidebar-close');
const sidebarStepListNode = document.getElementById('sidebar-step-list');
const sidebarEditorMetaNode = document.getElementById('sidebar-editor-meta');
const TUTORIAL_URL = 'https://www.yuque.com/heysure/mn6q55/lyorlysczr8eh39b?singleDoc#';
const runtimeStateStorage = chrome.storage.session || chrome.storage.local;

await import('./automation-workbench.js');
const workbenchModule = globalThis.CookieCaptureAutomationWorkbench || {};
const {
    buildPresetFileName,
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
    getCardTypeStepVariables,
    renderCardRunInputs,
    collectCardRunInputs,
    normalizeProgressValue,
    loadStandaloneProgressState,

    formatStepTypeLabel,
    setLoopButtonState,
    refreshLoopButtonState,
    sendStopAction,
    normalizeCardData,
    stringifyCardData,
    parseEditorCardData,
    setCardEditorValue,
    getCardEditorValue,
    isSidebarLayout,
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
    saveEditorCardToCache,
    setDebugProgress,
    resetDebugProgress
} = workbenchModule;

async function loadCardIntoEditor() {
    const cachedCard = await loadCardCache().catch(() => null);
    const cardData = cachedCard?.cardData || null;
    if (!cardData) {
        throw new Error('没有可载入的自动化卡片');
    }
    if (isSidebarLayout()) {
        renderSidebarCardEditor(cardData);
        syncSidebarEditorToHiddenJson();
    } else {
        setCardEditorValue(cardData);
    }
    if (cardData?.name) {
        setCardFileName(cardData.name);
    }
    return cardData;
}

async function loadCardCache() {
    const state = await loadCardCacheState();
    if (!state.items.length) {
        return null;
    }
    const selectedCard = state.items.find((item) => item.id === state.selectedId) || state.items[0];
    if (!selectedCard) {
        return null;
    }
    return {
        cardData: selectedCard.cardData,
        cardName: String(selectedCard.cardName || selectedCard.cardData?.name || '').trim(),
        savedAt: String(selectedCard.savedAt || '').trim(),
        items: state.items,
        selectedId: state.selectedId
    };
}

async function clearCardCache() {
    await chrome.storage.local.remove([
        AUTOMATION_CARD_CACHE_LIST_KEY,
        AUTOMATION_CARD_SELECTED_ID_KEY,
        AUTOMATION_CARD_CACHE_KEY,
        AUTOMATION_CARD_CACHE_NAME_KEY,
        AUTOMATION_CARD_CACHE_TIME_KEY
    ]);
    void renderCardCacheList({ items: [], selectedId: '' });
    setCardFileName('未选择卡片');
}

async function deleteSelectedCardCache() {
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const items = Array.isArray(state.items) ? state.items : [];
    if (!items.length) {
        throw new Error('没有可删除的自动化卡片');
    }

    const selectedId = String(state.selectedId || items[0]?.id || '').trim();
    const selectedIndex = items.findIndex((item) => String(item.id || '').trim() === selectedId);
    const removeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const deletedItem = items[removeIndex] || null;
    const nextItems = items.slice();
    nextItems.splice(removeIndex, 1);

    if (nextItems.length === 0) {
        await chrome.storage.local.remove([
            AUTOMATION_CARD_CACHE_LIST_KEY,
            AUTOMATION_CARD_SELECTED_ID_KEY,
            AUTOMATION_CARD_CACHE_KEY,
            AUTOMATION_CARD_CACHE_NAME_KEY,
            AUTOMATION_CARD_CACHE_TIME_KEY
        ]);
        void renderCardCacheList({ items: [], selectedId: '' });
        setCardFileName('未选择卡片');
        return deletedItem;
    }

    const nextSelectedId = String(nextItems[0]?.id || '').trim();
    await saveCardCacheState(nextItems, nextSelectedId);
    const nextItem = nextItems.find((item) => item.id === nextSelectedId) || nextItems[0];
    if (isSidebarLayout()) {
        renderSidebarCardEditor(nextItem.cardData);
        syncSidebarEditorToHiddenJson();
    } else {
        setCardEditorValue(nextItem.cardData);
    }
    void renderCardCacheList({
        items: nextItems,
        selectedId: nextSelectedId
    });
    setCardFileName(nextItem.cardData?.name || nextItem.cardName || '未选择卡片');
    return deletedItem;
}

function parseImportedCardText(rawText = '', sourceName = '粘贴导入') {
    const text = String(rawText || '').trim();
    if (!text) {
        throw new Error('请输入卡片流程数据');
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (_error) {
        throw new Error('卡片流程数据不是有效的 JSON');
    }

    let candidates = [];
    if (Array.isArray(parsed)) {
        candidates = parsed;
    } else if (Array.isArray(parsed?.cards)) {
        candidates = parsed.cards;
    } else if (Array.isArray(parsed?.items)) {
        candidates = parsed.items.map((item) => item?.cardData || item);
    } else {
        candidates = [parsed?.cardData || parsed];
    }
    const validCandidates = candidates.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (validCandidates.length === 0) {
        throw new Error('未识别到自动化卡片数据');
    }
    const cards = [];
    validCandidates.forEach((cardData, index) => {
        const fallbackName = validCandidates.length === 1 ? sourceName : `${sourceName}#${index + 1}`;
        const normalized = normalizeCardData(cardData, fallbackName, { allowEmptySteps: true });
        Object.defineProperty(normalized, '__importSourceName', {
            value: sourceName,
            enumerable: false,
            configurable: true
        });
        cards.push(normalized);
    });
    return cards;
}

function sendStandaloneMessage(payload) {
    return chrome.runtime.sendMessage(payload);
}

async function openCardEditorSidebar() {
    const result = await chrome.runtime.sendMessage({
        type: 'open-card-editor-sidebar',
        payload: {
            width: 900
        }
    });

    if (!result || result.success !== true) {
        throw new Error(result?.error || '打开侧边栏失败');
    }

    return result;
}

async function resolveCardForRun() {
    if (isSidebarLayout()) {
        const cardData = normalizeCardData(getSidebarCardDataFromEditor(), 'automation');
        await saveCardCache(cardData);
        return cardData;
    }

    const editorText = getCardEditorValue().trim();
    if (editorText) {
        const cardData = parseEditorCardData(editorText);
        await saveCardCache(cardData);
        return cardData;
    }

    const cachedCard = await loadCardCache().catch(() => null);
    if (cachedCard?.cardData) {
        const cardData = normalizeCardData(cachedCard.cardData, cachedCard?.cardName || cachedCard.cardData?.name || 'automation');
        setCardEditorValue(cardData);
        return cardData;
    }

    throw new Error('请先导入或编辑自动化卡片');
}

async function importCardTextToCache(rawText = '') {
    const selectedCards = parseImportedCardText(rawText);
    if (!selectedCards.length) {
        return null;
    }

    const items = [];
    for (const cardData of selectedCards) {
        const result = await upsertCardCache(cardData, {
            append: true,
            select: false,
            fileName: cardData.__importSourceName || cardData.name
        });
        items.push({
            id: result.id,
            cardData: result.cardData,
            cardName: result.cardName,
            savedAt: new Date().toISOString(),
            sourceName: cardData.__importSourceName || cardData.name
        });
    }

    const selectedItem = items[items.length - 1] || null;
    if (selectedItem) {
        const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
        await saveCardCacheState(state.items, selectedItem.id);
        void renderCardCacheList({
            items: state.items,
            selectedId: selectedItem.id
        });
        if (isSidebarLayout()) {
            renderSidebarCardEditor(selectedItem.cardData);
            syncSidebarEditorToHiddenJson();
        } else {
            setCardEditorValue(selectedItem.cardData);
        }
        setCardFileName(selectedItem.cardName);
    }

    return {
        items,
        selectedItem
    };
}

async function importAndStartCard() {
    importCardButton.disabled = true;
    showActionToast('正在准备自动化卡片...', 'info');
    setDebugProgress({
        visible: true,
        progress: 5,
        message: '正在启动自动化流程...',
        meta: '执行模式',
        mode: 'run'
    });
    showActionToast('正在启动自动化流程...', 'info');

    try {
        // 先收集用户在变量输入框里填写的值。
        // 现在变量输入会持久化到缓存（即使重渲染或重开 popup 也不会丢失上次填的值），
        // 但在重渲染前采集仍是最稳妥的做法。
        const runInputs = typeof collectCardRunInputs === 'function' ? collectCardRunInputs() : {};
        await savePreset();
        const cardData = await resolveCardForRun();
        const savedCardData = await saveCardCache(cardData);

        if (isSidebarLayout() && typeof resetSidebarStepStatuses === 'function' && typeof applyExecutionStatusToSidebarStep === 'function') {
            resetSidebarStepStatuses();
            const stepCount = Array.isArray(savedCardData.steps) ? savedCardData.steps.length : 0;
            for (let i = 1; i <= stepCount; i++) {
                applyExecutionStatusToSidebarStep(i, 'pending');
            }
        }

        showActionToast(`已启动本地执行: ${savedCardData.name}`, 'info');
        void sendStandaloneMessage({
            type: 'card-run-start',
            payload: {
                cardData: savedCardData,
                inputs: runInputs
            }
        }).catch((error) => {
            const msg = error && error.message ? error.message : '启动执行失败';
            showActionToast(msg, 'error');
        });

    } catch (error) {
        const msg = error && error.message ? error.message : '导入并执行失败';
        showActionToast(msg, 'error');
    } finally {
        importCardButton.disabled = false;
    }
}

async function loopCard() {
    const isRunning = await refreshLoopButtonState();
    if (isRunning) {
        loopCardButton && (loopCardButton.disabled = true);
        showActionToast('正在停止执行流程...', 'info');
        try {
            await sendStopAction();
            showActionToast('已停止执行流程', 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '停止执行失败', 'error');
            await refreshLoopButtonState().catch(() => {});
        } finally {
            if (loopCardButton) {
                loopCardButton.disabled = false;
            }
        }
        return;
    }

    loopCardButton && (loopCardButton.disabled = true);
    showActionToast('正在启动循环执行...', 'info');
    setDebugProgress({
        visible: true,
        progress: 5,
        message: '正在启动循环执行...',
        meta: '循环执行',
        mode: 'loop'
    });
    showActionToast('正在启动执行...', 'info');

    try {
        // 同 importAndStartCard：在重渲染前采集用户输入的变量值。
        // 变量输入已支持持久化缓存，跨打开不会重置。
        const loopInputs = typeof collectCardRunInputs === 'function' ? collectCardRunInputs() : {};
        const cardData = await resolveCardForRun();
        await saveCardCache(cardData);

        if (isSidebarLayout() && typeof resetSidebarStepStatuses === 'function' && typeof applyExecutionStatusToSidebarStep === 'function') {
            resetSidebarStepStatuses();
            const stepCount = Array.isArray(cardData.steps) ? cardData.steps.length : 0;
            for (let i = 1; i <= stepCount; i++) {
                applyExecutionStatusToSidebarStep(i, 'pending');
            }
        }

        setLoopButtonState(true);
        void sendStandaloneMessage({
            type: 'card-run-start',
            payload: {
                cardData,
                isLooping: true,
                inputs: loopInputs
            }
        }).catch((error) => {
            const msg = error && error.message ? error.message : '循环执行失败';
            showActionToast(msg, 'error');
            void refreshLoopButtonState().catch(() => {});
        });

        showActionToast(`已开始循环执行: ${cardData.name || '未命名卡片'}`, 'success');
    } catch (error) {
        const msg = error && error.message ? error.message : '循环执行失败';
        showActionToast(msg, 'error');
        await refreshLoopButtonState().catch(() => {});
    } finally {
        if (loopCardButton) {
            loopCardButton.disabled = false;
        }
    }
}
globalThis.CookieCaptureAutomationFlow = {
    loadCardIntoEditor,
    loadCardCache,
    clearCardCache,
    deleteSelectedCardCache,
    parseImportedCardText,
    sendStandaloneMessage,
    openCardEditorSidebar,
    resolveCardForRun,
    importCardTextToCache,
    importAndStartCard,
    loopCard
};
