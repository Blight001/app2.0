// content/observe.js — 页面观察与交互底座（browser_observe / browser_action / browser_wait 的执行核心）。
//
// 移植自 device/extension/src/content/{observe,dom,iframe,viewport,marks}.ts，力求与桌面浏览器扩展
// 的 browser_observe 功能一致（纯 JS，无 CDP/debugger，点击/输入/按键均为合成事件）：
//   · 扫描主文档 + 同源（含嵌套）iframe 内部 + Shadow DOM（开放 root；封闭 root 由 content/shadow-patch.js
//     在 document_start 的 MAIN world 强制转开放后可扫描）。
//   · 识别可交互控件（含 cursor:pointer / 类名或 ID 以 btn/button/link 结尾的自定义控件）、
//     img/video/audio 媒体元素、可见文本、iframe 边界。
//   · 返回 items 单一混排列表（按位置排序、已去重），interactive 项带 tag/selector + name/placeholder/ariaLabel 等基本信息，
//     同时提供临时 id 供 browser_action ref 使用（id 在下一次 browser_observe 前有效）；推荐用 selector/text 构造持久化卡片步骤。
//   · 默认绘制描边标记：绿色=可点击、红色=被遮挡/禁用/不可点、紫色虚线=iframe 边界。
//
// 与 content/fx.js 同样常驻内容脚本，把 API 幂等挂到 window.__hsObserve 上，供 background 用一次性
// chrome.scripting.executeScript(...).func 调用；window 在同一文档生命周期内持久，因此 observe 生成的
// id → 元素映射能被后续 browser_action 复用（并带自愈：节点被重渲染后按 selector/text/坐标重新定位）。
// observe 现返回元素基本信息，便于 AI 分析表单并为自动化卡片（create/modify）提供稳定定位器，不再依赖仅 id。

'use strict';

// ── 常量 ────────────────────────────────────────────────────────────────
var INTERACTIVE = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
    '[role="switch"]', '[role="option"]', '[contenteditable=""]', '[contenteditable="true"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])', 'summary', 'label[for]',
    '[aria-expanded]', '[aria-haspopup]', '[aria-controls]', '[aria-pressed]', '[aria-selected]',
    '[draggable="true"]'
].join(',');

var CONTROL = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    'summary', 'label[for]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
    '[role="switch"]', '[role="option"]', '[contenteditable=""]', '[contenteditable="true"]'
].join(',');

var MEDIA_SELECTOR = 'img,video,audio';
var TEXT_NODE_TAGS_TO_SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas']);

var FX_PREFIX = '__hs_ba_fx__';                 // content/fx.js 的视觉叠加元素 class 前缀
var MARK_LAYER_ID = '__hs_marks_layer';
var MARK_STYLE_ID = '__hs_marks_style';
var MARK_CHANGE_EVENTS = ['scroll', 'resize', 'hashchange', 'popstate', 'pagehide'];

var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

// ── 跨 realm 安全的类型判断（同源 iframe 内元素属于该 frame window 的 realm）────
function isElement(el) {
    return !!el && typeof el === 'object' && el.nodeType === 1;
}
function isHTMLElement(el) {
    if (el instanceof HTMLElement) return true;
    if (!isElement(el)) return false;
    const win = el.ownerDocument && el.ownerDocument.defaultView;
    return !!win && typeof win.HTMLElement === 'function' && el instanceof win.HTMLElement;
}
function isFrameElement(el) {
    if (!isElement(el)) return false;
    return el.tagName === 'IFRAME' || el.tagName === 'FRAME';
}
function ownerWindow(el) {
    return (el.ownerDocument && el.ownerDocument.defaultView) || window;
}
function computedStyle(el) {
    try { return ownerWindow(el).getComputedStyle(el); } catch (_error) { return null; }
}
function isOwnOverlay(el) {
    try {
        return !!(el.closest && el.closest(`[class*="${FX_PREFIX}"],#${MARK_LAYER_ID},#${MARK_STYLE_ID}`));
    } catch (_error) { return false; }
}

