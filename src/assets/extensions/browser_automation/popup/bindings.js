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
    importCookiesFromText,
    savePreset,
    loadPreset,
    saveCookieCredentialRecord,
    captureCurrentTab,
    clearCurrentPageCache,
    getCurrentActiveTabForCookieManager,
    refreshCookieManagerList,
    openCookieManagerPanel,
    closeCookieManagerPanel,
    deleteCookieManagerItem
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
const cookieImportFileInput = document.getElementById('cookie-import-file');
const generateCookiePasswordButton = document.getElementById('generate-cookie-password');
const importCookieButton = document.getElementById('import-cookie');
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
const clearCacheConfirmModal = document.getElementById('clear-cache-confirm-modal');
const clearCacheConfirmCancelButton = document.getElementById('clear-cache-confirm-cancel');
const clearCacheConfirmSubmitButton = document.getElementById('clear-cache-confirm-submit');
const cookieManagerPanelNode = document.getElementById('cookie-manager-panel');
const closeCookieManagerButton = document.getElementById('close-cookie-manager');
const refreshCookieManagerButton = document.getElementById('refresh-cookie-manager');
const downloadCookieManagerButton = document.getElementById('download-cookie-manager');
const clearAllCookieManagerButton = document.getElementById('clear-all-cookie-manager');
const cookieManagerListNode = document.getElementById('cookie-manager-list');
const statusNode = document.getElementById('status');
const cookieCredentialCountNode = document.getElementById('cookie-credential-count');
const cookieCredentialListNode = document.getElementById('cookie-credential-list');
const openCardDataImportButton = document.getElementById('open-card-data-import');
const cardDataImportModal = document.getElementById('card-data-import-modal');
const cardDataImportInput = document.getElementById('card-data-import-input');
const cardDataImportError = document.getElementById('card-data-import-error');
const cardDataImportCancelButton = document.getElementById('card-data-import-cancel');
const cardDataImportSaveButton = document.getElementById('card-data-import-save');
const cardDataExportModal = document.getElementById('card-data-export-modal');
const cardDataExportOutput = document.getElementById('card-data-export-output');
const cardDataExportCopyButton = document.getElementById('card-data-export-copy');
const cardDataExportDoneButton = document.getElementById('card-data-export-done');
const importCardButton = document.getElementById('import-card');
const loopCardButton = document.getElementById('loop-card');
const cardFileNameNode = document.getElementById('card-file-name');
const cardCacheBadgeNode = document.getElementById('card-cache-badge');
const cardCacheListNode = document.getElementById('card-cache-list');
const deleteCardButton = document.getElementById('delete-card');
const deleteCardConfirmModal = document.getElementById('delete-card-confirm-modal');
const deleteCardConfirmMessage = document.getElementById('delete-card-confirm-message');
const deleteCardConfirmCancelButton = document.getElementById('delete-card-confirm-cancel');
const deleteCardConfirmSubmitButton = document.getElementById('delete-card-confirm-submit');
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
const sidebarCloseButton = document.getElementById('sidebar-close');
const sidebarSaveCardButton = document.getElementById('sidebar-save-card');
const sidebarCardSettingsOpenButton = document.getElementById('sidebar-card-settings-open');
const sidebarCardSettingsModal = document.getElementById('sidebar-card-settings-modal');
const sidebarCardSettingsCloseButton = document.getElementById('sidebar-card-settings-close');
const sidebarFlowCanvasNode = document.getElementById('sidebar-flow-canvas');
const sidebarFlowContextMenuNode = document.getElementById('sidebar-flow-context-menu');
const sidebarFlowDeleteSelectionButton = document.getElementById('sidebar-flow-delete-selection');
const sidebarStepPaletteNode = document.getElementById('sidebar-step-palette');
const sidebarFlowZoomOutButton = document.getElementById('sidebar-flow-zoom-out');
const sidebarFlowZoomResetButton = document.getElementById('sidebar-flow-zoom-reset');
const sidebarFlowZoomInButton = document.getElementById('sidebar-flow-zoom-in');
const sidebarFlowAutoLayoutButton = document.getElementById('sidebar-flow-auto-layout');
const runControlStopButton = document.getElementById('run-control-stop');
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
    normalizeProgressValue,
    loadStandaloneProgressState,
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
    renderSidebarFlowCanvas,
    clearSidebarFlowNodeSelection,
    prepareSidebarFlowNodeContextSelection,
    positionSidebarNodeSettings,
    zoomSidebarFlowBy,
    resetSidebarFlowView,
    beginSidebarFlowCanvasPan,
    addSidebarStepToCanvas,
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
    saveEditorCardToCache,
    setDebugProgress,
    resetDebugProgress,
    scheduleDebugProgressAutoHide
} = workbenchModule;
const { generateCookiePassword } = shared;

