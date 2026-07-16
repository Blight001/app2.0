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
    const cardData = normalizeCardData(source.cardData || source, source.cardName || source.name || `automation_${index + 1}`, { allowEmptySteps: true });
    const id = String(source.id || source.cacheId || '').trim() || buildCardCacheId(cardData, source.sourceName || source.fileName || source.cardName || '');
    return {
        id,
        cardData,
        cardName: String(source.cardName || cardData.name || '').trim() || cardData.name,
        sourceName: String(source.sourceName || source.fileName || '').trim(),
        savedAt: String(source.savedAt || source.updatedAt || new Date().toISOString()).trim(),
        selected: source.selected === true
    };
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
    if (!cardCacheListNode) {
        return;
    }

    const items = Array.isArray(state.items) ? state.items : [];
    const selectedId = String(state.selectedId || '').trim();
    if (cardCacheBadgeNode) {
        cardCacheBadgeNode.textContent = items.length > 0 ? `${items.length} 张` : '0 张';
    }

    if (items.length === 0) {
        cardCacheListNode.innerHTML = '<div class="card-cache-empty">暂无已缓存卡片，导入后会显示在这里。</div>';
        if (cardFileNameNode) {
            cardFileNameNode.textContent = '未选择卡片';
        }
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
    if (cardFileNameNode) {
        cardFileNameNode.textContent = selectedItem ? selectedItem.cardData?.name || selectedItem.cardName || '未命名自动化卡片' : '未选择卡片';
    }
    await renderCardRunInputs(selectedItem ? selectedItem.cardData : null);
}

// 运行前「变量输入」面板：为选中卡片的每个 type 步骤渲染一个输入框，默认值=步骤 text；
// 开始执行/循环执行时把这些框收集为 inputs 传给后台，按变量键覆盖对应步骤的输入文本。
async function renderCardRunInputs(cardData) {
    if (!cardRunInputsNode) {
        return;
    }

    const targetCardName = String((cardData && cardData.name) || '').trim();

    // 无论是否有变量，都先尝试保存上一个卡片的输入值（切换或清空时）
    const previousCardName = cardRunInputsNode.dataset.cardName || '';
    if (previousCardName && previousCardName !== targetCardName) {
        const prevVals = collectCardRunInputs();
        if (Object.keys(prevVals).length > 0) {
            saveCardRunInputsForCard(previousCardName, prevVals).catch(() => {});
        }
    }

    const variables = getCardTypeStepVariables(cardData || {});
    // 相同变量键（如手动填了相同 variable）只显示一个框，共同控制多步
    const seen = new Set();
    const uniqueVariables = [];
    variables.forEach((item) => {
        if (seen.has(item.key)) {
            return;
        }
        seen.add(item.key);
        uniqueVariables.push(item);
    });

    if (!cardData || !Array.isArray(cardData.steps) || cardData.steps.length === 0) {
        // 未选中卡片 / 卡片无步骤：隐藏面板
        cardRunInputsNode.hidden = true;
        cardRunInputsNode.innerHTML = '';
        delete cardRunInputsNode.dataset.cardSignature;
        delete cardRunInputsNode.dataset.cardName;
        return;
    }

    if (uniqueVariables.length === 0) {
        // 有卡片但没有 type（输入内容）步骤：给出可见提示，避免以为面板没渲染
        cardRunInputsNode.innerHTML = `
          <div class="card-run-inputs__title">变量输入</div>
          <div class="card-run-inputs__empty">该卡片没有「输入内容(type)」步骤，无需变量输入。</div>
        `;
        cardRunInputsNode.hidden = false;
        delete cardRunInputsNode.dataset.cardSignature;
        cardRunInputsNode.dataset.cardName = targetCardName;  // 记录当前卡片名（即使无变量）
        return;
    }

    // 保留用户已填写的值：
    // - 同一 DOM 会话用 previousValues
    // - 持久化缓存（loadCardRunInputsCache）让跨 popup 打开、卡片切换后仍记住上次输入
    // - 最后才回退到卡片定义里的 defaultText
    // 优先级：DOM 现值 > 缓存值 > 默认 text
    const signature = `${String(cardData.name || '')}::${uniqueVariables.map((item) => `${item.key}=${item.defaultText}`).join('|')}`;
    const sameCard = cardRunInputsNode.dataset.cardSignature === signature;
    const previousValues = {};
    if (sameCard) {
        cardRunInputsNode.querySelectorAll('[data-run-input-key]').forEach((node) => {
            const key = String(node.dataset.runInputKey || '').trim();
            if (key) {
                previousValues[key] = String(node.value || '');
            }
        });
    }

    // 从缓存加载本卡片上次用户输入（跨 popup 打开也有效）
    let savedValues = {};
    try {
        const cache = await loadCardRunInputsCache();
        savedValues = cache[targetCardName] || {};
    } catch (_e) {
        savedValues = {};
    }

    const rows = uniqueVariables.map((item) => {
        let currentValue;
        if (Object.prototype.hasOwnProperty.call(previousValues, item.key)) {
            currentValue = previousValues[item.key];
        } else if (Object.prototype.hasOwnProperty.call(savedValues, item.key)) {
            currentValue = savedValues[item.key];
        } else {
            currentValue = item.defaultText;
        }
        return `
      <div class="card-run-input">
        <label>步骤${item.stepIndex} · ${escapeHtml(item.label)} · <code>${escapeHtml(item.key)}</code></label>
        <input type="text" data-run-input-key="${escapeHtml(item.key)}" value="${escapeHtml(currentValue)}" placeholder="默认: ${escapeHtml(item.defaultText || '(空)')}">
      </div>
    `;
    }).join('');
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

function normalizeProgressValue(value = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }
    return Math.max(0, Math.min(100, number));
}

function clearDebugProgressAutoHideTimer() {
    if (debugProgressAutoHideTimer) {
        clearTimeout(debugProgressAutoHideTimer);
        debugProgressAutoHideTimer = null;
    }
}

function scheduleDebugProgressAutoHide(delayMs = 3000) {
    clearDebugProgressAutoHideTimer();
    debugProgressAutoHideTimer = window.setTimeout(() => {
        debugProgressAutoHideTimer = null;
        resetDebugProgress();
    }, delayMs);
}

function setDebugProgress(state = {}) {
    if (!debugProgressPanel) {
        return;
    }

    clearDebugProgressAutoHideTimer();

    const hasProgress = Number.isFinite(Number(state.progress));
    const progress = hasProgress ? normalizeProgressValue(state.progress) : null;
    const text = String(state.message || '等待执行').trim() || '等待执行';
    const meta = String(state.meta || '').trim();
    const hasErrorReason = Object.prototype.hasOwnProperty.call(state, 'errorReason');
    const nextErrorReason = hasErrorReason ? String(state.errorReason || '').trim() : activeDebugErrorReason;
    const phase = String(state.phase || '').trim();
    const visible = state.visible !== false;

    if (hasErrorReason) {
        activeDebugErrorReason = nextErrorReason;
    } else if (state.kind !== 'error' && ['start', 'password_ready', 'step_start', 'step_complete', 'step_skip', 'save_cookies', 'finished', 'debug_complete'].includes(phase)) {
        activeDebugErrorReason = '';
    }

    debugProgressPanel.classList.toggle('is-visible', visible);
    debugProgressPanel.classList.toggle('is-error', state.kind === 'error');

    if (hasProgress && debugProgressFillNode) {
        debugProgressFillNode.style.width = `${progress}%`;
    }
    if (hasProgress && debugProgressPercentNode) {
        debugProgressPercentNode.textContent = `${Math.round(progress)}%`;
    }
    if (debugProgressTextNode) {
        debugProgressTextNode.textContent = text;
    }

    // 失败态强制显示 0%（匹配执行进度失败展示）
    if (state.kind === 'error' || phase === 'failed') {
        if (debugProgressFillNode) {
            debugProgressFillNode.style.width = '0%';
        }
        if (debugProgressPercentNode) {
            debugProgressPercentNode.textContent = '0%';
        }
    }
    if (debugProgressMetaNode) {
        debugProgressMetaNode.textContent = meta;
    }
    if (debugProgressErrorNode) {
        debugProgressErrorNode.textContent = activeDebugErrorReason ? `错误原因：${activeDebugErrorReason}` : '';
    }

    if (runControlStopButton) {
        const showRunStop = visible;
        runControlStopButton.disabled = !showRunStop;
        runControlStopButton.hidden = !showRunStop;
        if (showRunStop) {
            const isErrorState = state.kind === 'error' || phase === 'failed';
            const hasStep = Number(state.stepIndex || 0) > 0;
            if (isErrorState && hasStep) {
                runControlStopButton.textContent = '继续';
                runControlStopButton.title = `从失败的步骤 ${state.stepIndex} 继续/重试`;
                runControlStopButton.dataset.action = 'continue';
            } else {
                runControlStopButton.textContent = '停止';
                runControlStopButton.title = '停止执行';
                runControlStopButton.dataset.action = 'stop';
            }
        }
    }

    if (debugControlLabel) {
        if (state.kind === 'error' || phase === 'failed') {
            debugControlLabel.textContent = '当前：执行失败';
        } else if (phase === 'stopped') {
            debugControlLabel.textContent = '当前：已停止';
        } else if (state.running === false) {
            debugControlLabel.textContent = '当前：执行结束';
        } else {
            debugControlLabel.textContent = '当前：自动化执行中';
        }
    }
}

function resetDebugProgress() {
    clearDebugProgressAutoHideTimer();
    if (!debugProgressPanel) {
        return;
    }

    debugProgressPanel.classList.remove('is-visible', 'is-error');
    if (debugProgressFillNode) {
        debugProgressFillNode.style.width = '0%';
    }
    if (debugProgressPercentNode) {
        debugProgressPercentNode.textContent = '0%';
    }
    if (debugProgressTextNode) {
        debugProgressTextNode.textContent = '等待执行';
    }
    if (debugProgressMetaNode) {
        debugProgressMetaNode.textContent = '';
    }
    if (debugProgressErrorNode) {
        debugProgressErrorNode.textContent = '';
    }
    activeDebugErrorReason = '';
    if (runControlStopButton) {
        runControlStopButton.hidden = true;
        runControlStopButton.disabled = true;
        runControlStopButton.textContent = '停止';
        runControlStopButton.title = '停止执行';
        runControlStopButton.dataset.action = 'stop';
    }
    if (debugControlLabel) {
        debugControlLabel.textContent = '当前：自动化执行中';
    }
}

async function loadStandaloneProgressState() {
    const stored = await runtimeStateStorage.get([STANDALONE_PROGRESS_STATE_KEY]).catch(() => ({}));
    const state = stored && typeof stored === 'object' ? stored[STANDALONE_PROGRESS_STATE_KEY] : null;
    if (!state || typeof state !== 'object') {
        return null;
    }

    const progressValue = Number(state.progress);
    return {
        tabId: Number(state.tabId || 0) || null,
        cardName: String(state.cardName || '').trim(),
        message: String(state.message || '等待执行').trim() || '等待执行',
        phase: String(state.phase || '').trim(),
        mode: String(state.mode || '').trim(),
        isLooping: state.isLooping === true,
        kind: String(state.kind || '').trim(),
        errorReason: String(state.errorReason || '').trim(),
        stepIndex: Number(state.stepIndex || 0) || 0,
        stepTotal: Number(state.stepTotal || 0) || 0,
        stepName: String(state.stepName || '').trim(),
        previousStepName: String(state.previousStepName || '').trim(),
        nextStepName: String(state.nextStepName || '').trim(),
        running: state.running === true,
        visible: state.visible !== false,
        progress: Number.isFinite(progressValue) ? progressValue : undefined,
        updatedAt: String(state.updatedAt || '').trim()
    };
}



const STEP_TYPE_LABELS = {
    navigate: '访问网页',
    click: '点击元素',
    type: '输入内容',
    wait: '等待条件',
    condition: '判断分支',
    get_credits: '获取积分',
    save_cookies: '获取Cookie',
    clear_current_page_cache: '清理当前页缓存',
    external_script: '执行脚本',
    screenshot: '截图'
};

