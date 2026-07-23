'use strict';

const { text } = require('./native-card-data');

function abortError() {
  const error = /** @type {Error & {code?: string}} */ (new Error('自动化运行已停止'));
  error.name = 'AbortError';
  error.code = 'CARD_RUN_STOPPED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function delay(ms, signal) {
  throwIfAborted(signal);
  return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  }));
}

function resultBody(response) {
  return response?.result && typeof response.result === 'object' ? response.result : (response || {});
}

async function emitProgress(args, event) {
  if (typeof args.onProgress !== 'function') return;
  try { await args.onProgress(event); } catch (_) {}
}

function resolveTemplate(value, context) {
  return String(value == null ? '' : value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key) => (
    String(context[text(key)] ?? '')
  ));
}

function buildContext(card, args) {
  const inputs = args.inputs && typeof args.inputs === 'object' ? args.inputs : {};
  const context = { ...inputs };
  for (const key of ['account', 'password', 'email']) {
    if (args[key] !== undefined) context[key] = args[key];
  }
  let variableIndex = 0;
  for (const step of card.steps) {
    if (step.type !== 'type') continue;
    variableIndex += 1;
    const key = text(step.variable) || `var${variableIndex}`;
    if (context[key] === undefined && step.text !== undefined) context[key] = step.text;
  }
  return context;
}

function buildFlow(card) {
  const indexById = new Map(card.steps.map((step, index) => [step.id, index]));
  const edges = new Map();
  for (const edge of card.flow.edges) {
    const key = `${text(edge.from)}:${text(edge.label) || 'next'}`;
    edges.set(key, indexById.get(text(edge.to)));
  }
  return { edges, indexById };
}

function nextIndex(flow, step, index, branch) {
  const exact = flow.edges.get(`${step.id}:${branch}`);
  if (Number.isInteger(exact)) return exact;
  const fallback = flow.edges.get(`${step.id}:next`);
  return Number.isInteger(fallback) ? fallback : index + 1;
}

async function perform(runtime, profileId, action, input = {}) {
  const response = await runtime.dispatchAutomation(profileId, 'perform-action', { action, ...input });
  return resultBody(response);
}

async function evaluateCondition(runtime, profileId, step, context) {
  const mode = text(step.condition_mode || step.condition || 'selector_exists');
  const selector = resolveTemplate(step.selector || '', context);
  const expected = resolveTemplate(step.text || '', context);
  if (mode === 'selector_exists' || mode === 'selector_missing') {
    let exists = true;
    try {
      await perform(runtime, profileId, 'wait', {
        selector,
        timeout_ms: Math.min(1000, Number(step.timeout) || 500),
      });
    } catch (_) {
      exists = false;
    }
    return mode === 'selector_exists' ? exists : !exists;
  }
  const observed = resultBody(await runtime.dispatchAutomation(profileId, 'observe-page', {
    keyword: expected, mark: false, limit: 200,
  }));
  if (mode === 'url_matches') return String(observed.url || '').includes(expected);
  const found = (observed.items || []).some((item) => (
    String(item.text || item.name || item.value || '').includes(expected)
  ));
  return mode === 'text_missing' ? !found : found;
}

async function executeCreditsStep(runtime, profileId, step, context, result) {
  const observed = resultBody(await runtime.dispatchAutomation(profileId, 'observe-page', {
    keyword: resolveTemplate(step.text || '', context),
    selector: resolveTemplate(step.selector || '', context),
    tag: text(step.tag),
    mark: false,
    limit: 20,
  }));
  const item = (observed.items || [])[Number(step.nth) || 0] || {};
  result.points = text(item.text || item.value || step.default);
  if (step.variable) context[text(step.variable)] = result.points;
  return 'next';
}

async function executeSaveSessionStep(runtime, profileId, result) {
  const session = resultBody(await runtime.sendCommand(profileId, 'get-session-data', {}, { timeoutMs: 30000 }));
  result.savedSession = await runtime.saveSession({
    action: 'save_session',
    directory: 'sessions',
    filename: `${text(result.cardName) || 'automation'}-${Date.now()}`,
    session,
  });
  return 'next';
}

async function executeScreenshotStep(runtime, profileId, step, result) {
  const screenshot = resultBody(await runtime.dispatchAutomation(
    profileId, 'capture-screenshot', { ...step, format: 'png' },
  ));
  result.lastScreenshot = runtime.saveScreenshot
    ? await runtime.saveScreenshot(screenshot.dataUrl, {
      directory: 'automation_screenshots',
      filename: `${text(result.cardName) || 'automation'}-${Date.now()}.png`,
    })
    : screenshot;
  return 'next';
}

async function executeDataStep(runtime, profileId, step, context, result) {
  if (step.type === 'condition') return evaluateCondition(runtime, profileId, step, context);
  if (step.type === 'get_credits') {
    return executeCreditsStep(runtime, profileId, step, context, result);
  }
  if (step.type === 'save_cookies') return executeSaveSessionStep(runtime, profileId, result);
  if (step.type === 'clear_current_page_cache') {
    await runtime.sendCommand(profileId, 'clear-site-data', {}, { timeoutMs: 30000 });
    return 'next';
  }
  if (step.type === 'screenshot') return executeScreenshotStep(runtime, profileId, step, result);
  return null;
}

