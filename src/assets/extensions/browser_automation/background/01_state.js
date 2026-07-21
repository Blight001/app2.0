function collectStorageSnapshot() {
    const collect = (storage) => {
        const result = {};
        try {
            if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
                return result;
            }

            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (!key) {
                    continue;
                }
                result[key] = storage.getItem(key);
            }
        } catch (_error) {
        }
        return result;
    };

    return {
        url: String(window.location.href || ''),
        origin: String(window.location.origin || ''),
        title: String(document.title || ''),
        localStorage: collect(window.localStorage),
        sessionStorage: collect(window.sessionStorage)
    };
}

const AUTOMATION_TARGET_TAB_KEY = 'heysure-automation-target-tab-id';
let automationTargetTabId = 0;

function isControllableWebTab(tab) {
    return !!(tab && Number(tab.id || 0) > 0 && /^https?:\/\//i.test(String(tab.url || '')));
}

async function rememberAutomationTargetTab(tabOrId) {
    const id = Number(typeof tabOrId === 'object' ? tabOrId?.id : tabOrId) || 0;
    automationTargetTabId = id > 0 ? id : 0;
    await runtimeStateStorage.set({ [AUTOMATION_TARGET_TAB_KEY]: automationTargetTabId }).catch(() => {});
    return automationTargetTabId;
}

async function readRememberedAutomationTargetId() {
    if (automationTargetTabId > 0) return automationTargetTabId;
    const stored = await runtimeStateStorage.get([AUTOMATION_TARGET_TAB_KEY]).catch(() => ({}));
    automationTargetTabId = Number(stored?.[AUTOMATION_TARGET_TAB_KEY] || 0) || 0;
    return automationTargetTabId;
}

async function resolveExplicitAutomationTab(args) {
    const explicitId = Number(args?.tab_id ?? args?.tabId ?? args?.id ?? 0) || 0;
    if (!explicitId) return null;
    const tab = await chrome.tabs.get(explicitId).catch(() => null);
    if (!isControllableWebTab(tab)) throw new Error(`标签页 ${explicitId} 不是可控制的 http/https 页面`);
    await rememberAutomationTargetTab(explicitId);
    return tab;
}

async function resolveRememberedAutomationTab() {
    const rememberedId = await readRememberedAutomationTargetId();
    if (!rememberedId) return null;
    const tab = await chrome.tabs.get(rememberedId).catch(() => null);
    if (isControllableWebTab(tab)) return tab;
    await rememberAutomationTargetTab(0);
    return null;
}

async function findControllableAutomationTab(query) {
    const tabs = await chrome.tabs.query(query).catch(() => []);
    return Array.isArray(tabs) ? tabs.find(isControllableWebTab) || null : null;
}

async function resolveAutomationTargetTab(args = {}) {
    const explicit = await resolveExplicitAutomationTab(args);
    if (explicit) return explicit;
    const remembered = await resolveRememberedAutomationTab();
    if (remembered) return remembered;
    const activeWebTab = await findControllableAutomationTab({ active: true, currentWindow: true });
    if (activeWebTab) {
        await rememberAutomationTargetTab(activeWebTab.id);
        return activeWebTab;
    }

    const fallback = await findControllableAutomationTab({});
    if (fallback) await rememberAutomationTargetTab(fallback.id);
    return fallback || null;
}

function mergeBrowserStorageEntries(entries) {
    const merged = { localStorage: {}, sessionStorage: {}, entryCount: 0 };
    for (const entry of entries) {
        const local = entry.localStorage && typeof entry.localStorage === 'object' ? entry.localStorage : {};
        const session = entry.sessionStorage && typeof entry.sessionStorage === 'object' ? entry.sessionStorage : {};
        if (!Object.keys(local).length && !Object.keys(session).length) continue;
        merged.entryCount += 1;
        Object.assign(merged.localStorage, local);
        Object.assign(merged.sessionStorage, session);
    }
    return merged;
}

function emptyBrowserStorageResult(tabId) {
    return {
        success: true,
        tabId,
        browserStorageCount: 0,
        restoredLocalStorageCount: 0,
        restoredSessionStorageCount: 0
    };
}

function readBrowserStorageScriptResult(results) {
    const scriptResult = Array.isArray(results) ? results[0] : null;
    return scriptResult && scriptResult.result && typeof scriptResult.result === 'object'
        ? scriptResult.result
        : { restoredLocalStorageCount: 0, restoredSessionStorageCount: 0 };
}

async function getActiveTab() {
    return resolveAutomationTargetTab();
}

function extractTabMatchKey(url = '') {
    const normalized = normalizeTargetUrl(String(url || '').trim());
    if (!normalized) {
        return '';
    }

    try {
        return new URL(normalized).origin;
    } catch (_error) {
        return normalized;
    }
}

async function findExistingTabByUrl(url = '') {
    const matchKey = extractTabMatchKey(url);
    if (!matchKey) {
        return null;
    }

    const tabs = await chrome.tabs.query({}).catch(() => []);
    const candidates = Array.isArray(tabs) ? tabs.filter((tab) => tab && Number(tab.id || 0) > 0 && typeof tab.url === 'string') : [];
    const exactMatch = candidates.find((tab) => {
        const tabKey = extractTabMatchKey(tab.url || '');
        return tabKey && tabKey === matchKey;
    });
    if (exactMatch) {
        return exactMatch;
    }

    return candidates.find((tab) => {
        const tabUrl = String(tab.url || '').trim();
        return tabUrl && tabUrl.includes(matchKey);
    }) || null;
}

async function getOrFindActiveTab(url = '') {
    const existingTab = await findExistingTabByUrl(url).catch(() => null);
    if (existingTab) {
        return existingTab;
    }

    return getActiveTab();
}

async function readPageSnapshot(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectStorageSnapshot
    });

    const result = Array.isArray(results) ? results[0] : null;
    return result && result.result ? result.result : null;
}

