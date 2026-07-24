# AI-FREE MCP 工具清单

更新时间：2026-07-24

本文档记录当前软件实际向 AI 提供的 MCP 工具。工具分为浏览器窗口管理、绑定软件**纯视觉**控制，以及内置浏览器自动化三组。`software_ui` 仅在当前活动栏目是已停靠外部软件时按需出现，避免为普通对话增加 prompt 成本。

## 总览

| 工具组 | 数量 | 可用条件 | 代码真源 |
| --- | ---: | --- | --- |
| 软件窗口 | 1 | 软件运行期间始终可用 | [`ai-browser-window-tools.js`](../src/app/main/services/ai-browser-window-tools.js) |
| 软件视觉控制 | 1 | 当前活动栏目绑定了可用外部软件窗口 | [`ai-software-ui-tools.js`](../src/app/main/services/ai-software-ui-tools.js) |
| 浏览器自动化 | 7 | 至少有一个 AI-FREE Chromium Runtime 已就绪 | [`native-tool-definitions.js`](../src/app/main/features/browser-automation/native-tool-definitions.js) |

AI-FREE 本地 AI 对话使用下表中的“内部名称”。连接 HeySure 后，设备向服务器注册时会统一添加 `aifree.` 前缀。

| 内部名称 | HeySure 注册名称 | 用途 |
| --- | --- | --- |
| `software_window` | `aifree.software_window` | 通过 `action` 统一查询、打开、新建、编辑和关闭窗口 |
| `software_ui` | `aifree.software_ui` | 通过窗口截图、视觉候选框和系统输入观察并操作当前绑定软件 |
| `manage_card` | `aifree.manage_card` | 管理和运行浏览器自动化卡片 |
| `browser_download` | `aifree.browser_download` | 下载链接文件，或保存当前页面 Cookie/Storage |
| `browser_tab` | `aifree.browser_tab` | 查询、切换、导航和关闭标签页 |
| `browser_observe` | `aifree.browser_observe` | 获取页面中可交互或可见的元素 |
| `browser_screenshot` | `aifree.browser_screenshot` | 截取页面可视区、整页、元素或指定区域 |
| `browser_action` | `aifree.browser_action` | 点击、输入、滚动和发送按键 |
| `browser_wait` | `aifree.browser_wait` | 等待元素出现或等待指定时间 |

## 软件窗口工具

`software_window` 不依赖浏览器扩展连接。原来的 5 个 `software_window_*` 工具已经合并为一个工具，操作后缀改为必填的 `action` 子选项。

### `software_window`

| `action` | 作用 | 主要参数 |
| --- | --- | --- |
| `list` | 列出全部窗口记录，包括未打开的历史窗口 | 可选 `include_settings` 返回脱敏环境配置 |
| `open` | 打开、恢复或切换到已有窗口 | `history_id` 或 `name` |
| `create` | 创建并打开新窗口 | 可选 `name`、`url`、`settings` |
| `edit` | 编辑窗口名称和该窗口的环境配置 | `history_id` 或 `name`；至少提供 `new_name`、`settings` 之一 |
| `close` | 关闭窗口但保留历史记录 | `history_id` 或 `name` |

工具整体标记为破坏性，因为 `create`、`edit` 和 `close` 会改变本地状态；`list` 为只读操作，`open` 只会打开或切换窗口。

#### 环境配置

`settings` 使用增量更新语义：只修改本次传入的字段，其他环境配置保持不变。`create` 可以在创建时传入独立配置；`edit` 可以修改任意已有浏览器的独立配置。

支持的配置包括：

- 系统和内核：`os`、`browserVersion`、`kernelVersion`。
- 代理：`proxy`，包含模式、协议、主机、端口、用户名、密码和代理 API 地址。
- 页面与身份：`homepage`、`ua`、`secChUa`、`language`、`timezone`、`webrtc`、`geolocation`。
- 设备指纹：`resolution`、`fonts`、`canvas`、`webglImage`、`webglMetadata`、`webgpu`、`audioContext`、`clientRects`、`speechVoices`。
- 硬件与安全：`cpu`、`memory`、`deviceName`、`macAddress`、`doNotTrack`、`sslEnabled`、`portScanProtection`、`hardwareAcceleration`、`launchArgs`。

