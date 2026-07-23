'use strict';

const SOFTWARE_UI_TOOL_NAME = 'software_ui';
const ACTIONS = [
  'observe', 'click', 'invoke', 'mouse_click', 'double_click', 'right_click',
  'type', 'set_value',
  'toggle', 'select', 'expand', 'collapse', 'focus',
];
const MOUSE_ACTIONS = new Set(['click', 'mouse_click', 'double_click', 'right_click']);

const SOFTWARE_UI_TOOL = Object.freeze({
  name: SOFTWARE_UI_TOOL_NAME,
  destructive: true,
  description: '控制绑定的软件窗口。先 observe；click 使用受控的 Windows 鼠标输入，invoke 才调用 UIA。',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ACTIONS },
      ref: { type: 'string', description: 'observe 返回的 ref；窗口本身用 root' },
      text: { type: 'string', maxLength: 4096, description: 'type/set_value 的文本' },
      limit: { type: 'integer', minimum: 1, maximum: 80, description: 'observe 数量，默认 30' },
      max_depth: { type: 'integer', minimum: 1, maximum: 10, description: 'observe 深度，默认 6' },
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

class AiSoftwareUiTools {
  constructor(options = {}) {
    this.windowBridge = options.windowBridge;
    this.target = normalizeTarget(options.target);
    this.clickPoints = new Map();
    this.tools = this.target ? [SOFTWARE_UI_TOOL] : [];
  }

  has(name) {
    return Boolean(this.target && name === SOFTWARE_UI_TOOL_NAME);
  }

  execute(name, rawArgs = {}) {
    if (!this.has(name)) throw new Error('当前活动栏目不是可控的外部软件窗口');
    const action = String(rawArgs.action || '').trim();
    if (!ACTIONS.includes(action)) throw new Error(`不支持的软件 UI 操作: ${action || '空'}`);
    return action === 'observe'
      ? this.observe(rawArgs)
      : this.perform(action, rawArgs);
  }

  observe(args) {
    const result = this.windowBridge.observeExternalWindowUi({
      childHwnd: this.target.hwnd,
      childPid: this.target.pid,
      limit: Math.min(80, Math.max(1, Number(args.limit) || 30)),
      maxDepth: Math.min(10, Math.max(1, Number(args.max_depth) || 6)),
    });
    this.clickPoints.clear();
    for (const item of Array.isArray(result?.items) ? result.items : []) {
      const ref = String(item?.ref || '').trim();
      if (ref && Number.isFinite(item.click_x) && Number.isFinite(item.click_y)) {
        this.clickPoints.set(ref, { x: item.click_x, y: item.click_y });
      }
    }
    return { ...result, target: targetSummary(this.target) };
  }

  perform(action, args) {
    const ref = String(args.ref || 'root').trim();
    if (action !== 'focus' && ref === 'root') {
      throw new Error(`${action} 需要 observe 返回的控件 ref`);
    }
    const point = MOUSE_ACTIONS.has(action) ? this.clickPoints.get(ref) : null;
    const result = this.windowBridge.performExternalWindowUiAction({
      childHwnd: this.target.hwnd,
      childPid: this.target.pid,
      action,
      ref,
      text: String(args.text || '').slice(0, 4096),
      ...(point || {}),
    });
    return { ...result, target: targetSummary(this.target) };
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
};
