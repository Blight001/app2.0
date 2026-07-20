'use strict';

function resolveRunStartIndex(run) {
    const plan = buildRunFlowPlan(run.cardData);
    const firstStep = Array.isArray(run.cardData.steps) ? run.cardData.steps[0] : null;
    const firstStepId = getRunStepId(firstStep || {}, 0);
    return plan.enabled === true && firstStepId !== '__auto_navigate_start' ? plan.startIndex : 0;
}

async function applyRunResumeRequest(run, index) {
    const requested = Math.floor(Number(run.payload.start_step || run.payload.startStep || 0) || 0);
    if (requested <= 1) return index;
    const total = Array.isArray(run.cardData.steps) ? run.cardData.steps.length : 0;
    if (requested > total) {
        throw new Error(`start_step=${requested} 超出步骤总数 ${total}（序号与失败结果 stepIndex 一致；卡片 website 自动插入的 navigate 前置步骤算第 1 步）`);
    }
    await run.emitProgress({
        message: `从第 ${requested}/${total} 步继续执行（跳过前 ${requested - 1} 步，页面保持当前状态）`,
        progress: run.stepProgressStart,
        phase: 'resume_from_step'
    });
    return requested - 1;
}

function applyTypeStepVariable(run, step, steps, index, actionText) {
    let ordinal = 0;
    for (let scan = 0; scan <= index && scan < steps.length; scan += 1) {
        if (String(steps[scan]?.type || '').trim().toLowerCase() === 'type') ordinal += 1;
    }
    const variableKey = resolveStepVariableKey(step, ordinal);
    const hasOverride = Object.prototype.hasOwnProperty.call(run.runInputs, variableKey)
        && run.runInputs[variableKey] !== undefined
        && run.runInputs[variableKey] !== null;
    const baseText = hasOverride ? String(run.runInputs[variableKey]) : String(step.text || '');
    const text = resolveTemplate(baseText, run.context);
    run.context[variableKey] = text;
    return { text, note: hasOverride ? `（变量 ${variableKey} 覆盖）` : '', fallback: actionText };
}

function createStepActionPayload(run, step, stepType, resolvedSelector, text) {
    return {
        type: stepType,
        selector: resolvedSelector,
        text,
        nth: step.nth,
        clearFirst: step.clear_first === true || step.clearFirst === true,
        clickBeforeType: step.click_before_type === true || step.clickBeforeType === true,
        timeoutMs: Number(step.timeout || 5000),
        intervalMs: Number(step.poll_interval_ms || step.click_poll_interval_ms || 200),
        defaultValue: step.default,
        default: step.default,
        script: resolveTemplate(step.script || '', run.context),
        waitForText: resolveTemplate(step.wait_for_text || '', run.context),
        waitForElementHidden: resolveTemplate(step.wait_for_element_hidden || '', run.context),
        waitForTextHidden: resolveTemplate(step.wait_for_text_hidden || '', run.context)
    };
}

async function captureFinalStepFailure(run, state, details) {
    let failureSnapshot = null;
    try {
        failureSnapshot = await captureCardFailureSnapshot(run.tabId, {
            selector: details.selector,
            stepName: state.stepName
        });
    } catch (_error) {}
    run.lastFailureDetails = {
        errorCode: details.errorCode,
        stepIndex: state.index + 1,
        stepTotal: state.liveTotalSteps,
        stepName: state.stepName,
        stepType: details.stepType,
        selector: String(details.selector || '').trim(),
        attempts: state.currentAttempt,
        failureSnapshot
    };
}

function buildStepFailureProgress(state, details, running, retrying) {
    return {
        message: details.message, progress: state.stepStartProgress, kind: 'error', phase: details.phase,
        stepIndex: state.index + 1, stepTotal: state.liveTotalSteps, stepName: state.stepName,
        previousStepName: state.previousStepName, nextStepName: state.nextStepName,
        errorReason: details.detailed, errorCode: details.code, running, retrying
    };
}