await import('./automation-flow.js');

const flowModule = globalThis.CookieCaptureAutomationFlow || {};
const {
    loadCardIntoEditor,
    loadCardCache,
    clearCardCache,
    deleteSelectedCardCache,
    sendStandaloneMessage,
    openCardEditorSidebar,
    resolveCardForRun,
    importCardTextToCache,
    importAndStartCard,
    loopCard
} = flowModule;
accountInput?.addEventListener('input', () => {
    void savePreset();
});

passwordInput?.addEventListener('input', () => {
    void savePreset();
});

cookieNoteInput?.addEventListener('input', () => {
    void savePreset();
});

cookieCardKeyInput?.addEventListener('input', () => {
    void savePreset();
});

cookieCredentialDateFilterNode?.addEventListener('change', () => {
    setCookieCredentialSelectedDate(cookieCredentialDateFilterNode.value);
    void saveCookieCredentialFilterState();
    void rerenderCookieCredentialCacheUi().catch(() => {});
});

cookieCredentialSearchNode?.addEventListener('input', () => {
    setCookieCredentialSearchQuery(cookieCredentialSearchNode.value);
    void saveCookieCredentialFilterState();
    void rerenderCookieCredentialCacheUi().catch(() => {});
});

generateCookiePasswordButton?.addEventListener('click', () => {
    const password = generateCookiePassword(12);
    if (passwordInput) {
        passwordInput.value = password;
    }
    void savePreset();
    showActionToast('已生成 12 位随机密码', 'success');
});

saveCookieCredentialsButton?.addEventListener('click', () => {
    void (async () => {
        saveCookieCredentialsButton.disabled = true;
        try {
            const saved = await saveCookieCredentialRecord();
            showActionToast(
                `已保存缓存记录${saved.note ? `: ${saved.note}` : ''}${saved.cardKey ? ` / ${saved.cardKey}` : ''}`,
                'success'
            );
        } catch (error) {
            showActionToast(error && error.message ? error.message : '保存缓存失败', 'error');
        } finally {
            saveCookieCredentialsButton.disabled = false;
        }
    })();
});

saveCookieCredentialEditButton?.addEventListener('click', () => {
    void (async () => {
        saveCookieCredentialEditButton.disabled = true;
        try {
            const saved = await saveCookieCredentialEditRecord();
            showActionToast(
                `已更新缓存记录${saved.note ? `: ${saved.note}` : ''}${saved.cardKey ? ` / ${saved.cardKey}` : ''}`,
                'success'
            );
        } catch (error) {
            showActionToast(error && error.message ? error.message : '保存修改失败', 'error');
        } finally {
            saveCookieCredentialEditButton.disabled = false;
        }
    })();
});

function getCookieCredentialActionFallback(action) {
    const messages = {
        copy: '复制完整信息失败',
        'copy-account-password': '复制账号密码失败',
        'copy-group-account-password': '复制分组账号密码失败',
        edit: '编辑缓存失败',
        delete: '删除缓存失败'
    };
    return messages[action] || '操作失败';
}

async function executeCookieCredentialListAction(button, action, cardId) {
    if (action === 'copy-group-account-password') {
        const groupItems = await copyCookieCredentialAccountPasswordGroup(String(button.dataset.cookieGroupDate || '').trim());
        showActionToast(`已复制 ${groupItems.length} 条账号密码`, 'success');
        return;
    }
    if (!cardId) throw new Error('未找到可操作的缓存记录');
    const handlers = {
        copy: copyCookieCredentialItem,
        'copy-account-password': copyCookieCredentialAccountPasswordItem,
        edit: editCookieCredentialItem,
        delete: deleteCookieCredentialItem
    };
    const handler = handlers[action];
    if (!handler) throw new Error('未知操作');
    const item = await handler(cardId);
    if (!item) return;
    const label = item.note || item.cardKey || item.account || '记录';
    const messages = {
        copy: `已复制完整信息: ${label}`,
        'copy-account-password': `已复制账号密码: ${label}`,
        edit: `已载入编辑: ${label}`,
        delete: `已删除缓存记录: ${label}`
    };
    showActionToast(messages[action], 'success');
}