async function readCookies(pageUrl = '') {
    const normalizedUrl = normalizeCaptureUrl(pageUrl);
    if (!normalizedUrl) {
        return [];
    }

    try {
        return await chrome.cookies.getAll({ url: normalizedUrl });
    } catch (_error) {
        return [];
    }
}

function isHttpPageUrl(value = '') {
    try {
        const parsed = new URL(String(value || '').trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
        return false;
    }
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    if (currentTab && currentTab.status === 'complete') {
        return currentTab;
    }

    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 0);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            reject(new Error('页面加载超时'));
        }, Math.max(1000, deadline - Date.now()));

        const onUpdated = (updatedTabId, changeInfo, tab) => {
            if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
                return;
            }

            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve(tab);
        };

        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}

async function navigateTabToUrl(tabId = 0, pageUrl = '') {
    const normalizedTabId = Number(tabId || 0) || 0;
    const normalizedPageUrl = normalizeTargetUrl(String(pageUrl || '').trim());
    if (!normalizedTabId || !isHttpPageUrl(normalizedPageUrl)) {
        return null;
    }

    const tab = await chrome.tabs.get(normalizedTabId).catch(() => null);
    if (!tab) {
        throw new Error('未找到可跳转的目标标签页');
    }

    const currentUrl = normalizeTargetUrl(String(tab.url || '').trim());
    if (currentUrl === normalizedPageUrl) {
        await chrome.tabs.reload(normalizedTabId);
        return waitForTabComplete(normalizedTabId, 20000);
    }

    await chrome.tabs.update(normalizedTabId, { url: normalizedPageUrl });
    return waitForTabComplete(normalizedTabId, 20000);
}

async function restoreBrowserStoragePayload(payload) {
    const result = { restoredLocalStorageCount: 0, restoredSessionStorageCount: 0 };
    try {
        if (window.localStorage && typeof window.localStorage.clear === 'function') {
            window.localStorage.clear();
            const entries = payload && payload.localStorage && typeof payload.localStorage === 'object' ? payload.localStorage : {};
            for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
            result.restoredLocalStorageCount = Object.keys(entries).length;
        }
    } catch (_error) {}
    try {
        if (window.sessionStorage && typeof window.sessionStorage.clear === 'function') {
            window.sessionStorage.clear();
            const entries = payload && payload.sessionStorage && typeof payload.sessionStorage === 'object' ? payload.sessionStorage : {};
            for (const [key, value] of Object.entries(entries)) window.sessionStorage.setItem(key, value);
            result.restoredSessionStorageCount = Object.keys(entries).length;
        }
    } catch (_error) {}
    return result;
}

