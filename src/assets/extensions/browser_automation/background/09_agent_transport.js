async function sendTrustedSoftwareBridgeRequest(baseUrl, path, options, label) {
    const headers = { ...(options.headers || {}) };
    const appBrowserToken = getAppBrowserToken();
    if (!appBrowserToken) throw new Error('当前扩展不在 AI-FREE 受信浏览器环境中');
    headers[APP_BROWSER_TOKEN_HEADER] = appBrowserToken;
    headers[APP_BROWSER_PID_HEADER] = String(await getAgentBrowserProcessId());
    if (options.body != null) headers['Content-Type'] = 'application/json';
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(5000)
        : undefined;
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers, signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.message || `${label} HTTP ${response.status}`);
    }
    return data;
}

async function requestTrustedSoftwareBridge(path, options = {}, label = '软件桥接') {
    const settings = await getAgentSettings();
    const baseUrl = trimUrl(settings.localBridgeUrl || AGENT_SETTINGS_DEFAULT.localBridgeUrl);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return await sendTrustedSoftwareBridgeRequest(baseUrl, path, options, label);
        } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
        }
    }
    throw lastError || new Error(`${label}连接失败`);
}

async function requestSoftwareCardCache(path, options = {}) {
    return requestTrustedSoftwareBridge(path, options, '软件卡片库');
}

async function requestSoftwareRuntimeInput(input) {
    return requestTrustedSoftwareBridge('/v1/runtime-input', {
        method: 'POST',
        body: JSON.stringify({ input })
    }, 'Chromium Runtime 输入通道');
}

async function requestSoftwareRuntimeFileSelection(selection) {
    return requestTrustedSoftwareBridge('/v1/runtime-file-selection', {
        method: 'POST',
        body: JSON.stringify(selection)
    }, 'Chromium Runtime 文件选择通道');
}

async function readSoftwareCardCache() {
    return requestSoftwareCardCache('/v1/card-cache');
}

async function writeSoftwareCardCache(state = {}) {
    return requestSoftwareCardCache('/v1/card-cache', {
        method: 'PUT',
        body: JSON.stringify({ state })
    });
}

async function agentConnect() {
    if (agentSocket && agentSocket.connected) {
        return;
    }
    if (agentConnectPromise) {
        return agentConnectPromise;
    }
    agentConnectPromise = agentDoConnect().finally(() => {
        agentConnectPromise = null;
    });
    return agentConnectPromise;
}

async function agentDoConnect() {
    const settings = await getAgentSettings();
    if (agentSocket && agentSocket.connected) {
        return;
    }
    if (settings.offlineMode) {
        return;
    }
    if (!getAppBrowserToken()) {
        setAgentStatus('error', '仅允许在 AI-FREE 软件内置浏览器中连接 MCP');
        return;
    }

    let bridgeUrl = String(settings.localBridgeUrl || 'http://127.0.0.1:18765').trim();
    try {
        bridgeUrl = new URL(bridgeUrl).href.replace(/\/$/, '');
    } catch (_error) {
        setAgentStatus('error', '本机桥接地址格式无效');
        return;
    }

    if (agentSocket) {
        agentSocket.removeAllListeners();
        agentSocket.disconnect();
        agentSocket = null;
    }

    setAgentStatus('connecting');

    agentSocket = new LocalAutomationBridgeSocket(bridgeUrl);
    attachAgentListeners(agentSocket);
    await agentSocket.connect();
}

function attachAgentListeners(socket) {
    socket.on('connect', async () => {
        setAgentStatus('connected');
        await agentEnroll();
        flushUnsentAgentOutcomes();
    });

    socket.on('disconnect', (reason) => {
        setAgentStatus('disconnected', reason);
        setTimeout(() => {
            if (agentSocket && !agentSocket.connected && !agentSocket.active) void agentSocket.connect();
        }, 2000);
    });

    socket.on('connect_error', (err) => {
        setAgentStatus('error', err && err.message ? err.message : '连接失败');
        setTimeout(() => {
            if (agentSocket && !agentSocket.connected && !agentSocket.active) void agentSocket.connect();
        }, 2000);
    });

    socket.on(DEVICE_ENROLLED, (data) => {
        agentBoundAiConfigId = parseAiConfigId(data && data.aiConfigId);
        setAgentStatus('enrolled');
    });

    socket.on('device:list', (rows) => {
        if (!agentCurrentId || !Array.isArray(rows)) {
            return;
        }
        const mine = rows.find((row) => String((row && row.id) || '') === agentCurrentId);
        if (!mine) {
            return;
        }
        const next = parseAiConfigId(mine.aiConfigId != null ? mine.aiConfigId : mine.ai_config_id);
        if (next !== agentBoundAiConfigId) {
            agentBoundAiConfigId = next;
            broadcastAgentStatus();
        }
    });

    socket.on('task:dispatch', (task) => { void handleAgentTask(task); });
}

