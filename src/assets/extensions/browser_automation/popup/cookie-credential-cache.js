import * as formatters from './cookie-credential-formatters.js';
const { formatCookieCredentialTime, getTodayCookieCredentialDateKey, getCookieCredentialDateKey, getCookieCredentialYesterdayKey, formatCookieCredentialDateLabel, formatCookieCredentialTimeLabel, buildCookieCredentialSearchText, normalizeCookieCredentialSearchQuery, cookieCredentialItemMatchesQuery, buildCookieCredentialCacheId, normalizeCookieCredentialCacheEntry, buildCookieCredentialListLabel, buildCookieCredentialClipboardText, buildCookieCredentialAccountPasswordText, buildCookieCredentialGroupAccountPasswordText } = formatters;
const shared = globalThis.CookieCaptureShared || {};
const { copyTextToClipboard, setStatus, showActionToast, escapeHtml } = shared;
const COOKIE_CREDENTIAL_CACHE_LIST_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_CACHE_LIST_KEY;
const COOKIE_CREDENTIAL_SELECTED_DATE_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_SELECTED_DATE_KEY;
const COOKIE_CREDENTIAL_SEARCH_KEY = shared.STORAGE_KEYS.COOKIE_CREDENTIAL_SEARCH_KEY;
const COOKIE_CREDENTIAL_CACHE_MAX_ITEMS = 50;
const cookieCredentialEditPanelNode = document.getElementById('cookie-credential-edit-panel');
const cookieCredentialEditPanelSubtitleNode = document.getElementById('cookie-credential-edit-panel-subtitle');
const editCookieAccountInput = document.getElementById('edit-account');
const editCookiePasswordInput = document.getElementById('edit-password');
const editCookieNoteInput = document.getElementById('edit-note');
const editCookieCardKeyInput = document.getElementById('edit-card-key');
const cookieCredentialDateFilterNode = document.getElementById('cookie-credential-date-filter');
const cookieCredentialSearchNode = document.getElementById('cookie-credential-search');
const cookieCredentialCountNode = document.getElementById('cookie-credential-count');
const cookieCredentialListNode = document.getElementById('cookie-credential-list');

let cookieCredentialSelectedDate = '';
let cookieCredentialSearchQuery = '';
let editingCookieCredentialId = '';

function focusCookieCredentialEditPanel() {
    if (!cookieCredentialEditPanelNode || !cookieCredentialEditPanelNode.classList.contains('is-visible')) {
        return;
    }

    window.requestAnimationFrame(() => {
        const target = editCookieAccountInput || cookieCredentialEditPanelNode;
        if (target && typeof target.focus === 'function') {
            target.focus();
        }
        if (editCookieAccountInput && typeof editCookieAccountInput.select === 'function' && String(editCookieAccountInput.value || '').trim()) {
            editCookieAccountInput.select();
        }
    });
}

async function closeCookieCredentialEditPanel(message = '') {
    clearCookieCredentialEditTarget();
    await refreshCookieCredentialCacheUi().catch(() => {});
    if (message) {
        showActionToast(message, 'info');
    }
}

function syncCookieCredentialEditUi() {
    const isEditing = Boolean(editingCookieCredentialId);
    if (cookieCredentialEditPanelNode) {
        cookieCredentialEditPanelNode.classList.toggle('is-visible', isEditing);
    }
    if (cookieCredentialEditPanelSubtitleNode) {
        cookieCredentialEditPanelSubtitleNode.textContent = isEditing
            ? '正在编辑已保存记录，修改内容后点击保存修改'
            : '请选择一条记录开始编辑';
    }
    if (isEditing) {
        focusCookieCredentialEditPanel();
    }
}

function setCookieCredentialEditInputs(item = {}) {
    if (editCookieAccountInput) editCookieAccountInput.value = String(item.account || '').trim();
    if (editCookiePasswordInput) editCookiePasswordInput.value = String(item.password || '').trim();
    if (editCookieNoteInput) editCookieNoteInput.value = String(item.note || '').trim();
    if (editCookieCardKeyInput) editCookieCardKeyInput.value = String(item.cardKey || '').trim();
}

