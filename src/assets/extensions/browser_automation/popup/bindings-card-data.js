const { shared, cookieModule, formatCookieCredentialTime, padCookieCredentialDatePart, getTodayCookieCredentialDateKey, getCookieCredentialDateKey, getCookieCredentialDateFromKey, getCookieCredentialYesterdayKey, formatCookieCredentialDateLabel, formatCookieCredentialTimeLabel, buildCookieCredentialSearchText, normalizeCookieCredentialSearchQuery, cookieCredentialItemMatchesQuery, buildCookieCredentialCacheId, normalizeCookieCredentialCacheEntry, buildCookieCredentialListLabel, buildCookieCredentialClipboardText, buildCookieCredentialAccountPasswordText, buildCookieCredentialGroupAccountPasswordText, focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem, importCookiesFromText, savePreset, loadPreset, saveCookieCredentialRecord, captureCurrentTab, clearCurrentPageCache, getCurrentActiveTabForCookieManager, refreshCookieManagerList, openCookieManagerPanel, closeCookieManagerPanel, deleteCookieManagerItem, ACCOUNT_KEY, PASSWORD_KEY, COOKIE_NOTE_KEY, COOKIE_CARD_KEY, COOKIE_CREDENTIAL_CACHE_LIST_KEY, COOKIE_CREDENTIAL_SELECTED_DATE_KEY, COOKIE_CREDENTIAL_SEARCH_KEY, COOKIE_CREDENTIAL_CACHE_MAX_ITEMS, AUTOMATION_CARD_CACHE_KEY, AUTOMATION_CARD_CACHE_NAME_KEY, AUTOMATION_CARD_CACHE_TIME_KEY, AUTOMATION_CARD_CACHE_LIST_KEY, AUTOMATION_CARD_SELECTED_ID_KEY, AUTOMATION_CARD_RUN_INPUTS_KEY, LAST_MAIN_PANEL_KEY, STANDALONE_PROGRESS_STATE_KEY, accountInput, passwordInput, cookieNoteInput, cookieCardKeyInput, cookieImportFileInput, generateCookiePasswordButton, importCookieButton, saveCookieCredentialsButton, cookieCredentialEditPanelNode, cookieCredentialEditPanelSubtitleNode, editCookieAccountInput, editCookiePasswordInput, editCookieNoteInput, editCookieCardKeyInput, saveCookieCredentialEditButton, cancelCookieEditButton, cookieCredentialDateFilterNode, cookieCredentialSearchNode, captureButton, clearCurrentPageCacheButton, clearCacheConfirmModal, clearCacheConfirmCancelButton, clearCacheConfirmSubmitButton, cookieManagerPanelNode, closeCookieManagerButton, refreshCookieManagerButton, downloadCookieManagerButton, clearAllCookieManagerButton, cookieManagerListNode, statusNode, cookieCredentialCountNode, cookieCredentialListNode, openCardDataImportButton, cardDataImportModal, cardDataImportInput, cardDataImportError, cardDataImportCancelButton, cardDataImportSaveButton, cardDataExportModal, cardDataExportOutput, cardDataExportCopyButton, cardDataExportDoneButton, importCardButton, loopCardButton, cardFileNameNode, cardCacheBadgeNode, cardCacheListNode, deleteCardButton, deleteCardConfirmModal, deleteCardConfirmMessage, deleteCardConfirmCancelButton, deleteCardConfirmSubmitButton, cardEditor, loadCardToEditorButton, saveCardEditorButton, exportCardButton, appendStepButton, stepTypeSelect, stepNameInput, stepSelectorInput, stepTextInput, stepUrlInput, stepTimeoutInput, heroTutorialButton, openCardSidebarButton, mainTabsNode, mainTabButtons, mainPanels, toastStackNode, sidebarEditorShell, sidebarCardNameInput, sidebarCardWebsiteInput, sidebarCardDescriptionInput, sidebarCardPointsInput, sidebarCardPopupsInput, sidebarCardUploadServerUrlInput, sidebarCardUploadCardKeyInput, sidebarCardRawJsonInput, sidebarCloseButton, sidebarSaveCardButton, sidebarCardSettingsOpenButton, sidebarCardSettingsModal, sidebarCardSettingsCloseButton, sidebarFlowCanvasNode, sidebarFlowContextMenuNode, sidebarFlowDeleteSelectionButton, sidebarStepPaletteNode, sidebarFlowZoomOutButton, sidebarFlowZoomResetButton, sidebarFlowZoomInButton, sidebarFlowAutoLayoutButton, runControlStopButton, sidebarStepListNode, sidebarEditorMetaNode, TUTORIAL_URL, runtimeStateStorage, workbenchModule, buildPresetFileName, setStatus, copyTextToClipboard, downloadJsonFile, showToast, showActionToast, openTutorialPage, loadLastMainPanel, saveLastMainPanel, activateMainPanel, setCardFileName, setCardCacheBadge, buildCardExportFileName, buildCardCacheId, normalizeCardCacheEntry, buildCardListLabel, renderCardCacheList, normalizeProgressValue, loadStandaloneProgressState, setLoopButtonState, refreshLoopButtonState, sendStopAction, sendContinueAction, normalizeCardData, stringifyCardData, parseEditorCardData, setCardEditorValue, getCardEditorValue, isSidebarLayout, renderSidebarFlowCanvas, clearSidebarFlowNodeSelection, prepareSidebarFlowNodeContextSelection, positionSidebarNodeSettings, zoomSidebarFlowBy, resetSidebarFlowView, beginSidebarFlowCanvasPan, addSidebarStepToCanvas, handleSidebarFlowNodeClick, beginSidebarFlowPortDrag, deleteSidebarFlowEdge, deleteSelectedSidebarFlowNodes, applySidebarFlowAutoLayout, beginSidebarFlowNodeDrag, escapeHtml, normalizeSidebarPopupsInput, formatSidebarPopupsInput, decodeHtmlEntities, escapeCssIdentifier, escapeCssAttributeValue, escapeHasTextValue, normalizeSelectorText, looksLikeHtmlSnippet, buildStandardSelectorFromHtmlSnippet, normalizeSelectorInputValue, normalizeSidebarStepSelectorControl, updateSidebarEditorMeta, buildSidebarStepTemplate, collectSidebarStepExpansionState, buildSidebarStepSummary, buildSidebarStepCardHtml, updateSidebarStepSettingsVisibility, collectSidebarStepCards, readSidebarStepCard, collectSidebarSteps, resetSidebarStepStatuses, applyExecutionStatusToSidebarStep, syncSidebarEditorToHiddenJson, collectSidebarCardDataFromForm, renderSidebarCardEditor, getSidebarCardDataFromEditor, getCardDataForExport, exportCard, loadCardCacheState, saveCardCacheState, refreshCardCacheUi, selectCardCacheItem, upsertCardCache, renderSidebarEditorFromCurrentState, saveCardCache, saveEditorCardToCache, setDebugProgress, resetDebugProgress, scheduleDebugProgressAutoHide, generateCookiePassword, flowModule, loadCardIntoEditor, loadCardCache, clearCardCache, deleteSelectedCardCache, sendStandaloneMessage, openCardEditorSidebar, resolveCardForRun, importCardTextToCache, importAndStartCard, loopCard } = globalThis.CookieCaptureBindingsContext;

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

