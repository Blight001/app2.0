function cardPageNormalize(value = '') {
    return String(value || '').trim();
}

function cardPageSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function cardPageIsVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return Boolean(style && style.display !== 'none' && style.visibility !== 'hidden'
        && style.opacity !== '0' && rect.width > 0 && rect.height > 0);
}

function cardPageParseHasText(selector = '') {
    const match = selector.match(/^(.*?):has-text\((['"])(.*?)\2\)\s*$/i);
    return match ? { css: cardPageNormalize(match[1]), text: match[3] } : null;
}

function cardPageParseAttributeSelector(selector = '') {
    const match = cardPageNormalize(selector).match(/^(id|class|name|placeholder|aria-label|aria)=(.*)$/i);
    return match ? { attr: match[1].toLowerCase(), value: cardPageNormalize(match[2]) } : null;
}

function cardPageGetSelectorCandidates(selector = '') {
    const normalized = cardPageNormalize(selector);
    if (!normalized) return [];
    const chained = cardPageGetChainedSelector(normalized);
    if (chained) return [{ kind: 'css', value: chained }];
    if (/^text[=:]/i.test(normalized)) return [{ kind: 'text', value: normalized.replace(/^text[:=]/i, '') }];
    const attribute = cardPageParseAttributeSelector(normalized);
    if (attribute) return [{ kind: 'attr', ...attribute }];
    const hasText = cardPageParseHasText(normalized);
    if (hasText) return [{ kind: 'hasText', ...hasText }];
    if (cardPageLooksLikeCss(normalized)) return [{ kind: 'css', value: normalized }];
    return [{ kind: 'css', value: normalized }, { kind: 'text', value: normalized }];
}

function cardPageGetChainedSelector(selector) {
    if (!selector.includes('>>')) return '';
    const parts = selector.split('>>').map(cardPageNormalize).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

function cardPageLooksLikeCss(selector) {
    return /^[.#\[]/.test(selector) || selector.includes(' ') || selector.includes('>') || selector.includes(':');
}

function cardPageCollectDocumentText(root = document, visited = new Set(), depth = 0) {
    if (!root || visited.has(root) || depth > 6) return '';
    visited.add(root);
    const parts = [];
    cardPageCollectRootText(root, parts);
    cardPageCollectFrameText(root, visited, depth, parts);
    return parts.join('\n');
}

function cardPageCollectRootText(root, parts) {
    try {
        const body = root.body || root.documentElement || null;
        const text = cardPageNormalize(body?.innerText || body?.textContent || '');
        if (text) parts.push(text);
    } catch (_) {}
}

function cardPageCollectFrameText(root, visited, depth, parts) {
    try {
        const frames = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
        frames.forEach((frame) => {
            try {
                const frameDocument = frame.contentDocument || frame.contentWindow?.document || null;
                const text = frameDocument ? cardPageCollectDocumentText(frameDocument, visited, depth + 1) : '';
                if (text) parts.push(text);
            } catch (_) {}
        });
    } catch (_) {}
}

function cardPageQueryElements(selector = '') {
    const matched = [];
    const pushUnique = (element) => {
        if (element && !matched.includes(element)) matched.push(element);
    };
    for (const candidate of cardPageGetSelectorCandidates(selector)) {
        try { cardPageCollectCandidate(candidate, pushUnique); } catch (_) {}
    }
    return matched;
}

function cardPageCollectCandidate(candidate, pushUnique) {
    if (candidate.kind === 'css') return document.querySelectorAll(candidate.value).forEach(pushUnique);
    if (candidate.kind === 'text') return cardPageCollectTextCandidate(candidate.value, pushUnique);
    if (candidate.kind === 'attr') return cardPageCollectAttributeCandidate(candidate, pushUnique);
    if (candidate.kind === 'hasText') cardPageCollectHasTextCandidate(candidate, pushUnique);
}

function cardPageCollectTextCandidate(value, pushUnique) {
    const needle = cardPageNormalize(value).toLowerCase();
    if (!needle) return;
    const selector = 'button, a, input, textarea, select, label, span, div, li, p, option, [role="button"], [contenteditable="true"]';
    document.querySelectorAll(selector).forEach((element) => {
        const text = `${element.innerText || element.textContent || element.value || ''}`.trim().toLowerCase();
        const placeholder = `${element.getAttribute('placeholder') || ''}`.trim().toLowerCase();
        const ariaLabel = `${element.getAttribute('aria-label') || ''}`.trim().toLowerCase();
        if (text.includes(needle) || placeholder.includes(needle) || ariaLabel.includes(needle)) pushUnique(element);
    });
}

function cardPageCollectAttributeCandidate(candidate, pushUnique) {
    const needle = cardPageNormalize(candidate.value).toLowerCase();
    document.querySelectorAll('input, textarea, button, select, [role="button"], [contenteditable="true"], *').forEach((element) => {
        if (`${element.getAttribute(candidate.attr) || ''}`.trim().toLowerCase().includes(needle)) pushUnique(element);
    });
}

function cardPageCollectHasTextCandidate(candidate, pushUnique) {
    const needle = cardPageNormalize(candidate.text).toLowerCase();
    document.querySelectorAll(candidate.css || '*').forEach((element) => {
        const text = `${element.innerText || element.textContent || ''}`.trim().toLowerCase();
        if (text.includes(needle)) pushUnique(element);
    });
}

function cardPagePickElement(selector = '', nth = 0) {
    const elements = cardPageQueryElements(selector).filter(cardPageIsVisible);
    if (!elements.length) return null;
    const number = Number(nth);
    const index = Number.isFinite(number) && number >= 0 ? number : 0;
    return elements[Math.min(index, elements.length - 1)] || null;
}

async function cardPageWaitForElement(payload, shouldBeVisible = true) {
    const deadline = Date.now() + payload.timeoutMs;
    while (Date.now() <= deadline) {
        const element = cardPagePickElement(payload.selector, payload.nth);
        if ((shouldBeVisible && element) || (!shouldBeVisible && !element)) return element || true;
        await cardPageSleep(payload.intervalMs);
    }
    return null;
}

function cardPageSetNativeValue(element, value) {
    const tag = String(element?.tagName || '').toLowerCase();
    const prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : tag === 'input' ? HTMLInputElement.prototype : null;
    if (prototype) cardPageSetPrototypeValue(prototype, element, value);
    else if ('value' in element) element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    try { element.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value || '') })); } catch (_) {}
}

function cardPageSetPrototypeValue(prototype, element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
}

function cardPageIsTypeableElement(element) {
    if (!element) return false;
    const tag = String(element.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
        return !['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'color', 'range']
            .includes(String(element.type || 'text').toLowerCase());
    }
    if (element.isContentEditable === true) return true;
    return ['textbox', 'searchbox', 'combobox'].includes(String(element.getAttribute?.('role') || '').toLowerCase());
}

function cardPageNormalizePayload(payload) {
    const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return {
        ...payload,
        type: cardPageNormalize(payload.type),
        selector: cardPageNormalize(payload.selector),
        text: cardPageNormalize(payload.text),
        waitForText: cardPageNormalize(payload.waitForText),
        waitForElementHidden: cardPageNormalize(payload.waitForElementHidden),
        waitForTextHidden: cardPageNormalize(payload.waitForTextHidden),
        timeoutMs: numberOr(payload.timeoutMs, 5000),
        intervalMs: numberOr(payload.intervalMs, 200),
        nth: payload.nth || 0
    };
}

async function cardPageClick(payload) {
    const element = await cardPageWaitForElement(payload, true);
    if (!element) return { success: false, error: `未找到可点击元素: ${payload.selector}`, code: 'ELEMENT_NOT_FOUND' };
    try { element.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    try { element.focus?.(); } catch (_) {}
    try { if (typeof window.__hsFx?.clickEl === 'function') await window.__hsFx.clickEl(element, 'left'); } catch (_) {}
    cardPageDispatchClickPreparation(element);
    try { element.click(); } catch (_) {
        return { success: false, error: `点击失败: ${payload.selector}`, code: 'CLICK_FAILED' };
    }
    return { success: true };
}

function cardPageDispatchClickPreparation(element) {
    try {
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        ['mouseover', 'mouseenter', 'mousedown', 'mouseup']
            .forEach((name) => element.dispatchEvent(new MouseEvent(name, eventOptions)));
    } catch (_) {}
}

async function cardPageType(payload) {
    const element = await cardPageWaitForElement(payload, true);
    if (!element) return { success: false, error: `未找到可输入元素: ${payload.selector}`, code: 'ELEMENT_NOT_FOUND' };
    if (!cardPageIsTypeableElement(element)) return cardPageUnsupportedTypeResult(element);
    try { element.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    try { element.focus(); } catch (_) {}
    try { if (typeof window.__hsFx?.typeEl === 'function') await window.__hsFx.typeEl(element); } catch (_) {}
    if (payload.clickBeforeType === true) cardPageClickBeforeType(element);
    if (payload.clearFirst === true) cardPageSetNativeValue(element, '');
    cardPageWriteText(element, payload.text);
    return { success: true };
}

function cardPageUnsupportedTypeResult(element) {
    const tag = String(element.tagName || '').toLowerCase();
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    return {
        success: false,
        error: `元素类型不支持 type 输入（tag=<${tag}> role="${role || 'none'}"），Card Runner 的 type 仅支持 <input type=text/search/email 等>、<textarea>、contenteditable 元素、role=textbox/searchbox。建议：更换 selector 到实际输入框，或改用 external_script 降级。`,
        code: 'UNSUPPORTED_ELEMENT_TYPE'
    };
}

function cardPageClickBeforeType(element) {
    try {
        element.focus?.();
        const options = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new MouseEvent('mouseover', options));
        element.dispatchEvent(new MouseEvent('mouseenter', options));
        element.click();
    } catch (_) {}
}

function cardPageWriteText(element, text) {
    if (!element.isContentEditable) return cardPageSetNativeValue(element, text);
    element.innerText = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

async function cardPageWait(payload) {
    if (payload.selector) return cardPageWaitForSelector(payload);
    if (payload.waitForText) return cardPageWaitForQuery(payload, `text=${payload.waitForText}`, true, `等待文本超时: ${payload.waitForText}`);
    if (payload.waitForElementHidden) return cardPageWaitForQuery(payload, payload.waitForElementHidden, false, `等待元素消失超时: ${payload.waitForElementHidden}`);
    if (payload.waitForTextHidden) return cardPageWaitForQuery(payload, `text=${payload.waitForTextHidden}`, false, `等待文本消失超时: ${payload.waitForTextHidden}`);
    await cardPageSleep(payload.timeoutMs);
    return { success: true };
}

async function cardPageWaitForSelector(payload) {
    const hidden = payload.hidden === true;
    const result = payload.singleProbe === true
        ? (hidden ? !cardPagePickElement(payload.selector, payload.nth) : cardPagePickElement(payload.selector, payload.nth))
        : await cardPageWaitForElement(payload, !hidden);
    if (result) return { success: true };
    const message = hidden ? `等待元素消失超时: ${payload.selector}` : `等待元素超时: ${payload.selector}`;
    return { success: false, error: message, code: 'WAIT_TIMEOUT' };
}

async function cardPageWaitForQuery(payload, selector, expectedVisible, message) {
    const probe = () => cardPageQueryElements(selector).some(cardPageIsVisible) === expectedVisible;
    if (payload.singleProbe === true) return probe()
        ? { success: true } : { success: false, error: message, code: 'WAIT_TIMEOUT' };
    const deadline = Date.now() + Math.max(0, payload.timeoutMs);
    while (Date.now() <= deadline) {
        if (probe()) return { success: true };
        await cardPageSleep(payload.intervalMs);
    }
    return { success: false, error: message, code: 'WAIT_TIMEOUT' };
}

function cardPageGetCredits(payload) {
    const element = payload.selector ? cardPagePickElement(payload.selector, payload.nth) : null;
    let value = cardPageReadElementText(element, payload.selector);
    if (!value && (!payload.selector || ['body', 'html'].includes(payload.selector))) value = cardPageCollectDocumentText(document);
    return { success: true, value: value || String(payload.defaultValue || payload.default || '0').trim() || '0' };
}

function cardPageReadElementText(element, selector) {
    if (!element) return '';
    const tagName = String(element.tagName || '').toLowerCase();
    let value = '';
    if (tagName === 'iframe') {
        try { value = cardPageCollectDocumentText(element.contentDocument || element.contentWindow?.document || null); } catch (_) {}
    }
    if (!value) value = `${element.innerText || element.textContent || element.value || ''}`.trim();
    if (!value && ['body', 'html', '*', 'document'].includes(selector)) value = cardPageCollectDocumentText(document);
    return value;
}

async function cardPageRunExternalScript(payload) {
    const script = String(payload.script || '').trim();
    if (!script) return { success: true };
    try {
        const result = await (new Function(`return (async () => { ${script} })();`))();
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error?.message || '脚本执行失败', code: 'SCRIPT_ERROR' };
    }
}

async function executeCardPageAction(rawPayload) {
    const payload = cardPageNormalizePayload(rawPayload || {});
    if (payload.type === 'click') return cardPageClick(payload);
    if (payload.type === 'type') return cardPageType(payload);
    if (payload.type === 'wait') return cardPageWait(payload);
    if (payload.type === 'get_credits') return cardPageGetCredits(payload);
    if (payload.type === 'external_script') return cardPageRunExternalScript(payload);
    if (payload.type === 'read_state') return { success: true, url: String(location.href || ''), title: String(document.title || '') };
    return { success: false, error: `不支持的动作: ${payload.type}`, code: 'UNSUPPORTED_ACTION' };
}

globalThis.__aiFreeExecuteCardPageAction = executeCardPageAction;
