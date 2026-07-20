const { shared, cookieModule, formatCookieCredentialTime, padCookieCredentialDatePart, getTodayCookieCredentialDateKey, getCookieCredentialDateKey, getCookieCredentialDateFromKey, getCookieCredentialYesterdayKey, formatCookieCredentialDateLabel, formatCookieCredentialTimeLabel, buildCookieCredentialSearchText, normalizeCookieCredentialSearchQuery, cookieCredentialItemMatchesQuery, buildCookieCredentialCacheId, normalizeCookieCredentialCacheEntry, buildCookieCredentialListLabel, buildCookieCredentialClipboardText, buildCookieCredentialAccountPasswordText, buildCookieCredentialGroupAccountPasswordText, focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem, importCookiesFromText, savePreset, loadPreset, saveCookieCredentialRecord, captureCurrentTab, clearCurrentPageCache, getCurrentActiveTabForCookieManager, refreshCookieManagerList, openCookieManagerPanel, closeCookieManagerPanel, deleteCookieManagerItem, ACCOUNT_KEY, PASSWORD_KEY, COOKIE_NOTE_KEY, COOKIE_CARD_KEY, COOKIE_CREDENTIAL_CACHE_LIST_KEY, COOKIE_CREDENTIAL_SELECTED_DATE_KEY, COOKIE_CREDENTIAL_SEARCH_KEY, COOKIE_CREDENTIAL_CACHE_MAX_ITEMS, AUTOMATION_CARD_CACHE_KEY, AUTOMATION_CARD_CACHE_NAME_KEY, AUTOMATION_CARD_CACHE_TIME_KEY, AUTOMATION_CARD_CACHE_LIST_KEY, AUTOMATION_CARD_SELECTED_ID_KEY, AUTOMATION_CARD_RUN_INPUTS_KEY, LAST_MAIN_PANEL_KEY, STANDALONE_PROGRESS_STATE_KEY, accountInput, passwordInput, cookieNoteInput, cookieCardKeyInput, cookieImportFileInput, generateCookiePasswordButton, importCookieButton, saveCookieCredentialsButton, cookieCredentialEditPanelNode, cookieCredentialEditPanelSubtitleNode, editCookieAccountInput, editCookiePasswordInput, editCookieNoteInput, editCookieCardKeyInput, saveCookieCredentialEditButton, cancelCookieEditButton, cookieCredentialDateFilterNode, cookieCredentialSearchNode, captureButton, clearCurrentPageCacheButton, clearCacheConfirmModal, clearCacheConfirmCancelButton, clearCacheConfirmSubmitButton, cookieManagerPanelNode, closeCookieManagerButton, refreshCookieManagerButton, downloadCookieManagerButton, clearAllCookieManagerButton, cookieManagerListNode, statusNode, cookieCredentialCountNode, cookieCredentialListNode, openCardDataImportButton, cardDataImportModal, cardDataImportInput, cardDataImportError, cardDataImportCancelButton, cardDataImportSaveButton, cardDataExportModal, cardDataExportOutput, cardDataExportCopyButton, cardDataExportDoneButton, importCardButton, loopCardButton, cardFileNameNode, cardCacheBadgeNode, cardCacheListNode, deleteCardButton, deleteCardConfirmModal, deleteCardConfirmMessage, deleteCardConfirmCancelButton, deleteCardConfirmSubmitButton, cardEditor, loadCardToEditorButton, saveCardEditorButton, exportCardButton, appendStepButton, stepTypeSelect, stepNameInput, stepSelectorInput, stepTextInput, stepUrlInput, stepTimeoutInput, heroTutorialButton, openCardSidebarButton, mainTabsNode, mainTabButtons, mainPanels, toastStackNode, sidebarEditorShell, sidebarCardNameInput, sidebarCardWebsiteInput, sidebarCardDescriptionInput, sidebarCardPointsInput, sidebarCardPopupsInput, sidebarCardUploadServerUrlInput, sidebarCardUploadCardKeyInput, sidebarCardRawJsonInput, sidebarCloseButton, sidebarSaveCardButton, sidebarCardSettingsOpenButton, sidebarCardSettingsModal, sidebarCardSettingsCloseButton, sidebarFlowCanvasNode, sidebarFlowContextMenuNode, sidebarFlowDeleteSelectionButton, sidebarStepPaletteNode, sidebarFlowZoomOutButton, sidebarFlowZoomResetButton, sidebarFlowZoomInButton, sidebarFlowAutoLayoutButton, runControlStopButton, sidebarStepListNode, sidebarEditorMetaNode, TUTORIAL_URL, runtimeStateStorage, workbenchModule, buildPresetFileName, setStatus, copyTextToClipboard, downloadJsonFile, showToast, showActionToast, openTutorialPage, loadLastMainPanel, saveLastMainPanel, activateMainPanel, setCardFileName, setCardCacheBadge, buildCardExportFileName, buildCardCacheId, normalizeCardCacheEntry, buildCardListLabel, renderCardCacheList, normalizeProgressValue, loadStandaloneProgressState, setLoopButtonState, refreshLoopButtonState, sendStopAction, sendContinueAction, normalizeCardData, stringifyCardData, parseEditorCardData, setCardEditorValue, getCardEditorValue, isSidebarLayout, renderSidebarFlowCanvas, clearSidebarFlowNodeSelection, prepareSidebarFlowNodeContextSelection, positionSidebarNodeSettings, zoomSidebarFlowBy, resetSidebarFlowView, beginSidebarFlowCanvasPan, addSidebarStepToCanvas, handleSidebarFlowNodeClick, beginSidebarFlowPortDrag, deleteSidebarFlowEdge, deleteSelectedSidebarFlowNodes, applySidebarFlowAutoLayout, beginSidebarFlowNodeDrag, escapeHtml, normalizeSidebarPopupsInput, formatSidebarPopupsInput, decodeHtmlEntities, escapeCssIdentifier, escapeCssAttributeValue, escapeHasTextValue, normalizeSelectorText, looksLikeHtmlSnippet, buildStandardSelectorFromHtmlSnippet, normalizeSelectorInputValue, normalizeSidebarStepSelectorControl, updateSidebarEditorMeta, buildSidebarStepTemplate, collectSidebarStepExpansionState, buildSidebarStepSummary, buildSidebarStepCardHtml, updateSidebarStepSettingsVisibility, collectSidebarStepCards, readSidebarStepCard, collectSidebarSteps, resetSidebarStepStatuses, applyExecutionStatusToSidebarStep, syncSidebarEditorToHiddenJson, collectSidebarCardDataFromForm, renderSidebarCardEditor, getSidebarCardDataFromEditor, getCardDataForExport, exportCard, loadCardCacheState, saveCardCacheState, refreshCardCacheUi, selectCardCacheItem, upsertCardCache, renderSidebarEditorFromCurrentState, saveCardCache, saveEditorCardToCache, setDebugProgress, resetDebugProgress, scheduleDebugProgressAutoHide, generateCookiePassword, flowModule, loadCardIntoEditor, loadCardCache, clearCardCache, deleteSelectedCardCache, sendStandaloneMessage, openCardEditorSidebar, resolveCardForRun, importCardTextToCache, importAndStartCard, loopCard, setCardDataImportError, setCardDataImportOpen, setDeleteCardConfirmOpen, cardCacheRefreshTimer, setClearCacheConfirmOpen } = globalThis.CookieCaptureBindingsContext;

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
sidebarFlowAutoLayoutButton?.addEventListener('click', () => {
    const result = applySidebarFlowAutoLayout();
    if (result) {
        showActionToast('已按流程自动排版', 'success');
    }
});


Object.assign(globalThis.CookieCaptureBindingsContext, { setSidebarCardSettingsOpen, setSidebarRequiredFieldInvalid, validateSidebarRequiredFields, setCardDataExportOpen });