async function executeWaitStep(runtime, profileId, step, context, signal) {
  const selector = resolveTemplate(step.wait_for_element_hidden || step.selector || '', context);
  const targetText = resolveTemplate(step.wait_for_text_hidden || step.wait_for_text || '', context);
  if (!selector && !targetText) {
    await delay(Math.max(0, Math.min(120000, Number(step.wait_ms || step.ms) || 1000)), signal);
  } else {
    await perform(runtime, profileId, 'wait', {
      selector,
      target_text: targetText,
      hidden: Boolean(step.wait_for_element_hidden || step.wait_for_text_hidden),
      timeout_ms: Number(step.timeout) || 10000,
    });
  }
  return 'next';
}

async function executeInteractionStep(runtime, profileId, step, context) {
  const by = text(step.by || 'css_selector');
  const payload = {
    selector: by === 'text' ? '' : resolveTemplate(step.selector || '', context),
    target_text: by === 'css_selector' ? '' : resolveTemplate(step.selector || '', context),
    ref: text(step.ref),
    nth: Math.max(0, Number(step.nth) || 0),
    timeout_ms: Number(step.timeout) || 10000,
  };
  if (step.type === 'type') {
    const key = text(step.variable);
    payload.text = resolveTemplate(key && context[key] !== undefined ? context[key] : step.text, context);
    payload.clear_first = step.clear_first !== false;
    payload.submit = step.submit === true;
    if (step.click_before_type === true || step.clickBeforeType === true) {
      await perform(runtime, profileId, 'click', {
        selector: payload.selector,
        target_text: payload.target_text,
        nth: payload.nth,
        timeout_ms: payload.timeout_ms,
      });
    }
  }
  await perform(runtime, profileId, step.type, payload);
  if (step.type === 'type' && step.submit === true) {
    await perform(runtime, profileId, 'press_key', { key: 'Enter' });
  }
  return 'next';
}

async function executeStep(runtime, profileId, step, context, result, card, signal) {
  throwIfAborted(signal);
  const dataResult = await executeDataStep(runtime, profileId, step, context, result);
  if (dataResult !== null) return dataResult;
  if (step.type === 'navigate') {
    await runtime.navigate(profileId, resolveTemplate(step.url || card.website, context));
    return 'next';
  }
  if (step.type === 'wait') return executeWaitStep(runtime, profileId, step, context, signal);
  return executeInteractionStep(runtime, profileId, step, context);
}

async function executeWithRetry(runtime, profileId, step, context, result, card, signal) {
  const maximum = Math.max(0, Math.min(10, Number(step.retry_count ?? card.retry_count) || 0));
  let attempt = 0;
  while (true) {
    try {
      return await executeStep(runtime, profileId, step, context, result, card, signal);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (step.optional === true) {
        result.skipped += 1;
        return 'next';
      }
      if (attempt >= maximum) throw error;
      attempt += 1;
      result.retries += 1;
      await delay(Math.max(50, Math.min(30000, Number(step.retry_delay_ms) || 500)), signal);
    }
  }
}

async function runNativeCard(runtime, profileId, card, args = {}) {
  const startedAt = Date.now();
  const context = buildContext(card, args);
  const flow = buildFlow(card);
  const requestedStart = Math.max(1, Number(args.start_step) || 1) - 1;
  let index = Math.min(requestedStart, Math.max(0, card.steps.length - 1));
  const result = {
    success: true,
    cardName: card.name,
    stepsTotal: card.steps.length,
    stepsExecuted: 0,
    retries: 0,
    skipped: 0,
    trace: [],
    context,
  };
  const maximumVisits = Math.max(20, card.steps.length * 20);
  while (index < card.steps.length && result.stepsExecuted < maximumVisits) {
    const outcome = await runCardStep({
      runtime, profileId, card, args, context, result, flow, index, startedAt,
    });
    if (outcome.failure) return outcome.failure;
    index = outcome.next;
  }
  if (result.stepsExecuted >= maximumVisits && index < card.steps.length) {
    return { ...result, success: false, errorCode: 'FLOW_VISIT_LIMIT', error: '流程可能存在无限循环' };
  }
  await emitProgress(args, {
    phase: 'completed',
    stepTotal: card.steps.length,
    stepsExecuted: result.stepsExecuted,
  });
  return { ...result, durationMs: Date.now() - startedAt };
}

async function runCardStep(state) {
  const { runtime, profileId, card, args, context, result, flow, index, startedAt } = state;
  throwIfAborted(args.signal);
  const step = card.steps[index];
  const progress = {
    stepIndex: index + 1,
    stepTotal: card.steps.length,
    stepId: step.id,
    stepName: step.name,
  };
  await emitProgress(args, { phase: 'step_start', ...progress });
  try {
    const branch = await executeWithRetry(
      runtime, profileId, step, context, result, card, args.signal,
    );
    result.stepsExecuted += 1;
    result.trace.push({ stepIndex: index + 1, stepId: step.id, name: step.name, success: true, branch });
    await emitProgress(args, { phase: 'step_complete', ...progress, branch });
    return { next: nextIndex(flow, step, index, branch) };
  } catch (error) {
    const stopped = error?.name === 'AbortError';
    await emitProgress(args, {
      phase: stopped ? 'stopped' : 'step_failed',
      ...progress,
      error: error?.message || String(error),
    });
    return {
      failure: {
        ...result,
        success: false,
        stopped,
        errorCode: String(error?.code || 'CARD_STEP_FAILED'),
        error: error?.message || String(error),
        stepIndex: index + 1,
        stepId: step.id,
        selector: text(step.selector),
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

module.exports = { buildContext, buildFlow, resolveTemplate, runNativeCard };
