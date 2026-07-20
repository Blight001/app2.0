'use strict';

function collectSidebarSteps() {
    const cards = collectSidebarStepCards();
    const steps = cards.map((card, index) => readSidebarStepCard(card, index)).filter(Boolean);
    return ensureSidebarStepIds(steps);
}

function syncSidebarEditorToHiddenJson() {
    if (!isSidebarLayout()) {
        return null;
    }

    const cardData = collectSidebarCardDataFromForm();
    if (!cardData) {
        return null;
    }

    setCardEditorValue(cardData);
    updateSidebarEditorMeta(cardData);
    renderSidebarFlowCanvas(cardData);
    return cardData;
}

function collectSidebarCardDataFromForm() {
    if (!isSidebarLayout()) return null;
    const base = parseSidebarCardRawJson();
    const steps = ensureSidebarStepIds(collectSidebarSteps());
    const flow = normalizeSidebarFlowForSteps(sidebarFlowState, steps);
    const popups = normalizeSidebarPopupsInput(String(sidebarCardPopupsInput?.value || ''));
    const points = Number(sidebarCardPointsInput?.value || 0);
    // 不再收集账号/密码/随机密码：输入内容改由各 type 步骤的变量（text 默认值 + 运行前 inputs 覆盖）承载。
    const { account: _dropAccount, password: _dropPassword, random: _dropRandom, ...baseRest } = base;
    const cardData = buildSidebarCardData(baseRest, base, { steps, flow, popups, points });
    applySidebarUploadFields(cardData, base);
    return normalizeCardData(cardData, cardData.name, { allowEmptySteps: true });
}

function parseSidebarCardRawJson() {
    const rawJson = String(sidebarCardRawJsonInput?.value || '').trim();
    if (!rawJson) return {};
    try {
        return JSON.parse(rawJson);
    } catch (_error) {
        return {};
    }
}

function buildSidebarCardData(baseRest, base, values) {
    return {
        ...baseRest,
        name: String(sidebarCardNameInput?.value || base.name || '').trim() || '未命名自动化卡片',
        website: String(sidebarCardWebsiteInput?.value || base.website || '').trim(),
        description: String(sidebarCardDescriptionInput?.value || base.description || '').trim(),
        points: Number.isFinite(values.points) ? values.points : 0,
        popups: values.popups,
        steps: values.steps,
        flow: values.flow
    };
}

function applySidebarUploadFields(cardData, base) {
    const uploadServerUrl = String(sidebarCardUploadServerUrlInput?.value || '').trim();
    const uploadCardKey = String(sidebarCardUploadCardKeyInput?.value || '').trim();
    if (uploadServerUrl) cardData.upload_server_url = uploadServerUrl;
    else delete cardData.upload_server_url;
    if (uploadCardKey) cardData.upload_card_key = uploadCardKey;
    else delete cardData.upload_card_key;
    cardData.upload = {
        ...(base.upload && typeof base.upload === 'object' ? base.upload : {}),
        server_url: uploadServerUrl,
        card_key: uploadCardKey
    };
}

function renderSidebarCardEditor(cardData) {
    if (!isSidebarLayout() || !sidebarEditorShell) {
        return;
    }

    const normalized = normalizeCardData(cardData || {}, cardData?.name || 'automation', { allowEmptySteps: true });
    const previousExpandedStates = collectSidebarStepExpansionState();
    applySidebarCardInputs(normalized);
    normalized.steps = ensureSidebarStepIds(normalizeSidebarEditorSteps(normalized.steps));
    normalized.flow = normalizeSidebarFlowForSteps(normalized.flow || null, normalized.steps);
    sidebarFlowState = normalized.flow;
    if (sidebarCardRawJsonInput) sidebarCardRawJsonInput.value = stringifyCardData(normalized);
    updateSidebarEditorMeta(normalized);
    renderSidebarFlowCanvas(normalized);
    if (!sidebarStepListNode) return;
    if (normalized.steps.length === 0) {
        renderEmptySidebarStepList();
        return;
    }

    sidebarStepListNode.innerHTML = normalized.steps.map((step, index) => buildSidebarStepCardHtml(step, index, previousExpandedStates.get(index) === true)).join('');
    collectSidebarStepCards().forEach((card) => updateSidebarStepSettingsVisibility(card));
    syncSidebarNodeSettingsSelection();
    resetSidebarStepStatuses();
}

function applySidebarCardInputs(normalized) {
    const assignments = [
        [sidebarCardNameInput, normalized.name],
        [sidebarCardWebsiteInput, normalized.website],
        [sidebarCardDescriptionInput, normalized.description],
        [sidebarCardPointsInput, normalized.points ?? 0],
        [sidebarCardPopupsInput, formatSidebarPopupsInput(normalized.popups || [])],
        [sidebarCardUploadServerUrlInput, normalized.upload_server_url || normalized.upload?.server_url || ''],
        [sidebarCardUploadCardKeyInput, normalized.upload_card_key || normalized.upload?.card_key || '']
    ];
    assignments.forEach(([input, value]) => { if (input) input.value = String(value ?? ''); });
}

