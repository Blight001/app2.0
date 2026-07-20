function buildCookieRemovalUrl(pageUrl = '', cookie = {}) {
    const normalizedPageUrl = String(pageUrl ?? '').trim();
    if (!normalizedPageUrl) {
        return '';
    }

    try {
        const parsed = new URL(normalizedPageUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
        }

        const cookieDomain = String(cookie?.domain ?? '').trim().replace(/^\./, '');
        const host = [cookieDomain, parsed.hostname].find(Boolean);
        const path = String(cookie?.path ?? '/').trim() || '/';
        const secure = cookie?.secure === true;
        const protocol = secure ? 'https:' : parsed.protocol;
        return `${protocol}//${host}${path}`;
    } catch (_error) {
        return '';
    }
}

async function removeCurrentPageCookies(pageUrl) {
    const removedCookies = [];
    const cookies = await readCookies(pageUrl).catch(() => []);
    for (const cookie of Array.isArray(cookies) ? cookies : []) {
        const url = buildCookieRemovalUrl(pageUrl, cookie);
        if (!url || !cookie || !cookie.name) continue;
        const removeArgs = { url, name: String(cookie.name || '').trim() };
        const storeId = String(cookie.storeId || '').trim();
        if (storeId) removeArgs.storeId = storeId;
        const removed = await chrome.cookies.remove(removeArgs).catch(() => null);
        if (removed) removedCookies.push(removed);
    }
    return removedCookies;
}

async function clearCurrentPageStorage(tabId) {
    return chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
            const result = {
                clearedLocalStorageCount: 0,
                clearedSessionStorageCount: 0,
                clearedCacheStorageCount: 0,
                clearedIndexedDbCount: 0
            };
            function clearWebStorage(storage, field) {
                try {
                    if (storage && storage.length > 0) {
                        result[field] = storage.length;
                        storage.clear();
                    }
                } catch (_error) {}
            }
            async function clearCacheStorage() {
                try {
                    if (!window.caches || typeof window.caches.keys !== 'function') return;
                    const keys = await window.caches.keys();
                    const normalized = Array.isArray(keys) ? keys : [];
                    result.clearedCacheStorageCount = normalized.length;
                    await Promise.all(normalized.map((key) => window.caches.delete(key).catch(() => false)));
                } catch (_error) {}
            }
            async function clearIndexedDatabases() {
                try {
                    const indexedDB = window.indexedDB;
                    if (!indexedDB || typeof indexedDB.databases !== 'function'
                        || typeof indexedDB.deleteDatabase !== 'function') return;
                    const databases = await indexedDB.databases();
                    const list = Array.isArray(databases) ? databases.filter((db) => db && db.name) : [];
                    result.clearedIndexedDbCount = list.length;
                    await Promise.all(list.map((db) => new Promise((resolve) => {
                        const request = indexedDB.deleteDatabase(db.name);
                        request.onsuccess = () => resolve(true);
                        request.onerror = () => resolve(false);
                        request.onblocked = () => resolve(false);
                    })));
                } catch (_error) {}
            }
            clearWebStorage(window.localStorage, 'clearedLocalStorageCount');
            clearWebStorage(window.sessionStorage, 'clearedSessionStorageCount');
            await clearCacheStorage();
            await clearIndexedDatabases();
            return result;
        }
    }).catch(() => []);
}

function normalizeClearedStorageCounts(storageResult) {
    const scriptResult = Array.isArray(storageResult) ? storageResult[0] : null;
    const counts = scriptResult && scriptResult.result && typeof scriptResult.result === 'object'
        ? scriptResult.result
        : {};
    return {
        clearedLocalStorageCount: Number(counts.clearedLocalStorageCount || 0) || 0,
        clearedSessionStorageCount: Number(counts.clearedSessionStorageCount || 0) || 0,
        clearedCacheStorageCount: Number(counts.clearedCacheStorageCount || 0) || 0,
        clearedIndexedDbCount: Number(counts.clearedIndexedDbCount || 0) || 0
    };
}

async function resolveCurrentPageCacheTab(tabId) {
    const normalizedTabId = Number(tabId) || 0;
    const tab = normalizedTabId
        ? await chrome.tabs.get(normalizedTabId).catch(() => null)
        : await getActiveTab().catch(() => null);
    if (!tab || !Number.isFinite(Number(tab.id))) {
        throw new Error('未找到可清理的当前标签页');
    }
    return tab;
}

async function clearCurrentPageCache(tabId = 0) {
    const tab = await resolveCurrentPageCacheTab(tabId);
    const pageUrl = String(tab.url || '').trim();
    const removedCookies = await removeCurrentPageCookies(pageUrl);
    const storageCounts = normalizeClearedStorageCounts(
        await clearCurrentPageStorage(Number(tab.id))
    );

    return {
        success: true,
        tabId: Number(tab.id),
        pageUrl,
        removedCookieCount: removedCookies.length,
        ...storageCounts
    };
}

async function resolveCookieManagerTab(tabId = 0) {
    const normalizedTabId = Number(tabId || 0) || 0;
    const tab = normalizedTabId
        ? await chrome.tabs.get(normalizedTabId).catch(() => null)
        : await getActiveTab().catch(() => null);
    if (!tab || !Number.isFinite(Number(tab.id || 0))) {
        throw new Error('未找到可管理 Cookie 的当前标签页');
    }
    return tab;
}

