const EFFECTIVE_AGENT_TOOL_DEFS = [
        {
            name: 'manage_card',
            description: '自动化卡片唯一入口（管理 + 执行合一）。action=rules 返回卡片步骤类型（10 种 type，含 condition 判断分支）与 flow 流程图结构（nodes/edges/start）、运行规则（失败重试、变量输入、需显式 save_cookies 步骤保存 Cookie 等）——写卡片前必须先调用，字段与步骤类型只能取自规范，不要凭空编造；action=list 列出所有已保存卡片的基本信息；action=get 读取指定卡片完整 JSON；action=write 创建新卡片或用同一个 id 覆盖已有卡片（需完整 cardData）；action=patch_step 合并/替换某一步，insert_step 插入步骤，delete_step 删除步骤，move_step 移动步骤（step_index 均为 1-based，局部编辑后仍会按完整规范校验）；action=delete 删除整张卡片（可用 id/card_name 指定，都省略则删除当前选中卡片）；action=run 在当前活动标签页执行卡片，可用 inputs 覆盖 type 步骤输入，执行中通过 task:progress 及时反馈完整过程。run 失败时返回结构化现场：errorCode、失败步骤 stepIndex/selector、failureSnapshot 与 context；页面停留在失败现场，修复卡片后可用 action=run + start_step=stepIndex 续跑。',
            input_schema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: [...CARD_MANAGE_ACTIONS], description: 'rules 获取步骤类型与运行规则（写卡片前必看）；list 列出全部卡片；get 读取卡片完整 JSON；write 写入/覆盖完整卡片；patch_step 修改某一步；insert_step 插入步骤；delete_step 删除步骤；move_step 移动步骤；delete 删除整张卡片；run 执行卡片。' },
                    id: { type: 'string', description: '目标卡片 id：get/run/patch_step/insert_step/delete_step/move_step/delete 省略时用当前选中卡片；write 省略时按卡片名新建（同名覆盖）；rules/list 忽略。' },
                    card_name: { type: 'string', description: '可选：action=delete 时可按卡片名删除；存在同名卡片时必须改用 id。' },
                    cardData: { type: 'object', description: '完整卡片 JSON（至少含 name/website/steps；如需分支则包含 flow.nodes/flow.edges/flow.start），仅 action=write 需要；格式必须严格遵循 action=rules 返回的规范。' },
                    step_index: { type: 'number', description: '局部步骤编辑使用，1-based。patch_step/delete_step/move_step 表示目标步骤；insert_step 表示插入到第 N 步之前，省略则追加，允许传 steps.length+1 追加。' },
                    to_step_index: { type: 'number', description: '仅 action=move_step 使用，1-based，表示移动后的目标位置。' },
                    insert_after: { type: 'number', description: '仅 action=insert_step 使用，表示插到第 N 步之后；0 表示开头。若同时传 step_index，优先使用 step_index。' },
                    stepData: { type: 'object', description: 'insert_step 要插入的完整步骤对象；patch_step 在 replace=true 时作为替换步骤，也兼容作为待合并补丁。' },
                    stepPatch: { type: 'object', description: 'patch_step 的局部字段补丁，会浅合并到原步骤；也兼容参数名 patch/step。' },
                    replace: { type: 'boolean', description: '仅 action=patch_step 使用；true 时用 stepData/stepPatch 替换整步，默认 false 为浅合并。' },
                    inputs: { type: 'object', description: '可选：action=run 时按「变量键→值」覆盖对应 type 步骤的输入文本。每个 type 步骤都是一个变量，键取步骤 variable 字段，未设置则按其在全部 type 步骤中的顺序回退为 var1/var2/...；未提供覆盖值时用步骤自身 text 作为默认。也可传数组按序映射 var1..varN。若某变量键为 account/password/email，会同时用于 Cookie 命名与结果。' },
                    account: { type: 'string', description: '可选：兼容别名，等价于 inputs.account（用于名为 account 的变量与 Cookie 命名）。' },
                    password: { type: 'string', description: '可选：兼容别名，等价于 inputs.password（用于名为 password 的变量与 Cookie 命名）。' },
                    email: { type: 'string', description: '可选：兼容别名，等价于 inputs.email（用于名为 email 的变量）。' },
                    start_step: { type: 'number', description: '可选：action=run 时从第 N 步开始执行（1-based，序号与失败结果 stepIndex 一致；卡片 website 自动插入的 navigate 前置步骤算第 1 步）。用于失败修复后续跑：页面停留在失败现场，跳过已成功的步骤直接继续；同时通过 inputs 回传已用到的变量值。' },
                    timeout_seconds: { type: 'number', description: '可选：action=run 的结果等待上限（秒），默认 900。步骤多、等待久的超长卡片可上调（上限 1800）；调用方据此等待，避免长任务被过早判定超时而拿不到完整 execution 明细。' },
                    tab_id: { type: 'number', description: '可选：action=run 时指定真实网页标签页；省略时使用最近 switch/navigate/replace 的操作目标。' }
                },
                required: ['action']
            }
        },
        {
            name: 'save_cookies',
            description: '抓取当前活动标签页的 Cookie、localStorage、sessionStorage，默认保存为本地 JSON 文件；若提供 server_url 会额外把数据 POST 到该地址。若 save_to_server=true（推荐给 AI 使用），则将完整数据返回服务器，服务器会自动保存到该 AI 对应的工作目录（cookies/ 子文件夹）中，返回的 result 只保留元数据与保存路径，不含原始 Cookie 内容。',
            input_schema: {
                type: 'object',
                properties: {
                    account: { type: 'string', description: '可选：关联账号，用于文件命名。' },
                    password: { type: 'string', description: '可选：关联密码，用于文件命名。' },
                    server_url: { type: 'string', description: '可选：抓取结果额外 POST 上传的服务器地址。' },
                    card_key: { type: 'string', description: '可选：随上传附带的卡密/凭证标识。' },
                    save_to_server: { type: 'boolean', description: 'AI 调用时设为 true：将抓取的完整 Cookie 数据随任务结果返回服务器，由服务器持久化保存到对应 AI 的目录（cookies/ 下）。不回传原始内容到聊天记录。' },
                    tab_id: { type: 'number', description: '可选：指定要抓取的真实网页标签页；省略时使用最近操作目标。' }
                }
            }
        },
        // ── 导航与搜索 ─────────────────────────────────────────────────────
        {
            name: 'browser_tab',
            description: '浏览器标签页与导航管理：列出已打开页面、切换标签、在当前页覆盖跳转、新标签打开链接、关闭标签、前进后退。动作仅 7 种：list 获取全部页面及当前激活页；switch 切换到已有 tab_id；replace 在当前页（或 tab_id）覆盖跳转到 url；navigate 在新标签页打开 url；close 关闭标签；back/forward 历史导航。流程：先 list，目标页已开则 switch，要在当前页改地址用 replace，并行任务用 navigate。navigate/replace 成功回执附 cardStep（navigate 步骤对象），可直接拼进自动化卡片 steps。',
            input_schema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'switch', 'replace', 'navigate', 'close', 'back', 'forward'], description: 'list 列出全部标签并返回 activeTab；switch 切换到 tab_id（不改 URL）；replace 在当前/指定标签覆盖跳转到 url；navigate 在新标签打开 url；close 关闭 tab_id（默认当前标签）；back/forward 后退/前进一步。' },
                    url: { type: 'string', description: 'action=replace / navigate 时要打开的 URL（缺协议时按 https 补全）。' },
                    tab_id: { type: 'number', description: 'action=switch 必填；action=close/replace/back/forward 可选，指定目标标签，默认当前活动标签。' },
                    tabId: { type: 'number', description: 'tab_id 的兼容别名。' },
                    id: { type: 'number', description: 'tab_id 的兼容别名。' }
                },
                required: ['action']
            }
        },
        // ── 页面观察 ───────────────────────────────────────────────────────
        {
            name: 'browser_observe',
            description: '感知当前视口里用户能看到的内容：返回 items 单一混排列表（按位置排序、已去重），kind=interactive 是最顶层、未被遮挡的按钮/链接/输入框/下拉/菜单项等（每项带临时 id + tag/selector/name/placeholder/ariaLabel/value/optionsSample 等基本信息），kind=text 是普通可见文本，kind=media 是图片/视频/音频（category=image/video/audio，不可点击），kind=frame 是页面内 iframe 边界（accessible=true 表示同源已扫描，其子元素以 inFrame=true 的 interactive 返回）。会扫描主文档、同源（含嵌套）iframe 内部内容以及 Shadow DOM（开放与被强制开放的封闭 root），并识别 img/video/audio 媒体元素；跨域 iframe 内部仍不可访问。除固定的按钮/链接/表单控件外，还会识别 cursor:pointer 或类名/ID 以 btn/button/link 结尾的自定义控件。若匹配条目超过 limit/max_items，默认截断并返回上限内的真实 items，同时设置 truncated=true；可用 filter/tag/keyword 缩小范围，也可传 frame（iframe 的 frameSelector）或 frame_path 只观察某个 iframe 内部。默认会在页面上绘制描边标记：绿色=可点击、红色=被遮挡/禁用/不可点、紫色虚线=iframe 边界。用途：点击/输入前的首选观察手段 + 卡片信息收集。场景：observe 后优先使用返回的 selector 或 text+tag 构造自动化卡片步骤（持久化推荐）；ref 可用于临时 browser_action 操作；页面变化后重新 observe（id 只在下一次 observe 前有效）。',
            input_schema: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: '最多返回的可交互元素条目数；超过时截断并设置 truncated=true。默认 120，最大 200。' },
                    max_items: { type: 'number', description: '最终 items 混排列表允许返回的最大总条数；超过时截断并设置 truncated=true。默认约等于 limit + text_limit + 40，最大 500。' },
                    filter: {
                        type: ['string', 'array'],
                        items: { type: 'string' },
                        description: '按类别筛选，缩小噪音。可传单个字符串、逗号分隔字符串或字符串数组。可选类别：button（按钮）、link（链接）、input（输入框/文本域/可编辑区）、select（下拉框）、checkbox（复选/开关）、radio（单选）、tab（标签页）、menuitem（菜单项）、option（选项）、label（标签元素）、image/video/audio 或 media（媒体）、text（普通可见文本）、frame（iframe 边界）。例：filter:"button" 只看按钮；filter:["input","select"] 只看输入框和下拉框；不传或传 "all" 则返回全部。'
                    },
                    frame: { type: 'string', description: '只观察某个同源 iframe 内部：传 browser_observe 返回的该 frame 的 frameSelector。用于整页 items 过多时钻取单个 iframe（如内嵌编辑器）。' },
                    frame_path: { type: 'array', items: { type: 'string' }, description: 'frame 的多级形式：从外到内的 iframe frameSelector 数组，用于嵌套 iframe 定位。' },
                    tag: { type: ['string', 'array'], items: { type: 'string' }, description: '按 HTML 标签名进一步筛选，如 "button"、"a"、"input"，也可传数组或逗号分隔字符串。' },
                    tags: { type: ['string', 'array'], items: { type: 'string' }, description: 'tag 的别名。' },
                    keyword: { type: 'string', description: '按关键词筛选，匹配可见文本、aria-label/title、name/id、href 等常用字段；也兼容 query/text_filter。' },
                    query: { type: 'string', description: 'keyword 的兼容别名。' },
                    text_filter: { type: 'string', description: 'keyword 的兼容别名。' },
                    include_text: { type: 'boolean', description: '是否同时包含普通可见文本（items 中 kind=text 的条目）。默认 true；传 false 时只返回可交互元素。' },
                    text_limit: { type: 'number', description: '最多返回的普通可见文本条数。默认 200，最大 500。' },
                    allow_truncate: { type: 'boolean', description: '是否在超过 limit/max_items 时截断并返回内容，默认 true。显式传 false 时只返回 tooMany/categoryCounts 和筛选提示。' },
                    mark: { type: 'boolean', description: '是否在页面上绘制状态色描边标记，便于随后截图查看。默认 true；传 false 只清除已有标记、不重绘。标记为纯视觉叠加，不影响其他工具或点击。' },
                    tab_id: { type: 'number', description: '可选：指定要观察的真实网页标签页；省略时使用最近操作目标。' }
                }
            }
        },
        // ── 页面交互 ───────────────────────────────────────────────────────
        {
            name: 'browser_action',
            description: '页面交互聚合工具：用 action 指定要做的动作——点击 click（单击）、双击 double_click、右键 right_click、滚动 scroll、输入文本 type、键盘按键 press_key。定位优先级：selector（observe 返回的稳定 CSS）或 text > ref（临时 id，仅本次有效） > 坐标；非坐标点击会先做遮挡检测，被遮挡时返回 occluded 诊断。\n' +
                '· click / double_click / right_click：内容脚本解析视口坐标后，经软件主进程和 Chromium Runtime Bridge 派发浏览器内核鼠标事件；不移动 Windows 全局鼠标、不要求软件窗口位于前台，并遵循页面正常命中测试，不能穿透遮挡层。\n' +
                '· scroll：滚动页面，返回滚动前后位置与移动像素数。\n' +
                '· type：向 input/textarea/可编辑区输入文本（单字段；多字段请多次 type）；submit:true 时优先调用所在表单的 requestSubmit()（合成键盘事件不会触发浏览器原生 Enter 提交，这里用等效方式兜底）。\n' +
                '· press_key：在焦点元素或指定 selector 上派发合成键盘事件，可带 Ctrl/Shift/Alt/Meta 修饰键；同样不是 CDP trusted 事件，按 Enter 时会尝试兜底 requestSubmit()。\n' +
                '用途：统一的点击/滚动/输入/键盘入口。场景：先 browser_observe 获取元素基本信息（含 selector），用 selector/text 构造卡片步骤或用 ref 做临时 browser_action；页面变化后自行再 observe。\n' +
                '· cardStep 回执：click（单击）/type 成功后返回 cardStep 字段——与自动化卡片规范同构的步骤对象（name/type/selector[/text]，selector 为稳定 CSS）。探索验证通过后直接把各步 cardStep 按顺序拼进 manage_card write 的 steps 即可固化为卡片；text 值按需替换为 {account}/{password}/{email}/{code} 模板。cardStep.inFrame=true 表示元素在 iframe 内（卡片 runner 只查主文档，勿直接写入，见 cardStepNote）。',
            input_schema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'scroll', 'type', 'press_key'], description: '要执行的交互动作。' },
                    ref: { type: ['number', 'string'], description: 'browser_observe 返回的元素临时 id（click/double_click/right_click/type 均可用）；仅本次 observe 有效。优先推荐使用 observe 返回的 selector 或 text（现包含 tag/name/placeholder 等基本信息），适合构造持久化自动化卡片步骤。' },
                    selector: { type: 'string', description: '目标元素的 CSS selector（click/double_click/right_click 定位；type 指定输入框；press_key 指定先聚焦的元素；scroll 可指定滚动进视口的元素）。' },
                    text: { type: 'string', description: 'action=click/double_click/right_click 时用可见文本定位元素；action=type 时为「要输入的文本」。' },
                    x: { type: 'number', description: 'click/double_click/right_click 的 X 坐标（像素，视口坐标）。' },
                    y: { type: 'number', description: 'click/double_click/right_click 的 Y 坐标（像素，视口坐标）。' },
                    force: { type: 'boolean', description: '兼容参数；Chromium 内核点击始终遵循正常命中测试，被遮挡时不会穿透点击。' },
                    direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'action=scroll 的方向：up 上、down 下、top 到顶、bottom 到底。' },
                    amount: { type: 'number', description: 'action=scroll 的滚动像素数。默认 400。' },
                    clear_first: { type: 'boolean', description: 'action=type 时输入前先清空字段。默认 true。' },
                    submit: { type: 'boolean', description: 'action=type 时输入后尝试提交所在表单。' },
                    key: { type: 'string', description: 'action=press_key 的键名，如 "Enter"、"Escape"、"Tab"、"ArrowDown"、"a"。' },
                    ctrl: { type: 'boolean', description: 'action=press_key 时按住 Ctrl。' },
                    shift: { type: 'boolean', description: 'action=press_key 时按住 Shift。' },
                    alt: { type: 'boolean', description: 'action=press_key 时按住 Alt。' },
                    meta: { type: 'boolean', description: 'action=press_key 时按住 Meta/Cmd。' },
                    tab_id: { type: 'number', description: '可选：指定要交互的真实网页标签页；省略时使用最近操作目标。' }
                },
                required: ['action']
            }
        },
        {
            name: 'browser_wait',
            description: '等待某个 CSS selector 出现，或固定等待一段时间。用途：等待页面/元素就绪后再操作。场景：等异步加载的按钮出现、等动画结束、给页面留出渲染时间。selector 命中成功时回执附 cardStep（wait 步骤对象），可直接拼进自动化卡片 steps。',
            input_schema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: '等待出现的 CSS 元素。' },
                    ms: { type: 'number', description: '固定等待的毫秒数（不传 selector 时使用；默认 1000）。' },
                    tab_id: { type: 'number', description: '可选：指定要等待的真实网页标签页；省略时使用最近操作目标。' }
                }
            }
        },
];