function agentDisconnect() {
    if (agentSocket) {
        agentSocket.disconnect();
        agentSocket = null;
    }
    setAgentStatus('disconnected');
}

// ── 任务结果缓存与回传 ──────────────────────────────────────────────────────
function rememberAgentOutcome(taskId, outcome) {
    agentTaskOutcomes.delete(taskId);
    agentTaskOutcomes.set(taskId, outcome);
    for (const key of agentTaskOutcomes.keys()) {
        if (agentTaskOutcomes.size <= MAX_AGENT_TASK_OUTCOMES) {
            break;
        }
        if (agentTaskOutcomes.get(key) && agentTaskOutcomes.get(key).kind === 'running') {
            continue;
        }
        agentTaskOutcomes.delete(key);
    }
}

function emitAgentOutcome(taskId, outcome) {
    if (!agentSocket || !agentSocket.connected) {
        outcome.unsent = true;
        return;
    }
    if (outcome.kind === 'result') {
        agentSocket.emit('task:result', outcome.payload);
    } else if (outcome.kind === 'error') {
        agentSocket.emit('task:error', { taskId, userId: outcome.userId, error: outcome.error });
    }
    outcome.unsent = false;
}

function flushUnsentAgentOutcomes() {
    if (!agentSocket || !agentSocket.connected) {
        return;
    }
    for (const [taskId, outcome] of agentTaskOutcomes) {
        if (outcome && outcome.unsent) {
            emitAgentOutcome(taskId, outcome);
        }
    }
}

// ── 工具命令执行（task.tool → 自动化卡片 / Cookie 抓取实现）────────────────────
// taskId is threaded only for the long-running 'run' action so that activeMcpCardTask
// can be populated; this enables the card-run-progress listener to forward live
// step progress back as task:progress to the agent/MCP caller.
function normalizeAgentCardAction(tool, payload) {
    let action = String(payload.action || '').trim().toLowerCase();
    if (!action) action = resolveLegacyAgentCardAction(tool, payload);
    const aliases = {
        get_rules: 'rules', status: 'list', create: 'write', overwrite: 'write', execute: 'run',
        update_step: 'patch_step', replace_step: 'patch_step', append_step: 'insert_step', add_step: 'insert_step',
        remove_step: 'delete_step', reorder_step: 'move_step', remove: 'delete', delete_card: 'delete', remove_card: 'delete'
    };
    return { action: aliases[action] || action, rawAction: action };
}

function resolveLegacyAgentCardAction(tool, payload) {
    if (tool === 'get_status') return 'list';
    if (tool === 'run_card') return 'run';
    if (tool === 'write_card' && payload.cardData) return 'write';
    return '';
}

function buildAgentCardRules() {
    return {
        rules: CARD_FORMAT_RULES,
        stepTypes: [...CARD_STEP_TYPES],
        byValues: [...CARD_STEP_BY_VALUES],
        conditionModes: ['selector_exists', 'selector_missing', 'text_exists', 'text_missing', 'url_matches', 'js'],
        flowEdgeLabels: ['next', 'true', 'false', 'default'],
        actions: [...CARD_MANAGE_ACTIONS],
        stepEditActions: [...CARD_STEP_EDIT_ACTIONS]
    };
}

async function listAgentCards() {
    const state = await loadCardCacheState();
    return {
        items: state.items.map((item) => ({
            id: item.id,
            cardName: item.cardName,
            stepCount: Array.isArray(item.cardData && item.cardData.steps) ? item.cardData.steps.length : 0,
            savedAt: item.savedAt,
            selected: item.id === state.selectedId
        })),
        selectedId: state.selectedId
    };
}

async function getAgentCard(payload) {
    const state = await loadCardCacheState();
    const targetId = String(payload.id || '').trim() || state.selectedId;
    const entry = state.items.find((item) => item.id === targetId);
    if (!entry) throw new Error(targetId ? `未找到自动化卡片: ${targetId}` : '当前没有已保存的自动化卡片');
    return {
        id: entry.id, cardName: entry.cardName, savedAt: entry.savedAt,
        selected: entry.id === state.selectedId, cardData: entry.cardData
    };
}

