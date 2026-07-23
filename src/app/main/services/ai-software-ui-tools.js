'use strict';

const SOFTWARE_UI_TOOL_NAME = 'software_ui';
const ACTIONS = [
  'observe', 'screenshot',
  'click', 'invoke', 'mouse_click', 'double_click', 'right_click',
  'type', 'set_value', 'press_key', 'scroll', 'drag',
  'toggle', 'select', 'expand', 'collapse', 'focus',
];
const MOUSE_ACTIONS = new Set(['click', 'mouse_click', 'double_click', 'right_click']);
const COORDINATE_ACTIONS = new Set([
  ...MOUSE_ACTIONS, 'scroll', 'drag',
]);
const UIA_ACTIONS = new Set([
  'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'focus',
]);

const SOFTWARE_UI_TOOL = Object.freeze({
  name: SOFTWARE_UI_TOOL_NAME,
  destructive: true,
  description: '观察并控制已绑定软件。先 observe；UIA 不足时返回窗口截图和 observation_id。',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ACTIONS },
      mode: { type: 'string', enum: ['auto', 'accessibility', 'visual'] },
      observation_id: { type: 'string', maxLength: 80 },
      ref: { type: 'string', description: 'observe 返回的 UIA ref' },
      text: { type: 'string', maxLength: 4096 },
      key: { type: 'string', maxLength: 32 },
      x: { type: 'integer', minimum: 0, maximum: 10000 },
      y: { type: 'integer', minimum: 0, maximum: 10000 },
      end_x: { type: 'integer', minimum: 0, maximum: 10000 },
      end_y: { type: 'integer', minimum: 0, maximum: 10000 },
      delta: { type: 'integer', minimum: -1200, maximum: 1200 },
      limit: { type: 'integer', minimum: 1, maximum: 80 },
      max_depth: { type: 'integer', minimum: 1, maximum: 10 },
      refresh: { type: 'boolean', description: '动作后重新观察，默认 true' },
    },
  },
});

function normalizeTarget(target) {
  const hwnd = String(target?.hwnd || '').trim();
  const pid = Number(target?.pid || 0);
  if (!hwnd || !Number.isInteger(pid) || pid <= 0) return null;
  return {
    hwnd,
    pid,
    profileId: String(target.profileId || '').trim(),
    name: String(target.name || '外部软件').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120),
  };
}

function targetSummary(target) {
  return {
    profile_id: target.profileId,
    name: target.name,
    pid: target.pid,
  };
}

function observationMode(value, fallback = 'auto') {
  const mode = String(value || '').trim().toLowerCase();
  return ['auto', 'accessibility', 'visual'].includes(mode) ? mode : fallback;
}

function needsVisualFallback(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const actionable = items.filter((item) => (
    Number.isFinite(item?.click_x)
    || (Array.isArray(item?.actions) && item.actions.length > 0)
  ));
  return items.length === 0 || actionable.length === 0;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}

async function callBridge(bridge, asyncName, syncName, options) {
  if (typeof bridge?.[asyncName] === 'function') return bridge[asyncName](options);
  if (typeof bridge?.[syncName] === 'function') return bridge[syncName](options);
  throw new Error(`软件自动化桥缺少 ${syncName}`);
}

function cacheClickPoints(target, items) {
  target.clear();
  for (const item of Array.isArray(items) ? items : []) {
    const ref = String(item?.ref || '').trim();
    if (ref && Number.isFinite(item?.click_x) && Number.isFinite(item?.click_y)) {
      target.set(ref, { x: item.click_x, y: item.click_y });
    }
  }
}

function cacheRefs(target, items) {
  target.clear();
  for (const item of Array.isArray(items) ? items : []) {
    const ref = String(item?.ref || '').trim();
    if (ref) target.add(ref);
  }
}