对已打开窗口执行 `edit` 时，默认重启 Chromium 让环境立即生效；传入 `restart: false` 可只保存配置，待下次打开或手动重启时完整生效。未打开窗口的配置会在下次 `open` 时生效。

`list` 默认不返回环境详情。传入 `include_settings: true` 后返回脱敏配置，其中 Cookie 不返回，代理用户名和密码被替换为 `[REDACTED]`，代理 API 地址和启动参数只标记为已配置。

Cookie 属于登录会话数据，不属于 `software_window.settings` 的可编辑字段；应使用 `browser_download` 的 `save_session` 操作在软件本机采集和保存。

## 软件视觉控制（无 UIA）

### `software_ui`

- **不再使用 Windows UI Automation**。观察与定位完全基于窗口截图与视觉候选框。
- 目标固定为当前活动的外部软件栏目，调用参数不接受 HWND 或 PID；原生层每次执行仍会核对绑定 HWND、进程 PID 和 Windows Session。
- `action=observe` / `screenshot`：通过 Windows Graphics Capture 截取绑定窗口（失败时 `PrintWindow` 后备），并在截图上生成轻量 `visual_candidates`（`vref`、框坐标、中心点）。默认最多 24 项。
- 每次观察生成唯一 `observation_id`。截图坐标与 `vref` 只属于该次观察；执行动作后立即失效，并默认返回新的观察状态。
- 操作：`click` / `mouse_click` / `double_click` / `right_click`（`vref` 或 `x/y` + `observation_id`）、`type`、`press_key`、`scroll`、`drag`、`focus`。
- 鼠标与键盘使用 Windows `SendInput`；输入前校验命中窗口属于绑定 PID；遮挡则拒绝。
- 截图与输入在独立 worker 中执行，不阻塞 Electron 主线程。
- 已移除：`accessibility` 模式、UIA `ref`、`invoke` / `set_value` / `toggle` / `select` / `expand` / `collapse` 等语义控件动作。

工具不接受调用方传入 HWND/PID，也不提供全桌面任意点击。所有视觉操作固定在绑定软件窗口及其 owned popup。

## Prompt 与结果预算

- `software_ui` 只在当前活动栏目可控时加入工具目录，普通浏览器和普通聊天不承担该 schema。
- 模型接收精简版 `software_window` schema；完整浏览器环境字段仍由运行时白名单严格校验，压缩不会放宽可写字段。
- MCP 路由提示采用短规则索引，不重复展开工具文档；具体参数以工具 schema 为准。
- `visual_candidates` 最多 24 项；截图作为临时 `image_url` 消息发送，Base64 不写入工具文本、历史消息或工具活动记录；默认最长边限制为 1600×1000，并保留坐标映射。

## 浏览器自动化工具

以下 7 个工具由软件主进程通过受认证 Chromium Runtime Bridge 提供，不再加载浏览器自动化扩展。没有已就绪的 AI-FREE Chromium Runtime 时，它们不会出现在 AI 或 HeySure 的可用工具目录中。

### `manage_card`

- 作用：查询规则，列出、读取、新建、修改、删除和运行自动化卡片，也可增删、移动或修改卡片步骤。
- `action`：必填，可用值为 `rules`、`list`、`get`、`write`、`patch_step`、`insert_step`、`delete_step`、`move_step`、`delete`、`run`、`stop`。
- 常用定位参数：`id`、`card_name`。
- 编辑参数：`cardData`、`step_index`、`to_step_index`、`insert_after`、`stepData`、`stepPatch`、`replace`。
- 运行参数：`inputs`、`start_step`、`loop_count`、`timeout_seconds`。
- 注意：不同 `action` 使用不同参数；`write`、步骤编辑和 `delete` 会修改本地卡片数据。
- 脚本限制：MCP 不公开 `external_script`，也不允许 `condition_mode=js`；写入、局部编辑和运行历史卡片时都会拒绝任意页面脚本。

### `browser_download`

