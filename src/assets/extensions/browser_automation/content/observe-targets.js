var marks = [];
function setMarks(items) { marks = items.slice(); }
function getMarkTarget(ref) {
    const i = Number(ref);
    if (!Number.isFinite(i) || i < 1 || i > marks.length) return null;
    return marks[i - 1] || null;
}

function resolveTarget(msg = {}) {
    const byEl = (el, frame) => { const c = elCenter(el); return { el, x: c.x, y: c.y, frame }; };
    const hasRef = msg.ref !== undefined && msg.ref !== null && msg.ref !== '';
    const marked = hasRef ? resolveMarkedTarget(msg.ref, byEl) : null;
    if (marked) return marked;
    const selected = resolveSelectedTarget(msg, byEl);
    if (selected) return selected;
    if (msg.x !== undefined && msg.y !== undefined) {
        return resolveCoordinateTarget(Number(msg.x), Number(msg.y));
    }
    const fallback = hasRef ? resolveMarkedCenter(msg.ref) : null;
    if (fallback) return fallback;
    return { el: null, x: 0, y: 0 };
}

function resolveMarkedTarget(ref, byEl) {
    const mark = getMarkTarget(ref);
    if (!mark) return null;
    const frame = resolveFrameBySelector(mark.frameSelector, mark.framePath);
    if (mark.el?.isConnected) return byEl(mark.el, frame || undefined);
    const healed = findEl(mark.selector, mark.text, mark.frameSelector, mark.framePath);
    return healed ? byEl(healed, frame || undefined) : null;
}

function resolveSelectedTarget(msg, byEl) {
    if (!msg.selector && !msg.text) return null;
    const el = findEl(msg.selector, msg.text, msg.frame, msg.frame_path);
    const frame = resolveFrameBySelector(msg.frame, msg.frame_path);
    return el ? byEl(el, frame || undefined) : null;
}

function resolveCoordinateTarget(x, y) {
    const hit = hitTargetAtViewport(x, y);
    return hit ? { el: hit.el, x: hit.localX, y: hit.localY, frame: hit.frame } : { el: null, x, y };
}

function resolveMarkedCenter(ref) {
    const center = getMarkTarget(ref)?.center;
    return center ? resolveCoordinateTarget(center.x, center.y) : null;
}

// ── 视口位置上下文 ─────────────────────────────────────────────────────────
function viewportContext() {
    const doc = document.documentElement;
    const scrollY = Math.round(window.scrollY);
    const scrollX = Math.round(window.scrollX);
    const innerH = window.innerHeight;
    const scrollHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const maxScroll = Math.max(0, scrollHeight - innerH);
    const scrollPercent = maxScroll > 0 ? Math.round((scrollY / maxScroll) * 100) : 100;
    const atTop = scrollY <= 2;
    const atBottom = scrollY >= maxScroll - 2;
    let currentSection = '';
    for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4'))) {
        const r = h.getBoundingClientRect();
        const txt = (h.innerText || '').trim().slice(0, 120);
        if (!txt) continue;
        if (r.top <= 90) currentSection = txt;
    }
    return { scrollX, scrollY, scrollHeight, maxScroll, scrollPercent, atTop, atBottom, currentSection };
}

// ── 角色 / 类别判定 ────────────────────────────────────────────────────────
function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
        const t = el.type;
        if (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit') return t;
        return 'textbox';
    }
    return '';
}

// 自定义控件（div/span + 框架 click 监听）常无 role/onclick/tabindex，甚至无 cursor:pointer，
// 最后手段是读其自身 class/id：以 button/btn/link 结尾的 token 是强作者提示。要求在 token 边界末尾，
// 从而 “edit-text-button-text”（以 -text 结尾）不误命中，而真正的 “edit-text-button” 命中。
var NAME_ROLE_PATTERNS = [
    { re: /(^|[-_])(btn|button)$/i, category: 'button' },
    { re: /(^|[-_])link$/i, category: 'link' }
];
function nameRole(el) {
    if (!isHTMLElement(el)) return '';
    const tokens = [...String(el.className || '').split(/\s+/), el.id || ''].filter(Boolean);
    for (const token of tokens) {
        for (const { re, category } of NAME_ROLE_PATTERNS) {
            if (re.test(token)) return category;
        }
    }
    return '';
}

function elementCategory(el) {
    const tag = el.tagName.toLowerCase();
    const role = String(el.getAttribute('role') || '').toLowerCase();
    const semantic = semanticElementCategory(tag, role);
    if (semantic) return semantic;
    if (tag === 'input') return inputElementCategory(el);
    if (el.matches && el.matches('[contenteditable=""],[contenteditable="true"]')) return 'input';
    const roleCategory = roleElementCategory(role, tag);
    if (roleCategory) return roleCategory;
    return nameRole(el) || 'other';
}

