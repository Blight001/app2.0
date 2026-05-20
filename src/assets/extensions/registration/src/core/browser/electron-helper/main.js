const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, session } = require('electron');

const visible = String(process.env.BUILTIN_ELECTRON_WINDOW_VISIBLE || '1').trim() !== '0';
const offscreen = String(process.env.BUILTIN_ELECTRON_WINDOW_OFFSCREEN || '0').trim() !== '0';
const windowWidth = Number.isFinite(parseInt(process.env.BUILTIN_ELECTRON_WINDOW_WIDTH, 10))
    ? Math.max(320, parseInt(process.env.BUILTIN_ELECTRON_WINDOW_WIDTH, 10))
    : 1366;
const windowHeight = Number.isFinite(parseInt(process.env.BUILTIN_ELECTRON_WINDOW_HEIGHT, 10))
    ? Math.max(240, parseInt(process.env.BUILTIN_ELECTRON_WINDOW_HEIGHT, 10))
    : 768;
const userDataDir = String(process.env.BUILTIN_ELECTRON_USER_DATA_DIR || '').trim();
const remoteDebuggingPort = String(process.env.BUILTIN_ELECTRON_REMOTE_DEBUGGING_PORT || '0').trim() || '0';
const openWindows = new Set();
const DOCUMENT_POLICY_NOISE_TOKEN = 'include-js-call-stacks-in-crash-reports';
const MEDIA_DOWNLOAD_EXTENSIONS = {
    image: '.png',
    video: '.mp4'
};
const IMAGE_MIME_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/pjpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/x-ms-bmp': '.bmp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'image/vnd.microsoft.icon': '.ico',
    'image/x-icon': '.ico'
};
const VIDEO_MIME_EXTENSIONS = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'video/x-flv': '.flv',
    'video/mpeg': '.mpg'
};
let responseHeaderFilterInstalled = false;
let watermarkExtensionLoadPromise = null;

function stripDocumentPolicyNoise(headerValue = '') {
    const raw = String(headerValue || '').trim();
    if (!raw) {
        return raw;
    }

    const parts = raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => !item.toLowerCase().includes(DOCUMENT_POLICY_NOISE_TOKEN));

    return parts.join(', ');
}

function installResponseHeaderFilter() {
    if (responseHeaderFilterInstalled || !session || !session.defaultSession || !session.defaultSession.webRequest) {
        return;
    }

    responseHeaderFilterInstalled = true;
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...(details.responseHeaders || {}) };
        let changed = false;

        for (const [headerName, headerValue] of Object.entries(responseHeaders)) {
            if (String(headerName || '').toLowerCase() !== 'document-policy') {
                continue;
            }

            const nextValue = Array.isArray(headerValue)
                ? headerValue.map(item => stripDocumentPolicyNoise(item)).filter(Boolean)
                : stripDocumentPolicyNoise(headerValue);

            if (Array.isArray(nextValue) ? nextValue.length > 0 : String(nextValue || '').trim()) {
                responseHeaders[headerName] = nextValue;
            } else {
                delete responseHeaders[headerName];
            }

            changed = true;
        }

        callback({
            responseHeaders: changed ? responseHeaders : details.responseHeaders
        });
    });
}

function installDevToolsShortcuts(win) {
    if (!win || typeof win.webContents?.on !== 'function') {
        return;
    }

    win.webContents.on('before-input-event', (event, input) => {
        const key = String(input?.key || '').toLowerCase();
        const isF12Shortcut = key === 'f12';
        const isDevToolsShortcut = isF12Shortcut || ((input.control || input.meta) && input.shift && key === 'i');

        if (!isDevToolsShortcut) {
            return;
        }

        try {
            if (win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools();
            } else {
                win.webContents.openDevTools({ mode: 'bottom' });
            }
        } catch (_error) {
        }

        if (!isF12Shortcut) {
            event.preventDefault();
        }
    });
}

function resolveWatermarkExtensionPath() {
    if (String(process.env.BUILTIN_ELECTRON_EXTENSION_ENABLED || '1').trim() === '0') {
        return '';
    }

    const explicitPath = String(process.env.BUILTIN_ELECTRON_EXTENSION_PATH || '').trim();
    const candidates = [
        explicitPath,
        path.join(process.cwd(), 'extensions', 'remove_watermark'),
        process.resourcesPath ? path.join(process.resourcesPath, 'extensions', 'remove_watermark') : '',
        path.join(app.getAppPath ? app.getAppPath() : process.cwd(), 'extensions', 'remove_watermark')
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                const manifestPath = path.join(candidate, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    return candidate;
                }
            }
        } catch (_error) {
        }
    }

    return '';
}

function resolveWatermarkDownloadScriptPath() {
    const extensionPath = resolveWatermarkExtensionPath();
    if (!extensionPath) {
        return '';
    }

    const candidates = [
        path.join(extensionPath, 'lack', 'dldam.js'),
        path.join(extensionPath, 'dldam.js')
    ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (_error) {
        }
    }

    return '';
}

