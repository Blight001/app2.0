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

function inferBrowserDownloadMediaType(args, url) {
    const explicit = String(args.media_type || args.mediaType || '').trim().toLowerCase();
    if (['image', 'video', 'audio'].includes(explicit)) return explicit;
    const pathname = (() => { try { return new URL(url).pathname; } catch (_) { return ''; } })();
    const extension = String(args.filename || pathname).split(/[?#]/)[0].split('.').pop().toLowerCase();
    if (/^(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/.test(extension)) return 'image';
    if (/^(?:m4v|mkv|mov|mp4|mpeg|ogv|webm)$/.test(extension)) return 'video';
    if (/^(?:aac|flac|m4a|mp3|oga|ogg|wav)$/.test(extension)) return 'audio';
    return '';
}

function safeBrowserDownloadPath(value) {
    const parts = String(value || '').replace(/\\/g, '/').split('/')
        .map(part => part.trim()).filter(Boolean);
    if (parts.some(part => part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
        throw new Error('browser_download: directory/filename 不是安全的相对路径');
    }
    return parts.join('/');
}

function nativeBrowserDownloadFilename(args, url) {
    const directory = safeBrowserDownloadPath(args.directory);
    let filename = safeBrowserDownloadPath(args.filename);
    if (!filename && directory) {
        try { filename = safeBrowserDownloadPath(decodeURIComponent(new URL(url).pathname.split('/').pop() || '')); } catch (_) {}
    }
    return [directory, filename].filter(Boolean).join('/');
}

async function waitForNativeBrowserDownload(downloadId, args) {
    const timeoutMs = Math.min(300000, Math.max(1000, Number(args.timeout_ms) || 120000));
    const maxBytes = Math.min(1024 * 1024 * 1024, Math.max(1, Number(args.max_bytes) || 250 * 1024 * 1024));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const item = (await chrome.downloads.search({ id: downloadId }))[0];
        if (!item) throw new Error('Chromium 下载任务不存在');
        if (Number(item.totalBytes || 0) > maxBytes || Number(item.bytesReceived || 0) > maxBytes) {
            await chrome.downloads.cancel(downloadId).catch(() => {});
            throw new Error(`下载文件超过大小限制 ${maxBytes} bytes`);
        }
        if (item.state === 'complete') return item;
        if (item.state === 'interrupted') throw new Error(`Chromium 下载中断: ${item.error || '未知原因'}`);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    await chrome.downloads.cancel(downloadId).catch(() => {});
    throw new Error('Chromium 下载超时');
}

function getNativeDownloadsApi() {
    const api = chrome.downloads;
    if (!api || typeof api.download !== 'function' || typeof api.search !== 'function') {
        throw new Error('当前 Chromium 未提供 downloads API');
    }
    return api;
}

async function assertNativeDownloadPermission() {
    const contains = chrome.permissions && chrome.permissions.contains;
    if (typeof contains !== 'function') return;
    if (!await contains.call(chrome.permissions, { permissions: ['downloads'] })) {
        throw new Error('AI 自动化插件未获得下载权限');
    }
}

function buildNativeDownloadOptions(args, url) {
    const options = {
        url, saveAs: false, conflictAction: args.overwrite === true ? 'overwrite' : 'uniquify'
    };
    const filename = nativeBrowserDownloadFilename(args, url);
    if (filename) options.filename = filename;
    return { filename, options };
}

function nativeDownloadResult(item, downloadId, filename, url, mediaType) {
    const absolutePath = String(item.filename || '');
    const requestedName = filename.split('/').pop();
    const fileName = absolutePath.split(/[\\/]/).pop() || requestedName || 'download.bin';
    return {
        success: true, action: 'download', transport: 'chromium', download_id: downloadId,
        file_name: fileName, relative_path: filename || fileName, absolute_path: absolutePath,
        final_url: String(item.finalUrl || item.url || url), mime_type: String(item.mime || ''),
        size: Number(item.fileSize || item.bytesReceived || 0), media_type: mediaType
    };
}

async function nativeBrowserDownload(args, url, mediaType) {
    const downloads = getNativeDownloadsApi();
    await assertNativeDownloadPermission();
    const { filename, options } = buildNativeDownloadOptions(args, url);
    const downloadId = await downloads.download(options);
    const item = await waitForNativeBrowserDownload(downloadId, args);
    return nativeDownloadResult(item, downloadId, filename, url, mediaType);
}

function softwareDownloadPayload(args, url, session, mediaType) {
    return {
        action: 'download', url, cookies: session?.cookies || [], directory: args.directory,
        filename: args.filename, overwrite: args.overwrite === true,
        timeout_ms: args.timeout_ms, max_bytes: args.max_bytes, media_type: mediaType,
        referer: session?.pageUrl || '', user_agent: globalThis.navigator?.userAgent || ''
    };
}

function allowsNativeFallback(transport, args) {
    return transport !== 'software' && args.use_cookies !== false;
}

function browserDownloadErrorMessage(error) {
    return error && error.message ? String(error.message) : '';
}

async function downloadWithFallback(args, url, session, mediaType) {
    const transport = String(args.transport || 'auto').trim().toLowerCase();
    const nativeFirst = transport === 'browser' || (transport === 'auto' && mediaType && args.use_cookies !== false);
    let nativeError = null;
    if (nativeFirst) {
        try { return await nativeBrowserDownload(args, url, mediaType); } catch (error) { nativeError = error; }
        if (transport === 'browser') throw nativeError;
    }
    try {
        return await requestSoftwareBrowserDownload(softwareDownloadPayload(args, url, session, mediaType));
    } catch (softwareError) {
        if (!nativeFirst && allowsNativeFallback(transport, args)) {
            try { return await nativeBrowserDownload(args, url, mediaType); } catch (error) { nativeError = error; }
        }
        const detail = [browserDownloadErrorMessage(softwareError), browserDownloadErrorMessage(nativeError)]
            .filter(Boolean).join('；Chromium 回退失败: ');
        throw new Error(detail || 'browser_download 下载失败');
    }
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
    const mediaType = inferBrowserDownloadMediaType(args, url);
    return downloadWithFallback(args, url, session, mediaType);
}
