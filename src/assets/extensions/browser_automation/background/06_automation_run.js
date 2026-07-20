// 构建详细的失败原因（用于进度、最终错误、MCP 返回）
function firstAutomationRunValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

function automationRunText(...values) {
    const value = firstAutomationRunValue(...values);
    return value === undefined ? '' : String(value).trim();
}

function automationRunNumber(fallback, ...values) {
    const parsed = Number(firstAutomationRunValue(...values));
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : fallback;
}

function buildDetailedFailureReason(options = {}) {
    const stepIndex = automationRunNumber(0, options.stepIndex);
    const stepName = automationRunText(options.stepName);
    const stepType = automationRunText(options.stepType);
    const reason = automationRunText(options.reason);
    const attempt = automationRunNumber(1, options.attempt);
    const maxAttempts = automationRunNumber(1, options.maxAttempts);
    const selector = automationRunText(options.selector);
    const extra = automationRunText(options.extra);
    const parts = [];
    if (stepIndex > 0) parts.push(`步骤 ${stepIndex}`);
    if (stepName) parts.push(`「${stepName}」`);
    if (stepType) parts.push(`(${stepType})`);
    let head = parts.join(' ');
    if (selector) {
        const shortSel = selector.slice(0, 100);
        head += ` selector=${shortSel}${selector.length > 100 ? '...' : ''}`;
    }
    if (attempt > 1) {
        head += ` [尝试 ${attempt}/${maxAttempts}]`;
    }
    let msg = reason || '执行失败';
    if (extra) msg += ` ${extra}`;
    return head ? `${head} 失败: ${msg}` : msg;
}

function resolveFailureSnapshotKeyword(selector, stepName) {
    const textMatch = String(selector || '').trim().match(/^text[=:](.+)$/i);
    if (textMatch) return textMatch[1].trim();
    const name = String(stepName || '').trim();
    return name && !/^步骤\d+$/.test(name)
        ? name.replace(/^(点击|输入|等待)\s*/, '').slice(0, 20)
        : '';
}

function normalizeFailureCandidates(items) {
    return items
        .filter((item) => item && item.kind === 'interactive')
        .slice(0, 15)
        .map((item) => {
            const candidate = {
                tag: item.tag,
                selector: item.selector,
                text: item.text,
                name: item.name,
                placeholder: item.placeholder,
                ariaLabel: item.ariaLabel
            };
            if (item.inFrame === true) candidate.inFrame = true;
            return candidate;
        });
}

async function scanFailureCandidates(tabId, selector, stepName) {
    const keyword = resolveFailureSnapshotKeyword(selector, stepName);
    const scanArgs = { include_text: false, limit: 20, max_items: 20, allow_truncate: true, mark: false };
    let scan = keyword
        ? await callObserveMethod(tabId, 'scan', [{ ...scanArgs, keyword }]).catch(() => null)
        : null;
    if (!scan || !Array.isArray(scan.items) || scan.items.length === 0) {
        scan = await callObserveMethod(tabId, 'scan', [scanArgs]).catch(() => null);
    }
    return scan && Array.isArray(scan.items) ? normalizeFailureCandidates(scan.items) : [];
}

// 失败现场快照：步骤最终失败时抓当前页 URL/标题 + 近似候选元素（复用 content/observe.js 的 scan），
// 随失败结果返回给 AI —— AI 无需再补一轮 browser_observe 即可定位替代 selector。
// 依赖 10_browser_tools.js 的 callObserveMethod（importScripts 全部加载后全局可见）。
async function captureCardFailureSnapshot(tabId, { selector = '', stepName = '' } = {}) {
    const snapshot = { url: '', title: '', candidates: [] };
    try {
        const tab = await chrome.tabs.get(tabId);
        snapshot.url = String(tab && tab.url || '');
        snapshot.title = String(tab && tab.title || '');
    } catch (_error) {}
    try {
        snapshot.candidates = await scanFailureCandidates(tabId, selector, stepName);
    } catch (_error) {}
    return snapshot;
}

// 非重试模式下步骤失败时上报「已暂停等待修改」进度（run 模式默认走重试，不会触及；保留以兼容 debug 暂停分支）。
async function pauseAtStep(options = {}, emitProgress = async () => {}) {
    const normalizedTabId = automationRunNumber(0, options.tabId);
    if (!normalizedTabId) {
        return;
    }

    await emitProgress({
        message: options.stepName
            ? `${automationRunText(options.message, '步骤执行失败，已暂停等待修改')}: ${options.stepName}`
            : automationRunText(options.message, '步骤执行失败，已暂停等待修改'),
        progress: options.progress,
        kind: 'error',
        mode: 'debug',
        phase: automationRunText(options.phase, 'step_failed_pause'),
        stepIndex: automationRunNumber(0, options.stepIndex),
        stepTotal: automationRunNumber(0, options.stepTotal),
        stepName: automationRunText(options.stepName),
        previousStepName: automationRunText(options.previousStepName),
        nextStepName: automationRunText(options.nextStepName),
        errorReason: automationRunText(options.errorReason),
        running: true
    });
}