function setCookieCredentialEditTarget(item = null) {
    if (!item) {
        editingCookieCredentialId = '';
        setCookieCredentialEditInputs();
        syncCookieCredentialEditUi();
        return;
    }

    editingCookieCredentialId = String(item.id || '').trim();
    setCookieCredentialEditInputs(item);
    syncCookieCredentialEditUi();
}

function clearCookieCredentialEditTarget() {
    if (!editingCookieCredentialId) {
        return;
    }
    editingCookieCredentialId = '';
    if (editCookieAccountInput) editCookieAccountInput.value = '';
    if (editCookiePasswordInput) editCookiePasswordInput.value = '';
    if (editCookieNoteInput) editCookieNoteInput.value = '';
    if (editCookieCardKeyInput) editCookieCardKeyInput.value = '';
    syncCookieCredentialEditUi();
}

async function loadCookieCredentialCacheState() {
    const stored = await chrome.storage.local.get([COOKIE_CREDENTIAL_CACHE_LIST_KEY]).catch(() => ({}));
    const list = Array.isArray(stored[COOKIE_CREDENTIAL_CACHE_LIST_KEY]) ? stored[COOKIE_CREDENTIAL_CACHE_LIST_KEY] : [];
    const items = list.map((item, index) => normalizeCookieCredentialCacheEntry(item, index));
    items.sort((left, right) => {
        const leftTime = new Date(left.savedAt || '').getTime();
        const rightTime = new Date(right.savedAt || '').getTime();
        if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
            return 0;
        }
        if (Number.isNaN(leftTime)) {
            return 1;
        }
        if (Number.isNaN(rightTime)) {
            return -1;
        }
        return rightTime - leftTime;
    });
    return { items };
}

async function saveCookieCredentialCacheState(items = []) {
    const normalizedItems = Array.isArray(items)
        ? items.map((item, index) => normalizeCookieCredentialCacheEntry(item, index))
        : [];
    const storedItems = normalizedItems.slice(0, COOKIE_CREDENTIAL_CACHE_MAX_ITEMS);
    await chrome.storage.local.set({
        [COOKIE_CREDENTIAL_CACHE_LIST_KEY]: storedItems
    });
    return { items: storedItems };
}

async function loadCookieCredentialFilterState() {
    const stored = await chrome.storage.local.get([COOKIE_CREDENTIAL_SELECTED_DATE_KEY, COOKIE_CREDENTIAL_SEARCH_KEY]).catch(() => ({}));
    const selectedDate = String(stored[COOKIE_CREDENTIAL_SELECTED_DATE_KEY] || '').trim();
    const searchQuery = normalizeCookieCredentialSearchQuery(stored[COOKIE_CREDENTIAL_SEARCH_KEY] || '');
    cookieCredentialSelectedDate = selectedDate || getTodayCookieCredentialDateKey();
    cookieCredentialSearchQuery = searchQuery;

    if (cookieCredentialDateFilterNode) {
        cookieCredentialDateFilterNode.value = cookieCredentialSelectedDate;
    }
    if (cookieCredentialSearchNode) {
        cookieCredentialSearchNode.value = cookieCredentialSearchQuery;
    }
}

async function saveCookieCredentialFilterState() {
    await chrome.storage.local.set({
        [COOKIE_CREDENTIAL_SELECTED_DATE_KEY]: cookieCredentialSelectedDate || getTodayCookieCredentialDateKey(),
        [COOKIE_CREDENTIAL_SEARCH_KEY]: cookieCredentialSearchQuery
    }).catch(() => {});
}

function setCookieCredentialSelectedDate(value = '') {
    const normalized = String(value || '').trim();
    cookieCredentialSelectedDate = normalized || getTodayCookieCredentialDateKey();
    return cookieCredentialSelectedDate;
}

function setCookieCredentialSearchQuery(value = '') {
    cookieCredentialSearchQuery = normalizeCookieCredentialSearchQuery(value);
    return cookieCredentialSearchQuery;
}

function getCookieCredentialSelectedDateValue() {
    return String(cookieCredentialSelectedDate || '').trim() || getTodayCookieCredentialDateKey();
}

function getCookieCredentialVisibleItems(items = []) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const selectedDate = getCookieCredentialSelectedDateValue();
    const searchQuery = normalizeCookieCredentialSearchQuery(cookieCredentialSearchQuery);

    return normalizedItems.filter((item) => {
        if (selectedDate !== 'all' && String(item.dateKey || '').trim() !== selectedDate) {
            return false;
        }
        return cookieCredentialItemMatchesQuery(item, searchQuery);
    });
}

