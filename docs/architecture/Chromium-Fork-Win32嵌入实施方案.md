# Chromium Fork + Win32 窗口嵌入实施方案

状态：客户端底座已实现，待 Native 工具链与 Chromium Fork 联调验收  
适用平台：Windows x64  
客户端基线：Electron 管理器 + 独立 Chromium Fork 进程  
文档目标：指导从当前 `BrowserView` 浏览器实现，渐进迁移到完整 Chromium 内核，同时保留现有主窗口、侧边栏和环境切换交互。

## 1. 决策摘要

采用“Electron 控制平面 + 独立 Chromium 数据平面 + Win32 子窗口嵌入”的混合架构。

- Electron 继续负责许可证、账号、环境列表、代理、AI 调度、侧边栏和应用生命周期。
- Chromium Fork 负责网页渲染、原生标签、扩展系统、下载、权限、沙箱和 Profile 数据。
- Chromium 是独立进程，不使用 Electron 的扩展运行时。
- Electron 在网页显示区域创建专用原生宿主窗口 `BrowserHost HWND`。
- Chromium 主窗口通过 `SetParent` 挂载到 `BrowserHost HWND`，形成视觉和输入层面的窗口内嵌。
- Electron 顶层标签优先表示“浏览器环境/Profile”；环境内部网页标签由 Chromium 原生管理。
- Electron 与 Chromium 使用受认证的本地命名管道通信；CDP 仅作为开发和自动化通道，不对局域网开放。

该方案不使用截图、视频编码或 JPEG 串流，因此网页清晰度、输入延迟、视频播放和 GPU 加速保持原生水平。

## 2. 目标与非目标

### 2.1 第一阶段目标

1. 在 Electron 主窗口指定矩形区域内显示完整 Chromium 窗口。
2. 保留 Chromium 多进程沙箱、Site Isolation 和 GPU 加速。
3. 一个 Profile 对应独立 `user-data-dir`、代理、扩展配置和 Chromium 运行实例。
4. Electron 可启动、显示、隐藏、调整尺寸、切换和关闭 Chromium 实例。
5. 支持中文输入法、剪贴板、拖拽、文件上传、下载和视频播放。
6. 支持完整 Chromium 扩展后台、Content Script、Popup 和原生标签语义。
7. Chromium 崩溃后 Electron 不退出，并可显示错误占位页和重新启动环境。
8. 当前 Electron BrowserView 模式在迁移期保留，作为兼容和回退模式。

### 2.2 第一阶段非目标

- 不同时支持 macOS/Linux。
- 不在首版实现多个 Chromium 内核版本。
- 不大规模修改 Chromium 原生标签栏、地址栏和设置页面。
- 不让 Electron 自定义标签栏映射 Chromium 中的每一个网页 Target。
- 不使用 `--no-sandbox`、`--single-process`、`--disable-web-security`。
- 不开放 `0.0.0.0` CDP 端口。
- 不在第一阶段完成全部指纹参数；先建立稳定运行底座和补丁体系。

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────┐
│ Electron 管理器                                         │
│                                                         │
│  ┌───────────────┐  ┌────────────────────────────────┐ │
│  │ 环境/Profile栏 │  │ 本地 UI / 侧边栏 / AI 控制     │ │
│  └───────────────┘  └────────────────────────────────┘ │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │ BrowserHost HWND                                   │ │
│  │  └─ Chromium Browser HWND                          │ │
│  │      ├─ 原生标签和地址栏                           │ │
│  │      ├─ 原生扩展系统                               │ │
│  │      └─ 网页渲染区域                               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                 │                  │
                 │ Win32 HWND       │ 命名管道 / 私有 CDP
                 ▼                  ▼
        Chromium Fork 进程       Browser Runtime 服务
```

### 3.1 进程职责

| 进程/模块 | 主要职责 |
|---|---|
| Electron Main | 应用生命周期、Profile 管理、IPC、安全策略、窗口布局 |
| Electron Renderer | 环境列表、控制栏、侧边栏和用户操作 |
| Native Browser Host | 创建宿主 HWND、嵌入/解绑、DPI、焦点、Z 序、进程监控 |
| Chromium Browser | 原生浏览器窗口、标签、扩展、下载、Profile、网络和沙箱 |
| Chromium Renderer/GPU | 网页执行、合成和硬件加速 |
| Runtime Bridge | Electron 与 Chromium 的受认证状态/命令通信 |

## 4. UI 与标签模型

### 4.1 推荐模型

```text
Electron 环境标签 A
└─ Chromium Profile A
   ├─ Chromium 网页标签 1
   ├─ Chromium 网页标签 2
   └─ Chromium 网页标签 3