function getRunStepId(step = {}, index = 0) {
    return automationRunText(step.id, step.step_id, step.nodeId, `step_${index + 1}`);
}

function normalizeRunFlowEdge(edge, stepIdToIndex) {
    const source = edge && typeof edge === 'object' ? edge : {};
    const from = automationRunText(source.from, source.source, source.fromId);
    const to = automationRunText(source.to, source.target, source.toId);
    const label = automationRunText(source.label, source.branch, source.condition, 'next').toLowerCase();
    const invalidEndpoint = !from || !to || from === to;
    if (invalidEndpoint || !stepIdToIndex.has(from) || !stepIdToIndex.has(to)) return null;
    return { from, to, label };
}

function groupRunFlowEdges(edges) {
    const grouped = new Map();
    for (const edge of edges) {
        if (!grouped.has(edge.from)) grouped.set(edge.from, []);
        grouped.get(edge.from).push(edge);
    }
    return grouped;
}

function buildRunFlowPlan(cardData = {}) {
    const steps = Array.isArray(cardData.steps) ? cardData.steps : [];
    const stepIds = steps.map((step, index) => getRunStepId(step, index)).filter(Boolean);
    const stepIdToIndex = new Map(stepIds.map((id, index) => [id, index]));
    const flow = cardData.flow && typeof cardData.flow === 'object' && !Array.isArray(cardData.flow)
        ? cardData.flow
        : null;
    const rawEdges = flow && Array.isArray(flow.edges) ? flow.edges : [];
    const edges = rawEdges.map((edge) => normalizeRunFlowEdge(edge, stepIdToIndex)).filter(Boolean);
    const edgesByFrom = groupRunFlowEdges(edges);
    const startId = String(flow && (flow.start || flow.start_node_id || flow.startNodeId) || '').trim();
    return {
        enabled: !!flow && (edges.length > 0 || !!startId),
        startIndex: stepIdToIndex.has(startId) ? stepIdToIndex.get(startId) : 0,
        stepIdToIndex,
        edgesByFrom
    };
}

function runFlowOutcomePreferences(outcome) {
    if (outcome === 'true') return ['true', 'yes', 'success', 'match', 'next', 'default', ''];
    if (outcome === 'false') return ['false', 'no', 'else', 'fail', 'failure', 'default', 'next', ''];
    return ['next', 'success', 'default', 'true', ''];
}

function selectRunFlowEdge(outgoing, outcome) {
    for (const label of runFlowOutcomePreferences(outcome)) {
        const edge = outgoing.find((item) => automationRunText(item.label).toLowerCase() === label);
        if (edge) return edge;
    }
    return outgoing[0] || null;
}

function resolveCardEntryNavigation(cardData = {}, context = {}) {
    const steps = Array.isArray(cardData.steps) ? cardData.steps : [];
    const flowPlan = buildRunFlowPlan(cardData);
    const firstStepId = getRunStepId(steps[0] || {}, 0);
    const startIndex = flowPlan.enabled === true && firstStepId !== '__auto_navigate_start'
        ? flowPlan.startIndex
        : 0;
    const startStep = steps[startIndex] && typeof steps[startIndex] === 'object' ? steps[startIndex] : {};
    const startStepUrl = automationRunText(startStep.type).toLowerCase() === 'navigate'
        ? startStep.url
        : '';
    const resolvedUrl = normalizeTargetUrl(resolveTemplate(
        firstAutomationRunValue(startStepUrl, cardData.website, ''),
        context
    ));

    return {
        url: /^https?:\/\//i.test(automationRunText(resolvedUrl)) ? resolvedUrl : '',
        timeoutMs: Math.max(1000, automationRunNumber(15000, startStep.timeout))
    };
}

function resolveRunFlowNextIndex(plan, steps = [], currentIndex = 0, outcome = 'next') {
    const fallback = currentIndex + 1;
    if (!plan || plan.enabled !== true) {
        return fallback;
    }
    const currentStep = steps[currentIndex] || {};
    const currentId = getRunStepId(currentStep, currentIndex);
    if (currentId === '__auto_navigate_start' && Number.isInteger(plan.startIndex)) {
        return plan.startIndex;
    }
    const outgoing = plan.edgesByFrom.get(currentId) || [];
    if (outgoing.length === 0) {
        return steps.length;
    }
    const normalizedOutcome = automationRunText(outcome, 'next').toLowerCase();
    const selected = selectRunFlowEdge(outgoing, normalizedOutcome);
    if (!selected || !plan.stepIdToIndex.has(selected.to)) {
        return steps.length;
    }
    return plan.stepIdToIndex.get(selected.to);
}

