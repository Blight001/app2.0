function hasNavigationWaitPageCondition(action) {
    const fields = ['selector', 'waitForText', 'waitForElementHidden', 'waitForTextHidden'];
    return fields.some((field) => String(action[field] || '').trim());
}

function getNavigationWaitDependencies(dependencies) {
    return {
        delay: typeof dependencies.sleep === 'function' ? dependencies.sleep : sleep,
        probePageAction: typeof dependencies.executePageAction === 'function'
            ? dependencies.executePageAction
            : (typeof executePageAction === 'function' ? executePageAction : null),
        getTab: typeof dependencies.getTab === 'function'
            ? dependencies.getTab
            : (id) => chrome.tabs.get(id).catch(() => null)
    };
}

async function probeNavigationWait(tabId, action, probePageAction) {
    try {
        return await probePageAction(tabId, { ...action, timeoutMs: 0, intervalMs: 0, singleProbe: true });
    } catch (error) {
        return {
            success: false,
            error: String(error && error.message ? error.message : error || '页面暂时不可访问'),
            code: 'WAIT_DOCUMENT_CHANGED'
        };
    }
}

async function executeNavigationAwareWait(tabId, action = {}, dependencies = {}) {
    const delay = typeof dependencies.sleep === 'function' ? dependencies.sleep : sleep;
    const timeoutMs = Math.max(0, Number(action.timeoutMs) || 0);
    if (!hasNavigationWaitPageCondition(action)) {
        // 纯延时应由后台计时，避免页面在延时期间导航导致注入脚本上下文被销毁。
        await delay(timeoutMs);
        return { success: true, waitedMs: timeoutMs };
    }
    const { probePageAction, getTab } = getNavigationWaitDependencies(dependencies);

    const intervalMs = Math.max(50, Number(action.intervalMs) || 200);
    const deadline = Date.now() + timeoutMs;
    let lastResult = null;

    do {
        const currentTab = await getTab(tabId);
        if (!currentTab) {
            return { success: false, error: '等待期间目标标签页已关闭', code: 'TAB_NOT_FOUND' };
        }

        const probeResult = await probeNavigationWait(tabId, action, probePageAction);
        if (probeResult && probeResult.success === true) return probeResult;
        lastResult = probeResult;

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            break;
        }
        await delay(Math.min(intervalMs, remainingMs));
    } while (Date.now() <= deadline);

    return {
        success: false,
        error: String((lastResult && lastResult.error) || `等待条件超时（${timeoutMs}ms）`),
        code: 'WAIT_TIMEOUT'
    };
}

function getSnapshotStorage(snapshot, field) {
    const value = snapshot[field];
    return value && typeof value === 'object' ? value : {};
}

async function collectTabCookieSnapshot(tabId) {
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    const pageSnapshot = await readPageSnapshot(tabId).catch(() => null);
    const tabData = currentTab || {};
    const snapshot = pageSnapshot || {};
    const pageUrl = tabData.url || snapshot.url || '';
    const pageTitle = tabData.title || snapshot.title || '';
    const cookies = await readCookies(pageUrl);
    const localStorageData = getSnapshotStorage(snapshot, 'localStorage');
    const sessionStorageData = getSnapshotStorage(snapshot, 'sessionStorage');
    const browserStorage = [];

    if (Object.keys(localStorageData).length > 0 || Object.keys(sessionStorageData).length > 0) {
        browserStorage.push({
            url: snapshot.url || pageUrl || '',
            origin: snapshot.origin || '',
            localStorage: localStorageData,
            sessionStorage: sessionStorageData
        });
    }

    return minimizeCapturedState({
        pageUrl,
        pageTitle,
        cookies,
        browserStorage
    });
}

// 仅供 Node 回归测试使用；扩展 service worker 中没有 CommonJS module。
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { executeNavigationAwareWait };
}