function visualObservation(visual) {
  if (!visual) return null;
  return {
    originX: Number(visual.originX || 0),
    originY: Number(visual.originY || 0),
    sourceWidth: Number(visual.sourceWidth || visual.width || 0),
    sourceHeight: Number(visual.sourceHeight || visual.height || 0),
    width: Number(visual.width || 0),
    height: Number(visual.height || 0),
  };
}

function baseActionOptions(target, action, args, ref) {
  return {
    childHwnd: target.hwnd,
    childPid: target.pid,
    action,
    ref: ref || 'root',
    text: action === 'press_key'
      ? String(args.key || '').slice(0, 32)
      : String(args.text || '').slice(0, 4096),
  };
}

class AiSoftwareUiTools {
  constructor(options = {}) {
    this.windowBridge = options.windowBridge;
    this.target = normalizeTarget(options.target);
    this.clickPoints = new Map();
    this.knownRefs = new Set();
    this.observation = null;
    this.generation = 0;
    this.lastMode = 'auto';
    this.tools = this.target ? [SOFTWARE_UI_TOOL] : [];
  }

  has(name) {
    return Boolean(this.target && name === SOFTWARE_UI_TOOL_NAME);
  }

  async execute(name, rawArgs = {}) {
    if (!this.has(name)) throw new Error('当前活动栏目不是可控的外部软件窗口');
    const action = String(rawArgs.action || '').trim();
    if (!ACTIONS.includes(action)) throw new Error(`不支持的软件 UI 操作: ${action || '空'}`);
    if (action === 'observe' || action === 'screenshot') {
      const mode = action === 'screenshot' ? 'visual' : observationMode(rawArgs.mode);
      return this.observe(rawArgs, mode);
    }
    return this.perform(action, rawArgs);
  }

  async readAccessibility(args) {
    return callBridge(
      this.windowBridge,
      'observeExternalWindowUiAsync',
      'observeExternalWindowUi',
      {
        childHwnd: this.target.hwnd,
        childPid: this.target.pid,
        limit: boundedInteger(args.limit, 30, 1, 80),
        maxDepth: boundedInteger(args.max_depth, 6, 1, 10),
      },
    );
  }

  async readVisual() {
    return callBridge(
      this.windowBridge,
      'captureExternalWindow',
      'captureExternalWindow',
      {
        childHwnd: this.target.hwnd,
        childPid: this.target.pid,
        maxWidth: 1600,
        maxHeight: 1000,
      },
    );
  }

  registerObservation(accessibility, visual, mode) {
    const id = `obs:${Date.now().toString(36)}:${++this.generation}`;
    cacheClickPoints(this.clickPoints, accessibility?.items);
    cacheRefs(this.knownRefs, accessibility?.items);
    this.observation = {
      id,
      mode,
      visual: visualObservation(visual),
    };
    this.lastMode = mode;
    return id;
  }

  async observe(args, requestedMode = 'auto') {
    let accessibility = null;
    let accessibilityError = '';
    if (requestedMode !== 'visual') {
      try {
        accessibility = await this.readAccessibility(args);
      } catch (error) {
        accessibilityError = String(error?.message || error);
        if (requestedMode === 'accessibility') throw error;
      }
    }
    const useVisual = requestedMode === 'visual'
      || (requestedMode === 'auto' && needsVisualFallback(accessibility));
    const visual = useVisual ? await this.readVisual() : null;
    const mode = visual ? 'visual' : 'accessibility';
    const observationId = this.registerObservation(accessibility, visual, mode);
    return {
      ...(accessibility || { success: true, items: [], count: 0 }),
      ...(visual || {}),
      success: true,
      observation_id: observationId,
      observation_mode: mode,
      ...(accessibilityError ? { accessibility_warning: accessibilityError } : {}),
      target: targetSummary(this.target),
    };
  }

  requireCurrentObservation(args) {
    const supplied = String(args.observation_id || '').trim();
    if (!this.observation || !supplied || supplied !== this.observation.id) {
      throw new Error('界面状态已变化或 observation_id 无效，请重新 observe');
    }
    return this.observation;
  }