function semanticElementCategory(tag, role) {
    if (tag === 'img' || role === 'img') return 'image';
    if (['video', 'audio'].includes(tag)) return tag;
    if (tag === 'textarea') return 'input';
    if (tag === 'select' || ['combobox', 'listbox'].includes(role)) return 'select';
    return '';
}

function inputElementCategory(el) {
    const type = String(el.type || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (['checkbox', 'radio'].includes(type)) return type;
    return 'input';
}

function roleElementCategory(role, tag) {
    if (['textbox', 'searchbox'].includes(role)) return 'input';
    if (role === 'button' || ['button', 'summary'].includes(tag)) return 'button';
    if (role === 'link' || tag === 'a') return 'link';
    if (['checkbox', 'switch'].includes(role)) return 'checkbox';
    if (['radio', 'tab', 'option'].includes(role)) return role;
    if (['menuitem', 'menuitemcheckbox', 'menuitemradio'].includes(role)) return 'menuitem';
    return tag === 'label' ? 'label' : '';
}

// ── filter / tag / keyword 解析 ────────────────────────────────────────────
var FILTER_ALIASES = {
    button: 'button', buttons: 'button', btn: 'button',
    link: 'link', links: 'link', anchor: 'link', a: 'link',
    input: 'input', inputs: 'input', textbox: 'input', textfield: 'input', textarea: 'input', editable: 'input',
    select: 'select', selects: 'select', dropdown: 'select', combobox: 'select', combo: 'select',
    checkbox: 'checkbox', checkboxes: 'checkbox', check: 'checkbox', toggle: 'checkbox', switch: 'checkbox',
    radio: 'radio', radios: 'radio',
    tab: 'tab', tabs: 'tab',
    menuitem: 'menuitem', menu: 'menuitem', menuitems: 'menuitem',
    option: 'option', options: 'option',
    label: 'label', labels: 'label',
    image: 'image', images: 'image', img: 'image', imgs: 'image', picture: 'image', pictures: 'image',
    video: 'video', videos: 'video',
    audio: 'audio', audios: 'audio',
    media: 'media',
    text: 'text', texts: 'text', 'text-element': 'text',
    frame: 'frame', frames: 'frame', iframe: 'frame', iframes: 'frame',
    interactive: 'interactive', interactives: 'interactive', clickable: 'interactive', control: 'interactive', controls: 'interactive',
    all: 'all', any: 'all', '*': 'all'
};
function normalizeFilterToken(raw) { return FILTER_ALIASES[String(raw).trim().toLowerCase()] || ''; }
function parseFilter(raw) {
    if (raw == null) return null;
    const parts = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,\s]+/);
    const out = new Set();
    for (const part of parts) {
        const token = normalizeFilterToken(part);
        if (token === 'all') return null;
        if (token) out.add(token);
    }
    return out.size ? out : null;
}
function interactiveCategoryAllowed(category, filter) {
    if (!filter) return true;
    return filter.has('interactive') || filter.has(category);
}
function mediaCategoryAllowed(category, filter) {
    if (!filter) return true;
    return filter.has('media') || filter.has(category);
}
function parseStringList(raw) {
    if (raw == null) return [];
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
    return parts.map((p) => String(p || '').trim()).filter(Boolean);
}
function parseTagFilter(raw) {
    const tags = parseStringList(raw).map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
    return tags.length ? new Set(tags) : null;
}
function parseKeyword(raw) { return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().toLowerCase(); }