function formatRunFlowNextStepNames(plan, steps = [], currentIndex = 0) {
    if (!plan || plan.enabled !== true) {
        const next = steps[currentIndex + 1];
        return next ? String(next.name || `步骤${currentIndex + 2}`).trim() : '';
    }
    const currentId = getRunStepId(steps[currentIndex] || {}, currentIndex);
    const outgoing = plan.edgesByFrom.get(currentId) || [];
    if (outgoing.length === 0) {
        return '';
    }
    return outgoing.slice(0, 3).map((edge) => {
        const targetIndex = plan.stepIdToIndex.get(edge.to);
        const target = steps[targetIndex] || {};
        const targetName = String(target.name || `步骤${Number(targetIndex || 0) + 1}`).trim();
        const label = String(edge.label || 'next').trim();
        return label && label !== 'next' ? `${label}→${targetName}` : targetName;
    }).join(' / ');
}

function resolveConditionInput(step, context) {
    return {
        mode: String(step.condition_mode || step.condition || step.mode || 'selector_exists').trim().toLowerCase(),
        selector: resolveTemplate(step.selector || step.condition_selector || '', context),
        text: resolveTemplate(step.text || step.wait_for_text || step.condition_text || '', context),
        timeoutMs: Math.max(0, Number(step.timeout || 0) || 0),
        intervalMs: Math.max(50, Number(step.poll_interval_ms || 100) || 100)
    };
}

async function evaluateUrlCondition(tabId, input, step) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = String(tab && tab.url || '');
    const pattern = String(input.text || input.selector || step.url || '').trim();
    const matched = Boolean(pattern) && url.includes(pattern);
    return {
        value: matched,
        detail: pattern ? `URL ${matched ? '包含' : '不包含'} ${pattern}` : '缺少 URL 匹配文本'
    };
}

async function evaluateJsCondition(tabId, step, context) {
    const code = String(resolveTemplate(step.expression || step.script || '', context) || '').trim();
    if (!code) return { value: false, detail: 'JS 表达式为空' };
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [code, context],
        func: async (rawCode, rawContext) => {
            try {
                const body = /\breturn\b|;/.test(rawCode) ? rawCode : `return (${rawCode});`;
                const fn = new Function('context', `with (context || {}) { return (async () => { ${body} })(); }`);
                return { success: true, value: Boolean(await fn(rawContext || {})) };
            } catch (error) {
                return { success: false, error: error && error.message ? error.message : String(error) };
            }
        }
    });
    const result = Array.isArray(results) && results[0] ? results[0].result : null;
    if (!result || result.success !== true) {
        throw new Error(result && result.error || '判断 JS 执行失败');
    }
    return { value: result.value === true, detail: `JS=${result.value === true ? 'true' : 'false'}` };
}

async function evaluateWaitCondition(tabId, input, targetType, missing) {
    const action = {
        type: 'wait',
        timeoutMs: input.timeoutMs,
        intervalMs: input.intervalMs
    };
    const target = targetType === '文本' ? input.text : input.selector;
    if (targetType === '文本') action.waitForText = target;
    else action.selector = target;
    const result = await executePageAction(tabId, action);
    const exists = Boolean(result && result.success === true);
    const value = missing ? !exists : exists;
    const state = value ? (missing ? '不存在' : '存在') : (missing ? '存在' : '不存在');
    return { value, detail: `${targetType} ${target || '(空)'} ${state}` };
}

function isConditionMode(mode, values) {
    return values.includes(mode);
}

async function evaluateConditionStep(tabId, step = {}, context = {}) {
    const input = resolveConditionInput(step, context);
    if (isConditionMode(input.mode, ['url_matches', 'url_match'])) {
        return evaluateUrlCondition(tabId, input, step);
    }
    if (isConditionMode(input.mode, ['js', 'script', 'expression'])) {
        return evaluateJsCondition(tabId, step, context);
    }
    if (isConditionMode(input.mode, ['text_exists', 'text_visible'])) {
        return evaluateWaitCondition(tabId, input, '文本', false);
    }
    if (isConditionMode(input.mode, ['text_missing', 'text_not_exists'])) {
        return evaluateWaitCondition(tabId, input, '文本', true);
    }
    const missing = isConditionMode(input.mode, ['selector_missing', 'element_missing', 'not_exists']);
    return evaluateWaitCondition(tabId, input, '元素', missing);
}