function sanitizeDownloadFileNamePart(value = '', fallback = 'download') {
    const raw = String(value || '').trim();
    const fallbackName = String(fallback || 'download').trim() || 'download';
    const cleaned = raw
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim();

    return cleaned || fallbackName;
}

function normalizeDownloadExtension(value = '') {
    const extension = String(value || '').trim().toLowerCase();
    if (!extension) {
        return '';
    }

    return extension.startsWith('.') ? extension : `.${extension}`;
}

function resolveDownloadExtensionFromMimeType(mimeType = '') {
    const normalized = String(mimeType || '').trim().toLowerCase();
    if (!normalized) {
        return '';
    }

    if (IMAGE_MIME_EXTENSIONS[normalized]) {
        return IMAGE_MIME_EXTENSIONS[normalized];
    }

    if (VIDEO_MIME_EXTENSIONS[normalized]) {
        return VIDEO_MIME_EXTENSIONS[normalized];
    }

    return '';
}

function resolveDownloadNameFromUrl(sourceUrl = '') {
    const rawUrl = String(sourceUrl || '').trim();
    if (!rawUrl) {
        return { baseName: '', extension: '' };
    }

    try {
        const parsedUrl = new URL(rawUrl);
        const pathname = decodeURIComponent(parsedUrl.pathname || '');
        const parsedBaseName = path.basename(pathname);
        const parsedExt = normalizeDownloadExtension(path.extname(parsedBaseName));
        return {
            baseName: parsedExt
                ? parsedBaseName.slice(0, -parsedExt.length)
                : parsedBaseName,
            extension: parsedExt
        };
    } catch (_error) {
        const fallbackPath = rawUrl.split(/[?#]/, 1)[0];
        const parsedBaseName = path.basename(fallbackPath);
        const parsedExt = normalizeDownloadExtension(path.extname(parsedBaseName));
        return {
            baseName: parsedExt
                ? parsedBaseName.slice(0, -parsedExt.length)
                : parsedBaseName,
            extension: parsedExt
        };
    }
}

function uniqueDownloadPath(basePath) {
    const parsed = path.parse(basePath);
    let candidate = basePath;
    let index = 1;

    while (fs.existsSync(candidate)) {
        candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
        index += 1;
    }

    return candidate;
}

function getContextMediaLabel(mediaType = '') {
    const normalized = String(mediaType || '').trim().toLowerCase();
    if (normalized === 'video') {
        return '视频';
    }
    if (normalized === 'image') {
        return '图片';
    }
    return '文件';
}

function resolveMediaDownloadFileName(params = {}, downloadItem = null) {
    const mediaType = String(params.mediaType || '').trim().toLowerCase();
    const fallbackLabel = getContextMediaLabel(mediaType);
    const sourceUrl = String(params.srcURL || params.linkURL || '').trim();
    const downloadFilename = typeof downloadItem?.getFilename === 'function'
        ? String(downloadItem.getFilename() || '').trim()
        : '';
    const downloadMimeType = typeof downloadItem?.getMimeType === 'function'
        ? String(downloadItem.getMimeType() || '').trim()
        : '';

    const suggestedNameSource = downloadFilename || sourceUrl;
    const suggestedName = resolveDownloadNameFromUrl(suggestedNameSource);
    const urlName = resolveDownloadNameFromUrl(sourceUrl);
    let baseName = suggestedName.baseName || urlName.baseName || '';
    let extension = normalizeDownloadExtension(suggestedName.extension || urlName.extension);

    if (!baseName) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        baseName = `${fallbackLabel}-${timestamp}`;
    }

    if (!extension) {
        extension = resolveDownloadExtensionFromMimeType(downloadMimeType)
            || resolveDownloadExtensionFromMimeType(downloadItem?.mimeType || '')
            || MEDIA_DOWNLOAD_EXTENSIONS[mediaType]
            || '';
    }

    const safeBaseName = sanitizeDownloadFileNamePart(baseName, fallbackLabel);
    return `${safeBaseName}${extension}`;
}

async function downloadContextMedia(win, params = {}) {
    if (!win || !win.webContents || typeof win.webContents.downloadURL !== 'function') {
        throw new Error('浏览器下载能力不可用');
    }

    const sourceUrl = String(params.srcURL || params.linkURL || '').trim();
    if (!sourceUrl) {
        throw new Error('未找到可下载的媒体地址');
    }

    const mediaType = String(params.mediaType || '').trim().toLowerCase();
    const targetSession = win.webContents.session || session.defaultSession;
    const downloadsDir = app.getPath('downloads');
    const fallbackFileName = resolveMediaDownloadFileName(params);

    return await new Promise((resolve, reject) => {
        let settled = false;
        const timeoutMs = 30000;
        const timeoutId = setTimeout(() => {
            settleReject(new Error('下载超时'));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (targetSession && typeof targetSession.removeListener === 'function') {
                targetSession.removeListener('will-download', onWillDownload);
            }
        };

        const settleResolve = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(value);
        };

        const settleReject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(error);
        };

        const onWillDownload = (event, item, webContents) => {
            const itemUrl = typeof item?.getURL === 'function' ? String(item.getURL() || '').trim() : '';
            if (webContents && webContents !== win.webContents) {
                return;
            }
            if (itemUrl && itemUrl !== sourceUrl) {
                return;
            }

            const fileName = resolveMediaDownloadFileName(params, item);
            const savePath = uniqueDownloadPath(path.join(downloadsDir, fileName || fallbackFileName));

            try {
                item.setSavePath(savePath);
            } catch (error) {
                settleReject(error);
                return;
            }

            item.once('done', (_doneEvent, state) => {
                if (state === 'completed') {
                    settleResolve({
                        fileName,
                        mediaType,
                        savePath,
                        sourceUrl
                    });
                    return;
                }

                settleReject(new Error(`下载${getContextMediaLabel(mediaType)}失败: ${state}`));
            });
        };

        try {
            if (targetSession && typeof targetSession.on === 'function') {
                targetSession.on('will-download', onWillDownload);
            }
        } catch (error) {
            settleReject(error);
            return;
        }

        try {
            win.webContents.downloadURL(sourceUrl);
        } catch (error) {
            settleReject(error);
        }
    });
}

