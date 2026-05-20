const OUTLOOK_ACCOUNTS_STORAGE_KEY = 'temp-email-outlook-accounts';
const OUTLOOK_SELECTED_ACCOUNT_KEY = 'temp-email-outlook-selected-account-id';

function sanitizeOutlookAccount(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const email = String(source.email || source.account || source.username || '').trim();
    const password = String(source.password || source.pass || source.secret || '').trim();
    const url = String(source.url || source.link || source.fetchUrl || source.fetch_url || '').trim();

    return {
        id: String(source.id || email || `outlook-${index + 1}`).trim() || `outlook-${index + 1}`,
        email,
        password,
        url
    };
}

function parseOutlookAccountLine(line = '', index = 0) {
    const text = String(line || '').trim();
    if (!text) {
        return null;
    }

    const parts = text.split(/\s*-{2,}\s*/).map((item) => String(item || '').trim()).filter(Boolean);
    if (parts.length < 3) {
        return null;
    }

    const [email, password, ...rest] = parts;
    const url = rest.join('----').trim();
    if (!email || !password || !url) {
        return null;
    }

    return sanitizeOutlookAccount({ email, password, url }, index);
}

function parseOutlookAccountsFromText(text = '') {
    const accounts = [];
    const seen = new Set();
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const [index, line] of lines.entries()) {
        const account = parseOutlookAccountLine(line, index);
        if (!account) {
            continue;
        }

        const key = account.email.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        accounts.push(account);
    }

    return accounts;
}

function mergeOutlookAccounts(existingAccounts = [], importedAccounts = []) {
    const merged = new Map();

    for (const [index, account] of (Array.isArray(existingAccounts) ? existingAccounts : []).entries()) {
        const normalized = sanitizeOutlookAccount(account, index);
        if (!normalized.email) {
            continue;
        }
        merged.set(normalized.email.toLowerCase(), normalized);
    }

    for (const [index, account] of (Array.isArray(importedAccounts) ? importedAccounts : []).entries()) {
        const normalized = sanitizeOutlookAccount(account, index);
        if (!normalized.email) {
            continue;
        }
        merged.set(normalized.email.toLowerCase(), normalized);
    }

    return Array.from(merged.values());
}

module.exports = {
    OUTLOOK_ACCOUNTS_STORAGE_KEY,
    OUTLOOK_SELECTED_ACCOUNT_KEY,
    sanitizeOutlookAccount,
    parseOutlookAccountLine,
    parseOutlookAccountsFromText,
    mergeOutlookAccounts
};
