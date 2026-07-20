function formatCookieCredentialTime(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return text;
    }

    return date.toLocaleString('zh-CN', { hour12: false });
}

function padCookieCredentialDatePart(value = 0) {
    return String(value || 0).padStart(2, '0');
}

function getTodayCookieCredentialDateKey(date = new Date()) {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return [
        safeDate.getFullYear(),
        padCookieCredentialDatePart(safeDate.getMonth() + 1),
        padCookieCredentialDatePart(safeDate.getDate())
    ].join('-');
}

function getCookieCredentialDateKey(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return getTodayCookieCredentialDateKey(date);
}

function getCookieCredentialDateFromKey(dateKey = '') {
    const text = String(dateKey || '').trim();
    if (!text || text === 'all') {
        return null;
    }

    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getCookieCredentialYesterdayKey() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return getTodayCookieCredentialDateKey(date);
}

function formatCookieCredentialDateLabel(dateKey = '') {
    const normalized = String(dateKey || '').trim();
    if (!normalized || normalized === 'all') {
        return '全部日期';
    }

    const date = getCookieCredentialDateFromKey(normalized);
    if (!date) {
        return normalized;
    }

    const todayKey = getTodayCookieCredentialDateKey();
    const yesterdayKey = getCookieCredentialYesterdayKey();
    if (normalized === todayKey) {
        return `今天 · ${normalized}`;
    }
    if (normalized === yesterdayKey) {
        return `昨天 · ${normalized}`;
    }

    const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return `${normalized} ${weekdayNames[date.getDay()] || ''}`.trim();
}

function formatCookieCredentialTimeLabel(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return text;
    }

    return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function buildCookieCredentialSearchText(item = {}) {
    const parts = [
        String(item.account || '').trim(),
        String(item.password || '').trim(),
        String(item.note || '').trim(),
        String(item.cardKey || '').trim(),
        String(item.savedAt || '').trim(),
        formatCookieCredentialDateLabel(String(item.dateKey || '').trim()),
        formatCookieCredentialTimeLabel(item.savedAt)
    ].filter(Boolean);
    return parts.join(' ').toLowerCase();
}

function normalizeCookieCredentialSearchQuery(value = '') {
    return String(value || '').trim();
}

function cookieCredentialItemMatchesQuery(item = {}, query = '') {
    const normalizedQuery = normalizeCookieCredentialSearchQuery(query).toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    const keywords = normalizedQuery.split(/\s+/).filter(Boolean);
    if (keywords.length === 0) {
        return true;
    }

    const searchText = buildCookieCredentialSearchText(item);
    return keywords.every((keyword) => searchText.includes(keyword));
}

function buildCookieCredentialCacheId(record = {}) {
    const baseName = sanitizeFilePart(String(record.note || record.cardKey || record.account || 'cookie-record'));
    const timePart = new Date().toISOString().replace(/[:.]/g, '-');
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${baseName || 'cookie-record'}_${timePart}_${randomPart}`;
}

function getCookieCredentialField(source, names, fallback = '') {
    for (const name of names) {
        if (source[name] !== undefined && source[name] !== null && source[name] !== '') return source[name];
    }
    return fallback;
}

function normalizeCookieCredentialCacheEntry(entry = {}, index = 0) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const savedAt = String(getCookieCredentialField(source, ['savedAt', 'createdAt'], new Date().toISOString())).trim();
    const dateKey = String(source.dateKey || getCookieCredentialDateKey(savedAt) || '').trim() || getTodayCookieCredentialDateKey();
    return {
        id: String(getCookieCredentialField(source, ['id', 'cacheId'])).trim() || buildCookieCredentialCacheId(source),
        account: String(getCookieCredentialField(source, ['account', 'username'])).trim(),
        password: String(source.password || '').trim(),
        note: String(getCookieCredentialField(source, ['note', 'remark'])).trim(),
        cardKey: String(getCookieCredentialField(source, ['cardKey', 'card_key', 'key'])).trim(),
        savedAt,
        dateKey,
        selected: source.selected === true,
        index
    };
}

function buildCookieCredentialListLabel(item = {}) {
    const noteText = String(item.note || '').trim() || '未备注';
    const accountText = String(item.account || '').trim() || '未填写QQ号';
    const cardKeyText = String(item.cardKey || '').trim() || '未填写卡密';

    return {
        title: noteText,
        meta: `QQ号：${accountText}\n卡密：${cardKeyText}`
    };
}

function buildCookieCredentialClipboardText(item = {}) {
    const savedAtText = formatCookieCredentialTimeLabel(item.savedAt) || '';
    const savedDateLabel = formatCookieCredentialDateLabel(item.dateKey || getCookieCredentialDateKey(item.savedAt));
    const lines = [
        `日期：${savedDateLabel || '未记录'}`,
        `时间：${savedAtText || '未记录'}`,
        `备注：${String(item.note || '').trim() || '未填写'}`,
        `卡密：${String(item.cardKey || '').trim() || '未填写'}`,
        `账号：${String(item.account || '').trim() || '未填写'}`,
        `密码：${String(item.password || '').trim() || '未填写'}`
    ];
    return lines.join('\n');
}

function buildCookieCredentialAccountPasswordText(item = {}) {
    return [
        String(item.account || '').trim() || '未填写',
        String(item.password || '').trim() || '未填写'
    ].join('   ');
}

function buildCookieCredentialGroupAccountPasswordText(items = []) {
    const lines = Array.isArray(items)
        ? items.map((item) => buildCookieCredentialAccountPasswordText(item)).filter(Boolean)
        : [];
    return lines.join('\n');
}


export {
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
};
