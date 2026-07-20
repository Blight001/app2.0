'use strict';

function normalizeSidebarPopupsInput(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return raw.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean).map((selector) => ({
            name: selector,
            selector
        }));
    }
}

function formatSidebarPopupsInput(popups = []) {
    if (!Array.isArray(popups) || popups.length === 0) {
        return '';
    }

    return JSON.stringify(popups, null, 2);
}

function decodeHtmlEntities(value = '') {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function escapeCssIdentifier(value = '') {
    const text = String(value || '');
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
        return CSS.escape(text);
    }
    return text.replace(/[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
}

function escapeCssAttributeValue(value = '') {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHasTextValue(value = '') {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeSelectorText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksLikeHtmlSnippet(value = '') {
    const text = normalizeSelectorText(decodeHtmlEntities(value));
    return /^<\w[\s>]/.test(text) || /^<\/?\w/i.test(text);
}

function parseSelectorHtmlElement(raw) {
    const template = document.createElement('template');
    try { template.innerHTML = raw; } catch (_error) { return null; }
    return template.content && template.content.firstElementChild || null;
}

function collectSelectorAttributes(element, tagName, hasId) {
    if (hasId) return [];
    const names = ['name', 'placeholder', 'aria-label', 'title', 'role', 'data-testid', 'data-test', 'data-cy', 'data-qa'];
    if (tagName === 'input' || tagName === 'button') names.unshift('type');
    let selectedNames = names.filter((name) => String(element.getAttribute(name) || '').trim());
    if (!selectedNames.length) {
        selectedNames = Array.from(element.attributes || [])
            .map((attr) => String((attr && attr.name) || '').trim())
            .filter((name) => /^data-[a-z0-9_-]+$/i.test(name) && !/^data-v-/i.test(name)).slice(0, 2);
    }
    return selectedNames.map((name) => `[${name}="${escapeCssAttributeValue(String(element.getAttribute(name) || '').trim())}"]`);
}

function buildStandardSelectorFromHtmlSnippet(value = '') {
    const raw = normalizeSelectorText(decodeHtmlEntities(value));
    if (!raw || !looksLikeHtmlSnippet(raw)) {
        return {
            selector: normalizeSelectorText(value),
            converted: false
        };
    }

    const element = parseSelectorHtmlElement(raw);
    if (!element) {
        return {
            selector: normalizeSelectorText(value),
            converted: false
        };
    }

    const tagName = String(element.tagName || '').toLowerCase() || '*';
    const selectorParts = [tagName];
    const id = String(element.getAttribute('id') || '').trim();
    if (id) {
        selectorParts.push(`#${escapeCssIdentifier(id)}`);
    }

    const classes = Array.from(element.classList || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item) => !/^data-v-/i.test(item));
    for (const className of classes) {
        selectorParts.push(`.${escapeCssIdentifier(className)}`);
    }

    selectorParts.push(...collectSelectorAttributes(element, tagName, Boolean(id)));

    const textContent = normalizeSelectorText(String(element.textContent || ''));
    if (textContent && textContent.length <= 80) {
        selectorParts.push(`:has-text("${escapeHasTextValue(textContent)}")`);
    }

    const selector = normalizeSelectorText(selectorParts.join(''));
    return {
        selector: selector || normalizeSelectorText(value),
        converted: true
    };
}

function normalizeSelectorInputValue(value = '') {
    const text = normalizeSelectorText(value);
    if (!text) {
        return {
            selector: '',
            converted: false
        };
    }

    if (looksLikeHtmlSnippet(text)) {
        return buildStandardSelectorFromHtmlSnippet(text);
    }

    return {
        selector: text,
        converted: false
    };
}

function normalizeSidebarStepSelectorControl(stepCard, control) {
    if (!stepCard || !control) {
        return {
            selector: String(control?.value || '').trim(),
            converted: false
        };
    }

    const normalized = normalizeSelectorInputValue(control.value);
    if (normalized.selector && normalized.selector !== control.value) {
        control.value = normalized.selector;
    }

    if (normalized.converted) {
        const byControl = stepCard.querySelector('[data-sidebar-step-field="by"]');
        if (byControl) {
            byControl.value = 'css_selector';
        }
    }

    return normalized;
}

function updateSidebarEditorMeta(cardData = null) {
    if (!sidebarEditorMetaNode || !isSidebarLayout()) {
        return;
    }

    if (!cardData) {
        sidebarEditorMetaNode.innerHTML = '<span class="sidebar-editor-meta__chip">未载入卡片</span>';
        return;
    }

    const stepsCount = Array.isArray(cardData.steps) ? cardData.steps.length : 0;
    const edgeCount = Array.isArray(cardData.flow?.edges) ? cardData.flow.edges.length : 0;
    const name = String(cardData.name || '未命名自动化卡片').trim() || '未命名自动化卡片';
    const website = String(cardData.website || '').trim();
    const chips = [
        `<span class="sidebar-editor-meta__chip">卡片: ${escapeHtml(name)}</span>`,
        `<span class="sidebar-editor-meta__chip">节点: ${stepsCount}</span>`,
        `<span class="sidebar-editor-meta__chip">连线: ${edgeCount}</span>`
    ];
    if (website) {
        chips.push(`<span class="sidebar-editor-meta__chip">站点: ${escapeHtml(website)}</span>`);
    }
    sidebarEditorMetaNode.innerHTML = chips.join('');
}

function buildSidebarStepTemplate(stepType = 'navigate') {
    const normalizedType = String(stepType || 'navigate').trim();
    const template = {
        id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: `步骤`,
        type: normalizedType
    };
    template.type = normalizedType;

    if (normalizedType === 'navigate') {
        template.url = template.url || '';
    } else if (normalizedType === 'clear_current_page_cache') {
        template.name = '清理当前页缓存';
        delete template.selector;
        delete template.text;
        delete template.url;
        delete template.by;
        delete template.script;
        delete template.wait_for_text;
        delete template.wait_for_element_hidden;
        delete template.wait_for_text_hidden;
        delete template.clear_first;
        delete template.clearFirst;
        delete template.click_before_type;
        delete template.clickBeforeType;
    } else if (normalizedType === 'save_cookies') {
        template.name = '获取Cookie';
        delete template.selector;
        delete template.text;
    } else if (normalizedType === 'condition') {
        template.name = '判断分支';
        template.condition_mode = 'selector_exists';
        template.selector = '';
    }

    return template;
}

function collectSidebarStepExpansionState() {
    const state = new Map();
    if (!sidebarStepListNode) {
        return state;
    }

    collectSidebarStepCards().forEach((card) => {
        const index = Number(card.dataset.stepIndex);
        if (Number.isInteger(index)) {
            state.set(index, card.classList.contains('is-expanded'));
        }
    });

    return state;
}

function buildSidebarStepSummary(step = {}) {
    const parts = [];
    const type = String(step.type || 'navigate').trim() || 'navigate';
    parts.push(`类型: ${escapeHtml(formatStepTypeLabel(type))}`);

    if (type === 'condition') {
        const mode = String(step.condition_mode || step.condition || 'selector_exists').trim();
        parts.push(`判断: ${escapeHtml(mode)}`);
    }

    const selector = String(step.selector || '').trim();
    if (selector) {
        const shortSelector = selector.length > 48 ? `${selector.slice(0, 45)}...` : selector;
        parts.push(`选择器: ${escapeHtml(shortSelector)}`);
    }

    const url = String(step.url || '').trim();
    if (url) {
        const shortUrl = url.length > 48 ? `${url.slice(0, 45)}...` : url;
        parts.push(`URL: ${escapeHtml(shortUrl)}`);
    }

    return parts.map((item) => `<span>${item}</span>`).join('');
}
