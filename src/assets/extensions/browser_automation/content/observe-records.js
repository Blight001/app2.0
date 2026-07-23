function accessibleFrameDocUrls() {
    const out = [];
    for (const ctx of getAccessibleFrames(cssPath)) {
        try {
            const href = ctx.doc.location && ctx.doc.location.href;
            if (href && href !== 'about:blank') out.push(href);
        } catch (_error) { /* frame detached mid-scan */ }
    }
    return out;
}

// ── 元素/媒体记录 ──────────────────────────────────────────────────────────
function elementRecord(el, frame) {
    const r = el.getBoundingClientRect();
    return {
        el, frame, tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || implicitRole(el),
        type: el.type || undefined,
        text: textOf(el, 80), selector: cssPath(el),
        center: frame ? elementViewportCenter(el, frame) : centerInfo(r),
        rect: frame ? elementViewportRect(el, frame) : rectInfo(r),
        category: elementCategory(el)
    };
}
function interactiveItemFromRecord(rec, id) {
    const item = {
        kind: 'interactive', id, tag: rec.tag, role: rec.role, category: rec.category,
        text: rec.text, selector: rec.selector, center: rec.center, rect: rec.rect
    };
    appendInteractiveFrameInfo(item, rec);
    appendInteractiveBasicInfo(item, rec);
    appendInteractiveStateInfo(item, rec);
    return item;
}

function appendInteractiveFrameInfo(item, rec) {
    if (!rec.frame) return;
    item.inFrame = true;
    item.frameSelector = rec.frame.frameSelector;
    item.framePath = buildFramePath(rec.frame);
}

function appendInteractiveBasicInfo(item, rec) {
    const element = rec.el;
    const get = (name) => element.getAttribute ? element.getAttribute(name) : null;
    if (rec.type) item.type = rec.type;
    if (element.value != null) item.value = String(element.value).slice(0, 60);
    const name = get('name'); if (name) item.name = String(name).slice(0, 60);
    const placeholder = get('placeholder'); if (placeholder) item.placeholder = String(placeholder).slice(0, 80);
    const ariaLabel = get('aria-label') || get('aria-labelledby');
    if (ariaLabel) item.ariaLabel = String(ariaLabel).slice(0, 80);
    const title = get('title');
    if (title && String(title).trim() && String(title).trim() !== (item.text || '')) item.title = String(title).slice(0, 60);
}

function appendInteractiveStateInfo(item, rec) {
    const element = rec.el;
    if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') item.disabled = true;
    if (element.readOnly) item.readOnly = true;
    if (['image', 'video', 'audio'].includes(rec.category)) appendMediaSourceInfo(item, element);
    if ((rec.tag === 'a' || rec.category === 'link') && element.href) {
        item.href = String(element.href).slice(0, 2048);
        if (/^https?:/i.test(item.href)) item.downloadUrl = item.href;
        const downloadName = inferDownloadFilename(element, item.href);
        if (downloadName) item.downloadFilename = String(downloadName).slice(0, 160);
    }
    if (rec.category === 'checkbox' || rec.category === 'radio') item.checked = !!element.checked;
    if (rec.tag === 'select') appendInteractiveSelectInfo(item, element);
}