function elementSearchText(el, fallback = '') {
    const parts = [
        fallback, textOf(el, 240),
        el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.getAttribute('alt') || '',
        el.getAttribute('placeholder') || '', el.getAttribute('name') || '', el.id || '',
        el.getAttribute('src') || '', el.getAttribute('href') || ''
    ];
    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function matchesElementFilters(el, tagFilter, keyword, fallbackText = '') {
    if (tagFilter && !tagFilter.has(el.tagName.toLowerCase())) return false;
    if (keyword && !elementSearchText(el, fallbackText).includes(keyword)) return false;
    return true;
}

function isDisabled(el) {
    return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
        || el.closest('[disabled],[aria-disabled="true"]') !== null;
}
function hasInteractiveSemantics(el) {
    if (!isHTMLElement(el) || isDisabled(el)) return false;
    if (el.matches(INTERACTIVE)) return true;
    if (nameRole(el)) return true;
    const s = computedStyle(el);
    return !!s && s.cursor === 'pointer';
}
function isInsideInteractive(el) {
    const stop = el.ownerDocument.body || el.ownerDocument.documentElement;
    let cur = el;
    while (cur && cur !== stop) {
        if (hasInteractiveSemantics(cur)) return true;
        cur = cur.parentElement;
    }
    return false;
}
function isStrongControl(el) {
    return el.matches('a[href],button,input:not([type="hidden"]),select,textarea,summary,label[for],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="switch"],[contenteditable=""],[contenteditable="true"]');
}

// ── 扫描根枚举（含 Shadow DOM）─────────────────────────────────────────────
function enumerateScanRoots(root) {
    const doc = root.ownerDocument || document;
    const roots = [root];
    const seen = new Set([root]);
    const add = (node) => { if (!node || seen.has(node)) return; seen.add(node); roots.push(node); };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) { add(walker.currentNode.shadowRoot); }
    return roots;
}

function collectCandidatesIn(root, frame) {
    const out = [];
    const seen = new Set();
    const add = (el) => {
        if (!isHTMLElement(el) || seen.has(el)) return;
        seen.add(el);
        if (hasInteractiveSemantics(el) && isVisible(el)) out.push({ el, frame });
    };
    for (const sr of enumerateScanRoots(root)) {
        sr.querySelectorAll(INTERACTIVE).forEach(add);
        const walker = (sr.ownerDocument || document).createTreeWalker(sr, NodeFilter.SHOW_ELEMENT);
        let scanned = 0;
        while (walker.nextNode() && scanned < 6000) { scanned += 1; add(walker.currentNode); }
    }
    return out;
}

function scanScopes(scopeFrame) {
    if (!scopeFrame) {
        return [{ doc: document }, ...getAccessibleFrames(cssPath).map((ctx) => ({ doc: ctx.doc, frame: ctx }))];
    }
    const scopes = [{ doc: scopeFrame.doc, frame: scopeFrame }];
    visitAccessibleFrames((ctx) => scopes.push({ doc: ctx.doc, frame: ctx }), cssPath, scopeFrame.doc, scopeFrame);
    return scopes;
}

function collectCandidates(scopes) {
    const accessibleFrames = new Set(scopes.map((s) => s.frame && s.frame.frameEl).filter(Boolean));
    const all = [];
    for (const scope of scopes) all.push(...collectCandidatesIn(scanRoot(scope.doc), scope.frame));
    return all.filter((item) => !(isFrameElement(item.el) && accessibleFrames.has(item.el)));
}

// ── 文本收集 ───────────────────────────────────────────────────────────────
function textRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'label') return 'label';
    if (tag === 'li') return 'listitem';
    if (tag === 'th' || tag === 'td') return 'cell';
    if (tag === 'p') return 'paragraph';
    return 'text';
}
function rectInfo(r) { return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }
function centerInfo(r) { return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }

function isUsableTextRect(parent, r, frame) {
    if (r.width <= 0 || r.height <= 0) return false;
    const center = frame ? elementViewportCenter(parent, frame) : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (center.y < 0 || center.x < 0 || center.y > window.innerHeight || center.x > window.innerWidth) return false;
    if (frame) return isVisibleInOwnerViewport(parent) && isFrameChainVisible(frame) && isCenterOnMainViewport(frame, parent);
    return isTopmostAtViewport(parent, center.x, center.y);
}

