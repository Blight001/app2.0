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

cookieCredentialListNode?.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-cookie-credential-action]') : null;
    if (!button) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const itemNode = button.closest('[data-cookie-credential-item]');
    const cardId = String(itemNode?.dataset?.cookieId || '').trim();
    const action = String(button.dataset.cookieCredentialAction || '').trim();

    void (async () => {
        button.disabled = true;
        try {
            if (action === 'copy-group-account-password') {
                const groupDate = String(button.dataset.cookieGroupDate || '').trim();
                const groupItems = await copyCookieCredentialAccountPasswordGroup(groupDate);
                showActionToast(`已复制 ${groupItems.length} 条账号密码`, 'success');
                return;
            }

            if (!cardId) {
                throw new Error('未找到可操作的缓存记录');
            }

            if (action === 'copy') {
                const item = await copyCookieCredentialItem(cardId);
                showActionToast(`已复制完整信息: ${item.note || item.cardKey || item.account || '记录'}`, 'success');
                return;
            }

            if (action === 'copy-account-password') {
                const item = await copyCookieCredentialAccountPasswordItem(cardId);
                showActionToast(`已复制账号密码: ${item.note || item.cardKey || item.account || '记录'}`, 'success');
                return;
            }

            if (action === 'edit') {
                const item = await editCookieCredentialItem(cardId);
                showActionToast(`已载入编辑: ${item.note || item.cardKey || item.account || '记录'}`, 'success');
                return;
            }

            if (action === 'delete') {
                const item = await deleteCookieCredentialItem(cardId);
                if (item) {
                    showActionToast(`已删除缓存记录: ${item.note || item.cardKey || item.account || '记录'}`, 'success');
                }
                return;
            }

            throw new Error('未知操作');
        } catch (error) {
            const fallback = action === 'copy'
                ? '复制完整信息失败'
                : action === 'copy-account-password'
                    ? '复制账号密码失败'
                    : action === 'copy-group-account-password'
                        ? '复制分组账号密码失败'
                : action === 'edit'
                    ? '编辑缓存失败'
                    : action === 'delete'
                        ? '删除缓存失败'
                        : '操作失败';
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

function setCardDataImportError(message = '') {
    const text = String(message || '').trim();
    if (cardDataImportError) {
        cardDataImportError.textContent = text;
        cardDataImportError.hidden = !text;
    }
    cardDataImportInput?.classList.toggle('is-invalid', Boolean(text));
}

function setCardDataImportOpen(open = false, options = {}) {
    if (!cardDataImportModal) return false;
    const shouldOpen = open === true;
    cardDataImportModal.hidden = !shouldOpen;
    openCardDataImportButton?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
        setCardDataImportError('');
        window.requestAnimationFrame(() => cardDataImportInput?.focus());
    } else {
        setCardDataImportError('');
        if (options.clear !== false && cardDataImportInput) cardDataImportInput.value = '';
        openCardDataImportButton?.focus();
    }
    return shouldOpen;
}

openCardDataImportButton?.addEventListener('click', () => setCardDataImportOpen(true));
cardDataImportCancelButton?.addEventListener('click', () => setCardDataImportOpen(false));
cardDataImportInput?.addEventListener('input', () => setCardDataImportError(''));
cardDataImportModal?.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-card-data-import-dismiss]')) {
        setCardDataImportOpen(false);
    }
});
cardDataImportSaveButton?.addEventListener('click', () => {
    void (async () => {
        cardDataImportSaveButton.disabled = true;
        try {
            const result = await importCardTextToCache(String(cardDataImportInput?.value || ''));
            const count = Number(result?.items?.length || 0);
            if (!count) throw new Error('未识别到可导入的自动化卡片');
            setCardDataImportOpen(false);
            showActionToast(`已保存导入 ${count} 张自动化卡片`, 'success');
        } catch (error) {
            setCardDataImportError(error && error.message ? error.message : '导入自动化卡片失败');
            cardDataImportInput?.focus();
        } finally {
            cardDataImportSaveButton.disabled = false;
        }
    })();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cardDataImportModal && !cardDataImportModal.hidden) {
        event.preventDefault();
        setCardDataImportOpen(false);
    }
});

deleteCardButton?.addEventListener('click', () => {
    void deleteSelectedCardCache().then(() => {
        showActionToast('已删除选中自动化卡片', 'success');
    }).catch((error) => {
        showActionToast(error && error.message ? error.message : '删除选中卡片失败', 'error');
    });
});

