// 09_agent_socket.js — AI-FREE 本机桥接（自动注册 + 工具任务调度）。
// 插件不再登录独立账号；软件启动的 loopback HTTP 服务负责发现多个浏览器插件连接，
// 并把 AI 控制页中选定连接的工具调用派发到这里。

const AGENT_KEEPALIVE_ALARM = 'agent-keepalive';
const AGENT_VERSION = '1.0.0';
const AGENT_BRIDGE_PROTOCOL_VERSION = 1;
const APP_BROWSER_PID_HEADER = 'X-AI-Free-Browser-Pid';

// Protocol event names (kept for server compatibility)
const DEVICE_ENROLL = 'device:register';
const DEVICE_ENROLLED = 'device:registered';

let agentSocket = null;
let agentStatus = 'disconnected'; // disconnected | connecting | connected | enrolled | error
let agentBoundAiConfigId = null;
let agentCurrentId = null;
let agentMachineId = null;
let agentBrowserProcessId = 0;
let agentConnectPromise = null;
let agentReconnectTimer = null;
let agentLastErrorReason = ''; // 最近一次 error 状态的原因，便于 UI 显示详细提示
const agentTaskOutcomes = new Map();
const MAX_AGENT_TASK_OUTCOMES = 100;

// 用于 MCP / agent 调用 manage_card run 时，将 card-run-progress 实时转发为 task:progress
let activeMcpCardTask = null;

// ── 自动化卡片编写规范（manage_card action=rules 返回给 AI）───────────────────
// 与 06_automation_run.js 执行引擎、02_sidebar_page.js 页面动作执行器、
// popup/automation-workbench.js 编辑器保持一致；改动步骤类型或字段时同步更新这里。
// 注意：type 步骤现已显式支持 textarea（根因修复百度等站点改版后 #kw -> textarea 失效）。

// 执行引擎实际支持的步骤类型全集（write 校验与 rules 均以此为准）。
const CARD_STEP_TYPES = [
    'navigate', 'click', 'type', 'wait',
    'condition', 'save_cookies', 'clear_current_page_cache', 'get_credits', 'screenshot'
];
const CARD_STEP_BY_VALUES = ['css_selector', 'text', 'auto'];
const CARD_MANAGE_ACTIONS = [
    'rules', 'list', 'get', 'write',
    'patch_step', 'insert_step', 'delete_step', 'move_step',
    'delete', 'run'
];
const CARD_STEP_EDIT_ACTIONS = ['patch_step', 'insert_step', 'delete_step', 'move_step'];

function firstAgentSocketValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

function agentSocketText(...values) {
    const value = firstAgentSocketValue(...values);
    return value === undefined ? '' : String(value).trim();
}