function normalizeSidebarEditorSteps(rawSteps) {
    return (Array.isArray(rawSteps) ? rawSteps : []).map((step) => {
        const normalized = normalizeSelectorInputValue(step?.selector || '');
        return {
            ...step,
            selector: normalized.selector || String(step?.selector || '').trim(),
            by: normalized.converted ? 'css_selector' : String(step?.by || '').trim()
        };
    });
}

function renderEmptySidebarStepList() {
    sidebarSelectedFlowNodeId = '';
    sidebarStepListNode.innerHTML = '<div class="sidebar-step-empty">点击画布中的节点查看设置。</div>';
    sidebarStepListNode.classList.remove('is-open');
    sidebarStepListNode.setAttribute('aria-hidden', 'true');
    resetSidebarStepStatuses();
}

function getSidebarCardDataFromEditor() {
    return collectSidebarCardDataFromForm();
}

async function getCardDataForExport() {
    const sidebarCard = getSidebarCardDataForExport();
    if (sidebarCard) return sidebarCard;
    const editorText = String(getCardEditorValue() || '').trim();
    if (editorText) {
        const cardData = parseEditorCardData(editorText, { allowEmptySteps: true });
        return normalizeCardData(cardData, cardData?.name || 'automation', { allowEmptySteps: true });
    }

    const cacheState = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const cachedCard = cacheState.items.find((item) => item.id === cacheState.selectedId) || cacheState.items[0] || null;
    if (cachedCard?.cardData) {
        return normalizeCardData(cachedCard.cardData, cachedCard.cardName || cachedCard.cardData?.name || 'automation', { allowEmptySteps: true });
    }

    throw new Error('自动化卡片编辑器内容不能为空，请先导入、编辑或保存一次卡片');
}

function getSidebarCardDataForExport() {
    if (!isSidebarLayout()) return null;
    const cardData = getSidebarCardDataFromEditor();
    return cardData
        ? normalizeCardData(cardData, cardData?.name || 'automation', { allowEmptySteps: true })
        : null;
}

async function exportCard() {
    const cardData = await getCardDataForExport();
    setCardFileName(cardData.name);
    return {
        cardName: cardData.name,
        text: stringifyCardData(cardData)
    };
}

async function loadLocalCardCacheState() {
    const stored = await chrome.storage.local.get([
        AUTOMATION_CARD_CACHE_LIST_KEY,
        AUTOMATION_CARD_SELECTED_ID_KEY,
        AUTOMATION_CARD_CACHE_KEY,
        AUTOMATION_CARD_CACHE_NAME_KEY,
        AUTOMATION_CARD_CACHE_TIME_KEY,
        AUTOMATION_CARD_PERSIST_PENDING_KEY
    ]);
    const persistPending = stored[AUTOMATION_CARD_PERSIST_PENDING_KEY] === true;

    const list = Array.isArray(stored[AUTOMATION_CARD_CACHE_LIST_KEY]) ? stored[AUTOMATION_CARD_CACHE_LIST_KEY] : [];
    if (list.length > 0) {
        // 单张历史卡片损坏时跳过该项，不能让整份卡片列表都显示为空。
        const items = list.map((item, index) => {
            try {
                return normalizeCardCacheEntry(item, index);
            } catch (_error) {
                return null;
            }
        }).filter(Boolean);
        if (items.length > 0) {
            let selectedId = String(stored[AUTOMATION_CARD_SELECTED_ID_KEY] || '').trim();
            if (!selectedId || !items.some((item) => item.id === selectedId)) {
                selectedId = String(items[0]?.id || '').trim();
            }
            return { items, selectedId, persistPending };
        }
    }

    const legacyCard = stored[AUTOMATION_CARD_CACHE_KEY];
    if (legacyCard && typeof legacyCard === 'object') {
        const legacyItem = normalizeCardCacheEntry({
            id: 'legacy-card',
            cardData: legacyCard,
            cardName: stored[AUTOMATION_CARD_CACHE_NAME_KEY] || legacyCard.name || '',
            savedAt: stored[AUTOMATION_CARD_CACHE_TIME_KEY] || new Date().toISOString(),
            sourceName: stored[AUTOMATION_CARD_CACHE_NAME_KEY] || ''
        }, 0);
        return {
            items: [legacyItem],
            selectedId: legacyItem.id,
            persistPending
        };
    }

    return { items: [], selectedId: '', persistPending };
}

let softwareCardCacheBrowserProcessId = 0;
