function formatAgentCardExecution(execution) {
    if (!execution || typeof execution !== 'object') return '';
    const seconds = (Number(execution.durationMs || 0) / 1000).toFixed(1);
    const retry = Number(execution.retries || 0) > 0 ? `，重试 ${execution.retries} 次` : '';
    const skipped = Number(execution.skipped || 0) > 0 ? `，跳过 ${execution.skipped} 步` : '';
    return `（${Number(execution.stepsExecuted || 0)}/${Number(execution.stepsTotal || 0)} 步，耗时 ${seconds}s${retry}${skipped}）`;
}

function summarizeAgentCardResult(result) {
    if (result.rules) return '已返回自动化卡片步骤类型与运行规则';
    if (Array.isArray(result.items)) return `共 ${result.items.length} 张自动化卡片`;
    if (result.deleted) return `已删除自动化卡片: ${result.id}`;
    if (result.cardData) return `已获取自动化卡片: ${result.cardName || result.id}`;
    if (result.action === 'write') {
        return `${result.overwritten ? '已覆盖' : '已创建'}自动化卡片: ${result.id}（现共 ${result.cardCount} 张）`;
    }
    if (!result.cardName) return '';
    const execution = formatAgentCardExecution(result.execution);
    if (result.success !== false) return `执行完成: ${result.cardName}${execution}`;
    const reason = String(result.error || result.errorReason || result.message || '未知原因').trim();
    const code = String(result.errorCode || '').trim();
    return `执行失败: ${result.cardName} - ${code ? `[${code}] ` : ''}${reason}${execution}`;
}

function summarizeAgentBrowserResult(tool, result) {
    if (tool === 'browser_tab') return summarizeAgentBrowserTab(result);
    if (tool === 'browser_observe') return summarizeAgentBrowserObserve(result);
    if (tool === 'browser_action') return summarizeAgentBrowserAction(result);
    if (tool === 'browser_wait') return summarizeAgentBrowserWait(result);
    return '';
}

function summarizeAgentBrowserTab(result) {
    return `browser_tab ${result.action || ''} 完成${result.url ? `: ${result.url}` : ''}`;
}

function summarizeAgentBrowserObserve(result) {
    return result.tooMany ? `匹配元素过多（${result.itemCount || 0} 个），已收窄筛选提示`
        : `共 ${Number(result.count || 0)} 个可交互元素、${Number(result.textCount || 0)} 段文本`;
}

function summarizeAgentBrowserAction(result) {
    return result.success === false
        ? `${result.code || 'browser_action'} 未成功: ${result.error || ''}` : 'browser_action 完成';
}

function summarizeAgentBrowserWait(result) {
    return result.success === false ? `等待超时: ${result.error || ''}` : '等待完成';
}

function summarizeAgentResult(tool, result) {
    if (!result || typeof result !== 'object') return `${tool} 执行完成`;
    if (typeof result.summary === 'string' && result.summary.trim()) return result.summary.trim();
    if (tool === 'save_cookies') {
        const count = Number(result.cookieCount || 0);
        return result.saved_to_server && result.file_name
            ? `已抓取 Cookie ${count} 条，已保存到服务器 AI 目录: ${result.file_name}` : `已抓取 Cookie ${count} 条`;
    }
    if (['manage_card', 'write_card', 'get_status', 'run_card'].includes(tool)) {
        return summarizeAgentCardResult(result) || `${tool} 执行完成`;
    }
    return summarizeAgentBrowserResult(tool, result) || `${tool} 执行完成`;
}

async function handleAgentTask(task) {
    const taskId = task && task.taskId;
    if (!taskId) {
        return;
    }

    const cached = agentTaskOutcomes.get(taskId);
    if (cached) {
        if (cached.kind === 'result' || cached.kind === 'error') {
            emitAgentOutcome(taskId, cached);
        }
        return;
    }

    agentTaskOutcomes.set(taskId, { kind: 'running' });
    const tool = task.tool || '';
    if (agentSocket && agentSocket.connected) {
        agentSocket.emit('task:progress', { taskId, progress: 0, message: `执行 ${tool}...` });
    }

    try {
        const result = await runAgentToolCommand(tool, task.args || {}, taskId);
        const success = !(result && result.success === false);
        const payload = {
            taskId,
            userId: task.userId,
            aiConfigId: task.aiConfigId,
            sessionId: task.sessionId,
            tool,
            success,
            result,
            summary: summarizeAgentResult(tool, result)
        };
        const entry = { kind: 'result', payload };
        rememberAgentOutcome(taskId, entry);
        emitAgentOutcome(taskId, entry);
    } catch (error) {
        // 即使工具在卡片 runner 外部抛错，也统一按结构化 result 回传；task:error
        // 只保留为旧协议兼容。这样连接、网络、超时、标签页和参数错误都不会退化成一句兜底文案。
        const result = buildAgentToolFailureResult(error, task);
        const payload = {
            taskId,
            userId: task.userId,
            aiConfigId: task.aiConfigId,
            sessionId: task.sessionId,
            tool,
            success: false,
            result,
            summary: `执行失败: ${tool} - [${result.errorCode}] ${result.error}`
        };
        const entry = { kind: 'result', payload };
        rememberAgentOutcome(taskId, entry);
        emitAgentOutcome(taskId, entry);
    }
}

// ── 生命周期 / 保活 ─────────────────────────────────────────────────────────
async function restoreAndConnectAgent() {
    const settings = await getAgentSettings();
    if (!settings.offlineMode) {
        await agentConnect();
    }
}