const CARD_FORMAT_RULES = `# 自动化卡片规范（cardData）—— 步骤类型与运行规则

写卡片前必读。字段与步骤类型只能取自本规范，不要发明不存在的字段或类型（write 时会校验并拒绝）。

## 顶层字段
- name: string，卡片名称（为空时自动生成 automation_<时间戳>）
- website: string，目标网址；若 steps 第一步不是 navigate，执行时会自动在最前插入跳转到 website 的 navigate 步骤
- description: string，可选，卡片说明
- points: number，可选，积分基础值
- popups: array，可选，弹窗关闭规则，形如 [{ "name": "关闭弹窗", "selector": ".modal-close" }]
- steps: array，必填且非空。没有 flow 时按顺序执行；有 flow 时 steps 是节点详情，实际下一步由 flow.edges 决定
- flow: object，可选，流程图结构；用于分支、汇合、拖拽布局。格式：{ "version": 1, "start": "步骤id", "nodes": [{ "id": "步骤id", "x": 40, "y": 40 }], "edges": [{ "from": "步骤id", "to": "步骤id", "label": "next|true|false" }] }

## 步骤通用字段
- name: string，步骤名（仅用于展示/日志，不再影响填充逻辑）
- id: string，推荐，流程图节点唯一 id；使用 flow 时必填且 edges/nodes 必须引用这个 id
- type: string，必填，只能取下方 9 种步骤类型之一
- selector: string，目标元素定位，语法见「选择器语法」
- text: string，type 步骤要输入的默认文本（即变量默认值，见运行规则第 4 条「变量输入」）
- variable: string，可选，仅 type 步骤有效；该变量的键名，运行前可用 inputs 按此键覆盖输入文本；不填则按其在全部 type 步骤中的顺序回退为 var1/var2/...
- by: "css_selector"（默认）| "text"（按可见文本）| "auto"（先按 CSS 再按文本兜底）
- nth: number，可选，selector 命中多个元素时取第几个
- timeout: number，毫秒，可选，默认值见各步骤类型
- poll_interval_ms: number，毫秒，可选，轮询间隔
- optional: true 时该步骤失败直接跳过；不设置则任一步骤失败后立即结束，找不到元素或等待超时均只尝试 1 次（见运行规则第 2 条）

## 步骤类型（type，仅以下 9 种）
- navigate: 跳转 url（省略 url 时用卡片 website；当前已在目标地址则刷新页面；timeout 默认 15000）
- click: 点击 selector 元素（timeout 默认 5000，poll_interval_ms 默认 200）
- type: 向 selector 输入 text（支持 <input>（非 button/checkbox 等）、<textarea>、[contenteditable]、role=textbox/searchbox 等可编辑元素；timeout 默认 5000）；clear_first=true 输入前清空；click_before_type=true 输入前先点击。找到非输入元素会立即报错（失败后不重试）
- wait: 等待元素出现（selector + timeout，默认 3000）；或改用 wait_for_text 等文本出现 / wait_for_element_hidden 等元素消失 / wait_for_text_hidden 等文本消失
- condition: 判断分支节点，不操作页面，只计算 true/false 并按 flow.edges 中对应 label 出边跳转。condition_mode 可取 selector_exists（默认）/ selector_missing / text_exists / text_missing / url_matches；MCP 不允许 JS 条件。condition 节点的出边推荐写 label:"true" 与 label:"false"；缺少对应 label 时会尝试 default/next，仍无出边则流程结束
- save_cookies: 抓取并保存当前页 Cookie + localStorage/sessionStorage（必须显式放在 steps 里才会执行；缺少 account/password 上下文时该步跳过并在进度中记录原因）
- clear_current_page_cache: 清理当前页 Cookie/localStorage/sessionStorage/CacheStorage/IndexedDB
- get_credits: 读取 selector 元素文本作为积分写入执行结果
- screenshot: 截图步骤（当前实现会捕获当前标签页可见区域并下载 PNG）

## 选择器语法（selector）
- 标准 CSS：#id、.class、button[type=submit]
- text=登录 —— 按可见文本定位
- id=xxx / class=xxx / name=xxx / placeholder=xxx / aria-label=xxx —— 按属性定位
- .btn:has-text("提交") —— CSS 命中且内含指定文本
- by="auto" 时先按 CSS 查找，找不到再自动按 text= 兜底

## 模板变量
url/selector/text/script/wait_for_* 等字符串字段支持占位符 {键}，执行时替换为运行上下文的值；未知占位符原样保留。可用的键：任意「变量键」（每个 type 步骤的 variable，或 var1/var2/...，取其最终输入值）和运行前 inputs 传入的键。不再有账号/密码专属占位符或随机密码。

## 运行规则（执行行为，写卡片时必须据此设计步骤）
1. 卡片在当前活动标签页执行；没有 flow 时入口地址取第一步 navigate 的 url，否则取卡片 website（两者都没有则 write 会被拒绝）。有 flow 时从 flow.start 指向的步骤开始；若卡片 website 需要先打开且起点不是 navigate，执行器仍会自动前置访问 website。
2. 所有非 optional 步骤最多尝试 1 次；找不到元素或等待超时后立即失败并结束，不再自动重试。对可能不存在的元素（如偶现弹窗、可选勾选框）必须加 optional:true。
3. flow 执行：普通步骤成功后优先走 label=next/default 的出边；condition 根据判断结果走 label=true 或 label=false 的出边；没有可用出边时流程结束。为避免误写死循环，单次运行最多跳转约 max(120, steps.length*20) 次。
4. 变量输入（替代原账号/密码机制）：每个 type 步骤都是一个变量槽，默认输入其 text 字段的固定文本。运行前可通过 run(payload) 的 inputs（{ 变量键: 值 } 对象或数组按序映射 var1..varN）或注册面板输入框按变量键覆盖该步骤的输入文本；未提供覆盖值则用 text 默认值。变量键取步骤 variable 字段，未设置则按其在全部 type 步骤中的顺序回退为 var1/var2/...。不再自动生成密码。
5. 不再有基于步骤名的智能填充。需要运行期赋值的输入，用自定义变量键 + inputs 覆盖。type 支持的元素类型见「步骤类型」说明，命中非输入元素会立即清晰报错。
6. Cookie 保存不是自动行为，必须在 steps 中主动加入 { "type": "save_cookies", "name": "保存 Cookie" } 步骤才会执行抓取并保存当前页的 Cookie + localStorage/sessionStorage。显式步骤中若缺少 account/password 上下文则会跳过保存并记录原因。文件名优先使用 account/password（或 email/code）变量值。
7. 同一时间只能运行一张卡片；action=run 是长任务，可能耗时数分钟。执行期间会通过 task:progress 及时反馈每步开始/完成/重试/错误等完整过程，而非仅返回最终结果。
8. 失败结果与续跑闭环：run 失败时返回 errorCode（ELEMENT_NOT_FOUND / WAIT_TIMEOUT / NAVIGATION_TIMEOUT / UNSUPPORTED_ELEMENT_TYPE / SCRIPT_ERROR / VERIFICATION_CODE_TIMEOUT / CLICK_FAILED / MISSING_URL 等）、失败步骤 stepIndex/stepName/stepType/selector、failureSnapshot（当前页 URL/标题 + 近似候选元素的 tag/selector/text/placeholder）与 context（已用到的变量值，如 account/password/email/code 或自定义键）。失败后页面停留在失败现场：先按 failureSnapshot.candidates 或 browser_observe 找出正确 selector，用 write 修复卡片，再 run + start_step=失败的 stepIndex（并通过 inputs 回传 context 里已用到的变量值）从失败步骤继续，不要从头重跑。另外 browser_action click/type、browser_tab navigate/replace、browser_wait 成功回执都带 cardStep 字段（与本规范同构的步骤对象）——探索验证通过后直接把这些 cardStep 拼进 steps 即可成卡，type 步骤的 text 即该变量默认值（需运行期赋值的写成 {code} 或自定义变量键）；cardStep.inFrame=true 时该 selector 在 iframe 内，不能直接写入卡片。

## MCP 局部编辑动作（manage_card）
- write 仍可创建/覆盖完整 cardData；只改步骤时可用 patch_step / insert_step / delete_step / move_step。
- step_index / to_step_index 均为 1-based，和 run 失败返回的 stepIndex 一致。insert_step 的 step_index 表示插入到第 N 步之前；不传 step_index 时默认追加到末尾，也可用 insert_after 指定插到某步之后（0 表示开头）。
- patch_step 默认把 stepPatch（也兼容 patch / stepData / step）合并到原步骤；replace=true 或 action=replace_step 时替换整个步骤。局部编辑后仍会按完整卡片规范校验，非法步骤类型会被拒绝。

## 最小示例
{
  "name": "示例注册",
  "website": "https://example.com/signup",
  "steps": [
    { "name": "输入邮箱", "type": "type", "selector": "#email", "variable": "email", "text": "test@example.com" },
    { "name": "输入密码", "type": "type", "selector": "#password", "variable": "password", "text": "MyPassw0rd!" },
    { "name": "同意条款", "type": "click", "selector": "#agree", "optional": true },
    { "name": "提交", "type": "click", "selector": "button[type=submit]" }
  ]
}
// 运行时覆盖示例：inputs = { "email": "user01@x.com", "password": "P@ss01" }（未传的变量用上面的默认 text）

## flow 分支示例
{
  "name": "已登录则跳过登录",
  "website": "https://example.com",
  "steps": [
    { "id": "open_home", "name": "打开首页", "type": "navigate", "url": "https://example.com" },
    { "id": "check_login", "name": "判断是否已登录", "type": "condition", "condition_mode": "selector_exists", "selector": ".avatar" },
    { "id": "type_email", "name": "输入邮箱", "type": "type", "selector": "#email", "variable": "email", "text": "user@example.com" },
    { "id": "done", "name": "保存 Cookie", "type": "save_cookies" }
  ],
  "flow": {
    "version": 1,
    "start": "open_home",
    "nodes": [
      { "id": "open_home", "x": 40, "y": 40 },
      { "id": "check_login", "x": 40, "y": 170 },
      { "id": "type_email", "x": 280, "y": 300 },
      { "id": "done", "x": 40, "y": 430 }
    ],
    "edges": [
      { "from": "open_home", "to": "check_login", "label": "next" },
      { "from": "check_login", "to": "done", "label": "true" },
      { "from": "check_login", "to": "type_email", "label": "false" },
      { "from": "type_email", "to": "done", "label": "next" }
    ]
  }
}`;

