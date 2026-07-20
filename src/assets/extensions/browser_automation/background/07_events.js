function backgroundEventText(...values) {
    const value = values.find((item) => item !== undefined && item !== null && item !== '');
    return String(value === undefined ? '' : value).trim();
}

function backgroundEventNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function backgroundEventPayload(message) {
    return message && message.payload && typeof message.payload === 'object' ? message.payload : {};
}

function backgroundEventObject(value) {
    return value && typeof value === 'object' ? value : {};
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab || !tab.url || !/^https?:/i.test(tab.url)) return;
    void (async () => {
        const state = await loadCardSidebarState().catch(() => null);
        if (!state || state.open !== true || Number(state.tabId || 0) !== Number(tabId)) return;
        await injectCardEditorSidebar(Number(tabId), state.width || 820).catch(() => {});
    })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
        if (Number(tabId || 0) === Number(await readRememberedAutomationTargetId().catch(() => 0))) {
            await rememberAutomationTargetTab(0);
        }
        const state = await loadCardSidebarState().catch(() => null);
        if (state && Number(state.tabId || 0) === Number(tabId)) await clearCardSidebarState();
    })();
});

function formatCookieImportResult(result) {
    const counts = {
        imported: backgroundEventNumber(result.importedCount),
        failed: backgroundEventNumber(result.failedCount),
        storage: backgroundEventNumber(result.browserStorageCount),
        local: backgroundEventNumber(result.restoredLocalStorageCount),
        session: backgroundEventNumber(result.restoredSessionStorageCount)
    };
    const parts = [];
    if (counts.storage > 0) parts.push(`浏览器存储 ${counts.storage} 组`);
    if (counts.local > 0) parts.push(`localStorage ${counts.local} 项`);
    if (counts.session > 0) parts.push(`sessionStorage ${counts.session} 项`);
    if (counts.imported > 0) parts.push(`Cookie ${counts.imported} 条`);
    if (counts.failed > 0) {
        const detail = result.firstError ? `，首个错误：${result.firstError}` : '';
        parts.push(`失败 ${counts.failed} 条${detail}`);
    }
    const message = parts.length
        ? `已导入 ${parts.join('，')}，请刷新页面生效`
        : result.message || '未导入任何内容';
    return { ...result, success: result.success === true, message, error: result.success === true ? '' : message };
}

async function importCookiesFromEvent(message) {
    const payload = backgroundEventPayload(message);
    const result = await importSnapshotToCurrentPage(
        payload.tabId || 0,
        payload.pageUrl || payload.tabUrl || '',
        payload.cookies || [],
        payload.browserStorage || []
    );
    return formatCookieImportResult(result);
}

function progressValue(state) {
    return Number.isFinite(Number(state && state.progress)) ? Number(state.progress) : 0;
}

async function saveFinishedCardProgress(result, payload) {
    const lastState = await loadStandaloneProgressState().catch(() => null);
    const safeResult = backgroundEventObject(result);
    const safeLastState = backgroundEventObject(lastState);
    const cardData = backgroundEventObject(payload.cardData);
    const success = safeResult.success === true;
    const cardName = backgroundEventText(safeResult.cardName, safeLastState.cardName, cardData.name);
    const failure = backgroundEventText(safeResult.error, '执行失败');
    await saveStandaloneProgressState({
        ...safeLastState,
        tabId: safeLastState.tabId || null,
        cardName,
        message: success
            ? `执行完成: ${backgroundEventText(cardName, '未命名卡片')}`
            : failure,
        phase: success ? 'finished' : 'failed',
        mode: '',
        kind: success ? '' : 'error',
        errorReason: success ? '' : failure,
        progress: success ? 100 : progressValue(safeLastState),
        running: false,
        visible: true
    });
}

async function notifyFinishedCardRun(result) {
    const success = result && result.success === true;
    await chrome.runtime.sendMessage({
        type: 'card-run-finished',
        success,
        stopped: false,
        continuation: false,
        progress: success ? 100 : 0,
        mode: 'run',
        errorReason: success ? '' : backgroundEventText(result && result.error),
        message: success
            ? `执行完成: ${backgroundEventText(result.cardName, '未命名卡片')}`
            : backgroundEventText(result && result.error, '执行失败')
    }).catch(() => {});
}

async function recordCardRunFailure(error, message) {
    const lastState = await loadStandaloneProgressState().catch(() => null);
    const baseError = backgroundEventText(error && error.message, '执行失败');
    const detailed = backgroundEventText(
        lastState && lastState.errorReason,
        lastState && lastState.message,
        baseError
    );
    const payload = backgroundEventPayload(message);
    const cardData = payload.cardData && typeof payload.cardData === 'object' ? payload.cardData : {};
    await saveStandaloneProgressState({
        ...(lastState && typeof lastState === 'object' ? lastState : {}),
        tabId: lastState && lastState.tabId || null,
        cardName: backgroundEventText(cardData.name, lastState && lastState.cardName),
        message: detailed,
        phase: 'failed',
        mode: '',
        kind: 'error',
        errorReason: detailed,
        progress: progressValue(lastState),
        running: false,
        visible: true
    }).catch(() => {});
    return detailed;
}

async function notifyCardRunFailure(fallback) {
    const state = await loadStandaloneProgressState().catch(() => null);
    const detailed = backgroundEventText(
        state && state.errorReason,
        state && state.message,
        fallback
    );
    await chrome.runtime.sendMessage({
        type: 'card-run-finished',
        success: false,
        progress: 0,
        mode: 'run',
        errorReason: detailed,
        message: detailed
    }).catch(() => {});
    return detailed;
}