cardCacheListNode?.addEventListener('click', (event) => {
    const item = event.target && event.target.closest ? event.target.closest('[data-card-cache-item]') : null;
    if (!item) {
        return;
    }

    const cardId = String(item.dataset.cardId || '').trim();
    if (!cardId) {
        return;
    }

    // 点击卡片直接切换选中（无需选择按钮）
    void (async () => {
        try {
            const current = await loadCardCacheState().catch(() => ({ selectedId: '' }));
            if (String(current.selectedId || '').trim() === cardId) {
                return; // 已选中则不重复操作
            }
            const selected = await selectCardCacheItem(cardId);
            showActionToast(`已选中自动化卡片: ${selected.cardName || selected.cardData?.name || '未命名'}`, 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '选择自动化卡片失败', 'error');
        }
    })();
});

// 后台 AI 工具、另一个弹窗或侧边栏写入卡片后，当前列表立即同步。
// 仅刷新列表和运行变量，避免覆盖用户尚未保存的编辑器内容。
let cardCacheRefreshTimer = null;
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
        return;
    }
    const cacheKeys = [
        AUTOMATION_CARD_CACHE_LIST_KEY,
        AUTOMATION_CARD_SELECTED_ID_KEY,
        AUTOMATION_CARD_CACHE_KEY,
        AUTOMATION_CARD_CACHE_NAME_KEY,
        AUTOMATION_CARD_CACHE_TIME_KEY
    ];
    if (!cacheKeys.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) {
        return;
    }
    if (cardCacheRefreshTimer) {
        window.clearTimeout(cardCacheRefreshTimer);
    }
    cardCacheRefreshTimer = window.setTimeout(() => {
        cardCacheRefreshTimer = null;
        void refreshCardCacheUi().catch(() => {});
    }, 50);
});

// 进度面板停止/继续按钮：失败后自动变成“继续”，点击可从失败步骤重试
runControlStopButton?.addEventListener('click', () => {
    runControlStopButton.disabled = true;
    void (async () => {
        let state = null;
        try {
            state = await loadStandaloneProgressState();
        } catch (_) {}
        const isContinueCase = !!(state && (state.kind === 'error' || state.phase === 'failed') && Number(state.stepIndex || 0) > 0);
        try {
            if (isContinueCase && typeof sendContinueAction === 'function') {
                await sendContinueAction();
                showActionToast('已从当前失败步骤继续执行', 'success');
            } else {
                await sendStopAction();
                showActionToast('已停止执行', 'success');
            }
        } catch (error) {
            showActionToast(error && error.message ? error.message : (isContinueCase ? '继续执行失败' : '停止执行失败'), 'error');
        } finally {
            if (runControlStopButton) runControlStopButton.disabled = false;
        }
    })();
});

captureButton?.addEventListener('click', () => {
    void openCookieManagerPanel();
});

closeCookieManagerButton?.addEventListener('click', () => {
    closeCookieManagerPanel();
});

cookieManagerPanelNode?.addEventListener('click', (event) => {
    if (event.target === cookieManagerPanelNode) {
        closeCookieManagerPanel();
    }
});

document.addEventListener('keydown', (event) => {
    if (String(event.key || '').toLowerCase() !== 'escape') {
        return;
    }
    if (!cookieManagerPanelNode || !cookieManagerPanelNode.classList.contains('is-visible')) {
        return;
    }
    closeCookieManagerPanel();
});

refreshCookieManagerButton?.addEventListener('click', () => {
    void (async () => {
        refreshCookieManagerButton.disabled = true;
        try {
            await refreshCookieManagerList();
        } catch (error) {
            showActionToast(error && error.message ? error.message : '刷新 Cookie 列表失败', 'error');
        } finally {
            refreshCookieManagerButton.disabled = false;
        }
    })();
});

downloadCookieManagerButton?.addEventListener('click', () => {
    void (async () => {
        downloadCookieManagerButton.disabled = true;
        try {
            await captureCurrentTab();
        } finally {
            downloadCookieManagerButton.disabled = false;
        }
    })();
});

clearAllCookieManagerButton?.addEventListener('click', () => {
    void (async () => {
        clearAllCookieManagerButton.disabled = true;
        try {
            await clearCurrentPageCache();
            await refreshCookieManagerList().catch(() => {});
        } finally {
            clearAllCookieManagerButton.disabled = false;
        }
    })();
});

cookieManagerListNode?.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-cookie-manager-action="delete"]') : null;
    if (!button) {
        return;
    }

    const itemNode = button.closest('[data-cookie-manager-item]');
    void (async () => {
        button.disabled = true;
        try {
            const result = await deleteCookieManagerItem(itemNode);
            showActionToast(`已删除 Cookie: ${result.name}`, 'success');
            await refreshCookieManagerList().catch(() => {});
        } catch (error) {
            showActionToast(error && error.message ? error.message : '删除 Cookie 失败', 'error');
            button.disabled = false;
        }
    })();
});

