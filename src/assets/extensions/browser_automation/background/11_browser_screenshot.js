// background/11_browser_screenshot.js — browser_screenshot MCP 工具。
// 普通可视区截图使用 tabs.captureVisibleTab；整页、元素和指定区域截图使用 CDP。

const SCREENSHOT_MAX_AREA = 25000000;
const SCREENSHOT_MAX_DATA_URL_CHARS = 8000000;

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
    const deliveryValues = [args.send_to_user, args.bot_send_to_user, args.deliver_to_user]
        .filter((value) => value !== undefined);
    const sendToUser = deliveryValues.includes(true) || !deliveryValues.includes(false);
    return {
        send_to_user: sendToUser,
        save_to_server: args.save_to_server === true || args.upload_to_server === true || sendToUser
    };
}

async function playBrowserScreenshotFx(tabId, phase) {
    const invoke = () => chrome.scripting.executeScript({
        target: { tabId },
        args: [phase],
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
            return await screenshotTimeout(
                chrome.tabs.captureVisibleTab(tab.windowId, options), timeoutMs, '可视区截图'
            );
        } catch (error) {
            lastError = error;
            if (attempt < retries) await sleep(300);
        }
    }
    throw lastError;
}

function validateScreenshotClip(clip, maxArea) {
    const values = [clip.x, clip.y, clip.width, clip.height];
    if (!values.every(Number.isFinite)) throw new Error('截图区域 x/y/width/height 必须是有限数字');
    if (clip.width <= 0 || clip.height <= 0) throw new Error('截图区域 width/height 必须大于 0');
    if (clip.width * clip.height > maxArea) {
        throw new Error(`截图区域过大，不能超过 ${maxArea} CSS 像素`);
    }
}

async function measureScreenshotTarget(tabId, args = {}) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [{ selector: args.selector, text: args.text, margin: args.margin ?? args.padding ?? 0,
            scrollIntoView: args.scroll_into_view !== false }],
        func: async (options) => {
            let target = options.selector ? document.querySelector(options.selector) : null;
            if (!target && options.text) {
                const wanted = String(options.text).trim();
                target = Array.from(document.querySelectorAll('body *')).find((element) => {
                    const text = String(element.innerText || element.textContent || '').trim();
                    return text === wanted || text.includes(wanted);
                }) || null;
            }
            if (!target) throw new Error(`未找到截图元素: ${options.selector || options.text || '(空)'}`);
            if (options.scrollIntoView) {
                target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const rect = target.getBoundingClientRect();
            const margin = Math.max(0, Number(options.margin) || 0);
            return {
                x: Math.max(0, rect.left + window.scrollX - margin),
                y: Math.max(0, rect.top + window.scrollY - margin),
                width: rect.width + margin * 2,
                height: rect.height + margin * 2
            };
        }
    });
    return results?.[0]?.result;
}

async function screenshotClipFromArgs(tab, args, timeoutMs) {
    const maxArea = screenshotBoundedNumber(args.max_area, SCREENSHOT_MAX_AREA, 1, 100000000);
    let clip;
    if (args.selector || args.text) {
        clip = await screenshotTimeout(measureScreenshotTarget(tab.id, args), timeoutMs, '截图元素定位');
    } else {
        const source = args.clip && typeof args.clip === 'object' ? args.clip : args;
        clip = { x: Number(source.x), y: Number(source.y), width: Number(source.width), height: Number(source.height) };
        const coordinateSpace = String(args.coordinate_space || source.coordinate_space || 'viewport');
        if (coordinateSpace !== 'page') {
            const metrics = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.getLayoutMetrics');
            const viewport = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
            clip.x += Number(viewport.pageX || 0);
            clip.y += Number(viewport.pageY || 0);
        }
    }
    clip = { ...clip, scale: screenshotBoundedNumber(args.scale, 1, 0.1, 4) };
    validateScreenshotClip(clip, maxArea);
    return clip;
}

async function buildCdpScreenshotParams(tab, args, timeoutMs) {
    const format = screenshotFormat(args);
    const params = { format, fromSurface: args.from_surface !== false };
    const quality = screenshotQuality(args);
    if (format !== 'png' && quality !== undefined) params.quality = quality;
    if (args.selector || args.text || screenshotWantsPreciseCapture({ ...args, full_page: false })) {
        params.captureBeyondViewport = true;
        params.clip = await screenshotClipFromArgs(tab, args, timeoutMs);
    } else if (args.full_page) {
        const metrics = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.getLayoutMetrics');
        const size = metrics?.cssContentSize || metrics?.contentSize || {};
        const clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height),
            scale: screenshotBoundedNumber(args.scale, 1, 0.1, 4) };
        validateScreenshotClip(clip, screenshotBoundedNumber(args.max_area, SCREENSHOT_MAX_AREA, 1, 100000000));
        params.captureBeyondViewport = true;
        params.clip = clip;
    }
    return params;
}