async function listCurrentTabCookies(tabId = 0) {
    const tab = await resolveCookieManagerTab(tabId);
    const pageUrl = String(tab.url || '').trim();
    const cookies = await readCookies(pageUrl).catch(() => []);

    return {
        success: true,
        tabId: Number(tab.id),
        pageUrl,
        cookies: Array.isArray(cookies) ? cookies : []
    };
}

async function removeCurrentTabCookie(tabId = 0, cookie = {}) {
    const tab = await resolveCookieManagerTab(tabId);
    const pageUrl = String(tab.url || '').trim();
    const name = String(cookie?.name || '').trim();
    if (!name) {
        throw new Error('缺少要删除的 Cookie 名称');
    }

    const url = buildCookieRemovalUrl(pageUrl, cookie);
    if (!url) {
        throw new Error('无法定位该 Cookie 的删除地址');
    }

    const removeArgs = { url, name };
    const storeId = String(cookie?.storeId || '').trim();
    if (storeId) {
        removeArgs.storeId = storeId;
    }

    const removed = await chrome.cookies.remove(removeArgs).catch(() => null);
    if (!removed) {
        throw new Error('删除 Cookie 失败');
    }

    return {
        success: true,
        tabId: Number(tab.id),
        name,
        removed
    };
}

async function loadCardSidebarState() {
    const stored = await runtimeStateStorage.get([CARD_SIDEBAR_STATE_KEY]).catch(() => ({}));
    const state = stored && typeof stored === 'object' ? stored[CARD_SIDEBAR_STATE_KEY] : null;
    if (!state || typeof state !== 'object') {
        return null;
    }

    return {
        tabId: Number(state.tabId || 0) || null,
        width: Math.max(520, Number(state.width || 0) || 820),
        open: state.open === true,
        updatedAt: String(state.updatedAt || '').trim()
    };
}

async function saveCardSidebarState(state = {}) {
    const nextState = {
        tabId: Number(state.tabId || 0) || null,
        width: Math.max(520, Number(state.width || 0) || 820),
        open: state.open === true,
        updatedAt: new Date().toISOString()
    };
    await runtimeStateStorage.set({
        [CARD_SIDEBAR_STATE_KEY]: nextState
    }).catch(() => {});
    return nextState;
}

async function clearCardSidebarState() {
    await runtimeStateStorage.remove([CARD_SIDEBAR_STATE_KEY]).catch(() => {});
}

function standaloneProgressText(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

function standaloneProgressNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStandaloneProgressState(state, updatedAt, includeEmptyProgress) {
    const normalized = {
        tabId: standaloneProgressNumber(state.tabId) || null,
        cardName: standaloneProgressText(state.cardName),
        message: standaloneProgressText(state.message),
        phase: standaloneProgressText(state.phase),
        mode: standaloneProgressText(state.mode),
        kind: standaloneProgressText(state.kind),
        errorReason: standaloneProgressText(state.errorReason),
        stepIndex: standaloneProgressNumber(state.stepIndex),
        stepTotal: standaloneProgressNumber(state.stepTotal),
        stepName: standaloneProgressText(state.stepName),
        previousStepName: standaloneProgressText(state.previousStepName),
        nextStepName: standaloneProgressText(state.nextStepName),
        running: state.running === true,
        visible: state.visible !== false,
        updatedAt
    };
    if (Number.isFinite(Number(state.progress))) normalized.progress = Number(state.progress);
    else if (includeEmptyProgress) normalized.progress = undefined;
    return normalized;
}

async function loadStandaloneProgressState() {
    const stored = await runtimeStateStorage.get([STANDALONE_PROGRESS_STATE_KEY]).catch(() => ({}));
    const state = stored && typeof stored === 'object' ? stored[STANDALONE_PROGRESS_STATE_KEY] : null;
    if (!state || typeof state !== 'object') {
        return null;
    }

    return normalizeStandaloneProgressState(
        state,
        standaloneProgressText(state.updatedAt),
        true
    );
}

async function saveStandaloneProgressState(state = {}) {
    const nextState = normalizeStandaloneProgressState(
        state,
        new Date().toISOString(),
        false
    );

    await runtimeStateStorage.set({
        [STANDALONE_PROGRESS_STATE_KEY]: nextState
    }).catch(() => {});
    return nextState;
}

async function syncStandaloneSession(payload = {}, senderTabId = null) {
    const tabId = Number(payload.tabId || senderTabId || 0) || null;
    const providedCardData = payload.cardData && typeof payload.cardData === 'object' ? payload.cardData : null;
    if (!tabId || !providedCardData) {
        throw new Error('缺少可同步的自动化卡片');
    }

    const normalizedCard = normalizeStandaloneSteps(providedCardData);
    const session = standaloneSessions.get(tabId);
    if (session && session.cardData) {
        session.cardData = normalizedCard;
        session.cardName = String(normalizedCard.name || '').trim();
        session.updatedAt = new Date().toISOString();
    }

    await saveCardCacheState(normalizedCard).catch(() => {});

    return {
        success: true,
        tabId,
        cardName: String(normalizedCard.name || '').trim(),
        stepCount: Array.isArray(normalizedCard.steps) ? normalizedCard.steps.length : 0,
        running: Boolean(session)
    };
}