function formatStepTypeLabel(stepType = '') {
    const normalized = String(stepType || '').trim();
    return STEP_TYPE_LABELS[normalized] || normalized || '步骤';
}

function setLoopButtonState(isRunning = false) {
    const label = isRunning ? '停止执行' : '循环执行';
    if (loopCardButton) {
        loopCardButton.textContent = label;
        loopCardButton.setAttribute('aria-pressed', isRunning ? 'true' : 'false');
    }
}

async function refreshLoopButtonState() {
    try {
        const state = await loadStandaloneProgressState();
        const isRunning = Boolean(state && state.running === true);
        setLoopButtonState(isRunning);
        return isRunning;
    } catch (_error) {
        setLoopButtonState(false);
        return false;
    }
}

async function sendStopAction() {
    const response = await chrome.runtime.sendMessage({
        type: 'card-run-stop',
        payload: {}
    });

    if (!response || response.success !== true) {
        throw new Error(response?.error || '停止执行失败');
    }

    return response;
}

async function sendContinueAction() {
    const state = await loadStandaloneProgressState().catch(() => null);
    const stepIndex = Number(state && state.stepIndex || 0);
    if (!stepIndex || stepIndex < 1) {
        throw new Error('没有可继续的失败步骤信息');
    }

    let cardData = null;
    try {
        const cacheState = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
        const selected = (cacheState.items || []).find((it) => it && it.id === cacheState.selectedId) || (cacheState.items || [])[0];
        cardData = selected && selected.cardData ? selected.cardData : null;
    } catch (_) {}
    if (!cardData) {
        throw new Error('无法加载当前卡片数据以继续执行');
    }

    const inputs = typeof collectCardRunInputs === 'function' ? collectCardRunInputs() : {};
    const response = await chrome.runtime.sendMessage({
        type: 'card-run-start',
        payload: {
            cardData,
            start_step: stepIndex,
            inputs
        }
    });

    if (response && response.success === false && response.error) {
        throw new Error(response.error);
    }
    return response;
}

function setCardEditorValue(cardData) {
    if (!cardEditor) {
        return;
    }
    cardEditor.value = stringifyCardData(cardData || {});
}

function getCardEditorValue() {
    return String(cardEditor?.value || '');
}

// 变量键推导（须与后台 03_formatting.js 的 resolveStepVariableKey 保持一致）：
// 取步骤显式 variable 字段，否则按其在全部 type 步骤中的顺序回退为 var1/var2/...（1-based）。
function resolveStepVariableKey(step = {}, typeOrdinal = 1) {
    const explicit = String((step && step.variable) || '').trim();
    if (explicit) {
        return explicit;
    }
    const ordinal = Number.isFinite(Number(typeOrdinal)) && Number(typeOrdinal) > 0 ? Math.floor(Number(typeOrdinal)) : 1;
    return `var${ordinal}`;
}

// 收集卡片里全部 type 步骤对应的变量输入槽（用于运行前的「变量输入」面板）。
// 返回 [{ key, label, stepIndex, defaultText }]，按步骤顺序排列。
function getCardTypeStepVariables(cardData = {}) {
    const steps = Array.isArray(cardData?.steps) ? cardData.steps : [];
    const variables = [];
    let typeOrdinal = 0;
    steps.forEach((step, index) => {
        if (!step || typeof step !== 'object') {
            return;
        }
        if (String(step.type || '').trim().toLowerCase() !== 'type') {
            return;
        }
        typeOrdinal += 1;
        const key = resolveStepVariableKey(step, typeOrdinal);
        const stepName = String(step.name || `步骤${index + 1}`).trim() || `步骤${index + 1}`;
        variables.push({
            key,
            label: stepName,
            stepIndex: index + 1,
            defaultText: String(step.text || '')
        });
    });
    return variables;
}

function isSidebarLayout() {
    return String(document.documentElement?.dataset.layout || '').trim() === 'sidebar';
}

function sanitizeSidebarStepIdPart(value = '') {
    const text = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return text || 'step';
}

function buildSidebarStepId(step = {}, index = 0, usedIds = new Set()) {
    const explicit = String(step?.id || step?.step_id || step?.nodeId || '').trim();
    let base = explicit || `${sanitizeSidebarStepIdPart(step?.name || step?.type || 'step')}_${index + 1}`;
    base = base.replace(/\s+/g, '_');
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
}

function ensureSidebarStepIds(steps = []) {
    const usedIds = new Set();
    return (Array.isArray(steps) ? steps : []).map((step, index) => {
        const source = step && typeof step === 'object' ? step : {};
        return {
            ...source,
            id: buildSidebarStepId(source, index, usedIds)
        };
    });
}

function getSidebarStepId(step = {}, index = 0) {
    return String(step?.id || step?.step_id || step?.nodeId || `step_${index + 1}`).trim();
}

function buildSidebarFlowEdgeId(from = '', to = '', label = '', index = 0) {
    const fromPart = sanitizeSidebarStepIdPart(from);
    const toPart = sanitizeSidebarStepIdPart(to);
    const labelPart = sanitizeSidebarStepIdPart(label || 'next');
    return `edge_${fromPart}_${toPart}_${labelPart}_${index + 1}`;
}

function getSidebarFlowLayoutForIndex(index = 0) {
    return {
        x: 34 + index * 220,
        y: 60
    };
}

