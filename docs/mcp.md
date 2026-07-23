# AI-FREE MCP 工具清单

更新时间：2026-07-23

本文档记录当前软件实际向 AI 提供的 MCP 工具。工具分为浏览器窗口管理、绑定软件 UI Automation，以及内置浏览器自动化三组。`software_ui` 仅在当前活动栏目是已停靠外部软件时按需出现，避免为普通对话增加 prompt 成本。

## 总览

| 工具组 | 数量 | 可用条件 | 代码真源 |
| --- | ---: | --- | --- |
| 软件窗口 | 1 | 软件运行期间始终可用 | [`ai-browser-window-tools.js`](../src/app/main/services/ai-browser-window-tools.js) |
| 软件 UI Automation | 1 | 当前活动栏目绑定了可用外部软件窗口 | [`ai-software-ui-tools.js`](../src/app/main/services/ai-software-ui-tools.js) |
| 浏览器自动化 | 7 | 至少有一个内置浏览器 MCP 连接 | [`09_agent_protocol.js`](../src/assets/extensions/browser_automation/background/09_agent_protocol.js) |

AI-FREE 本地 AI 对话使用下表中的“内部名称”。连接 HeySure 后，设备向服务器注册时会统一添加 `aifree.` 前缀。

| 内部名称 | HeySure 注册名称 | 用途 |
| --- | --- | --- |
| `software_window` | `aifree.software_window` | 通过 `action` 统一查询、打开、新建、编辑和关闭窗口 |
| `software_ui` | `aifree.software_ui` | 观察并操作当前绑定外部软件的 UI Automation 控件 |
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

## 软件 UI Automation

### `software_ui`

- 目标固定为当前活动的外部软件栏目，调用参数不接受 HWND 或 PID；原生层每次执行仍会核对绑定 HWND、进程 PID 和 Windows Session，防止模型把调用改路由到其它桌面窗口。
- `action=observe` 返回控件的 `ref`、名称、类型、当前值、屏幕区域和可用操作。默认最多 30 项，硬上限 80 项；深度默认 6、上限 10，文本和值单项最多 160 字符。
- 密码控件只返回 `password: true`，不会返回当前值。
- 操作包括 `click`/`invoke`/`mouse_click`/`double_click`/`right_click`、`type`/`set_value`、`toggle`、`select`、`expand`、`collapse` 和 `focus`。
- `click`、`mouse_click`、`double_click`、`right_click` 直接使用 Windows `SendInput`；只有显式 `invoke` 才执行可能阻塞的 UIA 语义动作。
- `observe` 返回的可点击坐标会在同一轮 MCP 工具实例内短暂缓存，点击时直接复用，避免再次同步查询第三方 UIA Provider 导致主界面卡顿。
- 鼠标输入前会校验坐标实际命中的窗口仍属于绑定 PID；若被其他程序遮挡则拒绝点击，防止误操作。
- 软件出现模态弹窗时，`observe` 和后续操作自动切换到该弹窗；返回结果以 `popup` 标记当前根节点。
- 控件树变化后旧 `ref` 可能失效，必须重新 `observe`。UI Automation 连接和事务分别设置 2 秒、5 秒超时，避免无响应软件长期阻塞 AI。

该工具使用 Windows UI Automation Pattern，不发送全局鼠标输入，也不提供全桌面坐标点击，因此控制边界始终保持在绑定窗口的 UIA 子树内。

## Prompt 与结果预算

- `software_ui` 只在当前活动栏目可控时加入工具目录，普通浏览器和普通聊天不承担该 schema。
- 模型接收精简版 `software_window` schema；完整浏览器环境字段仍由运行时白名单严格校验，压缩不会放宽可写字段。
- MCP 路由提示采用短规则索引，不重复展开工具文档；具体参数以工具 schema 为准。
- UIA 观察结果使用数量、深度和单字段长度三层上限，避免把完整桌面可访问性树塞入对话。

## 浏览器自动化工具

以下 7 个工具由内置浏览器扩展提供。没有浏览器 MCP 连接时，它们不会出现在 AI 或 HeySure 的可用工具目录中。

### `manage_card`

