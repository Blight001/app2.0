'use strict';

function createStandaloneRunResult(run) {
    return {
        success: false,
        cardName: run.currentCardName,
        account: run.context.account,
        password: run.context.password,
        email: run.context.email,
        codeTime: '',
        code_time: '',
        points: Number(run.cardData.points || 0) || 0,
        cookiesSaved: false
    };
}

async function prepareStandaloneRun(run) {
    if (run.providedCardData && run.currentCardName) {
        await saveCardCacheState(run.cardData).catch(() => {});
    }
    await chrome.storage.local.set({ [STANDALONE_LAST_CARD_KEY]: run.currentCardName }).catch(() => {});
    await run.emitProgress({
        message: `开始本地执行: ${run.currentCardName || '未命名卡片'}`,
        progress: 5,
        phase: 'start'
    });
    const overrideCount = Object.keys(run.runInputs).length;
    await run.emitProgress({
        message: overrideCount > 0 ? `执行变量已就绪（${overrideCount} 个覆盖值）` : '执行变量已就绪（使用步骤默认文本）',
        progress: 18,
        phase: 'inputs_ready'
    });
}

async function persistStoppedRun(run) {
    const previous = await loadStandaloneProgressState().catch(() => null);
    const progress = Number.isFinite(Number(previous?.progress)) ? Number(previous.progress) : 0;
    await saveStandaloneProgressState({
        ...(previous && typeof previous === 'object' ? previous : {}),
        tabId: run.tabId,
        cardName: run.currentCardName,
        message: '已停止执行',
        phase: 'stopped',
        mode: '',
        kind: '',
        errorReason: '',
        progress,
        running: false,
        stopped: true,
        visible: true
    }).catch(() => {});
}

async function persistFailedRun(run, error) {
    const previous = await loadStandaloneProgressState().catch(() => null);
    const progress = Number.isFinite(Number(previous?.progress)) ? Number(previous.progress) : 0;
    const message = run.lastDetailedError || error?.message || '卡片执行失败';
    await saveStandaloneProgressState({
        ...(previous && typeof previous === 'object' ? previous : {}),
        tabId: run.tabId,
        cardName: run.currentCardName,
        message,
        phase: 'failed',
        mode: '',
        kind: 'error',
        errorReason: message,
        progress,
        running: false,
        visible: true
    }).catch(() => {});
    await run.emitProgress({ message, progress, phase: 'failed', kind: 'error', errorReason: message, running: false }).catch(() => {});
}

function attachRunFailureDetails(run, error) {
    if (!error.failure && run.lastFailureDetails) error.failure = run.lastFailureDetails;
    if (error.failure && !error.failure.context) {
        error.failure.context = {
            account: String(run.context.account || ''),
            password: String(run.context.password || ''),
            email: String(run.context.email || ''),
            code: String(run.context.code || '')
        };
    }
    error.execution = run.buildExecutionSummary();
}

async function runStandaloneCard(payload = {}) {
    let run = null;
    try {
        await requireBrowserScriptCompatibility('自动化卡片执行');
        run = await createStandaloneRunContext(payload);
        await prepareStandaloneRun(run);
        const result = await executeStandaloneRunSteps(run, createStandaloneRunResult(run));
        result.success = true;
        await run.emitProgress({
            message: `本地执行完成: ${run.currentCardName || '未命名卡片'}`,
            progress: 100,
            phase: 'finished'
        });
        result.execution = run.buildExecutionSummary();
        return result;
    } catch (error) {
        if (!run) throw error;
        if (isTabStopped(run.tabId) || isStopError(error)) {
            await persistStoppedRun(run).catch(() => {});
            return { success: false, stopped: true, cardName: run.currentCardName, execution: run.buildExecutionSummary() };
        }
        await persistFailedRun(run, error).catch(() => {});
        try { attachRunFailureDetails(run, error); } catch (_detailError) {}
        throw error;
    } finally {
        if (run) {
            stoppedTabs.delete(run.tabId);
            standaloneSessions.delete(run.tabId);
        }
    }
}