// write 前置校验：拦截 AI 编造的步骤类型/定位方式，错误信息直接指回 action=rules。
function validateCardWriteStep(step, index, problems) {
    const stepName = step && step.name ? `（${step.name}）` : '';
    const label = `steps[${index}]${stepName}`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
        problems.push(`${label} 不是对象`);
        return;
    }
    const type = agentSocketText(step.type).toLowerCase();
    if (!CARD_STEP_TYPES.includes(type)) {
        problems.push(`${label} 的 type "${agentSocketText(step.type, '(空)')}" 不存在`);
    }
    const by = step.by === undefined ? '' : agentSocketText(step.by).toLowerCase();
    if (by && !CARD_STEP_BY_VALUES.includes(by)) {
        problems.push(`${label} 的 by "${step.by}" 不存在（可选 ${CARD_STEP_BY_VALUES.join('/')}）`);
    }
    const conditionMode = agentSocketText(step.condition_mode, step.condition, step.mode).toLowerCase();
    if (type === 'condition' && conditionMode === 'js') {
        problems.push(`${label} 不允许使用 JS 条件`);
    }
}

function assertMcpSafeCardData(cardData) {
    const steps = Array.isArray(cardData?.steps) ? cardData.steps : [];
    const unsafe = steps.find((step) => {
        const type = agentSocketText(step?.type).toLowerCase();
        const mode = agentSocketText(step?.condition_mode, step?.condition, step?.mode).toLowerCase();
        return type === 'external_script' || (type === 'condition' && mode === 'js');
    });
    if (unsafe) throw new Error('MCP 禁止创建或运行任意页面脚本；请改用固定的观察、点击、输入和条件操作。');
}