importCookieButton?.addEventListener('click', () => {
    if (cookieImportFileInput) {
        cookieImportFileInput.value = '';
        cookieImportFileInput.click();
    }
});

cookieImportFileInput?.addEventListener('change', () => {
    void (async () => {
        const file = cookieImportFileInput.files && cookieImportFileInput.files[0] ? cookieImportFileInput.files[0] : null;
        cookieImportFileInput.value = '';
        if (!file) {
            return;
        }

        importCookieButton && (importCookieButton.disabled = true);
        try {
            const text = await file.text();
            await importCookiesFromText(text, file.name || '');
        } catch (error) {
            showActionToast(error && error.message ? error.message : 'Cookie 导入失败', 'error');
            setStatus(error && error.message ? error.message : 'Cookie 导入失败', 'error');
        } finally {
            if (importCookieButton) {
                importCookieButton.disabled = false;
            }
        }
    })();
});

function setClearCacheConfirmOpen(open = false) {
    if (!clearCacheConfirmModal) return false;
    const shouldOpen = open === true;
    clearCacheConfirmModal.hidden = !shouldOpen;
    if (shouldOpen) {
        const dialog = clearCacheConfirmModal.querySelector('.cookie-confirm-modal__dialog');
        window.requestAnimationFrame(() => dialog?.focus());
    } else {
        clearCurrentPageCacheButton?.focus();
    }
    return shouldOpen;
}

clearCurrentPageCacheButton?.addEventListener('click', () => setClearCacheConfirmOpen(true));
clearCacheConfirmCancelButton?.addEventListener('click', () => setClearCacheConfirmOpen(false));
clearCacheConfirmModal?.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-clear-cache-confirm-dismiss]')) {
        setClearCacheConfirmOpen(false);
    }
});
clearCacheConfirmSubmitButton?.addEventListener('click', () => {
    setClearCacheConfirmOpen(false);
    void clearCurrentPageCache();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && clearCacheConfirmModal && !clearCacheConfirmModal.hidden) {
        event.preventDefault();
        setClearCacheConfirmOpen(false);
    }
});

importCardButton?.addEventListener('click', () => {
    void importAndStartCard();
});

loopCardButton?.addEventListener('click', () => {
    void loopCard();
});


loadCardToEditorButton?.addEventListener('click', () => {
    void (async () => {
        loadCardToEditorButton.disabled = true;
        try {
            const cardData = await loadCardIntoEditor();
            showActionToast(`已载入自动化卡片: ${cardData.name || '未命名'}`, 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '载入自动化卡片失败', 'error');
        } finally {
            loadCardToEditorButton.disabled = false;
        }
    })();
});

openCardSidebarButton?.addEventListener('click', () => {
    void (async () => {
        openCardSidebarButton.disabled = true;
        showActionToast('正在打开右侧编辑栏...', 'info');
        try {
            const result = await openCardEditorSidebar();
            showActionToast(result?.closed ? '已关闭右侧编辑栏' : '已打开右侧编辑栏', 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '打开右侧编辑栏失败', 'error');
        } finally {
            openCardSidebarButton.disabled = false;
        }
    })();
});

saveCardEditorButton?.addEventListener('click', () => {
    void (async () => {
        saveCardEditorButton.disabled = true;
        try {
            const saved = await saveEditorCardToCache();
            showActionToast(`已保存自动化卡片: ${saved.name}`, 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '保存编辑失败', 'error');
        } finally {
            saveCardEditorButton.disabled = false;
        }
    })();
});

exportCardButton?.addEventListener('click', () => {
    void (async () => {
        exportCardButton.disabled = true;
        try {
            const result = await exportCard();
            if (cardDataExportOutput) cardDataExportOutput.value = String(result.text || '');
            setCardDataExportOpen(true);
        } catch (error) {
            showActionToast(error && error.message ? error.message : '导出自动化卡片失败', 'error');
        } finally {
            exportCardButton.disabled = false;
        }
    })();
});

appendStepButton?.addEventListener('click', () => {
    void (async () => {
        appendStepButton.disabled = true;
        try {
            const workbench = globalThis.CookieCaptureAutomationWorkbench || {};
            let added = 0;
            if (typeof workbench.buildSidebarStepTemplate === 'function') {
                const newStep = workbench.buildSidebarStepTemplate('click');
                // basic: if sidebar functions available use them, else just toast
                if (typeof workbench.collectSidebarCardDataFromForm === 'function' && typeof workbench.setCardEditorValue === 'function') {
                    const current = workbench.collectSidebarCardDataFromForm() || { steps: [] };
                    const steps = Array.isArray(current.steps) ? [...current.steps, newStep] : [newStep];
                    workbench.setCardEditorValue({ ...current, steps });
                    added = steps.length;
                } else {
                    added = 1;
                }
            }
            showActionToast(`已添加步骤${added ? `，当前共 ${added} 步` : ''}`, 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '添加步骤失败', 'error');
        } finally {
            appendStepButton.disabled = false;
        }
    })();
});