Electron 环境标签 B
└─ Chromium Profile B
   └─ Chromium 网页标签 1
```

Electron 只负责 Profile 级切换：

- 选中环境 A：显示 A 的宿主窗口，隐藏其他环境宿主窗口。
- 选中环境 B：显示 B 的宿主窗口，将焦点交给 B。
- Chromium 内部标签切换由 Chromium 原生 UI 处理。

这种映射能保持扩展的 `currentWindow`、`activeTab` 和原生 Popup 语义，避免 Electron 与 Chromium 同时管理网页标签产生状态冲突。

### 4.2 Electron 覆盖层限制

Chromium HWND 是原生子窗口，会位于 Electron 网页渲染层之上。Electron HTML/CSS 的 `z-index` 不能覆盖 Chromium 区域。

因此：

- Electron 顶栏和侧栏必须占据独立、不重叠的布局区域。
- 需要覆盖 Chromium 的应用弹窗应使用独立 `BrowserWindow` 或原生窗口。
- 网页区域内的 Toast、光标动效和引导应由 Chromium 内置扩展渲染。
- 加载中、崩溃和未启动占位页由 BrowserHost 自己绘制，或暂时隐藏 Chromium 后显示 Electron 占位层。

## 5. 客户端模块设计

建议新增：

```text
src/app/main/browser-runtime/
├── browser-runtime.js          # 统一运行时接口
├── electron-runtime.js         # 当前 BrowserView 兼容实现
├── chromium-runtime.js         # Chromium 进程与嵌入实现
├── profile-runtime-store.js    # 运行中的 Profile 状态
├── chromium-launcher.js        # 启动参数、路径和进程句柄
├── chromium-window-bridge.js   # HWND/命名管道事件桥
├── chromium-command-client.js  # 运行时命令客户端
├── chromium-health.js          # 心跳、崩溃与恢复
└── runtime-types.js            # 状态常量与数据规范

native/browser-host/
├── binding.gyp
├── package.json
├── src/
│   ├── addon.cc
│   ├── browser_host_window.cc
│   ├── browser_host_window.h
│   ├── child_window_manager.cc
│   ├── child_window_manager.h
│   ├── dpi_manager.cc
│   ├── focus_manager.cc
│   └── process_monitor.cc
└── test/
    ├── host_window.test.js
    └── embed_smoke.test.js