function validateCardFlowNode(node, index, stepIdSet, problems) {
    const source = node && typeof node === 'object' ? node : {};
    const id = agentSocketText(source.id, source.stepId);
    if (!id || !stepIdSet.has(id)) {
        problems.push(`flow.nodes[${index}].id "${id || '(空)'}" 未引用任何 steps[].id`);
    }
}

function validateCardFlowEdge(edge, index, stepIdSet, problems) {
    const source = edge && typeof edge === 'object' ? edge : {};
    const from = agentSocketText(source.from, source.source, source.fromId);
    const to = agentSocketText(source.to, source.target, source.toId);
    const label = agentSocketText(source.label, source.branch, source.condition, 'next').toLowerCase();
    if (!stepIdSet.has(from)) {
        problems.push(`flow.edges[${index}].from "${from || '(空)'}" 未引用任何 steps[].id`);
    }
    if (!stepIdSet.has(to)) {
        problems.push(`flow.edges[${index}].to "${to || '(空)'}" 未引用任何 steps[].id`);
    }
    const allowed = ['next', 'default', 'true', 'false', 'yes', 'no', 'success', 'fail', 'failure', 'else', 'match'];
    if (!allowed.includes(label)) {
        problems.push(`flow.edges[${index}].label "${label}" 不建议使用（推荐 next/true/false/default）`);
    }
}