- 作用：查询规则，列出、读取、新建、修改、删除和运行自动化卡片，也可增删、移动或修改卡片步骤。
- `action`：必填，可用值为 `rules`、`list`、`get`、`write`、`patch_step`、`insert_step`、`delete_step`、`move_step`、`delete`、`run`。
- 常用定位参数：`id`、`card_name`。
- 编辑参数：`cardData`、`step_index`、`to_step_index`、`insert_after`、`stepData`、`stepPatch`、`replace`。
- 运行参数：`inputs`、`account`、`password`、`email`、`start_step`、`timeout_seconds`、`tab_id`。
- 注意：不同 `action` 使用不同参数；`write`、步骤编辑和 `delete` 会修改本地卡片数据。
- 脚本限制：MCP 不公开 `external_script`，也不允许 `condition_mode=js`；写入、局部编辑和运行历史卡片时都会拒绝任意页面脚本。

### `browser_download`

- 作用：`download` 下载 HTTP/HTTPS 文件；图片、视频和音频默认优先使用当前 Chromium Profile 的原生下载，普通文件使用受限的软件 HTTP 下载并在失败时自动尝试 Chromium；`save_session` 保存当前标签页 Cookie、`localStorage` 和 `sessionStorage`；`info` 返回 AI 工作区路径。
- 默认目录：`download` 写入安装目录下的 `AI-Workspace` 根目录；`save_session` 默认写入 `AI-Workspace/sessions`。
- 子目录：`directory` 只接受 AI 工作区内相对路径，例如 `downloads/models`；拒绝绝对路径、`..` 逃逸和指向工作区外的链接目录。
- 下载参数：`url`、`filename`、`media_type`、`transport`、`use_cookies`、`overwrite`、`timeout_ms`、`max_bytes`、`tab_id`。媒体下载应将 `browser_observe` 返回的 `category` 传给 `media_type`；`transport` 可取 `auto`、`browser`、`software`。
- 会话参数：`filename`、`directory`、`overwrite`、`tab_id`。保存结果只返回路径和 Cookie 数量，不把 Cookie 原文放入聊天结果。
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
- 筛选参数：`filter`、`tag`、`tags`、`keyword`、`query`、`text_filter`。
- 框架参数：`frame`、`frame_path`。
- 文本与标记参数：`include_text`、`text_limit`、`allow_truncate`、`mark`、`highlight_duration_ms`。
- Fork 原生 Observe 默认在 Chromium UI 层绘制与元素 `id` 对应的边框标签，不写入网页 DOM、不接收鼠标事件；导航、滚动、窗口隐藏或超时后自动清除。最多绘制 120 个标记。
- 路由参数：`tab_id`。
- 下载链接：可见 HTTP/HTTPS 链接会在对应 item 中提供 `downloadUrl`，并汇总到顶层 `downloadLinks`；其中的 `url` 可直接交给 `browser_download`。

### `browser_screenshot`

- 作用：截图并返回 base64 `dataUrl`；默认截取当前标签页可视区。
- 精确截图：`full_page` 截整页；`selector`/`text` 截元素；`clip` 或 `x`、`y`、`width`、`height` 截区域。
- 图片参数：`format`、`quality`、`scale`、`max_area`、`max_data_url_chars`、`allow_large_data_url`。
- 稳定性参数：`retries`、`timeout_ms`。
- 展示与交付：`screenshot_fx`、`send_to_user`、`save_to_server`。
- 路由参数：`tab_id`。所有截图模式均使用 `captureVisibleTab`；整页、元素和区域通过滚动分片拼接，不申请 `debugger` 权限，也不会显示浏览器调试提示。

### `browser_action`

- 作用：操作网页中的元素或坐标位置。
- `action`：必填，可用值为 `click`、`double_click`、`right_click`、`scroll`、`type`、`press_key`。
- 元素定位：`ref`、`selector`，也可使用 `x`、`y` 坐标。
- 点击实现：`click`、`double_click`、`right_click` 会经主进程 Runtime Bridge 使用 Chromium Views 层的可见虚拟指针；平滑移动轨迹、按下、抬起和点击反馈均在内核侧完成。覆盖层不进入页面 DOM、不接收事件，也不移动 Windows 全局鼠标；RenderWidgetHost 正常执行坐标命中测试，不会穿透遮挡元素。
- 输入参数：`text`、`clear_first`、`submit`。
- 滚动参数：`direction`（`up`、`down`、`top`、`bottom`）、`amount`。
- 按键参数：`key`、`ctrl`、`shift`、`alt`、`meta`。
- 其他参数：`force`、`tab_id`。