function buildCookieCredentialDateOptions(items = []) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const counts = new Map();
    normalizedItems.forEach((item) => {
        const dateKey = String(item.dateKey || getCookieCredentialDateKey(item.savedAt) || '').trim();
        if (!dateKey) {
            return;
        }
        counts.set(dateKey, (counts.get(dateKey) || 0) + 1);
    });

    const todayKey = getTodayCookieCredentialDateKey();
    const optionKeys = new Set(['all', todayKey, getCookieCredentialSelectedDateValue()]);
    counts.forEach((_count, dateKey) => optionKeys.add(dateKey));

    return Array.from(optionKeys)
        .filter(Boolean)
        .sort((left, right) => {
            if (left === 'all') return -1;
            if (right === 'all') return 1;
            if (left === todayKey) return -1;
            if (right === todayKey) return 1;
            return right.localeCompare(left);
        })
        .map((dateKey) => {
            const count = dateKey === 'all'
                ? normalizedItems.length
                : counts.get(dateKey) || 0;
            return {
                value: dateKey,
                label: `${formatCookieCredentialDateLabel(dateKey)}${dateKey === 'all' ? '' : `（${count} 条）`}`,
                count
            };
        });
}

function renderCookieCredentialDateFilterOptions(items = []) {
    if (!cookieCredentialDateFilterNode) {
        return [];
    }

    const selectedDate = getCookieCredentialSelectedDateValue();
    const options = buildCookieCredentialDateOptions(items);
    if (!options.some((option) => option.value === selectedDate)) {
        options.push({
            value: selectedDate,
            label: formatCookieCredentialDateLabel(selectedDate),
            count: 0
        });
    }

    cookieCredentialDateFilterNode.innerHTML = options.map((option) => (
        `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
    )).join('');
    cookieCredentialDateFilterNode.value = selectedDate;
    return options;
}

function buildCookieCredentialEmptyMessage(totalCount = 0, visibleCount = 0) {
    if (totalCount <= 0) {
        return '暂无已保存记录，填写账号、密码、备注和卡密后点击“保存到缓存”。';
    }

    const selectedDate = getCookieCredentialSelectedDateValue();
    const selectedLabel = formatCookieCredentialDateLabel(selectedDate);
    const searchText = normalizeCookieCredentialSearchQuery(cookieCredentialSearchQuery);
    const parts = [];
    if (selectedDate !== 'all') {
        parts.push(`日期「${selectedLabel}」`);
    } else {
        parts.push('全部日期');
    }
    if (searchText) {
        parts.push(`关键词「${searchText}」`);
    }
    parts.push(`未找到可显示的记录（${visibleCount}/${totalCount} 条）`);
    return parts.join('，');
}

function buildCookieCredentialItemHtml(item) {
    const label = buildCookieCredentialListLabel(item);
    const isEditing = String(item.id || '').trim() === editingCookieCredentialId;
    return `
      <details class="cookie-credential-item${isEditing ? ' is-editing' : ''}" data-cookie-credential-item data-cookie-id="${escapeHtml(item.id)}">
        <summary class="cookie-credential-item__summary">
          <div class="cookie-credential-item__summary-main">
            <div class="cookie-credential-item__title">${escapeHtml(label.title)}</div>
            <div class="cookie-credential-item__meta">${escapeHtml(label.meta)}</div>
          </div>
          <div class="cookie-credential-item__summary-actions">
            <div class="cookie-credential-item__summary-action-row"><button type="button" class="button-secondary" data-cookie-credential-action="copy">复制完整信息</button><button type="button" class="button-secondary" data-cookie-credential-action="edit">编辑</button></div>
            <div class="cookie-credential-item__summary-action-row"><button type="button" class="button-secondary cookie-credential-copy-account-password-btn" data-cookie-credential-action="copy-account-password">复制账号密码</button><button type="button" class="button-secondary cookie-credential-delete-btn" data-cookie-credential-action="delete">删除</button></div>
          </div>
        </summary>
        <div class="cookie-credential-item__body">
          ${[['备注', item.note], ['卡密', item.cardKey], ['账号', item.account], ['密码', item.password]].map(([name, value]) => `<div class="cookie-credential-item__field"><label>${name}</label><div class="cookie-credential-item__value">${escapeHtml(String(value || '').trim() || '未填写')}</div></div>`).join('')}
        </div>
      </details>`;
}

function renderCookieCredentialCacheList(state = { items: [] }) {
    if (!cookieCredentialListNode) {
        return;
    }

    const items = Array.isArray(state.items) ? state.items : [];
    renderCookieCredentialDateFilterOptions(items);

    const visibleItems = getCookieCredentialVisibleItems(items);
    if (cookieCredentialCountNode) {
        cookieCredentialCountNode.textContent = items.length > visibleItems.length
            ? `${visibleItems.length} / ${items.length} 条`
            : items.length > 0
                ? `${items.length} 条`
                : '0 条';
    }

    if (items.length === 0) {
        cookieCredentialListNode.innerHTML = '<div class="cookie-credential-empty">暂无已保存记录，填写账号、密码、备注和卡密后点击“保存到缓存”。</div>';
        return;
    }

    if (visibleItems.length === 0) {
        cookieCredentialListNode.innerHTML = `<div class="cookie-credential-empty">${escapeHtml(buildCookieCredentialEmptyMessage(items.length, visibleItems.length))}</div>`;
        return;
    }

    const groupedItems = new Map();
    visibleItems.forEach((item) => {
        const dateKey = String(item.dateKey || getCookieCredentialDateKey(item.savedAt) || '').trim() || getTodayCookieCredentialDateKey();
        const currentItems = groupedItems.get(dateKey) || [];
        currentItems.push(item);
        groupedItems.set(dateKey, currentItems);
    });

    const groupEntries = Array.from(groupedItems.entries()).sort((left, right) => right[0].localeCompare(left[0]));
    cookieCredentialListNode.innerHTML = groupEntries.map(([dateKey, groupItems]) => {
        const groupTitle = formatCookieCredentialDateLabel(dateKey);
        const groupCountText = `${groupItems.length} 条`;
        const itemsHtml = groupItems.map(buildCookieCredentialItemHtml).join('');
        return `
          <section class="cookie-credential-group" data-cookie-credential-group data-cookie-group-date="${escapeHtml(dateKey)}">
            <div class="cookie-credential-group__head">
              <div class="cookie-credential-group__head-main">
                <div class="cookie-credential-group__title">${escapeHtml(groupTitle)}</div>
                <div class="chip">${escapeHtml(groupCountText)}</div>
              </div>
              <div class="cookie-credential-group__actions">
                <button type="button" class="button-secondary cookie-credential-group__copy-all-btn" data-cookie-credential-action="copy-group-account-password" data-cookie-group-date="${escapeHtml(dateKey)}">复制全部账号密码</button>
              </div>
            </div>
            <div class="cookie-credential-group__list">
              ${itemsHtml}
            </div>
          </section>
        `;
    }).join('');
}

async function refreshCookieCredentialCacheUi() {
    await loadCookieCredentialFilterState().catch(() => {});
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    renderCookieCredentialCacheList(state);
    return state;
}

async function rerenderCookieCredentialCacheUi() {
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    renderCookieCredentialCacheList(state);
    return state;
}

async function copyCookieCredentialItem(cardId = '') {
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const item = state.items.find((entry) => String(entry.id || '').trim() === String(cardId || '').trim()) || null;
    if (!item) {
        throw new Error('未找到可复制的缓存记录');
    }

    const text = buildCookieCredentialClipboardText(item);
    await copyTextToClipboard(text);
    return item;
}

async function copyCookieCredentialAccountPasswordItem(cardId = '') {
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const item = state.items.find((entry) => String(entry.id || '').trim() === String(cardId || '').trim()) || null;
    if (!item) {
        throw new Error('未找到可复制的缓存记录');
    }

    const text = buildCookieCredentialAccountPasswordText(item);
    await copyTextToClipboard(text);
    return item;
}

async function copyCookieCredentialAccountPasswordGroup(dateKey = '') {
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const visibleItems = getCookieCredentialVisibleItems(state.items);
    const normalizedDateKey = String(dateKey || '').trim();
    const groupItems = visibleItems.filter((item) => String(item.dateKey || '').trim() === normalizedDateKey);
    if (!groupItems.length) {
        throw new Error('未找到可复制的分组记录');
    }

    const text = buildCookieCredentialGroupAccountPasswordText(groupItems);
    await copyTextToClipboard(text);
    return groupItems;
}

async function editCookieCredentialItem(cardId = '') {
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const item = state.items.find((entry) => String(entry.id || '').trim() === String(cardId || '').trim()) || null;
    if (!item) {
        throw new Error('未找到可编辑的缓存记录');
    }

    setCookieCredentialEditTarget(item);
    renderCookieCredentialCacheList(state);
    return item;
}

function readCookieCredentialEditInputs() {
    return {
        account: String((editCookieAccountInput && editCookieAccountInput.value) || '').trim(),
        password: String((editCookiePasswordInput && editCookiePasswordInput.value) || '').trim(),
        note: String((editCookieNoteInput && editCookieNoteInput.value) || '').trim(),
        cardKey: String((editCookieCardKeyInput && editCookieCardKeyInput.value) || '').trim()
    };
}

async function saveCookieCredentialEditRecord() {
    const editingId = String(editingCookieCredentialId || '').trim();
    if (!editingId) {
        throw new Error('请先选择一条记录再编辑');
    }

    const { account, password, note, cardKey } = readCookieCredentialEditInputs();

    if (!account && !password) {
        throw new Error('请先填写账号或密码');
    }

    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const existingItem = state.items.find((item) => String(item.id || '').trim() === editingId) || null;
    if (!existingItem) {
        throw new Error('未找到当前正在编辑的记录');
    }

    const nextItem = normalizeCookieCredentialCacheEntry({
        id: editingId,
        account,
        password,
        note,
        cardKey,
        savedAt: new Date().toISOString()
    });
    const nextItems = state.items.filter((item) => String(item.id || '').trim() !== editingId);
    nextItems.unshift(nextItem);
    nextItems.splice(COOKIE_CREDENTIAL_CACHE_MAX_ITEMS);
    await saveCookieCredentialCacheState(nextItems);
    cookieCredentialSelectedDate = nextItem.dateKey || getTodayCookieCredentialDateKey();
    await saveCookieCredentialFilterState();
    clearCookieCredentialEditTarget();
    renderCookieCredentialCacheList({ items: nextItems });
    return nextItem;
}

async function deleteCookieCredentialItem(cardId = '') {
    const state = await loadCookieCredentialCacheState().catch(() => ({ items: [] }));
    const selectedId = String(cardId || '').trim();
    const item = state.items.find((entry) => String(entry.id || '').trim() === selectedId) || null;
    if (!item) {
        throw new Error('未找到可删除的缓存记录');
    }

    const confirmed = window.confirm(`确定删除缓存记录「${item.note || item.cardKey || item.account || '未命名'}」吗？`);
    if (!confirmed) {
        return { cancelled: true };
    }

    const nextItems = state.items.filter((entry) => String(entry.id || '').trim() !== selectedId);
    await saveCookieCredentialCacheState(nextItems);

    if (editingCookieCredentialId === selectedId) {
        clearCookieCredentialEditTarget();
    }

    renderCookieCredentialCacheList({ items: nextItems });
    return item;
}


export { focusCookieCredentialEditPanel, closeCookieCredentialEditPanel, syncCookieCredentialEditUi, setCookieCredentialEditTarget, clearCookieCredentialEditTarget, loadCookieCredentialCacheState, saveCookieCredentialCacheState, loadCookieCredentialFilterState, saveCookieCredentialFilterState, setCookieCredentialSelectedDate, setCookieCredentialSearchQuery, getCookieCredentialSelectedDateValue, getCookieCredentialVisibleItems, buildCookieCredentialDateOptions, renderCookieCredentialDateFilterOptions, buildCookieCredentialEmptyMessage, renderCookieCredentialCacheList, refreshCookieCredentialCacheUi, rerenderCookieCredentialCacheUi, copyCookieCredentialItem, copyCookieCredentialAccountPasswordItem, copyCookieCredentialAccountPasswordGroup, editCookieCredentialItem, saveCookieCredentialEditRecord, deleteCookieCredentialItem };