heroTutorialButton?.addEventListener('click', () => {
    void (async () => {
        heroTutorialButton.disabled = true;
        try {
            await openTutorialPage();
            showActionToast('已打开教程', 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '打开教程失败', 'error');
        } finally {
            heroTutorialButton.disabled = false;
        }
    })();
});

sidebarCloseButton?.addEventListener('click', () => {
    // Direct close via postMessage to the outer sidebar host (immediate DOM removal)
    try {
        window.parent && window.parent.postMessage({ type: 'close-card-sidebar' }, '*');
    } catch (_e) {}

    // Also ask background to force-close (ensures removal even if postMessage has issues in the frame)
    chrome.runtime.sendMessage({
        type: 'close-card-sidebar'
    }).catch(() => {});
});

function setSidebarCardSettingsOpen(open = false) {
    if (!sidebarCardSettingsModal) {
        return false;
    }
    const shouldOpen = open === true;
    sidebarCardSettingsModal.hidden = !shouldOpen;
    sidebarCardSettingsOpenButton?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
        const dialog = sidebarCardSettingsModal.querySelector('.sidebar-card-settings-dialog');
        window.requestAnimationFrame(() => dialog?.focus());
    } else {
        sidebarCardSettingsOpenButton?.focus();
    }
    return shouldOpen;
}

sidebarCardSettingsOpenButton?.addEventListener('click', () => setSidebarCardSettingsOpen(true));
sidebarCardSettingsCloseButton?.addEventListener('click', () => setSidebarCardSettingsOpen(false));
sidebarCardSettingsModal?.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-sidebar-card-settings-dismiss]')) {
        setSidebarCardSettingsOpen(false);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebarCardSettingsModal && !sidebarCardSettingsModal.hidden) {
        event.preventDefault();
        setSidebarCardSettingsOpen(false);
    }
});

function setSidebarRequiredFieldInvalid(control, invalid = false) {
    if (!control) {
        return;
    }
    const field = control.closest('[data-sidebar-required-field]');
    field?.classList.toggle('is-invalid', invalid === true);
    control.setAttribute('aria-invalid', invalid === true ? 'true' : 'false');
    const error = field?.querySelector('[data-sidebar-field-error]');
    if (error) {
        error.hidden = invalid !== true;
    }
}

function validateSidebarRequiredFields() {
    const nameValid = Boolean(String(sidebarCardNameInput?.value || '').trim());
    const website = String(sidebarCardWebsiteInput?.value || '').trim();
    let websiteValid = false;
    try {
        const parsed = new URL(website);
        websiteValid = ['http:', 'https:'].includes(parsed.protocol);
    } catch (_error) {
        websiteValid = false;
    }

    setSidebarRequiredFieldInvalid(sidebarCardNameInput, !nameValid);
    setSidebarRequiredFieldInvalid(sidebarCardWebsiteInput, !websiteValid);
    const firstInvalid = !nameValid ? sidebarCardNameInput : (!websiteValid ? sidebarCardWebsiteInput : null);
    if (firstInvalid) {
        setSidebarCardSettingsOpen(true);
        window.requestAnimationFrame(() => firstInvalid.focus());
        return false;
    }
    return true;
}

sidebarSaveCardButton?.addEventListener('click', () => {
    void (async () => {
        if (!validateSidebarRequiredFields()) {
            showActionToast('请先填写标红的必填项目', 'error');
            return;
        }
        sidebarSaveCardButton.disabled = true;
        try {
            const saved = await saveEditorCardToCache();
            showActionToast(`已保存自动化卡片: ${saved.name}`, 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '保存卡片失败', 'error');
        } finally {
            sidebarSaveCardButton.disabled = false;
        }
    })();
});

function setCardDataExportOpen(open = false) {
    if (!cardDataExportModal) return false;
    const shouldOpen = open === true;
    cardDataExportModal.hidden = !shouldOpen;
    if (shouldOpen) {
        window.requestAnimationFrame(() => {
            cardDataExportOutput?.focus();
            cardDataExportOutput?.select();
        });
    } else {
        if (cardDataExportOutput) cardDataExportOutput.value = '';
        exportCardButton?.focus();
    }
    return shouldOpen;
}

