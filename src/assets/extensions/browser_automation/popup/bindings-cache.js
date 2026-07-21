const { shared, cookieModule, formatCookieCredentialTime, padCookieCredentialDatePart, getTodayCookieCredentialDateKey, getCookieCredentialDateKey, getCookieCredentialDateFromKey, getCookieCredentialYesterdayKey, formatCookieCredentialDateLabel, formatCookieCredentialTimeLabel, buildCookieCredentialSearchText, normalizeCookieCredentialSearchQuery, cookieCredentialItemMatchesQuery, buildCookieCredentialCacheId, normalizeCookieCredentialCacheEntry, buildCookieCredentialListLabel, buildCookieCredentialClipboardText, buildCookieCredentialAccountPasswordText, buildCookieCredentialGroupAccountPasswordText, focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem, importCookiesFromText, savePreset, loadPreset, saveCookieCredentialRecord, captureCurrentTab, clearCurrentPageCache, getCurrentActiveTabForCookieManager, refreshCookieManagerList, openCookieManagerPanel, closeCookieManagerPanel, deleteCookieManagerItem, ACCOUNT_KEY, PASSWORD_KEY, COOKIE_NOTE_KEY, COOKIE_CARD_KEY, COOKIE_CREDENTIAL_CACHE_LIST_KEY, COOKIE_CREDENTIAL_SELECTED_DATE_KEY, COOKIE_CREDENTIAL_SEARCH_KEY, COOKIE_CREDENTIAL_CACHE_MAX_ITEMS, AUTOMATION_CARD_CACHE_KEY, AUTOMATION_CARD_CACHE_NAME_KEY, AUTOMATION_CARD_CACHE_TIME_KEY, AUTOMATION_CARD_CACHE_LIST_KEY, AUTOMATION_CARD_SELECTED_ID_KEY, AUTOMATION_CARD_RUN_INPUTS_KEY, LAST_MAIN_PANEL_KEY, STANDALONE_PROGRESS_STATE_KEY, accountInput, passwordInput, cookieNoteInput, cookieCardKeyInput, cookieImportFileInput, generateCookiePasswordButton, importCookieButton, saveCookieCredentialsButton, cookieCredentialEditPanelNode, cookieCredentialEditPanelSubtitleNode, editCookieAccountInput, editCookiePasswordInput, editCookieNoteInput, editCookieCardKeyInput, saveCookieCredentialEditButton, cancelCookieEditButton, cookieCredentialDateFilterNode, cookieCredentialSearchNode, captureButton, clearCurrentPageCacheButton, clearCacheConfirmModal, clearCacheConfirmCancelButton, clearCacheConfirmSubmitButton, cookieManagerPanelNode, closeCookieManagerButton, refreshCookieManagerButton, downloadCookieManagerButton, clearAllCookieManagerButton, cookieManagerListNode, statusNode, cookieCredentialCountNode, cookieCredentialListNode, openCardDataImportButton, cardDataImportModal, cardDataImportInput, cardDataImportError, cardDataImportCancelButton, cardDataImportSaveButton, cardDataExportModal, cardDataExportOutput, cardDataExportCopyButton, cardDataExportDoneButton, importCardButton, loopCardButton, cardFileNameNode, cardCacheBadgeNode, cardCacheListNode, deleteCardButton, deleteCardConfirmModal, deleteCardConfirmMessage, deleteCardConfirmCancelButton, deleteCardConfirmSubmitButton, cardEditor, loadCardToEditorButton, saveCardEditorButton, exportCardButton, appendStepButton, stepTypeSelect, stepNameInput, stepSelectorInput, stepTextInput, stepUrlInput, stepTimeoutInput, heroTutorialButton, openCardSidebarButton, mainTabsNode, mainTabButtons, mainPanels, toastStackNode, sidebarEditorShell, sidebarCardNameInput, sidebarCardWebsiteInput, sidebarCardDescriptionInput, sidebarCardPointsInput, sidebarCardPopupsInput, sidebarCardUploadServerUrlInput, sidebarCardUploadCardKeyInput, sidebarCardRawJsonInput, sidebarCloseButton, sidebarSaveCardButton, sidebarCardSettingsOpenButton, sidebarCardSettingsModal, sidebarCardSettingsCloseButton, sidebarFlowCanvasNode, sidebarFlowContextMenuNode, sidebarFlowDeleteSelectionButton, sidebarStepPaletteNode, sidebarFlowZoomOutButton, sidebarFlowZoomResetButton, sidebarFlowZoomInButton, sidebarFlowAutoLayoutButton, runControlStopButton, sidebarStepListNode, sidebarEditorMetaNode, TUTORIAL_URL, runtimeStateStorage, workbenchModule, buildPresetFileName, setStatus, copyTextToClipboard, downloadJsonFile, showToast, showActionToast, openTutorialPage, loadLastMainPanel, saveLastMainPanel, activateMainPanel, setCardFileName, setCardCacheBadge, buildCardExportFileName, buildCardCacheId, normalizeCardCacheEntry, buildCardListLabel, renderCardCacheList, normalizeProgressValue, loadStandaloneProgressState, setLoopButtonState, refreshLoopButtonState, sendStopAction, sendContinueAction, normalizeCardData, stringifyCardData, parseEditorCardData, setCardEditorValue, getCardEditorValue, isSidebarLayout, renderSidebarFlowCanvas, clearSidebarFlowNodeSelection, prepareSidebarFlowNodeContextSelection, positionSidebarNodeSettings, zoomSidebarFlowBy, resetSidebarFlowView, beginSidebarFlowCanvasPan, addSidebarStepToCanvas, handleSidebarFlowNodeClick, beginSidebarFlowPortDrag, deleteSidebarFlowEdge, deleteSelectedSidebarFlowNodes, applySidebarFlowAutoLayout, beginSidebarFlowNodeDrag, escapeHtml, normalizeSidebarPopupsInput, formatSidebarPopupsInput, decodeHtmlEntities, escapeCssIdentifier, escapeCssAttributeValue, escapeHasTextValue, normalizeSelectorText, looksLikeHtmlSnippet, buildStandardSelectorFromHtmlSnippet, normalizeSelectorInputValue, normalizeSidebarStepSelectorControl, updateSidebarEditorMeta, buildSidebarStepTemplate, collectSidebarStepExpansionState, buildSidebarStepSummary, buildSidebarStepCardHtml, updateSidebarStepSettingsVisibility, collectSidebarStepCards, readSidebarStepCard, collectSidebarSteps, resetSidebarStepStatuses, applyExecutionStatusToSidebarStep, syncSidebarEditorToHiddenJson, collectSidebarCardDataFromForm, renderSidebarCardEditor, getSidebarCardDataFromEditor, getCardDataForExport, exportCard, loadCardCacheState, saveCardCacheState, refreshCardCacheUi, selectCardCacheItem, upsertCardCache, renderSidebarEditorFromCurrentState, saveCardCache, saveEditorCardToCache, setDebugProgress, resetDebugProgress, scheduleDebugProgressAutoHide, generateCookiePassword, flowModule, loadCardIntoEditor, loadCardCache, clearCardCache, deleteSelectedCardCache, sendStandaloneMessage, openCardEditorSidebar, resolveCardForRun, importCardTextToCache, importAndStartCard, loopCard, setCardDataImportError, setCardDataImportOpen, setDeleteCardConfirmOpen, cardCacheRefreshTimer } = globalThis.CookieCaptureBindingsContext;

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


Object.assign(globalThis.CookieCaptureBindingsContext, { setClearCacheConfirmOpen });
