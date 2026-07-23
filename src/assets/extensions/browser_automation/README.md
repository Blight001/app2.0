# AI自动化插件（Browser Automation）

一个基于 Chrome Manifest V3 的浏览器扩展，用于浏览器任务的自动化执行，并可自动接入本机 **AI-FREE** 的「AI 控制」。插件无需单独登录；多个浏览器插件连接会在软件中分开显示，可多选后由 AI 按浏览器 ID 或名称分开控制。

支持自动化卡片定义、本地执行自动化流程、Cookie 抓取、页面截图，以及把上述能力作为工具暴露给软件内选定的 AI 对话。

## 主要功能

- **自动化卡片**：可视化编辑自动化步骤，支持：
  - 固定或随机数据生成
  - 弹窗处理规则
  - 流程图编辑（节点拖拽、连线、true/false 分支）
  - 步骤导航（点击、输入、等待、判断分支、脚本执行等）
  - 循环执行模式
  - 缓存保存 / 导出 / 导入

### 自动化卡片完整工作流

1. **导入**：点击“导入卡片”并选择文件后立即解析、写入本地缓存并选中最后导入的卡片，不需要先点击执行。支持一次选择多个文件。
2. **管理**：缓存列表展示卡片名称、步骤数、保存时间和当前选中状态；点击卡片切换，支持导出、删除及打开侧边栏编辑。
3. **编辑**：侧边栏可编辑卡片信息、步骤字段和流程图，保存后同步回同一份本地缓存。
4. **执行**：支持单次执行、循环执行、停止、失败后从断点继续，以及运行前覆盖输入变量。
5. **同步**：弹窗、侧边栏、后台执行器和 AI `manage_card` 工具共用卡片缓存；任一入口更新后，已打开的卡片列表会自动刷新。

导入格式兼容：单张卡片对象、卡片数组、`{ "cards": [...] }`、缓存备份 `{ "items": [{ "cardData": ... }] }`，以及 `manage_card get` 返回的 `{ "cardData": ... }`。单张损坏的历史缓存会被跳过，不再阻断其余卡片加载。

- **Cookie 抓取**：
  - 一键抓取当前页面的 Cookie、localStorage、sessionStorage
  - 支持账号/密码/备注/卡片密钥关联
  - 本地缓存历史凭证 / 导出凭证数据

- **本地执行**：无需后端，在浏览器扩展环境中直接运行自动化流程。

- **AI-FREE 本机控制**：自动连接 `http://127.0.0.1:18765` 本机桥接，在软件「AI 控制」中选择当前浏览器后，AI 可调用本插件的自动化卡片、页面操作与 Cookie 工具。

- **操作动效**：AI 远程执行页面点击/输入时，在页面上显示手型光标、点击涟漪、输入高亮等可视反馈（可在同步面板的「选项」里开关）。

## 安装方法

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录即可加载（本扩展为纯 JS，无需构建步骤）

## 使用流程（本地）

1. 点击扩展图标打开弹窗。
2. 切换到对应标签页：
   - 自动化卡片：编辑或加载卡片，执行自动化流程
   - Cookie 抓取：捕获并管理凭证
3. 使用「教程」按钮查看使用说明。

## 对接 AI-FREE（无需登录）

本扩展启动后会自动向 AI-FREE 的本机桥接登记工具目录，并通过独立任务队列接受软件 AI 控制页的调用。账号凭据只由 AI-FREE 软件管理，扩展不保存账号、密码或登录令牌。

连接采用版本化的本机 HTTP 会话协议：插件主动 `POST /v1/register`，软件返回
`protocolVersion + connectionId + token` 后插件才显示已连接；随后统一通过
`POST /v1/poll` 完成心跳与任务拉取。会话 401 或网络中断时插件会清理旧凭据并
重新注册；连接旧版软件且 `/v1/poll` 不存在时才回退到 `GET /v1/tasks`。

### 使用步骤

