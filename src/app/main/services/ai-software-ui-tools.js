'use strict';

const SOFTWARE_UI_TOOL_NAME = 'software_ui';
const ACTIONS = [
  'observe', 'screenshot',
  'click', 'mouse_click', 'double_click', 'right_click',
  'type', 'press_key', 'scroll', 'drag', 'focus',
];
const MOUSE_ACTIONS = new Set(['click', 'mouse_click', 'double_click', 'right_click']);
const COORDINATE_ACTIONS = new Set([...MOUSE_ACTIONS, 'scroll', 'drag']);

const SOFTWARE_UI_TOOL = Object.freeze({
  name: SOFTWARE_UI_TOOL_NAME,
  destructive: true,
  description: '观察并控制已绑定软件（纯视觉）。先 observe 获取截图与 visual_candidates；用 vref 或 x/y + observation_id 点击。',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ACTIONS },
      observation_id: { type: 'string', maxLength: 80 },
      vref: { type: 'string', description: 'observe 返回的视觉候选 id' },
      text: { type: 'string', maxLength: 4096 },
      key: { type: 'string', maxLength: 32 },
      x: { type: 'integer', minimum: 0, maximum: 10000 },
      y: { type: 'integer', minimum: 0, maximum: 10000 },
      end_x: { type: 'integer', minimum: 0, maximum: 10000 },
      end_y: { type: 'integer', minimum: 0, maximum: 10000 },
      delta: { type: 'integer', minimum: -1200, maximum: 1200 },
      limit: { type: 'integer', minimum: 1, maximum: 24, description: '视觉候选数量上限' },
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

function cacheVisualCandidates(target, candidates) {
  target.clear();
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const vref = String(item?.vref || '').trim();
    if (!vref) continue;
    const cx = Number(item.cx ?? (Number(item.x) + Number(item.width) / 2));
    const cy = Number(item.cy ?? (Number(item.y) + Number(item.height) / 2));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    target.set(vref, {
      vref,
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      cx,
      cy,
    });
  }
}

class AiSoftwareUiTools {
  constructor(options = {}) {
    this.windowBridge = options.windowBridge;
    this.cursorSidecarService = options.cursorSidecarService;
    this.target = normalizeTarget(options.target);
    this.visualCandidates = new Map();
    this.observation = null;
    this.generation = 0;
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
      return this.observe(rawArgs);
    }
    return this.perform(action, rawArgs);
  }

  async readVisual(args = {}) {
    return callBridge(
      this.windowBridge,
      'captureExternalWindow',
      'captureExternalWindow',
      {
        childHwnd: this.target.hwnd,
        childPid: this.target.pid,
        maxWidth: 1600,
        maxHeight: 1000,
        includeVisualCandidates: true,
        candidateLimit: boundedInteger(args.limit, 24, 1, 24),
      },
    );
  }

  registerObservation(visual) {
    const id = `obs:${Date.now().toString(36)}:${++this.generation}`;
    cacheVisualCandidates(this.visualCandidates, visual?.visual_candidates);
    this.observation = {
      id,
      mode: 'visual',
      visual: visualObservation(visual),
    };
    return id;
  }

  clearObservationState() {
    this.visualCandidates.clear();
    this.observation = null;
  }

  async observe(args = {}) {
    const visual = await this.readVisual(args);
    const observationId = this.registerObservation(visual);
    return {
      ...(visual || {}),
      success: true,
      observation_id: observationId,
      observation_mode: 'visual',
      items: Array.isArray(visual?.visual_candidates) ? visual.visual_candidates : [],
      count: Array.isArray(visual?.visual_candidates) ? visual.visual_candidates.length : 0,
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
    if (!visual) throw new Error('当前观察没有截图坐标，请重新 observe');
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

  vrefPoint(args) {
    const vref = String(args.vref || '').trim();
    if (!vref) return null;
    this.requireCurrentObservation(args);
    const candidate = this.visualCandidates.get(vref);
    if (!candidate) throw new Error('视觉候选 vref 已失效，请重新 observe');
    return this.visualPoint({
      observation_id: args.observation_id,
      x: candidate.cx,
      y: candidate.cy,
    });
  }

  baseOptions(action, args) {
    return {
      childHwnd: this.target.hwnd,
      childPid: this.target.pid,
      action,
      text: action === 'press_key'
        ? String(args.key || '').slice(0, 32)
        : String(args.text || '').slice(0, 4096),
    };
  }

  buildActionOptions(action, args) {
    const options = this.baseOptions(action, args);
    if (MOUSE_ACTIONS.has(action)) {
      const vrefPoint = this.vrefPoint(args);
      if (vrefPoint) return { ...options, ...vrefPoint };
      if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) {
        return { ...options, ...this.visualPoint(args) };
      }
      throw new Error(`${action} 需要 vref 或 observation_id 与截图坐标 x/y`);
    }
    if (action === 'scroll' || action === 'drag') {
      const point = this.vrefPoint(args) || this.visualPoint(args);
      Object.assign(options, point);
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
    if (action === 'type' || action === 'press_key' || action === 'focus') {
      this.requireCurrentObservation(args);
      return options;
    }
    throw new Error(`不支持的软件 UI 操作: ${action}`);
  }

  async displayPointerAction(action, options) {
    try {
      if (action === 'drag') {
        return await this.cursorSidecarService?.dragAndWait?.(
          this.target.profileId,
          { x: options.x, y: options.y },
          { x: options.endX, y: options.endY },
          { durationMs: 260 },
        );
      }
      if (MOUSE_ACTIONS.has(action)) {
        return await this.cursorSidecarService?.moveAndWait?.(
          this.target.profileId,
          { x: options.x, y: options.y },
          { durationMs: 180 },
        );
      }
    } catch (_) {}
    return null;
  }

  async perform(action, args) {
    const options = this.buildActionOptions(action, args);
    if (action === 'type' || action === 'press_key') {
      await callBridge(
        this.windowBridge,
        'performExternalWindowActionAsync',
        'performExternalWindowAction',
        { ...options, action: 'focus', text: '' },
      );
    }
    const display = await this.displayPointerAction(action, options);
    const actionResult = await callBridge(
      this.windowBridge,
      'performExternalWindowActionAsync',
      'performExternalWindowAction',
      options,
    );
    if (display?.sequenceId && MOUSE_ACTIONS.has(action)) {
      const button = action === 'right_click' ? 'right' : 'left';
      this.cursorSidecarService?.feedback?.(
        this.target.profileId, display.sequenceId, button,
      );
    }
    this.clearObservationState();
    if (args.refresh === false) {
      return {
        ...actionResult,
        observation_invalidated: true,
        target: targetSummary(this.target),
      };
    }
    const refreshed = await this.observe({});
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
  COORDINATE_ACTIONS,
  MOUSE_ACTIONS,
  SOFTWARE_UI_TOOL,
  SOFTWARE_UI_TOOL_NAME,
  createAiSoftwareUiTools,
};