async function restoreBrowserStorageToCurrentPage(tabId = 0, browserStorage = []) {
    const normalizedTabId = Number(tabId || 0) || 0;
    const normalizedEntries = Array.isArray(browserStorage)
        ? browserStorage.map((entry, index) => normalizeBrowserStorageEntry(entry, index))
        : [];

    if (!normalizedTabId) {
        throw new Error('未找到可恢复浏览器存储的目标标签页');
    }

    const merged = mergeBrowserStorageEntries(normalizedEntries);
    if (!Object.keys(merged.localStorage).length && !Object.keys(merged.sessionStorage).length) {
        return emptyBrowserStorageResult(normalizedTabId);
    }

    const results = await chrome.scripting.executeScript({
        target: { tabId: normalizedTabId },
        args: [{
            localStorage: merged.localStorage,
            sessionStorage: merged.sessionStorage
        }],
        func: restoreBrowserStoragePayload
    }).catch(() => []);

    const storageCounts = readBrowserStorageScriptResult(results);

    return {
        success: true,
        tabId: normalizedTabId,
        browserStorageCount: merged.entryCount,
        restoredLocalStorageCount: Number(storageCounts.restoredLocalStorageCount || 0) || 0,
        restoredSessionStorageCount: Number(storageCounts.restoredSessionStorageCount || 0) || 0
    };
}

function normalizeCookieImportBool(value = false) {
    return value === true || value === 'true' || value === 'TRUE' || value === 1 || value === '1';
}

function normalizeCookieImportSameSite(value = '') {
    const text = String(value || '').trim().toLowerCase();
    if (!text) {
        return '';
    }

    if (text === 'lax') return 'lax';
    if (text === 'strict') return 'strict';
    if (text === 'no_restriction' || text === 'none') return 'no_restriction';
    return '';
}

function firstStateCookieValue(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function normalizeStateCookieIdentity(source) {
    return {
        name: String(source.name || source.key || source.cookieName || '').trim(),
        value: String(firstStateCookieValue(source.value, source.content, source.cookieValue, '')).trim(),
        domain: String(source.domain || source.host || source.cookieDomain || '').trim().replace(/^\./, ''),
        path: String(source.path || source.cookiePath || '/').trim() || '/'
    };
}

function normalizeStateCookieSecurity(source) {
    return {
        secure: normalizeCookieImportBool(source.secure),
        httpOnly: normalizeCookieImportBool(source.httpOnly || source.http_only || source.httponly),
        hostOnly: normalizeCookieImportBool(source.hostOnly || source.host_only || source.hostonly)
    };
}

function applyStateCookieOptionalFields(result, source) {
    const sameSite = normalizeCookieImportSameSite(source.sameSite || source.samesite);
    let expirationDate = Number(firstStateCookieValue(source.expirationDate, source.expires, source.expire, 0));
    if (Number.isFinite(expirationDate) && expirationDate > 1e12) expirationDate = Math.floor(expirationDate / 1000);
    if (sameSite) result.sameSite = sameSite;
    if (Number.isFinite(expirationDate) && expirationDate > 0) result.expirationDate = expirationDate;
    if (source.session === true) result.session = true;
}

function normalizeCookieImportEntry(entry = {}, fallbackIndex = 0) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const result = {
        ...normalizeStateCookieIdentity(source),
        ...normalizeStateCookieSecurity(source)
    };
    applyStateCookieOptionalFields(result, source);
    if (!result.name && !result.value && !result.domain) {
        result.name = `cookie_${fallbackIndex + 1}`;
    }

    return result;
}

function applySlimCookieFlags(slimmed, source) {
    if (source.secure === true) slimmed.secure = true;
    if (source.httpOnly === true) slimmed.httpOnly = true;
    if (source.hostOnly === true) slimmed.hostOnly = true;
    if (source.session === true) slimmed.session = true;
}

