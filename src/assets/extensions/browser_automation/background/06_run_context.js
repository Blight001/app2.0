'use strict';

function startExecutionTrace(entries, timing, state, now) {
    const stepIndex = Number(state.stepIndex);
    let entry = entries.find((item) => item.stepIndex === stepIndex);
    if (!entry) {
        entry = {
            stepIndex, stepName: String(state.stepName || ''), status: 'running', attempts: 0,
            startedAt: new Date(now).toISOString(), finishedAt: '', durationMs: 0, attemptDetails: []
        };
        entries.push(entry);
        timing.set(stepIndex, { startMs: now, attemptStartMs: now });
    } else {
        const stepTiming = timing.get(stepIndex) || { startMs: now };
        stepTiming.attemptStartMs = now;
        timing.set(stepIndex, stepTiming);
    }
    entry.attempts += 1;
}

function completeExecutionTrace(entry, state, phase, now, attemptMs, durationMs) {
    const skipped = phase === 'step_skip';
    entry.status = skipped ? 'skipped' : (state.kind === 'error' ? 'completed_with_warning' : 'success');
    entry.finishedAt = new Date(now).toISOString();
    entry.durationMs = durationMs;
    entry.message = String(state.message || '');
    entry.attemptDetails.push({ attempt: entry.attempts, result: skipped ? 'skipped' : 'success', durationMs: attemptMs });
}

function retryExecutionTrace(entry, state, now, attemptMs, durationMs) {
    entry.attemptDetails.push({
        attempt: entry.attempts, result: 'failed',
        error: String(state.errorReason || state.message || ''), durationMs: attemptMs
    });
    if (state.retrying !== false) return;
    Object.assign(entry, {
        status: 'failed', finishedAt: new Date(now).toISOString(), durationMs,
        errorReason: String(state.errorReason || ''), errorCode: String(state.errorCode || '')
    });
}

function recordExecutionTrace(entries, timing, state = {}) {
    try {
        const phase = String(state.phase || '');
        const stepIndex = Number(state.stepIndex) || 0;
        if (!stepIndex) return;
        const now = Date.now();
        if (phase === 'step_start') {
            startExecutionTrace(entries, timing, state, now);
            return;
        }
        const entry = entries.find((item) => item.stepIndex === stepIndex);
        if (!entry) return;
        const stepTiming = timing.get(stepIndex) || { startMs: now, attemptStartMs: now };
        const attemptMs = Math.max(0, now - (stepTiming.attemptStartMs || now));
        const durationMs = Math.max(0, now - (stepTiming.startMs || now));
        if (phase === 'step_complete' || phase === 'step_skip') {
            completeExecutionTrace(entry, state, phase, now, attemptMs, durationMs);
        } else if (phase === 'step_retry') {
            retryExecutionTrace(entry, state, now, attemptMs, durationMs);
        }
    } catch (_error) {}
}

function createExecutionTraceController(cardData, getExecutionState) {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const entries = [];
    const timing = new Map();

    function record(state = {}) { recordExecutionTrace(entries, timing, state); }

    function summary() {
        const finishedMs = Date.now();
        const executionState = getExecutionState();
        const stepsTotal = Array.isArray(executionState?.cardData?.steps)
            ? executionState.cardData.steps.length
            : (Array.isArray(cardData.steps) ? cardData.steps.length : 0);
        return {
            startedAt,
            finishedAt: new Date(finishedMs).toISOString(),
            durationMs: finishedMs - startedAtMs,
            stepsTotal,
            stepsExecuted: entries.length,
            succeeded: entries.filter((entry) => entry.status === 'success' || entry.status === 'completed_with_warning').length,
            failed: entries.filter((entry) => entry.status === 'failed').length,
            skipped: entries.filter((entry) => entry.status === 'skipped').length,
            retries: entries.reduce((sum, entry) => sum + Math.max(0, (entry.attempts || 1) - 1), 0),
            steps: entries
        };
    }

    return { record, summary };
}