// ── iframe：递归扫描、多级坐标换算、穿透命中测试 ───────────────────────────
function clampX(x, win) { return Math.min(Math.max(x, 1), win.innerWidth - 1); }
function clampY(y, win) { return Math.min(Math.max(y, 1), win.innerHeight - 1); }

function isVisibleInOwnerViewport(el) {
    const s = computedStyle(el);
    if (!s || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    const win = ownerWindow(el);
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0
        && r.top <= win.innerHeight && r.left <= win.innerWidth;
}

function listIframeElementsIn(doc) {
    return Array.from(doc.querySelectorAll('iframe,frame'))
        .filter((el) => isFrameElement(el) && isVisibleInOwnerViewport(el));
}

function tryFrameContext(frameEl) {
    try {
        const doc = frameEl.contentDocument;
        if (!doc || !doc.documentElement) return null;
        return { frameEl, doc };
    } catch (_error) {
        return null;
    }
}

function scanRoot(doc) {
    return doc.body || doc.documentElement;
}

function buildFramePath(frame) {
    const path = [];
    let cur = frame;
    while (cur) { path.unshift(cur.frameSelector); cur = cur.parent; }
    return path;
}

function resolveFrameByPath(path) {
    if (!path || !path.length) return null;
    let doc = document;
    let parent;
    let resolved = null;
    for (const frameSelector of path) {
        const frameEl = doc.querySelector(frameSelector);
        if (!isFrameElement(frameEl)) return null;
        const base = tryFrameContext(frameEl);
        if (!base) return null;
        resolved = { ...base, frameSelector, parent };
        parent = resolved;
        doc = base.doc;
    }
    return resolved;
}

function resolveFrameBySelector(frameSelector, framePath) {
    const path = (framePath && framePath.length) ? framePath : (frameSelector ? [frameSelector] : []);
    return resolveFrameByPath(path);
}

function visitAccessibleFrames(onFrame, attachSelector, doc = document, parent) {
    for (const frameEl of listIframeElementsIn(doc)) {
        const base = tryFrameContext(frameEl);
        if (!base) continue;
        const ctx = { ...base, frameSelector: attachSelector(frameEl), parent };
        onFrame(ctx);
        visitAccessibleFrames(onFrame, attachSelector, base.doc, ctx);
    }
}

function getAccessibleFrames(attachSelector) {
    const out = [];
    visitAccessibleFrames((ctx) => out.push(ctx), attachSelector);
    return out;
}

// 把 frame 局部视口坐标累加各级 iframe 偏移，换算到顶层页面视口坐标。
function toTopViewportPoint(localX, localY, frame) {
    let x = localX;
    let y = localY;
    let cur = frame;
    while (cur) {
        const fr = cur.frameEl.getBoundingClientRect();
        x += fr.left; y += fr.top;
        cur = cur.parent;
    }
    return { x: Math.round(x), y: Math.round(y) };
}
function toTopViewportRect(local, frame) {
    const topLeft = toTopViewportPoint(local.left, local.top, frame);
    return { x: topLeft.x, y: topLeft.y, w: Math.round(local.width), h: Math.round(local.height) };
}
function toTopViewportCenter(local, frame) {
    return toTopViewportPoint(local.left + local.width / 2, local.top + local.height / 2, frame);
}
function elementViewportRect(el, frame) { return toTopViewportRect(el.getBoundingClientRect(), frame); }
function elementViewportCenter(el, frame) { return toTopViewportCenter(el.getBoundingClientRect(), frame); }

function hitAtPoint(doc, win, x, y, topX, topY, frame) {
    const lx = clampX(x, win);
    const ly = clampY(y, win);
    let hit = doc.elementFromPoint(lx, ly);
    if (!hit) return null;
    // 穿透 shadow root：elementFromPoint 返回 shadow host，实际绘制的内层元素需再取一次。
    while (hit.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(lx, ly);
        if (!inner || inner === hit) break;
        hit = inner;
    }
    if (hit.tagName === 'IFRAME' || hit.tagName === 'FRAME') {
        const frameEl = hit;
        const base = tryFrameContext(frameEl);
        const fr = frameEl.getBoundingClientRect();
        const childX = lx - fr.left;
        const childY = ly - fr.top;
        if (!base) return { el: frameEl, frame, localX: lx, localY: ly };
        const childWin = base.doc.defaultView || win;
        const childCtx = { ...base, frameSelector: '', parent: frame };
        const deeper = hitAtPoint(base.doc, childWin, childX, childY, topX, topY, childCtx);
        if (deeper) return deeper;
        return { el: frameEl, frame: childCtx, localX: childX, localY: childY };
    }
    return { el: hit, frame, localX: lx, localY: ly };
}
function hitTargetAtViewport(x, y) {
    const vx = clampX(x, window);
    const vy = clampY(y, window);
    return hitAtPoint(document, window, vx, vy, vx, vy);
}

function isTopmostAtViewport(el, viewportX, viewportY) {
    const hit = hitTargetAtViewport(viewportX, viewportY);
    if (!hit) return false;
    const target = hit.el;
    if (target === el) return true;
    if (target.ownerDocument === el.ownerDocument) {
        return el.contains(target) || target.contains(el);
    }
    return false;
}

function isFrameChainVisible(frame) {
    let cur = frame;
    while (cur) { if (!isVisibleInOwnerViewport(cur.frameEl)) return false; cur = cur.parent; }
    return true;
}
function isCenterOnMainViewport(frame, el) {
    const center = elementViewportCenter(el, frame);
    return center.x >= 0 && center.y >= 0 && center.x <= window.innerWidth && center.y <= window.innerHeight;
}

function isHittableInViewport(el, frame) {
    if (!isVisibleInOwnerViewport(el)) return false;
    if (frame && !isFrameChainVisible(frame)) return false;
    const s = computedStyle(el);
    if (s && s.pointerEvents === 'none') return false;
    const local = el.getBoundingClientRect();
    const sampleLocal = [
        [local.left + local.width / 2, local.top + local.height / 2],
        [local.left + local.width / 2, local.top + Math.min(local.height * 0.2, 6)],
        [local.left + local.width * 0.2, local.top + local.height / 2],
        [local.left + local.width * 0.8, local.top + local.height / 2]
    ];
    const pts = frame
        ? sampleLocal.map(([lx, ly]) => { const p = toTopViewportPoint(lx, ly, frame); return [p.x, p.y]; })
        : sampleLocal;
    return pts.some(([px, py]) => isTopmostAtViewport(el, px, py));
}

function isLikelyInteractableInFrame(el, frame) {
    if (!isVisibleInOwnerViewport(el)) return false;
    if (!isFrameChainVisible(frame)) return false;
    const s = computedStyle(el);
    if (s && s.pointerEvents === 'none') return false;
    if (!isCenterOnMainViewport(frame, el)) return false;
    if (isHittableInViewport(el, frame)) return true;
    const center = elementViewportCenter(el, frame);
    const hit = hitTargetAtViewport(center.x, center.y);
    if (!hit) return false;
    if (hit.el.ownerDocument === el.ownerDocument) {
        return hit.el === el || el.contains(hit.el) || hit.el.contains(el);
    }
    return true;
}

function occluderAtViewport(el, frame) {
    const center = elementViewportCenter(el, frame);
    const hit = hitTargetAtViewport(center.x, center.y);
    if (!hit) return null;
    const cover = hit.el;
    if (cover === el) return null;
    if (cover.ownerDocument === el.ownerDocument && (el.contains(cover) || cover.contains(el))) return null;
    return cover;
}

// ── DOM 辅助 ─────────────────────────────────────────────────────────────
function isVisible(el) {
    if (!el || !isHTMLElement(el)) return false;
    if (isOwnOverlay(el)) return false;
    const s = computedStyle(el);
    if (!s || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    const win = ownerWindow(el);
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0
        && r.top <= win.innerHeight && r.left <= win.innerWidth;
}

function isHittable(el, frame) { return isHittableInViewport(el, frame); }

function textOf(el, max = 200) {
    const parts = [
        el.innerText, el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title'), el.value, el.placeholder, el.textContent
    ];
    for (const part of parts) {
        const t = String(part || '').replace(/\s+/g, ' ').trim();
        if (t) return t.slice(0, max);
    }
    return '';
}

function elementArea(el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
}

function elCenter(el) {
    const win = ownerWindow(el);
    const r = el.getBoundingClientRect();
    return {
        x: Math.min(Math.max(r.left + r.width / 2, 1), win.innerWidth - 1),
        y: Math.min(Math.max(r.top + r.height / 2, 1), win.innerHeight - 1)
    };
}

// ── selector 构建（自愈式 ref 复查）───────────────────────────────────────
function selectorResolvesTo(selector, el) {
    try {
        const hits = el.ownerDocument.querySelectorAll(selector);
        return hits.length === 1 && hits[0] === el;
    } catch (_error) { return false; }
}
function stableAttrSelector(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    if (id && selectorResolvesTo(`#${CSS.escape(id)}`, el)) return `#${CSS.escape(id)}`;
    for (const attr of ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy', 'name', 'aria-label']) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const sel = `${tag}[${attr}="${CSS.escape(value)}"]`;
        if (selectorResolvesTo(sel, el)) return sel;
    }
    return '';
}
function cssPath(el) {
    if (!isElement(el)) return '';
    const attrSel = stableAttrSelector(el);
    if (attrSel) return attrSel;
    const segment = (node) => {
        const tag = node.tagName.toLowerCase();
        if (node.id) return `#${CSS.escape(node.id)}`;
        const cls = String(node.className || '').split(/\s+/).filter(Boolean).slice(0, 2)
            .map((c) => `.${CSS.escape(c)}`).join('');
        const parent = node.parentElement;
        const same = parent ? Array.from(parent.children).filter((c) => c.tagName === node.tagName) : [];
        const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : '';
        return `${tag}${cls}${nth}`;
    };
    const parts = [];
    let cur = el;
    const root = el.ownerDocument.documentElement;
    while (cur && cur !== root && parts.length < 12) {
        parts.unshift(segment(cur));
        const path = parts.join(' > ');
        if (selectorResolvesTo(path, el)) return path;
        if (cur.id) break;
        cur = cur.parentElement;
    }
    return parts.length ? parts.join(' > ') : el.tagName.toLowerCase();
}

function clickableAncestor(el) {
    return el.closest('button,a,[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex]') || el;
}
function textMatches(el, text, exact = false) {
    const target = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!target) return false;
    const haystack = [
        el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'),
        el.value, el.getAttribute('placeholder')
    ].map((v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
    return haystack.some((v) => (exact ? v === target : (v === target || v.includes(target))));
}
function findElInDocument(doc, selector, text, frame) {
    if (selector) {
        const matches = Array.from(doc.querySelectorAll(selector));
        return matches.find((el) => isHittable(el, frame)) || matches.find(isVisible) || matches[0] || null;
    }
    if (text) {
        const preferred = Array.from(doc.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]'));
        const byPreferred = (pred, exact) => preferred.find((el) => pred(el) && textMatches(el, text, exact));
        const byWalk = (pred, exact) => {
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
            while (walker.nextNode()) {
                const el = walker.currentNode;
                if (pred(el) && textMatches(el, text, exact)) return clickableAncestor(el);
            }
            return null;
        };
        for (const pred of [isHittable, isVisible]) {
            const hit = byPreferred(pred, true) || byPreferred(pred, false) || byWalk(pred, true) || byWalk(pred, false);
            if (hit) return hit;
        }
    }
    return null;
}
function findElInAccessibleFrames(selector, text) {
    let hit = null;
    visitAccessibleFrames((ctx) => { if (hit) return; hit = findElInDocument(ctx.doc, selector, text, ctx); }, (el) => cssPath(el));
    return hit;
}
function findEl(selector, text, frameSelector, framePath) {
    const frame = resolveFrameBySelector(frameSelector, framePath);
    if (frame) return findElInDocument(frame.doc, selector, text, frame);
    const top = findElInDocument(document, selector, text);
    if (top) return top;
    return findElInAccessibleFrames(selector, text);
}

// ── marks 存储（observe 写入，browser_action 读取，含自愈）─────────────────