async function deleteAgentCard(payload) {
    const target = getPayloadValue(payload, ['id', 'card_id', 'cardId', 'card_name', 'cardName', 'name']);
    return deleteCardCacheEntry(String(target || '').trim());
}

async function writeAgentCard(payload) {
    validateCardDataForWrite(payload.cardData);
    const targetId = String(payload.id || '').trim()
        || String(payload.cardData?.name || '').trim() || `automation_${Date.now()}`;
    const state = await loadCardCacheState().catch(() => ({ items: [], selectedId: '' }));
    const overwritten = state.items.some((item) => item.id === targetId);
    const saved = await saveCardCacheState(payload.cardData, targetId);
    return { action: 'write', id: saved.selectedId, overwritten, cardCount: saved.items.length };
}

async function resolveAgentRunErrorMessage(runError) {
    let detailedError = runError?.message || String(runError || '卡片执行失败');
    let stepInfo = '';
    try {
        const progress = await loadStandaloneProgressState().catch(() => null);
        if (progress && typeof progress === 'object') {
            const progressError = String(progress.errorReason || progress.message || '').trim();
            if (progressError) detailedError = progressError;
            const stepIndex = progress.stepIndex != null ? progress.stepIndex : '';
            const stepName = String(progress.stepName || '').trim();
            if (stepName || stepIndex) stepInfo = `[步骤 ${stepIndex}${stepName ? ` ${stepName}` : ''}] `;
        }
    } catch (_) {}
    return stepInfo + detailedError;
}

async function loadAgentRunFailureExtra() {
    try {
        const progress = await loadStandaloneProgressState().catch(() => null);
        if (!progress) return {};
        return {
            stepIndex: progress.stepIndex,
            stepTotal: progress.stepTotal,
            stepName: progress.stepName,
            phase: progress.phase,
            progress: progress.progress,
            ...(progress.errorCode ? { errorCode: progress.errorCode } : {})
        };
    } catch (_) {
        return {};
    }
}

function resolveAgentRunFailure(runError) {
    return runError && typeof runError === 'object'
        && runError.failure && typeof runError.failure === 'object' ? runError.failure : null;
}

function buildAgentRunDiagnostics(errorCode, extra, failure) {
    const snapshot = failure?.failureSnapshot || null;
    return {
        category: errorCode,
        phase: String(extra.phase || (failure ? 'step_failed' : 'run_failed')),
        step: failure ? {
            index: failure.stepIndex, total: failure.stepTotal, name: failure.stepName,
            type: failure.stepType, selector: failure.selector, attempts: failure.attempts
        } : null,
        page: snapshot ? {
            url: snapshot.url || '', title: snapshot.title || '',
            candidates: Array.isArray(snapshot.candidates) ? snapshot.candidates : []
        } : null
    };
}

function buildAgentRunFailureFields(failure) {
    if (!failure) return {};
    return {
        stepIndex: failure.stepIndex,
        stepTotal: failure.stepTotal,
        stepName: failure.stepName,
        stepType: failure.stepType,
        selector: failure.selector,
        attempts: failure.attempts,
        failureSnapshot: failure.failureSnapshot || null,
        context: failure.context || null,
        resumeHint: `页面已停在失败现场。修复卡片（action=write）后可用 action=run + start_step=${failure.stepIndex} 从失败步骤继续，并把本结果 context 里已用到的变量值（如 account/password/email/code 或自定义变量键）通过 inputs 原样回传，避免丢失验证码等运行期取值。`
    };
}

function buildAgentRunFailureResult(runError, entry, payload, finalError, extra) {
    const failure = resolveAgentRunFailure(runError);
    const errorCode = String(failure?.errorCode || runError?.errorCode || extra.errorCode
        || inferAgentToolErrorCode(runError, finalError));
    return {
        success: false,
        cardName: entry?.cardName || '',
        error: finalError,
        errorReason: finalError,
        errorCode,
        account: payload.account || '',
        password: payload.password || '',
        email: payload.email || '',
        cookiesSaved: false,
        stopped: false,
        ...extra,
        ...(runError?.execution ? { execution: runError.execution } : {}),
        diagnostics: buildAgentRunDiagnostics(errorCode, extra, failure),
        ...buildAgentRunFailureFields(failure)
    };
}