function effectiveAgentToolDefs() {
    return EFFECTIVE_AGENT_TOOL_DEFS;
}

// ── 状态广播（推送给已打开的 popup）──────────────────────────────────────────
function agentStatePayload() {
    return {
        status: agentStatus,
        boundAiConfigId: agentBoundAiConfigId,
        lastErrorReason: agentLastErrorReason || ''
    };
}

function broadcastAgentStatus() {
    // popup 可能未打开；忽略「无接收方」错误。
    try {
        chrome.runtime.sendMessage({ type: 'agent:status', ...agentStatePayload() }).catch(() => {});
    } catch (_error) {}
}

function setAgentStatus(status, reason) {
    agentStatus = status;
    if (reason != null) {
        agentLastErrorReason = String(reason);
    } else if (status !== 'error') {
        agentLastErrorReason = '';
    }
    if (status !== 'enrolled' && status !== 'connected') {
        agentBoundAiConfigId = null;
    }
    const badgeColors = {
        disconnected: '#787878',
        connecting: '#f59e0b',
        connected: '#6366f1',
        enrolled: '#22c55e',
        error: '#ef4444'
    };
    try {
        chrome.action.setBadgeBackgroundColor({ color: badgeColors[status] || '#787878' });
        chrome.action.setBadgeText({ text: status === 'enrolled' ? '●' : status === 'error' ? '!' : '' });
        chrome.action.setTitle({ title: `AI自动化插件 — ${status}${reason ? `（${reason}）` : ''}` });
    } catch (_error) {}
    broadcastAgentStatus();
}

