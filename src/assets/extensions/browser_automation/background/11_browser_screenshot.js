// background/11_browser_screenshot.js — 无调试权限的 browser_screenshot。
// 可视区直接 captureVisibleTab；整页、元素和区域通过滚动分片后在 offscreen canvas 拼接。

const SCREENSHOT_MAX_AREA = 25000000;
const SCREENSHOT_MAX_DATA_URL_CHARS = 8000000;
const SCREENSHOT_CAPTURE_INTERVAL_MS = 600;
let screenshotCaptureQueue = Promise.resolve();
let screenshotLastCaptureAt = 0;

function screenshotBoundedNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function screenshotFormat(args = {}) {
    const format = String(args.format || 'png').trim().toLowerCase();
    return ['png', 'jpeg', 'webp'].includes(format) ? format : 'png';
}

function screenshotQuality(args = {}) {
    if (args.quality === undefined || args.quality === null || args.quality === '') return undefined;
    return Math.round(screenshotBoundedNumber(args.quality, 80, 0, 100));
}

function screenshotTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function screenshotUnsupportedReason(url = '') {
    const value = String(url || '');
    if (/^(https?|file):/i.test(value)) return '';
    return `当前页面不允许截图: ${value || '(空 URL)'}`;
}

function screenshotWantsPreciseCapture(args = {}) {
    const region = args.clip && typeof args.clip === 'object' ? args.clip : args;
    const hasRegion = ['x', 'y', 'width', 'height'].every((key) => region[key] !== undefined);
    return Boolean(args.full_page || args.selector || args.text || hasRegion);
}

function screenshotResultFlags(args = {}) {
    const values = [args.send_to_user, args.bot_send_to_user, args.deliver_to_user]
        .filter((value) => value !== undefined);
    const sendToUser = values.includes(true) || !values.includes(false);
    return {
        send_to_user: sendToUser,
        save_to_server: args.save_to_server === true || args.upload_to_server === true || sendToUser
    };
}

async function playBrowserScreenshotFx(tabId, phase) {
    const invoke = () => chrome.scripting.executeScript({
        target: { tabId }, args: [phase],
        func: async (fxPhase) => {
            const fx = window.__hsFx;
            const method = fxPhase === 'before' ? fx?.shotBefore : fx?.shotAfter;
            if (typeof method !== 'function') return { missing: true };
            await method.call(fx);
            return { success: true };
        }
    });
    try {
        let result = await invoke();
        if (result?.[0]?.result?.missing) {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content/fx.js'] });
            result = await invoke();
        }
        return result?.[0]?.result;
    } catch (_error) {
        return undefined;
    }
}

function scheduleVisibleScreenshot(operation) {
    const run = async () => {
        const remaining = SCREENSHOT_CAPTURE_INTERVAL_MS - (Date.now() - screenshotLastCaptureAt);
        if (remaining > 0) await sleep(remaining);
        try {
            return await operation();
        } finally {
            screenshotLastCaptureAt = Date.now();
        }
    };
    const scheduled = screenshotCaptureQueue.then(run, run);
    screenshotCaptureQueue = scheduled.catch(() => {});
    return scheduled;
}

function screenshotRetryDelay(error) {
    return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(String(error?.message || error))
        ? 1100 : SCREENSHOT_CAPTURE_INTERVAL_MS;
}

async function captureVisibleScreenshot(tab, args = {}) {
    const retries = Math.round(screenshotBoundedNumber(args.retries, 1, 0, 3));
    const timeoutMs = screenshotBoundedNumber(args.visible_timeout_ms ?? args.timeout_ms, 8000, 500, 30000);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const format = screenshotFormat(args) === 'jpeg' ? 'jpeg' : 'png';
            const options = { format };
            const quality = screenshotQuality(args);
            if (format === 'jpeg' && quality !== undefined) options.quality = quality;
            return await scheduleVisibleScreenshot(() => screenshotTimeout(
                chrome.tabs.captureVisibleTab(tab.windowId, options), timeoutMs, '可视区截图'
            ));
        } catch (error) {
            lastError = error;
            if (attempt < retries) await sleep(screenshotRetryDelay(error));
        }
    }
    throw lastError;
}

async function readScreenshotPageState(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
            scrollX: window.scrollX, scrollY: window.scrollY,
            viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
            pageWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
            pageHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
        })
    });
    return results?.[0]?.result;
}

async function measureScreenshotTarget(tabId, args = {}) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [{ selector: args.selector, text: args.text, margin: args.margin ?? args.padding ?? 0 }],
        func: (options) => {
            let target = options.selector ? document.querySelector(options.selector) : null;
            if (!target && options.text) {
                const wanted = String(options.text).trim();
                target = Array.from(document.querySelectorAll('body *')).find((element) => {
                    const text = String(element.innerText || element.textContent || '').trim();
                    return text === wanted || text.includes(wanted);
                }) || null;
            }
            if (!target) throw new Error(`未找到截图元素: ${options.selector || options.text || '(空)'}`);
            const rect = target.getBoundingClientRect();
            const margin = Math.max(0, Number(options.margin) || 0);
            return { x: Math.max(0, rect.left + window.scrollX - margin),
                y: Math.max(0, rect.top + window.scrollY - margin),
                width: rect.width + margin * 2, height: rect.height + margin * 2 };
        }
    });
    return results?.[0]?.result;
}

function validateScreenshotClip(clip, args = {}) {
    if (![clip.x, clip.y, clip.width, clip.height].every(Number.isFinite)) {
        throw new Error('截图区域 x/y/width/height 必须是有限数字');
    }
    if (clip.width <= 0 || clip.height <= 0) throw new Error('截图区域 width/height 必须大于 0');
    const maxArea = screenshotBoundedNumber(args.max_area, SCREENSHOT_MAX_AREA, 1, 100000000);
    if (clip.width * clip.height > maxArea) throw new Error(`截图区域过大，不能超过 ${maxArea} CSS 像素`);
}

