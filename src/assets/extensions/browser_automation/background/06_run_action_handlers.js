'use strict';

async function handleAutomationStepError(state, error, options = {}) {
    const handled = await state.handleStepFailure({
        error,
        message: error?.message || options.pauseMessage,
        retryMessage: error?.message ? `${state.stepLabel} · ${error.message}，正在重试` : options.retryMessage,
        errorReason: error?.message || options.errorReason,
        stepType: options.stepType,
        selector: options.selector ?? state.resolvedSelector,
        errorCode: options.errorCode || error?.stepCode || ''
    });
    if (handled === 'max_reached') {
        throw state.run.makeStepFailureError(options.failureMessage
            || `${state.stepLabel} 失败（已重试 ${state.currentAttempt} 次达到上限）`);
    }
    return 'retry';
}

async function executeWaitAutomationStep(state) {
    try {
        const result = await executeNavigationAwareWait(state.run.tabId, {
            ...state.actionPayload,
            type: 'wait',
            hidden: state.step.wait_for_element_hidden ? true : false,
            selector: state.resolvedSelector,
            timeoutMs: Number(state.step.timeout || state.step.wait_ms || state.step.waitMs || 3000),
            intervalMs: Number(state.step.wait_for_element_interval_ms || state.step.poll_interval_ms || 200)
        });
        if (!result || result.success !== true) {
            const error = new Error(result?.error || `等待步骤失败: ${state.stepName}`);
            error.stepCode = result?.code || 'WAIT_TIMEOUT';
            throw error;
        }
        return completeAutomationStep(state, `${state.stepLabel} · 等待完成`);
    } catch (error) {
        return handleAutomationStepError(state, error, {
            pauseMessage: `${state.stepLabel} · 等待步骤失败，已暂停等待修改`,
            retryMessage: `${state.stepLabel} · 等待步骤失败，正在重试`,
            errorReason: `等待步骤失败: ${state.stepName}`,
            stepType: 'wait'
        });
    }
}

async function executeCreditsAutomationStep(state) {
    try {
        const credit = await executePageAction(state.run.tabId, state.actionPayload);
        if (!credit || credit.success !== true) {
            const error = new Error(credit?.error || `获取积分失败: ${state.stepName}`);
            error.stepCode = credit?.code || 'GET_CREDITS_FAILED';
            throw error;
        }
        state.result.points = String(credit.value || '').trim() || state.result.points;
        return completeAutomationStep(state, `${state.stepLabel} · 已读取`);
    } catch (error) {
        return handleAutomationStepError(state, error, {
            pauseMessage: `${state.stepLabel} · 获取积分失败，已暂停等待修改`,
            retryMessage: `${state.stepLabel} · 获取积分失败，正在重试`,
            errorReason: `获取积分失败: ${state.stepName}`,
            stepType: 'get_credits'
        });
    }
}

async function runExternalPageScript(tabId, scriptCode) {
    if (!scriptCode) return { success: true };
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (code) => {
            try {
                const fn = new Function('return (async () => { ' + code + ' })();');
                return fn();
            } catch (error) {
                return { __error: true, message: error?.message || String(error) };
            }
        },
        args: [scriptCode]
    });
    const value = Array.isArray(results) ? results[0]?.result : null;
    return value?.__error ? { success: false, error: value.message } : { success: true, result: value };
}

async function executeExternalScriptAutomationStep(state) {
    try {
        const result = await runExternalPageScript(state.run.tabId, String(state.actionPayload.script || '').trim());
        if (!result || result.success !== true) {
            const error = new Error(result?.error || `脚本步骤失败: ${state.stepName}`);
            error.stepCode = 'SCRIPT_ERROR';
            throw error;
        }
        return completeAutomationStep(state, `${state.stepLabel} · 脚本完成`);
    } catch (error) {
        return handleAutomationStepError(state, error, {
            pauseMessage: `${state.stepLabel} · 脚本步骤失败，已暂停等待修改`,
            retryMessage: `${state.stepLabel} · 脚本步骤失败，正在重试`,
            errorReason: `脚本步骤失败: ${state.stepName}`,
            stepType: 'external_script'
        });
    }
}

async function executeScreenshotAutomationStep(state) {
    try {
        const tab = await chrome.tabs.get(state.run.tabId).catch(() => null);
        const windowId = Number.isFinite(Number(tab?.windowId)) ? tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = (state.run.currentCardName || 'card').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40) || 'card';
        const filename = `automation_screenshots/${safeName}_${timestamp}.png`;
        await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' });
        await completeAutomationStep(state, `${state.stepLabel} · 截图已保存（${filename}）`);
    } catch (error) {
        await completeAutomationStep(state, `${state.stepLabel} · 截图失败（${error?.message || '未知错误'}），已跳过`, { kind: 'error' });
    }
    return 'next';
}

async function tryGenericAutomationSelectors(state, selectors) {
    const outcome = { error: '', code: '', selector: String(state.resolvedSelector || '').trim() };
    for (const selector of selectors) {
        outcome.selector = selector;
        try {
            const actionType = state.stepType === 'click' || state.stepType === 'type' ? state.stepType : state.stepType;
            const result = await executePageAction(state.run.tabId, { ...state.actionPayload, selector, type: actionType });
            if (result && result.success === true) return { success: true };
            outcome.error = result && result.error || outcome.error;
            outcome.code = result && result.code || outcome.code;
        } catch (error) {
            outcome.error = error && error.message || outcome.error;
        }
    }
    return { success: false, ...outcome };
}

async function skipOptionalAutomationStep(state) {
    await state.run.emitProgress({
        message: `${state.stepLabel} · 可选步骤已跳过`, progress: state.stepEndProgress,
        phase: 'step_skip', stepIndex: state.index + 1, stepTotal: state.liveTotalSteps, stepName: state.stepName
    });
    return 'next';
}

async function executeGenericAutomationStep(state) {
    const selectors = normalizeSelectorCandidates(state.step.by || 'css_selector', state.resolvedSelector);
    const outcome = await tryGenericAutomationSelectors(state, selectors);
    if (outcome.success) return completeAutomationStep(state, `${state.stepLabel} · 已完成`);
    if (state.step.optional === true || state.step.optional === 'true') return skipOptionalAutomationStep(state);
    return handleAutomationStepError(state, new Error(outcome.error || '步骤执行失败'), {
        pauseMessage: `${state.stepLabel} · 执行失败，已暂停等待修改`,
        retryMessage: `${state.stepLabel} · 执行失败，正在重试`,
        errorReason: outcome.error || '步骤执行失败',
        stepType: state.stepType,
        selector: outcome.selector,
        errorCode: outcome.code
    });
}