function collectVisibleTextsIn(root, limit, frame) {
    const out = [];
    const seen = new Set();
    const doc = root.ownerDocument || document;
    const walkText = (sr) => {
        const walker = doc.createTreeWalker(sr, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent || TEXT_NODE_TAGS_TO_SKIP.has(parent.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
                if (!isVisible(parent) || isInsideInteractive(parent)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let scanned = 0;
        while (walker.nextNode() && out.length < limit && scanned < 8000) {
            scanned += 1;
            const node = walker.currentNode;
            const parent = node.parentElement;
            if (!parent || !isVisible(parent)) continue;
            const text = String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
            if (!text) continue;
            const range = doc.createRange();
            range.selectNodeContents(node);
            const rects = Array.from(range.getClientRects());
            range.detach();
            const rect = rects.find((r) => isUsableTextRect(parent, r, frame));
            if (!rect) continue;
            const selector = cssPath(parent);
            const viewportRect = frame ? elementViewportRect(parent, frame) : rectInfo(rect);
            const viewportCenter = frame ? elementViewportCenter(parent, frame) : centerInfo(rect);
            const rectKey = `${Math.round(viewportRect.x / 4)}:${Math.round(viewportRect.y / 4)}:${Math.round(viewportRect.w / 4)}:${Math.round(viewportRect.h / 4)}`;
            const key = `${selector}|${text}|${rectKey}|${(frame && frame.frameSelector) || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                kind: 'text', role: textRole(parent), tag: parent.tagName.toLowerCase(), text, selector,
                center: viewportCenter, rect: viewportRect,
                ...(frame ? { inFrame: true, frameSelector: frame.frameSelector, framePath: buildFramePath(frame) } : {})
            });
        }
    };
    for (const sr of enumerateScanRoots(root)) { walkText(sr); if (out.length >= limit) break; }
    return out;
}
function collectVisibleTexts(limit, scopes) {
    const out = [];
    for (const scope of scopes) {
        for (const item of collectVisibleTextsIn(scanRoot(scope.doc), limit, scope.frame)) {
            out.push(item);
            if (out.length >= limit) return out;
        }
    }
    return out;
}

// ── 被遮挡/禁用控件（红色标记）─────────────────────────────────────────────
function collectBlockedCandidates(all, hittableSet, scopes) {
    const out = [];
    const seen = new Set();
    const add = (el) => {
        if (!isNewBlockedCandidate(el, seen, hittableSet)) return;
        seen.add(el);
        if (isVisible(el) && (isDisabled(el) || el.matches(CONTROL) || el.matches(INTERACTIVE))) out.push(el);
    };
    all.forEach((item) => add(item.el));
    for (const scope of scopes) scanRoot(scope.doc).querySelectorAll(CONTROL).forEach(add);
    return out;
}

function isNewBlockedCandidate(el, seen, hittableSet) {
    return isHTMLElement(el) && !seen.has(el) && !hittableSet.has(el);
}

// ── iframe 边界条目 ────────────────────────────────────────────────────────
function collectFrameItems(scopeFrame) {
    const items = [];
    const overlay = [];
    visitFrameItems(scopeFrame?.doc || document, scopeFrame || null, items, overlay);
    return { items, overlay };
}

function visitFrameItems(doc, parentFrame, items, overlay) {
    for (const el of listIframeElementsIn(doc)) {
        const entry = buildFrameItem(el, parentFrame);
        items.push(entry.item);
        overlay.push({ el, frame: parentFrame });
        if (entry.context) visitFrameItems(entry.context.doc, entry.context, items, overlay);
    }
}

function buildFrameItem(el, parentFrame) {
    const base = tryFrameContext(el);
    const geometry = resolveFrameItemGeometry(el, parentFrame);
    const selector = cssPath(el);
    const context = base ? { ...base, frameSelector: selector, parent: parentFrame } : null;
    const { src, name } = getFrameItemAttributes(el);
    const title = context?.doc?.title || '';
    const label = title || name || src || 'iframe';
    const framePath = context
        ? buildFramePath(context)
        : [...(parentFrame ? buildFramePath(parentFrame) : []), selector];
    return {
        context,
        item: {
            kind: 'frame', accessible: Boolean(context), tag: 'iframe', role: 'document',
            text: context ? `iframe (same-origin: ${label})`
                : 'iframe (content not directly accessible from parent — cross-origin or isolated)',
            name, title, src, selector, frameSelector: selector, framePath,
            center: geometry.center, rect: geometry.rect,
            ...(parentFrame ? { parentFrameSelector: parentFrame.frameSelector } : {})
        }
    };
}

function resolveFrameItemGeometry(el, parentFrame) {
    const localRect = el.getBoundingClientRect();
    return parentFrame
        ? { rect: elementViewportRect(el, parentFrame), center: elementViewportCenter(el, parentFrame) }
        : { rect: rectInfo(localRect), center: centerInfo(localRect) };
}

function getFrameItemAttributes(el) {
    return {
        src: el.src || el.getAttribute('src') || '',
        name: el.name || el.getAttribute('name') || ''
    };
}

function inferDownloadFilename(element, href) {
    const explicit = String(element.getAttribute?.('download') || '').trim();
    if (explicit) return explicit;
    try {
        const url = new URL(href);
        for (const key of ['filename', 'file', 'download']) {
            const candidate = String(url.searchParams.get(key) || '').trim();
            if (candidate) return candidate.split(/[\\/]/).pop();
        }
        const pathname = decodeURIComponent(url.pathname || '').replace(/\/+$/, '');
        const basename = pathname.split('/').pop() || '';
        return /\.[a-z0-9]{1,12}$/i.test(basename) ? basename : '';
    } catch (_) {
        return '';
    }
}