function setDeleteCardConfirmOpen(open = false) {
    if (!deleteCardConfirmModal) return false;
    const shouldOpen = open === true;
    deleteCardConfirmModal.hidden = !shouldOpen;
    if (deleteCardButton) {
        deleteCardButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
    if (shouldOpen) {
        const selectedName = String(cardFileNameNode?.textContent || '').trim();
        if (deleteCardConfirmMessage) {
            const displayName = selectedName && selectedName !== '未选择卡片'
                ? `「${selectedName}」`
                : '当前选中的';
            deleteCardConfirmMessage.textContent = `删除后无法恢复，确定要删除${displayName}自动化卡片吗？`;
        }
        const dialog = deleteCardConfirmModal.querySelector('.cookie-confirm-modal__dialog');
        window.requestAnimationFrame(() => dialog?.focus());
    } else {
        deleteCardButton?.focus();
    }
    return shouldOpen;
}

deleteCardButton?.addEventListener('click', () => {
    void (async () => {
        try {
            const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
            const items = Array.isArray(state.items) ? state.items : [];
            if (!items.length) {
                showActionToast('没有可删除的自动化卡片', 'error');
                return;
            }
            setDeleteCardConfirmOpen(true);
        } catch (error) {
            showActionToast(error && error.message ? error.message : '无法打开删除确认', 'error');
        }
    })();
});
deleteCardConfirmCancelButton?.addEventListener('click', () => setDeleteCardConfirmOpen(false));
deleteCardConfirmModal?.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-delete-card-confirm-dismiss]')) {
        setDeleteCardConfirmOpen(false);
    }
});
deleteCardConfirmSubmitButton?.addEventListener('click', () => {
    setDeleteCardConfirmOpen(false);
    void deleteSelectedCardCache().then(() => {
        showActionToast('已删除选中自动化卡片', 'success');
    }).catch((error) => {
        showActionToast(error && error.message ? error.message : '删除选中卡片失败', 'error');
    });
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && deleteCardConfirmModal && !deleteCardConfirmModal.hidden) {
        event.preventDefault();
        setDeleteCardConfirmOpen(false);
    }
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


Object.assign(globalThis.CookieCaptureBindingsContext, { setCardDataImportError, setCardDataImportOpen, setDeleteCardConfirmOpen, cardCacheRefreshTimer });
