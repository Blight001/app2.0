'use strict';

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

function progressText(value, fallback = '') {
    return String(value || fallback).trim() || fallback;
}

function progressNumber(value) {
    return Number(value) || 0;
}

function updateActiveDebugErrorReason(state, phase) {
    const hasReason = Object.prototype.hasOwnProperty.call(state, 'errorReason');
    if (hasReason) {
        activeDebugErrorReason = progressText(state.errorReason);
    } else if (state.kind !== 'error' && ['start', 'password_ready', 'step_start', 'step_complete', 'step_skip', 'save_cookies', 'finished', 'debug_complete'].includes(phase)) {
        activeDebugErrorReason = '';
    }
    return hasReason;
}

function renderDebugProgressValues(state, progress, hasProgress, text, meta, phase) {
    if (hasProgress && debugProgressFillNode) debugProgressFillNode.style.width = `${progress}%`;
    if (hasProgress && debugProgressPercentNode) debugProgressPercentNode.textContent = `${Math.round(progress)}%`;
    if (debugProgressTextNode) debugProgressTextNode.textContent = text;
    if (state.kind === 'error' || phase === 'failed') {
        if (debugProgressFillNode) debugProgressFillNode.style.width = '0%';
        if (debugProgressPercentNode) debugProgressPercentNode.textContent = '0%';
    }
    if (debugProgressMetaNode) debugProgressMetaNode.textContent = meta;
    if (debugProgressErrorNode) {
        debugProgressErrorNode.textContent = activeDebugErrorReason ? `错误原因：${activeDebugErrorReason}` : '';
    }
}

function renderRunControlButton(state, visible, phase) {
    if (!runControlStopButton) return;
    runControlStopButton.disabled = !visible;
    runControlStopButton.hidden = !visible;
    if (!visible) return;
    const canContinue = (state.kind === 'error' || phase === 'failed') && progressNumber(state.stepIndex) > 0;
    runControlStopButton.textContent = canContinue ? '继续' : '停止';
    runControlStopButton.title = canContinue ? `从失败的步骤 ${state.stepIndex} 继续/重试` : '停止执行';
    runControlStopButton.dataset.action = canContinue ? 'continue' : 'stop';
}

function renderDebugControlLabel(state, phase) {
    if (!debugControlLabel) return;
    if (state.kind === 'error' || phase === 'failed') debugControlLabel.textContent = '当前：执行失败';
    else if (phase === 'stopped') debugControlLabel.textContent = '当前：已停止';
    else if (state.running === false) debugControlLabel.textContent = '当前：执行结束';
    else debugControlLabel.textContent = '当前：自动化执行中';
}

function setDebugProgress(state = {}) {
    if (!debugProgressPanel) {
        return;
    }

    clearDebugProgressAutoHideTimer();

    const hasProgress = Number.isFinite(Number(state.progress));
    const progress = hasProgress ? normalizeProgressValue(state.progress) : null;
    const text = progressText(state.message, '等待执行');
    const meta = progressText(state.meta);
    const phase = progressText(state.phase);
    const visible = state.visible !== false;
    updateActiveDebugErrorReason(state, phase);
    debugProgressPanel.classList.toggle('is-visible', visible);
    debugProgressPanel.classList.toggle('is-error', state.kind === 'error');
    renderDebugProgressValues(state, progress, hasProgress, text, meta, phase);
    renderRunControlButton(state, visible, phase);
    renderDebugControlLabel(state, phase);
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
        tabId: progressNumber(state.tabId) || null,
        cardName: progressText(state.cardName),
        message: progressText(state.message, '等待执行'),
        phase: progressText(state.phase),
        mode: progressText(state.mode),
        isLooping: state.isLooping === true,
        kind: progressText(state.kind),
        errorReason: progressText(state.errorReason),
        stepIndex: progressNumber(state.stepIndex),
        stepTotal: progressNumber(state.stepTotal),
        stepName: progressText(state.stepName),
        previousStepName: progressText(state.previousStepName),
        nextStepName: progressText(state.nextStepName),
        running: state.running === true,
        visible: state.visible !== false,
        progress: Number.isFinite(progressValue) ? progressValue : undefined,
        updatedAt: progressText(state.updatedAt)
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
    const stepIndex = progressNumber(state?.stepIndex);
    if (!stepIndex || stepIndex < 1) {
        throw new Error('没有可继续的失败步骤信息');
    }

    let cardData = null;
    try {
        const cacheState = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
        const items = Array.isArray(cacheState.items) ? cacheState.items : [];
        const selected = items.find((item) => item?.id === cacheState.selectedId) || items[0];
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

function firstSidebarStepValue(values) {
    return values.find((value) => String(value ?? '').trim()) ?? '';
}

function buildSidebarStepId(step = {}, index = 0, usedIds = new Set()) {
    const explicit = String(firstSidebarStepValue([step?.id, step?.step_id, step?.nodeId])).trim();
    const label = firstSidebarStepValue([step?.name, step?.type, 'step']);
    let base = explicit || `${sanitizeSidebarStepIdPart(label)}_${index + 1}`;
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