1. 启动 AI-FREE，并加载本扩展。
2. 扩展头部显示「已接入软件」后，打开软件的「AI 控制」。
3. 「浏览器」下拉框默认自动全选所有已连接的插件（新接入的浏览器也会自动加入）；也可手动勾选只控制部分浏览器，点击「不连接浏览器」清空全部勾选。
4. 多个浏览器会作为不同连接分别显示。只勾选一个时工具调用直接派发给它；勾选多个时，软件会给每个插件工具注入 `browser_id` 参数并向 AI 通报各浏览器的名称与连接 ID，AI 通过浏览器 ID 或名称把每次工具调用路由到指定浏览器，实现分开控制。

### 暴露给 AI 的工具

| 分类 | 工具 | 功能说明 |
|------|------|----------|
| 自动化卡片 | `manage_card`   | 卡片唯一入口（管理 + 执行合一）：rules 获取 9 种固定步骤与 `flow.nodes/edges/start`；MCP 不暴露 `external_script` 或 JS 条件，并会在 write、局部编辑和 run 时拒绝任意页面脚本。其余 list/get/write/patch_step/insert_step/delete_step/move_step/delete/run 行为及结构化失败现场保持不变。 |
| 文件与会话 | `browser_download` | 下载 `browser_observe` 发现的 HTTP/HTTPS 链接到 `AI-Workspace`，或用 `save_session` 保存当前页 Cookie + localStorage + sessionStorage |
| 导航与搜索 | `browser_tab`   | 标签页管理与导航：list / switch / replace / navigate / close / back / forward |
| 页面观察 | `browser_observe` | Fork 默认在 Chromium 原生 UI 层显示与返回 `id` 对应的元素边框，不修改网页 DOM；可用 `mark:false` 关闭，`highlight_duration_ms` 调整显示时长 |
| 页面观察   | `browser_observe`    | 感知当前视口的可交互元素、媒体、可见文本与 iframe 边界，返回带 tag/selector/name/placeholder/ariaLabel 等基本信息的 items 列表（含临时 id）；支持用 selector/text 定位构造卡片步骤或 ref 快速操作，便于卡片创建/修改与表单信息填入 |
| 页面观察   | `browser_screenshot` | 截取当前标签页可视区、完整页面、指定元素或坐标区域，返回可供 AI 视觉分析和发送给用户的图片 dataUrl |
| 页面交互   | `browser_action`     | 点击 / 双击 / 右键 / 滚动 / 输入文本 / 键盘按键的聚合工具。click/type 成功回执附 `cardStep`（与卡片规范同构的步骤对象），browser_tab navigate/replace、browser_wait 同理——AI 探索验证通过后直接把各步 cardStep 拼进 `manage_card write` 即可固化成卡片 |
| 页面交互   | `browser_wait`       | 等待某个 CSS selector 出现，或固定等待一段时间 |

`browser_observe` 超过 `limit` / `max_items` 时默认返回截断后的真实 `items` 并设置
`truncated=true`，避免复杂页面因条目过多而表现为观察内容为空。只有显式传
`allow_truncate:false` 时才只返回分类统计与筛选提示。
可见链接、图片、视频和音频的 HTTP(S) 资源会同时出现在 item 的 `downloadUrl`
与顶层 `downloadLinks` 中，可直接作为 `browser_download action=download` 的 `url`。
item 会尽可能通过 `download` 属性、URL 查询参数或路径推导 `downloadFilename`；
顶层同时返回 `downloadLinkCount`，`downloadLinks[].filename` 保留对应文件名。
调用 `browser_download` 下载媒体时应把条目的 `category` 传入 `media_type`；
图片、视频和音频默认优先使用当前 Chromium Profile 原生下载，以继承登录态、代理和站点网络环境。
`directory` 只能指定 AI 工作区内子目录。

工具 schema 在设备登记时上报给服务器，由服务器在 `mcp.list_tools` / `describe_tool` 中呈现，无需服务端硬编码。

