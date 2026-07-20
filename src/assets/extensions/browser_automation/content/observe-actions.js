async function playFx(el, variant) {
    if (window.__hsFx && typeof window.__hsFx.clickEl === 'function') {
        try { await window.__hsFx.clickEl(el, variant); } catch (_error) { /* visual-only */ }
    }
}

// ── browser_action 成功回执：附可直接写入自动化卡片的 cardStep ─────────────
// 探索（browser_action）→ 固化（manage_card write）不再需要人工翻译 selector：
// 成功后带回与卡片规范同构的步骤对象，selector 用 cssPath（优先稳定属性选择器）。
// 卡片 runner 只在主文档查找元素，iframe 内元素以 inFrame + note 提醒不可直接写入。
function cardStepReceipt(el, frame, stepType, extra = {}) {
    try {
        const selector = cssPath(el);
        if (!selector) return {};
        const attr = (name) => String((el.getAttribute && el.getAttribute(name)) || '').trim();
        const label = textOf(el, 30) || attr('aria-label') || attr('placeholder') || attr('name') || el.tagName.toLowerCase();
        const prefix = stepType === 'click' ? '点击' : stepType === 'type' ? '输入' : '操作';
        const out = { cardStep: { name: `${prefix} ${label}`.trim().slice(0, 50), type: stepType, selector, ...extra } };
        if (frame) {
            out.cardStep.inFrame = true;
            out.cardStepNote = '元素在 iframe 内：卡片 runner 只查主文档，此 selector 直接写入卡片将找不到元素（可考虑 navigate 直达 iframe 的 src，或改用 external_script）。';
        }
        return out;
    } catch (_error) {
        return {};
    }
}

// ── browser_action：click / double_click / right_click ───────────────────
function dispatchClickSequence(el, center, opts = {}) {
    const win = ownerWindow(el);
    const button = opts.button === 'right' ? 2 : opts.button === 'middle' ? 1 : 0;
    const buttons = opts.button === 'right' ? 2 : opts.button === 'middle' ? 4 : 1;
    const base = { bubbles: true, cancelable: true, view: win, clientX: center.x, clientY: center.y, button };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    // Full hover + enter before press (ensure sites see hover state)
    el.dispatchEvent(new PointerEvent('pointerover', pointer));
    el.dispatchEvent(new PointerEvent('pointerenter', pointer));
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new MouseEvent('mouseenter', base));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    if (opts.button === 'right') {
        el.dispatchEvent(new MouseEvent('contextmenu', base));
    } else {
        el.dispatchEvent(new MouseEvent('click', base));
        try { el.click(); } catch (_error) { /* some elements reject synthetic .click() */ }
    }
}

function validateClickTarget(el, frame, msg, viaCoords) {
    if (viaCoords) return null;
    if (!isVisible(el)) {
        return { success: false, not_visible: true, code: 'NOT_VISIBLE',
            error: '目标元素存在于 DOM 中，但当前不可见（display:none / 尺寸为 0 / 在视口外）。',
            tag: el.tagName.toLowerCase(), text: textOf(el, 80) };
    }
    if (msg.force || isHittable(el, frame)) return null;
    const cover = occluderAtViewport(el, frame);
    return { success: false, occluded: true, code: 'OCCLUDED',
        error: '目标元素当前被遮挡或不在可视区域内，可能需要先关闭遮挡层；确认要穿透点击请传 force:true',
        occluderTag: cover ? String(cover.tagName || '').toLowerCase() : '' };
}

function dispatchClickVariant(el, center, variant) {
    if (variant === 'double') {
        dispatchClickSequence(el, center, {});
        dispatchClickSequence(el, center, {});
        el.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true, cancelable: true, view: ownerWindow(el), clientX: center.x, clientY: center.y
        }));
        return;
    }
    dispatchClickSequence(el, center, variant === 'right' ? { button: 'right' } : {});
}