function normalizeSidebarFlowForSteps(flow = null, steps = []) {
    const safeSteps = ensureSidebarStepIds(steps);
    const stepIds = safeSteps.map((step, index) => getSidebarStepId(step, index)).filter(Boolean);
    const stepIdSet = new Set(stepIds);
    const hasExplicitFlow = !!(flow && typeof flow === 'object' && !Array.isArray(flow));
    const source = hasExplicitFlow ? flow : {};
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const sourceEdges = Array.isArray(source.edges) ? source.edges : [];
    const nodeById = new Map();

    sourceNodes.forEach((node) => {
        const id = String(node?.id || node?.stepId || '').trim();
        if (!id || !stepIdSet.has(id)) {
            return;
        }
        nodeById.set(id, {
            id,
            x: Number.isFinite(Number(node.x)) ? Number(node.x) : undefined,
            y: Number.isFinite(Number(node.y)) ? Number(node.y) : undefined
        });
    });

    const nodes = safeSteps.map((step, index) => {
        const id = getSidebarStepId(step, index);
        const existing = nodeById.get(id) || {};
        const fallback = getSidebarFlowLayoutForIndex(index);
        return {
            id,
            x: Number.isFinite(Number(existing.x)) ? Math.max(0, Number(existing.x)) : fallback.x,
            y: Number.isFinite(Number(existing.y)) ? Math.max(0, Number(existing.y)) : fallback.y
        };
    });

    let edges = sourceEdges
        .map((edge, index) => {
            const from = String(edge?.from || edge?.source || edge?.fromId || '').trim();
            const to = String(edge?.to || edge?.target || edge?.toId || '').trim();
            if (!from || !to || !stepIdSet.has(from) || !stepIdSet.has(to) || from === to) {
                return null;
            }
            const label = String(edge?.label || edge?.branch || edge?.condition || 'next').trim() || 'next';
            const fromPort = String(edge?.fromPort || edge?.sourcePort || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
            const toPort = String(edge?.toPort || edge?.targetPort || '').trim().toLowerCase() === 'right' ? 'right' : 'left';
            return {
                id: String(edge?.id || '').trim() || buildSidebarFlowEdgeId(from, to, label, index),
                from,
                to,
                label,
                fromPort,
                toPort
            };
        })
        .filter(Boolean);

    const edgeKeys = new Set();
    edges = edges.filter((edge) => {
        const key = `${edge.from}::${edge.to}::${edge.label}`;
        if (edgeKeys.has(key)) {
            return false;
        }
        edgeKeys.add(key);
        return true;
    });

    if (edges.length === 0 && !hasExplicitFlow && stepIds.length > 1) {
        edges = stepIds.slice(0, -1).map((from, index) => {
            const to = stepIds[index + 1];
            return {
                id: buildSidebarFlowEdgeId(from, to, 'next', index),
                from,
                to,
                label: 'next',
                fromPort: 'right',
                toPort: 'left'
            };
        });
    }

    const start = String(source.start || source.start_node_id || source.startNodeId || '').trim();
    return {
        version: 1,
        start: stepIdSet.has(start) ? start : (stepIds[0] || ''),
        nodes,
        edges
    };
}

function getSidebarFlowNode(stepId = '') {
    const id = String(stepId || '').trim();
    return sidebarFlowState.nodes.find((node) => String(node.id || '') === id) || null;
}

function getSidebarFlowStepById(steps = [], stepId = '') {
    const id = String(stepId || '').trim();
    return (Array.isArray(steps) ? steps : []).find((step, index) => getSidebarStepId(step, index) === id) || null;
}

function buildSidebarFlowNodeMeta(step = {}) {
    const selector = String(step?.selector || '').trim();
    const url = String(step?.url || '').trim();
    const text = String(step?.text || step?.wait_for_text || '').trim();
    const script = String(step?.script || '').trim();
    const mode = String(step?.condition_mode || step?.condition || '').trim();
    const value = selector || url || text || script || mode;
    if (!value) {
        return '';
    }
    return value.length > 42 ? `${value.slice(0, 39)}...` : value;
}

function getSidebarFlowCanvasSize(nodes = []) {
    const maxX = nodes.reduce((value, node) => Math.max(value, Number(node.x || 0)), 0);
    const maxY = nodes.reduce((value, node) => Math.max(value, Number(node.y || 0)), 0);
    return {
        width: Math.max(680, maxX + 230),
        height: Math.max(360, maxY + 130)
    };
}

function renderSidebarFlowCanvas(cardData = null) {
    if (!isSidebarLayout() || !sidebarFlowCanvasNode || !sidebarFlowSvgNode || !sidebarFlowNodesNode) {
        return;
    }

    const steps = ensureSidebarStepIds(Array.isArray(cardData?.steps) ? cardData.steps : collectSidebarSteps());
    sidebarFlowState = normalizeSidebarFlowForSteps(cardData?.flow || sidebarFlowState, steps);
    const validStepIds = new Set(steps.map((step, index) => getSidebarStepId(step, index)));
    sidebarSelectedFlowNodeIds = new Set(Array.from(sidebarSelectedFlowNodeIds).filter((id) => validStepIds.has(id)));
    if (sidebarSelectedFlowNodeId && !steps.some((step, index) => getSidebarStepId(step, index) === sidebarSelectedFlowNodeId)) {
        sidebarSelectedFlowNodeId = '';
    }
    if (sidebarFlowConnectSourceId && !steps.some((step, index) => getSidebarStepId(step, index) === sidebarFlowConnectSourceId)) {
        sidebarFlowConnectSourceId = '';
        sidebarFlowConnectSourcePort = 'right';
        sidebarFlowConnectMode = false;
    }

    const size = getSidebarFlowCanvasSize(sidebarFlowState.nodes);
    sidebarFlowSvgNode.setAttribute('width', String(size.width));
    sidebarFlowSvgNode.setAttribute('height', String(size.height));
    sidebarFlowSvgNode.style.width = `${size.width}px`;
    sidebarFlowSvgNode.style.height = `${size.height}px`;
    sidebarFlowNodesNode.style.width = `${size.width}px`;
    sidebarFlowNodesNode.style.height = `${size.height}px`;
    if (sidebarFlowViewportNode) {
        sidebarFlowViewportNode.style.width = `${size.width}px`;
        sidebarFlowViewportNode.style.height = `${size.height}px`;
    }
    applySidebarFlowViewTransform();
    sidebarFlowCanvasNode.classList.toggle('is-connect-mode', sidebarFlowConnectMode);
    if (sidebarFlowEmptyNode) {
        sidebarFlowEmptyNode.classList.toggle('is-hidden', steps.length > 0);
    }
    const nodeMap = new Map(sidebarFlowState.nodes.map((node) => [String(node.id || ''), node]));
    const edgeMarkup = sidebarFlowState.edges.map((edge) => {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (!from || !to) {
            return '';
        }
        const sourceStep = getSidebarFlowStepById(steps, edge.from) || {};
        const sourceIsCondition = String(sourceStep.type || '').trim().toLowerCase() === 'condition';
        const edgeLabel = String(edge.label || 'next').trim().toLowerCase();
        const fromPort = edge.fromPort === 'left' ? 'left' : 'right';
        const toPort = edge.toPort === 'right' ? 'right' : 'left';
        const sx = Number(from.x || 0) + (fromPort === 'right' ? 168 : 0);
        const sy = Number(from.y || 0) + (sourceIsCondition && edgeLabel === 'true' ? 25 : sourceIsCondition && edgeLabel === 'false' ? 50 : 35);
        const tx = Number(to.x || 0) + (toPort === 'right' ? 168 : 0);
        const ty = Number(to.y || 0) + 35;
        const controlOffset = Math.max(48, Math.abs(tx - sx) / 2);
        const c1x = sx + (fromPort === 'right' ? controlOffset : -controlOffset);
        const c2x = tx + (toPort === 'right' ? controlOffset : -controlOffset);
        const path = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2 - 7;
        const label = String(edge.label || 'next').trim() || 'next';
        const labelMarkup = sourceIsCondition && (edgeLabel === 'true' || edgeLabel === 'false')
            ? `<text class="sidebar-flow-edge-label" x="${midX}" y="${midY}">${escapeHtml(label)}</text>`
            : '';
        return `
          <path class="sidebar-flow-edge" data-flow-edge-id="${escapeHtml(edge.id)}" d="${escapeHtml(path)}" marker-end="url(#sidebar-flow-arrow)"></path>
          ${labelMarkup}
        `;
    }).join('');
    sidebarFlowSvgNode.innerHTML = `
      <defs>
        <marker id="sidebar-flow-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#64748b"></path>
        </marker>
      </defs>
      ${edgeMarkup}
    `;

    sidebarFlowNodesNode.innerHTML = steps.map((step, index) => {
        const id = getSidebarStepId(step, index);
        const node = nodeMap.get(id) || getSidebarFlowLayoutForIndex(index);
        const type = String(step?.type || 'navigate').trim() || 'navigate';
        const name = String(step?.name || `步骤${index + 1}`).trim() || `步骤${index + 1}`;
        const meta = buildSidebarFlowNodeMeta(step);
        const isCondition = type === 'condition';
        const classes = [
            'sidebar-flow-node',
            `is-type-${type.replace(/[^a-z0-9_-]+/gi, '-')}`,
            sidebarSelectedFlowNodeIds.has(id) ? 'is-selected' : '',
            id === sidebarFlowConnectSourceId ? 'is-connect-source' : ''
        ].filter(Boolean).join(' ');
        return `
          <div class="${classes}" data-flow-node-id="${escapeHtml(id)}" data-step-index="${index}" style="left:${Math.max(0, Number(node.x || 0))}px;top:${Math.max(0, Number(node.y || 0))}px;">
            <button type="button" class="sidebar-flow-port sidebar-flow-port--left" data-flow-port="left" data-flow-role="${isCondition ? 'target' : 'any'}" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 左侧端点"></button>
            <div class="sidebar-flow-node__top">
              <span class="sidebar-flow-node__badge">#${index + 1}</span>
              <span class="sidebar-flow-node__type">${escapeHtml(formatStepTypeLabel(type))}</span>
            </div>
            <div class="sidebar-flow-node__title">${escapeHtml(name)}</div>
            ${meta ? `<div class="sidebar-flow-node__meta">${escapeHtml(meta)}</div>` : ''}
            ${isCondition ? `
              <button type="button" class="sidebar-flow-port sidebar-flow-port--right sidebar-flow-port--condition-true" data-flow-port="right" data-flow-role="source" data-flow-label="true" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 条件成立输出端点"></button>
              <button type="button" class="sidebar-flow-port sidebar-flow-port--right sidebar-flow-port--condition-false" data-flow-port="right" data-flow-role="source" data-flow-label="false" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 条件不成立输出端点"></button>
            ` : `
              <button type="button" class="sidebar-flow-port sidebar-flow-port--right" data-flow-port="right" data-flow-role="any" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 右侧端点"></button>
            `}
          </div>
        `;
    }).join('');
    syncSidebarNodeSettingsSelection();
}

function syncSidebarNodeSettingsSelection() {
    if (!sidebarStepListNode) {
        return false;
    }

    let hasSelection = false;
    collectSidebarStepCards().forEach((card) => {
        const selected = Boolean(sidebarSelectedFlowNodeId)
            && String(card.dataset.stepId || '').trim() === sidebarSelectedFlowNodeId;
        card.classList.toggle('is-selected', selected);
        card.classList.toggle('is-expanded', selected);
        hasSelection = hasSelection || selected;
    });
    sidebarStepListNode.classList.toggle('is-open', hasSelection);
    sidebarStepListNode.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
    if (hasSelection) {
        window.requestAnimationFrame(() => positionSidebarNodeSettings());
    }
    return hasSelection;
}

function positionSidebarNodeSettings() {
    if (!sidebarStepListNode?.classList.contains('is-open') || !sidebarFlowCanvasNode || !sidebarSelectedFlowNodeId) {
        return false;
    }
    const stage = sidebarFlowCanvasNode.closest('.sidebar-flow-stage');
    const safeId = typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function'
        ? CSS.escape(sidebarSelectedFlowNodeId)
        : sidebarSelectedFlowNodeId.replace(/"/g, '\\"');
    const selectedNode = sidebarFlowNodesNode?.querySelector(`[data-flow-node-id="${safeId}"]`);
    if (!stage || !selectedNode) {
        return false;
    }

    const gap = 12;
    const margin = 12;
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = selectedNode.getBoundingClientRect();
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const desiredPanelWidth = Math.min(390, Math.max(240, stageWidth - margin * 2));
    const nodeLeft = nodeRect.left - stageRect.left;
    const nodeTop = nodeRect.top - stageRect.top;
    const nodeRight = nodeRect.right - stageRect.left;
    const nodeBottom = nodeRect.bottom - stageRect.top;
    const rightSpace = stageWidth - nodeRight - margin - gap;
    const leftSpace = nodeLeft - margin - gap;
    const belowSpace = stageHeight - nodeBottom - margin - gap;
    const aboveSpace = nodeTop - margin - gap;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

    let panelWidth = desiredPanelWidth;
    let left = margin;
    let top = margin;
    let maxHeight = Math.max(140, stageHeight - margin * 2);
    if (rightSpace >= 240) {
        panelWidth = Math.min(desiredPanelWidth, rightSpace);
        left = nodeRight + gap;
        top = clamp(nodeTop, margin, stageHeight - margin - 180);
    } else if (leftSpace >= 240) {
        panelWidth = Math.min(desiredPanelWidth, leftSpace);
        left = nodeLeft - panelWidth - gap;
        top = clamp(nodeTop, margin, stageHeight - margin - 180);
    } else if (belowSpace >= 80 || aboveSpace < 80 || belowSpace >= aboveSpace) {
        left = clamp(nodeLeft, margin, stageWidth - panelWidth - margin);
        top = nodeBottom + gap;
        maxHeight = Math.max(80, stageHeight - top - margin);
    } else {
        left = clamp(nodeLeft, margin, stageWidth - panelWidth - margin);
        maxHeight = aboveSpace;
        top = Math.max(margin, nodeTop - gap - maxHeight);
    }

    sidebarStepListNode.style.width = `${panelWidth}px`;
    sidebarStepListNode.style.left = `${Math.round(left)}px`;
    sidebarStepListNode.style.top = `${Math.round(top)}px`;
    sidebarStepListNode.style.maxHeight = `${Math.round(maxHeight)}px`;
    return true;
}

function applySidebarFlowViewTransform() {
    if (!sidebarFlowViewportNode) {
        return;
    }
    const { scale, x, y } = sidebarFlowViewState;
    sidebarFlowViewportNode.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    const resetButton = document.getElementById('sidebar-flow-zoom-reset');
    if (resetButton) {
        resetButton.textContent = `${Math.round(scale * 100)}%`;
    }
    if (sidebarSelectedFlowNodeId) {
        window.requestAnimationFrame(() => positionSidebarNodeSettings());
    }
}

function setSidebarFlowZoom(nextScale = 1, clientX = null, clientY = null) {
    if (!sidebarFlowCanvasNode) {
        return 1;
    }
    const oldScale = sidebarFlowViewState.scale;
    const scale = Math.min(2, Math.max(0.4, Number(nextScale) || 1));
    const rect = sidebarFlowCanvasNode.getBoundingClientRect();
    const hasClientX = clientX !== null && clientX !== undefined && Number.isFinite(Number(clientX));
    const hasClientY = clientY !== null && clientY !== undefined && Number.isFinite(Number(clientY));
    const anchorX = hasClientX ? Number(clientX) - rect.left : rect.width / 2;
    const anchorY = hasClientY ? Number(clientY) - rect.top : rect.height / 2;
    const logicalX = (anchorX - sidebarFlowViewState.x) / oldScale;
    const logicalY = (anchorY - sidebarFlowViewState.y) / oldScale;
    sidebarFlowViewState = {
        scale,
        x: anchorX - logicalX * scale,
        y: anchorY - logicalY * scale
    };
    applySidebarFlowViewTransform();
    return scale;
}

function zoomSidebarFlowBy(delta = 0, clientX = null, clientY = null) {
    return setSidebarFlowZoom(sidebarFlowViewState.scale + Number(delta || 0), clientX, clientY);
}

function resetSidebarFlowView() {
    sidebarFlowViewState = { scale: 1, x: 0, y: 0 };
    applySidebarFlowViewTransform();
}

function beginSidebarFlowCanvasPan(event) {
    if (!event || event.button !== 0 || !sidebarFlowCanvasNode) {
        return false;
    }
    event.preventDefault();
    sidebarFlowPanState = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: sidebarFlowViewState.x,
        startY: sidebarFlowViewState.y
    };
    sidebarFlowCanvasNode.classList.add('is-panning');
    const onMove = (moveEvent) => {
        if (!sidebarFlowPanState) return;
        sidebarFlowViewState = {
            ...sidebarFlowViewState,
            x: sidebarFlowPanState.startX + moveEvent.clientX - sidebarFlowPanState.startClientX,
            y: sidebarFlowPanState.startY + moveEvent.clientY - sidebarFlowPanState.startClientY
        };
        applySidebarFlowViewTransform();
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        sidebarFlowPanState = null;
        sidebarFlowCanvasNode.classList.remove('is-panning');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return true;
}

function addSidebarStepToCanvas(stepType = 'navigate', clientX = null, clientY = null) {
    const currentCard = collectSidebarCardDataFromForm();
    if (!currentCard || !sidebarFlowCanvasNode) {
        return null;
    }
    const step = buildSidebarStepTemplate(stepType);
    const steps = ensureSidebarStepIds([...(Array.isArray(currentCard.steps) ? currentCard.steps : []), step]);
    const stepId = getSidebarStepId(steps[steps.length - 1], steps.length - 1);
    let flow = normalizeSidebarFlowForSteps(currentCard.flow || sidebarFlowState, steps);
    const rect = sidebarFlowCanvasNode.getBoundingClientRect();
    const hasClientX = clientX !== null && clientX !== undefined && Number.isFinite(Number(clientX));
    const hasClientY = clientY !== null && clientY !== undefined && Number.isFinite(Number(clientY));
    const screenX = hasClientX ? Number(clientX) - rect.left : rect.width / 2;
    const screenY = hasClientY ? Number(clientY) - rect.top : rect.height / 2;
    const x = Math.max(0, (screenX - sidebarFlowViewState.x) / sidebarFlowViewState.scale - 84);
    const y = Math.max(0, (screenY - sidebarFlowViewState.y) / sidebarFlowViewState.scale - 36);
    flow = {
        ...flow,
        nodes: flow.nodes.map((node) => node.id === stepId ? { ...node, x, y } : node)
    };
    currentCard.steps = steps;
    currentCard.flow = flow;
    renderSidebarCardEditor(currentCard);
    selectSidebarFlowNode(stepId, { scroll: false });
    syncSidebarEditorToHiddenJson();
    return steps[steps.length - 1];
}

function selectSidebarFlowNode(stepId = '', options = {}) {
    const id = String(stepId || '').trim();
    if (!id) {
        return false;
    }
    const toggle = options.toggle === true;
    const additive = options.additive === true || toggle;
    if (!additive) {
        sidebarSelectedFlowNodeIds = new Set([id]);
    } else if (toggle && sidebarSelectedFlowNodeIds.has(id)) {
        sidebarSelectedFlowNodeIds.delete(id);
    } else {
        sidebarSelectedFlowNodeIds.add(id);
    }
    const remainingSelection = Array.from(sidebarSelectedFlowNodeIds);
    sidebarSelectedFlowNodeId = sidebarSelectedFlowNodeIds.has(id)
        ? id
        : (remainingSelection[remainingSelection.length - 1] || '');
    const currentCard = collectSidebarCardDataFromForm();
    renderSidebarFlowCanvas(currentCard);
    syncSidebarNodeSettingsSelection();
    return sidebarSelectedFlowNodeIds.has(id);
}

function clearSidebarFlowNodeSelection() {
    if (!sidebarSelectedFlowNodeId && sidebarSelectedFlowNodeIds.size === 0) {
        return false;
    }
    sidebarSelectedFlowNodeId = '';
    sidebarSelectedFlowNodeIds = new Set();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return true;
}

function prepareSidebarFlowNodeContextSelection(stepId = '') {
    const id = String(stepId || '').trim();
    if (!id) {
        return 0;
    }
    if (!sidebarSelectedFlowNodeIds.has(id)) {
        sidebarSelectedFlowNodeIds = new Set([id]);
    }
    sidebarSelectedFlowNodeId = '';
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return sidebarSelectedFlowNodeIds.size;
}

function setSidebarFlowConnectMode(enabled = false) {
    sidebarFlowConnectMode = enabled === true;
    sidebarFlowConnectSourceId = sidebarFlowConnectMode ? sidebarFlowConnectSourceId : '';
    sidebarFlowConnectSourcePort = sidebarFlowConnectMode ? sidebarFlowConnectSourcePort : 'right';
    sidebarFlowConnectLabel = sidebarFlowConnectMode ? sidebarFlowConnectLabel : 'next';
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return sidebarFlowConnectMode;
}

function toggleSidebarFlowConnectMode() {
    return setSidebarFlowConnectMode(!sidebarFlowConnectMode);
}

function addSidebarFlowEdge(from = '', to = '', preferredLabel = '', fromPort = 'right', toPort = 'left') {
    const sourceId = String(from || '').trim();
    const targetId = String(to || '').trim();
    if (!sourceId || !targetId || sourceId === targetId) {
        return null;
    }
    const currentSteps = collectSidebarSteps();
    const sourceStep = getSidebarFlowStepById(currentSteps, sourceId) || {};
    let label = String(preferredLabel || '').trim();
    if (!label) {
        const sourceType = String(sourceStep.type || '').trim().toLowerCase();
        if (sourceType === 'condition') {
            const usedLabels = new Set(sidebarFlowState.edges
                .filter((edge) => edge.from === sourceId)
                .map((edge) => String(edge.label || '').trim().toLowerCase()));
            label = usedLabels.has('true') ? (usedLabels.has('false') ? 'next' : 'false') : 'true';
        } else {
            label = 'next';
        }
    }

    const exists = sidebarFlowState.edges.some((edge) => edge.from === sourceId && edge.to === targetId && String(edge.label || 'next') === label);
    if (exists) {
        return null;
    }
    const edge = {
        id: buildSidebarFlowEdgeId(sourceId, targetId, label, sidebarFlowState.edges.length),
        from: sourceId,
        to: targetId,
        label,
        fromPort: String(fromPort || '').trim().toLowerCase() === 'left' ? 'left' : 'right',
        toPort: String(toPort || '').trim().toLowerCase() === 'right' ? 'right' : 'left'
    };
    sidebarFlowState = {
        ...sidebarFlowState,
        edges: [...sidebarFlowState.edges, edge]
    };
    return edge;
}

function handleSidebarFlowNodeClick(stepId = '', options = {}) {
    const id = String(stepId || '').trim();
    if (!id) {
        return false;
    }
    if (sidebarFlowSuppressNodeClick) {
        sidebarFlowSuppressNodeClick = false;
        return false;
    }
    const toggle = options.toggle === true || options.additive === true;
    selectSidebarFlowNode(id, { additive: toggle, toggle });
    return true;
}

function getSidebarFlowPortPoint(stepId = '', port = 'right', label = '') {
    const id = String(stepId || '').trim();
    const portSide = String(port || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
    const node = getSidebarFlowNode(id);
    if (!id || !node) {
        return null;
    }
    const step = getSidebarFlowStepById(collectSidebarSteps(), id) || {};
    const isConditionOutput = String(step.type || '').trim().toLowerCase() === 'condition' && portSide === 'right';
    const normalizedLabel = String(label || '').trim().toLowerCase();
    return {
        x: Number(node.x || 0) + (portSide === 'right' ? 168 : 0),
        y: Number(node.y || 0) + (isConditionOutput && normalizedLabel === 'true' ? 25 : isConditionOutput && normalizedLabel === 'false' ? 50 : 35),
        side: portSide
    };
}

function buildSidebarFlowPortDragPath(sourcePoint, targetPoint, targetSide = 'left') {
    if (!sourcePoint || !targetPoint) return '';
    const sx = Number(sourcePoint.x || 0);
    const sy = Number(sourcePoint.y || 0);
    const tx = Number(targetPoint.x || 0);
    const ty = Number(targetPoint.y || 0);
    const controlOffset = Math.max(48, Math.abs(tx - sx) / 2);
    const c1x = sx + (sourcePoint.side === 'right' ? controlOffset : -controlOffset);
    const c2x = tx + (targetSide === 'right' ? controlOffset : -controlOffset);
    return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
}

function beginSidebarFlowPortDrag(event, stepId = '', port = '', label = '', role = 'any') {
    if (!event || event.button !== 0 || !sidebarFlowCanvasNode || !sidebarFlowSvgNode) {
        return false;
    }
    const id = String(stepId || '').trim();
    const portSide = String(port || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
    const portRole = String(role || 'any').trim().toLowerCase();
    const sourceLabel = String(label || '').trim().toLowerCase();
    const sourcePoint = getSidebarFlowPortPoint(id, portSide, sourceLabel);
    if (!id || !sourcePoint || portRole === 'target') {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    sidebarSelectedFlowNodeId = '';
    sidebarSelectedFlowNodeIds = new Set();
    sidebarFlowConnectMode = true;
    sidebarFlowConnectSourceId = id;
    sidebarFlowConnectSourcePort = portSide;
    sidebarFlowConnectLabel = 'next';
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());

    const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.setAttribute('class', 'sidebar-flow-edge-preview');
    previewPath.setAttribute('marker-end', 'url(#sidebar-flow-arrow)');
    previewPath.setAttribute('d', buildSidebarFlowPortDragPath(sourcePoint, sourcePoint, portSide));
    sidebarFlowSvgNode.appendChild(previewPath);
    sidebarFlowPortDragState = {
        sourceId: id,
        sourcePort: portSide,
        sourceLabel,
        sourcePoint,
        previewPath,
        dropTarget: null
    };

    const getDropPort = (clientX, clientY) => {
        const element = document.elementFromPoint(clientX, clientY);
        const target = element?.closest?.('[data-flow-port]') || null;
        if (!target || String(target.dataset.flowNodeId || '').trim() === id || String(target.dataset.flowRole || 'any').trim().toLowerCase() === 'source') {
            return null;
        }
        return target;
    };
    const clearDropTarget = () => {
        sidebarFlowPortDragState?.dropTarget?.classList.remove('is-drop-target');
        if (sidebarFlowPortDragState) sidebarFlowPortDragState.dropTarget = null;
    };
    const onMove = (moveEvent) => {
        if (!sidebarFlowPortDragState) return;
        const targetPort = getDropPort(moveEvent.clientX, moveEvent.clientY);
        if (targetPort !== sidebarFlowPortDragState.dropTarget) {
            clearDropTarget();
            if (targetPort) {
                targetPort.classList.add('is-drop-target');
                sidebarFlowPortDragState.dropTarget = targetPort;
            }
        }
        const canvasRect = sidebarFlowCanvasNode.getBoundingClientRect();
        let targetPoint = {
            x: (moveEvent.clientX - canvasRect.left - sidebarFlowViewState.x) / sidebarFlowViewState.scale,
            y: (moveEvent.clientY - canvasRect.top - sidebarFlowViewState.y) / sidebarFlowViewState.scale
        };
        let targetSide = targetPoint.x >= sourcePoint.x ? 'left' : 'right';
        if (targetPort) {
            targetSide = String(targetPort.dataset.flowPort || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
            targetPoint = getSidebarFlowPortPoint(String(targetPort.dataset.flowNodeId || '').trim(), targetSide, String(targetPort.dataset.flowLabel || '')) || targetPoint;
        }
        previewPath.setAttribute('d', buildSidebarFlowPortDragPath(sourcePoint, targetPoint, targetSide));
    };
    const finish = (upEvent = null, cancelled = false) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKeyDown);
        const targetPort = !cancelled && upEvent ? getDropPort(upEvent.clientX, upEvent.clientY) : null;
        clearDropTarget();
        let edge = null;
        if (targetPort) {
            const targetId = String(targetPort.dataset.flowNodeId || '').trim();
            const targetSide = String(targetPort.dataset.flowPort || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
            edge = addSidebarFlowEdge(id, targetId, sourceLabel, portSide, targetSide);
        }
        sidebarFlowPortDragState = null;
        sidebarFlowConnectSourceId = '';
        sidebarFlowConnectSourcePort = 'right';
        sidebarFlowConnectMode = false;
        sidebarFlowConnectLabel = 'next';
        if (edge) {
            syncSidebarEditorToHiddenJson();
        }
        renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
        if (edge) {
            showActionToast('已创建 A → B 连线', 'success');
        } else if (targetPort && !cancelled) {
            showActionToast('该连线已存在', 'info');
        }
    };
    const onUp = (upEvent) => finish(upEvent, false);
    const onCancel = () => finish(null, true);
    const onKeyDown = (keyEvent) => {
        if (keyEvent.key !== 'Escape') return;
        keyEvent.preventDefault();
        finish(null, true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown);
    return true;
}

function deleteSidebarFlowEdge(edgeId = '') {
    const id = String(edgeId || '').trim();
    if (!id) {
        return null;
    }
    const edge = sidebarFlowState.edges.find((item) => String(item.id || '') === id) || null;
    sidebarFlowState = {
        ...sidebarFlowState,
        edges: sidebarFlowState.edges.filter((item) => String(item.id || '') !== id)
    };
    syncSidebarEditorToHiddenJson();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return edge;
}

function deleteSelectedSidebarFlowNodes(fallbackStepId = '') {
    const fallbackId = String(fallbackStepId || '').trim();
    const selectedIds = new Set(sidebarSelectedFlowNodeIds);
    if (selectedIds.size === 0 && fallbackId) {
        selectedIds.add(fallbackId);
    }
    if (selectedIds.size === 0) {
        return 0;
    }

    const currentCard = collectSidebarCardDataFromForm();
    const steps = ensureSidebarStepIds(Array.isArray(currentCard?.steps) ? currentCard.steps : []);
    const retainedSteps = steps.filter((step, index) => !selectedIds.has(getSidebarStepId(step, index)));
    const deletedCount = steps.length - retainedSteps.length;
    if (deletedCount <= 0) {
        return 0;
    }

    const retainedIds = new Set(retainedSteps.map((step, index) => getSidebarStepId(step, index)));
    const nextStartId = retainedSteps.length > 0 ? getSidebarStepId(retainedSteps[0], 0) : '';
    currentCard.steps = retainedSteps;
    currentCard.flow = {
        ...sidebarFlowState,
        start: retainedIds.has(sidebarFlowState.start) ? sidebarFlowState.start : nextStartId,
        nodes: sidebarFlowState.nodes.filter((node) => retainedIds.has(String(node.id || ''))),
        edges: sidebarFlowState.edges.filter((edge) => retainedIds.has(edge.from) && retainedIds.has(edge.to))
    };
    if (selectedIds.has(sidebarFlowConnectSourceId)) {
        sidebarFlowConnectMode = false;
        sidebarFlowConnectSourceId = '';
        sidebarFlowConnectSourcePort = 'right';
        sidebarFlowConnectLabel = 'next';
    }
    sidebarSelectedFlowNodeId = '';
    sidebarSelectedFlowNodeIds = new Set();
    renderSidebarCardEditor(currentCard);
    syncSidebarEditorToHiddenJson();
    return deletedCount;
}

function applySidebarFlowAutoLayout() {
    const currentCard = collectSidebarCardDataFromForm();
    const steps = ensureSidebarStepIds(Array.isArray(currentCard?.steps) ? currentCard.steps : []);
    const stepIds = steps.map((step, index) => getSidebarStepId(step, index));
    if (stepIds.length === 0) {
        return null;
    }
    const start = sidebarFlowState.start && stepIds.includes(sidebarFlowState.start) ? sidebarFlowState.start : stepIds[0];
    const outgoing = new Map();
    sidebarFlowState.edges.forEach((edge) => {
        if (!outgoing.has(edge.from)) {
            outgoing.set(edge.from, []);
        }
        outgoing.get(edge.from).push(edge.to);
    });
    const depth = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length > 0) {
        const id = queue.shift();
        const nextDepth = (depth.get(id) || 0) + 1;
        (outgoing.get(id) || []).forEach((targetId) => {
            if (!depth.has(targetId)) {
                depth.set(targetId, nextDepth);
                queue.push(targetId);
            }
        });
    }
    stepIds.forEach((id, index) => {
        if (!depth.has(id)) {
            depth.set(id, Math.max(0, ...Array.from(depth.values())) + index + 1);
        }
    });
    const byDepth = new Map();
    stepIds.forEach((id) => {
        const level = depth.get(id) || 0;
        if (!byDepth.has(level)) {
            byDepth.set(level, []);
        }
        byDepth.get(level).push(id);
    });
    const nodePositions = new Map();
    Array.from(byDepth.keys()).sort((a, b) => a - b).forEach((level) => {
        const ids = byDepth.get(level) || [];
        ids.forEach((id, position) => {
            nodePositions.set(id, {
                x: 34 + level * 220,
                y: 60 + position * 126
            });
        });
    });
    sidebarFlowState = {
        ...sidebarFlowState,
        start,
        nodes: stepIds.map((id) => ({
            id,
            ...(nodePositions.get(id) || getSidebarFlowLayoutForIndex(stepIds.indexOf(id)))
        }))
    };
    syncSidebarEditorToHiddenJson();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return sidebarFlowState;
}

function beginSidebarFlowNodeDrag(event, stepId = '') {
    if (!event || event.button !== 0) {
        return false;
    }
    if (sidebarFlowConnectMode) {
        return false;
    }
    const id = String(stepId || '').trim();
    const node = getSidebarFlowNode(id);
    if (!id || !node || !sidebarFlowCanvasNode) {
        return false;
    }
    event.preventDefault();
    const additive = event.ctrlKey === true || event.metaKey === true || event.shiftKey === true;
    const dragIds = sidebarSelectedFlowNodeIds.has(id)
        ? Array.from(sidebarSelectedFlowNodeIds)
        : (additive ? [...Array.from(sidebarSelectedFlowNodeIds), id] : [id]);
    const startPositions = new Map(sidebarFlowState.nodes
        .filter((item) => dragIds.includes(String(item.id || '')))
        .map((item) => [String(item.id || ''), {
            x: Number(item.x || 0),
            y: Number(item.y || 0)
        }]));
    const rect = sidebarFlowCanvasNode.getBoundingClientRect();
    sidebarFlowDragState = {
        id,
        dragIds,
        startPositions,
        startClientX: event.clientX,
        startClientY: event.clientY,
        scrollLeft: sidebarFlowCanvasNode.scrollLeft,
        scrollTop: sidebarFlowCanvasNode.scrollTop,
        rectLeft: rect.left,
        rectTop: rect.top,
        moved: false
    };
    const onMove = (moveEvent) => {
        if (!sidebarFlowDragState) {
            return;
        }
        const clientDx = moveEvent.clientX - sidebarFlowDragState.startClientX;
        const clientDy = moveEvent.clientY - sidebarFlowDragState.startClientY;
        const dx = clientDx / sidebarFlowViewState.scale;
        const dy = clientDy / sidebarFlowViewState.scale;
        if (Math.hypot(clientDx, clientDy) >= 6) {
            sidebarFlowDragState.moved = true;
            sidebarFlowSuppressNodeClick = true;
        }
        if (!sidebarFlowDragState.moved) {
            return;
        }
        sidebarSelectedFlowNodeIds = new Set(sidebarFlowDragState.dragIds);
        sidebarSelectedFlowNodeId = '';
        sidebarFlowState = {
            ...sidebarFlowState,
            nodes: sidebarFlowState.nodes.map((item) => {
                const start = sidebarFlowDragState.startPositions.get(String(item.id || ''));
                return start
                    ? { ...item, x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy) }
                    : item;
            })
        };
        renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    };
    const finish = (cancelled = false) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        const moved = sidebarFlowDragState?.moved === true;
        sidebarFlowDragState = null;
        if (moved) {
            syncSidebarEditorToHiddenJson();
        } else if (!cancelled) {
            sidebarFlowSuppressNodeClick = true;
            selectSidebarFlowNode(id, { additive, toggle: additive });
        }
        window.setTimeout(() => { sidebarFlowSuppressNodeClick = false; }, 0);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return true;
}

function applyExecutionStatusToSidebarFlowStep(stepIndex, status = 'pending') {
    if (!sidebarFlowNodesNode || !sidebarStepListNode) {
        return;
    }
    const idx = Number(stepIndex);
    const card = sidebarStepListNode.querySelector(`[data-sidebar-step-card][data-step-index="${Math.max(0, idx - 1)}"]`);
    const stepId = String(card?.dataset?.stepId || '').trim();
    if (!stepId) {
        return;
    }
    const safeStepId = typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function' ? CSS.escape(stepId) : stepId.replace(/"/g, '\\"');
    const node = sidebarFlowNodesNode.querySelector(`[data-flow-node-id="${safeStepId}"]`);
    if (!node) {
        return;
    }
    node.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');
    if (status) {
        node.classList.add(`is-${status}`);
    }
}

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

function buildStandardSelectorFromHtmlSnippet(value = '') {
    const raw = normalizeSelectorText(decodeHtmlEntities(value));
    if (!raw || !looksLikeHtmlSnippet(raw)) {
        return {
            selector: normalizeSelectorText(value),
            converted: false
        };
    }

    const template = document.createElement('template');
    try {
        template.innerHTML = raw;
    } catch (_error) {
        return {
            selector: normalizeSelectorText(value),
            converted: false
        };
    }

    const element = template.content?.firstElementChild || null;
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

    const attributes = [];
    const addAttribute = (name) => {
        const valueText = String(element.getAttribute(name) || '').trim();
        if (valueText) {
            attributes.push(`[${name}="${escapeCssAttributeValue(valueText)}"]`);
        }
    };

    if (!id) {
        if (tagName === 'input' || tagName === 'button') {
            addAttribute('type');
        }
        addAttribute('name');
        addAttribute('placeholder');
        addAttribute('aria-label');
        addAttribute('title');
        addAttribute('role');
        addAttribute('data-testid');
        addAttribute('data-test');
        addAttribute('data-cy');
        addAttribute('data-qa');

        if (attributes.length === 0) {
            const dataKeys = Array.from(element.attributes || [])
                .map((attr) => String(attr?.name || '').trim())
                .filter((name) => /^data-[a-z0-9_-]+$/i.test(name) && !/^data-v-/i.test(name));
            for (const name of dataKeys.slice(0, 2)) {
                addAttribute(name);
            }
        }
    }

    selectorParts.push(...attributes);

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
    const type = String(step?.type || 'navigate').trim() || 'navigate';
    parts.push(`类型: ${escapeHtml(formatStepTypeLabel(type))}`);

    if (type === 'condition') {
        const mode = String(step?.condition_mode || step?.condition || 'selector_exists').trim();
        parts.push(`判断: ${escapeHtml(mode)}`);
    }

    const selector = String(step?.selector || '').trim();
    if (selector) {
        const shortSelector = selector.length > 48 ? `${selector.slice(0, 45)}...` : selector;
        parts.push(`选择器: ${escapeHtml(shortSelector)}`);
    }

    const url = String(step?.url || '').trim();
    if (url) {
        const shortUrl = url.length > 48 ? `${url.slice(0, 45)}...` : url;
        parts.push(`URL: ${escapeHtml(shortUrl)}`);
    }

    return parts.map((item) => `<span>${item}</span>`).join('');
}

function buildSidebarStepCardHtml(step = {}, index = 0, expanded = false) {
    const type = String(step?.type || 'navigate').trim() || 'navigate';
    const stepId = getSidebarStepId(step, index);
    const name = String(step?.name || `步骤${index + 1}`).trim() || `步骤${index + 1}`;
    const selector = String(step?.selector || '').trim();
    const text = String(step?.text || '').trim();
    const variable = String(step?.variable || '').trim();
    const url = String(step?.url || '').trim();
    const timeout = String(step?.timeout ?? '').trim();
    const by = String(step?.by || 'css_selector').trim() || 'css_selector';
    const conditionMode = String(step?.condition_mode || step?.condition || 'selector_exists').trim() || 'selector_exists';
    const script = String(step?.script || '').trim();
    const waitForText = String(step?.wait_for_text || '').trim();
    const waitForElementHidden = String(step?.wait_for_element_hidden || '').trim();
    const waitForTextHidden = String(step?.wait_for_text_hidden || '').trim();
    const nth = String(step?.nth ?? '').trim();
    const pollInterval = String(step?.poll_interval_ms ?? '').trim();
    const defaultValue = String(step?.default ?? '').trim();
    const clearFirst = step?.clear_first === true || step?.clearFirst === true;
    const clickBeforeType = step?.click_before_type === true || step?.clickBeforeType === true;
    const optional = step?.optional === true || String(step?.optional || '').trim() === 'true';

    return `
      <div class="sidebar-step-card${expanded ? ' is-expanded' : ''}" data-sidebar-step-card data-step-index="${index}" data-step-id="${escapeHtml(stepId)}" data-step-type="${escapeHtml(type)}">
        <textarea data-sidebar-step-field="raw_json" hidden aria-hidden="true">${escapeHtml(JSON.stringify(step))}</textarea>
        <div class="sidebar-step-card__header">
          <div class="sidebar-step-card__title-wrap">
            <h4 class="sidebar-step-card__title">步骤 ${index + 1}-${name} <span class="sidebar-step-status" data-step-status></span></h4>
            <div class="sidebar-step-card__summary">${buildSidebarStepSummary(step)}</div>
          </div>
          <div class="sidebar-step-card__actions">
            <button type="button" class="button-secondary sidebar-step-card__close" data-sidebar-step-action="close" aria-label="关闭节点设置">关闭</button>
            <button type="button" class="button-secondary" data-sidebar-step-action="up">上移</button>
            <button type="button" class="button-secondary" data-sidebar-step-action="down">下移</button>
            <button type="button" class="button-secondary" data-sidebar-step-action="delete">删除</button>
          </div>
        </div>
        <div class="sidebar-step-error" data-step-error hidden></div>
        <div class="sidebar-step-card__body">
          <div class="sidebar-step-card__grid">
          <div class="full">
            <label>步骤名称</label>
            <input data-sidebar-step-field="name" type="text" value="${escapeHtml(name)}">
            <input data-sidebar-step-field="id" type="hidden" value="${escapeHtml(stepId)}">
          </div>
            <div class="sidebar-step-setting is-visible">
              <label>步骤类型</label>
              <select data-sidebar-step-field="type">
                ${[
                    ['navigate', '访问网页'],
                    ['click', '点击元素'],
                    ['type', '输入内容'],
                    ['wait', '等待条件'],
                    ['condition', '判断分支'],
                    ['get_credits', '获取积分'],
                    ['save_cookies', '获取Cookie'],
                    ['clear_current_page_cache', '清理当前页缓存'],
                    ['external_script', '执行脚本'],
                    ['screenshot', '截图']
                ].map(([value, label]) => `<option value="${value}"${value === type ? ' selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <div class="full sidebar-step-type-description" data-step-type-description></div>
            <div class="sidebar-step-setting" data-step-types="click,type,get_credits">
              <label>选择器类型</label>
              <select data-sidebar-step-field="by">
                ${['css_selector','text','auto'].map((item) => `<option value="${item}"${item === by ? ' selected' : ''}>${item}</option>`).join('')}
              </select>
            </div>
            <div class="sidebar-step-setting" data-step-types="condition">
              <label>判断方式</label>
              <select data-sidebar-step-field="condition_mode">
                ${[
                    ['selector_exists', '元素存在'],
                    ['selector_missing', '元素不存在'],
                    ['text_exists', '文本存在'],
                    ['text_missing', '文本不存在'],
                    ['url_matches', 'URL 匹配'],
                    ['js', 'JS 表达式']
                ].map(([value, label]) => `<option value="${value}"${value === conditionMode ? ' selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
          <div class="full sidebar-step-setting" data-step-types="click,type,wait,condition,get_credits" data-condition-modes="selector_exists,selector_missing">
            <div class="sidebar-step-selector-head">
              <label>选择器</label>
              <button type="button" class="button-secondary sidebar-step-selector-btn" data-sidebar-step-action="selector">设置选择器</button>
            </div>
            <input data-sidebar-step-field="selector" type="text" value="${escapeHtml(selector)}" placeholder="可直接粘贴 HTML 元素片段">
          </div>
          <div class="full sidebar-step-setting" data-step-types="type,condition" data-condition-modes="text_exists,text_missing,url_matches">
            <label data-step-text-label>输入文本（变量默认值）</label>
            <input data-sidebar-step-field="text" type="text" value="${escapeHtml(text)}" placeholder="type 步骤要输入的默认文本；运行前可按变量名覆盖">
          </div>
          <div class="full sidebar-step-setting" data-step-types="type">
            <label>变量名（仅输入步骤，留空自动按顺序 var1/var2…）</label>
            <input data-sidebar-step-field="variable" type="text" value="${escapeHtml(variable)}" placeholder="如 email / password / username">
          </div>
          <div class="full sidebar-step-setting" data-step-types="navigate">
            <label>跳转 URL</label>
            <input data-sidebar-step-field="url" type="text" value="${escapeHtml(url)}">
          </div>
          <div class="sidebar-step-setting" data-step-types="click,type,get_credits">
            <label>匹配序号</label>
            <input data-sidebar-step-field="nth" type="number" min="0" step="1" value="${escapeHtml(nth)}" placeholder="0">
          </div>
          <div class="sidebar-step-setting" data-step-types="click,type,condition,get_credits">
            <label>轮询间隔(ms)</label>
            <input data-sidebar-step-field="poll_interval_ms" type="number" min="50" step="50" value="${escapeHtml(pollInterval)}">
          </div>
          <div class="sidebar-step-setting" data-step-types="navigate,click,type,wait,condition,get_credits">
            <label>超时(ms)</label>
            <input data-sidebar-step-field="timeout" type="number" min="0" step="100" value="${escapeHtml(timeout)}">
          </div>
            <div class="sidebar-step-setting" data-step-types="navigate,click,type,wait,condition,get_credits,external_script,clear_current_page_cache">
              <label>可选</label>
              <label style="display:flex;align-items:center;gap:8px;margin:0;">
                <input data-sidebar-step-field="optional" type="checkbox"${optional ? ' checked' : ''}>
                <span>跳过失败继续</span>
              </label>
            </div>
          <div class="full sidebar-step-setting" data-step-types="type">
            <label>输入行为</label>
            <div class="sidebar-step-checkboxes">
              <label><input data-sidebar-step-field="clear_first" type="checkbox"${clearFirst ? ' checked' : ''}> 输入前清空</label>
              <label><input data-sidebar-step-field="click_before_type" type="checkbox"${clickBeforeType ? ' checked' : ''}> 输入前点击</label>
            </div>
          </div>
          <div class="full sidebar-step-setting" data-step-types="wait">
            <label>等待文本</label>
            <input data-sidebar-step-field="wait_for_text" type="text" value="${escapeHtml(waitForText)}">
          </div>
          <div class="full sidebar-step-setting" data-step-types="wait">
            <label>等待元素消失</label>
            <input data-sidebar-step-field="wait_for_element_hidden" type="text" value="${escapeHtml(waitForElementHidden)}">
          </div>
          <div class="full sidebar-step-setting" data-step-types="wait">
            <label>等待文本消失</label>
            <input data-sidebar-step-field="wait_for_text_hidden" type="text" value="${escapeHtml(waitForTextHidden)}">
          </div>
          <div class="full sidebar-step-setting" data-step-types="get_credits">
            <label>未读取到内容时的默认值</label>
            <input data-sidebar-step-field="default" type="text" value="${escapeHtml(defaultValue)}">
          </div>
          <div class="full sidebar-step-setting" data-step-types="external_script,condition" data-condition-modes="js">
            <label data-step-script-label>脚本</label>
            <textarea data-sidebar-step-field="script" rows="5">${escapeHtml(script)}</textarea>
          </div>
          </div>
        </div>
      </div>
    `;
  }

function updateSidebarStepSettingsVisibility(stepCard) {
    if (!stepCard) {
        return;
    }
    const type = String(stepCard.querySelector('[data-sidebar-step-field="type"]')?.value || 'navigate').trim().toLowerCase() || 'navigate';
    const conditionMode = String(stepCard.querySelector('[data-sidebar-step-field="condition_mode"]')?.value || 'selector_exists').trim().toLowerCase();
    stepCard.dataset.stepType = type;

    stepCard.querySelectorAll('[data-step-types]').forEach((field) => {
        const allowedTypes = String(field.dataset.stepTypes || '').split(',').map((item) => item.trim()).filter(Boolean);
        const allowedModes = String(field.dataset.conditionModes || '').split(',').map((item) => item.trim()).filter(Boolean);
        const typeMatches = allowedTypes.length === 0 || allowedTypes.includes(type);
        const modeMatches = type !== 'condition' || allowedModes.length === 0 || allowedModes.includes(conditionMode);
        field.classList.toggle('is-visible', typeMatches && modeMatches);
    });

    const descriptions = {
        navigate: '访问指定 URL；未填写时使用卡片设置中的目标网址。',
        click: '定位页面元素并执行点击。',
        type: '定位可输入元素并写入固定文本或运行变量。',
        wait: '可等待元素或文本出现，也可等待元素或文本消失。',
        condition: '计算 true / false，并沿画布中对应标签的连线继续执行。',
        get_credits: '读取目标元素的文本并写入执行结果。',
        save_cookies: '保存当前页面的 Cookie 及本地存储，无需额外参数。',
        clear_current_page_cache: '清理当前页面缓存与站点存储，无需额外参数。',
        external_script: '在当前页面上下文执行 JavaScript。',
        screenshot: '截取当前标签页可见区域并保存，无需额外参数。'
    };
    const description = stepCard.querySelector('[data-step-type-description]');
    if (description) {
        description.textContent = descriptions[type] || '';
    }

    const textLabel = stepCard.querySelector('[data-step-text-label]');
    if (textLabel) {
        textLabel.textContent = type === 'condition' ? '判断文本 / URL 片段' : '输入文本（变量默认值）';
    }
    const textInput = stepCard.querySelector('[data-sidebar-step-field="text"]');
    if (textInput) {
        textInput.placeholder = type === 'condition' ? '输入需要匹配的文本或 URL 片段' : '运行前可按变量名覆盖';
    }
    const scriptLabel = stepCard.querySelector('[data-step-script-label]');
    if (scriptLabel) {
        scriptLabel.textContent = type === 'condition' ? '判断表达式 / 脚本' : '执行脚本';
    }
}

function resetSidebarStepStatuses() {
  if (!sidebarStepListNode) return;
  sidebarStepListNode.querySelectorAll('[data-sidebar-step-card]').forEach((card) => {
    card.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');
    const statusEl = card.querySelector('.sidebar-step-status') || card.querySelector('[data-step-status]');
    if (statusEl) statusEl.textContent = '';
    const errEl = card.querySelector('.sidebar-step-error') || card.querySelector('[data-step-error]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  });
  if (sidebarFlowNodesNode) {
    sidebarFlowNodesNode.querySelectorAll('[data-flow-node-id]').forEach((node) => {
      node.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');
    });
  }
}

function applyExecutionStatusToSidebarStep(stepIndex, status = 'pending', errorReason = '') {
  if (!sidebarStepListNode || !stepIndex) return;
  const idx = Number(stepIndex);
  const card = sidebarStepListNode.querySelector(`[data-sidebar-step-card][data-step-index="${Math.max(0, idx - 1)}"]`);
  if (!card) return;

  card.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');

  const statusEl = card.querySelector('.sidebar-step-status') || card.querySelector('[data-step-status]');
  let errEl = card.querySelector('.sidebar-step-error') || card.querySelector('[data-step-error]');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'sidebar-step-error';
    errEl.setAttribute('data-step-error', '');
    const header = card.querySelector('.sidebar-step-card__header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(errEl, header.nextSibling);
    } else {
      card.appendChild(errEl);
    }
  }

  let label = '';
  if (status === 'success') {
    card.classList.add('is-success');
    label = '✓ 通过';
    errEl.hidden = true;
    errEl.textContent = '';
  } else if (status === 'error') {
    card.classList.add('is-error');
    label = '✗ 失败';
    if (errorReason) {
      errEl.textContent = String(errorReason);
      errEl.hidden = false;
    } else {
      errEl.hidden = true;
    }
  } else if (status === 'running') {
    card.classList.add('is-running');
    label = '⟳ 执行中';
    errEl.hidden = true;
  } else {
    card.classList.add('is-pending');
    label = '○ 待执行';
    errEl.hidden = true;
  }

  if (statusEl) {
    statusEl.textContent = label;
  }
  applyExecutionStatusToSidebarFlowStep(idx, status);
}

function collectSidebarStepCards() {
    if (!sidebarStepListNode) {
        return [];
    }

    return Array.from(sidebarStepListNode.querySelectorAll('[data-sidebar-step-card]'));
}

function readSidebarStepCard(stepCard, index = 0) {
    if (!stepCard) {
        return null;
    }

    const readField = (name) => {
        const control = stepCard.querySelector(`[data-sidebar-step-field="${name}"]`);
        if (!control) {
            return '';
        }

        if (control.type === 'checkbox') {
            return control.checked === true;
        }

        return String(control.value || '').trim();
    };

    const selectorControl = stepCard.querySelector('[data-sidebar-step-field="selector"]');
    const selectorNormalization = normalizeSidebarStepSelectorControl(stepCard, selectorControl);

    let baseStep = {};
    try {
        const rawStep = readField('raw_json');
        baseStep = rawStep ? JSON.parse(rawStep) : {};
    } catch (_error) {
        baseStep = {};
    }

    const step = {
        ...(baseStep && typeof baseStep === 'object' && !Array.isArray(baseStep) ? baseStep : {}),
        id: String(readField('id') || stepCard.dataset.stepId || `step_${index + 1}`).trim() || `step_${index + 1}`,
        name: String(readField('name') || `步骤${index + 1}`).trim() || `步骤${index + 1}`,
        type: String(readField('type') || 'navigate').trim() || 'navigate'
    };
    const stepType = String(step.type || '').trim().toLowerCase();
    [
        'selector', 'text', 'variable', 'url', 'by', 'condition_mode', 'condition',
        'timeout', 'nth', 'poll_interval_ms', 'wait_for_text', 'wait_for_element_hidden',
        'wait_for_text_hidden', 'script', 'expression', 'default', 'optional',
        'clear_first', 'clearFirst', 'click_before_type', 'clickBeforeType'
    ].forEach((key) => delete step[key]);

    const selector = String(selectorNormalization.selector || readField('selector') || '').trim();
    const text = String(readField('text') || '').trim();
    const variable = String(readField('variable') || '').trim();
    const url = String(readField('url') || '').trim();
    const by = String(readField('by') || '').trim();
    const conditionMode = String(readField('condition_mode') || '').trim();
    const timeoutRaw = String(readField('timeout') || '').trim();
    const timeoutValue = timeoutRaw ? Number(timeoutRaw) : Number.NaN;
    const waitForText = String(readField('wait_for_text') || '').trim();
    const waitForElementHidden = String(readField('wait_for_element_hidden') || '').trim();
    const waitForTextHidden = String(readField('wait_for_text_hidden') || '').trim();
    const script = String(readField('script') || '').trim();
    const defaultValue = String(readField('default') || '').trim();
    const nthRaw = String(readField('nth') || '').trim();
    const pollIntervalRaw = String(readField('poll_interval_ms') || '').trim();
    const nthValue = nthRaw ? Number(nthRaw) : Number.NaN;
    const pollIntervalValue = pollIntervalRaw ? Number(pollIntervalRaw) : Number.NaN;

    const selectorTypes = ['click', 'type', 'wait', 'get_credits'];
    const conditionUsesSelector = stepType === 'condition' && ['selector_exists', 'selector_missing'].includes(conditionMode);
    if (selector && (selectorTypes.includes(stepType) || conditionUsesSelector)) {
        step.selector = selector;
    }
    const conditionUsesText = stepType === 'condition' && ['text_exists', 'text_missing', 'url_matches'].includes(conditionMode);
    if (text && (stepType === 'type' || conditionUsesText)) {
        step.text = text;
    }
    if (variable && stepType === 'type') {
        step.variable = variable;
    }
    if (url && stepType === 'navigate') {
        step.url = url;
    }
    if (selectorNormalization.converted && ['click', 'type', 'get_credits'].includes(stepType)) {
        step.by = 'css_selector';
    } else if (by && ['click', 'type', 'get_credits'].includes(stepType)) {
        step.by = by;
    }
    if (conditionMode && stepType === 'condition') {
        step.condition_mode = conditionMode;
    }
    if (Number.isFinite(timeoutValue) && ['navigate', 'click', 'type', 'wait', 'condition', 'get_credits'].includes(stepType)) {
        step.timeout = timeoutValue;
    }
    if (Number.isFinite(nthValue) && ['click', 'type', 'get_credits'].includes(stepType)) {
        step.nth = nthValue;
    }
    if (Number.isFinite(pollIntervalValue) && ['click', 'type', 'condition', 'get_credits'].includes(stepType)) {
        step.poll_interval_ms = pollIntervalValue;
    }
    if (waitForText && stepType === 'wait') {
        step.wait_for_text = waitForText;
    }
    if (waitForElementHidden && stepType === 'wait') {
        step.wait_for_element_hidden = waitForElementHidden;
    }
    if (waitForTextHidden && stepType === 'wait') {
        step.wait_for_text_hidden = waitForTextHidden;
    }
    if (script && (stepType === 'external_script' || (stepType === 'condition' && conditionMode === 'js'))) {
        step.script = script;
    }
    if (defaultValue && stepType === 'get_credits') {
        step.default = defaultValue;
    }
    if (stepType === 'type' && readField('clear_first') === true) {
        step.clear_first = true;
    }
    if (stepType === 'type' && readField('click_before_type') === true) {
        step.click_before_type = true;
    }
    if (readField('optional') === true) {
        step.optional = true;
    }

    return step;
}

function collectSidebarSteps() {
    const cards = collectSidebarStepCards();
    const steps = cards.map((card, index) => readSidebarStepCard(card, index)).filter(Boolean);
    return ensureSidebarStepIds(steps);
}

function syncSidebarEditorToHiddenJson() {
    if (!isSidebarLayout()) {
        return null;
    }

    const cardData = collectSidebarCardDataFromForm();
    if (!cardData) {
        return null;
    }

    setCardEditorValue(cardData);
    updateSidebarEditorMeta(cardData);
    renderSidebarFlowCanvas(cardData);
    return cardData;
}

function collectSidebarCardDataFromForm() {
    if (!isSidebarLayout()) {
        return null;
    }

    const rawJson = String(sidebarCardRawJsonInput?.value || '').trim();
    let base = {};
    if (rawJson) {
      try {
        base = JSON.parse(rawJson);
      } catch (_error) {
        base = {};
      }
    }

    const steps = ensureSidebarStepIds(collectSidebarSteps());
    const flow = normalizeSidebarFlowForSteps(sidebarFlowState, steps);
    const popups = normalizeSidebarPopupsInput(String(sidebarCardPopupsInput?.value || ''));
    const points = Number(sidebarCardPointsInput?.value || 0);
    // 不再收集账号/密码/随机密码：输入内容改由各 type 步骤的变量（text 默认值 + 运行前 inputs 覆盖）承载。
    const { account: _dropAccount, password: _dropPassword, random: _dropRandom, ...baseRest } = base;
    const cardData = {
        ...baseRest,
        name: String(sidebarCardNameInput?.value || base.name || '').trim() || '未命名自动化卡片',
        website: String(sidebarCardWebsiteInput?.value || base.website || '').trim(),
        description: String(sidebarCardDescriptionInput?.value || base.description || '').trim(),
        points: Number.isFinite(points) ? points : 0,
        popups,
        steps,
        flow
    };

    const uploadServerUrl = String(sidebarCardUploadServerUrlInput?.value || '').trim();
    const uploadCardKey = String(sidebarCardUploadCardKeyInput?.value || '').trim();
    if (uploadServerUrl) cardData.upload_server_url = uploadServerUrl;
    else delete cardData.upload_server_url;
    if (uploadCardKey) cardData.upload_card_key = uploadCardKey;
    else delete cardData.upload_card_key;
    cardData.upload = {
        ...(base.upload && typeof base.upload === 'object' ? base.upload : {}),
        server_url: uploadServerUrl,
        card_key: uploadCardKey
    };

    return normalizeCardData(cardData, cardData.name, { allowEmptySteps: true });
}

function renderSidebarCardEditor(cardData) {
    if (!isSidebarLayout() || !sidebarEditorShell) {
        return;
    }

    const normalized = normalizeCardData(cardData || {}, cardData?.name || 'automation', { allowEmptySteps: true });
    const previousExpandedStates = collectSidebarStepExpansionState();
    if (sidebarCardNameInput) sidebarCardNameInput.value = String(normalized.name || '');
    if (sidebarCardWebsiteInput) sidebarCardWebsiteInput.value = String(normalized.website || '');
    if (sidebarCardDescriptionInput) sidebarCardDescriptionInput.value = String(normalized.description || '');
    if (sidebarCardPointsInput) sidebarCardPointsInput.value = String(normalized.points ?? 0);
    if (sidebarCardPopupsInput) sidebarCardPopupsInput.value = formatSidebarPopupsInput(normalized.popups || []);
    if (sidebarCardUploadServerUrlInput) sidebarCardUploadServerUrlInput.value = String(normalized.upload_server_url || normalized.upload?.server_url || '');
    if (sidebarCardUploadCardKeyInput) sidebarCardUploadCardKeyInput.value = String(normalized.upload_card_key || normalized.upload?.card_key || '');
    const steps = Array.isArray(normalized.steps)
        ? normalized.steps.map((step) => {
            const normalizedSelector = normalizeSelectorInputValue(step?.selector || '');
            return {
                ...step,
                selector: normalizedSelector.selector || String(step?.selector || '').trim(),
                by: normalizedSelector.converted ? 'css_selector' : String(step?.by || '').trim()
            };
        })
        : [];
    normalized.steps = ensureSidebarStepIds(steps);
    normalized.flow = normalizeSidebarFlowForSteps(normalized.flow || null, normalized.steps);
    sidebarFlowState = normalized.flow;
    if (sidebarCardRawJsonInput) sidebarCardRawJsonInput.value = stringifyCardData(normalized);
    updateSidebarEditorMeta(normalized);
    renderSidebarFlowCanvas(normalized);
    if (!sidebarStepListNode) {
        return;
    }

    if (normalized.steps.length === 0) {
        sidebarSelectedFlowNodeId = '';
        sidebarStepListNode.innerHTML = '<div class="sidebar-step-empty">点击画布中的节点查看设置。</div>';
        sidebarStepListNode.classList.remove('is-open');
        sidebarStepListNode.setAttribute('aria-hidden', 'true');
        resetSidebarStepStatuses();
        return;
    }

    sidebarStepListNode.innerHTML = normalized.steps.map((step, index) => buildSidebarStepCardHtml(step, index, previousExpandedStates.get(index) === true)).join('');
    collectSidebarStepCards().forEach((card) => updateSidebarStepSettingsVisibility(card));
    syncSidebarNodeSettingsSelection();
    resetSidebarStepStatuses();
}

function getSidebarCardDataFromEditor() {
    return collectSidebarCardDataFromForm();
}

async function getCardDataForExport() {
    if (isSidebarLayout()) {
        const sidebarCardData = getSidebarCardDataFromEditor();
        if (sidebarCardData) {
            return normalizeCardData(sidebarCardData, sidebarCardData?.name || 'automation', { allowEmptySteps: true });
        }
    }

    const editorText = String(getCardEditorValue() || '').trim();
    if (editorText) {
        const cardData = parseEditorCardData(editorText, { allowEmptySteps: true });
        return normalizeCardData(cardData, cardData?.name || 'automation', { allowEmptySteps: true });
    }

    const cacheState = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const cachedCard = cacheState.items.find((item) => item.id === cacheState.selectedId) || cacheState.items[0] || null;
    if (cachedCard?.cardData) {
        return normalizeCardData(cachedCard.cardData, cachedCard.cardName || cachedCard.cardData?.name || 'automation', { allowEmptySteps: true });
    }

    throw new Error('自动化卡片编辑器内容不能为空，请先导入、编辑或保存一次卡片');
}

async function exportCard() {
    const cardData = await getCardDataForExport();
    setCardFileName(cardData.name);
    return {
        cardName: cardData.name,
        text: stringifyCardData(cardData)
    };
}

async function loadLocalCardCacheState() {
    const stored = await chrome.storage.local.get([
        AUTOMATION_CARD_CACHE_LIST_KEY,
        AUTOMATION_CARD_SELECTED_ID_KEY,
        AUTOMATION_CARD_CACHE_KEY,
        AUTOMATION_CARD_CACHE_NAME_KEY,
        AUTOMATION_CARD_CACHE_TIME_KEY,
        AUTOMATION_CARD_PERSIST_PENDING_KEY
    ]);
    const persistPending = stored[AUTOMATION_CARD_PERSIST_PENDING_KEY] === true;

    const list = Array.isArray(stored[AUTOMATION_CARD_CACHE_LIST_KEY]) ? stored[AUTOMATION_CARD_CACHE_LIST_KEY] : [];
    if (list.length > 0) {
        // 单张历史卡片损坏时跳过该项，不能让整份卡片列表都显示为空。
        const items = list.map((item, index) => {
            try {
                return normalizeCardCacheEntry(item, index);
            } catch (_error) {
                return null;
            }
        }).filter(Boolean);
        if (items.length > 0) {
            let selectedId = String(stored[AUTOMATION_CARD_SELECTED_ID_KEY] || '').trim();
            if (!selectedId || !items.some((item) => item.id === selectedId)) {
                selectedId = String(items[0]?.id || '').trim();
            }
            return { items, selectedId, persistPending };
        }
    }

    const legacyCard = stored[AUTOMATION_CARD_CACHE_KEY];
    if (legacyCard && typeof legacyCard === 'object') {
        const legacyItem = normalizeCardCacheEntry({
            id: 'legacy-card',
            cardData: legacyCard,
            cardName: stored[AUTOMATION_CARD_CACHE_NAME_KEY] || legacyCard.name || '',
            savedAt: stored[AUTOMATION_CARD_CACHE_TIME_KEY] || new Date().toISOString(),
            sourceName: stored[AUTOMATION_CARD_CACHE_NAME_KEY] || ''
        }, 0);
        return {
            items: [legacyItem],
            selectedId: legacyItem.id,
            persistPending
        };
    }

    return { items: [], selectedId: '', persistPending };
}

async function requestSoftwareCardCacheDirect(path, options = {}) {
    const stored = await chrome.storage.local.get('agent-settings');
    const settings = stored && stored['agent-settings'] && typeof stored['agent-settings'] === 'object'
        ? stored['agent-settings']
        : {};
    const baseUrl = String(settings.localBridgeUrl || 'http://127.0.0.1:18765').replace(/\/+$/, '');
    const headers = { ...(options.headers || {}) };
    if (options.body != null) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(5000)
            : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.message || `软件卡片库 HTTP ${response.status}`);
    }
    return data;
}

function normalizeSoftwareCardCacheResponse(source = {}) {
    const items = Array.isArray(source?.state?.items)
        ? source.state.items.map((item, index) => normalizeCardCacheEntry(item, index))
        : [];
    const requestedSelectedId = String(source?.state?.selectedId || '').trim();
    return {
        items,
        selectedId: items.some((item) => item.id === requestedSelectedId)
            ? requestedSelectedId
            : String(items[0]?.id || '').trim()
    };
}

async function loadCardCacheState() {
    let backgroundError = null;
    try {
        const response = await chrome.runtime.sendMessage({ type: 'card-cache-persistent-get' });
        if (!response || response.success !== true) {
            throw new Error(response?.error || '读取软件卡片库失败');
        }
        if (response.state?.persisted === false) {
            throw new Error(response.state?.persistError || '后台尚未同步软件卡片库');
        }
        return normalizeSoftwareCardCacheResponse(response);
    } catch (error) {
        backgroundError = error;
    }

    const local = await loadLocalCardCacheState();
    try {
        const direct = local.persistPending
            ? await requestSoftwareCardCacheDirect('/v1/card-cache', {
                method: 'PUT',
                body: JSON.stringify({ state: { items: local.items, selectedId: local.selectedId } })
            })
            : await requestSoftwareCardCacheDirect('/v1/card-cache');
        const normalized = normalizeSoftwareCardCacheResponse(direct);
        await saveLocalCardCacheState(normalized.items, normalized.selectedId, false);
        return normalized;
    } catch (directError) {
        local.persisted = false;
        local.persistError = directError?.message || backgroundError?.message || '读取软件卡片库失败';
        return local;
    }
}

async function saveLocalCardCacheState(items = [], selectedId = '', persistPending = true) {
    const normalizedItems = Array.isArray(items) ? items.map((item, index) => normalizeCardCacheEntry(item, index)) : [];
    const requestedSelectedId = String(selectedId || '').trim();
    const normalizedSelectedId = normalizedItems.some((item) => item.id === requestedSelectedId)
        ? requestedSelectedId
        : String(normalizedItems[0]?.id || '').trim();
    await chrome.storage.local.set({
        [AUTOMATION_CARD_CACHE_LIST_KEY]: normalizedItems,
        [AUTOMATION_CARD_SELECTED_ID_KEY]: normalizedSelectedId,
        [AUTOMATION_CARD_CACHE_KEY]: normalizedItems.find((item) => item.id === normalizedSelectedId)?.cardData || normalizedItems[0]?.cardData || {},
        [AUTOMATION_CARD_CACHE_NAME_KEY]: normalizedItems.find((item) => item.id === normalizedSelectedId)?.cardName || normalizedItems[0]?.cardName || '',
        [AUTOMATION_CARD_CACHE_TIME_KEY]: normalizedItems.find((item) => item.id === normalizedSelectedId)?.savedAt || normalizedItems[0]?.savedAt || '',
        [AUTOMATION_CARD_PERSIST_PENDING_KEY]: persistPending === true
    });
    return {
        items: normalizedItems,
        selectedId: normalizedSelectedId
    };
}

async function saveCardCacheState(items = [], selectedId = '') {
    const normalized = await saveLocalCardCacheState(items, selectedId, true);
    let backgroundError = null;
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'card-cache-persistent-set',
            payload: normalized
        });
        if (!response || response.success !== true || response.persisted !== true) {
            throw new Error(response?.error || '保存软件卡片库失败');
        }
        const savedItems = Array.isArray(response.state?.items)
            ? response.state.items.map((item, index) => normalizeCardCacheEntry(item, index))
            : [];
        return saveLocalCardCacheState(savedItems, response.state?.selectedId, false);
    } catch (error) {
        backgroundError = error;
    }

    // 后台 worker 可能正在随插件刷新而重载。弹窗具备同样的 loopback
    // 访问权限，直接写一次软件桥接，避免导入结果只停留在当前 Profile。
    try {
        const direct = await requestSoftwareCardCacheDirect('/v1/card-cache', {
            method: 'PUT',
            body: JSON.stringify({ state: normalized })
        });
        const saved = normalizeSoftwareCardCacheResponse(direct);
        return saveLocalCardCacheState(saved.items, saved.selectedId, false);
    } catch (directError) {
        // 本地镜像已经标为待同步，但不能再把“仅当前浏览器暂存”伪装成保存成功。
        const reason = directError?.message || backgroundError?.message || '保存软件卡片库失败';
        throw new Error(`${reason}（已暂存在当前浏览器，尚未完成跨窗口保存）`);
    }
}

async function refreshCardCacheUi() {
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    await renderCardCacheList(state);
    return state;
}

async function selectCardCacheItem(cardId) {
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const selectedId = String(cardId || '').trim();
    const item = state.items.find((entry) => String(entry.id || '').trim() === selectedId) || null;
    if (!item) {
        throw new Error('未找到可选中的自动化卡片');
    }

    await saveCardCacheState(state.items, item.id);
    if (isSidebarLayout()) {
        renderSidebarCardEditor(item.cardData);
        syncSidebarEditorToHiddenJson();
    } else {
        setCardEditorValue(item.cardData);
    }
    await renderCardCacheList({
        items: state.items,
        selectedId: item.id
    });
    return item;
}

async function upsertCardCache(cardData, options = {}) {
    const safeCardData = normalizeCardData(cardData, cardData?.name || options.fileName || 'automation', { allowEmptySteps: true });
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    // append=true 必须始终新增。旧逻辑会用当前 selectedId 查找，导致批量导入时
    // 后一张卡片把前一张替换掉。
    const requestedId = String(options.id || '').trim();
    const existingId = requestedId || (options.append === true ? '' : state.selectedId);
    const existingIndex = existingId ? state.items.findIndex((item) => item.id === existingId) : -1;
    const nextItem = normalizeCardCacheEntry({
        id: options.id || (options.append === true ? buildCardCacheId(safeCardData, options.fileName || safeCardData.name) : (state.selectedId || buildCardCacheId(safeCardData, options.fileName || safeCardData.name))),
        cardData: safeCardData,
        cardName: safeCardData.name,
        sourceName: options.fileName || safeCardData.name,
        savedAt: new Date().toISOString()
    });

    const nextItems = state.items.slice();
    if (existingIndex >= 0) {
        nextItems.splice(existingIndex, 1, nextItem);
    } else if (options.append === true) {
        nextItems.push(nextItem);
    } else {
        nextItems.push(nextItem);
    }

    const nextSelectedId = options.select === false ? state.selectedId || nextItem.id : nextItem.id;
    await saveCardCacheState(nextItems, nextSelectedId);
    await renderCardCacheList({ items: nextItems, selectedId: nextSelectedId });
    return {
        cardData: safeCardData,
        cardName: safeCardData.name,
        id: nextItem.id,
        selectedId: nextSelectedId
    };
}

function renderSidebarEditorFromCurrentState() {
    if (!isSidebarLayout()) {
        return;
    }

    try {
        const cardData = collectSidebarCardDataFromForm() || parseEditorCardData(getCardEditorValue() || '{}', { allowEmptySteps: true });
        renderSidebarCardEditor(cardData);
        syncSidebarEditorToHiddenJson();
    } catch (_error) {
        renderSidebarCardEditor({ name: '未命名自动化卡片', steps: [] });
        syncSidebarEditorToHiddenJson();
    }
}

async function saveCardCache(cardData) {
    const result = await upsertCardCache(cardData, { select: true });
    return result.cardData;
}

async function saveEditorCardToCache() {
    const cardData = isSidebarLayout()
        ? getSidebarCardDataFromEditor()
        : parseEditorCardData(getCardEditorValue(), { allowEmptySteps: true });
    const saved = await saveCardCache(cardData);
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    await renderCardCacheList(state);
    return saved;
}


globalThis.CookieCaptureAutomationWorkbench = {
    sanitizeFilePart,
    buildPresetFileName,
    generateCookiePassword,
    setStatus,
    copyTextToClipboard,
    downloadJsonFile,
    showToast,
    showActionToast,
    openTutorialPage,
    loadLastMainPanel,
    saveLastMainPanel,
    activateMainPanel,
    setCardFileName,
    setCardCacheBadge,
    buildCardExportFileName,
    buildCardCacheId,
    normalizeCardCacheEntry,
    buildCardListLabel,
    renderCardCacheList,
    resolveStepVariableKey,
    getCardTypeStepVariables,
    renderCardRunInputs,
    collectCardRunInputs,
    loadCardRunInputsCache,
    saveCardRunInputsForCard,
    normalizeProgressValue,
    setDebugProgress,
    resetDebugProgress,
    scheduleDebugProgressAutoHide,
    clearDebugProgressAutoHideTimer,
    loadStandaloneProgressState,
    formatStepTypeLabel,
    setLoopButtonState,
    refreshLoopButtonState,
    sendStopAction,
    sendContinueAction,
    normalizeCardData,
    stringifyCardData,
    parseEditorCardData,
    setCardEditorValue,
    getCardEditorValue,
    isSidebarLayout,
    sanitizeSidebarStepIdPart,
    buildSidebarStepId,
    ensureSidebarStepIds,
    getSidebarStepId,
    normalizeSidebarFlowForSteps,
    renderSidebarFlowCanvas,
    clearSidebarFlowNodeSelection,
    prepareSidebarFlowNodeContextSelection,
    positionSidebarNodeSettings,
    setSidebarFlowZoom,
    zoomSidebarFlowBy,
    resetSidebarFlowView,
    beginSidebarFlowCanvasPan,
    addSidebarStepToCanvas,
    selectSidebarFlowNode,
    setSidebarFlowConnectMode,
    toggleSidebarFlowConnectMode,
    addSidebarFlowEdge,
    handleSidebarFlowNodeClick,
    beginSidebarFlowPortDrag,
    deleteSidebarFlowEdge,
    deleteSelectedSidebarFlowNodes,
    applySidebarFlowAutoLayout,
    beginSidebarFlowNodeDrag,
    escapeHtml,
    normalizeSidebarPopupsInput,
    formatSidebarPopupsInput,
    decodeHtmlEntities,
    escapeCssIdentifier,
    escapeCssAttributeValue,
    escapeHasTextValue,
    normalizeSelectorText,
    looksLikeHtmlSnippet,
    buildStandardSelectorFromHtmlSnippet,
    normalizeSelectorInputValue,
    normalizeSidebarStepSelectorControl,
    updateSidebarEditorMeta,
    buildSidebarStepTemplate,
    collectSidebarStepExpansionState,
    buildSidebarStepSummary,
    buildSidebarStepCardHtml,
    updateSidebarStepSettingsVisibility,
    collectSidebarStepCards,
    readSidebarStepCard,
    collectSidebarSteps,
    resetSidebarStepStatuses,
    applyExecutionStatusToSidebarStep,
    syncSidebarEditorToHiddenJson,
    collectSidebarCardDataFromForm,
    renderSidebarCardEditor,
    getSidebarCardDataFromEditor,
    getCardDataForExport,
    exportCard,
    loadCardCacheState,
    saveCardCacheState,
    refreshCardCacheUi,
    selectCardCacheItem,
    upsertCardCache,
    renderSidebarEditorFromCurrentState,
    saveCardCache,
    saveEditorCardToCache
};
