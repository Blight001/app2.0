function minimizeCapturedState(snapshot = {}) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
        ...source,
        cookies: minimizeCookiesForExport(source.cookies || []),
        browserStorage: minimizeBrowserStorageForExport(source.browserStorage || [])
    };
}

function parseCookiePageUrl(pageUrl) {
    try {
        const parsed = new URL(String(pageUrl || '').trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
    } catch (_error) {
        return null;
    }
}

function buildCookieSetUrl(pageUrl = '', cookie = {}) {
    const cookieDomain = String(cookie?.domain || '').trim().replace(/^\./, '');
    const path = String(cookie?.path || '/').trim() || '/';
    const secure = cookie?.secure === true;
    if (cookieDomain) return `${secure ? 'https:' : 'http:'}//${cookieDomain}${path}`;
    const parsed = parseCookiePageUrl(pageUrl);
    if (!parsed) return '';
    return `${secure ? 'https:' : parsed.protocol}//${parsed.hostname}${path}`;
}

function createCookieCandidateCollector() {
    const candidates = [];
    return {
        candidates,
        add(url = '', includeDomain = false) {
            const normalizedUrl = String(url || '').trim();
            if (!normalizedUrl) return;
            const key = `${normalizedUrl}__${includeDomain ? 'domain' : 'nodomain'}`;
            if (candidates.some((item) => item.key === key)) return;
            candidates.push({ key, url: normalizedUrl, includeDomain });
        }
    };
}

function resolveCookieCandidateUrls(pageUrl, cookie) {
    const normalizedPageUrl = String(pageUrl || '').trim();
    const cookieDomain = String(cookie?.domain || '').trim().replace(/^\./, '');
    const path = String(cookie?.path || '/').trim() || '/';
    const secure = cookie?.secure === true;
    const parsedPageUrl = parseCookiePageUrl(normalizedPageUrl);
    return {
        normalizedPageUrl,
        cookieDomain,
        pageHostUrl: parsedPageUrl
            ? `${secure ? 'https:' : parsedPageUrl.protocol}//${parsedPageUrl.hostname}${path}`
            : '',
        domainUrl: cookieDomain ? `https://${cookieDomain}${path}` : ''
    };
}

function addHostOnlyCookieCandidates(collector, pageHostUrl, domainUrl) {
    collector.add(pageHostUrl || domainUrl, false);
    if (!pageHostUrl && domainUrl) collector.add(domainUrl, false);
}

function addDomainCookieCandidates(collector, urls) {
    if (urls.cookieDomain) collector.add(urls.domainUrl, true);
    if (urls.pageHostUrl) collector.add(urls.pageHostUrl, false);
    if (!urls.cookieDomain && urls.normalizedPageUrl) {
        collector.add(urls.pageHostUrl || urls.normalizedPageUrl, false);
    }
}

function buildCookieSetCandidates(pageUrl = '', cookie = {}) {
    const hostOnly = cookie?.hostOnly === true;
    const collector = createCookieCandidateCollector();
    const urls = resolveCookieCandidateUrls(pageUrl, cookie);

    if (hostOnly) {
        addHostOnlyCookieCandidates(collector, urls.pageHostUrl, urls.domainUrl);
        return collector.candidates;
    }
    addDomainCookieCandidates(collector, urls);
    return collector.candidates;
}

function buildCookieSetArgs(cookie, candidate) {
    const args = { url: candidate.url, name: String(cookie.name || '').trim(), value: String(cookie.value ?? '').trim() };
    if (candidate.includeDomain && !cookie.hostOnly && String(cookie.domain || '').trim()) args.domain = String(cookie.domain).trim();
    if (String(cookie.path || '').trim()) args.path = String(cookie.path).trim();
    if (cookie.secure === true) args.secure = true;
    if (cookie.httpOnly === true) args.httpOnly = true;
    const sameSite = normalizeCookieImportSameSite(cookie.sameSite || '');
    if (sameSite) args.sameSite = sameSite;
    if (Number.isFinite(Number(cookie.expirationDate)) && Number(cookie.expirationDate) > 0) args.expirationDate = Number(cookie.expirationDate);
    return args;
}

async function importSingleCookie(pageUrl, cookie, index) {
    const candidates = buildCookieSetCandidates(pageUrl, cookie);
    if (!candidates.length || !cookie.name) {
        return { error: { index, cookie, error: '无法生成 Cookie 注入地址' } };
    }
    let lastError = '';
    for (const candidate of candidates) {
        try {
            const savedCookie = await chrome.cookies.set(buildCookieSetArgs(cookie, candidate));
            if (savedCookie) return { savedCookie };
            lastError = 'Cookie 写入失败';
        } catch (error) {
            lastError = error?.message || 'Cookie 写入失败';
        }
    }
    return { error: { index, cookie, error: lastError || 'Cookie 写入失败' } };
}

function createCookieImportMessage(results, errors, firstError) {
    if (results.length) {
        return errors.length
            ? `已注入 ${results.length} 条 Cookie，失败 ${errors.length} 条`
            : `已注入 ${results.length} 条 Cookie`;
    }
    return `未能注入任何 Cookie${firstError ? `：${firstError}` : ''}`;
}

async function importCookiesToCurrentPage(tabId = 0, pageUrl = '', cookies = []) {
    const normalizedTabId = Number(tabId || 0) || 0;
    const normalizedPageUrl = String(pageUrl || '').trim();
    const normalizedCookies = Array.isArray(cookies)
        ? cookies.map((cookie, index) => normalizeCookieImportEntry(cookie, index)).filter((cookie) => String(cookie.name || '').trim())
        : [];

    if (!normalizedTabId) {
        throw new Error('未找到可注入 Cookie 的目标标签页');
    }

    if (!normalizedCookies.length) {
        throw new Error('未识别到可注入的 Cookie 数据');
    }

    const results = [];
    const errors = [];

    for (const [index, cookie] of normalizedCookies.entries()) {
        const outcome = await importSingleCookie(normalizedPageUrl, cookie, index);
        if (outcome.savedCookie) results.push(outcome.savedCookie);
        else errors.push(outcome.error);
    }

    const firstError = errors.length > 0
        ? errors[0].error || 'Cookie 写入失败'
        : '';
    const success = results.length > 0;

    return {
        success,
        tabId: normalizedTabId,
        pageUrl: normalizedPageUrl,
        importedCount: results.length,
        failedCount: errors.length,
        errors,
        firstError,
        message: createCookieImportMessage(results, errors, firstError)
    };
}

function failedStorageImport(error) {
    return {
        success: false,
        browserStorageCount: 0,
        restoredLocalStorageCount: 0,
        restoredSessionStorageCount: 0,
        error: error?.message || '浏览器存储恢复失败'
    };
}

function failedCookieImport(error, cookieCount) {
    const message = error?.message || 'Cookie 写入失败';
    return { success: false, importedCount: 0, failedCount: cookieCount, firstError: message, message, error: message };
}

function buildSnapshotImportParts(storage, cookies) {
    const parts = [];
    if (storage.browserStorageCount > 0) parts.push(`浏览器存储 ${storage.browserStorageCount} 组`);
    if (storage.restoredLocalStorageCount > 0) parts.push(`localStorage ${storage.restoredLocalStorageCount} 项`);
    if (storage.restoredSessionStorageCount > 0) parts.push(`sessionStorage ${storage.restoredSessionStorageCount} 项`);
    if (cookies.importedCount > 0) parts.push(`Cookie ${cookies.importedCount} 条`);
    if (cookies.failedCount > 0) parts.push(`失败 ${cookies.failedCount} 条`);
    if (storage.success === false && storage.error) parts.push(storage.error);
    if (cookies.success === false && cookies.firstError) parts.push(cookies.firstError);
    return parts;
}

function snapshotImportCount(result, field) {
    return Number(result[field] || 0) || 0;
}

function createSnapshotImportResult(tabId, pageUrl, storageResult, cookieResult) {
    const importedCount = snapshotImportCount(cookieResult, 'importedCount');
    const failedCount = snapshotImportCount(cookieResult, 'failedCount');
    const restoredLocalStorageCount = snapshotImportCount(storageResult, 'restoredLocalStorageCount');
    const restoredSessionStorageCount = snapshotImportCount(storageResult, 'restoredSessionStorageCount');
    const browserStorageCount = snapshotImportCount(storageResult, 'browserStorageCount');
    const success = importedCount > 0 || restoredLocalStorageCount > 0 || restoredSessionStorageCount > 0;
    const parts = buildSnapshotImportParts(
        { ...storageResult, browserStorageCount, restoredLocalStorageCount, restoredSessionStorageCount },
        { ...cookieResult, importedCount, failedCount }
    );
    let message = success ? '已完成导入' : '导入失败';
    if (parts.length) message = `已导入 ${parts.join('，')}`;
    return {
        success,
        tabId,
        pageUrl,
        browserStorageCount,
        restoredLocalStorageCount,
        restoredSessionStorageCount,
        importedCount,
        failedCount,
        firstError: cookieResult.firstError || storageResult.error || '',
        message,
        storageError: storageResult.success === false ? storageResult.error : '',
        cookieError: cookieResult.success === false ? cookieResult.firstError || cookieResult.error || '' : ''
    };
}

async function importSnapshotToCurrentPage(tabId = 0, pageUrl = '', cookies = [], browserStorage = []) {
    const normalizedTabId = Number(tabId || 0) || 0;
    const normalizedPageUrl = String(pageUrl || '').trim();
    const normalizedCookies = Array.isArray(cookies) ? cookies : [];
    const normalizedBrowserStorage = Array.isArray(browserStorage) ? browserStorage : [];
    const targetPageUrl = isHttpPageUrl(normalizedPageUrl) ? normalizedPageUrl : '';

    if (targetPageUrl) {
        await navigateTabToUrl(normalizedTabId, targetPageUrl).catch(() => {});
    }

    const storageResult = await restoreBrowserStorageToCurrentPage(normalizedTabId, normalizedBrowserStorage).catch(failedStorageImport);
    const cookieResult = await importCookiesToCurrentPage(
        normalizedTabId,
        targetPageUrl || normalizedPageUrl,
        normalizedCookies
    ).catch((error) => failedCookieImport(error, normalizedCookies.length));

    return createSnapshotImportResult(normalizedTabId, normalizedPageUrl, storageResult, cookieResult);
}
