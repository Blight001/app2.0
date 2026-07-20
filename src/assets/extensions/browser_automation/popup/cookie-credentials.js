import {
    formatCookieCredentialTime,
    padCookieCredentialDatePart,
    getTodayCookieCredentialDateKey,
    getCookieCredentialDateKey,
    getCookieCredentialDateFromKey,
    getCookieCredentialYesterdayKey,
    formatCookieCredentialDateLabel,
    formatCookieCredentialTimeLabel,
    buildCookieCredentialSearchText,
    normalizeCookieCredentialSearchQuery,
    cookieCredentialItemMatchesQuery,
    buildCookieCredentialCacheId,
    normalizeCookieCredentialCacheEntry,
    buildCookieCredentialListLabel,
    buildCookieCredentialClipboardText,
    buildCookieCredentialAccountPasswordText,
    buildCookieCredentialGroupAccountPasswordText,
} from './cookie-credential-formatters.js';
import {
    normalizeCookieImportBool,
    normalizeCookieImportSameSite,
    normalizeCookieImportEntry,
    normalizeBrowserStorageEntry,
    parseCookieImportLine,
    parseCookieImportText,
    parseCookieImportEnvelope,
} from './cookie-import-parser.js';
import { focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem } from './cookie-credential-cache.js';

const shared = globalThis.CookieCaptureShared || {};
const { sanitizeFilePart, buildPresetFileName, copyTextToClipboard, setStatus, showActionToast, escapeHtml } = shared;

const ACCOUNT_KEY = shared.STORAGE_KEYS.ACCOUNT_KEY;
const PASSWORD_KEY = shared.STORAGE_KEYS.PASSWORD_KEY;
const COOKIE_NOTE_KEY = shared.STORAGE_KEYS.COOKIE_NOTE_KEY;
const COOKIE_CARD_KEY = shared.STORAGE_KEYS.COOKIE_CARD_KEY;
const COOKIE_CREDENTIAL_CACHE_LIST_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_CACHE_LIST_KEY;
const COOKIE_CREDENTIAL_SELECTED_DATE_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_SELECTED_DATE_KEY;
const COOKIE_CREDENTIAL_SEARCH_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_SEARCH_KEY;
const COOKIE_CREDENTIAL_CACHE_MAX_ITEMS = 50;

const accountInput = document.getElementById('account');
const passwordInput = document.getElementById('password');
const cookieNoteInput = document.getElementById('cookie-note');
const cookieCardKeyInput = document.getElementById('cookie-card-key');
const cookieCredentialEditPanelNode = document.getElementById('cookie-credential-edit-panel');
const cookieCredentialEditPanelSubtitleNode = document.getElementById('cookie-credential-edit-panel-subtitle');
const editCookieAccountInput = document.getElementById('edit-account');
const editCookiePasswordInput = document.getElementById('edit-password');
const editCookieNoteInput = document.getElementById('edit-note');
const editCookieCardKeyInput = document.getElementById('edit-card-key');
const cookieCredentialDateFilterNode = document.getElementById('cookie-credential-date-filter');
const cookieCredentialSearchNode = document.getElementById('cookie-credential-search');
const cookieCredentialCountNode = document.getElementById('cookie-credential-count');
const cookieCredentialListNode = document.getElementById('cookie-credential-list');
const captureButton = document.getElementById('capture');
const clearCurrentPageCacheButton = document.getElementById('clear-current-page-cache');
const cookieManagerPanelNode = document.getElementById('cookie-manager-panel');
const cookieManagerSubtitleNode = document.getElementById('cookie-manager-subtitle');
const cookieManagerCountNode = document.getElementById('cookie-manager-count');
const cookieManagerListNode = document.getElementById('cookie-manager-list');

let editingCookieCredentialId = '';
async function getCurrentActiveTabForCookieImport() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const tab = Array.isArray(tabs) ? tabs.find((item) => item && Number(item.id || 0) > 0) || null : null;
    if (!tab) {
        throw new Error('未找到可注入 Cookie 的当前标签页');
    }
    return tab;
}

function applyImportedCredentials(envelope) {
    const account = String(envelope.account || '').trim();
    const password = String(envelope.password || '').trim();
    if (accountInput && account) accountInput.value = account;
    if (passwordInput && password) passwordInput.value = password;
}

function buildCredentialOnlyImportResult() {
    const message = '已导入账号/密码';
    setStatus(message, 'success');
    showActionToast(message, 'success');
    return {
        success: true, importedCount: 0, failedCount: 0, browserStorageCount: 0,
        restoredLocalStorageCount: 0, restoredSessionStorageCount: 0, message
    };
}

