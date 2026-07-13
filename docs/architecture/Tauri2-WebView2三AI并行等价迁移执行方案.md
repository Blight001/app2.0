# AI-FREE Electron → Tauri 2 / WebView2 三 AI 并行等价迁移执行方案

> 状态：待执行的主控文档  
> 编写日期：2026-07-13  
> 当前产品版本：`2.6.1`  
> 目标平台：Windows x64  
> 目标：在不改变现有 UI、业务规则、数据格式和 AI-FREE Chromium 行为的前提下，以 Tauri 2 / WebView2 外壳替换 Electron，并由 3 个 AI 在隔离工作区内并行实施。

## 0. 如何使用本文档

本文档既是迁移设计，也是三个 AI 的共同任务书。三个 AI 开始工作前必须完整阅读本文，并遵守以下规则：

1. 先把当前工作树保存为一个经过人工确认的基线提交，再创建三个 Git worktree。当前未提交文件包含已经完成的 Chromium Runtime 工作，不能从旧 `HEAD` 直接创建迁移分支。
2. 三个 AI 不得在同一个物理目录中同时修改文件。
3. 三个 AI 只能修改各自拥有的目录；共享文件只由 AI-B（集成负责人）在集成阶段修改。
4. 现有 Electron 版本在所有等价验收通过前必须保持可启动、可打包、可作为对照基线。
5. 不允许以“功能以后再补”“界面大致相同”“返回值差不多”为理由删除旧实现。
6. 不允许为了减小体积而删除未经真实启动、功能和稳定性验收的 Chromium 文件。
7. 每个 AI 每完成一个门禁，必须更新自己的交接记录，写清提交 SHA、执行命令、结果和未解决问题。

本文中的 `<BASELINE_SHA>` 必须在执行前替换为经过人工确认的实际提交号。没有基线提交号时，三个 AI 均不得开始框架代码迁移。

## 1. 不可协商的迁移目标

### 1.1 必须保持等价

- UI：HTML 结构、CSS、图标、字体、颜色、间距、窗口尺寸、标签栏高度、侧栏比例、弹窗、文案和快捷键均不做产品设计变更。
- 交互：点击、键盘、滚轮、焦点、窗口切换、标签创建/切换/关闭/排序、侧栏显示/隐藏和错误提示行为保持一致。
- 业务：卡密验证、设备号、账号存储、账号记忆、公告、服务器解析、HTTP 请求、Clash Mini、代理、扩展、下载、更新和退出清理规则保持一致。
- 数据：继续读取现有用户目录、配置文件、许可证记录、账号记录、Chromium Profile、下载目录和缓存；不得要求用户重新登录或重建 Profile。
- 浏览器：AI-FREE Chromium 的启动、命名管道握手、Profile 隔离、会话导入、窗口嵌入、焦点、缩放、下载、扩展和代理行为不得退化。
- 协议：现有 `window.electronAPI`、IPC channel 名、请求参数、返回对象、错误语义和事件 payload 在迁移期保持兼容。
- 安装升级：现有版本升级到 Tauri 版本时，安装目录、用户数据、桌面快捷方式、卸载和自动更新流程必须有经过测试的迁移路径。

### 1.2 本次明确不做

- 不重新设计 UI，不更换前端框架，不借迁移顺便重写页面。
- 不把全部 Node.js 业务一次性重写成 Rust。
- 不改变服务端接口、卡密规则、账号字段、配置字段或 Chromium Runtime Bridge 已有字段。
- 不新增指纹内核功能，不升级 Chromium 锁定版本；框架迁移与 Chromium 版本升级必须分开。
- 不使用 CEF、NW.js 或其他再次内置 Chromium 的 UI 框架。
- 不把 WebView2 Fixed Version 放入主安装包；离线安装包作为单独产物评估。
- 不在最终产品中保留 Electron 运行时作为静默回退。

## 2. 当前基线事实

以下数字来自 2026-07-13 工作树，AI-A 必须在 `<BASELINE_SHA>` 上重新生成机器可读基线，不能只依赖本文中的数字：

| 项目 | 当前值 |
|---|---:|
| `resources/chromium/` | 480 个文件，约 477.7 MiB |
| `node_modules/electron/dist/` | 75 个文件，约 329.9 MiB |
| 当前旧 `appbuild/win-unpacked/` | 约 588.4 MiB（生成时间早于本次 Chromium stage，不代表新包最终大小） |
| `resources/chromium/locales/` | 440 个文件，约 112.2 MiB |
| 其中 `.pak.info` | 220 个文件，约 69.9 MiB |
| 直接或间接使用 Electron 窗口/IPC 的源码文件 | 至少 27 个 |
| `ipcMain.handle` 粗扫描注册点 | 68 个（静态去重时数量会变化） |
| `ipcMain.on` 粗扫描注册点 | 19 个（静态去重时数量会变化） |
| 前端 `electronAPI` 调用点 | 约 120 个 |
| Electron 40 内置 Node | `24.11.1`，N-API 10 |

粗扫描统计的是源码出现位置，不是最终唯一 channel 数。独立静态盘点得到约 82 个唯一
channel，但动态 channel、重复注册和条件注册会影响结果；迁移以 AI-A 在
`<BASELINE_SHA>` 上生成并由测试校验的契约为唯一事实源。

当前 UI 并非完全不使用 Electron 浏览器：

- 卡密窗口：1120×760、不可缩放，见 `src/app/main/services/app-shell.js`。
- 主窗口：1280×850，顶部标签栏逻辑高度 41。
- 控制页窗口：1460×1040，最小 1200×800。
- 调试控制台：760×860。
- 标签代理菜单：168×92、无边框、透明、置顶、失焦关闭，仅开发模式使用。
- 更新下载页：1280×900，可在隐藏状态继续检测下载并最终启动安装包。
- 主窗口页面使用 Electron `BrowserWindow`；侧栏使用独立 `BrowserView`。
- 业务标签已经可以使用独立 AI-FREE Chromium，但旧 `ElectronRuntime` 仍存在。
- 当前 Chromium Runtime Bridge 白名单为 `navigate`、`reload`、`close-browser`、`set-cookies`、`set-storage`、`clear-session`。
- 扩展完整迁移、代理、下载、新窗口接管等能力仍必须逐项证明不再依赖 Electron `webContents/session`，之后才能删除 Electron。