function appendInteractiveSelectInfo(item, element) {
    try {
        const options = Array.from(element.options || []).slice(0, 6)
            .map((option) => String(option.text || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean);
        if (options.length) item.optionsSample = options;
        item.optionCount = element.options?.length || 0;
    } catch (_) {}
}
function mediaSourceUrl(element) {
    const source = element.querySelector?.('source');
    const candidates = [
        element.currentSrc, element.src, element.getAttribute?.('src'),
        element.getAttribute?.('data-src'), element.getAttribute?.('data-original'),
        element.getAttribute?.('data-lazy-src'),
        source?.currentSrc, source?.src, source?.getAttribute?.('src')
    ].map((value) => String(value || '').trim()).filter(Boolean);
    return candidates.find((value) => /^https?:/i.test(value)) || candidates[0] || '';
}
function appendMediaSourceInfo(item, element) {
    const src = mediaSourceUrl(element);
    if (!src) return;
    item.src = src.slice(0, 2048);
    if (!/^https?:/i.test(item.src)) return;
    item.downloadUrl = item.src;
    const filename = inferDownloadFilename(element, item.src);
    if (filename) item.downloadFilename = String(filename).slice(0, 160);
}
function mediaRecord(el, frame) {
    const r = el.getBoundingClientRect();
    const category = elementCategory(el);
    const src = mediaSourceUrl(el);
    const alt = el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return {
        el, frame, kind: 'media', category, tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || (category === 'image' ? 'img' : category),
        text: (alt || textOf(el, 80) || src.split('/').pop() || category).slice(0, 120),
        selector: cssPath(el),
        center: frame ? elementViewportCenter(el, frame) : centerInfo(r),
        rect: frame ? elementViewportRect(el, frame) : rectInfo(r),
        ...(src ? { src: src.slice(0, 2048) } : {})
    };
}
function mediaItemFromRecord(rec) {
    const item = { kind: 'media', category: rec.category, role: rec.role, text: rec.text, selector: rec.selector, center: rec.center, rect: rec.rect };
    if (rec.frame) { item.inFrame = true; item.frameSelector = rec.frame.frameSelector; item.framePath = buildFramePath(rec.frame); }
    if (rec.src) {
        item.src = rec.src;
        if (/^https?:/i.test(rec.src)) {
            item.downloadUrl = rec.src;
            const filename = inferDownloadFilename(rec.el, rec.src);
            if (filename) item.downloadFilename = filename;
        }
    }
    return item;
}
function collectVisibleMediaIn(root, frame) {
    const out = [];
    const seen = new Set();
    const add = (el) => {
        if (!isHTMLElement(el) || seen.has(el)) return;
        seen.add(el);
        if (!isVisible(el)) return;
        const r = frame ? elementViewportRect(el, frame) : rectInfo(el.getBoundingClientRect());
        if (r.w <= 0 || r.h <= 0) return;
        const center = frame ? elementViewportCenter(el, frame) : centerInfo(el.getBoundingClientRect());
        if (center.y < 0 || center.x < 0 || center.y > window.innerHeight || center.x > window.innerWidth) return;
        out.push(mediaRecord(el, frame));
    };
    for (const sr of enumerateScanRoots(root)) sr.querySelectorAll(MEDIA_SELECTOR).forEach(add);
    return out;
}
function collectVisibleMedia(scopes) {
    const out = [];
    for (const scope of scopes) out.push(...collectVisibleMediaIn(scanRoot(scope.doc), scope.frame));
    return out;
}

function shouldDropNested(child, parent) {
    if (isStrongControl(child)) return false;
    if (isStrongControl(parent)) return true;
    const childText = textOf(child, 120);
    const parentText = textOf(parent, 120);
    const childArea = elementArea(child);
    const parentArea = elementArea(parent);
    if (childText && parentText && childText !== parentText) return false;
    if (parentArea > 0 && childArea / parentArea < 0.65) return false;
    return true;
}

// ── 精简 item（保留 selector/tag + 基本属性以便卡片构造，仅省去较重的 rect）──────────────
var ITEM_DROP_KEYS = new Set(['rect']);
function slimItem(item) {
    const out = {};
    for (const k of Object.keys(item)) { if (ITEM_DROP_KEYS.has(k)) continue; out[k] = item[k]; }
    return out;
}
function itemCategory(item) {
    if (item && item.kind === 'text') return 'text';
    if (item && item.kind === 'frame') return 'frame';
    return String((item && item.category) || (item && item.kind) || 'other');
}
function countItemsByCategory(items) {
    const counts = {};
    for (const item of items) { const key = itemCategory(item); counts[key] = (counts[key] || 0) + 1; }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}
function observeDownloadLinks(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (!item.downloadUrl || seen.has(item.downloadUrl)) return false;
        seen.add(item.downloadUrl);
        return true;
    }).map((item) => ({
        url: item.downloadUrl, text: item.text || item.title || '', selector: item.selector || '',
        ...(item.downloadFilename ? { filename: item.downloadFilename } : {}),
        ...(item.kind === 'media' ? { kind: item.kind, category: item.category } : {})
    }));
}
function kindSortRank(kind) {
    if (kind === 'text') return 0;
    if (kind === 'media') return 1;
    if (kind === 'frame') return 2;
    return 3;
}