- 作用：`download` 安全下载 HTTP/HTTPS 文件；`save_session` 自动保存当前标签页 Cookie、`localStorage` 和 `sessionStorage`；`info` 返回 AI 工作区路径。软件不提供手动 Cookie 查看、导入、导出或逐项删除界面。
- 默认目录：`download` 写入安装目录下的 `AI-Workspace` 根目录；`save_session` 默认写入 `AI-Workspace/sessions`。
- 子目录：`directory` 只接受 AI 工作区内相对路径，例如 `downloads/models`；拒绝绝对路径、`..` 逃逸和指向工作区外的链接目录。
- 下载参数：`url`、`filename`、`media_type`、`use_cookies`、`overwrite`、`timeout_ms`、`max_bytes`。媒体下载应将 `browser_observe` 返回的媒体类型传给 `media_type`。
- 会话参数：`filename`、`directory`、`overwrite`。保存结果只返回路径和 Cookie 数量，不把 Cookie 原文放入聊天结果。
- Cookie 规则：`use_cookies` 默认开启，但只发送与目标 URL 域名、路径、Secure 属性和有效期匹配的 Cookie；重定向后会重新匹配，不向其它域泄漏。
- 网络边界：禁止 localhost、`.local`、IPv4/IPv6 私网、链路本地、组播和保留地址。每次重定向都重新解析，并将实际连接固定到已审核 IP，防止 DNS 重绑定。
- 写入规则：先写同目录随机 `.part` 文件，再原子提交；默认不覆盖同名文件。默认大小上限 250 MiB、硬上限 1 GiB。

### `browser_tab`

- 作用：管理当前浏览器窗口内的标签页。
- `action`：必填，可用值为 `list`、`switch`、`replace`、`navigate`、`close`、`back`、`forward`。
- 参数：`url`、`tab_id`；同时兼容 `tabId` 和 `id` 作为标签页 ID 别名。

### `browser_observe`

- 作用：读取当前页面中可见的交互元素、文本、媒体和框架信息，为后续操作生成元素引用。
- 数量参数：`limit`、`max_items`。
- 筛选参数：`filter`、`tag`、`tags`、`keyword`、`query`、`text_filter`、`selector`；数组筛选会规范化为逗号分隔值。
- 文本与标记参数：`include_text`、`include_media`、`mark`、`highlight_duration_ms`。
- Fork 原生 Observe 默认在 Chromium UI 层绘制与元素 `id` 对应的边框标签，不写入网页 DOM、不接收鼠标事件；导航、滚动、窗口隐藏或超时后自动清除。最多绘制 120 个标记。
- 路由参数：`tab_id`。
- 下载链接：可见 HTTP/HTTPS 链接会在对应 item 中提供 `downloadUrl`，并汇总到顶层 `downloadLinks`；其中的 `url` 可直接交给 `browser_download`。

### `browser_screenshot`

- 作用：截图并返回 base64 `dataUrl`；默认截取当前标签页可视区。
- 精确截图：`full_page` 截整页；`selector`/`text` 截元素；`clip` 或 `x`、`y`、`width`、`height` 截区域。
- 元素扩展：`margin` 可向四周扩展截图边界。
- 图片参数：`format` 支持 PNG、JPEG、WebP，`quality` 用于 JPEG/WebP。
- 实现：视口和视口区域通过 Chromium Surface 获取；整页与元素使用 Chromium Paint Preview 截图服务。两条路径均不申请 `debugger` 权限，也不会显示浏览器调试提示；截图面积和返回数据均有硬上限。

### `browser_action`

- 作用：操作网页中的元素或坐标位置。
- `action`：必填，可用值为 `click`、`double_click`、`right_click`、`upload_file`、`scroll`、`type`、`press_key`。
- 元素定位：`ref`、`selector`，也可使用 `x`、`y` 坐标。
- 点击实现：`click`、`double_click`、`right_click` 会经主进程 Runtime Bridge 使用 Chromium Views 层的可见虚拟指针；平滑移动轨迹、按下、抬起和点击反馈均在内核侧完成。覆盖层不进入页面 DOM、不接收事件，也不移动 Windows 全局鼠标；RenderWidgetHost 正常执行坐标命中测试，不会穿透遮挡元素。
- 输入参数：`text`、`clear_first`、`submit`。
- 上传参数：`path` 或 `paths`、`mode`；路径只交给当前 Profile、当前页面 origin 的一次性文件选择队列。
- 滚动参数：`direction`（`up`、`down`、`top`、`bottom`）、`amount`。
- 按键参数：`key`、`ctrl`、`shift`、`alt`、`meta`。
- 匹配序号：`nth`。

