'use strict';

const shared = globalThis.CookieCaptureShared || {};
const ACCOUNT_KEY = shared.STORAGE_KEYS.ACCOUNT_KEY;
const PASSWORD_KEY = shared.STORAGE_KEYS.PASSWORD_KEY;
const AUTOMATION_CARD_CACHE_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_KEY;
const AUTOMATION_CARD_CACHE_NAME_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_NAME_KEY;
const AUTOMATION_CARD_CACHE_TIME_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_TIME_KEY;
const AUTOMATION_CARD_CACHE_LIST_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_CACHE_LIST_KEY;
const AUTOMATION_CARD_SELECTED_ID_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_SELECTED_ID_KEY;
const AUTOMATION_CARD_PERSIST_PENDING_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_PERSIST_PENDING_KEY;
const AUTOMATION_CARD_RUN_INPUTS_KEY = shared.STORAGE_KEYS.AUTOMATION_CARD_RUN_INPUTS_KEY;
const LAST_MAIN_PANEL_KEY = shared.STORAGE_KEYS.LAST_MAIN_PANEL_KEY;
const STANDALONE_PROGRESS_STATE_KEY = shared.STORAGE_KEYS.STANDALONE_PROGRESS_STATE_KEY;
const TUTORIAL_URL = 'https://www.yuque.com/heysure/mn6q55/lyorlysczr8eh39b?singleDoc#';


const accountInput = document.getElementById('account');
const passwordInput = document.getElementById('password');
const copyAccountPasswordButton = document.getElementById('copy-account-password');
const generateCookiePasswordButton = document.getElementById('generate-cookie-password');
const importCardButton = document.getElementById('import-card');
const loopCardButton = document.getElementById('loop-card');
const cardFileNameNode = document.getElementById('card-file-name');
const cardCacheBadgeNode = document.getElementById('card-cache-badge');
const cardCacheListNode = document.getElementById('card-cache-list');
const cardRunInputsNode = document.getElementById('card-run-inputs');
const deleteCardButton = document.getElementById('delete-card');
const cardEditor = document.getElementById('card-editor');
const loadCardToEditorButton = document.getElementById('load-card-to-editor');
const saveCardEditorButton = document.getElementById('save-card-editor');
const exportCardButton = document.getElementById('export-card');
const appendStepButton = document.getElementById('append-step');
const stepTypeSelect = document.getElementById('step-type');
const stepNameInput = document.getElementById('step-name');
const stepSelectorInput = document.getElementById('step-selector');
const stepTextInput = document.getElementById('step-text');
const stepUrlInput = document.getElementById('step-url');
const stepTimeoutInput = document.getElementById('step-timeout');
const heroTutorialButton = document.getElementById('hero-tutorial');
const openCardSidebarButton = document.getElementById('open-card-sidebar');
const mainTabsNode = document.getElementById('main-tabs');
const mainTabButtons = Array.from(document.querySelectorAll('[data-main-tab]'));
const mainPanels = Array.from(document.querySelectorAll('[data-main-panel]'));
const toastStackNode = document.getElementById('toast-stack');
const sidebarEditorShell = document.getElementById('sidebar-editor-shell');
const sidebarCardNameInput = document.getElementById('sidebar-card-name');
const sidebarCardWebsiteInput = document.getElementById('sidebar-card-website');
const sidebarCardDescriptionInput = document.getElementById('sidebar-card-description');
const sidebarCardPointsInput = document.getElementById('sidebar-card-points');
const sidebarCardPopupsInput = document.getElementById('sidebar-card-popups');
const sidebarCardUploadServerUrlInput = document.getElementById('sidebar-card-upload-server-url');
const sidebarCardUploadCardKeyInput = document.getElementById('sidebar-card-upload-card-key');
const sidebarCardRawJsonInput = document.getElementById('sidebar-card-raw-json');
const sidebarCloseButton = document.getElementById('sidebar-close');
const sidebarStepListNode = document.getElementById('sidebar-step-list');
const sidebarEditorMetaNode = document.getElementById('sidebar-editor-meta');
const sidebarFlowCanvasNode = document.getElementById('sidebar-flow-canvas');
const sidebarFlowViewportNode = document.getElementById('sidebar-flow-viewport');
const sidebarFlowSvgNode = document.getElementById('sidebar-flow-svg');
const sidebarFlowNodesNode = document.getElementById('sidebar-flow-nodes');
const sidebarFlowEmptyNode = document.getElementById('sidebar-flow-empty');

