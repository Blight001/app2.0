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

function firstCookieValue(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function normalizeCookieExpiration(source) {
    let expirationDate = Number(firstCookieValue(source.expirationDate, source.expires, source.expire, 0));
    if (Number.isFinite(expirationDate) && expirationDate > 1e12) {
        expirationDate = Math.floor(expirationDate / 1000);
    }
    return Number.isFinite(expirationDate) && expirationDate > 0 ? expirationDate : 0;
}

function applyOptionalCookieFields(result, source) {
    const sameSite = normalizeCookieImportSameSite(source.sameSite || source.samesite);
    const expirationDate = normalizeCookieExpiration(source);
    if (sameSite) result.sameSite = sameSite;
    if (expirationDate) result.expirationDate = expirationDate;
    if (source.session === true) result.session = true;
}

function normalizeCookieIdentity(source) {
    return {
        name: String(source.name || source.key || source.cookieName || '').trim(),
        value: String(firstCookieValue(source.value, source.content, source.cookieValue, '')).trim(),
        domain: String(source.domain || source.host || source.cookieDomain || '').trim().replace(/^\./, ''),
        path: String(source.path || source.cookiePath || '/').trim() || '/'
    };
}

function normalizeCookieSecurity(source) {
    return {
        secure: normalizeCookieImportBool(source.secure),
        httpOnly: normalizeCookieImportBool(source.httpOnly || source.http_only || source.httponly),
        hostOnly: normalizeCookieImportBool(source.hostOnly || source.host_only || source.hostonly)
    };
}

function normalizeCookieImportEntry(entry = {}, fallbackIndex = 0) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const result = {
        ...normalizeCookieIdentity(source),
        ...normalizeCookieSecurity(source)
    };

    applyOptionalCookieFields(result, source);

    if (!result.name && !result.value && !result.domain) {
        result.name = `cookie_${fallbackIndex + 1}`;
    }

    return result;
}

function parseNetscapeCookieLine(text, fallbackIndex) {
    if (!text.includes('\t')) return null;
    const columns = text.split('\t');
    if (columns.length < 7) return null;
    const [domain, , path, secure, expirationDate, name, value] = columns;
    return normalizeCookieImportEntry({
        domain,
        path,
        secure: normalizeCookieImportBool(secure),
        httpOnly: false,
        expirationDate: Number(expirationDate || 0),
        name,
        value
    }, fallbackIndex);
}

function applyCookieAttribute(entry, attribute) {
    const equalsIndex = attribute.indexOf('=');
    const name = String(equalsIndex >= 0 ? attribute.slice(0, equalsIndex) : attribute).trim().toLowerCase();
    const value = equalsIndex >= 0 ? String(attribute.slice(equalsIndex + 1)).trim() : '';
    if (!name) return;
    if (name === 'domain') entry.domain = value;
    else if (name === 'path') entry.path = value || '/';
    else if (name === 'secure') entry.secure = true;
    else if (name === 'httponly') entry.httpOnly = true;
    else if (name === 'samesite') entry.sameSite = value;
    else if (name === 'expires') applyCookieExpires(entry, value);
    else if (name === 'max-age') applyCookieMaxAge(entry, value);
}

function applyCookieExpires(entry, value) {
    const expiresAt = new Date(value).getTime();
    if (Number.isFinite(expiresAt)) entry.expirationDate = Math.floor(expiresAt / 1000);
}

function applyCookieMaxAge(entry, value) {
    const maxAge = Number(value);
    if (Number.isFinite(maxAge) && maxAge > 0) {
        entry.expirationDate = Math.floor(Date.now() / 1000) + maxAge;
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

function parseCookieImportLine(line = '', fallbackIndex = 0) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) {
        return null;
    }

    const netscapeCookie = parseNetscapeCookieLine(text, fallbackIndex);
    if (netscapeCookie) return netscapeCookie;

    const segments = text.split(';').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
        return null;
    }

    const [nameValue, ...attributes] = segments;
    const separatorIndex = nameValue.indexOf('=');
    if (separatorIndex <= 0) {
        return null;
    }

    const entry = {
        name: nameValue.slice(0, separatorIndex).trim(),
        value: nameValue.slice(separatorIndex + 1).trim()
    };

    for (const attribute of attributes) {
        applyCookieAttribute(entry, attribute);
    }

    return normalizeCookieImportEntry(entry, fallbackIndex);
}

function parseCookieJson(raw) {
    try {
        return JSON.parse(raw);
    } catch (_error) {
        return null;
    }
}

function normalizeCookieList(items) {
    return items.map((item, index) => normalizeCookieImportEntry(item, index)).filter((item) => item.name);
}

function cookiesFromParsedJson(parsed) {
    if (Array.isArray(parsed)) return normalizeCookieList(parsed);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Array.isArray(parsed.cookies)) return normalizeCookieList(parsed.cookies);
    if (parsed.name || parsed.key || parsed.cookieName) return normalizeCookieList([parsed]);
    return null;
}

function parseCookieImportText(text = '') {
    const raw = String(text || '').trim();
    if (!raw) {
        throw new Error('Cookie 文件为空');
    }

    const parsedCookies = cookiesFromParsedJson(parseCookieJson(raw));
    if (parsedCookies) return parsedCookies;

    const lines = raw.split(/\r?\n/);
    const items = [];
    for (const [index, line] of lines.entries()) {
        const item = parseCookieImportLine(line, index);
        if (item && item.name) {
            items.push(item);
        }
    }

    if (items.length > 0) {
        return items;
    }

    throw new Error('未识别到可导入的 Cookie 数据');
}

function createCookieImportEnvelope(parsed) {
    return {
        cookies: Array.isArray(parsed.cookies) ? normalizeCookieList(parsed.cookies) : [],
        browserStorage: Array.isArray(parsed.browserStorage)
            ? parsed.browserStorage.map((item, index) => normalizeBrowserStorageEntry(item, index))
            : [],
        pageUrl: String(parsed.pageUrl || '').trim(),
        pageTitle: String(parsed.pageTitle || '').trim(),
        account: String(parsed.account || '').trim(),
        password: String(parsed.password || '').trim(),
        capturedAt: String(parsed.capturedAt || '').trim(),
        sourceName: String(parsed.source || parsed.sourceName || parsed.fileName || '').trim()
    };
}

function parseCookieImportEnvelope(text = '') {
    const raw = String(text || '').trim();
    if (!raw) {
        return { cookies: [], browserStorage: [], pageUrl: '', pageTitle: '', account: '', password: '', capturedAt: '', sourceName: '' };
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return createCookieImportEnvelope(parsed);
        }
    } catch (_error) {
    }

    return {
        cookies: parseCookieImportText(raw),
        browserStorage: [],
        pageUrl: '',
        pageTitle: '',
        account: '',
        password: '',
        capturedAt: '',
        sourceName: ''
    };
}


export {
    normalizeCookieImportBool,
    normalizeCookieImportSameSite,
    normalizeCookieImportEntry,
    normalizeBrowserStorageEntry,
    parseCookieImportLine,
    parseCookieImportText,
    parseCookieImportEnvelope,
};