function buildCookieImportPayload(tab, envelope, sourceName, cookies) {
    const pageUrl = String(envelope.pageUrl || tab.url || '').trim();
    return {
        tabId: Number(tab.id || 0) || 0, tabUrl: pageUrl, pageUrl,
        pageTitle: String(envelope.pageTitle || '').trim(),
        sourceName: String(sourceName || envelope.sourceName || '').trim(), cookies,
        browserStorage: Array.isArray(envelope.browserStorage) ? envelope.browserStorage : [],
        account: String(envelope.account || '').trim(), password: String(envelope.password || '').trim(),
        capturedAt: String(envelope.capturedAt || '').trim()
    };
}

function inspectCookieImportEnvelope(envelope) {
    const cookies = envelope.cookies;
    const browserStorage = Array.isArray(envelope.browserStorage) ? envelope.browserStorage : [];
    const hasCredentials = [envelope.account, envelope.password].some((value) => String(value || '').trim());
    return { cookies, browserStorage, hasCredentials, hasRestorableData: cookies.length > 0 || browserStorage.length > 0 };
}

async function sendCookieImport(tab, envelope, sourceName, cookies) {
    const result = await chrome.runtime.sendMessage({
        type: 'cookie-capture-import-cookies',
        payload: buildCookieImportPayload(tab, envelope, sourceName, cookies)
    });
    if (!result || result.success !== true) throw new Error(result && result.error || 'Cookie 注入失败');
    const successMessage = result.message || `已导入 ${result.importedCount || cookies.length} 条 Cookie`;
    setStatus(successMessage, 'success');
    showActionToast(successMessage, 'success');
    return result;
}

async function importCookiesFromText(text = '', sourceName = '') {
    const envelope = parseCookieImportEnvelope(text);
    const { cookies, hasCredentials, hasRestorableData } = inspectCookieImportEnvelope(envelope);

    if (!hasRestorableData && !hasCredentials) {
        throw new Error('未识别到可导入的 Cookie、浏览器存储或账号密码数据');
    }

    const tab = await getCurrentActiveTabForCookieImport();
    applyImportedCredentials(envelope);
    await savePreset();
    setStatus('正在恢复账号/密码、浏览器存储和 Cookie...', '');

    if (!hasRestorableData) return buildCredentialOnlyImportResult();
    return sendCookieImport(tab, envelope, sourceName, cookies);
}

async function savePreset() {
    try {
        await chrome.storage.local.set({
            [ACCOUNT_KEY]: String(accountInput?.value || '').trim(),
            [PASSWORD_KEY]: String(passwordInput?.value || '').trim(),
            [COOKIE_NOTE_KEY]: String(cookieNoteInput?.value || '').trim(),
            [COOKIE_CARD_KEY]: String(cookieCardKeyInput?.value || '').trim()
        });
    } catch (_error) {
    }
}

async function loadPreset() {
    try {
        const stored = await chrome.storage.local.get([ACCOUNT_KEY, PASSWORD_KEY, COOKIE_NOTE_KEY, COOKIE_CARD_KEY]);
        if (accountInput) {
            accountInput.value = String(stored[ACCOUNT_KEY] || '');
        }
        if (passwordInput) {
            passwordInput.value = String(stored[PASSWORD_KEY] || '');
        }
        if (cookieNoteInput) {
            cookieNoteInput.value = String(stored[COOKIE_NOTE_KEY] || '');
        }
        if (cookieCardKeyInput) {
            cookieCardKeyInput.value = String(stored[COOKIE_CARD_KEY] || '');
        }
    } catch (_error) {
    }
}

async function saveCookieCredentialRecord() {
    const account = String(accountInput?.value || '').trim();
    const password = String(passwordInput?.value || '').trim();
    const note = String(cookieNoteInput?.value || '').trim();
    const cardKey = String(cookieCardKeyInput?.value || '').trim();

    if (!account && !password) {
        throw new Error('请先填写账号或密码');
    }

    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const editingId = String(editingCookieCredentialId || '').trim();
    const nextItem = normalizeCookieCredentialCacheEntry({
        id: editingId || buildCookieCredentialCacheId({ account, password, note, cardKey }),
        account,
        password,
        note,
        cardKey,
        savedAt: new Date().toISOString()
    });
    const nextItems = state.items.filter((item) => String(item.id || '').trim() !== nextItem.id);
    nextItems.unshift(nextItem);
    nextItems.splice(COOKIE_CREDENTIAL_CACHE_MAX_ITEMS);
    await saveCookieCredentialCacheState(nextItems);
    cookieCredentialSelectedDate = nextItem.dateKey || getTodayCookieCredentialDateKey();
    await saveCookieCredentialFilterState();
    renderCookieCredentialCacheList({ items: nextItems });
    await savePreset();
    return nextItem;
}

