const DEFAULT_TCP_SERVER_URL = '127.0.0.1:58113';

function normalizeBooleanValue(value, fallback = true) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    const text = String(value).trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(text)) {
        return false;
    }
    if (['1', 'true', 'yes', 'on'].includes(text)) {
        return true;
    }
    return fallback;
}

function normalizeTcpServerUrl(value, fallback = DEFAULT_TCP_SERVER_URL) {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text) {
        return fallback;
    }

    const stripped = text
        .replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '')
        .replace(/^\/+/, '')
        .trim();
    if (!stripped) {
        return fallback;
    }

    return stripped.split('/')[0] || fallback;
}

function stripObjectKeys(source = {}, keys = []) {
    const target = source && typeof source === 'object' && !Array.isArray(source)
        ? { ...source }
        : {};

    for (const key of Array.isArray(keys) ? keys : []) {
        delete target[key];
    }

    return target;
}

function stripBrowserSettingsCompatFields(browserSettings = {}) {
    return stripObjectKeys(browserSettings, [
        'browserType',
        'browserSource',
        'browser_region',
        'browserLocale',
        'browserTimezoneId',
        'headlessMode',
        'dynamicFingerprint',
        'blockImagesVideos',
        'syncExecution',
        'maxProxyRecoveryAttempts',
        'registrationAutoUpload',
        'saveLocalCookie',
        'skipCookieSave',
        'skip_cookie_save',
        'concurrentCount',
        'runMode',
        'timedRegistrationCount',
        'timedRegistrationCycleCount',
        'timedRegistrationStartMode',
        'timedRegistrationDelaySeconds'
    ]);
}

module.exports = {
    DEFAULT_TCP_SERVER_URL,
    normalizeBooleanValue,
    normalizeTcpServerUrl,
    stripObjectKeys,
    stripBrowserSettingsCompatFields
};