在 1280×850、100% DPI、侧栏展开的基线布局中，浏览器区域应为
`(0, 41, 896, 809)`，侧栏区域应为 `(896, 41, 384, 809)`。WebView2 的逻辑像素
不能直接作为 Win32 物理像素；最大化、跨屏和 DPI 改变都必须重新换算。

## 3. 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Tauri 2 Windows Shell（Rust，单实例、窗口、生命周期、更新） │
│                                                             │
│  WebView2 UI                                                │
│  ├─ 原 app-shell / license / sidebar / dev-console 页面     │
│  └─ tauri-compat.js：继续暴露 window.electronAPI            │
│                                                             │
│  Rust Transport                                             │
│  ├─ 白名单命令与事件转发                                    │
│  ├─ Node Sidecar 生命周期                                   │
│  └─ C++ Browser Host C ABI                                  │
└───────────────┬──────────────────────────┬──────────────────┘
                │ 长度前缀 JSON            │ 同进程 C ABI / HWND
                ▼                          ▼
┌──────────────────────────────┐  ┌───────────────────────────┐
│ Node.js 24.11.1 Sidecar      │  │ C++ Browser Host Core     │
│ 保留当前业务、存储和网络逻辑 │  │ Host HWND / 嵌入 / 焦点   │
└───────────────┬──────────────┘  └─────────────┬─────────────┘
                │                               │ SetParent/校验
                │ Named Pipe Runtime Bridge     ▼
                └──────────────────────► AI-FREE Chromium 150