async function captureCurrentTab() {
    const account = String(accountInput?.value || '').trim();
    const password = String(passwordInput?.value || '').trim();
    const fileName = buildPresetFileName(account, password);

    captureButton.disabled = true;
    setStatus('正在抓取当前页面...', '');

    try {
        await savePreset();
        const result = await chrome.runtime.sendMessage({
            type: 'cookie-capture-start',
            payload: {
                account,
                password,
                fileName
            }
        });

        if (!result || result.success !== true) {
            setStatus(result?.error || '抓取失败', 'error');
            return;
        }

        setStatus(`已保存 ${result.fileName}`, 'success');
    } catch (error) {
        setStatus(error && error.message ? error.message : '抓取失败', 'error');
    } finally {
        captureButton.disabled = false;
    }
}

function formatCookieManagerExpiry(cookie = {}) {
    if (cookie.session === true || !Number.isFinite(Number(cookie.expirationDate))) {
        return '会话期间';
    }

    const date = new Date(Number(cookie.expirationDate) * 1000);
    if (Number.isNaN(date.getTime())) {
        return '会话期间';
    }

    return date.toLocaleString('zh-CN', { hour12: false });
}

async function getCurrentActiveTabForCookieManager() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const tab = Array.isArray(tabs) ? tabs.find((item) => item && Number(item.id || 0) > 0) || null : null;
    if (!tab) {
        throw new Error('未找到可管理 Cookie 的当前标签页');
    }
    return tab;
}

async function fetchCookieManagerList() {
    const tab = await getCurrentActiveTabForCookieManager();
    const result = await chrome.runtime.sendMessage({
        type: 'cookie-capture-list-cookies',
        payload: { tabId: Number(tab.id || 0) || 0 }
    });

    if (!result || result.success !== true) {
        throw new Error(result?.error || '获取 Cookie 列表失败');
    }

    return {
        tabId: result.tabId,
        pageUrl: String(result.pageUrl || ''),
        cookies: Array.isArray(result.cookies) ? result.cookies : []
    };
}

function renderCookieManagerList(state = { pageUrl: '', cookies: [] }) {
    if (!cookieManagerListNode) {
        return;
    }

    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    if (cookieManagerCountNode) {
        cookieManagerCountNode.textContent = `${cookies.length} 条`;
    }
    if (cookieManagerSubtitleNode) {
        cookieManagerSubtitleNode.textContent = state.pageUrl
            ? `当前页面：${state.pageUrl}`
            : '未识别到当前页面地址';
    }

    if (cookies.length === 0) {
        cookieManagerListNode.innerHTML = '<div class="cookie-credential-empty">当前页面没有可管理的 Cookie。</div>';
        return;
    }

    cookieManagerListNode.innerHTML = cookies.map((cookie, index) => {
        const name = String(cookie.name || '').trim() || `cookie_${index + 1}`;
        const domain = String(cookie.domain || '').trim();
        const path = String(cookie.path || '/').trim() || '/';
        const value = String(cookie.value || '');
        return `
          <div class="cookie-manager-item" data-cookie-manager-item data-cookie-name="${escapeHtml(name)}" data-cookie-domain="${escapeHtml(domain)}" data-cookie-path="${escapeHtml(path)}" data-cookie-store-id="${escapeHtml(String(cookie.storeId || ''))}" data-cookie-secure="${cookie.secure === true ? '1' : '0'}">
            <div class="cookie-manager-item__main">
              <div class="cookie-manager-item__title">${escapeHtml(name)}</div>
              <div class="cookie-manager-item__meta">域：${escapeHtml(domain || '-')} · 路径：${escapeHtml(path)}</div>
              <div class="cookie-manager-item__value">${escapeHtml(value)}</div>
            </div>
            <button type="button" class="button-secondary cookie-credential-delete-btn" data-cookie-manager-action="delete">删除</button>
          </div>
        `;
    }).join('');
}

async function refreshCookieManagerList() {
    const state = await fetchCookieManagerList();
    renderCookieManagerList(state);
    return state;
}

async function openCookieManagerPanel() {
    if (!cookieManagerPanelNode) {
        return;
    }

    cookieManagerPanelNode.classList.add('is-visible');
    if (cookieManagerSubtitleNode) {
        cookieManagerSubtitleNode.textContent = '正在读取当前页面 Cookie...';
    }

    try {
        await refreshCookieManagerList();
    } catch (error) {
        const message = error && error.message ? error.message : '读取 Cookie 失败';
        if (cookieManagerSubtitleNode) {
            cookieManagerSubtitleNode.textContent = message;
        }
        if (cookieManagerListNode) {
            cookieManagerListNode.innerHTML = `<div class="cookie-credential-empty">${escapeHtml(message)}</div>`;
        }
    }
}

function closeCookieManagerPanel() {
    if (!cookieManagerPanelNode) {
        return;
    }
    cookieManagerPanelNode.classList.remove('is-visible');
}