cardDataExportCopyButton?.addEventListener('click', () => {
    void (async () => {
        cardDataExportCopyButton.disabled = true;
        try {
            await copyTextToClipboard(String(cardDataExportOutput?.value || ''));
            showActionToast('已复制卡片流程数据', 'success');
        } catch (error) {
            showActionToast(error && error.message ? error.message : '复制卡片流程数据失败', 'error');
        } finally {
            cardDataExportCopyButton.disabled = false;
        }
    })();
});
cardDataExportDoneButton?.addEventListener('click', () => setCardDataExportOpen(false));
cardDataExportModal?.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-card-data-export-dismiss]')) {
        setCardDataExportOpen(false);
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cardDataExportModal && !cardDataExportModal.hidden) {
        event.preventDefault();
        setCardDataExportOpen(false);
    }
});

sidebarFlowZoomOutButton?.addEventListener('click', () => zoomSidebarFlowBy(-0.1));
sidebarFlowZoomInButton?.addEventListener('click', () => zoomSidebarFlowBy(0.1));
sidebarFlowZoomResetButton?.addEventListener('click', () => resetSidebarFlowView());

let sidebarPaletteDragActive = false;
sidebarStepPaletteNode?.addEventListener('click', (event) => {
    const item = event.target?.closest?.('[data-step-template-type]');
    if (!item || sidebarPaletteDragActive) return;
    const step = addSidebarStepToCanvas(String(item.dataset.stepTemplateType || 'navigate'));
    if (step) showActionToast(`已添加${item.textContent.trim()}步骤`, 'success');
});
sidebarStepPaletteNode?.addEventListener('dragstart', (event) => {
    const item = event.target?.closest?.('[data-step-template-type]');
    if (!item || !event.dataTransfer) return;
    sidebarPaletteDragActive = true;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-automation-step', String(item.dataset.stepTemplateType || 'navigate'));
});
sidebarStepPaletteNode?.addEventListener('dragend', () => {
    window.setTimeout(() => { sidebarPaletteDragActive = false; }, 0);
});

function closeSidebarFlowContextMenu() {
    if (!sidebarFlowContextMenuNode || sidebarFlowContextMenuNode.hidden) return false;
    sidebarFlowContextMenuNode.hidden = true;
    return true;
}

function openSidebarFlowContextMenu(clientX, clientY, selectedCount = 1) {
    if (!sidebarFlowContextMenuNode) return false;
    const stage = sidebarFlowContextMenuNode.closest('.sidebar-flow-stage');
    if (!stage) return false;
    const stageRect = stage.getBoundingClientRect();
    sidebarFlowContextMenuNode.hidden = false;
    const menuWidth = sidebarFlowContextMenuNode.offsetWidth || 156;
    const menuHeight = sidebarFlowContextMenuNode.offsetHeight || 44;
    const left = Math.min(Math.max(6, clientX - stageRect.left), Math.max(6, stage.clientWidth - menuWidth - 6));
    const top = Math.min(Math.max(6, clientY - stageRect.top), Math.max(6, stage.clientHeight - menuHeight - 6));
    sidebarFlowContextMenuNode.style.left = `${Math.round(left)}px`;
    sidebarFlowContextMenuNode.style.top = `${Math.round(top)}px`;
    if (sidebarFlowDeleteSelectionButton) {
        sidebarFlowDeleteSelectionButton.textContent = selectedCount > 1
            ? `删除选中的 ${selectedCount} 个节点`
            : '删除选中节点';
        sidebarFlowDeleteSelectionButton.focus();
    }
    return true;
}

sidebarFlowCanvasNode?.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('application/x-automation-step')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
});
sidebarFlowCanvasNode?.addEventListener('drop', (event) => {
    const stepType = event.dataTransfer?.getData('application/x-automation-step');
    if (!stepType) return;
    event.preventDefault();
    const step = addSidebarStepToCanvas(stepType, event.clientX, event.clientY);
    if (step) showActionToast('已将步骤添加到画布', 'success');
});

sidebarFlowCanvasNode?.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomSidebarFlowBy(event.deltaY < 0 ? 0.1 : -0.1, event.clientX, event.clientY);
}, { passive: false });

sidebarFlowCanvasNode?.addEventListener('pointerdown', (event) => {
    closeSidebarFlowContextMenu();
    const port = event.target?.closest?.('[data-flow-port]');
    if (port) {
        beginSidebarFlowPortDrag(
            event,
            String(port.dataset.flowNodeId || '').trim(),
            String(port.dataset.flowPort || '').trim(),
            String(port.dataset.flowLabel || '').trim(),
            String(port.dataset.flowRole || 'any').trim()
        );
        return;
    }
    const node = event.target && event.target.closest ? event.target.closest('[data-flow-node-id]') : null;
    if (node) {
        beginSidebarFlowNodeDrag(event, String(node.dataset.flowNodeId || '').trim());
        return;
    }
    const edge = event.target?.closest?.('[data-flow-edge-id]');
    if (!edge) beginSidebarFlowCanvasPan(event);
});

