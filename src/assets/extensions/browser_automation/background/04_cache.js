function sanitizeStepIdPart(value = '') {
    const text = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return text || 'step';
}

function ensureStepIds(steps = []) {
    const usedIds = new Set();
    return (Array.isArray(steps) ? steps : []).map((step, index) => {
        const source = step && typeof step === 'object' ? step : {};
        const explicit = String(source.id || source.step_id || source.nodeId || '').trim();
        const base = (explicit || `${sanitizeStepIdPart(source.name || source.type || 'step')}_${index + 1}`).replace(/\s+/g, '_');
        let candidate = base;
        let suffix = 2;
        while (usedIds.has(candidate)) {
            candidate = `${base}_${suffix}`;
            suffix += 1;
        }
        usedIds.add(candidate);
        return { ...source, id: candidate };
    });
}

function normalizeFlowData(flow = null, steps = []) {
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) {
        return undefined;
    }
    const stepIds = steps.map((step, index) => String(step?.id || `step_${index + 1}`).trim()).filter(Boolean);
    const stepIdSet = new Set(stepIds);
    const nodes = (Array.isArray(flow.nodes) ? flow.nodes : [])
        .map((node) => {
            const id = String(node?.id || node?.stepId || '').trim();
            if (!id || !stepIdSet.has(id)) {
                return null;
            }
            return {
                id,
                x: Number.isFinite(Number(node.x)) ? Number(node.x) : 0,
                y: Number.isFinite(Number(node.y)) ? Number(node.y) : 0
            };
        })
        .filter(Boolean);
    const nodeIds = new Set(nodes.map((node) => node.id));
    stepIds.forEach((id, index) => {
        if (!nodeIds.has(id)) {
            nodes.push({ id, x: 34 + (index % 2) * 220, y: 34 + Math.floor(index / 2) * 126 });
        }
    });
    const edgeKeys = new Set();
    const edges = (Array.isArray(flow.edges) ? flow.edges : [])
        .map((edge, index) => {
            const from = String(edge?.from || edge?.source || edge?.fromId || '').trim();
            const to = String(edge?.to || edge?.target || edge?.toId || '').trim();
            if (!from || !to || !stepIdSet.has(from) || !stepIdSet.has(to) || from === to) {
                return null;
            }
            const label = String(edge?.label || edge?.branch || edge?.condition || 'next').trim() || 'next';
            const key = `${from}::${to}::${label}`;
            if (edgeKeys.has(key)) {
                return null;
            }
            edgeKeys.add(key);
            return {
                id: String(edge?.id || '').trim() || `edge_${sanitizeStepIdPart(from)}_${sanitizeStepIdPart(to)}_${sanitizeStepIdPart(label)}_${index + 1}`,
                from,
                to,
                label
            };
        })
        .filter(Boolean);
    const start = String(flow.start || flow.start_node_id || flow.startNodeId || '').trim();
    return {
        version: 1,
        start: stepIdSet.has(start) ? start : (stepIds[0] || ''),
        nodes,
        edges
    };
}

function normalizeCardData(cardData, options = {}) {
    if (!cardData || typeof cardData !== 'object' || Array.isArray(cardData)) {
        throw new Error('自动化卡片内容格式不正确');
    }

    const steps = ensureStepIds(Array.isArray(cardData.steps) ? cardData.steps : []);
    if (steps.length === 0 && options.allowEmptySteps !== true) {
        throw new Error('自动化卡片缺少 steps 步骤');
    }

    const normalized = { ...cardData, steps };
    const flow = normalizeFlowData(cardData.flow, steps);
    if (flow) {
        normalized.flow = flow;
    }
    if (!String(normalized.name || '').trim()) {
        normalized.name = `automation_${Date.now()}`;
    }
    return normalized;
}

function normalizeCardCacheEntry(entry = {}, index = 0) {
    const source = entry && typeof entry === 'object' ? entry : {};
    // UI 允许先保存空步骤草稿；缓存列表/get 应能读取草稿，真正执行时再做严格校验。
    const cardData = normalizeCardData(source.cardData || source, { allowEmptySteps: true });
    return {
        id: String(source.id || source.cacheId || `${cardData.name || 'automation'}_${index + 1}`).trim(),
        cardData,
        cardName: String(source.cardName || cardData.name || '').trim() || cardData.name,
        savedAt: String(source.savedAt || source.updatedAt || new Date().toISOString()).trim(),
        selected: source.selected === true
    };
}

