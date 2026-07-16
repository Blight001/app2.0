const PRESET_ACCOUNT_KEY = 'cookie-capture-account';
const PRESET_PASSWORD_KEY = 'cookie-capture-password';
const STANDALONE_LAST_CARD_KEY = 'cookie-capture-standalone-last-card';
const AUTOMATION_CARD_CACHE_KEY = 'cookie-capture-automation-card-cache';
const AUTOMATION_CARD_CACHE_NAME_KEY = 'cookie-capture-automation-card-cache-name';
const AUTOMATION_CARD_CACHE_TIME_KEY = 'cookie-capture-automation-card-cache-time';
const AUTOMATION_CARD_CACHE_LIST_KEY = 'cookie-capture-automation-card-cache-list';
const AUTOMATION_CARD_SELECTED_ID_KEY = 'cookie-capture-automation-card-cache-selected-id';
const AUTOMATION_CARD_PERSIST_PENDING_KEY = 'cookie-capture-automation-card-persist-pending';
const CARD_SIDEBAR_STATE_KEY = 'cookie-capture-card-sidebar-state';
const STANDALONE_PROGRESS_STATE_KEY = 'cookie-capture-standalone-progress-state';
const runtimeStateStorage = chrome.storage.session || chrome.storage.local;
const standaloneSessions = new Map();
const stoppedTabs = new Set();

function markTabStopped(tabId) {
    const id = Number(tabId || 0);
    if (id) {
        stoppedTabs.add(id);
    }
    const sess = standaloneSessions.get(id);
    if (sess) {
        sess.running = false;
        sess.stopRequested = true;
    }
}

function isTabStopped(tabId) {
    const id = Number(tabId || 0);
    if (!id) return false;
    if (stoppedTabs.has(id)) return true;
    const sess = standaloneSessions.get(id);
    return !!(sess && (sess.stopRequested || sess.running === false));
}

function createStopError() {
    const err = new Error('执行已停止');
    err.stopped = true;
    return err;
}

function isStopError(error) {
    return !!(error && (error.stopped === true || /已停止|stop/i.test(String(error.message || ''))));
}

function sanitizeFilePart(value = '') {
    return String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function buildFileName(account = '', password = '') {
    const normalizedAccount = sanitizeFilePart(account);
    const normalizedPassword = sanitizeFilePart(password);
    if (normalizedAccount && normalizedPassword) {
        return `${normalizedAccount}_${normalizedPassword}.json`;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `cookie_${timestamp}.json`;
}

function buildCaptureFileName(account = '', password = '') {
    return buildFileName(account, password);
}

function normalizeCaptureUrl(url = '') {
    const text = String(url || '').trim();
    if (!text) {
        return '';
    }

    try {
        const parsed = new URL(text);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.origin;
        }
        return '';
    } catch (_error) {
        return '';
    }
}

function normalizeTargetUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
        return raw;
    }

    if (/^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(raw) || /(?:\.[a-zA-Z]{2,})(?::\d+)?(?:\/|$)/.test(raw)) {
        return `https://${raw}`;
    }

    return raw;
}

function normalizeText(value = '') {
    return String(value || '').trim();
}

function formatStepProgressLabel(stepIndex = 0, stepTotal = 0, stepName = '') {
    const indexValue = Number(stepIndex || 0) || 0;
    const totalValue = Number(stepTotal || 0) || 0;
    const nameValue = String(stepName || '').trim();
    const stepPart = indexValue > 0 && totalValue > 0 ? `第 ${indexValue}/${totalValue} 步` : indexValue > 0 ? `第 ${indexValue} 步` : '步骤';
    return nameValue ? `${stepPart} · ${nameValue}` : stepPart;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