```

### 5.1 统一 BrowserRuntime 接口

```js
class BrowserRuntime {
  async launchProfile(profile, bounds) {}
  async attach(profileId) {}
  async show(profileId) {}
  async hide(profileId) {}
  async resize(profileId, bounds) {}
  async focus(profileId) {}
  async getState(profileId) {}
  async reload(profileId) {}
  async stop(profileId, options) {}
}
```

当前 `tab-manager.js` 不直接调用 Win32 接口，而是依赖 `BrowserRuntime`。迁移期可根据 Profile 配置选择：

```text
runtimeType = electron   -> ElectronRuntime
runtimeType = chromium   -> ChromiumRuntime
```

### 5.2 运行状态模型

```js
{
  profileId: 'profile_001',
  runtimeType: 'chromium',
  status: 'starting', // stopped|starting|attaching|ready|hidden|crashed|stopping
  pid: 0,
  processHandle: null,
  browserHwnd: null,
  hostHwnd: null,
  parentHwnd: null,
  pipeName: '',
  sessionToken: '',
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  dpi: 96,
  lastHeartbeatAt: 0,
  lastError: null
}
```

所有窗口操作必须经过状态机，禁止在多个事件处理器中直接散落调用 `SetParent`、`ShowWindow` 和 `SetWindowPos`。

## 6. Native Browser Host API

建议通过 N-API 暴露最小能力：

```js
createHostWindow({ parentHwnd, x, y, width, height })
destroyHostWindow(hostHwnd)
attachChildWindow({ hostHwnd, childHwnd, childPid })
detachChildWindow({ hostHwnd, childHwnd })
setHostBounds({ hostHwnd, x, y, width, height })
showHostWindow(hostHwnd)
hideHostWindow(hostHwnd)
focusChildWindow(childHwnd)
isWindowAlive(hwnd)
getWindowProcessId(hwnd)
```

### 6.1 HWND 校验

绑定前必须验证：

1. `IsWindow(childHwnd)` 为真。
2. `GetWindowThreadProcessId` 返回预期 Chromium PID。
3. Chromium PID 由当前 Electron 实例启动并持有进程句柄。
4. Electron 与 Chromium 位于同一 Windows Session。
5. 两个进程均不是提权运行。
6. Chromium 返回的会话令牌与本次启动令牌一致。

### 6.2 嵌入顺序

```text
1. 创建 BrowserHost HWND
2. 启动 Chromium Fork
3. Chromium 通过命名管道完成握手
4. 校验 PID、HWND、Profile ID 和 Token
5. 隐藏 Chromium 窗口，避免样式切换闪烁
6. 读取并保存原始 GWL_STYLE / GWL_EXSTYLE / Parent
7. 清除 WS_POPUP，增加 WS_CHILD、WS_CLIPCHILDREN、WS_CLIPSIBLINGS
8. SetParent(chromiumHwnd, hostHwnd)
9. SetWindowPos(..., SWP_FRAMECHANGED | SWP_SHOWWINDOW)
10. 同步 UI State、DPI、尺寸和焦点
11. 状态切换为 ready
```

### 6.3 解绑顺序

```text
1. 停止向 Chromium 派发新命令
2. 隐藏宿主窗口
3. SetParent(chromiumHwnd, NULL)
4. 恢复原始 WS_CHILD / WS_POPUP / 扩展样式
5. 恢复或关闭 Chromium 顶层窗口
6. 销毁 BrowserHost HWND
7. 清理句柄、命名管道和运行状态
```

异常退出时允许跳过已失效 HWND，但必须关闭进程句柄和删除运行态记录。

## 7. Chromium Fork 改动

### 7.1 启动参数

新增私有参数：

```text
--hs-embed-parent-hwnd=<decimal-hwnd>
--hs-profile-id=<profile-id>
--hs-runtime-pipe=<pipe-name>
--hs-runtime-token=<one-time-token>
--hs-embed-mode=child-window
```

正式版本不应把长期密钥放入命令行。`--hs-runtime-token` 只作为一次性启动挑战，完成命名管道握手后立即失效；后续会话密钥在管道中协商。

### 7.2 主动嵌入

原型阶段由 Electron 枚举窗口并调用 `SetParent`。正式版本改为 Chromium 在 Browser Window 创建完成后：

1. 连接指定命名管道。
2. 发送 `hello`，包含 PID、Profile ID、Browser HWND 和一次性 Token。
3. 等待 Electron 返回 `attach-approved`。
4. Chromium 或 Native Host 完成样式切换和 `SetParent`。
5. 返回 `window-ready`。

主动握手避免通过窗口类名猜测主窗口，也避免误绑定扩展 Popup、DevTools 或第二个浏览器窗口。

### 7.3 Chromium 补丁边界

第一阶段只维护以下补丁：

```text
patches/
├── 0001-hs-branding.patch
├── 0002-hs-runtime-switches.patch
├── 0003-hs-runtime-pipe.patch
├── 0004-hs-browser-window-handshake.patch
├── 0005-hs-embedded-window-lifecycle.patch
└── 0006-hs-extension-bootstrap.patch
```

窗口嵌入稳定后，再新增 Profile 指纹补丁。禁止把窗口嵌入、指纹、网络和产品 UI 混在同一个大补丁中。

## 8. Runtime Bridge 协议

### 8.1 传输

- Windows Named Pipe，默认拒绝网络访问。
- Pipe ACL 只允许当前 Windows 用户和启动进程。
- 每个 Profile 实例使用独立 Pipe 名称。
- 消息使用长度前缀 + UTF-8 JSON；后续高频消息可迁移到 Protobuf。
- 每条消息包含 `protocolVersion`、`profileId`、`requestId`。

### 8.2 握手示例

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "profileId": "profile_001",
  "pid": 1234,
  "browserHwnd": "987654",
  "launchToken": "one-time-token"
}
```