function validateCardFlow(flow, stepIdSet, problems) {
    if (!flow) return;
    const start = agentSocketText(flow.start, flow.start_node_id, flow.startNodeId);
    if (start && !stepIdSet.has(start)) problems.push(`flow.start "${start}" 未引用任何 steps[].id`);
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    nodes.forEach((node, index) => validateCardFlowNode(node, index, stepIdSet, problems));
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    edges.forEach((edge, index) => validateCardFlowEdge(edge, index, stepIdSet, problems));
}

function hasCardEntryNavigation(steps, flow) {
    const firstStep = steps.find((step) => step && typeof step === 'object') || {};
    if (agentSocketText(firstStep.type).toLowerCase() === 'navigate') return true;
    if (!flow) return false;
    const start = agentSocketText(flow.start, flow.start_node_id, flow.startNodeId);
    const startStep = steps.find((step, index) => (
        agentSocketText(step && step.id, `step_${index + 1}`) === start
    )) || firstStep;
    return agentSocketText(startStep.type).toLowerCase() === 'navigate';
}

function validateCardDataForWrite(cardData) {
    if (!cardData || typeof cardData !== 'object' || Array.isArray(cardData)) {
        throw new Error('cardData 必须是对象；请先调用 manage_card action=rules 获取卡片规范');
    }
    const steps = Array.isArray(cardData.steps) ? cardData.steps : [];
    if (steps.length === 0) {
        throw new Error('cardData.steps 必须是非空数组；请先调用 manage_card action=rules 获取卡片规范');
    }
    const problems = [];
    steps.forEach((step, index) => validateCardWriteStep(step, index, problems));
    const stepIds = steps.map((step, index) => agentSocketText(step && step.id, `step_${index + 1}`)).filter(Boolean);
    const stepIdSet = new Set(stepIds);
    if (stepIdSet.size !== stepIds.length) {
        problems.push('steps[].id 必须唯一（使用 flow 时 edges 会按 id 跳转）');
    }
    const flow = cardData.flow && typeof cardData.flow === 'object' && !Array.isArray(cardData.flow) ? cardData.flow : null;
    validateCardFlow(flow, stepIdSet, problems);
    if (problems.length > 0) {
        throw new Error(`卡片校验失败：${problems.join('；')}。合法步骤类型仅限 ${CARD_STEP_TYPES.join('/')}，请调用 manage_card action=rules 查看完整规范后修正再写入。`);
    }
    if (!agentSocketText(cardData.website) && !hasCardEntryNavigation(steps, flow)) {
        throw new Error('卡片缺少入口地址：请填写顶层 website，或把第一步设为 navigate（含 url）。');
    }
}

function getPayloadValue(payload, names) {
    const source = payload && typeof payload === 'object' ? payload : {};
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined) {
            return source[name];
        }
    }
    return undefined;
}

const AGENT_TOOL_ERROR_PATTERNS = [
    ['NAVIGATION_TIMEOUT', /页面加载超时|navigation.{0,20}timeout/i],
    ['WAIT_TIMEOUT', /等待.{0,30}超时|wait.{0,30}timeout/i],
    ['TOOL_TIMEOUT', /超时|timeout/i],
    ['NETWORK_ERROR', /failed to fetch|network|网络|ERR_(?:CONNECTION|NAME|INTERNET|PROXY|TIMED_OUT)/i],
    ['CARD_NOT_FOUND', /未找到自动化卡片|卡片.*不存在/i],
    ['CARD_INVALID', /卡片.*格式|cardData|steps/i],
    ['STOPPED', /停止|stopped|abort/i]
];

function matchesMissingTabError(text) {
    return /标签页|tab/i.test(text) && /未找到|不存在|closed|关闭/i.test(text);
}

