'use strict';

async function completeAutomationStep(state, message, extras = {}) {
    await state.run.emitProgress({
        message,
        progress: state.stepEndProgress,
        phase: 'step_complete',
        stepIndex: state.index + 1,
        stepTotal: state.liveTotalSteps,
        stepName: state.stepName,
        ...extras
    });
    return 'next';
}

function getNavigateStepErrorCode(missingUrl, errorMessage) {
    if (missingUrl) return 'MISSING_URL';
    return errorMessage === '页面加载超时' ? 'NAVIGATION_TIMEOUT' : 'NAVIGATE_FAILED';
}

async function handleNavigateStepFailure(state, error, missingUrl = false) {
    const { run, step, stepLabel, stepName, activeCardData } = state;
    const errorMessage = error && error.message;
    const reason = missingUrl ? `步骤 ${stepName} 缺少有效 URL` : (errorMessage || `步骤 ${stepName} 导航失败`);
    const handled = await state.handleStepFailure({
        error,
        message: missingUrl ? `${stepLabel} · 缺少有效 URL` : (errorMessage || `${stepLabel} · 导航失败，已暂停等待修改`),
        retryMessage: missingUrl ? `${stepLabel} · 缺少有效 URL，正在重试`
            : (errorMessage ? `${stepLabel} · ${errorMessage}，正在重试` : `${stepLabel} · 导航失败，正在重试`),
        errorReason: reason,
        stepType: 'navigate',
        selector: missingUrl ? '' : (step.url || activeCardData.website || ''),
        errorCode: getNavigateStepErrorCode(missingUrl, errorMessage)
    });
    if (handled === 'max_reached') {
        const suffix = missingUrl ? '缺少有效 URL' : `已重试 ${state.currentAttempt} 次达到上限`;
        throw run.makeStepFailureError(`${stepLabel} 失败（${suffix}）`);
    }
    return 'retry';
}

async function executeNavigateAutomationStep(state) {
    const { run, step, stepLabel, stepName, activeCardData } = state;
    try {
        const url = normalizeTargetUrl(resolveTemplate(step.url || '', run.context)
            || resolveTemplate(activeCardData.website || '', run.context));
        if (!url) {
            return handleNavigateStepFailure(state, new Error(`步骤 ${stepName} 缺少有效 URL`), true);
        }
        const currentTab = await chrome.tabs.get(run.tabId).catch(() => null);
        const currentTabUrl = normalizeTargetUrl(String(currentTab?.url || '').trim());
        const refreshCurrentPage = currentTabUrl === url;
        if (refreshCurrentPage) {
            await chrome.tabs.reload(run.tabId);
            await waitForTabComplete(run.tabId, Number(step.timeout || 15000));
        } else {
            await chrome.tabs.update(run.tabId, { url });
            await waitForTabComplete(run.tabId, Number(step.timeout || 15000));
        }
        return completeAutomationStep(state, refreshCurrentPage
            ? `${stepLabel} · 已在目标网页，已刷新页面`
            : `${stepLabel} · 已跳转`);
    } catch (error) {
        return handleNavigateStepFailure(state, error, false);
    }
}

async function executeSaveCookiesAutomationStep(state) {
    const { run, result, stepLabel } = state;
    const captureAccount = String(run.context.email || run.context.account || result.account || run.payload.account || '').trim();
    const capturePassword = String(run.context.code || result.password || run.payload.password || '').trim();
    if (!captureAccount || !capturePassword) {
        result.cookieSaveError = '获取Cookie 步骤缺少账号或验证码，已跳过保存';
        await run.emitProgress({
            message: `${stepLabel} · ${result.cookieSaveError}`,
            progress: state.stepEndProgress,
            kind: 'error',
            phase: 'step_skip',
            stepIndex: state.index + 1,
            stepTotal: state.liveTotalSteps,
            stepName: state.stepName
        });
        return 'next';
    }
    try {
        const saved = await saveCookieStepResult(run.tabId, captureAccount, capturePassword);
        Object.assign(result, {
            cookiesSaved: true,
            savedFileName: saved.fileName,
            cookieCount: saved.cookieCount,
            browserStorageCount: saved.browserStorageCount,
            pageUrl: saved.pageUrl,
            pageTitle: saved.pageTitle
        });
    } catch (error) {
        result.cookieSaveError = error?.message || 'Cookie 保存失败';
    }
    return completeAutomationStep(
        state,
        result.cookiesSaved === true ? `${stepLabel} · Cookie 已保存` : `${stepLabel} · Cookie 保存失败，继续执行`,
        { kind: result.cookiesSaved === true ? '' : 'error' }
    );
}

function summarizeCacheClearResult(result = {}) {
    const labels = [
        ['removedCookieCount', 'Cookie', '个'],
        ['clearedLocalStorageCount', 'localStorage', '项'],
        ['clearedSessionStorageCount', 'sessionStorage', '项'],
        ['clearedCacheStorageCount', 'CacheStorage', '项'],
        ['clearedIndexedDbCount', 'IndexedDB', '项']
    ];
    return labels.flatMap(([key, label, unit]) => Number(result[key] || 0) > 0 ? [`${label} ${result[key]} ${unit}`] : []);
}

async function executeClearCacheAutomationStep(state) {
    try {
        const result = await clearCurrentPageCache(state.run.tabId);
        const parts = summarizeCacheClearResult(result);
        return completeAutomationStep(state, parts.length > 0
            ? `${state.stepLabel} · 已清理当前页缓存（${parts.join('，')}）`
            : `${state.stepLabel} · 已清理当前页缓存`);
    } catch (error) {
        const handled = await state.handleStepFailure({
            error,
            message: error?.message || `${state.stepLabel} · 清理当前页缓存失败，已暂停等待修改`,
            retryMessage: error?.message ? `${state.stepLabel} · ${error.message}，正在重试` : `${state.stepLabel} · 清理当前页缓存失败，正在重试`,
            errorReason: error?.message || '清理当前页缓存失败',
            stepType: 'clear_current_page_cache',
            errorCode: 'CLEAR_CACHE_FAILED'
        });
        if (handled === 'max_reached') {
            throw state.run.makeStepFailureError(`${state.stepLabel} 失败（已重试 ${state.currentAttempt} 次达到上限）`);
        }
        return 'retry';
    }
}

async function executeConditionAutomationStep(state) {
    try {
        const result = await evaluateConditionStep(state.run.tabId, state.step, state.run.context);
        const branch = result.value === true ? 'true' : 'false';
        const variableKey = String(state.step.variable || state.step.id || '').trim();
        if (variableKey) state.run.context[variableKey] = branch;
        await completeAutomationStep(state, `${state.stepLabel} · 判断为 ${branch}${result.detail ? `（${result.detail}）` : ''}`, {
            nextStepName: formatRunFlowNextStepNames(state.runFlowPlan, state.steps, state.index)
        });
        return branch;
    } catch (error) {
        const handled = await state.handleStepFailure({
            error,
            message: error?.message || `${state.stepLabel} · 判断步骤失败，已暂停等待修改`,
            retryMessage: error?.message ? `${state.stepLabel} · ${error.message}，正在重试` : `${state.stepLabel} · 判断步骤失败，正在重试`,
            errorReason: error?.message || `判断步骤失败: ${state.stepName}`,
            stepType: 'condition',
            selector: state.resolvedSelector,
            errorCode: 'CONDITION_FAILED'
        });
        if (handled === 'max_reached') throw state.run.makeStepFailureError(`${state.stepLabel} 失败（判断失败）`);
        return 'retry';
    }
}