```json
{
  "type": "hello-accepted",
  "protocolVersion": 1,
  "profileId": "profile_001",
  "sessionId": "runtime-session-id",
  "heartbeatIntervalMs": 3000
}
```

### 8.3 最小事件集合

```text
Chromium -> Electron
browser-window-ready
browser-window-created
browser-window-closed
active-tab-changed
title-changed
url-changed
loading-state-changed
download-created
permission-requested
fullscreen-changed
heartbeat
fatal-error

Electron -> Chromium
set-bounds
show
hide
focus
navigate
reload
go-back
go-forward
open-devtools
close-browser
prepare-update
```

## 9. Profile 与文件布局

```text
userData/
└── chromium-profiles/
    └── profile_001/
        ├── profile.json
        ├── chromium-data/
        ├── extensions.json
        ├── proxy.enc
        ├── fingerprint.json
        ├── downloads/
        ├── crashpad/
        └── logs/
```

Profile ID 必须使用内部不可变 ID。账号名称、平台名称和备注可以修改，但不能改变分区路径。

同一个 Profile 同一时间只允许一个 Chromium Browser 进程持有写锁，防止 Chromium 数据目录损坏。

## 10. DPI、尺寸和布局

### 10.1 DPI 基线

Electron、Native Host 和 Chromium 必须在创建第一个 HWND 前统一为 Per-Monitor DPI Aware V2。

必须测试：

- 100%、125%、150%、175%、200% 缩放。
- 主窗口跨两个不同 DPI 显示器移动。
- Electron 最大化、恢复、全屏和任务栏自动隐藏。
- 浏览器 Popup、文件对话框和 DevTools 的坐标。

### 10.2 坐标来源

Electron Renderer 只报告 CSS 布局矩形。Electron Main 将其转换为窗口 Client Pixel 坐标，再交给 Native Host。

```text
CSS Bounds
  -> deviceScaleFactor
  -> Electron Client Bounds
  -> BrowserHost Bounds
  -> Chromium Child Bounds (0, 0, width, height)
```

尺寸同步必须去抖，并使用 `SetWindowPos` 的异步/无激活选项避免拖动窗口时阻塞 UI。

## 11. 焦点、输入与快捷键

### 11.1 焦点原则

- 点击网页区域后，焦点自然进入 Chromium 子窗口。
- 点击 Electron 侧栏后，焦点回到 Electron。
- 切换环境后，对新环境调用一次受控 `focus`。
- 不长期使用 `AttachThreadInput`。

### 11.2 快捷键归属

| 快捷键类别 | 处理方 |
|---|---|
| Ctrl+L、Ctrl+T、Ctrl+W、Ctrl+Tab | Chromium |
| 网页刷新、前进后退 | Chromium，Electron 可通过 Bridge 触发 |
| 应用级显示/隐藏侧栏 | Electron 全局快捷键 |
| 开发者工具 | 根据产品设置由 Bridge 控制 |
| 退出整个应用 | Electron，先请求 Chromium 优雅关闭 |

必须维护快捷键冲突表，禁止 Electron 和 Chromium 同时响应同一个会产生状态变化的快捷键。

## 12. Popup、新窗口和系统对话框

### 12.1 允许保持顶层的窗口

- 文件选择器
- 保存对话框
- 打印对话框
- 摄像头/麦克风系统授权
- 外部 OAuth 登录窗口（按安全策略）

这些窗口应以 Chromium Browser HWND 为 Owner，显示在 Electron 主窗口上方。

### 12.2 需要纳入管理的 Chromium 窗口

- 第二个普通浏览器窗口
- DevTools
- 扩展创建的独立窗口
- 画中画窗口
- 全屏视频窗口

Chromium 必须通过 Runtime Bridge 报告新 Browser Window。第一阶段可允许其作为独立顶层窗口；后续再决定是否创建新的 BrowserHost 嵌入。

## 13. 安全要求

### 13.1 必须保留

- Chromium Sandbox
- Site Isolation
- 多进程模型
- Web Security / Same-Origin Policy
- HTTPS 证书校验
- Profile 目录隔离
- 扩展权限模型