async function deleteCookieManagerItem(itemNode = null) {
    if (!itemNode) {
        throw new Error('未找到可删除的 Cookie');
    }

    const tab = await getCurrentActiveTabForCookieManager();
    const cookie = {
        name: String(itemNode.dataset.cookieName || '').trim(),
        domain: String(itemNode.dataset.cookieDomain || '').trim(),
        path: String(itemNode.dataset.cookiePath || '/').trim(),
        storeId: String(itemNode.dataset.cookieStoreId || '').trim(),
        secure: itemNode.dataset.cookieSecure === '1'
    };

    const result = await chrome.runtime.sendMessage({
        type: 'cookie-capture-remove-cookie',
        payload: { tabId: Number(tab.id || 0) || 0, cookie }
    });

    if (!result || result.success !== true) {
        throw new Error(result?.error || '删除 Cookie 失败');
    }

    return { ...result, name: cookie.name };
}

async function clearCurrentPageCache() {
    clearCurrentPageCacheButton.disabled = true;
    setStatus('正在清理当前页面缓存...', '');

    try {
        const result = await chrome.runtime.sendMessage({
            type: 'cookie-capture-clear-current-page-cache',
            payload: {}
        });

        if (!result || result.success !== true) {
            setStatus(result?.error || '清理失败', 'error');
            return;
        }

        const parts = summarizeCurrentPageCacheClear(result);

        setStatus(parts.length > 0 ? `已清理当前页面缓存：${parts.join('、')}` : '已清理当前页面缓存', 'success');
    } catch (error) {
        setStatus(error && error.message ? error.message : '清理失败', 'error');
    } finally {
        clearCurrentPageCacheButton.disabled = false;
    }
}

function summarizeCurrentPageCacheClear(result) {
    const fields = [
        ['removedCookieCount', 'Cookie', '个'], ['clearedLocalStorageCount', 'localStorage', '项'],
        ['clearedSessionStorageCount', 'sessionStorage', '项'], ['clearedCacheStorageCount', 'CacheStorage', '项'],
        ['clearedIndexedDbCount', 'IndexedDB', '项']
    ];
    return fields.flatMap(([field, label, unit]) => {
        const count = Number(result[field]);
        return Number.isFinite(count) && count > 0 ? [`${label} ${result[field]} ${unit}`] : [];
    });
}


globalThis.CookieCaptureCookieCredentials = {
    formatCookieCredentialTime,
    padCookieCredentialDatePart,
    getTodayCookieCredentialDateKey,
    getCookieCredentialDateKey,
    getCookieCredentialDateFromKey,
    getCookieCredentialYesterdayKey,
    formatCookieCredentialDateLabel,
    formatCookieCredentialTimeLabel,
    buildCookieCredentialSearchText,
    normalizeCookieCredentialSearchQuery,
    cookieCredentialItemMatchesQuery,
    buildCookieCredentialCacheId,
    normalizeCookieCredentialCacheEntry,
    buildCookieCredentialListLabel,
    buildCookieCredentialClipboardText,
    buildCookieCredentialAccountPasswordText,
    buildCookieCredentialGroupAccountPasswordText,
    focusCookieCredentialEditPanel,
    closeCookieCredentialEditPanel,
    syncCookieCredentialEditUi,
    setCookieCredentialEditTarget,
    clearCookieCredentialEditTarget,
    loadCookieCredentialCacheState,
    saveCookieCredentialCacheState,
    loadCookieCredentialFilterState,
    saveCookieCredentialFilterState,
    setCookieCredentialSelectedDate,
    setCookieCredentialSearchQuery,
    getCookieCredentialSelectedDateValue,
    getCookieCredentialVisibleItems,
    buildCookieCredentialDateOptions,
    renderCookieCredentialDateFilterOptions,
    buildCookieCredentialEmptyMessage,
    renderCookieCredentialCacheList,
    refreshCookieCredentialCacheUi,
    rerenderCookieCredentialCacheUi,
    copyCookieCredentialItem,
    copyCookieCredentialAccountPasswordItem,
    copyCookieCredentialAccountPasswordGroup,
    editCookieCredentialItem,
    saveCookieCredentialEditRecord,
    deleteCookieCredentialItem,
    normalizeCookieImportBool,
    normalizeCookieImportSameSite,
    normalizeCookieImportEntry,
    normalizeBrowserStorageEntry,
    parseCookieImportLine,
    parseCookieImportText,
    getCurrentActiveTabForCookieImport,
    importCookiesFromText,
    savePreset,
    loadPreset,
    saveCookieCredentialRecord,
    captureCurrentTab,
    clearCurrentPageCache,
    formatCookieManagerExpiry,
    getCurrentActiveTabForCookieManager,
    fetchCookieManagerList,
    renderCookieManagerList,
    refreshCookieManagerList,
    openCookieManagerPanel,
    closeCookieManagerPanel,
    deleteCookieManagerItem
};