async function handleRetryingStepFailure(run, state, details) {
    details.message = details.retryMessage || `${state.stepLabel} · 执行失败，正在重试 (${state.currentAttempt}/${state.maxAttempts})`;
    await run.emitProgress(buildStepFailureProgress(state, details, true, true));
    await sleep(run.stepRetryDelayMs);
    return 'retrying';
}

async function handleMaxStepFailure(run, state, details) {
    await captureFinalStepFailure(run, state, details);
    details.message = details.retryMessage || details.detailed;
    await run.emitProgress(buildStepFailureProgress(state, details, false, false));
    run.maxRetriesExceeded = true;
    return 'max_reached';
}

function normalizeStepFailureDetails(state, args) {
    const error = args.error;
    const errorMessage = error && error.message ? error.message : error;
    const errorCode = error && error.stepCode;
    const rawReason = String(args.errorReason || errorMessage || '').trim();
    const code = String(args.errorCode || errorCode || 'STEP_FAILED').trim();
    const detailed = buildDetailedFailureReason({
        stepIndex: state.index + 1, stepName: state.stepName, stepType: args.stepType,
        reason: rawReason, attempt: state.currentAttempt, maxAttempts: state.maxAttempts, selector: args.selector
    });
    return { ...args, rawReason, code, detailed };
}

async function pauseFailedAutomationStep(run, state, details) {
    Object.assign(run.executionState, {
        currentStepIndex: state.index, currentStepName: state.stepName,
        pausedAtFailure: true, updatedAt: new Date().toISOString()
    });
    await pauseAtStep({
        tabId: run.tabId, cardName: run.currentCardName, stepName: state.stepName,
        stepIndex: state.index + 1, stepTotal: state.liveTotalSteps, progress: state.stepStartProgress,
        errorReason: details.detailed, message: details.message || details.detailed,
        previousStepName: state.previousStepName, nextStepName: state.nextStepName
    }, run.emitProgress);
    return 'paused';
}

function createStepFailureHandler(run, state) {
    return async (args = {}) => {
        const details = normalizeStepFailureDetails(state, {
            message: '', retryMessage: '', errorReason: '', phase: 'step_retry',
            stepType: '', selector: '', errorCode: '', ...args
        });
        run.lastDetailedError = details.detailed;
        if (run.retryFailedStep && state.currentAttempt >= state.maxAttempts) {
            return handleMaxStepFailure(run, state, {
                errorCode: details.code, ...details
            });
        }
        if (run.retryFailedStep) return handleRetryingStepFailure(run, state, details);
        return pauseFailedAutomationStep(run, state, details);
    };
}

function createAutomationStepState(run, result, steps, index, currentAttempt) {
    const step = steps[index];
    const stepType = String(step.type || '').trim().toLowerCase();
    const stepName = String(step.name || `步骤${index + 1}`).trim() || `步骤${index + 1}`;
    const runFlowPlan = buildRunFlowPlan(run.executionState.cardData || run.cardData);
    const liveTotalSteps = steps.length;
    const span = liveTotalSteps > 0 ? (run.stepProgressEnd - run.stepProgressStart) / liveTotalSteps : 0;
    const state = {
        run,
        result,
        steps,
        index,
        step,
        stepType,
        stepName,
        runFlowPlan,
        activeCardData: run.executionState.cardData || run.cardData,
        liveTotalSteps,
        currentAttempt,
        maxAttempts: stepType === 'wait' ? run.maxWaitStepAttempts : 1,
        stepStartProgress: Math.min(run.stepProgressEnd, run.stepProgressStart + (index * span)),
        stepEndProgress: Math.min(run.stepProgressEnd, run.stepProgressStart + ((index + 1) * span)),
        previousStepName: getPreviousAutomationStepName(steps, index),
        nextStepName: formatRunFlowNextStepNames(runFlowPlan, steps, index)
    };
    const attemptInfo = run.retryFailedStep && currentAttempt > 1 ? ` (尝试 ${currentAttempt}/${state.maxAttempts})` : '';
    state.stepLabel = formatStepProgressLabel(index + 1, liveTotalSteps, stepName) + attemptInfo;
    state.resolvedSelector = resolveTemplate(step.selector || '', run.context);
    let text = resolveTemplate(step.text || '', run.context);
    let typeNote = '';
    if (stepType === 'type') {
        const resolved = applyTypeStepVariable(run, step, steps, index, text);
        text = resolved.text;
        typeNote = resolved.note;
    }
    state.typeNote = typeNote;
    state.actionPayload = createStepActionPayload(run, step, stepType, state.resolvedSelector, text);
    state.handleStepFailure = createStepFailureHandler(run, state);
    return state;
}