### 13.2 禁止参数

```text
--no-sandbox
--single-process
--disable-web-security
--disable-site-isolation-trials
--allow-running-insecure-content
--remote-debugging-address=0.0.0.0
```

### 13.3 HWND 与 IPC 安全

- 不接受第三方进程提交的任意 HWND。
- 不仅校验窗口类名，必须校验 PID、进程句柄、Session 和一次性 Token。
- 不跨 Windows 用户会话嵌入。
- Electron 和 Chromium 均不以管理员身份运行。
- 命名管道使用当前用户 ACL。
- 远程网页和第三方扩展不能直接访问 Runtime Bridge 管道。
- CDP 优先使用 `--remote-debugging-pipe`；测试端口只绑定回环地址。

## 14. 生命周期与故障恢复

### 14.1 正常启动

```text
stopped
  -> starting
  -> waiting-pipe
  -> waiting-window
  -> attaching
  -> ready
```

每一步必须有超时和结构化错误码。

### 14.2 环境切换

```text
当前 Profile
  -> 保存最后活动时间
  -> 隐藏 Host HWND

目标 Profile
  -> 校验进程和 HWND
  -> 同步 Bounds
  -> 显示 Host HWND
  -> 激活 Chromium
```

### 14.3 Chromium 崩溃

1. Native Host 通过进程句柄或 `WM_PARENTNOTIFY`/句柄检查发现退出。
2. 立即清空 `browserHwnd`，禁止继续发送窗口命令。
3. BrowserHost 显示“浏览器已退出”占位状态。
4. 记录退出码、最后心跳、Profile ID 和版本。
5. 提供“重新启动环境”，复用原 Profile 数据目录。
6. 连续崩溃超过阈值后进入安全模式，临时禁用第三方扩展。

### 14.4 Electron 退出

```text
停止接收新任务
-> 通知全部 Chromium 保存并关闭
-> 等待优雅退出
-> 超时后结束子进程树
-> 解绑和销毁全部 Host HWND
-> 关闭命名管道
-> Electron 退出
```

## 15. 测试矩阵

### 15.1 嵌入基础

- Chromium 首次启动成功嵌入。
- 已存在 Profile 再次启动成功嵌入。
- Electron 移动、缩放、最大化和恢复。
- 连续切换 20 个环境无窗口错位。
- Chromium 崩溃后 Electron 保持可用。
- Electron 崩溃后 Chromium 按产品策略退出或恢复为顶层窗口。

### 15.2 输入和媒体

- 中文、英文、日文输入法。
- 复制、粘贴、撤销和全选。
- 鼠标左右键、滚轮、中键、触控板。
- HTML5 视频、WebGL、WebGPU 和全屏。
- 麦克风、摄像头和屏幕共享权限。
- 文件拖拽上传、文件选择和多文件上传。

### 15.3 插件

- Content Script 插件。
- MV3 Service Worker 插件。
- `chrome.action` Popup。
- `contextMenus`。
- `downloads`。
- `cookies`。
- `webNavigation`。
- SidePanel。
- 广告拦截类扩展。
- 密码管理类扩展（使用测试数据）。

### 15.4 DPI 和窗口

- 单显示器多缩放比例。
- 双显示器不同缩放比例。
- 插件 Popup 定位。
- 文件对话框归属。
- Electron 模态窗口是否被 Chromium 遮挡。
- Alt+Tab、Win+D、锁屏和恢复。

### 15.5 安全

- 第三方进程伪造 HWND 被拒绝。
- 错误 Token 的命名管道握手被拒绝。
- Chromium 无法嵌入提权窗口。
- CDP 未监听外部网卡。
- 所有 Chromium Renderer 保持沙箱状态。
- 不同 Profile Cookie、Storage、Cache 和扩展数据互不可见。

## 16. 分阶段实施

### Phase 0：技术验证

目标：不修改业务功能，验证 Win32 嵌入是否满足产品体验。

1. 创建最小 Native Browser Host Addon。
2. 在独立测试 Electron 窗口中创建 BrowserHost HWND。
3. 启动原版 Chromium，按 PID 找到主窗口。
4. 完成 `SetParent`、样式修改、尺寸同步和解绑。
5. 测试输入法、视频、上传、下载、扩展 Popup 和 DPI。