// ── browser_observe ───────────────────────────────────────────────────────
function boundedObserveNumber(value, fallback, min, max) {
    const resolved = value == null ? fallback : value;
    return Math.min(Math.max(Number(resolved), min), max);
}

function createObserveConfig(msg) {
    const limit = boundedObserveNumber(msg.limit, 120, 1, 200);
    const includeText = msg.include_text !== false;
    const textLimit = boundedObserveNumber(msg.text_limit, 200, 0, 500);
    const defaultMaxItems = includeText ? Math.min(500, limit + textLimit + 40) : limit;
    const categoryFilter = parseFilter(msg.filter);
    return {
        limit,
        includeText,
        allowTruncate: msg.allow_truncate !== false,
        textLimit,
        maxItems: boundedObserveNumber(msg.max_items, defaultMaxItems, 1, 500),
        categoryFilter,
        tagFilter: parseTagFilter(msg.tag != null ? msg.tag : msg.tags),
        keyword: parseKeyword(msg.keyword != null ? msg.keyword : (msg.query != null ? msg.query : msg.text_filter)),
        wantText: !categoryFilter || categoryFilter.has('text'),
        wantFrame: !categoryFilter || categoryFilter.has('frame')
    };
}

function resolveObserveScope(msg) {
    const wantsScope = Boolean(msg.frame || msg.frame_selector || (Array.isArray(msg.frame_path) && msg.frame_path.length));
    const scopeFrame = wantsScope ? resolveFrameBySelector(msg.frame || msg.frame_selector, msg.frame_path) : null;
    if (wantsScope && !scopeFrame) {
        throw new Error(`Frame not found or not accessible: ${msg.frame || msg.frame_selector || (msg.frame_path || []).join(' > ')} — 用 browser_observe {filter:"frame"} 查看可用 iframe 的 frameSelector/framePath。`);
    }
    return { scopeFrame, scopes: scanScopes(scopeFrame) };
}

function hasDroppableInteractiveParent(item, set) {
    let parent = item.el.parentElement;
    while (parent) {
        if (set.has(parent) && shouldDropNested(item.el, parent)) return true;
        parent = parent.parentElement;
    }
    return false;
}