async function loadCardCacheState() {
    const stored = await chrome.storage.local.get([
        AUTOMATION_CARD_CACHE_LIST_KEY,
        AUTOMATION_CARD_SELECTED_ID_KEY,
        AUTOMATION_CARD_CACHE_KEY,
        AUTOMATION_CARD_CACHE_NAME_KEY,
        AUTOMATION_CARD_CACHE_TIME_KEY
    ]);

    const list = Array.isArray(stored[AUTOMATION_CARD_CACHE_LIST_KEY]) ? stored[AUTOMATION_CARD_CACHE_LIST_KEY] : [];
    if (list.length > 0) {
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
            return { items, selectedId };
        }
    }

    const cachedCard = stored[AUTOMATION_CARD_CACHE_KEY];
    if (!cachedCard || typeof cachedCard !== 'object') {
        return { items: [], selectedId: '' };
    }

    const normalized = normalizeCardData(cachedCard);
    const legacyId = String(stored[AUTOMATION_CARD_CACHE_NAME_KEY] || normalized.name || 'automation').trim() || 'automation';
    return {
        items: [{
            id: legacyId,
            cardData: normalized,
            cardName: String(stored[AUTOMATION_CARD_CACHE_NAME_KEY] || normalized.name || '').trim() || normalized.name,
            savedAt: String(stored[AUTOMATION_CARD_CACHE_TIME_KEY] || '').trim()
        }],
        selectedId: legacyId
    };
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

async function saveCardCacheState(cardData, selectedId = '') {
    const safeCardData = normalizeCardData(cardData);
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const nextItem = normalizeCardCacheEntry({
        id: String(selectedId || state.selectedId || safeCardData.name || 'automation').trim() || safeCardData.name || 'automation',
        cardData: safeCardData,
        cardName: safeCardData.name,
        savedAt: new Date().toISOString()
    });
    const nextItems = state.items.filter((item) => item.id !== nextItem.id);
    nextItems.push(nextItem);
    const nextSelectedId = nextItem.id;
    await chrome.storage.local.set({
        [AUTOMATION_CARD_CACHE_LIST_KEY]: nextItems,
        [AUTOMATION_CARD_SELECTED_ID_KEY]: nextSelectedId,
        [AUTOMATION_CARD_CACHE_KEY]: safeCardData,
        [AUTOMATION_CARD_CACHE_NAME_KEY]: String(safeCardData.name || '').trim(),
        [AUTOMATION_CARD_CACHE_TIME_KEY]: new Date().toISOString()
    });
    return {
        items: nextItems,
        selectedId: nextSelectedId,
        cardData: safeCardData
    };
}

async function deleteCardCacheEntry(id) {
    const targetId = String(id || '').trim();
    if (!targetId) {
        throw new Error('缺少要删除的自动化卡片 id');
    }

    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    if (!state.items.some((item) => item.id === targetId)) {
        throw new Error(`未找到自动化卡片: ${targetId}`);
    }

    const nextItems = state.items.filter((item) => item.id !== targetId);
    const nextSelectedId = state.selectedId === targetId ? String(nextItems[0]?.id || '') : state.selectedId;
    await chrome.storage.local.set({
        [AUTOMATION_CARD_CACHE_LIST_KEY]: nextItems,
        [AUTOMATION_CARD_SELECTED_ID_KEY]: nextSelectedId,
        [AUTOMATION_CARD_CACHE_KEY]: nextItems.find((item) => item.id === nextSelectedId)?.cardData || nextItems[0]?.cardData || {},
        [AUTOMATION_CARD_CACHE_NAME_KEY]: nextItems.find((item) => item.id === nextSelectedId)?.cardName || nextItems[0]?.cardName || '',
        [AUTOMATION_CARD_CACHE_TIME_KEY]: nextItems.find((item) => item.id === nextSelectedId)?.savedAt || nextItems[0]?.savedAt || ''
    });

    return {
        deleted: true,
        id: targetId,
        items: nextItems,
        selectedId: nextSelectedId
    };
}

function normalizeStandaloneSteps(cardData) {
    const normalizedCard = normalizeCardData(cardData);
    const steps = Array.isArray(normalizedCard.steps) ? [...normalizedCard.steps] : [];
    const firstMeaningfulStep = steps.find((step) => step && typeof step === 'object');
    if (!firstMeaningfulStep || String(firstMeaningfulStep.type || '').trim().toLowerCase() !== 'navigate') {
        if (normalizedCard.website) {
            steps.unshift({
                id: '__auto_navigate_start',
                name: '访问网站',
                type: 'navigate',
                url: normalizedCard.website
            });
        }
    }
    const normalizedSteps = ensureStepIds(steps);
    return { ...normalizedCard, steps: normalizedSteps, flow: normalizeFlowData(normalizedCard.flow, normalizedSteps) || normalizedCard.flow };
}