async function startCardRunFromEvent(message) {
    const payload = backgroundEventPayload(message);
    try {
        const result = await runStandaloneCard(payload);
        if (result && result.stopped) return { success: false, stopped: true };
        await saveFinishedCardProgress(result, payload).catch(() => {});
        await notifyFinishedCardRun(result);
        return result;
    } catch (error) {
        const saved = await recordCardRunFailure(error, message);
        return { success: false, error: await notifyCardRunFailure(saved) };
    }
}

async function stopCardRunFromEvent() {
    const lastState = await loadStandaloneProgressState().catch(() => null);
    const tabId = backgroundEventNumber(lastState && lastState.tabId);
    if (tabId) markTabStopped(tabId);
    const stoppedProgress = progressValue(lastState);
    await saveStandaloneProgressState({
        ...(lastState && typeof lastState === 'object' ? lastState : {}),
        tabId: tabId || (lastState && lastState.tabId) || null,
        cardName: backgroundEventText(lastState && lastState.cardName),
        message: '已停止执行',
        phase: 'stopped',
        mode: backgroundEventText(lastState && lastState.mode),
        kind: '',
        errorReason: '',
        progress: stoppedProgress,
        running: false,
        stopped: true,
        visible: true
    }).catch(() => {});
    await chrome.runtime.sendMessage({
        type: 'card-run-finished',
        success: false,
        stopped: true,
        continuation: false,
        progress: stoppedProgress,
        mode: backgroundEventText(lastState && lastState.mode),
        message: '已停止执行'
    }).catch(() => {});
    return { success: true };
}

async function closeCardSidebarFromEvent(_message, sender) {
    try {
        return await openCardEditorSidebar({ forceClose: true });
    } catch (_error) {
        const tabId = sender && sender.tab && sender.tab.id;
        if (tabId) {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const host = document.getElementById('__automation_card_sidebar_root__');
                    if (host) host.remove();
                }
            }).catch(() => {});
        }
        return { success: true, closed: true };
    }
}

async function updateCardSidebarState(message, sender) {
    const senderTabId = Number(sender && sender.tab && sender.tab.id || 0);
    if (!senderTabId) return { success: false, error: '未找到侧边栏标签页' };
    const payload = backgroundEventPayload(message);
    await saveCardSidebarState({
        tabId: senderTabId,
        width: payload.width || 820,
        open: payload.open === true
    });
    return { success: true };
}

const BACKGROUND_EVENT_HANDLERS = {
    'card-cache-persistent-get': async () => ({ success: true, state: await loadCardCacheState() }),
    'card-cache-persistent-set': async (message) => {
        const payload = backgroundEventPayload(message);
        const state = await replaceCardCacheState(payload.items, payload.selectedId);
        return {
            success: state.persisted === true,
            persisted: state.persisted === true,
            state,
            error: state.persisted === true ? '' : state.persistError || '软件卡片库未完成落盘'
        };
    },
    'cookie-capture-start': (message) => captureCurrentTab(message.payload || {}),
    'cookie-capture-clear-current-page-cache': (message) => clearCurrentPageCache(backgroundEventPayload(message).tabId || 0),
    'cookie-capture-list-cookies': (message) => listCurrentTabCookies(backgroundEventPayload(message).tabId || 0),
    'cookie-capture-remove-cookie': (message) => {
        const payload = backgroundEventPayload(message);
        return removeCurrentTabCookie(payload.tabId || 0, payload.cookie || {});
    },
    'cookie-capture-import-cookies': importCookiesFromEvent,
    'card-run-start': startCardRunFromEvent,
    'card-run-stop': stopCardRunFromEvent,
    'card-sync': (message, sender) => syncStandaloneSession(
        backgroundEventPayload(message),
        Number(sender && sender.tab && sender.tab.id || 0)
    ),
    'open-card-editor-sidebar': (message) => openCardEditorSidebar(message.payload || {}),
    'close-card-sidebar': closeCardSidebarFromEvent,
    'card-sidebar-state-update': updateCardSidebarState
};

const BACKGROUND_EVENT_ERROR_MESSAGES = {
    'card-cache-persistent-get': '读取软件卡片库失败',
    'card-cache-persistent-set': '保存软件卡片库失败',
    'cookie-capture-start': '抓取失败',
    'cookie-capture-clear-current-page-cache': '清理当前页面缓存失败',
    'cookie-capture-list-cookies': '获取 Cookie 列表失败',
    'cookie-capture-remove-cookie': '删除 Cookie 失败',
    'cookie-capture-import-cookies': 'Cookie 注入失败',
    'card-run-start': '执行失败',
    'card-run-stop': '停止执行失败',
    'card-sync': '同步自动化卡片失败',
    'open-card-editor-sidebar': '打开侧边栏失败',
    'close-card-sidebar': '关闭侧边栏失败',
    'card-sidebar-state-update': '更新侧边栏状态失败'
};

function respondToBackgroundEvent(handler, message, sender, sendResponse) {
    void Promise.resolve()
        .then(() => handler(message, sender))
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({
            success: false,
            error: backgroundEventText(error && error.message, BACKGROUND_EVENT_ERROR_MESSAGES[message.type])
        }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const handler = BACKGROUND_EVENT_HANDLERS[message.type];
    if (typeof handler !== 'function') return false;
    respondToBackgroundEvent(handler, message, sender, sendResponse);
    return true;
});