async function resolveStandaloneRunTab(payload, cardData, context) {
    const requestedTabId = Number(payload.tab_id ?? payload.tabId ?? 0) || 0;
    let tab = requestedTabId > 0
        ? await resolveAutomationTargetTab({ tab_id: requestedTabId })
        : await getOrFindActiveTab(cardData.website || '');
    if (!tab) {
        const entryNavigation = resolveCardEntryNavigation(cardData, context);
        if (!entryNavigation.url) {
            const error = new Error('卡片执行失败：未找到可用的当前标签页，且卡片缺少可用于新建标签页的 http/https 入口地址');
            error.code = 'MISSING_URL';
            throw error;
        }
        tab = await chrome.tabs.create({ url: entryNavigation.url, active: true });
        await rememberAutomationTargetTab(tab.id);
        await waitForTabComplete(tab.id, entryNavigation.timeoutMs);
        tab = await chrome.tabs.get(tab.id);
    }
    if (!tab || !Number.isFinite(Number(tab.id || 0))) {
        throw new Error('卡片执行失败：未找到可用的当前标签页');
    }
    return tab;
}

async function resolveStandaloneCardData(payload) {
    const providedCardData = payload.cardData && typeof payload.cardData === 'object' ? payload.cardData : null;
    const cachedCard = providedCardData ? null : await loadCardCache().catch(() => null);
    const cachedData = cachedCard && cachedCard.cardData || {};
    return { providedCardData, cardData: normalizeStandaloneSteps(providedCardData || cachedData) };
}

function buildStandaloneRunContextValues(payload, cardData, runInputs) {
    return {
        ...runInputs,
        account: String(payload.account || runInputs.account || cardData.account || '').trim(),
        password: String(payload.password || runInputs.password || cardData.password || '').trim(),
        code: String(payload.code || runInputs.code || '').trim(),
        email: String(payload.email || runInputs.email || cardData.email || '').trim()
    };
}

function buildStandaloneRun(payload, providedCardData, cardData, runInputs, context) {
    return {
        payload, providedCardData, cardData, runInputs, context, progressMode: 'run',
        stepProgressStart: 20, stepProgressEnd: 90,
        stepRetryDelayMs: Math.max(1000, Number(payload.step_retry_delay_ms || payload.stepRetryDelayMs || payload.retryDelayMs || 2000)),
        maxWaitStepAttempts: 1, retryFailedStep: true, tabId: 0, currentCardName: '', executionState: null,
        lastDetailedError: '', lastFailureDetails: null, maxRetriesExceeded: false
    };
}

function attachStandaloneProgressEmitter(run, trace) {
    run.emitProgress = async (message, kind = '') => {
        try {
            const state = typeof message === 'object' && message !== null ? { ...message } : { message: String(message || '') };
            if (!state.message) state.message = '';
            if (kind && !state.kind) state.kind = kind;
            Object.assign(state, {
                mode: run.progressMode, tabId: run.tabId, cardName: run.currentCardName,
                running: state.running === false ? false : true
            });
            trace.record(state);
            await saveStandaloneProgressState(state);
            await chrome.runtime.sendMessage({ type: 'card-run-progress', ...state });
        } catch (_error) {}
    };
}

function initializeStandaloneRunSession(run, tab) {
    run.tabId = Number(tab.id);
    run.currentCardName = String(run.cardData.name || '').trim();
    stoppedTabs.delete(run.tabId);
    run.executionState = {
        tabId: run.tabId, cardData: run.cardData, progressMode: run.progressMode,
        cardName: run.currentCardName, running: true, updatedAt: new Date().toISOString()
    };
    standaloneSessions.set(run.tabId, run.executionState);
}

async function createStandaloneRunContext(payload = {}) {
    const { providedCardData, cardData } = await resolveStandaloneCardData(payload);
    const runInputs = normalizeRunInputs(payload, cardData);
    const context = buildStandaloneRunContextValues(payload, cardData, runInputs);
    const run = buildStandaloneRun(payload, providedCardData, cardData, runInputs, context);
    const trace = createExecutionTraceController(cardData, () => run.executionState);
    run.buildExecutionSummary = trace.summary;
    attachStandaloneProgressEmitter(run, trace);
    const tab = await resolveStandaloneRunTab(payload, cardData, context);
    initializeStandaloneRunSession(run, tab);
    if (isTabStopped(run.tabId)) throw createStopError();
    run.makeStepFailureError = (fallbackMessage) => {
        const error = new Error(run.lastDetailedError || fallbackMessage);
        if (run.lastFailureDetails) error.failure = run.lastFailureDetails;
        return error;
    };
    return run;
}