const debugProgressPanel = document.getElementById('debug-progress-panel');
const debugProgressTextNode = document.getElementById('debug-progress-text');
const debugProgressPercentNode = document.getElementById('debug-progress-percent');
const debugProgressFillNode = document.getElementById('debug-progress-fill');
const debugProgressMetaNode = document.getElementById('debug-progress-meta');
const debugProgressErrorNode = document.getElementById('debug-progress-error');
const runControlStopButton = document.getElementById('run-control-stop');
const debugControlLabel = document.querySelector('.debug-control-label');

let activeDebugErrorReason = '';
let debugProgressAutoHideTimer = null;

const runtimeStateStorage = chrome.storage.session || chrome.storage.local;

let sidebarFlowState = { version: 1, start: '', nodes: [], edges: [] };
let sidebarSelectedFlowNodeId = '';
let sidebarSelectedFlowNodeIds = new Set();
let sidebarFlowConnectMode = false;
let sidebarFlowConnectSourceId = '';
let sidebarFlowConnectSourcePort = 'right';
let sidebarFlowConnectLabel = 'next';
let sidebarFlowPortDragState = null;
let sidebarFlowDragState = null;
let sidebarFlowPanState = null;
let sidebarFlowViewState = { scale: 1, x: 0, y: 0 };
let sidebarFlowSuppressNodeClick = false;

const {
    sanitizeFilePart,
    buildPresetFileName,
    generateCookiePassword,
    setStatus,
    copyTextToClipboard,
    downloadJsonFile,
    showToast,
    showActionToast,
    buildCardExportFileName,
    normalizeCardData,
    stringifyCardData,
    parseEditorCardData,
    escapeHtml,
    setCardFileName
} = shared;

async function openTutorialPage() {
    await chrome.tabs.create({
        url: TUTORIAL_URL,
        active: true
    });
}

async function loadLastMainPanel() {
    const stored = await chrome.storage.local.get([LAST_MAIN_PANEL_KEY]).catch(() => ({}));
    const value = stored && typeof stored === 'object' ? String(stored[LAST_MAIN_PANEL_KEY] || '').trim() : '';
    return ['card', 'cookie'].includes(value) ? value : 'card';
}

async function saveLastMainPanel(panelName = 'card') {
    const normalized = ['card', 'cookie'].includes(String(panelName || '').trim())
        ? String(panelName || '').trim()
        : 'card';
    await chrome.storage.local.set({
        [LAST_MAIN_PANEL_KEY]: normalized
    }).catch(() => {});
    return normalized;
}

function activateMainPanel(panelName = 'card', options = {}) {
    const normalized = String(panelName || 'card').trim() || 'card';

    mainPanels.forEach((panel) => {
        const active = String(panel.dataset.mainPanel || '').trim() === normalized;
        panel.classList.toggle('is-active', active);
    });

    mainTabButtons.forEach((button) => {
        const active = String(button.dataset.mainTab || '').trim() === normalized;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (options.persist !== false) {
        void saveLastMainPanel(normalized);
    }
}

mainTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
        activateMainPanel(String(button.dataset.mainTab || 'card').trim() || 'card');
    });
});

function setCardCacheBadge(text = '') {
    if (!cardCacheBadgeNode) {
        return;
    }
    cardCacheBadgeNode.textContent = text || '无';
}