  visualPoint(args, xName = 'x', yName = 'y') {
    const observation = this.requireCurrentObservation(args);
    const visual = observation.visual;
    if (!visual) throw new Error('当前观察没有截图坐标，请使用 mode=visual 重新 observe');
    const x = Number(args[xName]);
    const y = Number(args[yName]);
    if (!Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x >= visual.width || y >= visual.height) {
      throw new Error(`${xName}/${yName} 超出当前截图范围`);
    }
    return {
      x: visual.originX + Math.round(x * visual.sourceWidth / visual.width),
      y: visual.originY + Math.round(y * visual.sourceHeight / visual.height),
    };
  }

  buildActionOptions(action, args) {
    const ref = String(args.ref || '').trim();
    const options = baseActionOptions(this.target, action, args, ref);
    if (ref && !this.knownRefs.has(ref)) {
      throw new Error('控件 ref 已失效，请重新 observe');
    }
    if (ref && MOUSE_ACTIONS.has(action)) {
      return this.addRefPoint(options, ref);
    }
    if (COORDINATE_ACTIONS.has(action)) {
      return this.addCoordinateInput(options, action, args);
    }
    if (action === 'type') {
      if (!ref) this.requireCurrentObservation(args);
      options.directInput = true;
      return options;
    }
    if (action === 'press_key') {
      this.requireCurrentObservation(args);
      options.directInput = true;
      return options;
    }
    if (!ref && UIA_ACTIONS.has(action)) {
      throw new Error(`${action} 需要 observe 返回的控件 ref`);
    }
    return options;
  }

  addRefPoint(options, ref) {
    const point = this.clickPoints.get(ref);
    if (!point) throw new Error('控件 ref 已失效，请重新 observe');
    return { ...options, ...point };
  }

  addCoordinateInput(options, action, args) {
    if (!Number.isFinite(Number(args.x)) || !Number.isFinite(Number(args.y))) {
      throw new Error(`${action} 需要 observe 返回的控件 ref，或 observation_id 与截图坐标`);
    }
    Object.assign(options, this.visualPoint(args));
    if (action === 'drag') {
      const end = this.visualPoint(args, 'end_x', 'end_y');
      options.endX = end.x;
      options.endY = end.y;
    }
    if (action === 'scroll') {
      options.delta = boundedInteger(args.delta, -360, -1200, 1200);
    }
    return options;
  }

  async focusDirectInputTarget(options) {
    if (!options.directInput || !options.ref || options.ref === 'root') return;
    const { directInput: _directInput, ...focusOptions } = options;
    await callBridge(
      this.windowBridge,
      'performExternalWindowUiActionAsync',
      'performExternalWindowUiAction',
      { ...focusOptions, action: 'focus', text: '' },
    );
  }

  async perform(action, args) {
    const options = this.buildActionOptions(action, args);
    await this.focusDirectInputTarget(options);
    const actionResult = await callBridge(
      this.windowBridge,
      'performExternalWindowUiActionAsync',
      'performExternalWindowUiAction',
      options,
    );
    const refreshMode = this.lastMode === 'visual' ? 'visual' : 'auto';
    this.clickPoints.clear();
    this.knownRefs.clear();
    this.observation = null;
    if (args.refresh === false) {
      return {
        ...actionResult,
        observation_invalidated: true,
        target: targetSummary(this.target),
      };
    }
    const refreshed = await this.observe({}, refreshMode);
    return {
      ...refreshed,
      action_result: actionResult,
    };
  }
}

function createAiSoftwareUiTools(options) {
  return new AiSoftwareUiTools(options);
}

module.exports = {
  ACTIONS,
  AiSoftwareUiTools,
  MOUSE_ACTIONS,
  SOFTWARE_UI_TOOL,
  SOFTWARE_UI_TOOL_NAME,
  createAiSoftwareUiTools,
  needsVisualFallback,
};