function getPreviousAutomationStepName(steps, index) {
    if (index <= 0) return '';
    const previous = steps[index - 1] || {};
    return String(previous.name || `步骤${index}`).trim() || `步骤${index}`;
}

function getLiveRunSteps(run) {
    const executionCard = run.executionState.cardData || {};
    return Array.isArray(executionCard.steps) ? executionCard.steps : [];
}

function updateStepAttemptState(run, index, state) {
    if (index !== state.lastFailedStepIndex) return { lastFailedStepIndex: index, stepAttempt: 1 };
    return { ...state, stepAttempt: run.retryFailedStep ? state.stepAttempt + 1 : state.stepAttempt };
}

async function executeAutomationStep(state) {
    const handlers = {
        navigate: executeNavigateAutomationStep,
        save_cookies: executeSaveCookiesAutomationStep,
        clear_current_page_cache: executeClearCacheAutomationStep,
        condition: executeConditionAutomationStep,
        wait: executeWaitAutomationStep,
        get_credits: executeCreditsAutomationStep,
        external_script: executeExternalScriptAutomationStep,
        screenshot: executeScreenshotAutomationStep
    };
    return (handlers[state.stepType] || executeGenericAutomationStep)(state);
}

async function executeStandaloneRunSteps(run, result) {
    let index = await applyRunResumeRequest(run, resolveRunStartIndex(run));
    let transitionCount = 0;
    let lastFailedStepIndex = -1;
    let stepAttempt = 1;
    const maxTransitions = Math.max(120, (Array.isArray(run.cardData.steps) ? run.cardData.steps.length : 0) * 20);
    while (index < getLiveRunSteps(run).length) {
        if (isTabStopped(run.tabId)) throw createStopError();
        transitionCount += 1;
        if (transitionCount > maxTransitions) throw new Error(`流程跳转次数超过上限 ${maxTransitions}，请检查 flow.edges 是否存在无出口循环`);
        const steps = getLiveRunSteps(run);
        if (index >= steps.length) break;
        if (!steps[index] || typeof steps[index] !== 'object') {
            run.lastDetailedError = buildDetailedFailureReason({ stepIndex: index + 1, stepName: `步骤${index + 1}`, stepType: 'invalid', reason: '步骤配置无效' });
            throw new Error(run.lastDetailedError);
        }
        ({ lastFailedStepIndex, stepAttempt } = updateStepAttemptState(run, index, { lastFailedStepIndex, stepAttempt }));
        const state = createAutomationStepState(run, result, steps, index, stepAttempt);
        await run.emitProgress({
            message: `${state.stepLabel} · 开始执行${state.typeNote}`,
            progress: state.stepStartProgress,
            phase: 'step_start',
            stepIndex: index + 1,
            stepTotal: state.liveTotalSteps,
            stepName: state.stepName,
            previousStepName: state.previousStepName,
            nextStepName: state.nextStepName
        });
        if (isTabStopped(run.tabId)) throw createStopError();
        const outcome = await executeAutomationStep(state);
        if (outcome === 'retry') continue;
        const nextIndex = resolveRunFlowNextIndex(state.runFlowPlan, steps, index, outcome || 'next');
        index = Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : steps.length;
    }
    if (run.maxRetriesExceeded) throw run.makeStepFailureError('卡片执行失败：步骤重试已达上限');
    return result;
}
