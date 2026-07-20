const { shared, cookieModule, formatCookieCredentialTime, padCookieCredentialDatePart, getTodayCookieCredentialDateKey, getCookieCredentialDateKey, getCookieCredentialDateFromKey, getCookieCredentialYesterdayKey, formatCookieCredentialDateLabel, formatCookieCredentialTimeLabel, buildCookieCredentialSearchText, normalizeCookieCredentialSearchQuery, cookieCredentialItemMatchesQuery, buildCookieCredentialCacheId, normalizeCookieCredentialCacheEntry, buildCookieCredentialListLabel, buildCookieCredentialClipboardText, buildCookieCredentialAccountPasswordText, buildCookieCredentialGroupAccountPasswordText, focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem, importCookiesFromText, savePreset, loadPreset, saveCookieCredentialRecord, captureCurrentTab, clearCurrentPageCache, getCurrentActiveTabForCookieManager, refreshCookieManagerList, openCookieManagerPanel, closeCookieManagerPanel, deleteCookieManagerItem, ACCOUNT_KEY, PASSWORD_KEY, COOKIE_NOTE_KEY, COOKIE_CARD_KEY, COOKIE_CREDENTIAL_CACHE_LIST_KEY, COOKIE_CREDENTIAL_SELECTED_DATE_KEY, COOKIE_CREDENTIAL_SEARCH_KEY, COOKIE_CREDENTIAL_CACHE_MAX_ITEMS, AUTOMATION_CARD_CACHE_KEY, AUTOMATION_CARD_CACHE_NAME_KEY, AUTOMATION_CARD_CACHE_TIME_KEY, AUTOMATION_CARD_CACHE_LIST_KEY, AUTOMATION_CARD_SELECTED_ID_KEY, AUTOMATION_CARD_RUN_INPUTS_KEY, LAST_MAIN_PANEL_KEY, STANDALONE_PROGRESS_STATE_KEY, accountInput, passwordInput, cookieNoteInput, cookieCardKeyInput, cookieImportFileInput, generateCookiePasswordButton, importCookieButton, saveCookieCredentialsButton, cookieCredentialEditPanelNode, cookieCredentialEditPanelSubtitleNode, editCookieAccountInput, editCookiePasswordInput, editCookieNoteInput, editCookieCardKeyInput, saveCookieCredentialEditButton, cancelCookieEditButton, cookieCredentialDateFilterNode, cookieCredentialSearchNode, captureButton, clearCurrentPageCacheButton, clearCacheConfirmModal, clearCacheConfirmCancelButton, clearCacheConfirmSubmitButton, cookieManagerPanelNode, closeCookieManagerButton, refreshCookieManagerButton, downloadCookieManagerButton, clearAllCookieManagerButton, cookieManagerListNode, statusNode, cookieCredentialCountNode, cookieCredentialListNode, openCardDataImportButton, cardDataImportModal, cardDataImportInput, cardDataImportError, cardDataImportCancelButton, cardDataImportSaveButton, cardDataExportModal, cardDataExportOutput, cardDataExportCopyButton, cardDataExportDoneButton, importCardButton, loopCardButton, cardFileNameNode, cardCacheBadgeNode, cardCacheListNode, deleteCardButton, deleteCardConfirmModal, deleteCardConfirmMessage, deleteCardConfirmCancelButton, deleteCardConfirmSubmitButton, cardEditor, loadCardToEditorButton, saveCardEditorButton, exportCardButton, appendStepButton, stepTypeSelect, stepNameInput, stepSelectorInput, stepTextInput, stepUrlInput, stepTimeoutInput, heroTutorialButton, openCardSidebarButton, mainTabsNode, mainTabButtons, mainPanels, toastStackNode, sidebarEditorShell, sidebarCardNameInput, sidebarCardWebsiteInput, sidebarCardDescriptionInput, sidebarCardPointsInput, sidebarCardPopupsInput, sidebarCardUploadServerUrlInput, sidebarCardUploadCardKeyInput, sidebarCardRawJsonInput, sidebarCloseButton, sidebarSaveCardButton, sidebarCardSettingsOpenButton, sidebarCardSettingsModal, sidebarCardSettingsCloseButton, sidebarFlowCanvasNode, sidebarFlowContextMenuNode, sidebarFlowDeleteSelectionButton, sidebarStepPaletteNode, sidebarFlowZoomOutButton, sidebarFlowZoomResetButton, sidebarFlowZoomInButton, sidebarFlowAutoLayoutButton, runControlStopButton, sidebarStepListNode, sidebarEditorMetaNode, TUTORIAL_URL, runtimeStateStorage, workbenchModule, buildPresetFileName, setStatus, copyTextToClipboard, downloadJsonFile, showToast, showActionToast, openTutorialPage, loadLastMainPanel, saveLastMainPanel, activateMainPanel, setCardFileName, setCardCacheBadge, buildCardExportFileName, buildCardCacheId, normalizeCardCacheEntry, buildCardListLabel, renderCardCacheList, normalizeProgressValue, loadStandaloneProgressState, setLoopButtonState, refreshLoopButtonState, sendStopAction, sendContinueAction, normalizeCardData, stringifyCardData, parseEditorCardData, setCardEditorValue, getCardEditorValue, isSidebarLayout, renderSidebarFlowCanvas, clearSidebarFlowNodeSelection, prepareSidebarFlowNodeContextSelection, positionSidebarNodeSettings, zoomSidebarFlowBy, resetSidebarFlowView, beginSidebarFlowCanvasPan, addSidebarStepToCanvas, handleSidebarFlowNodeClick, beginSidebarFlowPortDrag, deleteSidebarFlowEdge, deleteSelectedSidebarFlowNodes, applySidebarFlowAutoLayout, beginSidebarFlowNodeDrag, escapeHtml, normalizeSidebarPopupsInput, formatSidebarPopupsInput, decodeHtmlEntities, escapeCssIdentifier, escapeCssAttributeValue, escapeHasTextValue, normalizeSelectorText, looksLikeHtmlSnippet, buildStandardSelectorFromHtmlSnippet, normalizeSelectorInputValue, normalizeSidebarStepSelectorControl, updateSidebarEditorMeta, buildSidebarStepTemplate, collectSidebarStepExpansionState, buildSidebarStepSummary, buildSidebarStepCardHtml, updateSidebarStepSettingsVisibility, collectSidebarStepCards, readSidebarStepCard, collectSidebarSteps, resetSidebarStepStatuses, applyExecutionStatusToSidebarStep, syncSidebarEditorToHiddenJson, collectSidebarCardDataFromForm, renderSidebarCardEditor, getSidebarCardDataFromEditor, getCardDataForExport, exportCard, loadCardCacheState, saveCardCacheState, refreshCardCacheUi, selectCardCacheItem, upsertCardCache, renderSidebarEditorFromCurrentState, saveCardCache, saveEditorCardToCache, setDebugProgress, resetDebugProgress, scheduleDebugProgressAutoHide, generateCookiePassword, flowModule, loadCardIntoEditor, loadCardCache, clearCardCache, deleteSelectedCardCache, sendStandaloneMessage, openCardEditorSidebar, resolveCardForRun, importCardTextToCache, importAndStartCard, loopCard, setCardDataImportError, setCardDataImportOpen, setDeleteCardConfirmOpen, cardCacheRefreshTimer, setClearCacheConfirmOpen, setSidebarCardSettingsOpen, setSidebarRequiredFieldInvalid, validateSidebarRequiredFields, setCardDataExportOpen } = globalThis.CookieCaptureBindingsContext;

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