### `browser_wait`

- 作用：等待指定选择器对应的元素出现，或固定等待一段时间。
- 参数：`selector`、`ms`、`tab_id`。

## 多浏览器路由

AI 对话和 HeySure 设备端都会发现当前所有已连接浏览器的工具，但任一时刻只维护一个“当前控制浏览器”，不允许同时控制多个目标。AI 控制栏的浏览器选择器也是单选。

所有浏览器工具都会额外获得一个可选参数：

- `change_browser`：切换当前控制浏览器，可填写连接 ID 或唯一的连接名称；省略时沿用当前控制目标。

连接列表可以包含多个浏览器，但每次页面工具只会派发到一个连接。切换成功后，同一轮任务中的后续调用继续使用新目标，直到再次传入 `change_browser`。旧 `browser_id`、`browser_name` 和 `browser` 参数仅保留执行兼容，不再向 AI 的新工具 Schema 暴露。

软件内 AI 会按当前实际工具目录动态注入 MCP 使用提示：同一时间最多控制一个浏览器；需要操作其他连接时先通过 `change_browser` 切换；页面导航、标签页切换或页面状态变化后重新执行 `browser_observe`，不跨窗口或跨页面复用旧元素引用，并以工具的实际返回结果判断任务是否完成。

`software_window list` 返回的 `history_id`、`tab_id` 和窗口 `name` 属于软件窗口管理层。聚焦已有窗口应调用 `software_window` 的 `open`；`history_id` 和 `tab_id` 不能用于 `change_browser`，窗口名称只有同时出现在 MCP 连接列表时才能用于切换。窗口显示为已打开不代表其扩展 MCP 已在线。

`software_window` 的 `open`、`create`、`edit` 和 `close` 返回值包含 `browser_total`、`browser_open_count`、`browser_names`、`open_browser_names` 和 `active_browser`。打开已有窗口或创建新窗口时会请求将该窗口设为控制目标；新窗口的 MCP 连接建立后，AI 控制栏会自动切换到它。关闭当前控制窗口后会回退到仍在线的一个连接。

`open` 和 `create` 使用两阶段完成条件：先完成 Chromium 窗口打开，再等待对应窗口内的 AI 自动化插件连接到 Automation Bridge（默认最多等待 20 秒）。只有返回 `success: true`、`mcp_connected: true` 和 `control_browser_id` 才表示该窗口已经可以继续调用 `browser_tab` 等页面工具。超时会返回 `success: false`、`mcp_connected: false`，同时明确说明窗口已经打开但暂时不可控。同一轮对话会在连接就绪后动态补入新连接及其工具定义，无需等待下一次用户消息。

## HeySure 注册与可用性

- HeySure 设备工具注册由 [`ai-server-device-service.js`](../src/app/main/features/ai-chat/ai-server-device-service.js) 负责，内部名称会转换为 `aifree.<工具名>`。
- 外部调用目录由 [`browser-automation-external-gateway.js`](../src/app/main/services/browser-automation-external-gateway.js) 汇总，并执行会员权限、浏览器路由和敏感参数限制。
- 只有服务器实时校验为有效会员时，软件才会向 HeySure 注册为在线设备并接受调用。
- 浏览器连接建立或断开后，设备会自动刷新工具目录。因此 HeySure 端可见工具数量可能在 1 个和 7 个之间变化。
- `software_window_list/open/create/rename/close` 已停止公开注册，新调用统一使用 `software_window` 并传入对应 `action`；重命名使用 `action: "edit"` 和 `new_name`。
- `write_card`、`get_status`、`run_card`、`capture_cookies` 仍保留为扩展内部的旧协议兼容别名，但不在当前公开 MCP 工具目录中，不应由新调用使用。