async function captureCdpScreenshot(tab, args = {}) {
    const target = { tabId: tab.id };
    const timeoutMs = screenshotBoundedNumber(args.cdp_timeout_ms ?? args.timeout_ms, 12000, 500, 30000);
    let attached = false;
    try {
        await screenshotTimeout(chrome.debugger.attach(target, '1.3'), timeoutMs, '连接 Chrome 调试协议');
        attached = true;
        await screenshotTimeout(chrome.debugger.sendCommand(target, 'Page.enable'), timeoutMs, '启用页面截图');
        const params = await buildCdpScreenshotParams(tab, args, timeoutMs);
        const result = await screenshotTimeout(
            chrome.debugger.sendCommand(target, 'Page.captureScreenshot', params), timeoutMs, 'CDP 截图'
        );
        if (!result?.data) throw new Error('CDP 截图未返回图片数据');
        const format = screenshotFormat(args);
        return `data:image/${format};base64,${result.data}`;
    } finally {
        if (attached) await chrome.debugger.detach(target).catch(() => {});
    }
}

function ensureScreenshotPayloadSize(dataUrl, args = {}) {
    const maxChars = screenshotBoundedNumber(
        args.max_data_url_chars, SCREENSHOT_MAX_DATA_URL_CHARS, 100000, 20000000
    );
    if (dataUrl.length > maxChars && args.allow_large_data_url !== true) {
        throw new Error(`截图数据过大: ${dataUrl.length} 字符，最大允许 ${maxChars}`);
    }
    return dataUrl;
}

function screenshotFailure(tab, attempts) {
    const error = attempts.join('；') || '截图失败';
    return {
        success: false,
        error,
        errorCode: 'SCREENSHOT_FAILED',
        tabId: tab?.id,
        url: tab?.url,
        hint: '请确认页面允许截图、扩展拥有页面权限，并检查 selector/区域参数。'
    };
}

function wantsBrowserScreenshotFx(args = {}) {
    return args.screenshot_fx !== false && args.fx !== false;
}

async function captureBrowserScreenshot(tab, args, precise, attempts) {
    try {
        const dataUrl = precise ? await captureCdpScreenshot(tab, args) : await captureVisibleScreenshot(tab, args);
        return {
            dataUrl,
            method: precise ? 'debugger.Page.captureScreenshot' : 'captureVisibleTab'
        };
    } catch (error) {
        attempts.push(`${precise ? 'CDP' : 'captureVisibleTab'}: ${error?.message || error}`);
        if (precise && args.fallback_visible !== true) throw error;
        return {
            dataUrl: precise ? await captureVisibleScreenshot(tab, args) : await captureCdpScreenshot(tab, args),
            method: precise ? 'captureVisibleTab.fallback' : 'debugger.Page.captureScreenshot.fallback'
        };
    }
}

function buildBrowserScreenshotSuccess(tab, args, captured, attempts) {
    return {
        success: true,
        dataUrl: captured.dataUrl,
        ...screenshotResultFlags(args),
        tabId: tab.id,
        url: tab.url,
        method: captured.method,
        warning: attempts.join('；') || undefined
    };
}

async function toolBrowserScreenshot(args = {}) {
    const tab = await resolveAutomationTargetTab(args);
    if (!tab) throw new Error('未找到可截图的真实网页标签页');
    const unsupported = screenshotUnsupportedReason(tab.url);
    if (unsupported) return screenshotFailure(tab, [unsupported]);
    const precise = screenshotWantsPreciseCapture(args);
    const attempts = [];
    const showFx = wantsBrowserScreenshotFx(args);
    await focusTab(tab.id).catch(() => {});
    if (showFx) await playBrowserScreenshotFx(tab.id, 'before');
    try {
        const captured = await captureBrowserScreenshot(tab, args, precise, attempts);
        ensureScreenshotPayloadSize(captured.dataUrl, args);
        if (showFx) await playBrowserScreenshotFx(tab.id, 'after');
        return buildBrowserScreenshotSuccess(tab, args, captured, attempts);
    } catch (error) {
        const message = error?.message || String(error);
        if (!attempts.some((attempt) => attempt.includes(message))) attempts.push(message);
        return screenshotFailure(tab, attempts);
    }
}