async function resolveScreenshotClip(tab, args, page) {
    let clip;
    if (args.full_page) {
        clip = { x: 0, y: 0, width: page.pageWidth, height: page.pageHeight };
    } else if (args.selector || args.text) {
        clip = await measureScreenshotTarget(tab.id, args);
    } else {
        const source = args.clip && typeof args.clip === 'object' ? args.clip : args;
        const pageSpace = String(args.coordinate_space || source.coordinate_space || 'viewport') === 'page';
        clip = { x: Number(source.x) + (pageSpace ? 0 : page.scrollX),
            y: Number(source.y) + (pageSpace ? 0 : page.scrollY),
            width: Number(source.width), height: Number(source.height) };
    }
    clip.width = Math.min(clip.width, page.pageWidth - clip.x);
    clip.height = Math.min(clip.height, page.pageHeight - clip.y);
    validateScreenshotClip(clip, args);
    return clip;
}

async function scrollScreenshotPage(tabId, x, y) {
    const results = await chrome.scripting.executeScript({
        target: { tabId }, args: [x, y],
        func: async (left, top) => {
            window.scrollTo({ left, top, behavior: 'auto' });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { x: window.scrollX, y: window.scrollY };
        }
    });
    return results?.[0]?.result;
}

function screenshotTilePositions(clip, page) {
    const positions = [];
    const right = clip.x + clip.width;
    const bottom = clip.y + clip.height;
    for (let y = clip.y; y < bottom; y += page.viewportHeight) {
        for (let x = clip.x; x < right; x += page.viewportWidth) positions.push({ x, y });
    }
    return positions;
}

function buildScreenshotTile(dataUrl, position, clip, page) {
    const left = Math.max(clip.x, position.x);
    const top = Math.max(clip.y, position.y);
    const right = Math.min(clip.x + clip.width, position.x + page.viewportWidth);
    const bottom = Math.min(clip.y + clip.height, position.y + page.viewportHeight);
    return { dataUrl, viewportWidth: page.viewportWidth, viewportHeight: page.viewportHeight,
        sx: left - position.x, sy: top - position.y, sw: right - left, sh: bottom - top,
        dx: left - clip.x, dy: top - clip.y };
}

async function collectScreenshotTiles(tab, args, clip, page) {
    const tiles = [];
    const positions = screenshotTilePositions(clip, page);
    try {
        for (const requested of positions) {
            const actual = await scrollScreenshotPage(tab.id, requested.x, requested.y);
            const dataUrl = await captureVisibleScreenshot(tab, args);
            tiles.push(buildScreenshotTile(dataUrl, actual, clip, page));
        }
    } finally {
        await scrollScreenshotPage(tab.id, page.scrollX, page.scrollY).catch(() => {});
    }
    return tiles;
}

async function composeScreenshotTiles(tiles, clip, args) {
    await ensureAgentOffscreen();
    const response = await chrome.runtime.sendMessage({
        type: 'screenshot:compose',
        payload: { tiles, width: clip.width, height: clip.height,
            scale: screenshotBoundedNumber(args.scale, 1, 0.1, 4),
            format: screenshotFormat(args), quality: screenshotQuality(args) }
    });
    if (!response?.ok || !response.dataUrl) throw new Error(response?.error || '截图拼接失败');
    return response.dataUrl;
}

async function capturePreciseScreenshot(tab, args) {
    const page = await readScreenshotPageState(tab.id);
    const clip = await resolveScreenshotClip(tab, args, page);
    const tiles = await collectScreenshotTiles(tab, args, clip, page);
    return composeScreenshotTiles(tiles, clip, args);
}

function ensureScreenshotPayloadSize(dataUrl, args = {}) {
    const maxChars = screenshotBoundedNumber(
        args.max_data_url_chars, SCREENSHOT_MAX_DATA_URL_CHARS, 100000, 20000000
    );
    if (dataUrl.length > maxChars && args.allow_large_data_url !== true) {
        throw new Error(`截图数据过大: ${dataUrl.length} 字符，最大允许 ${maxChars}`);
    }
}

function screenshotFailure(tab, error) {
    const message = error?.message || String(error || '截图失败');
    return { success: false, error: message, errorCode: 'SCREENSHOT_FAILED',
        tabId: tab?.id, url: tab?.url,
        hint: '请确认页面允许截图、扩展拥有页面权限，并检查 selector/区域参数。' };
}

async function toolBrowserScreenshot(args = {}) {
    const tab = await resolveAutomationTargetTab(args);
    if (!tab) throw new Error('未找到可截图的真实网页标签页');
    const unsupported = screenshotUnsupportedReason(tab.url);
    if (unsupported) return screenshotFailure(tab, new Error(unsupported));
    const showFx = args.screenshot_fx !== false && args.fx !== false;
    await focusTab(tab.id).catch(() => {});
    if (showFx) await playBrowserScreenshotFx(tab.id, 'before');
    try {
        const precise = screenshotWantsPreciseCapture(args);
        const dataUrl = precise
            ? await capturePreciseScreenshot(tab, args)
            : await captureVisibleScreenshot(tab, args);
        ensureScreenshotPayloadSize(dataUrl, args);
        if (showFx) await playBrowserScreenshotFx(tab.id, 'after');
        return { success: true, dataUrl, ...screenshotResultFlags(args), tabId: tab.id, url: tab.url,
            method: precise ? 'captureVisibleTab.stitched' : 'captureVisibleTab' };
    } catch (error) {
        return screenshotFailure(tab, error);
    }
}