function handleSidebarStepFieldChange(event) {
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
}

sidebarStepListNode?.addEventListener('input', handleSidebarStepFieldChange);
sidebarStepListNode?.addEventListener('change', handleSidebarStepFieldChange);

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

function readSidebarStepAction(event) {
    const button = event.target && event.target.closest ? event.target.closest('[data-sidebar-step-action]') : null;
    if (!button) return null;
    const card = button.closest('[data-sidebar-step-card]');
    if (!card) return null;
    const currentCard = getSidebarCardDataFromEditor();
    const steps = Array.isArray(currentCard.steps) ? [...currentCard.steps] : [];
    const index = Number(card.dataset.stepIndex || Array.from(card.parentElement?.children || []).indexOf(card));
    const action = String(button.dataset.sidebarStepAction || '').trim();
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) return null;
    return { action, button, card, currentCard, index, steps };
}

function editSidebarStepSelector(context) {
    const selectorControl = context.card.querySelector('[data-sidebar-step-field="selector"]');
    if (!selectorControl) return;
    const currentValue = String(selectorControl.value || '').trim();
    const nextValue = window.prompt('请输入选择器或 HTML 元素片段', currentValue);
    if (nextValue === null) return;
    selectorControl.value = nextValue;
    const normalized = normalizeSidebarStepSelectorControl(context.card, selectorControl);
    syncSidebarEditorToHiddenJson();
    selectorControl.focus();
    selectorControl.setSelectionRange(selectorControl.value.length, selectorControl.value.length);
    showActionToast(normalized.converted ? '已标准化选择器' : '已更新选择器', 'success');
}