function buildFrameChildCounts(items) {
    const counts = new Map();
    for (const item of items) {
        if (!item.frame) continue;
        const key = buildFramePath(item.frame).join('>');
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function collectObserveCandidateState(config) {
    const all = collectCandidates(config.scopes);
    const iframeCandidates = all.filter((item) => item.frame);
    const hittable = all.filter((item) => item.frame
        ? isLikelyInteractableInFrame(item.el, item.frame) : isHittable(item.el));
    const iframeHittable = hittable.filter((item) => item.frame);
    const set = new Set(hittable.map((item) => item.el));
    const frameScan = collectFrameItems(config.scopeFrame);
    const frameItems = config.wantFrame ? filterObserveFrameItems(frameScan.items, config) : [];
    return {
        all, iframeCandidates, hittable, iframeHittable,
        blockedForMarks: collectBlockedCandidates(all, set, config.scopes),
        frameItems, frameOverlay: config.wantFrame ? frameScan.overlay : [],
        frameChildCounts: buildFrameChildCounts(all),
        pruned: hittable.filter((item) => !hasDroppableInteractiveParent(item, set))
    };
}

function filterObserveFrameItems(items, config) {
    return items.filter((frame) => (!config.tagFilter || config.tagFilter.has('iframe'))
        && (!config.keyword || [frame.text, frame.name, frame.title, frame.src].join(' ').toLowerCase().includes(config.keyword)));
}

function wantsObserveMedia(categoryFilter) {
    return !categoryFilter || ['media', 'image', 'video', 'audio'].some((category) => categoryFilter.has(category));
}

function collectObserveRecords(config, state) {
    const interactiveRecords = state.pruned.map((item) => elementRecord(item.el, item.frame))
        .filter((rec) => interactiveCategoryAllowed(rec.category, config.categoryFilter))
        .filter((rec) => matchesElementFilters(rec.el, config.tagFilter, config.keyword, rec.text));
    interactiveRecords.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    const interactiveElements = new Set(interactiveRecords.map((rec) => rec.el));
    const mediaRecords = wantsObserveMedia(config.categoryFilter)
        ? collectVisibleMedia(config.scopes)
            .filter((rec) => mediaCategoryAllowed(rec.category, config.categoryFilter))
            .filter((rec) => matchesElementFilters(rec.el, config.tagFilter, config.keyword, rec.text))
            .filter((rec) => !interactiveElements.has(rec.el))
            .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
        : [];
    return { interactiveRecords, slicedRecords: interactiveRecords.slice(0, config.limit), mediaRecords };
}

function buildObserveInteractiveItems(slicedRecords) {
    const overlayMarks = [];
    const markTargets = [];
    const interactiveItems = slicedRecords.map((rec, index) => {
        markTargets.push({
            el: rec.el, selector: rec.selector, text: rec.text, center: rec.center,
            frameSelector: rec.frame && rec.frame.frameSelector,
            framePath: rec.frame ? buildFramePath(rec.frame) : undefined
        });
        overlayMarks.push({ el: rec.el, status: 'clickable', frame: rec.frame });
        return interactiveItemFromRecord(rec, index + 1);
    });
    return { overlayMarks, markTargets, interactiveItems };
}

function collectObserveTextItems(config) {
    const rawTexts = (config.includeText && config.wantText) ? collectVisibleTexts(config.textLimit, config.scopes)
        .filter((text) => (!config.tagFilter || config.tagFilter.has(String(text.tag || '').toLowerCase()))
            && (!config.keyword || String(text.text || '').toLowerCase().includes(config.keyword))) : [];
    const textItems = rawTexts.map((text) => ({
        kind: 'text', role: text.role, tag: text.tag, text: text.text, selector: text.selector,
        center: text.center, rect: text.rect,
        ...(text.inFrame ? { inFrame: true, frameSelector: text.frameSelector, framePath: text.framePath } : {})
    }));
    textItems.sort(observeItemPositionSort);
    return { rawTexts, textItems, iframeTexts: rawTexts.filter((text) => text.inFrame) };
}

function observeItemPositionSort(a, b) {
    return a.rect.y - b.rect.y || a.rect.x - b.rect.x || kindSortRank(a.kind) - kindSortRank(b.kind);
}

function annotateObserveFrames(frameItems, iframeTexts, frameChildCounts) {
    for (const frame of frameItems) {
        if (!frame.accessible) continue;
        const key = (frame.framePath || [frame.frameSelector]).join('>');
        frame.interactiveCount = frameChildCounts.get(key) || 0;
        const pathKey = (frame.framePath || []).join('>');
        const matched = iframeTexts.filter((text) => (text.framePath || []).join('>') === pathKey
            || text.frameSelector === frame.frameSelector);
        frame.textSamples = matched.slice(0, 5).map((text) => ({ text: text.text, selector: text.selector, center: text.center }));
        if (!frame.textSamples.length) delete frame.textSamples;
        frame.textCount = matched.length;
        if (!frame.interactiveCount && !matched.length) {
            frame.scanNote = 'iframe 内未扫描到可交互控件或可见文本；可能为纯渲染预览、嵌套跨域 iframe，或内容尚未加载完成';
        } else if (!frame.interactiveCount) frame.scanNote = 'iframe 内仅有可见文本，无可交互控件';
    }
}

function buildObserveItems(config, candidateState, records) {
    const interactive = buildObserveInteractiveItems(records.slicedRecords);
    const texts = collectObserveTextItems(config);
    annotateObserveFrames(candidateState.frameItems, texts.iframeTexts, candidateState.frameChildCounts);
    const mediaItems = records.mediaRecords.map(mediaItemFromRecord);
    const candidateItems = [...texts.textItems, ...candidateState.frameItems, ...mediaItems,
        ...records.interactiveRecords.map((rec, index) => interactiveItemFromRecord(rec, index + 1))]
        .sort(observeItemPositionSort);
    return {
        ...interactive, ...texts, mediaItems, candidateItems,
        categoryCounts: countItemsByCategory(candidateItems),
        tooMany: records.interactiveRecords.length > config.limit || candidateItems.length > config.maxItems
    };
}

function buildObserveStats(config, candidateState, records) {
    return {
        candidates: candidateState.all.length,
        hittable: candidateState.hittable.length,
        afterDedupe: candidateState.pruned.length,
        blocked: candidateState.blockedForMarks.length,
        limit: config.limit, maxItems: config.maxItems, textLimit: config.textLimit, includeText: config.includeText,
        filter: config.categoryFilter ? Array.from(config.categoryFilter) : null,
        tag: config.tagFilter ? Array.from(config.tagFilter) : null,
        keyword: config.keyword || null,
        media: records.mediaRecords.length,
        frames: candidateState.frameItems.length,
        accessibleFrames: candidateState.frameItems.filter((frame) => frame.accessible).length,
        iframeCandidates: candidateState.iframeCandidates.length,
        iframeHittable: candidateState.iframeHittable.length
    };
}

function observeViewportFields(config) {
    const context = viewportContext();
    return {
        scroll: { y: context.scrollY, percent: context.scrollPercent, atTop: context.atTop, atBottom: context.atBottom },
        currentSection: context.currentSection,
        ...(config.scopeFrame ? { scopedToFrame: buildFramePath(config.scopeFrame) } : {})
    };
}

function buildObserveOverLimitResult(config, candidateState, records, itemState, stats) {
    setMarks([]);
    return {
        success: true, source: 'browser_observe', url: location.href, title: document.title,
        count: 0, textCount: 0, itemCount: itemState.candidateItems.length,
        frameCount: candidateState.frameItems.length, tooMany: true, overLimit: true,
        maxItems: config.maxItems, categoryCounts: itemState.categoryCounts, stats, marked: false,
        ...observeViewportFields(config), items: [],
        hint: `当前 observe 匹配到 ${itemState.candidateItems.length} 个条目（可交互 ${records.interactiveRecords.length} 个），超过 limit=${config.limit} 或 max_items=${config.maxItems}，为避免返回过多内容已不返回 items。请使用 filter（button/link/input/image/video/text/frame 等）、tag/tags、keyword，或提高 limit/max_items；也可传 frame（iframe 的 frameSelector）或 frame_path 只观察某个 iframe 内部；categoryCounts 给出了各类别数量。`
    };
}

function applyObserveMarks(msg, config, candidateState, itemState) {
    setMarks(itemState.markTargets);
    const blocked = candidateState.blockedForMarks
        .filter((element) => interactiveCategoryAllowed(elementCategory(element), config.categoryFilter))
        .slice(0, config.limit);
    const marked = msg.mark !== false;
    if (marked) drawMarksOverlay([
        ...candidateState.frameOverlay.map(({ el, frame }) => ({ el, status: 'frame', frame })),
        ...itemState.overlayMarks,
        ...blocked.map((el) => ({ el, status: 'blocked' }))
    ]);
    return marked;
}

function buildObserveHint(config, itemState, items, wasTruncated, marked) {
    const filterHint = config.categoryFilter ? ` 已按 filter=[${Array.from(config.categoryFilter).join(',')}] 过滤：只返回这些类别。` : '';
    const queryHint = [config.tagFilter ? `tag=[${Array.from(config.tagFilter).join(',')}]` : '',
        config.keyword ? `keyword="${config.keyword}"` : ''].filter(Boolean).join(' ');
    const markHint = marked ? ' 页面标记：紫色虚线=iframe 边界，绿色=可点击，红色=不可点击/被禁用/被遮挡。' : '';
    const truncateHint = wasTruncated
        ? `页面共匹配 ${itemState.candidateItems.length} 个条目，本次已按 limit=${config.limit}、max_items=${config.maxItems} 截断返回 ${items.length} 个；可用 filter/tag/keyword 进一步聚焦。` : '';
    return truncateHint + '返回 items 单一混排列表（按位置排序、已去重，用 kind 区分）：kind=text 可见文本（不可点击），' +
        'kind=media 图片/视频/音频（不可点击；category=image/video/audio），kind=frame 页面内 iframe 边界' +
        '（accessible=true 表示同源已扫描，子元素见 inFrame=true 的 interactive；accessible=false 为跨域），' +
        'kind=interactive 可点击元素（带临时 id 供 ref，同时返回 tag/selector/name/placeholder/ariaLabel/value/optionsSample 等基本信息）。' +
        ' 为便于自动化卡片创建/修改，推荐使用 selector 或 text+tag 构造持久步骤（卡片 runner 使用这些而非临时 ref）；ref:id 仅本次 observe 有效，用于 browser_action 快速操作。' +
        ' inFrame=true 表示元素在同源 iframe 内。勿使用 Playwright 语法（如 :has-text）；可用 text/selector/ref 定位。' +
        filterHint + (queryHint ? ` 已按 ${queryHint} 筛选。` : '') + markHint;
}

function buildObserveSuccessResult(msg, config, candidateState, records, itemState, stats) {
    const availableItems = [...itemState.textItems, ...candidateState.frameItems,
        ...itemState.mediaItems, ...itemState.interactiveItems].sort(observeItemPositionSort);
    const items = availableItems.slice(0, config.maxItems);
    const wasTruncated = records.interactiveRecords.length > records.slicedRecords.length
        || availableItems.length > items.length;
    const marked = applyObserveMarks(msg, config, candidateState, itemState);
    const downloadLinks = observeDownloadLinks(items);
    return {
        success: true, source: 'browser_observe', url: location.href, title: document.title,
        count: items.filter((item) => item.kind === 'interactive').length,
        textCount: items.filter((item) => item.kind === 'text').length,
        itemCount: items.length, matchedItemCount: itemState.candidateItems.length,
        frameCount: candidateState.frameItems.length,
        accessibleFrameCount: candidateState.frameItems.filter((frame) => frame.accessible).length,
        accessibleFrameUrls: accessibleFrameDocUrls(),
        iframeCandidates: candidateState.iframeCandidates.length,
        iframeHittable: candidateState.iframeHittable.length,
        iframeTextCount: itemState.iframeTexts.length,
        stats, truncated: wasTruncated,
        textTruncated: config.includeText && itemState.rawTexts.length >= config.textLimit,
        tooMany: false, maxItems: config.maxItems, categoryCounts: itemState.categoryCounts, marked,
        ...observeViewportFields(config), downloadLinks,
        downloadLinkCount: downloadLinks.length, items: items.map(slimItem),
        hint: buildObserveHint(config, itemState, items, wasTruncated, marked)
    };
}

function scan(msg = {}) {
    clearMarksOverlay();
    const { limit, includeText, allowTruncate, textLimit, maxItems, categoryFilter,
        tagFilter, keyword, wantText, wantFrame } = createObserveConfig(msg);
    const { scopeFrame, scopes } = resolveObserveScope(msg);
    const config = { limit, includeText, allowTruncate, textLimit, maxItems, categoryFilter,
        tagFilter, keyword, wantText, wantFrame, scopeFrame, scopes };
    const candidateState = collectObserveCandidateState(config);
    const records = collectObserveRecords(config, candidateState);
    const itemState = buildObserveItems(config, candidateState, records);
    const stats = buildObserveStats(config, candidateState, records);
    if (itemState.tooMany && !allowTruncate) {
        return buildObserveOverLimitResult(config, candidateState, records, itemState, stats);
    }
    return buildObserveSuccessResult(msg, config, candidateState, records, itemState, stats);
}

// ── browser_action：视觉动效挂钩 ──────────────────────────────────────────
