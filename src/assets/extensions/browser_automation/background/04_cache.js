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

function normalizeCardCacheState(items = [], selectedId = '') {
    const normalizedItems = (Array.isArray(items) ? items : []).map((item, index) => {
        try {
            return normalizeCardCacheEntry(item, index);
        } catch (_error) {
            return null;
        }
    }).filter(Boolean);
    const requestedSelectedId = String(selectedId || '').trim();
    const normalizedSelectedId = normalizedItems.some((item) => item.id === requestedSelectedId)
        ? requestedSelectedId
        : String(normalizedItems[0]?.id || '').trim();
    return { items: normalizedItems, selectedId: normalizedSelectedId };
}

function readLocalCardCacheState(stored = {}) {
    const list = Array.isArray(stored[AUTOMATION_CARD_CACHE_LIST_KEY]) ? stored[AUTOMATION_CARD_CACHE_LIST_KEY] : [];
    if (list.length > 0) {
        const state = normalizeCardCacheState(list, stored[AUTOMATION_CARD_SELECTED_ID_KEY]);
        if (state.items.length > 0) {
            return state;
        }
    }

    const cachedCard = stored[AUTOMATION_CARD_CACHE_KEY];
    if (!cachedCard || typeof cachedCard !== 'object' || !Array.isArray(cachedCard.steps)) {
        return { items: [], selectedId: '' };
    }

    const normalized = normalizeCardData(cachedCard, { allowEmptySteps: true });
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

async function writeLocalCardCacheMirror(state = {}, persistPending = false) {
    const normalized = normalizeCardCacheState(state.items, state.selectedId);
    const selectedItem = normalized.items.find((item) => item.id === normalized.selectedId) || normalized.items[0] || null;
    await chrome.storage.local.set({
        [AUTOMATION_CARD_CACHE_LIST_KEY]: normalized.items,
        [AUTOMATION_CARD_SELECTED_ID_KEY]: normalized.selectedId,
        [AUTOMATION_CARD_CACHE_KEY]: selectedItem?.cardData || {},
        [AUTOMATION_CARD_CACHE_NAME_KEY]: selectedItem?.cardName || '',
        [AUTOMATION_CARD_CACHE_TIME_KEY]: selectedItem?.savedAt || '',
        [AUTOMATION_CARD_PERSIST_PENDING_KEY]: persistPending === true
    });
    return normalized;
}

async function replaceCardCacheState(items = [], selectedId = '') {
    const normalized = normalizeCardCacheState(items, selectedId);
    try {
        const response = await writeSoftwareCardCache(normalized);
        const saved = normalizeCardCacheState(response?.state?.items, response?.state?.selectedId);
        await writeLocalCardCacheMirror(saved, false);
        return { ...saved, persisted: true };
    } catch (error) {
        // 软件桥接短暂不可用时仍允许编辑，并标记为待同步；下次读取会优先
        // 把这份新镜像写回软件卡片库，避免旧的共享文件覆盖刚保存的卡片。
        await writeLocalCardCacheMirror(normalized, true);
        return {
            ...normalized,
            persisted: false,
            persistError: error && error.message ? error.message : String(error || '软件卡片库写入失败')
        };
    }
}

async function loadCardCacheState() {
    const stored = await chrome.storage.local.get([
        AUTOMATION_CARD_CACHE_LIST_KEY,
        AUTOMATION_CARD_SELECTED_ID_KEY,
        AUTOMATION_CARD_CACHE_KEY,
        AUTOMATION_CARD_CACHE_NAME_KEY,
        AUTOMATION_CARD_CACHE_TIME_KEY,
        AUTOMATION_CARD_PERSIST_PENDING_KEY
    ]);
    const localState = readLocalCardCacheState(stored);

    try {
        if (stored[AUTOMATION_CARD_PERSIST_PENDING_KEY] === true) {
            const synced = await writeSoftwareCardCache(localState);
            const saved = normalizeCardCacheState(synced?.state?.items, synced?.state?.selectedId);
            await writeLocalCardCacheMirror(saved, false);
            return { ...saved, persisted: true };
        }

        const remote = await readSoftwareCardCache();
        if (remote?.exists === true) {
            const sharedState = normalizeCardCacheState(remote?.state?.items, remote?.state?.selectedId);
            await writeLocalCardCacheMirror(sharedState, false);
            return { ...sharedState, persisted: true };
        }

        // 首次升级时，把当前 Profile 里已有的旧卡片自动迁移到软件目录。
        if (localState.items.length > 0) {
            const migrated = await writeSoftwareCardCache(localState);
            const saved = normalizeCardCacheState(migrated?.state?.items, migrated?.state?.selectedId);
            await writeLocalCardCacheMirror(saved, false);
            return { ...saved, persisted: true };
        }
        return { ...localState, persisted: true };
    } catch (_error) {
        // 保留离线兼容；软件运行且桥接恢复后会重新读取共享卡片库。
    }

    return { ...localState, persisted: false };
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
    const saved = await replaceCardCacheState(nextItems, nextSelectedId);
    return {
        items: saved.items,
        selectedId: saved.selectedId,
        cardData: safeCardData
    };
}

function resolveCardCacheDeleteTarget(state = {}, reference = '') {
    const items = Array.isArray(state.items) ? state.items : [];
    const requested = String(reference || '').trim();
    if (items.length === 0) {
        throw new Error('当前没有已保存的自动化卡片');
    }

    // 删除“当前卡片”时与 get/run/局部编辑保持一致：未传 id 就使用当前选中项。
    if (!requested) {
        const selected = items.find((item) => String(item?.id || '').trim() === String(state.selectedId || '').trim());
        return selected || items[0];
    }

    // AI 偶尔会把 list 返回的 cardName 当作 id 传回。先精确匹配 id，
    // 再兼容卡片名；同名时不猜测，明确要求使用 id，避免误删。
    const byId = items.find((item) => String(item?.id || '').trim() === requested);
    if (byId) {
        return byId;
    }

    const requestedName = requested.toLocaleLowerCase();
    const byName = items.filter((item) => [item?.cardName, item?.cardData?.name]
        .some((name) => String(name || '').trim().toLocaleLowerCase() === requestedName));
    if (byName.length === 1) {
        return byName[0];
    }
    if (byName.length > 1) {
        throw new Error(`存在多张同名自动化卡片: ${requested}，请使用卡片 id 删除`);
    }
    throw new Error(`未找到自动化卡片: ${requested}`);
}

async function deleteCardCacheEntry(reference = '') {
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const target = resolveCardCacheDeleteTarget(state, reference);
    const targetId = String(target.id || '').trim();

    const nextItems = state.items.filter((item) => item.id !== targetId);
    const nextSelectedId = state.selectedId === targetId ? String(nextItems[0]?.id || '') : state.selectedId;
    const saved = await replaceCardCacheState(nextItems, nextSelectedId);

    return {
        deleted: true,
        id: targetId,
        cardName: String(target.cardName || target.cardData?.name || '').trim(),
        items: saved.items,
        selectedId: saved.selectedId
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

// 仅供 Node 回归测试使用；扩展 service worker 中没有 CommonJS module。
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveCardCacheDeleteTarget };
}