```

### 3.1 UI 表面

- 主 WebView2 继续加载现有 `app-shell.html` 和现有 CSS/JS。
- 卡密页、控制页和调试控制台使用独立的 Tauri WebviewWindow，窗口尺寸和行为按基线复刻。
- 侧栏优先复用现有 `src/app/sidebar/index.html`，保持其独立文档和样式作用域。首选方案是在主 WebView2 中使用受控本地 iframe，由可信父页面转发兼容事件。
- 远程侧栏回退必须验证 CSP、`X-Frame-Options` 和消息来源。远程页面不得直接获得 Tauri command 权限；只能通过严格 origin 与消息类型白名单向可信父页面请求允许的操作。
- 如果 iframe 方案无法达到等价，才允许使用固定并锁定 Tauri minor 版本的 child webview 能力；启用前必须记录原因和版本锁，不能无记录地依赖不稳定 API。
- AI-FREE Chromium 仍然是独立进程和独立 Browser HWND，由 C++ Host 作为 Tauri 顶层窗口的子窗口嵌入。

### 3.2 Node Sidecar

- 第一阶段固定使用与 Electron 基线相同的 Node `24.11.1`，避免 Node/V8 行为变化与框架变化同时发生。
- 为保证 `sharp`、Playwright、Transformers、原生模块和动态资源兼容，第一阶段允许携带固定 Node Runtime 与业务资源，不强制立即制作单文件可执行程序。
- Sidecar 不监听公网或 localhost 端口；只使用父进程持有的 stdin/stdout 管道或受 ACL 保护的命名管道。
- stdout 只传协议帧，普通日志全部写 stderr 或日志文件。
- Tauri Shell 是 Sidecar 的唯一父进程，负责 ready 超时、健康检查、优雅退出、强制回收和异常重启。

### 3.3 C++ Browser Host

- Win32 窗口核心逻辑从 N-API 包装中抽出为稳定 C ABI Core。
- Tauri Rust 进程同进程调用 C ABI，使 Host HWND 与 Tauri 顶层窗口保持同一进程，降低跨进程 `SetParent`、DPI 和窗口生命周期风险。
- 旧 `browser_host.node` 暂时保留为同一 Core 的薄 N-API 适配器，用于 Electron 对照验收；它不能继续拥有第二套窗口逻辑。
- HWND 在 JSON 中必须使用十进制字符串传输，禁止用 JavaScript `number` 承载 64 位句柄。
- Win32 窗口操作必须遵守线程亲和性；创建、销毁、重设父窗口、尺寸、显示、焦点和 Z-order 都在 Core 指定的窗口线程执行。

## 4. 开始并行前必须冻结的五份契约

契约由 AI-A 生成基线，AI-B 和 AI-C 消费。契约发生变化时必须先提交一份说明，由集成负责人确认后再修改实现。

### 4.1 UI 资产契约

机器可读产物建议放到：

```text
tests/migration/baseline/ui-files.json
tests/migration/baseline/dom-snapshots/
tests/migration/baseline/screenshots/
tests/migration/baseline/window-contract.json
```

至少记录：

- 全部 HTML/CSS/图片/字体的路径、SHA-256 和文件大小。
- 主窗口、卡密页、侧栏、控制页、调试控制台的 DOM 快照。
- 100%、125%、150% DPI 下的窗口与内容区尺寸。
- 侧栏显示/隐藏、标签切换、加载中、错误、公告、账号菜单、代理菜单、深色主题等截图。
- 主窗口布局公式：`tabBarHeight=41`，侧栏宽度为内容宽度的 `floor(30%)`，浏览器占剩余区域。

像素验收使用固定 Windows 版本、固定 WebView2 版本、固定字体和固定 DPI。允许抗锯齿造成的极小差异，但不得以放宽阈值隐藏布局变化；建议 SSIM 不低于 0.995，并人工复核所有差异图。

### 4.2 前端兼容桥契约

迁移期继续提供：

```js
window.electronAPI.send(channel, data)
window.electronAPI.invoke(channel, data)
window.electronAPI.on(channel, callback) // 返回包装后的 listener token
window.electronAPI.off(channel, listenerToken)
window.electronAPI.removeListener(channel, listenerToken)
window.env
window.electron
```

实现文件建议为：

```text
src/app/desktop-bridge/tauri-compat.js
src/app/desktop-bridge/transport.js
src/app/desktop-bridge/channel-contract.json
```

要求：

- channel 名、参数缺省值、Promise 行为、错误对象、事件 payload 和取消监听语义与当前 preload 一致。
- 当前 `on()` 返回包装后的 listener 函数，调用方把它传给 `off/removeListener`；
  Tauri 兼容层必须保持这一表面行为，即使内部订阅建立是异步的。
- 不把 Rust/Tauri 内部命令名散布到页面控制器中。
- 初始化脚本必须在页面业务脚本之前安装兼容对象。
- 初始化脚本必须检查窗口 label、URL/origin 和 frame；远程 frame 不得获得本地系统权限。
- 当前页面控制器不允许直接 import `@tauri-apps/api`；只能调用兼容桥。
- `active-zoom` 仍须按现有语义转为页面消息，但生产实现必须限定可信来源，不能继续
  用无限制的跨 origin 通配授权。

### 4.3 Shell ↔ Sidecar 协议 v1

沿用项目已有协议习惯：4 字节 little-endian 无符号长度 + UTF-8 JSON，单帧上限 4 MiB。

请求：

```json
{
  "version": 1,
  "type": "invoke",
  "id": "shell-session-sequence",
  "channel": "license-get-records",
  "payload": null,
  "source": { "windowLabel": "license" }
}
```

响应：

```json
{
  "version": 1,
  "type": "result",
  "id": "shell-session-sequence",
  "ok": true,
  "value": {}
}
```

事件：

```json
{
  "version": 1,
  "type": "event",
  "channel": "update-tabs",
  "sequence": 1,
  "targets": ["main", "sidebar", "control-panel"],
  "args": [{}]
}
```

Node 需要调用 Rust 原生窗口或 Browser Host 时使用独立的双向请求类型，不能伪装成
前端 channel：

```json
{
  "version": 1,
  "type": "host-request",
  "id": "sidecar-session-sequence",
  "operation": "attach-browser",
  "payload": {
    "profileId": "profile-a",
    "browserHwnd": "123456789",
    "expectedPid": 1234
  }
}
```

Rust 使用同一 `id` 返回 `host-result`。`host-request` 与普通业务 `invoke` 使用不同
allowlist；协议实现必须支持双向请求并发，不能在等待响应时停止读取另一方向消息。

硬约束：

- 每个请求有唯一 `id`，成功和失败都必须响应。
- 错误包含稳定 `code`、可读 `message`，以及仅开发模式可用的 `details`。
- 事件带单调递增 `sequence`；有顺序要求的事件不得通过无序异步监听器乱序处理。
- `args` 始终为数组，兼容层调用页面回调时使用 `callback(...args)`，不得把 Tauri
  原始 event 对象传给页面。
- 启动控制帧至少包含 `hello`、`ready`、`ping/pong`、`shutdown`、`shutdown-complete`。
- `ready` 包含 protocolVersion、应用版本、Sidecar PID 和 channel contract hash；
  contract hash 不一致时拒绝进入 ready。
- 未在 channel contract 中出现的命令一律拒绝。
- contract 同时记录 channel 的 owner（Rust/Node）、允许的窗口 label 和超时类别。
- `undefined`、`null`、Buffer、Error 和多参数事件必须有 fixture，不能在 JSON 化时
  静默改变现有表现。
- Tauri 前端不能直接启动任意 Sidecar、执行任意 shell 或传任意文件路径。

### 4.4 Native Host C ABI v1

AI-C 负责最终头文件，至少覆盖以下稳定能力：

```text
api_version
set_per_monitor_dpi_awareness
create_host(parent_hwnd, bounds)
attach_browser(host, browser_hwnd, expected_pid)
set_bounds(host, bounds)
show(host)
hide(host)
focus(host)
is_window_alive(host)
get_window_process_id(browser_hwnd)
is_child_window_attached(host, browser_hwnd)
set_child_window_title(browser_hwnd, title)
find_main_window_by_process_id(pid) // 仅 prototype 测试
detach_browser(host)
destroy_host(host)
last_error
```

要求：

- 使用固定宽度整数和 opaque handle，不在 ABI 中暴露 C++ STL 类型。
- 明确所有权、线程、错误码、字符串编码和销毁规则。
- 保留现有 PID/Session/HWND/GetParent/IsChild 校验。
- Core、N-API 适配器和 Rust FFI 共同运行同一套原生 API 测试。
- ABI 版本不匹配时 Tauri 必须拒绝启动浏览器，不得尝试继续运行。
- `set_per_monitor_dpi_awareness` 必须在创建第一个 HWND 前完成。
- 正式路径只接受 Chromium 握手主动报告的 Browser HWND；
  `find_main_window_by_process_id` 只保留给显式 prototype 回归。

正常关闭顺序固定为：停止派发新命令 → `close-browser` → 等待优雅退出 → 超时结束
Chromium 进程树 → 关闭 Pipe → 解绑 Browser HWND → 销毁 Host HWND → 释放 Profile
Lock → 状态进入 `stopped`。Tauri/Sidecar 不得因换框架改变这个顺序。

### 4.5 数据兼容契约

AI-B 必须在 Electron 基线上用合成数据生成兼容 fixture，不得把真实账号、卡密、Cookie 或机器秘密提交到仓库。

至少覆盖：

- Electron `app.getPath('userData')` 对应的原目录。
- store 配置、许可证记录、账号记录、最近使用状态、下载设置。
- `safeStorage`/Windows DPAPI 数据的旧格式读取和一次性迁移。
- `chromium-profiles/<immutable-id>/`、Profile Lock、Cookie、Storage 和下载目录。
- Clash Mini 配置、系统代理恢复状态和进程清理状态。
- 从旧版本升级后第一次启动、第二次启动和卸载保留数据行为。
- 侧栏已有 `localStorage` 键 `ai-free.control-panel.theme` 和
  `ai-free.control-panel.remoteUrl` 必须原样保留。

### 4.6 UI 与事件基线清单

本次保留的本地应用页面至少包括：

```text
src/app/views/app-shell.html
src/app/views/license.html
src/app/sidebar/index.html
src/app/main/views/dev-console.html
```

`src/app/sidebar/index.html` 使用经典脚本并依赖固定加载顺序；不得趁迁移改成 ES
module、React/Vue 或重新排列脚本。以下行为必须进入 UI fixture：

- 卡密最近记录、键盘选择、删除确认、验证 loading、成功进入主应用和关闭即退出。
- 标签单击/中键/关闭/拖拽排序、代理菜单、runtime starting/crashed/restart 状态。
- 侧栏显示/隐藏、账号切换/删除/Cookie 导入、插件开关、VPN 启停/测速/切换、公告、
  更新进度、教程、版本和主题同步。
- 设置按钮单击控制侧栏、双击打开当前网页控制台。
- `update-tabs` 等事件同时投递嵌入侧栏和独立控制页，不能退化成单消费者。
- `browser-mcp-bridge` 的 identify/list/switch/close/open/replace/history/reload/capture
  子命令全部迁到 AI-FREE Chromium 能力边界。

`src/assets/extensions/**` 下的 popup/options/side-panel/offscreen 页面仍属于 AI-FREE
Chromium 扩展，不得迁入 WebView2。插件 Popup/Options 当前依赖 Electron BrowserView
的部分必须由 AI-C 提供 Chromium 等价实现。

`src/assets/extensions/clash-mini/` 还包含一套独立 Electron 页面入口。AI-A/AI-B 必须
用调用图和实际启动路径判定它是现役功能还是历史未使用入口；在形成书面结论前不得
删除，也不得把它无记录地带入最终 Electron-free 声明。

## 5. 三个 AI 的分工与文件所有权

### 5.1 总表

| 角色 | 主责 | 独占修改区 | 禁止修改区 |
|---|---|---|---|
| AI-A：UI 与等价契约 | UI 基线、兼容桥、DOM/截图/交互回归 | `src/app/views/`、`src/app/main/views/dev-console.html`、`src/app/renderer/`、`src/app/sidebar/`、`src/app/desktop-bridge/`、`contracts/ipc/`、`tests/migration/ui/`、`tests/migration/contracts/` | `src-tauri/`、`sidecar/`、`native/`、`chromium-fork/`、`package.json`、锁文件 |
| AI-B：Tauri / Sidecar / 集成 | Tauri Shell、Node Sidecar、平台适配、安装更新、最终集成 | `src-tauri/`、`sidecar/`、`scripts/tauri/`、集成阶段的 `package.json` 和锁文件 | AI-A 的 HTML/CSS/视觉资产、`native/`、`chromium-fork/` |
| AI-C：Native / Chromium | C ABI Core、N-API 对照适配、Rust 链接说明、Chromium 能力补齐、runtime stage 精简 | `native/browser-host/`、`chromium-fork/`、`scripts/accept-chromium-*`、`scripts/check-browser-runtime.js`、`scripts/check-chromium-handshake.js`、`tests/migration/native/` | UI 文件、Node 业务、`src-tauri/tauri.conf.json`、`package.json`、锁文件 |

共享文件只有 AI-B 在集成分支上修改。AI-A、AI-C 需要新增 npm script 或打包资源时，在各自交接文档中列出准确修改建议，不直接编辑 `package.json`。

### 5.2 AI-A：UI 与等价契约任务

交付物：

1. 自动扫描当前所有 preload API、IPC channel、前端调用点和事件订阅，生成 `channel-contract.json`。
2. 对动态 channel、重复注册和间接调用进行人工补录，确保机器扫描发现的每个注册点
   和调用点都有归属；测试应比较扫描结果与契约，不能把本文中的近似数量写死为通过条件。
3. 建立可在普通浏览器中运行的 mock host，使现有页面无需 Electron 即可执行 UI 测试。
4. 实现 `tauri-compat.js`，继续暴露 `window.electronAPI`、`window.env` 和 `window.electron`。
5. 不改变 CSS 与可见 DOM 的前提下，完成页面加载入口适配。
6. 建立 UI 截图、DOM、键盘、鼠标、焦点、事件顺序和取消订阅回归。
7. 输出 Electron 截图与 WebView2 截图的差异报告。

AI-A 完成条件：

- 所有现有页面在 mock transport 下无 `require('electron')` 运行时错误。
- UI 资产差异仅包含经过说明的非视觉 bridge 引入。
- 所有 channel 都能在契约中找到请求方、处理方、参数、返回值和事件方向。
- UI 测试既能跑 Electron 基线，也能跑 Tauri 构建，输出同一份行为断言。

### 5.3 AI-B：Tauri / Sidecar / 集成任务

交付物：

1. 建立 Tauri 2 Windows 工程，固定 Tauri minor 版本和 Cargo/npm lock。
2. 复刻四类窗口的尺寸、标题、图标、缩放、菜单、显示时机和关闭行为。
3. 只给可信本地窗口配置最小 capability；远程内容无本地命令权限。
4. 建立 Sidecar supervisor、协议 codec、请求路由、事件转发、心跳、超时、退出和崩溃恢复。
5. 将当前 Node 业务作为 Sidecar 启动；优先复用原模块，不复制并分叉业务规则。
6. 建立 Electron API 平台适配层：路径、生命周期、单实例、对话框、打开外链、剪贴板、全局快捷键、屏幕、主题、电源保持、更新、桌面快捷方式和安全存储。
7. 保持现有用户数据路径并实现旧加密数据兼容。
8. 从 Tauri 顶层窗口取得原生 HWND，以 `uintptr_t` 传给 C++ Core；不经 JavaScript number 中转。
9. 集成 AI-A 与 AI-C 提交，维护最终 `package.json`、Cargo/npm lock、Tauri config 和构建脚本。
10. 使用 Windows Job Object 的 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 兜底管理 Sidecar、
    Chromium 和受控 Clash 子进程；正常退出仍先走各自的优雅关闭协议。
11. 生成 NSIS 主安装包，使用 WebView2 `embedBootstrapper`（只嵌入小型引导程序，
    不嵌入 WebView2 Runtime）；另行输出离线安装包体积报告。

AI-B 完成条件：

- Tauri Shell 在 Sidecar 未 ready、崩溃、卡死、退出超时等场景有确定行为。
- 所有前端 channel 都经过白名单，返回和事件与 Electron 基线一致。
- 旧用户数据 fixture 可直接使用，且迁移幂等。
- 最终主安装包中不存在 Electron executable、Electron resources 或第二份 Chromium runtime。

### 5.4 AI-C：Native / Chromium 任务

交付物：

1. 把 `browser_host.node` 中的 Win32 核心抽取为可测试 C ABI Core。
2. 让旧 N-API 适配器与 Tauri Rust FFI 都调用同一 Core。
3. 验证 Tauri HWND、WebView2 HWND、Host HWND 和 Chromium Browser HWND 的父子关系、Z-order、焦点和销毁顺序。
4. 复刻 Per-Monitor V2 DPI，验证 100%、125%、150% 与双显示器移动。
5. 保持 Named Pipe 的 protocolVersion、profileId、sessionId、requestId、token、PID 和帧长校验。
6. 建立 Electron 功能依赖矩阵，补齐最终仍依赖 `webContents/session` 的浏览器能力：扩展、Popup/Options、代理、下载、文件上传、新窗口、权限、上下文菜单、缩放、Cookie/Storage 和异常回收。
7. 精简 stage 目录：本次等价迁移只优先排除 `.pak.info`；所有 `.pak` locale 在本次
   迁移中保留，因为 Profile 仍允许选择 locale。限制语言属于另一个需要产品批准的任务。
   逐项验证是否可去除仅供 prototype 使用的重复文件。
8. 生成 runtime manifest（路径、大小、SHA-256、用途、是否必需），供 AI-B 打包，不直接修改 Tauri config。
9. 将现有 Phase 2/3 验收改造成可同时接收 Electron parent HWND 和 Tauri parent HWND 的双运行器测试。

AI-C 完成条件：

- C ABI、N-API 适配器、Rust FFI 三层测试通过。
- 正式模式不枚举系统 Chrome、不使用 CDP、不允许 prototype 回退。
- 扩展、代理、下载、新窗口等清单不存在“Electron only”项。
- 最终 runtime 经过完整启动、输入、会话、切换、稳定性和进程回收验收。

## 6. Git 分支、worktree 与交接规则

### 6.1 基线准备

当前工作树存在未提交改动和未跟踪的 Chromium/Native 源码。必须先人工检查并建立本地基线提交；不得用 `git reset --hard`、`git checkout --` 或未经检查的 stash 清理现场。

人工确认基线后执行：

```powershell
$BASELINE = (git rev-parse HEAD).Trim()
git branch migration/a-ui-contract $BASELINE
git branch migration/b-tauri-sidecar $BASELINE
git branch migration/c-native-chromium $BASELINE
git branch migration/integration $BASELINE

git worktree add ..\app2.1-agent-a migration/a-ui-contract
git worktree add ..\app2.1-agent-b migration/b-tauri-sidecar
git worktree add ..\app2.1-agent-c migration/c-native-chromium
git worktree add ..\app2.1-integration migration/integration
```

随后把 `$BASELINE` 写入三个 AI 的任务开头和交接记录。

### 6.2 提交规则

- AI-A 提交前缀：`migration(ui): ...`
- AI-B 提交前缀：`migration(shell): ...`
- AI-C 提交前缀：`migration(native): ...`
- 每个提交只解决一个可验证问题，不提交生成的 Chromium runtime、Node modules、Rust target 或安装包。
- 禁止三个分支互相 merge。集成分支只使用 `git cherry-pick <sha>` 按门禁顺序吸收提交。
- 禁止 force push、rebase 他人分支、修改他人的 worktree 或删除他人的文件。
- 发生契约冲突时停止实现，先在交接记录中给出“当前事实、期望变化、影响方、兼容方案”。

### 6.3 交接文件

每个 AI 只维护自己的文件：

```text
docs/architecture/migration-handoffs/AI-A-UI.md
docs/architecture/migration-handoffs/AI-B-SHELL.md
docs/architecture/migration-handoffs/AI-C-NATIVE.md
```

交接记录固定包含：

- 基线 SHA 与当前提交 SHA。
- 已完成项与未完成项。
- 修改文件列表。
- 新增/变化的契约。
- 执行过的命令、退出码与关键结果。
- 已知风险、复现步骤和下一位 AI 需要做的动作。

## 7. 并行执行波次与合并门禁

### Wave 0：基线冻结（不得并行改框架）

AI-A：生成 UI、IPC、数据和行为基线。  
AI-B：只建立 Tauri/Sidecar 空壳和 mock native adapter。  
AI-C：只抽取 native Core、建立 ABI 测试和 Chromium 能力缺口矩阵。

Gate 0：

- Electron 基线所有现有检查通过。
- UI/IPC/data/runtime manifest 已生成。
- 三个分支没有修改对方独占目录。
- Tauri 空壳和 C ABI 只使用 mock，不宣称功能完成。

### Wave 1：三路并行实现

进入完整业务迁移前，先在集成 worktree 完成一个联合阻断 PoC：

```text
Tauri 顶层 HWND → C ABI Browser Host → AI-FREE Chromium Browser HWND
```

PoC 必须验证 `GetParent/IsChild`、输入、焦点、resize、DPI 和 Z-order。PoC 未通过时，
AI-A 可继续做 UI/契约测试，AI-B 与 AI-C 不得开始删除或替换 Electron 业务路径。

- AI-A 实现兼容 bridge 与 UI 双运行器测试。
- AI-B 实现 Shell、Sidecar supervisor、平台适配和窗口复刻。
- AI-C 实现 C ABI、Rust FFI 可消费产物和 Chromium 缺口能力。

Gate 1：

- `window.electronAPI` 契约测试 100% 通过。
- Sidecar 协议乱序、超时、崩溃、超大帧和非法 channel 测试通过。
- Native Core 在独立 Win32 测试窗口中通过 attach/resize/focus/detach/destroy。
- 三路都能在不修改共享文件的情况下单独构建测试。

### Wave 2：集成分支双壳运行

AI-B 在 `migration/integration` 按顺序 cherry-pick：

1. AI-A 契约与测试。
2. AI-C C ABI/Core/manifest。
3. AI-B Shell/Sidecar。
4. 仅在集成分支统一修改 `package.json`、锁文件和 Tauri config。

迁移期保留两套开发入口：

```text
npm run start:electron   # 对照基线
npm run start:tauri      # 新壳
```

Gate 2：

- 两个入口读取同一套合成用户数据，输出相同的业务结果和 UI 状态。
- Tauri 能启动、嵌入、切换和关闭真实 AI-FREE Chromium Profile。
- Tauri 退出后无 Sidecar、Host、Named Pipe、Profile Lock 或 Chromium 残留。
- 失败时不会静默回退到 Electron 或系统 Chrome。

### Wave 3：全部功能等价验收

逐项跑完第 8、9 节矩阵。任何一项未通过，都不得删除 Electron。

Gate 3：

- UI/业务/数据/浏览器/安装升级五类等价全部签字。
- 500 次 Profile 切换和 2 小时 soak 在最终 Tauri + 最终 Chromium runtime 上重新执行，不引用旧 Electron 验收代替。
- 真实键盘、中文输入、鼠标、滚轮、文件上传、下载、Popup、扩展和多显示器测试通过。

### Wave 4：切换默认入口与清理 Electron

仅 Gate 3 通过后执行：

- `npm start` 改为 Tauri。
- 主安装包改为 Tauri NSIS。
- 删除产品运行路径中的 ElectronRuntime、Electron preload 和 electron-builder 配置。
- 移除 Electron 生产依赖与安装包资源。
- 如需保留 Electron 基线测试，将其放在独立历史分支/标签，不进入正式包。
- 建立 `pre-tauri-cutover` 标签和最终回滚说明。

## 8. 功能等价矩阵

每一行都必须有“Electron 基线证据、Tauri 结果、自动测试、人工测试、负责人、状态”。禁止只写“看起来正常”。

| 能力 | 主要负责人 | 最低验收 |
|---|---|---|
| 单实例、启动参数、卡密首屏 | AI-B | 重复启动聚焦原窗口；参数和首屏顺序一致 |
| 四类窗口尺寸/标题/图标/菜单 | AI-A + AI-B | 100/125/150% DPI 截图与窗口 contract 通过 |
| `electronAPI` invoke/send/on | AI-A + AI-B | channel contract 全量通过，监听可取消、无重复 |
| 卡密验证、解绑、记录 | AI-B | 成功/失败/超时/空地址行为和持久化一致 |
| 设备号与安全存储 | AI-B | 同机器稳定；旧数据可读；迁移幂等 |
| 标签创建/切换/关闭/排序 | AI-A + AI-C | 状态、UI、窗口显示、焦点一致 |
| `browser-mcp-bridge` | AI-B + AI-C | identify/list/switch/close/open/replace/history/reload/capture 全部有 Chromium 等价实现 |
| 侧栏显示、隐藏、30% 布局 | AI-A + AI-C | resize/DPI/焦点/遮挡无回归 |
| 公告、平台名、教程/目标 URL | AI-A + AI-B | 事件顺序、刷新和错误提示一致 |
| HTTP、服务器解析、超时 | AI-B | 现有 routing/announcement 检查通过 |
| 账号记忆、Cookie/Storage 导入 | AI-B + AI-C | 真实 Profile 回读、HttpOnly、隔离一致 |
| Clash Mini 与系统代理恢复 | AI-B + AI-C | 启停、切换、延迟测试、异常退出恢复 |
| Chromium 代理参数 | AI-C | 每 Profile 代理生效且互不污染 |
| 扩展加载、Popup、Options、权限 | AI-C | 内置及第三方扩展真实操作通过 |
| 下载、保存媒体、文件上传 | AI-B + AI-C | 路径、对话框、进度、完成事件、取消一致 |
| 新窗口/弹窗/Owner | AI-C | 不脱离宿主；关闭与 Profile 生命周期一致 |
| 标签代理菜单 | AI-A + AI-B | 168×92、屏幕边缘定位、置顶、失焦关闭一致 |
| 上下文菜单、剪贴板、快捷键 | AI-A + AI-B + AI-C | UI 区和 Chromium 区行为均一致 |
| 缩放、滚轮、中文输入 | AI-C | 真实输入验收通过，焦点切回后首击不穿透 |
| 更新、独立启动安装包 | AI-B | 下载、退出、安装、重启、失败恢复一致 |
| 更新下载页 | AI-A + AI-B | 隐藏下载、重定向检测、进度、错误和安装触发一致 |
| 退出与进程树回收 | AI-B + AI-C | Sidecar/Chromium/Pipe/Lock/系统代理全部清理 |
| 崩溃恢复 | AI-B + AI-C | Sidecar 或 Chromium 单独崩溃不带崩 Shell，可恢复 |
| 开发控制台与日志 | AI-A + AI-B | 日志级别、历史、窗口显示一致 |
| 安装、升级、卸载、快捷方式 | AI-B | 旧版本升级和全新安装双路径通过 |

## 9. 测试与验收命令

### 9.1 现有命令：迁移全过程必须保持通过

```powershell
npm run check:http-routing
npm run check:announcements
npm run check:extension-compat
npm run check:browser-runtime
npm run check:chromium-handshake
npm run build:native-host
npm --prefix native/browser-host test
npm run accept:chromium-phase3
npm run accept:chromium-input
```

最终候选版还必须执行：

```powershell
npm run accept:chromium-phase2
```

该命令包含长时间验收时，不得以此前 Electron 父窗口下的历史结果替代 Tauri 父窗口下的新结果。

### 9.2 迁移过程中必须新增的命令

以下命令在当前基线不存在，由三个 AI 按所有权实现，AI-B 在集成分支写入 `package.json`：

```powershell
npm run baseline:migration
npm run test:bridge-contract
npm run test:ui-parity
npm run test:sidecar-protocol
npm run test:native-cabi
npm run test:data-compat
npm run smoke:tauri
npm run accept:tauri-parity
npm run build:tauri
npm run audit:tauri-bundle
```

约定：

- 每条命令必须可重复运行、失败返回非零退出码、不得依赖人工观察才能判定成功。
- 人工验收另有清单，但不能替代自动测试。
- 测试使用临时 Profile 和合成账号；不得污染真实用户数据。
- 日志中不得打印卡密、Cookie、代理凭据、完整设备指纹或安全存储明文。

### 9.3 最终进程与产物审计

运行态至少确认：

```text
允许：AI-FREE Tauri Shell、固定 Node Sidecar、AI-FREE Chromium 进程树
禁止：electron.exe、系统 chrome.exe/edge.exe 回退、未知 localhost 服务
```

安装包解压后至少确认：

- 只有 `resources/chromium/`（或最终等价目录）包含 Chromium runtime。
- Shell 目录不存在 Electron 的 `resources/default_app.asar`、Electron executable 或第二套 locales/PAK。
- WebView2 使用系统 Evergreen 模式；主安装包不含 Fixed Version Runtime。
- runtime manifest 中每个文件的 SHA-256 与 stage 结果一致。

## 10. 体积优化与打包规则

体积优化必须在功能等价之后进行，并逐项提交，便于回滚。

优先级：

1. 去除 Electron runtime 与 electron-builder 生产产物。
2. 主安装包使用 WebView2 `embedBootstrapper`，只增加小型安装引导程序；不使用
   `offlineInstaller` 或 `fixedVersion`。
3. Chromium stage 排除 `.pak.info` 构建信息。
4. 本次保留全部 `.pak` 语言资源，不把减少 locale 与框架迁移混在一起。
5. 验证正式模式不需要 prototype 的重复 `chrome.exe` 后再决定是否排除。
6. Node Sidecar 等价稳定后，再评估 SEA/单文件打包和依赖裁剪；不得在首轮迁移同时进行。
7. 最后才调整 NSIS 压缩、更新差分和下载策略。

AI-B 必须分别记录：

```text
Shell + UI
Node Sidecar + Node dependencies
C++ Host
AI-FREE Chromium
其他资源
安装包压缩后总大小
首次安装后的磁盘占用
```

不把系统已有 WebView2 的共享磁盘占用计入应用安装包，但必须记录没有 WebView2 的 Windows 10 安装流程。离线安装包应单独命名，避免用户误以为主安装包体积回退。

## 11. 安全门禁

- Tauri capability 按窗口 label 和本地 origin 最小授权；不使用 `windows: ["*"]` 加全部权限。
- 前端没有任意 shell、任意 Sidecar、任意文件系统或任意 URL 调用能力。
- Rust 端和 Node 端都校验 channel；不能只依赖前端隐藏按钮。
- Sidecar 只接受父 Shell 建立的私有通道，并验证 session token。
- Chromium Named Pipe 继续验证 token/profile/session/PID/HWND/协议版本和 4 MiB 帧长。
- 远程侧栏或 iframe 不直接获得本地 command；`postMessage` 同时校验 `origin`、`source`、消息类型和 payload schema。
- CSP 禁止未声明脚本和不必要远程源；开发 CSP 不进入生产。
- 更新包、Shell、Sidecar、Native Core 和 Chromium runtime 统一纳入代码签名与完整性检查。
- Tauri updater 的签名校验不得关闭，私钥只进入 CI secret；生产更新地址只使用 HTTPS。
- 安全测试包含非法 channel、路径穿越、超大消息、重复 requestId、伪造事件、Sidecar 替换和 Pipe 冒用。

## 12. 失败处理与回滚

### 12.1 开发期

- Electron 基线入口始终保留到 Gate 3。
- Tauri 失败不得自动启动 Electron；开发人员显式使用 `npm run start:electron` 对照。
- 任一契约变更导致两方不兼容时，回滚该独立提交，不用兼容分支覆盖旧逻辑。
- Native Core 出现崩溃时保留 dump、日志、parent/browser HWND、PID、DPI 和最后命令，不吞异常继续运行。

### 12.2 发布期

- 切换前建立 `pre-tauri-cutover` 标签和最后一个 Electron 安装包归档。
- Tauri 首版使用独立灰度渠道；不能覆盖全部用户后再验证数据迁移。
- 回滚安装不得删除已经升级的用户数据；数据格式新增字段必须向后兼容或提供降级转换。
- 最终产品不包含“失败后回退 Electron”的隐藏代码；发布回滚通过安装旧签名版本完成。

## 13. 三个 AI 的可复制启动提示词

### 13.1 AI-A 提示词

```text
你是 AI-A，负责 UI 与等价契约。工作目录必须是 app2.1-agent-a，分支必须是
migration/a-ui-contract，基线为 <BASELINE_SHA>。完整阅读
docs/architecture/Tauri2-WebView2三AI并行等价迁移执行方案.md。

只修改文档规定的 AI-A 独占目录。不要修改 package.json、锁文件、src-tauri、
sidecar、native 或 chromium-fork。先生成 Electron UI/IPC/事件/截图基线，再实现
window.electronAPI 的 Tauri 兼容桥和双运行器 UI 测试。不得改变可见 UI、CSS、
文案或业务规则。每个提交必须可独立验证，并维护
docs/architecture/migration-handoffs/AI-A-UI.md。遇到契约冲突时停止并记录，不越权
修改 AI-B/AI-C 文件。完成 Gate 1 后报告提交 SHA、命令、结果和未解决项。
```

### 13.2 AI-B 提示词

```text
你是 AI-B，负责 Tauri 2 Shell、Node Sidecar、平台适配和最终集成。工作目录必须是
app2.1-agent-b，分支必须是 migration/b-tauri-sidecar，基线为 <BASELINE_SHA>。
完整阅读 docs/architecture/Tauri2-WebView2三AI并行等价迁移执行方案.md。

只修改文档规定的 AI-B 独占目录；在进入 integration 分支前不要修改 AI-A UI 资产
或 AI-C native/chromium 文件。固定 Tauri minor 和 Node 24.11.1，先建立 mock native
adapter、Sidecar supervisor 与协议测试，再复刻窗口、生命周期、数据路径、安全存储、
更新和安装。页面只能通过兼容 bridge 调用，不直接散布 Tauri API。远程内容没有本地
权限。维护 docs/architecture/migration-handoffs/AI-B-SHELL.md。Gate 1 后转到
migration/integration，按本文顺序 cherry-pick A/C 的已验收提交并统一修改共享配置。
不要删除 Electron，直到 Gate 3 全部通过。
```

### 13.3 AI-C 提示词

```text
你是 AI-C，负责 C++ Browser Host Core、旧 N-API 对照适配、Tauri Rust FFI 交付物、
AI-FREE Chromium 功能补齐和 runtime 精简。工作目录必须是 app2.1-agent-c，分支必须
是 migration/c-native-chromium，基线为 <BASELINE_SHA>。完整阅读
docs/architecture/Tauri2-WebView2三AI并行等价迁移执行方案.md。

只修改文档规定的 AI-C 独占目录。不要修改 UI、Node 业务、src-tauri/tauri.conf.json、
package.json 或锁文件。先把 Win32 核心从 N-API 抽成稳定 C ABI，使旧 N-API 与 Rust
消费同一 Core；再建立 Electron/Tauri 双 parent HWND 验收。盘点并补齐扩展、代理、
下载、文件上传、新窗口、权限、上下文菜单、缩放和回收等 Electron 依赖。正式模式
不得使用系统 Chrome、CDP 或 prototype 回退。runtime 精简必须逐项测试，优先排除
.pak.info，不得只复制 EXE。维护
docs/architecture/migration-handoffs/AI-C-NATIVE.md。完成 Gate 1 后报告提交 SHA、
命令、结果、runtime manifest 和未解决项。
```

## 14. 官方技术依据

- Tauri 使用操作系统 WebView，Windows 下为 WebView2：<https://v2.tauri.app/concept/process-model/>
- Tauri 2 capability/permission：<https://v2.tauri.app/security/capabilities/>
- Tauri 前后端 command/event/channel：<https://v2.tauri.app/develop/calling-rust/>、<https://v2.tauri.app/develop/calling-frontend/>
- Tauri Sidecar：<https://v2.tauri.app/develop/sidecar/>、<https://v2.tauri.app/learn/sidecar-nodejs/>
- Tauri Windows 安装器与 WebView2 模式：<https://v2.tauri.app/distribute/windows-installer/>
- Tauri updater：<https://v2.tauri.app/plugin/updater/>
- Microsoft WebView2 Evergreen 与 Fixed Version：<https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version>
- Microsoft Windows Job Objects：<https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- Tauri `Window` 暴露原生 window handle：<https://docs.rs/tauri/latest/tauri/window/struct.Window.html>
- Tauri 初始化脚本和 child webview 注意事项：<https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html>

所有新增依赖在实现时必须记录准确版本并进入 lockfile。不得仅按本文链接中的“latest”浮动构建生产版本。

## 15. 最终完成判定

只有同时满足以下条件，才能宣布“Electron 已被等价替换”：

- [ ] Gate 0、Gate 1、Gate 2、Gate 3 全部通过并有日志。
- [ ] 功能等价矩阵每一行都有 Electron/Tauri 双侧证据。
- [ ] UI 无未经批准的可见变化。
- [ ] 旧用户数据、账号、许可证和 Chromium Profile 可直接使用。
- [ ] 最终 Tauri 父窗口下重新通过 Phase 2、Phase 3、输入、500 次切换和 2 小时 soak。
- [ ] 扩展、代理、下载、上传、新窗口、权限和异常回收不存在 Electron only 项。
- [ ] 主安装包只携带 AI-FREE Chromium，不携带 Electron Chromium 或 WebView2 Fixed Runtime。
- [ ] 安装、升级、更新、卸载、代码签名和回滚均完成真实 Windows 验收。
- [ ] 最终运行进程中不存在 Electron，失败时也不会静默回退 Electron/系统浏览器。
- [ ] `项目文件职责说明.md`、构建说明和运行说明已更新到 Tauri 架构。

在最后一个复选框完成前，旧 Electron 代码属于迁移基线，不能提前删除。