function persistSidebarStepOrder(context) {
    context.currentCard.steps = context.steps;
    renderSidebarCardEditor(context.currentCard);
    syncSidebarEditorToHiddenJson();
}

function moveSidebarStep(context, offset) {
    const targetIndex = context.index + offset;
    if (targetIndex < 0 || targetIndex >= context.steps.length) return;
    const [moved] = context.steps.splice(context.index, 1);
    context.steps.splice(targetIndex, 0, moved);
    persistSidebarStepOrder(context);
}

function handleSidebarStepAction(event) {
    const context = readSidebarStepAction(event);
    if (!context) return;
    if (context.action === 'close') {
        clearSidebarFlowNodeSelection();
        return;
    }
    if (context.action === 'selector') {
        editSidebarStepSelector(context);
        return;
    }
    if (context.action === 'delete') {
        context.steps.splice(context.index, 1);
        persistSidebarStepOrder(context);
        return;
    }
    if (context.action === 'up') moveSidebarStep(context, -1);
    if (context.action === 'down') moveSidebarStep(context, 1);
}

sidebarStepListNode?.addEventListener('click', handleSidebarStepAction);

function buildCardRunStepMeta(message, progressValue, hasProgress) {
    const stepIndex = Number(message.stepIndex || 0) || 0;
    const stepTotal = Number(message.stepTotal || 0) || 0;
    const stepName = String(message.stepName || '').trim();
    const stepLabel = stepIndex > 0
        ? (stepTotal > 0 ? `第 ${stepIndex}/${stepTotal} 步` : `第 ${stepIndex} 步`)
        : '';
    const parts = [
        stepLabel && stepName ? `${stepLabel} · ${stepName}` : (stepName || stepLabel),
        message.previousStepName ? `上一步：${String(message.previousStepName).trim()}` : '',
        message.nextStepName ? `下一步：${String(message.nextStepName).trim()}` : '',
        hasProgress ? `${Math.round(Math.max(0, Math.min(100, progressValue)))}%` : ''
    ];
    return { stepIndex, stepTotal, stepName, meta: parts.filter(Boolean).join(' · ') };
}

function applySidebarCardRunStepStatus(message, stepIndex, errorReason, text) {
    if (!isSidebarLayout() || typeof applyExecutionStatusToSidebarStep !== 'function' || stepIndex <= 0) return;
    const phase = String(message.phase || '').trim();
    if (phase === 'step_start') applyExecutionStatusToSidebarStep(stepIndex, 'running');
    else if (phase === 'step_complete') applyExecutionStatusToSidebarStep(stepIndex, 'success');
    else if (phase === 'step_skip') applyExecutionStatusToSidebarStep(stepIndex, 'pending');
    else if (message.kind === 'error') applyExecutionStatusToSidebarStep(stepIndex, 'error', errorReason || text);
}

function handleCardRunProgressMessage(message) {
    const text = String(message.message || '').trim();
    const progressValue = Number(message.progress);
    const hasProgress = Number.isFinite(progressValue);
    const errorReason = String(message.errorReason || '').trim();
    const step = buildCardRunStepMeta(message, progressValue, hasProgress);
    const progressState = {
        visible: true,
        message: text || '正在处理自动化执行...',
        kind: message.kind || '',
        errorReason,
        mode: String(message.mode || '').trim() || 'debug',
        stepIndex: step.stepIndex,
        stepTotal: step.stepTotal,
        stepName: step.stepName,
        meta: step.meta
    };
    if (hasProgress) progressState.progress = progressValue;
    setDebugProgress(progressState);
    if (text) setStatus(text, message.kind === 'error' ? 'error' : '');
    setLoopButtonState(message.running === true);
    applySidebarCardRunStepStatus(message, step.stepIndex, errorReason, text);
}

async function resolveFinishedCardStepIndex(message, success, stopped) {
    let stepIndex = Number(message.stepIndex || 0) || 0;
    if (success || stopped || stepIndex) return stepIndex;
    const state = await loadStandaloneProgressState().catch(() => null);
    return state && Number(state.stepIndex) ? Number(state.stepIndex) : 0;
}