验收：连续运行 2 小时、切换/缩放 500 次，无白屏、错位、焦点锁死和进程泄漏。

### Phase 1：运行时抽象

1. 新建 `BrowserRuntime` 接口。
2. 封装当前 Electron BrowserView 为 `ElectronRuntime`。
3. 新建 `ChromiumRuntime`。
4. Profile 配置增加 `runtimeType`。
5. 主界面支持两种模式并存。

### Phase 2：Chromium 主动握手

1. 建立 Chromium Fork 和补丁队列。
2. 添加私有启动参数。
3. 实现命名管道握手。
4. Chromium 主动报告正确 Browser HWND。
5. 移除正式代码中的窗口类名猜测。

### Phase 3：Profile 与插件迁移

1. 将账号环境迁移到 Chromium `user-data-dir`。
2. 加载内置 Browser Automation 扩展。
3. 接入第三方扩展安装和权限展示。
4. 接入代理、下载目录和 Cookie 导入。
5. 建立 Profile 数据锁和删除流程。

### Phase 4：稳定性和安全

1. 加入 Crashpad/崩溃收集。
2. 完成进程树回收和异常恢复。
3. 完成 DPI、弹窗和多显示器测试。
4. 完成命名管道 ACL 和协议鉴权。
5. 建立 Chromium 版本和扩展回归测试。

### Phase 5：指纹内核

在窗口与 Profile 底座稳定后，再分批实现：

1. Profile 固定随机种子。
2. UA、语言、时区、分辨率一致性。
3. WebRTC 和 Geolocation。
4. Canvas/WebGL/AudioContext。
5. 字体、ClientRects、Speech Voices、WebGPU。
6. BrowserLeaks/FingerprintJS 自动回归。

## 17. 验收标准

第一代可用版本至少满足：

- 10 个 Profile 可创建并分别启动。
- 任意时刻可在 5 个运行环境间切换，无明显闪烁或错位。
- Chromium 保持完整沙箱和 GPU 加速。
- 插件 Popup、下载、文件上传和中文输入正常。
- 不同 Profile 的 Cookie、Storage、Cache、扩展数据和代理完全隔离。
- 125%/150% DPI 和双显示器环境无持续性坐标偏差。
- Chromium 崩溃不会带崩 Electron；可一键重新启动。
- Electron 正常退出后无遗留 Chromium 进程。
- 禁止参数扫描、CDP监听扫描和 IPC鉴权测试全部通过。

## 18. 主要风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| Chromium 与 Electron DPI 模式不一致 | 模糊、偏移、SetParent 异常 | 两端统一 Per-Monitor V2；建立跨屏测试 |
| Chromium HWND 覆盖 Electron DOM | HTML 弹窗不可见 | 固定不重叠布局；弹窗使用独立 BrowserWindow |
| 原生 Popup/新窗口脱离宿主 | 体验不一致 | Chromium Bridge 上报新窗口；设置正确 Owner |
| 焦点进入 Chromium 后 Electron 快捷键失效 | 操作冲突 | 明确快捷键归属；应用级动作使用全局快捷键 |
| 上游 Chromium 改动导致补丁冲突 | 版本升级困难 | 小补丁队列、固定里程碑、自动重放和回归测试 |
| Electron 异常退出遗留 Chromium | 资源泄漏 | Windows Job Object + 父进程监控 + 恢复策略 |
| 第三方插件造成崩溃或数据风险 | Profile 不稳定 | 插件权限审查、安全模式和按 Profile 禁用 |
| HWND/管道被本机恶意进程冒用 | 控制劫持 | PID/句柄/Token/ACL/Session 多重校验 |

## 19. 下一步

下一步只执行 Phase 0，不修改现有业务浏览器路径：

1. 确认本机 Node/Electron Native Addon 编译环境。
2. 建立 `native/browser-host` 最小工程。
3. 新建独立嵌入实验窗口和开发入口。
4. 使用现成 Chromium 进行 HWND 嵌入验证。
5. 输出测试记录，再决定进入 Chromium Fork 主动握手阶段。

在 Phase 0 验收前，不删除或大规模重构当前 `BrowserView`、标签管理、账号和扩展管理代码。