async function clickLikeUser(msg = {}, variant = 'left') {
    const resolved = resolveTarget(msg);
    const el = resolved.el;
    if (!el) return { success: false, error: '未找到目标元素（ref/selector/text/坐标均未命中）', code: 'TARGET_NOT_FOUND' };
    const frame = resolved.frame;

    const viaCoords = msg.x !== undefined && msg.y !== undefined
        && (msg.ref === undefined || msg.ref === null || msg.ref === '');

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_error) { /* ignore */ }

    const validationError = validateClickTarget(el, frame, msg, viaCoords);
    if (validationError) return validationError;

    const center = elCenter(el);
    // Always focus the element for clicks (required by many form/controls)
    try { el.focus(); } catch (_error) { /* ignore */ }
    // Hover visual (hand cursor glide + ripples) + hover events (in dispatch)
    await playFx(el, variant === 'right' ? 'right' : variant === 'double' ? 'double' : 'left');

    dispatchClickVariant(el, center, variant);

    const ctx = viewportContext();
    return {
        success: true, tag: el.tagName.toLowerCase(), text: textOf(el, 100), center,
        position: { scrollY: ctx.scrollY, scrollPercent: ctx.scrollPercent, currentSection: ctx.currentSection },
        ...(variant === 'left' ? cardStepReceipt(el, frame, 'click') : {})
    };
}

// ── browser_action：type ──────────────────────────────────────────────────
function setNativeValue(el, value) {
    const win = ownerWindow(el);
    const tag = String(el && el.tagName || '').toLowerCase();
    let proto = null;
    if (tag === 'textarea') {
        proto = win.HTMLTextAreaElement.prototype;
    } else if (tag === 'input') {
        proto = win.HTMLInputElement.prototype;
    }
    if (proto) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, value);
        else el.value = value;
    } else if ('value' in el) {
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value || '') })); } catch (_) {}
}

function isTypeableElement(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
        const t = String(el.type || 'text').toLowerCase();
        const blocked = ['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'color', 'range'];
        return !blocked.includes(t);
    }
    if (el.isContentEditable === true) return true;
    const role = String(el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
    return false;
}

function typeIntoElement(el, text, clearFirst) {
    if (el.isContentEditable) {
        el.innerText = clearFirst ? text : `${el.innerText || ''}${text}`;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return;
    }
    setNativeValue(el, clearFirst ? text : `${el.value || ''}${text}`);
}

function submitTypedElement(el) {
    const form = el.closest ? el.closest('form') : null;
    if (form && typeof form.requestSubmit === 'function') {
        try { form.requestSubmit(); return true; } catch (_error) {
            try { form.submit(); return true; } catch (_error2) { return false; }
        }
    }
    const win = ownerWindow(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, view: win }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, view: win }));
    return false;
}

async function typeInto(msg = {}) {
    const resolved = resolveTarget(msg);
    const el = resolved.el;
    if (!el) return { success: false, error: '未找到目标输入元素', code: 'TARGET_NOT_FOUND' };

    if (!isTypeableElement(el)) {
        const tag = String(el.tagName || '').toLowerCase();
        const role = String(el.getAttribute && el.getAttribute('role') || '').toLowerCase();
        return {
            success: false,
            error: `元素类型不支持 type（tag=<${tag}> role="${role || 'none'}"），仅支持 input/textarea/contenteditable/role=textbox 等`,
            code: 'UNSUPPORTED_ELEMENT_TYPE'
        };
    }

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_error) { /* ignore */ }
    await playFx(el, 'left');
    try { el.focus(); } catch (_error) { /* ignore */ }

    const text = msg.text != null ? String(msg.text) : '';
    const clearFirst = msg.clear_first !== false;

    typeIntoElement(el, text, clearFirst);

    const submitted = msg.submit ? submitTypedElement(el) : false;

    return {
        success: true, tag: el.tagName.toLowerCase(), submitted,
        ...cardStepReceipt(el, resolved.frame, 'type', { text })
    };
}