// ── 机器码 ──────────────────────────────────────────────────────────────────
async function getAgentMachineId() {
    if (agentMachineId) {
        return agentMachineId;
    }
    const stored = await chrome.storage.local.get('_agent_mid');
    if (stored && stored._agent_mid) {
        agentMachineId = stored._agent_mid;
        return agentMachineId;
    }
    const id = `ba-${Math.random().toString(36).slice(2, 10)}`;
    await chrome.storage.local.set({ _agent_mid: id });
    agentMachineId = id;
    return id;
}

function parseAiConfigId(raw) {
    const n = typeof raw === 'number' ? raw : (raw != null && String(raw).trim() !== '' ? Number(raw) : null);
    return Number.isFinite(n) ? n : null;
}

async function getAgentBrowserProcessId() {
    if (agentBrowserProcessId) {
        return agentBrowserProcessId;
    }
    if (!chrome.processes || typeof chrome.processes.getProcessInfo !== 'function') {
        return 0;
    }
    try {
        const processInfo = await chrome.processes.getProcessInfo([], false);
        const processes = Array.isArray(processInfo) ? processInfo : Object.values(processInfo || {});
        const browserProcess = processes
            .find((process) => String(process && process.type || '').toLowerCase() === 'browser');
        agentBrowserProcessId = Number(browserProcess && browserProcess.osProcessId || 0) || 0;
        return agentBrowserProcessId;
    } catch (_error) {
        return 0;
    }
}