sidebarFlowCanvasNode?.addEventListener('click', (event) => {
    const port = event.target?.closest?.('[data-flow-port]');
    if (port) return;
    const edge = event.target && event.target.closest ? event.target.closest('[data-flow-edge-id]') : null;
    if (edge) {
        const edgeId = String(edge.dataset.flowEdgeId || '').trim();
        clearSidebarFlowNodeSelection();
        const removed = deleteSidebarFlowEdge(edgeId);
        if (removed) {
            showActionToast('已删除连线', 'success');
        }
        return;
    }

    const node = event.target && event.target.closest ? event.target.closest('[data-flow-node-id]') : null;
    if (node) {
        handleSidebarFlowNodeClick(String(node.dataset.flowNodeId || '').trim(), {
            toggle: event.ctrlKey === true || event.metaKey === true || event.shiftKey === true
        });
        return;
    }

    clearSidebarFlowNodeSelection();
});

sidebarFlowCanvasNode?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const node = event.target?.closest?.('[data-flow-node-id]');
    if (!node || event.target?.closest?.('[data-flow-port]')) {
        closeSidebarFlowContextMenu();
        return;
    }
    const selectedCount = prepareSidebarFlowNodeContextSelection(String(node.dataset.flowNodeId || '').trim());
    if (selectedCount > 0) {
        openSidebarFlowContextMenu(event.clientX, event.clientY, selectedCount);
    }
});

sidebarFlowDeleteSelectionButton?.addEventListener('click', () => {
    const deletedCount = deleteSelectedSidebarFlowNodes();
    closeSidebarFlowContextMenu();
    if (deletedCount > 0) {
        showActionToast(`已删除 ${deletedCount} 个节点`, 'success');
    }
});

document.addEventListener('pointerdown', (event) => {
    if (!event.target?.closest?.('#sidebar-flow-context-menu')) {
        closeSidebarFlowContextMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && closeSidebarFlowContextMenu()) {
        event.preventDefault();
    }
});

sidebarFlowCanvasNode?.addEventListener('scroll', () => {
    positionSidebarNodeSettings();
}, { passive: true });

window.addEventListener('resize', () => {
    positionSidebarNodeSettings();
});

sidebarCardNameInput?.addEventListener('input', () => {
    if (String(sidebarCardNameInput.value || '').trim()) {
        setSidebarRequiredFieldInvalid(sidebarCardNameInput, false);
    }
    syncSidebarEditorToHiddenJson();
});
sidebarCardWebsiteInput?.addEventListener('input', () => {
    setSidebarRequiredFieldInvalid(sidebarCardWebsiteInput, false);
    syncSidebarEditorToHiddenJson();
});
sidebarCardDescriptionInput?.addEventListener('input', () => syncSidebarEditorToHiddenJson());
sidebarCardPointsInput?.addEventListener('input', () => syncSidebarEditorToHiddenJson());
sidebarCardPopupsInput?.addEventListener('input', () => syncSidebarEditorToHiddenJson());
sidebarCardUploadServerUrlInput?.addEventListener('input', () => syncSidebarEditorToHiddenJson());
sidebarCardUploadCardKeyInput?.addEventListener('input', () => syncSidebarEditorToHiddenJson());
sidebarCardRawJsonInput?.addEventListener('input', () => {
    try {
        const raw = parseEditorCardData(String(sidebarCardRawJsonInput.value || ''), { allowEmptySteps: true });
        renderSidebarCardEditor(raw);
        syncSidebarEditorToHiddenJson();
    } catch (_error) {}
});

sidebarStepListNode?.addEventListener('input', (event) => {
    const target = event.target || null;
    const card = target?.closest?.('[data-sidebar-step-card]') || null;
    if (card && target.matches?.('[data-sidebar-step-field="type"], [data-sidebar-step-field="condition_mode"]')) {
        updateSidebarStepSettingsVisibility(card);
    }
    if (target && target.matches && target.matches('[data-sidebar-step-field="selector"]')) {
        if (card) {
            normalizeSidebarStepSelectorControl(card, target);
        }
    }
    syncSidebarEditorToHiddenJson();
});

sidebarStepListNode?.addEventListener('change', (event) => {
    const target = event.target || null;
    const card = target?.closest?.('[data-sidebar-step-card]') || null;
    if (card && target.matches?.('[data-sidebar-step-field="type"], [data-sidebar-step-field="condition_mode"]')) {
        updateSidebarStepSettingsVisibility(card);
    }
    if (target && target.matches && target.matches('[data-sidebar-step-field="selector"]')) {
        if (card) {
            normalizeSidebarStepSelectorControl(card, target);
        }
    }
    syncSidebarEditorToHiddenJson();
});