### `browser_wait`

- 作用：等待指定选择器对应的元素出现，或固定等待一段时间。
- 参数：`selector`、`ms`。

## 多浏览器路由

AI 对话和 HeySure 设备端都会发现当前所有已连接浏览器的工具，但任一时刻只维护一个“当前控制浏览器”，不允许同时控制多个目标。AI 控制栏的浏览器选择器也是单选。

所有浏览器工具都会额外获得一个可选参数：

- `change_browser`：切换当前控制浏览器，可填写连接 ID 或唯一的连接名称；省略时沿用当前控制目标。

连接列表可以包含多个浏览器，但每次页面工具只会派发到一个连接。切换成功后，同一轮任务中的后续调用继续使用新目标，直到再次传入 `change_browser`。旧 `browser_id`、`browser_name` 和 `browser` 参数仅保留执行兼容，不再向 AI 的新工具 Schema 暴露。

软件内 AI 会按当前实际工具目录动态注入 MCP 使用提示：同一时间最多控制一个浏览器；需要操作其他连接时先通过 `change_browser` 切换；页面导航、标签页切换或页面状态变化后重新执行 `browser_observe`，不跨窗口或跨页面复用旧元素引用，并以工具的实际返回结果判断任务是否完成。

`software_window list` 返回的 `history_id`、`tab_id` 和窗口 `name` 属于软件窗口管理层。聚焦已有窗口应调用 `software_window` 的 `open`；`history_id` 和 `tab_id` 不能用于 `change_browser`，窗口名称只有同时出现在 MCP 连接列表时才能用于切换。窗口显示为已打开不代表其 Runtime 已完成握手。

`software_window` 的 `open`、`create`、`edit` 和 `close` 返回值包含 `browser_total`、`browser_open_count`、`browser_names`、`open_browser_names` 和 `active_browser`。打开已有窗口或创建新窗口时会请求将该窗口设为控制目标；新窗口的 MCP 连接建立后，AI 控制栏会自动切换到它。关闭当前控制窗口后会回退到仍在线的一个连接。

`open` 和 `create` 使用两阶段完成条件：先完成 Chromium 窗口打开，再等待该 Profile 的原生 Runtime 握手就绪（默认最多等待 20 秒）。为保持返回契约兼容，就绪标记仍使用 `mcp_connected`；只有返回 `success: true`、`mcp_connected: true` 和 `control_browser_id` 才表示可以继续调用 `browser_tab` 等页面工具。超时会返回窗口已打开但 Runtime 暂不可控。同一轮对话会在 Runtime 就绪后动态补入新连接及其工具定义。

## HeySure 注册与可用性

- HeySure 设备工具注册由 [`ai-server-device-service.js`](../src/app/main/features/ai-chat/ai-server-device-service.js) 负责，内部名称会转换为 `aifree.<工具名>`。
- 外部调用目录由 [`browser-automation-external-gateway.js`](../src/app/main/services/browser-automation-external-gateway.js) 汇总，并执行会员权限、浏览器路由和敏感参数限制。
- 只有服务器实时校验为有效会员时，软件才会向 HeySure 注册为在线设备并接受调用。
- 浏览器连接建立或断开后，设备会自动刷新工具目录。因此 HeySure 端可见工具数量可能在 1 个和 7 个之间变化。
- `software_window_list/open/create/rename/close` 已停止公开注册，新调用统一使用 `software_window` 并传入对应 `action`；重命名使用 `action: "edit"` 和 `new_name`。
- 旧扩展的 `write_card`、`get_status`、`run_card`、`capture_cookies` 别名及 loopback 注册/轮询协议已经移除。