// ── 设备登记 ────────────────────────────────────────────────────────────────────
async function emitAgentEnrollOn(socket) {
    const settings = await getAgentSettings();
    if (settings.offlineMode) {
        return;
    }
    const id = settings.deviceId || await getAgentMachineId();
    const browserProcessId = await getAgentBrowserProcessId();
    agentCurrentId = id;
    const toolDefs = effectiveAgentToolDefs();
    socket.emit(DEVICE_ENROLL, {
        id,
        browserProcessId,
        // AI 会在软件控制页按连接选择，因此插件登记时不绑定固定模型。
        aiConfigId: null,
        name: settings.agentName || 'AI自动化浏览器',
        group: settings.agentGroup || '',
        platform: `browser-extension (${(typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent.split(' ').pop() : 'chrome')})`,
        os: { platform: 'browser', arch: 'unknown', release: AGENT_VERSION, hostname: id },
        capabilities: toolDefs.map((t) => t.name),
        toolDefs,
        version: AGENT_VERSION,
        workspaceRoot: '',
        lifecycle: 'registered',
        isWindowsDesktop: false,
        isBrowserExtension: true
    });
}

async function agentEnroll() {
    const settings = await getAgentSettings();
    if (settings.offlineMode || !agentSocket) {
        return;
    }
    await emitAgentEnrollOn(agentSocket);
}