sidebarStepListNode?.addEventListener('paste', (event) => {
    const target = event.target || null;
    if (!target || !target.matches || !target.matches('[data-sidebar-step-field="selector"]')) {
        return;
    }

    window.setTimeout(() => {
        const card = target.closest('[data-sidebar-step-card]');
        if (!card) {
            return;
        }
        normalizeSidebarStepSelectorControl(card, target);
        syncSidebarEditorToHiddenJson();
    }, 0);
});

sidebarStepListNode?.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-sidebar-step-action]') : null;
    if (!button) {
        return;
    }

    const card = button.closest('[data-sidebar-step-card]');
    if (!card) {
        return;
    }

    const currentCard = getSidebarCardDataFromEditor();
    const steps = Array.isArray(currentCard.steps) ? [...currentCard.steps] : [];
    const index = Number(card.dataset.stepIndex || Array.from(card.parentElement?.children || []).indexOf(card));
    const action = String(button.dataset.sidebarStepAction || '').trim();
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) {
        return;
    }

    if (action === 'close') {
        clearSidebarFlowNodeSelection();
        return;
    }

    if (action === 'selector') {
        const selectorControl = card.querySelector('[data-sidebar-step-field="selector"]');
        if (!selectorControl) {
            return;
        }
        const currentValue = String(selectorControl.value || '').trim();
        const nextValue = window.prompt('请输入选择器或 HTML 元素片段', currentValue);
        if (nextValue === null) {
            return;
        }
        selectorControl.value = nextValue;
        const normalized = normalizeSidebarStepSelectorControl(card, selectorControl);
        syncSidebarEditorToHiddenJson();
        selectorControl.focus();
        selectorControl.setSelectionRange(selectorControl.value.length, selectorControl.value.length);
        showActionToast(normalized.converted ? '已标准化选择器' : '已更新选择器', 'success');
        return;
    }

    if (action === 'delete') {
        steps.splice(index, 1);
        currentCard.steps = steps;
        renderSidebarCardEditor(currentCard);
        syncSidebarEditorToHiddenJson();
        return;
    }

    if (action === 'up' && index > 0) {
        const [moved] = steps.splice(index, 1);
        steps.splice(index - 1, 0, moved);
        currentCard.steps = steps;
        renderSidebarCardEditor(currentCard);
        syncSidebarEditorToHiddenJson();
        return;
    }

    if (action === 'down' && index < steps.length - 1) {
        const [moved] = steps.splice(index, 1);
        steps.splice(index + 1, 0, moved);
        currentCard.steps = steps;
        renderSidebarCardEditor(currentCard);
        syncSidebarEditorToHiddenJson();
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.type === 'card-run-progress') {
        const text = String(message.message || '').trim();
        const progressValue = Number(message.progress);
        const hasProgress = Number.isFinite(progressValue);
        const stepIndex = Number(message.stepIndex || 0) || 0;
        const stepTotal = Number(message.stepTotal || 0) || 0;
        const stepName = String(message.stepName || '').trim();
        const previousStepName = String(message.previousStepName || '').trim();
        const nextStepName = String(message.nextStepName || '').trim();
        const errorReason = String(message.errorReason || '').trim();
        const stepLabel = stepIndex > 0
            ? (stepTotal > 0 ? `第 ${stepIndex}/${stepTotal} 步` : `第 ${stepIndex} 步`)
            : '';
        const stepMetaParts = [
            stepLabel && stepName ? `${stepLabel} · ${stepName}` : (stepName || stepLabel),
            previousStepName ? `上一步：${previousStepName}` : '',
            nextStepName ? `下一步：${nextStepName}` : ''
        ].filter(Boolean);
        const progressState = {
            visible: true,
            message: text || '正在处理自动化执行...',
            kind: message.kind || '',
            errorReason,
            mode: String(message.mode || '').trim() || 'debug',
            stepIndex,
            stepTotal,
            stepName,
            meta: [
                ...stepMetaParts,
                hasProgress ? `${Math.round(Math.max(0, Math.min(100, progressValue)))}%` : ''
            ].filter(Boolean).join(' · ')
        };
        if (hasProgress) {
            progressState.progress = progressValue;
        }
        setDebugProgress(progressState);
        if (text) {
            setStatus(text, message.kind === 'error' ? 'error' : '');
        }
        setLoopButtonState(message.running === true);

        // 侧边栏：执行步骤状态显示在“自动化步骤”栏目内（灰/绿/红），不再在最下方面板
        if (isSidebarLayout() && typeof applyExecutionStatusToSidebarStep === 'function') {
          const si = stepIndex;
          const phase = String(message.phase || '').trim();
          const err = errorReason;
          if (si > 0) {
            if (phase === 'step_start') {
              applyExecutionStatusToSidebarStep(si, 'running');
            } else if (phase === 'step_complete') {
              applyExecutionStatusToSidebarStep(si, 'success');
            } else if (phase === 'step_skip') {
              applyExecutionStatusToSidebarStep(si, 'pending');
            } else if (message.kind === 'error') {
              applyExecutionStatusToSidebarStep(si, 'error', err || text);
            }
          }
        }
    }

    if (message.type === 'card-run-finished') {
        const success = message.success === true;
        const stopped = message.stopped === true || String(message.message || '').includes('已停止');
        const continuation = message.isLooping === true && message.continuation === true;
        const finishedProgress = Number.isFinite(Number(message.progress))
            ? Number(message.progress)
            : (success ? 100 : 0);
        const finalMsg = String(message.message || (message.success ? '执行完成' : '执行失败'));
        // 载入持久化状态以带出失败步骤索引，让按钮可正确显示为“继续”
        (async () => {
            let stepIndex = Number(message.stepIndex || 0) || 0;
            if (!success && !stopped && !stepIndex) {
                try {
                    const st = await loadStandaloneProgressState().catch(() => null);
                    if (st && Number(st.stepIndex)) stepIndex = Number(st.stepIndex);
                } catch (_) {}
            }
            setDebugProgress({
                visible: true,
                progress: finishedProgress,
                message: finalMsg,
                kind: success || stopped ? '' : 'error',
                errorReason: String(message.errorReason || (!success && !stopped ? message.message || '' : '')).trim(),
                meta: continuation ? '继续循环' : stopped ? '已停止' : success ? '已完成' : '已失败',
                mode: continuation ? 'loop' : '',
                stepIndex
            });

            // 侧边栏步骤最终状态
            if (isSidebarLayout() && typeof applyExecutionStatusToSidebarStep === 'function' && stepIndex > 0) {
              if (success || stopped) {
                applyExecutionStatusToSidebarStep(stepIndex, 'success');
              } else {
                applyExecutionStatusToSidebarStep(stepIndex, 'error', String(message.errorReason || message.message || '执行失败'));
              }
            }
        })();
        if (message.success === true) {
            setStatus(finalMsg, 'success');
            showActionToast(finalMsg, 'success');
        } else if (stopped) {
            setStatus(finalMsg, 'success');
            showActionToast(finalMsg, 'success');
        } else {
            // Failure error: put below (in status) instead of popup toast
            const failMsg = String(message.errorReason || message.message || '执行失败');
            setStatus(failMsg, 'error');
            // no toast for failure report
        }
        setLoopButtonState(continuation || message.running === true);
    }
});