function inferAgentToolErrorCode(error, message = '') {
    const explicit = agentSocketText(error && error.errorCode, error && error.code, error && error.stepCode);
    if (explicit) return explicit;
    const text = agentSocketText(message, error && error.message, error);
    if (matchesMissingTabError(text)) return 'TAB_NOT_FOUND';
    const matched = AGENT_TOOL_ERROR_PATTERNS.find((entry) => entry[1].test(text));
    return matched ? matched[0] : 'TOOL_EXECUTION_ERROR';
}

function appendAgentFailureContext(result, error, failure, cardId) {
    if (cardId) result.cardId = cardId;
    if (error && error.execution) result.execution = error.execution;
    if (!failure) return result;
    Object.assign(result, {
        stepIndex: failure.stepIndex,
        stepTotal: failure.stepTotal,
        stepName: failure.stepName,
        stepType: failure.stepType,
        selector: failure.selector,
        attempts: failure.attempts,
        failureSnapshot: failure.failureSnapshot || null
    });
    return result;
}

function buildAgentToolFailureResult(error, task = {}) {
    const message = agentSocketText(error && error.message, error, '浏览器工具执行失败');
    const failure = error && error.failure && typeof error.failure === 'object' ? error.failure : null;
    const errorCode = agentSocketText(failure && failure.errorCode, inferAgentToolErrorCode(error, message));
    const args = task && task.args || {};
    const cardId = agentSocketText(args.id, args.card_id, args.cardId);
    const result = {
        success: false,
        error: message,
        errorReason: message,
        errorCode,
        phase: agentSocketText(error && error.phase, failure ? 'step_failed' : 'tool_execution'),
        tool: agentSocketText(task && task.tool)
    };
    return appendAgentFailureContext(result, error, failure, cardId);
}

function requireStepObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} 必须是步骤对象`);
    }
    return value;
}

function parseCardStepIndex(raw, label, min, max, note = '1-based') {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        throw new Error(`缺少 ${label}`);
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} 必须是 ${min}-${max} 的整数${note ? `（${note}）` : ''}`);
    }
    return value;
}

function getStepEditSummary(action, cardName, stepIndex, toStepIndex, stepCount) {
    const name = String(cardName || '').trim() || '自动化卡片';
    if (action === 'insert_step') {
        return `已在 ${name} 插入第 ${stepIndex} 步（现共 ${stepCount} 步）`;
    }
    if (action === 'delete_step') {
        return `已删除 ${name} 第 ${stepIndex} 步（现共 ${stepCount} 步）`;
    }
    if (action === 'move_step') {
        return `已移动 ${name} 第 ${stepIndex} 步到第 ${toStepIndex} 步（现共 ${stepCount} 步）`;
    }
    return `已更新 ${name} 第 ${stepIndex} 步（现共 ${stepCount} 步）`;
}

function patchCardStep(steps, payload, rawAction) {
    const stepIndex = parseCardStepIndex(
        getPayloadValue(payload, ['step_index', 'stepIndex', 'index']),
        'step_index', 1, steps.length
    );
    const replace = rawAction === 'replace_step' || payload.replace === true;
    const patch = requireStepObject(
        getPayloadValue(payload, ['stepPatch', 'step_patch', 'patch', 'stepData', 'step']),
        replace ? 'stepData' : 'stepPatch'
    );
    const index = stepIndex - 1;
    const step = replace ? { ...patch } : { ...steps[index], ...patch };
    steps[index] = step;
    return { stepIndex, toStepIndex: 0, step, deletedStep: null };
}

function insertCardStep(steps, payload) {
    const step = { ...requireStepObject(
        getPayloadValue(payload, ['stepData', 'step', 'stepPatch', 'step_patch']),
        'stepData'
    ) };
    const rawIndex = getPayloadValue(payload, ['step_index', 'stepIndex', 'index', 'position']);
    const rawAfter = getPayloadValue(payload, ['insert_after', 'insertAfter', 'after_step', 'afterStep']);
    let stepIndex = steps.length + 1;
    if (rawIndex !== undefined && rawIndex !== null && String(rawIndex).trim() !== '') {
        stepIndex = parseCardStepIndex(rawIndex, 'step_index', 1, steps.length + 1);
    } else if (rawAfter !== undefined && rawAfter !== null && String(rawAfter).trim() !== '') {
        stepIndex = parseCardStepIndex(rawAfter, 'insert_after', 0, steps.length, '0 表示开头') + 1;
    }
    steps.splice(stepIndex - 1, 0, step);
    return { stepIndex, toStepIndex: 0, step, deletedStep: null };
}