function applySlimCookieMetadata(slimmed, source) {
    const sameSite = normalizeCookieImportSameSite(source.sameSite || '');
    const expirationDate = Number(source.expirationDate || 0);
    if (sameSite) slimmed.sameSite = sameSite;
    if (Number.isFinite(expirationDate) && expirationDate > 0) {
        slimmed.expirationDate = Math.floor(expirationDate);
    }
}

function normalizeBrowserStorageEntry(entry = {}, fallbackIndex = 0) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const normalizeStorageMap = (value = {}) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (!String(key || '').trim()) {
                continue;
            }
            result[String(key)] = item == null ? '' : String(item);
        }
        return result;
    };

    return {
        id: String(source.id || `browser-storage-${fallbackIndex + 1}`).trim(),
        url: String(source.url || '').trim(),
        origin: String(source.origin || '').trim(),
        localStorage: normalizeStorageMap(source.localStorage || source.local_storage || {}),
        sessionStorage: normalizeStorageMap(source.sessionStorage || source.session_storage || {})
    };
}

// 登录凭证瘦身：跨机器分发的 cookie 卡只需要能恢复登录态的数据，
// 统计/追踪类 cookie 与 storage key 对登录无用且体积很大，storeId/partitionKey 等字段跨机器也无意义。
// 匹配采用前缀/正则，宁可少删也不误删真正的会话凭证，确保仍能登陆。
const CREDENTIAL_TRACKING_KEY_PATTERNS = [
    /^_ga(_.*)?$/i, /^_gid$/i, /^_gat(_.*)?$/i, /^_gcl_/i, /^__utm[abctvz]$/i, /^__gads$/i, /^__gpi$/i,
    /^_fbp$/i, /^_fbc$/i, /^fr$/i,
    /^Hm_lvt_/i, /^Hm_lpvt_/i, /^HMACCOUNT$/i, /^CNZZDATA/i,
    /^sensorsdata/i, /^ajs_/i, /^mp_/i, /^amplitude_/i, /^AMP_/i,
    /^_hj/i, /^_clck$/i, /^_clsk$/i, /^_clarity/i, /^_uetsid$/i, /^_uetvid$/i,
    /^_pk_/i, /^intercom-/i, /^__gac_/i, /^_tt_/i, /^_scid$/i, /^_uetmsclkid/i
];

function isCredentialTrackingKey(name = '') {
    const key = String(name || '').trim();
    if (!key) {
        return false;
    }
    return CREDENTIAL_TRACKING_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function slimCookieForExport(cookie = {}) {
    const source = cookie && typeof cookie === 'object' ? cookie : {};
    const slimmed = {
        name: String(source.name || '').trim(),
        value: String(source.value ?? ''),
        domain: String(source.domain || '').trim(),
        path: String(source.path || '/').trim() || '/'
    };

    applySlimCookieFlags(slimmed, source);
    applySlimCookieMetadata(slimmed, source);

    return slimmed;
}

function minimizeCookiesForExport(cookies = []) {
    if (!Array.isArray(cookies)) {
        return [];
    }
    const result = [];
    for (const cookie of cookies) {
        const name = String(cookie?.name || '').trim();
        if (!name || isCredentialTrackingKey(name)) {
            continue;
        }
        result.push(slimCookieForExport(cookie));
    }
    return result;
}

function minimizeStorageMapForExport(map = {}) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(map)) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || isCredentialTrackingKey(normalizedKey)) {
            continue;
        }
        result[normalizedKey] = value == null ? '' : String(value);
    }
    return result;
}

function minimizeBrowserStorageForExport(browserStorage = []) {
    if (!Array.isArray(browserStorage)) {
        return [];
    }
    const result = [];
    for (const entry of browserStorage) {
        const source = entry && typeof entry === 'object' ? entry : {};
        const localStorage = minimizeStorageMapForExport(source.localStorage || {});
        const sessionStorage = minimizeStorageMapForExport(source.sessionStorage || {});
        if (Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0) {
            continue;
        }
        result.push({
            url: String(source.url || '').trim(),
            origin: String(source.origin || '').trim(),
            localStorage,
            sessionStorage
        });
    }
    return result;
}

// 对采集到的完整 storageState 快照做瘦身：只保留登录必需的 cookie + localStorage/sessionStorage。