// ── browser_action：press_key ─────────────────────────────────────────────
var SPECIAL_KEYS = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Return: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    Home: { key: 'Home', code: 'Home', keyCode: 36 },
    End: { key: 'End', code: 'End', keyCode: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
    ' ': { key: ' ', code: 'Space', keyCode: 32 }
};
for (let i = 1; i <= 12; i += 1) SPECIAL_KEYS[`F${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

function keyInfo(raw) {
    const value = String(raw || '');
    if (SPECIAL_KEYS[value]) return SPECIAL_KEYS[value];
    if (/^[a-z]$/i.test(value)) {
        const upper = value.toUpperCase();
        return { key: value, code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
    }
    if (/^[0-9]$/.test(value)) return { key: value, code: `Digit${value}`, keyCode: value.charCodeAt(0) };
    return { key: value, code: value, keyCode: 0 };
}

async function pressKey(msg = {}) {
    let target = document.activeElement;
    if (msg.selector) {
        const found = findEl(msg.selector);
        if (found) { try { found.focus(); } catch (_error) { /* ignore */ } target = found; }
    } else if (msg.ref !== undefined) {
        const resolved = resolveTarget(msg);
        if (resolved.el) { try { resolved.el.focus(); } catch (_error) { /* ignore */ } target = resolved.el; }
    }
    if (!target || target === document.documentElement) target = document.body;

    const info = keyInfo(msg.key);
    const win = ownerWindow(target);
    const base = {
        key: info.key, code: info.code, keyCode: info.keyCode, which: info.keyCode,
        ctrlKey: !!msg.ctrl, shiftKey: !!msg.shift, altKey: !!msg.alt, metaKey: !!msg.meta,
        bubbles: true, cancelable: true, view: win
    };
    target.dispatchEvent(new KeyboardEvent('keydown', base));
    target.dispatchEvent(new KeyboardEvent('keypress', base));
    target.dispatchEvent(new KeyboardEvent('keyup', base));

    let submitted = false;
    if (info.key === 'Enter') {
        const form = target.closest ? target.closest('form') : null;
        if (form && typeof form.requestSubmit === 'function') {
            try { form.requestSubmit(); submitted = true; } catch (_error) { /* ignore */ }
        }
    }
    return { success: true, key: info.key, code: info.code, submitted, method: 'synthetic.KeyboardEvent' };
}

// ── browser_action：scroll ────────────────────────────────────────────────
async function scrollPage(msg = {}) {
    const amount = Number(msg.amount) || 400;
    const direction = String(msg.direction || 'down');
    if (window.__hsFx && typeof window.__hsFx.scrollDrag === 'function') {
        try { await window.__hsFx.scrollDrag(direction, amount); } catch (_error) { /* visual-only */ }
    }
    const before = { x: window.scrollX, y: window.scrollY };
    if (msg.selector) {
        const el = findEl(msg.selector);
        if (el) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_error) { /* ignore */ } }
    } else if (direction === 'top') {
        window.scrollTo({ top: 0, left: window.scrollX });
    } else if (direction === 'bottom') {
        window.scrollTo({ top: document.documentElement.scrollHeight, left: window.scrollX });
    } else if (direction === 'up') {
        window.scrollBy(0, -amount);
    } else {
        window.scrollBy(0, amount);
    }
    const after = { x: window.scrollX, y: window.scrollY };
    const ctx = viewportContext();
    return {
        success: true, direction, amount, before, after,
        moved: Math.round(Math.hypot(after.x - before.x, after.y - before.y)),
        scroll: { y: ctx.scrollY, percent: ctx.scrollPercent, atTop: ctx.atTop, atBottom: ctx.atBottom },
        currentSection: ctx.currentSection
    };
}

// ── browser_wait ──────────────────────────────────────────────────────────
async function waitFor(msg = {}) {
    const selector = String(msg.selector || '').trim();
    const ms = Number(msg.ms);
    if (selector) {
        const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 10000;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
            const el = document.querySelector(selector);
            if (el && isVisible(el)) {
                return {
                    success: true, selector,
                    cardStep: { name: `等待 ${selector}`.slice(0, 50), type: 'wait', selector, timeout: timeoutMs }
                };
            }
            await sleep(150);
        }
        return { success: false, error: `等待元素超时: ${selector}`, selector };
    }
    const waitMs = Number.isFinite(ms) && ms > 0 ? ms : 1000;
    await sleep(waitMs);
    return { success: true, waitedMs: waitMs };
}

window.__hsObserve = {
    __installed: true,
    scan,
    click: clickLikeUser,
    type: typeInto,
    pressKey,
    scroll: scrollPage,
    wait: waitFor
};