function buildCardCacheId(cardData = {}, sourceName = '') {
    const namePart = sanitizeFilePart(String(cardData?.name || sourceName || 'automation'));
    const timePart = new Date().toISOString().replace(/[:.]/g, '-');
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${namePart || 'automation'}_${timePart}_${randomPart}`;
}

function normalizeCardCacheEntry(entry = {}, index = 0) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const cardName = firstCardCacheText(source, ['cardName', 'name']) || `automation_${index + 1}`;
    const sourceName = firstCardCacheText(source, ['sourceName', 'fileName']);
    const cardData = normalizeCardData(source.cardData || source, cardName, { allowEmptySteps: true });
    const id = firstCardCacheText(source, ['id', 'cacheId'])
        || buildCardCacheId(cardData, sourceName || cardName);
    return {
        id,
        cardData,
        cardName: firstCardCacheText(source, ['cardName']) || cardData.name,
        sourceName,
        savedAt: firstCardCacheText(source, ['savedAt', 'updatedAt']) || new Date().toISOString(),
        selected: source.selected === true
    };
}

function firstCardCacheText(source, keys) {
    for (const key of keys) {
        const value = String(source?.[key] || '').trim();
        if (value) return value;
    }
    return '';
}

function buildCardListLabel(item = {}, isSelected = false) {
    const savedAt = String(item.savedAt || '').trim();
    const stepsCount = Array.isArray(item.cardData?.steps) ? item.cardData.steps.length : 0;
    const savedAtText = savedAt ? (() => {
        const date = new Date(savedAt);
        return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString('zh-CN', { hour12: false });
    })() : '';
    const metaParts = [
        stepsCount > 0 ? `${stepsCount} 步` : '无步骤',
        savedAtText
    ].filter(Boolean);
    return {
        title: String(item.cardData?.name || item.cardName || '未命名自动化卡片').trim() || '未命名自动化卡片',
        meta: metaParts.join(' · '),
        selected: isSelected
    };
}

async function renderCardCacheList(state = { items: [], selectedId: '' }) {
    if (!cardCacheListNode) return;

    const items = Array.isArray(state.items) ? state.items : [];
    const selectedId = String(state.selectedId || '').trim();
    if (cardCacheBadgeNode) cardCacheBadgeNode.textContent = `${items.length} 张`;

    if (items.length === 0) {
        cardCacheListNode.innerHTML = '<div class="card-cache-empty">暂无已缓存卡片，导入后会显示在这里。</div>';
        if (cardFileNameNode) cardFileNameNode.textContent = '未选择卡片';
        return;
    }

    cardCacheListNode.innerHTML = items.map((item, index) => {
        const active = String(item.id || '').trim() === selectedId;
        const label = buildCardListLabel(item, active);
        const timeText = label.meta ? `<div class="card-cache-item__meta">${escapeHtml(label.meta)}</div>` : '';
        return `
          <div class="card-cache-item${active ? ' is-active' : ''}" data-card-cache-item data-card-id="${escapeHtml(item.id)}">
            <div>
              <div class="card-cache-item__title">${escapeHtml(label.title)}</div>
              ${timeText}
            </div>
            <div class="card-cache-item__actions">
              ${active ? '<div class="chip">已选中</div>' : '<div class="chip">未选中</div>'}
            </div>
          </div>
        `;
    }).join('');

    const selectedItem = items.find((item) => String(item.id || '').trim() === selectedId) || items[0] || null;
    if (cardFileNameNode) cardFileNameNode.textContent = resolveCardCacheDisplayName(selectedItem);
    await renderCardRunInputs(selectedItem ? selectedItem.cardData : null);
}

function resolveCardCacheDisplayName(item) {
    if (!item) return '未选择卡片';
    return item.cardData?.name || item.cardName || '未命名自动化卡片';
}

// 运行前「变量输入」面板：为选中卡片的每个 type 步骤渲染一个输入框，默认值=步骤 text；
// 开始执行/循环执行时把这些框收集为 inputs 传给后台，按变量键覆盖对应步骤的输入文本。
function collectUniqueCardRunVariables(cardData) {
    const seen = new Set();
    return getCardTypeStepVariables(cardData || {}).filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
    });
}

async function renderCardRunInputs(cardData) {
    if (!cardRunInputsNode) return;

    const targetCardName = String((cardData && cardData.name) || '').trim();
    preservePreviousCardRunInputs(targetCardName);
    // 相同变量键（如手动填了相同 variable）只显示一个框，共同控制多步
    const uniqueVariables = collectUniqueCardRunVariables(cardData);

    if (!hasRunnableCardSteps(cardData)) {
        clearCardRunInputsPanel();
        return;
    }

    if (uniqueVariables.length === 0) {
        // 有卡片但没有 type（输入内容）步骤：给出可见提示，避免以为面板没渲染
        renderEmptyCardRunVariables(targetCardName);
        return;
    }

    // 保留用户已填写的值：
    // - 同一 DOM 会话用 previousValues
    // - 持久化缓存（loadCardRunInputsCache）让跨 popup 打开、卡片切换后仍记住上次输入
    // - 最后才回退到卡片定义里的 defaultText
    // 优先级：DOM 现值 > 缓存值 > 默认 text
    const signature = `${String(cardData.name || '')}::${uniqueVariables.map((item) => `${item.key}=${item.defaultText}`).join('|')}`;
    const sameCard = cardRunInputsNode.dataset.cardSignature === signature;
    const previousValues = sameCard ? collectCardRunInputs() : {};

    // 从缓存加载本卡片上次用户输入（跨 popup 打开也有效）
    const savedValues = await loadSavedCardRunInputs(targetCardName);
    const rows = uniqueVariables.map((item) => buildCardRunInputRow(item, previousValues, savedValues)).join('');
    cardRunInputsNode.dataset.cardSignature = signature;
    cardRunInputsNode.dataset.cardName = targetCardName;

    cardRunInputsNode.innerHTML = `
      <div class="card-run-inputs__title">变量输入（运行前可覆盖，共 ${uniqueVariables.length} 项）</div>
      <div class="card-run-inputs__list">${rows}</div>
    `;
    cardRunInputsNode.hidden = false;

    // 绑定自动保存：用户打字时记住到缓存
    attachRunInputsAutoSave(targetCardName);
}

function preservePreviousCardRunInputs(targetCardName) {
    const previousCardName = cardRunInputsNode.dataset.cardName || '';
    if (!previousCardName || previousCardName === targetCardName) return;
    const values = collectCardRunInputs();
    if (Object.keys(values).length) saveCardRunInputsForCard(previousCardName, values).catch(() => {});
}

function hasRunnableCardSteps(cardData) {
    return Boolean(cardData) && Array.isArray(cardData.steps) && cardData.steps.length > 0;
}

function clearCardRunInputsPanel() {
    cardRunInputsNode.hidden = true;
    cardRunInputsNode.innerHTML = '';
    delete cardRunInputsNode.dataset.cardSignature;
    delete cardRunInputsNode.dataset.cardName;
}

function renderEmptyCardRunVariables(targetCardName) {
    cardRunInputsNode.innerHTML = `
      <div class="card-run-inputs__title">变量输入</div>
      <div class="card-run-inputs__empty">该卡片没有「输入内容(type)」步骤，无需变量输入。</div>
    `;
    cardRunInputsNode.hidden = false;
    delete cardRunInputsNode.dataset.cardSignature;
    cardRunInputsNode.dataset.cardName = targetCardName;
}

async function loadSavedCardRunInputs(cardName) {
    try {
        const cache = await loadCardRunInputsCache();
        return cache[cardName] || {};
    } catch (_error) {
        return {};
    }
}

function buildCardRunInputRow(item, previousValues, savedValues) {
    const hasPrevious = Object.prototype.hasOwnProperty.call(previousValues, item.key);
    const hasSaved = Object.prototype.hasOwnProperty.call(savedValues, item.key);
    const value = hasPrevious ? previousValues[item.key] : (hasSaved ? savedValues[item.key] : item.defaultText);
    return `
      <div class="card-run-input">
        <label>步骤${item.stepIndex} · ${escapeHtml(item.label)} · <code>${escapeHtml(item.key)}</code></label>
        <input type="text" data-run-input-key="${escapeHtml(item.key)}" value="${escapeHtml(value)}" placeholder="默认: ${escapeHtml(item.defaultText || '(空)')}">
      </div>
    `;
}

// 收集面板里各变量框的当前值为 { 变量键: 值 } 对象；无面板/无变量时返回空对象。
function collectCardRunInputs() {
    if (!cardRunInputsNode || cardRunInputsNode.hidden) {
        return {};
    }
    const inputs = {};
    cardRunInputsNode.querySelectorAll('[data-run-input-key]').forEach((node) => {
        const key = String(node.dataset.runInputKey || '').trim();
        if (key) {
            inputs[key] = String(node.value || '');
        }
    });
    return inputs;
}

// 变量输入持久化：把用户在「变量输入」面板填的值按卡片名称记住到 storage，
// 下次打开同一卡片时自动带回上次填写的内容，而不是重置为步骤默认 text。
async function loadCardRunInputsCache() {
    try {
        const stored = await chrome.storage.local.get([AUTOMATION_CARD_RUN_INPUTS_KEY]);
        const data = stored && stored[AUTOMATION_CARD_RUN_INPUTS_KEY];
        return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (_e) {
        return {};
    }
}

async function saveCardRunInputsForCard(cardName, inputs = {}) {
    const name = String(cardName || '').trim();
    if (!name) return;
    try {
        const cache = await loadCardRunInputsCache();
        cache[name] = { ...(inputs || {}) };
        await chrome.storage.local.set({ [AUTOMATION_CARD_RUN_INPUTS_KEY]: cache });
    } catch (_e) {}
}

function attachRunInputsAutoSave(cardName) {
    if (!cardRunInputsNode) return;
    const name = String(cardName || '').trim();
    if (!name) return;

    let saveTimer = null;
    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const vals = collectCardRunInputs();
            saveCardRunInputsForCard(name, vals).catch(() => {});
            saveTimer = null;
        }, 250);
    };

    cardRunInputsNode.querySelectorAll('[data-run-input-key]').forEach((el) => {
        el.addEventListener('input', scheduleSave);
        el.addEventListener('change', scheduleSave);
    });
}