function buildAgentStandaloneRunPayload(payload, entry) {
    return {
        cardData: entry?.cardData,
        inputs: payload.inputs || payload.variables || {},
        account: payload.account || '',
        password: payload.password || '',
        email: payload.email || '',
        code: payload.code || '',
        start_step: Number(payload.start_step || payload.startStep || 0) || 0,
        tab_id: Number(payload.tab_id ?? payload.tabId ?? 0) || 0,
        isLooping: false
    };
}

async function runAgentCard(payload, taskId) {
    const state = await loadCardCacheState();
    const targetId = String(payload.id || '').trim();
    const entry = targetId ? state.items.find((item) => item.id === targetId) : null;
    if (targetId && !entry) throw new Error(`未找到自动化卡片: ${targetId}`);
    activeMcpCardTask = taskId ? { taskId } : null;
    try {
        if (Number(payload.tab_id ?? payload.tabId ?? 0) > 0) await resolveAutomationTargetTab(payload);
        if (taskId && agentSocket?.connected) {
            agentSocket.emit('task:progress', { taskId, progress: 3, message: '开始执行自动化卡片（MCP）' });
        }
        return await runStandaloneCard(buildAgentStandaloneRunPayload(payload, entry));
    } catch (runError) {
        const finalError = await resolveAgentRunErrorMessage(runError);
        const extra = await loadAgentRunFailureExtra();
        return buildAgentRunFailureResult(runError, entry, payload, finalError, extra);
    } finally {
        activeMcpCardTask = null;
    }
}

async function captureAgentCookies(payload) {
    const saveToServer = Boolean(payload.saveToServer || payload.save_to_server);
    const raw = await captureCurrentTab(buildCaptureAgentCookieRequest(payload, saveToServer));
    const result = buildCapturedCookieSummary(raw);
    if (saveToServer && raw) appendCapturedCookieData(result, raw);
    return result;
}

function buildCaptureAgentCookieRequest(payload, saveToServer) {
    return {
        tab_id: payload.tab_id ?? payload.tabId ?? 0,
        account: payload.account || '',
        password: payload.password || '',
        serverUrl: payload.serverUrl || payload.server_url || '',
        cardKey: payload.cardKey || payload.card_key || '',
        saveToServer
    };
}

function buildCapturedCookieSummary(raw) {
    return {
        success: raw && raw.success !== false,
        fileName: raw && raw.fileName,
        cookieCount: raw && raw.cookieCount,
        browserStorageCount: raw && raw.browserStorageCount,
        pageUrl: raw && raw.pageUrl,
        upload: raw && raw.upload
    };
}

function appendCapturedCookieData(result, raw) {
    if (raw.cookies) result.cookies = raw.cookies;
    if (raw.browserStorage) result.browserStorage = raw.browserStorage;
    if (raw.data) result.data = raw.data;
    result.save_to_server = true;
}

async function runAgentCardManagement(tool, payload, taskId) {
    const { action, rawAction } = normalizeAgentCardAction(tool, payload);
    if (action === 'rules') return buildAgentCardRules();
    if (action === 'list') return listAgentCards();
    if (action === 'get') return getAgentCard(payload);
    if (action === 'delete') return deleteAgentCard(payload);
    if (action === 'write') return writeAgentCard(payload);
    if (CARD_STEP_EDIT_ACTIONS.includes(action)) return editCardStep(payload, action, rawAction);
    if (action === 'run') return runAgentCard(payload, taskId);
    throw new Error(`未知的 manage_card action: ${rawAction || '(空)'}（可选 ${CARD_MANAGE_ACTIONS.join('/')}）`);
}

async function runAgentToolCommand(tool, args, taskId = null) {
    const payload = args && typeof args === 'object' ? args : {};
    switch (tool) {
        case 'manage_card':
        case 'write_card':   // 旧名兼容（服务器可能仍缓存旧 toolDefs）
        case 'get_status':   // 旧名兼容 → action=list
        case 'run_card':
            return runAgentCardManagement(tool, payload, taskId);
        case 'save_cookies':
        case 'capture_cookies':
            return captureAgentCookies(payload);
        case 'browser_tab':
            return await toolBrowserTab(payload);
        case 'browser_observe':
            return await toolBrowserObserve(payload);
        case 'browser_action':
            return await toolBrowserAction(payload);
        case 'browser_wait':
            return await toolBrowserWait(payload);
        default:
            throw new Error(`未知工具: ${tool || '(空)'}`);
    }
}