cookieCredentialListNode?.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-cookie-credential-action]') : null;
    if (!button) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const itemNode = button.closest('[data-cookie-credential-item]');
    const cardId = String((itemNode && itemNode.dataset && itemNode.dataset.cookieId) || '').trim();
    const action = String(button.dataset.cookieCredentialAction || '').trim();

    void (async () => {
        button.disabled = true;
        try {
            await executeCookieCredentialListAction(button, action, cardId);
        } catch (error) {
            const fallback = getCookieCredentialActionFallback(action);
            showActionToast(error && error.message ? error.message : fallback, 'error');
        } finally {
            button.disabled = false;
        }
    })();
});

cancelCookieEditButton?.addEventListener('click', () => {
    void closeCookieCredentialEditPanel('已取消编辑');
});

cookieCredentialEditPanelNode?.addEventListener('click', (event) => {
    if (event.target === cookieCredentialEditPanelNode) {
        void closeCookieCredentialEditPanel('已关闭编辑弹窗');
    }
});

document.addEventListener('keydown', (event) => {
    if (String(event.key || '').toLowerCase() !== 'escape') {
        return;
    }
    if (!cookieCredentialEditPanelNode || !cookieCredentialEditPanelNode.classList.contains('is-visible')) {
        return;
    }
    void closeCookieCredentialEditPanel('已关闭编辑弹窗');
});