function deleteCardStep(steps, payload) {
    const stepIndex = parseCardStepIndex(
        getPayloadValue(payload, ['step_index', 'stepIndex', 'index']),
        'step_index', 1, steps.length
    );
    const deletedStep = steps.splice(stepIndex - 1, 1)[0] || null;
    return { stepIndex, toStepIndex: 0, step: null, deletedStep };
}

function moveCardStep(steps, payload) {
    const stepIndex = parseCardStepIndex(
        getPayloadValue(payload, ['step_index', 'stepIndex', 'from_step', 'fromStep', 'from']),
        'step_index', 1, steps.length
    );
    const toStepIndex = parseCardStepIndex(
        getPayloadValue(payload, ['to_step_index', 'toStepIndex', 'to_step', 'toStep', 'to']),
        'to_step_index', 1, steps.length
    );
    const step = steps.splice(stepIndex - 1, 1)[0] || null;
    steps.splice(toStepIndex - 1, 0, step);
    return { stepIndex, toStepIndex, step, deletedStep: null };
}

function applyCardStepEdit(steps, payload, action, rawAction) {
    if (action === 'patch_step') return patchCardStep(steps, payload, rawAction);
    if (action === 'insert_step') return insertCardStep(steps, payload);
    if (action === 'delete_step') return deleteCardStep(steps, payload);
    if (action === 'move_step') return moveCardStep(steps, payload);
    return { stepIndex: 0, toStepIndex: 0, step: null, deletedStep: null };
}

function buildEditedCardResult(saved, values) {
    const result = {
        action: values.action,
        id: saved.selectedId,
        cardName: values.cardName,
        stepIndex: values.stepIndex,
        stepCount: values.stepCount,
        summary: getStepEditSummary(
            values.action,
            values.cardName,
            values.stepIndex,
            values.toStepIndex,
            values.stepCount
        )
    };
    if (values.toStepIndex) result.toStepIndex = values.toStepIndex;
    if (values.step) result.step = values.step;
    if (values.deletedStep) result.deletedStep = values.deletedStep;
    return result;
}

async function editCardStep(payload, action, rawAction = action) {
    const state = await loadCardCacheState();
    const targetId = String(payload.id || '').trim() || state.selectedId;
    const entry = state.items.find((item) => item.id === targetId);
    if (!entry) {
        throw new Error(targetId ? `未找到自动化卡片: ${targetId}` : '当前没有已保存的自动化卡片');
    }

    const sourceSteps = Array.isArray(entry.cardData && entry.cardData.steps) ? entry.cardData.steps : [];
    const nextCardData = { ...entry.cardData, steps: [...sourceSteps] };
    const steps = nextCardData.steps;
    const { stepIndex, toStepIndex, step, deletedStep } = applyCardStepEdit(steps, payload, action, rawAction);

    validateCardDataForWrite(nextCardData);
    const saved = await saveCardCacheState(nextCardData, targetId);
    const savedCardData = saved && saved.cardData ? saved.cardData : nextCardData;
    const stepCount = Array.isArray(savedCardData.steps) ? savedCardData.steps.length : steps.length;
    const cardName = String(savedCardData.name || entry.cardName || '').trim();
    return buildEditedCardResult(saved, {
        action, cardName, deletedStep, step, stepCount, stepIndex, toStepIndex
    });
}

// ── 工具目录（上报给服务器，AI 据此调用）────────────────────────────────────
// 卡片相关能力统一为唯一入口 manage_card（管理 + 执行合一）；旧工具名
// get_status / run_card / write_card 仍在执行侧兼容（服务器可能缓存旧 toolDefs）。
// 服务器存储这些 schema 并在 mcp.list_tools / describe_tool 中呈现。