// ── 连接 ────────────────────────────────────────────────────────────────────
class LocalAutomationBridgeSocket {
    constructor(baseUrl) {
        this.baseUrl = trimUrl(baseUrl);
        this.connected = false;
        this.active = false;
        this.connectionId = '';
        this.token = '';
        this.sessionId = crypto.randomUUID();
        this.listeners = new Map();
        this.pollTimer = null;
        this.io = { reconnection() {} };
    }

    on(event, handler) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(handler);
    }

    fire(event, payload) {
        for (const handler of this.listeners.get(event) || []) {
            try { handler(payload); } catch (_error) {}
        }
    }

    removeAllListeners() {
        this.listeners.clear();
    }

    async request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        const appBrowserToken = getAppBrowserToken();
        if (!appBrowserToken) throw new Error('当前扩展不在 AI-FREE 受信浏览器环境中');
        headers[APP_BROWSER_TOKEN_HEADER] = appBrowserToken;
        headers[APP_BROWSER_PID_HEADER] = String(await getAgentBrowserProcessId());
        if (this.token) headers['X-Bridge-Token'] = this.token;
        if (options.body != null) headers['Content-Type'] = 'application/json';
        const suffix = this.connectionId ? `${path.includes('?') ? '&' : '?'}connection_id=${encodeURIComponent(this.connectionId)}` : '';
        const response = await fetch(`${this.baseUrl}${path}${suffix}`, {
            ...options,
            headers,
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.message || `本机桥接 HTTP ${response.status}`);
        return data;
    }

    async connect() {
        if (this.connected || this.active) return;
        this.active = true;
        this.connected = true;
        this.active = false;
        this.fire('connect');
    }

    disconnect() {
        const wasConnected = this.connected;
        const connectionId = this.connectionId;
        const token = this.token;
        this.connected = false;
        this.active = false;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.connectionId = '';
        this.token = '';
        if (connectionId && token) {
            const url = `${this.baseUrl}/v1/disconnect?connection_id=${encodeURIComponent(connectionId)}`;
            void fetch(url, {
                method: 'POST',
                headers: {
                    'X-Bridge-Token': token,
                    [APP_BROWSER_TOKEN_HEADER]: getAppBrowserToken(),
                    [APP_BROWSER_PID_HEADER]: String(agentBrowserProcessId || 0)
                },
                keepalive: true
            }).catch(() => {});
        }
        if (wasConnected) this.fire('disconnect', 'client disconnect');
    }

    emit(event, payload) {
        if (event === DEVICE_ENROLL) {
            void this.register(payload);
        } else if (event === 'task:result') {
            void this.sendOutcome({ ...payload, success: payload?.success !== false });
        } else if (event === 'task:error') {
            void this.sendOutcome({ ...payload, success: false });
        } else if (event === 'task:progress') {
            void this.postProgress(payload);
        }
    }

    async register(payload) {
        try {
            const response = await this.request('/v1/register', {
                method: 'POST',
                body: JSON.stringify({
                    ...payload,
                    instanceId: payload.id,
                    sessionId: this.sessionId
                })
            });
            this.connectionId = String(response.connectionId || '');
            this.token = String(response.token || '');
            this.fire(DEVICE_ENROLLED, { id: this.connectionId, aiConfigId: null });
            this.schedulePoll(0);
        } catch (error) {
            this.connected = false;
            this.fire('connect_error', error);
        }
    }

    schedulePoll(delay = 650) {
        if (!this.connected) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => { void this.poll(); }, delay);
    }

    async poll() {
        if (!this.connected || !this.connectionId) return;
        try {
            const response = await this.request('/v1/tasks');
            for (const task of response.tasks || []) this.fire('task:dispatch', task);
            this.schedulePoll(650);
        } catch (error) {
            this.connected = false;
            this.fire('disconnect', error?.message || '本机桥接已断开');
            this.fire('connect_error', error);
        }
    }

    async sendOutcome(payload) {
        if (!this.connectionId) return;
        await this.request('/v1/task-result', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
    }

    async postProgress(payload) {
        if (!this.connectionId) return;
        await this.request('/v1/task-progress', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
    }
}

// 卡片库由软件桥接统一落盘。这里使用独立的 loopback 请求，不等待 agent
// 工具连接登记完成；否则刚打开的新 Profile 会在登记竞态中退回独立本地存储。