function applyFinishedSidebarStep(message, success, stopped, stepIndex) {
    if (!isSidebarLayout() || typeof applyExecutionStatusToSidebarStep !== 'function' || stepIndex <= 0) return;
    if (success || stopped) applyExecutionStatusToSidebarStep(stepIndex, 'success');
    else applyExecutionStatusToSidebarStep(
        stepIndex,
        'error',
        String(message.errorReason || message.message || '执行失败')
    );
}

async function renderFinishedCardProgress(message, outcome) {
    const stepIndex = await resolveFinishedCardStepIndex(message, outcome.success, outcome.stopped);
    setDebugProgress({
        visible: true,
        progress: outcome.progress,
        message: outcome.message,
        kind: outcome.success || outcome.stopped ? '' : 'error',
        errorReason: String(message.errorReason || (!outcome.success && !outcome.stopped ? message.message || '' : '')).trim(),
        meta: outcome.continuation ? '继续循环' : outcome.stopped ? '已停止' : outcome.success ? '已完成' : '已失败',
        mode: outcome.continuation ? 'loop' : '',
        stepIndex
    });
    applyFinishedSidebarStep(message, outcome.success, outcome.stopped, stepIndex);
}

function handleCardRunFinishedMessage(message) {
    const success = message.success === true;
    const stopped = message.stopped === true || String(message.message || '').includes('已停止');
    const continuation = message.isLooping === true && message.continuation === true;
    const progress = Number.isFinite(Number(message.progress)) ? Number(message.progress) : (success ? 100 : 0);
    const finalMessage = String(message.message || (success ? '执行完成' : '执行失败'));
    void renderFinishedCardProgress(message, { success, stopped, continuation, progress, message: finalMessage });
    if (success || stopped) {
        setStatus(finalMessage, 'success');
        showActionToast(finalMessage, 'success');
    } else {
        setStatus(String(message.errorReason || message.message || '执行失败'), 'error');
    }
    setLoopButtonState(continuation || message.running === true);
}

chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.type === 'card-run-progress') {
        handleCardRunProgressMessage(message);
    }

    if (message.type === 'card-run-finished') {
        handleCardRunFinishedMessage(message);
    }
});

async function restoreStoredCardProgressUi() {
    try {
        const stored = await loadStandaloneProgressState();
        if (!stored || stored.visible === false || !stored.message) {
            resetDebugProgress();
            return;
        }
        setDebugProgress(stored);
        const isError = stored.kind === 'error';
        setStatus(String(stored.message), isError ? 'error' : '');
        if (!isError) showActionToast(String(stored.message), 'info');
    } catch (_error) {
        resetDebugProgress();
    }
}

function renderEmptySidebarCard() {
    const emptyCard = { name: '未命名自动化卡片', steps: [] };
    renderSidebarCardEditor(emptyCard);
    syncSidebarEditorToHiddenJson();
    updateSidebarEditorMeta(emptyCard);
}

async function restoreCachedCardUi() {
    try {
        const cacheState = await refreshCardCacheUi();
        const cached = await loadCardCache();
        if (cached && cached.cardName) {
            if (isSidebarLayout()) {
                renderSidebarCardEditor(cached.cardData);
                syncSidebarEditorToHiddenJson();
            } else if (!String(getCardEditorValue() || '').trim()) {
                setCardEditorValue(cached.cardData);
            }
            setCardFileName(cached.cardName);
            return;
        }
        if (isSidebarLayout()) renderEmptySidebarCard();
        else if (cacheState.items.length === 0) setCardFileName('未选择卡片');
    } catch (_error) {
        void renderCardCacheList({ items: [], selectedId: '' });
        if (isSidebarLayout()) renderEmptySidebarCard();
    }
}

async function initializeBindingsFlow() {
    const lastMainPanel = await loadLastMainPanel().catch(() => 'card');
    activateMainPanel(lastMainPanel || 'card', { persist: false });
    await loadPreset();
    syncCookieCredentialEditUi();
    await refreshCookieCredentialCacheUi().catch(() => {});
    await refreshLoopButtonState();
    await restoreStoredCardProgressUi();
    await restoreCachedCardUi();
}

void initializeBindingsFlow();

Object.assign(globalThis.CookieCaptureBindingsContext, { sidebarPaletteDragActive, closeSidebarFlowContextMenu, openSidebarFlowContextMenu });