> AI-FREE Chromium Fork 中，`browser_observe`、`browser_screenshot`、`browser_action`、
> `browser_wait` 以及 Cookie/Storage 读取优先经受认证 Runtime Bridge 在浏览器进程执行；
> 不再常驻注入内容脚本，也不再修改页面主世界的 `Element.prototype.attachShadow`。
> 脚本兼容回退默认关闭。只有用户在插件连接选项中显式开启后，才会按需申请 `scripting/cookies/downloads` 与 HTTP/HTTPS 页面权限；关闭时同步撤销。
> 内置 Chromium 的点击使用浏览器 UI 层可见虚拟指针：页面 DOM 不会出现光标节点，
> 覆盖层不拦截事件，也不会移动 Windows 全局鼠标；`content/fx.js` 只服务于外部 Chrome 回退。
> 原生 `browser_observe` 扫描主文档、同源（含嵌套）iframe 与开放 Shadow DOM，
> 识别 img/video/audio 媒体元素及 `cursor:pointer` / 类名或 ID 以 btn/button/link 结尾的自定义控件，
> 并支持 `frame`/`frame_path` 钻取单个 iframe；跨域 iframe 内部仍不可访问。
> observe 现返回元素基本信息（tag/selector/attrs），AI 推荐用 selector/text 进行卡片步骤定位（不再依赖临时 id），便于自动化卡片的修改和创建。
> 原生截图读取 Chromium RenderWidget Surface；外部 Chrome 回退使用 `captureVisibleTab`
> 与 offscreen canvas 分片拼接。原生执行逻辑见 `ai_free_page_automation.cc`，扩展回退见
> `background/10_browser_tools.js`、`background/11_browser_screenshot.js` 与 `content/observe*.js`。

## 项目结构

```
browser_automation/
├── background.js               # importScripts 入口
├── offscreen.html / offscreen.js # MV3 常驻保活文档：定时唤醒 SW，维护本机桥接连接
├── background/
│   ├── 00_core.js
│   ├── 01_state.js
│   ├── 02_sidebar_page.js      # 页面动作执行器（executePageAction，含动效挂钩）
│   ├── 03_formatting.js
│   ├── 04_cache.js
│   ├── 06_automation_run.js
│   ├── 07_events.js
│   ├── 08_agent_settings.js    # 本机桥接设置（不含账号认证）
│   ├── 09_agent_socket.js      # AI-FREE 本机连接 / 设备登记 / task 调度
│   ├── 09_agent_connection.js  # 注册成功才上线的版本化会话 / poll 状态机
│   ├── 10_browser_tools.js     # browser_tab/observe/action/wait 工具封装
│   └── 11_browser_screenshot.js # browser_screenshot 可视区/分片拼接截图
├── content/
│   ├── shadow-patch.js         # 历史兼容文件；Manifest 不再自动注入
│   ├── fx.js                   # 页面操作动效（手型光标 / 点击涟漪 / 输入高亮）
│   └── observe.js              # 页面观察与交互底座（window.__hsObserve，供 10_browser_tools.js 调用）
├── cursors/
│   └── hand.png                # 动效手型光标资源
├── popup.html / popup.js / popup.css
├── popup/
│   ├── bootstrap.js
│   ├── agent-account.js        # AI-FREE 本机连接状态 / 选项
│   ├── automation-workbench.js
│   ├── automation-flow.js
│   └── ...
├── manifest.json
└── icons（icon16/32/48/128.png, icon.ico）
```

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript (ES Modules)
- Chrome APIs: 默认仅 storage、tabs、alarms、offscreen 与 `127.0.0.1` 桥接；cookies、scripting、downloads 及 HTTP/HTTPS 页面访问为显式兼容模式可选权限
- 本机 HTTP 轮询桥接用于与 AI-FREE 通信（仅监听 `127.0.0.1`）

## 注意事项

- 本工具仅供学习和自动化测试使用，请遵守目标网站的服务条款。
- 部分网站的反爬/验证码机制可能需要额外适配。
- 数据均存储在浏览器本地 storage 中；敏感凭证请谨慎处理。
- 插件不存储 AI-FREE 的登录账号、密码或令牌；本地仅保存浏览器名称、桥接地址与动效选项。

## 开发

修改代码后，在扩展管理页点击「重新加载」即可热更新。