function nudgeAgentSocket() {
    if (!agentSocket) {
        void restoreAndConnectAgent();
        return;
    }
    if (!agentSocket.connected && !agentSocket.active) {
        agentSocket.connect();
    }
}

// Offscreen document: MV3 service workers are reclaimed when idle, while an
// offscreen document can stay resident and ping us. Each ping wakes/resets this
// worker and gives nudgeAgentSocket() a chance to repair the local bridge session.
let ensureAgentOffscreenPromise = null;
async function ensureAgentOffscreen() {
    if (ensureAgentOffscreenPromise) {
        return ensureAgentOffscreenPromise;
    }
    ensureAgentOffscreenPromise = (async () => {
        try {
            if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') {
                return;
            }
            if (typeof chrome.offscreen.hasDocument === 'function' && await chrome.offscreen.hasDocument()) {
                return;
            }
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: [chrome.offscreen.Reason.WORKERS],
                justification: '保持 AI 自动化插件后台连接，并定期唤醒 Service Worker 检查 AI-FREE 本机桥接会话。'
            });
        } catch (_error) {
            // createDocument can race with another wake of this service worker;
            // the desired end state is simply "an offscreen document exists".
        }
    })().finally(() => {
        ensureAgentOffscreenPromise = null;
    });
    return ensureAgentOffscreenPromise;
}

try {
    chrome.alarms.create(AGENT_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
} catch (_error) {}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === AGENT_KEEPALIVE_ALARM) {
        void ensureAgentOffscreen();
        nudgeAgentSocket();
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'offscreen:keepalive') {
        nudgeAgentSocket();
        return false;
    }
    return false;
});

chrome.runtime.onInstalled.addListener(() => {
    void ensureAgentOffscreen();
});

chrome.runtime.onStartup.addListener(() => {
    void ensureAgentOffscreen();
    void restoreAndConnectAgent();
});

// 扩展刷新或后台 worker 被回收时尽力通知软件立即移除旧连接；
// 浏览器进程直接退出时仍由主进程的短心跳超时兜底。
chrome.runtime.onSuspend?.addListener(() => {
    if (agentSocket) agentSocket.disconnect();
});

// ── popup 消息接口 ──────────────────────────────────────────────────────────
async function saveAgentPopupSettings(message) {
    const next = await saveAgentSettings({ ...(message.payload || {}) });
    if (agentSocket) agentDisconnect();
    if (!next.offlineMode) void agentConnect();
    return { ok: true, settings: next };
}

async function connectAgentFromPopup() {
    if (agentSocket?.connected) await emitAgentEnrollOn(agentSocket);
    else await agentConnect();
    return { ok: true, ...agentStatePayload() };
}

async function testAgentPopupConnection() {
    const settings = await getAgentSettings();
    try {
        const base = trimUrl(settings.localBridgeUrl);
        const start = Date.now();
        const response = await fetch(`${base}/health`, {
            headers: {
                [APP_BROWSER_TOKEN_HEADER]: getAppBrowserToken(),
                [APP_BROWSER_PID_HEADER]: String(await getAgentBrowserProcessId())
            },
            signal: AbortSignal.timeout(5000)
        });
        const http = { ok: true, status: response.status, ms: Date.now() - start };
        return { ok: true, http };
    } catch (error) {
        return { ok: false, http: { ok: false, error: error?.message || String(error) } };
    }
}

async function dispatchAgentPopupMessage(message) {
    if (message.type === 'agent:get-state') {
        return { ok: true, ...agentStatePayload(), settings: await getAgentSettings() };
    }
    if (message.type === 'agent:save-settings') return saveAgentPopupSettings(message);
    if (message.type === 'agent:connect') return connectAgentFromPopup();
    if (message.type === 'agent:disconnect') {
        agentDisconnect();
        return { ok: true, ...agentStatePayload() };
    }
    if (message.type === 'agent:test-connection') return testAgentPopupConnection();
    return { ok: false, error: `未知指令: ${message.type}` };
}

async function handleAgentPopupMessage(message, sendResponse) {
    try {
        sendResponse(await dispatchAgentPopupMessage(message));
    } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || !message.type.startsWith('agent:')) {
        return false;
    }

    void handleAgentPopupMessage(message, sendResponse);
    return true; // async sendResponse
});

// ── MCP 卡片执行进度转发（使 manage_card run 能及时反馈完整过程，而非仅最终结果）────
function buildAgentProgressPayload(message) {
    const progress = Number.isFinite(Number(message.progress))
        ? Math.max(0, Math.min(100, Number(message.progress))) : 0;
    return {
        taskId: activeMcpCardTask.taskId,
        progress,
        message: message.message || `卡片执行进度 ${progress}%`,
        phase: message.phase || '',
        stepIndex: message.stepIndex,
        stepTotal: message.stepTotal,
        stepName: message.stepName,
        kind: message.kind || '',
        retrying: !!message.retrying,
        cardName: message.cardName || '',
        mode: message.mode,
        errorReason: message.errorReason || message.error || '',
        errorCode: message.errorCode || '',
        previousStepName: message.previousStepName || '',
        nextStepName: message.nextStepName || ''
    };
}

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (!message || message.type !== 'card-run-progress' || !activeMcpCardTask || !agentSocket || !agentSocket.connected) {
        return false;
    }
    try {
        agentSocket.emit('task:progress', buildAgentProgressPayload(message));
    } catch (_e) {}
    return false;
});