void (async () => {
    const lastMainPanel = await loadLastMainPanel().catch(() => 'card');
    activateMainPanel(lastMainPanel || 'card', { persist: false });
    await loadPreset();
    syncCookieCredentialEditUi();
    await refreshCookieCredentialCacheUi().catch(() => {});
    await refreshLoopButtonState();
    try {
        const storedProgress = await loadStandaloneProgressState();
        if (storedProgress && storedProgress.visible !== false && storedProgress.message) {
            setDebugProgress(storedProgress);
            const isErr = storedProgress.kind === 'error';
            setStatus(String(storedProgress.message), isErr ? 'error' : '');
            if (!isErr) {
                showActionToast(String(storedProgress.message), 'info');
            }
        } else {
            resetDebugProgress();
        }
    } catch (_error) {
        resetDebugProgress();
    }
    try {
        const cacheState = await refreshCardCacheUi();
        const cached = await loadCardCache();
        if (cached?.cardName) {
            if (isSidebarLayout()) {
                renderSidebarCardEditor(cached.cardData);
                syncSidebarEditorToHiddenJson();
            } else if (!String(getCardEditorValue() || '').trim()) {
                setCardEditorValue(cached.cardData);
            }
            setCardFileName(cached.cardName);
        } else if (isSidebarLayout()) {
            renderSidebarCardEditor({ name: '未命名自动化卡片', steps: [] });
            syncSidebarEditorToHiddenJson();
            updateSidebarEditorMeta({ name: '未命名自动化卡片', steps: [] });
        } else if (cacheState.items.length === 0) {
            setCardFileName('未选择卡片');
        }
    } catch (_error) {
        void renderCardCacheList({ items: [], selectedId: '' });
        if (isSidebarLayout()) {
            renderSidebarCardEditor({ name: '未命名自动化卡片', steps: [] });
            syncSidebarEditorToHiddenJson();
            updateSidebarEditorMeta({ name: '未命名自动化卡片', steps: [] });
        }
    }
})();