async function runWatermarkDownloadScript(win) {
    if (!win || !win.webContents || typeof win.webContents.executeJavaScript !== 'function') {
        throw new Error('浏览器上下文不可用');
    }

    const scriptPath = resolveWatermarkDownloadScriptPath();
    if (!scriptPath) {
        throw new Error('未找到去水印下载脚本');
    }

    const script = await fs.promises.readFile(scriptPath, 'utf8');
    await win.webContents.executeJavaScript(script, true);
    return scriptPath;
}

function installRightClickInspectElement(win) {
    if (!win || !win.webContents || typeof win.webContents.on !== 'function') {
        return;
    }

    win.webContents.on('context-menu', (event, params) => {
        const mediaType = String(params?.mediaType || '').trim().toLowerCase();
        const mediaLabel = getContextMediaLabel(mediaType);
        const isDownloadableMedia = mediaType === 'image' || mediaType === 'video';
        const sourceUrl = String(params?.srcURL || params?.linkURL || '').trim();
        const canInspect = true;
        const menuTemplate = [
            {
                label: '定位元素',
                enabled: canInspect,
                click: () => {
                    try {
                        const bounds = typeof win.getContentBounds === 'function'
                            ? win.getContentBounds()
                            : { width: 0, height: 0 };
                        const centerX = Math.max(0, Math.floor(Number(bounds.width || 0) / 2));
                        const centerY = Math.max(0, Math.floor(Number(bounds.height || 0) / 2));
                        if (!win.webContents.isDevToolsOpened()) {
                            win.webContents.openDevTools({ mode: 'bottom' });
                        }
                        win.webContents.inspectElement(centerX, centerY);
                    } catch (_error) {
                    }
                }
            },
            ...(isDownloadableMedia ? [
                {
                    label: `下载${mediaLabel}`,
                    enabled: Boolean(sourceUrl),
                    click: async () => {
                        try {
                            const result = await downloadContextMedia(win, params);
                            console.log(`[builtin-browser] 已下载${mediaLabel}: ${result.savePath}`);
                        } catch (error) {
                            console.warn(`[builtin-browser] 下载${mediaLabel}失败: ${error.message}`);
                        }
                    }
                }
            ] : []),
        ];

        try {
            const menu = Menu.buildFromTemplate(menuTemplate);
            menu.popup({
                window: win
            });
        } catch (error) {
            console.warn(`[builtin-browser] 打开右键菜单失败: ${error.message}`);
        }

        event.preventDefault();
    });
}

if (userDataDir) {
    try {
        app.setPath('userData', userDataDir);
    } catch (_error) {
    }
}

try {
    if (remoteDebuggingPort) {
        app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort);
    }
} catch (_error) {
}

try {
    Menu.setApplicationMenu(null);
} catch (_error) {
}

app.on('web-contents-created', (_event, contents) => {
    if (!contents || typeof contents.setWindowOpenHandler !== 'function') {
        return;
    }

    contents.setWindowOpenHandler(() => ({
        action: 'allow',
        overrideBrowserWindowOptions: offscreen
            ? {
                x: -32000,
                y: -32000,
                show: true,
                skipTaskbar: true
            }
            : {}
    }));
});

function createBuiltinWindow() {
    const win = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: offscreen ? -32000 : undefined,
        y: offscreen ? -32000 : undefined,
        show: visible,
        skipTaskbar: offscreen,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        devTools: true,
        title: '内置浏览器',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            nativeWindowOpen: true,
            backgroundThrottling: false
        }
    });

    if (typeof win.removeMenu === 'function') {
        win.removeMenu();
    }

    installDevToolsShortcuts(win);
    installRightClickInspectElement(win);
    win.loadURL('about:blank').catch(() => {});

    if (visible && typeof win.once === 'function') {
        win.once('ready-to-show', () => {
            if (!win.isDestroyed()) {
                win.show();
                win.focus();
            }
        });
    }

    openWindows.add(win);
    win.on('closed', () => {
        openWindows.delete(win);
    });

    return win;
}

app.whenReady().then(() => {
    installResponseHeaderFilter();
    createBuiltinWindow();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createBuiltinWindow();
    }
});
