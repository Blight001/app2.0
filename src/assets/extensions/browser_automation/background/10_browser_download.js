function nativeDownloadSession(native, tab) {
    return {
        pageUrl: native.url || tab.url || '', pageTitle: native.title || tab.title || '',
        capturedAt: new Date().toISOString(), cookies: native.cookies || [],
        browserStorage: [{ url: native.url || tab.url || '', origin: native.origin || '',
            localStorage: native.localStorage || {}, sessionStorage: native.sessionStorage || {} }]
    };
}

async function fallbackDownloadSession(tab) {
    const page = await readPageSnapshot(tab.id);
    const cookies = await readCookies(tab.url || page?.url || '');
    const browserStorage = buildCurrentTabBrowserStorage(tab, page || {});
    const minimized = minimizeCapturedState({ cookies, browserStorage });
    return {
        pageUrl: tab.url || page?.url || '', pageTitle: tab.title || page?.title || '',
        capturedAt: new Date().toISOString(), ...minimized
    };
}

async function collectBrowserDownloadSession(args = {}) {
    const tab = await resolveAutomationTargetTab(args);
    if (!tab) throw new Error('未找到要读取会话的真实网页标签页');
    const native = await trySoftwareRuntimeAutomation('get-session-data').catch(() => null);
    return native?.success === true ? nativeDownloadSession(native, tab) : fallbackDownloadSession(tab);
}

function normalizeBrowserDownloadAction(value) {
    const action = String(value || 'download').trim().toLowerCase();
    if (action === 'save_cookies') return 'save_session';
    return action;
}

async function toolBrowserDownload(args = {}) {
    const action = normalizeBrowserDownloadAction(args.action);
    if (action === 'info') return requestSoftwareBrowserDownload({ action });
    if (action === 'save_session') {
        const session = await collectBrowserDownloadSession(args);
        return requestSoftwareBrowserDownload({
            action, session, directory: args.directory, filename: args.filename,
            overwrite: args.overwrite === true
        });
    }
    if (action !== 'download') throw new Error(`browser_download: 未知 action「${action}」`);
    const url = String(args.url || args.download_url || '').trim();
    if (!url) throw new Error('browser_download: download 需要 url');
    const session = args.use_cookies === false ? null : await collectBrowserDownloadSession(args);
    return requestSoftwareBrowserDownload({
        action, url, cookies: session?.cookies || [], directory: args.directory,
        filename: args.filename, overwrite: args.overwrite === true,
        timeout_ms: args.timeout_ms, max_bytes: args.max_bytes
    });
}