globalThis.CookieCaptureBindingsContext = { shared, cookieModule, formatCookieCredentialTime, padCookieCredentialDatePart, getTodayCookieCredentialDateKey, getCookieCredentialDateKey, getCookieCredentialDateFromKey, getCookieCredentialYesterdayKey, formatCookieCredentialDateLabel, formatCookieCredentialTimeLabel, buildCookieCredentialSearchText, normalizeCookieCredentialSearchQuery, cookieCredentialItemMatchesQuery, buildCookieCredentialCacheId, normalizeCookieCredentialCacheEntry, buildCookieCredentialListLabel, buildCookieCredentialClipboardText, buildCookieCredentialAccountPasswordText, buildCookieCredentialGroupAccountPasswordText, focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem, importCookiesFromText, savePreset, loadPreset, saveCookieCredentialRecord, captureCurrentTab, clearCurrentPageCache, getCurrentActiveTabForCookieManager, refreshCookieManagerList, openCookieManagerPanel, closeCookieManagerPanel, deleteCookieManagerItem, ACCOUNT_KEY, PASSWORD_KEY, COOKIE_NOTE_KEY, COOKIE_CARD_KEY, COOKIE_CREDENTIAL_CACHE_LIST_KEY, COOKIE_CREDENTIAL_SELECTED_DATE_KEY, COOKIE_CREDENTIAL_SEARCH_KEY, COOKIE_CREDENTIAL_CACHE_MAX_ITEMS, AUTOMATION_CARD_CACHE_KEY, AUTOMATION_CARD_CACHE_NAME_KEY, AUTOMATION_CARD_CACHE_TIME_KEY, AUTOMATION_CARD_CACHE_LIST_KEY, AUTOMATION_CARD_SELECTED_ID_KEY, AUTOMATION_CARD_RUN_INPUTS_KEY, LAST_MAIN_PANEL_KEY, STANDALONE_PROGRESS_STATE_KEY, accountInput, passwordInput, cookieNoteInput, cookieCardKeyInput, cookieImportFileInput, generateCookiePasswordButton, importCookieButton, saveCookieCredentialsButton, cookieCredentialEditPanelNode, cookieCredentialEditPanelSubtitleNode, editCookieAccountInput, editCookiePasswordInput, editCookieNoteInput, editCookieCardKeyInput, saveCookieCredentialEditButton, cancelCookieEditButton, cookieCredentialDateFilterNode, cookieCredentialSearchNode, captureButton, clearCurrentPageCacheButton, clearCacheConfirmModal, clearCacheConfirmCancelButton, clearCacheConfirmSubmitButton, cookieManagerPanelNode, closeCookieManagerButton, refreshCookieManagerButton, downloadCookieManagerButton, clearAllCookieManagerButton, cookieManagerListNode, statusNode, cookieCredentialCountNode, cookieCredentialListNode, openCardDataImportButton, cardDataImportModal, cardDataImportInput, cardDataImportError, cardDataImportCancelButton, cardDataImportSaveButton, cardDataExportModal, cardDataExportOutput, cardDataExportCopyButton, cardDataExportDoneButton, importCardButton, loopCardButton, cardFileNameNode, cardCacheBadgeNode, cardCacheListNode, deleteCardButton, deleteCardConfirmModal, deleteCardConfirmMessage, deleteCardConfirmCancelButton, deleteCardConfirmSubmitButton, cardEditor, loadCardToEditorButton, saveCardEditorButton, exportCardButton, appendStepButton, stepTypeSelect, stepNameInput, stepSelectorInput, stepTextInput, stepUrlInput, stepTimeoutInput, heroTutorialButton, openCardSidebarButton, mainTabsNode, mainTabButtons, mainPanels, toastStackNode, sidebarEditorShell, sidebarCardNameInput, sidebarCardWebsiteInput, sidebarCardDescriptionInput, sidebarCardPointsInput, sidebarCardPopupsInput, sidebarCardUploadServerUrlInput, sidebarCardUploadCardKeyInput, sidebarCardRawJsonInput, sidebarCloseButton, sidebarSaveCardButton, sidebarCardSettingsOpenButton, sidebarCardSettingsModal, sidebarCardSettingsCloseButton, sidebarFlowCanvasNode, sidebarFlowContextMenuNode, sidebarFlowDeleteSelectionButton, sidebarStepPaletteNode, sidebarFlowZoomOutButton, sidebarFlowZoomResetButton, sidebarFlowZoomInButton, sidebarFlowAutoLayoutButton, runControlStopButton, sidebarStepListNode, sidebarEditorMetaNode, TUTORIAL_URL, runtimeStateStorage, workbenchModule, buildPresetFileName, setStatus, copyTextToClipboard, downloadJsonFile, showToast, showActionToast, openTutorialPage, loadLastMainPanel, saveLastMainPanel, activateMainPanel, setCardFileName, setCardCacheBadge, buildCardExportFileName, buildCardCacheId, normalizeCardCacheEntry, buildCardListLabel, renderCardCacheList, normalizeProgressValue, loadStandaloneProgressState, setLoopButtonState, refreshLoopButtonState, sendStopAction, sendContinueAction, normalizeCardData, stringifyCardData, parseEditorCardData, setCardEditorValue, getCardEditorValue, isSidebarLayout, renderSidebarFlowCanvas, clearSidebarFlowNodeSelection, prepareSidebarFlowNodeContextSelection, positionSidebarNodeSettings, zoomSidebarFlowBy, resetSidebarFlowView, beginSidebarFlowCanvasPan, addSidebarStepToCanvas, handleSidebarFlowNodeClick, beginSidebarFlowPortDrag, deleteSidebarFlowEdge, deleteSelectedSidebarFlowNodes, applySidebarFlowAutoLayout, beginSidebarFlowNodeDrag, escapeHtml, normalizeSidebarPopupsInput, formatSidebarPopupsInput, decodeHtmlEntities, escapeCssIdentifier, escapeCssAttributeValue, escapeHasTextValue, normalizeSelectorText, looksLikeHtmlSnippet, buildStandardSelectorFromHtmlSnippet, normalizeSelectorInputValue, normalizeSidebarStepSelectorControl, updateSidebarEditorMeta, buildSidebarStepTemplate, collectSidebarStepExpansionState, buildSidebarStepSummary, buildSidebarStepCardHtml, updateSidebarStepSettingsVisibility, collectSidebarStepCards, readSidebarStepCard, collectSidebarSteps, resetSidebarStepStatuses, applyExecutionStatusToSidebarStep, syncSidebarEditorToHiddenJson, collectSidebarCardDataFromForm, renderSidebarCardEditor, getSidebarCardDataFromEditor, getCardDataForExport, exportCard, loadCardCacheState, saveCardCacheState, refreshCardCacheUi, selectCardCacheItem, upsertCardCache, renderSidebarEditorFromCurrentState, saveCardCache, saveEditorCardToCache, setDebugProgress, resetDebugProgress, scheduleDebugProgressAutoHide, generateCookiePassword, flowModule, loadCardIntoEditor, loadCardCache, clearCardCache, deleteSelectedCardCache, sendStandaloneMessage, openCardEditorSidebar, resolveCardForRun, importCardTextToCache, importAndStartCard, loopCard };
