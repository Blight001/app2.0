# AI-FREE 原生鼠标 Sidecar 落地方案

## 1. 背景与结论

Electron 透明 `BrowserWindow` 方案需要经过主进程采样、跨进程消息、Chromium 合成和透明窗口 Z 序，容易受到主线程负载、IPC 排队和外部原生子窗口重排影响。继续提高轮询频率只能改善平均帧率，无法稳定保证高刷新率、低延迟和原生软件上层显示。

新方案采用独立的用户态 Win32 Sidecar：

- `ai-free-cursor-host.exe` 独占虚拟鼠标显示、系统指针显隐和动画时钟。
- 使用 DirectComposition/Direct2D 在独立线程绘制。
- 主程序只发送栏目、区域和动作意图，不逐帧发送坐标。
- 浏览器栏目和软件栏目共用同一协议、同一进程和同一状态源。
- 真实输入派发继续由 Chromium Runtime 或 Native Host 负责，显示失败不得影响点击。

不引入内核驱动、DLL 注入或 Windows 全局鼠标方案替换。

## 2. 目标

### 2.1 功能目标

1. 每个栏目拥有独立的虚拟鼠标状态和最终坐标。
2. 栏目激活后立即显示；首次位置取栏目内真实鼠标坐标，否则取栏目中心。
3. 真实鼠标进入活动栏目后隐藏系统指针，由原生虚拟鼠标无缝接管。
4. 真实鼠标离开、主窗口失焦、最小化、隐藏或 Sidecar 失联时立即恢复系统指针。
5. 自动化开始时，从该栏目的最后坐标平滑移动到目标。
6. 点击到达目标后播放按下、图案或波纹反馈，反馈结束后保持最终位置。
7. 非活动栏目不显示，但继续保存坐标。
8. 浮层完全穿透命中测试，不改变真实输入目标。
9. 浏览器和外部软件通过相同接口接入，不保留 Electron 鼠标浮层或 Chromium 自绘鼠标。

### 2.2 性能目标

| 指标 | 最低要求 | 目标值 |
|---|---:|---:|
| 真实鼠标采样 | 120 Hz | 500 Hz 或事件驱动 |
| 显示帧率 | 60 FPS | 跟随显示器 120/144 Hz |
| 坐标到画面延迟 | 小于 2 帧 | 小于 1 帧 |
| 主进程逐帧 IPC | 0 | 0 |
| 连续拖动丢帧率 | 小于 2% | 小于 0.5% |
| Sidecar 崩溃后的系统鼠标恢复 | 500 ms 内 | 100 ms 内 |

## 3. 目录与产物

```text
native/
└─ cursor-host/
   ├─ CMakeLists.txt
   ├─ src/
   ├─ test/
   └─ README.md

resources/
├─ cursors/
│  └─ [CC] Handwrite v1.ani
└─ cursor-runtime/
   ├─ ai-free-cursor-host.exe
   └─ cursor-runtime-manifest.json
```

`resources/cursors` 只保存资产；可执行文件放入 `resources/cursor-runtime`，避免把数据资源与可执行契约混在一起。

开发、生成和打包统一通过项目构建脚本完成，不手工编辑 `.generated/`、`appbuild/` 或打包目录。

## 4. 总体架构

```text
AI-FREE Main
  ├─ CursorSidecarService
  │    ├─ 进程启动/停止
  │    ├─ Named Pipe 握手
  │    ├─ 心跳与租约
  │    └─ 栏目与自动化意图
  │
  ├─ Chromium Runtime ──真实浏览器输入
  └─ External App Runtime ──真实软件输入
             │
             ▼
ai-free-cursor-host.exe
  ├─ InputSampler
  ├─ TargetWindowResolver
  ├─ CursorStateStore
  ├─ AnimationTimeline
  ├─ DirectCompositionRenderer
  ├─ SystemCursorLease
  └─ NamedPipeServer
```

主程序不再拥有鼠标逐帧状态。Sidecar 是显示状态的唯一真源，主程序只保存可恢复的栏目最终坐标快照。

## 5. Sidecar 内部模块

### 5.1 InputSampler

- 优先使用 `WH_MOUSE_LL` 获取真实鼠标移动事件。
- 使用 `GetCursorPos` 校正绝对位置，避免钩子丢事件后产生累计误差。
- 鼠标钩子只采样，不拦截、不修改真实输入。
- 输入线程只写入无锁的“最新位置槽位”，渲染线程每帧读取最新值。
- 禁止为每个移动事件分配对象或发送 IPC。

### 5.2 TargetWindowResolver

不能只用矩形判断鼠标是否进入 AI-FREE，否则其他窗口覆盖相同区域时会错误隐藏系统鼠标。

每次进入、离开或前台窗口变化时：

1. 使用 `WindowFromPoint` 获取实际命中 HWND。
2. 沿 `GetParent`、`GetAncestor(GA_ROOT)` 和 `GetWindow(GW_OWNER)` 检查窗口归属。
3. 确认命中窗口属于 AI-FREE 主窗口、嵌入 Chromium 或当前嵌入软件。
4. 检查主窗口可见、未最小化且属于前台窗口树。
5. 条件全部成立才允许隐藏系统指针和显示原生浮层。

窗口解析使用事件与短期缓存，不在每个渲染帧遍历完整窗口树。

### 5.3 CursorStateStore

按 `tabId` 保存：

```text
tabId
targetHwnd
targetRectPhysical
positionPhysical
cursorAssetId
visible
followingUser
automationSequence
feedbackState
updatedAt
```

约束：

- 只有活动栏目可以进入 `visible`。
- 切换栏目时先结束旧栏目的系统指针租约，再激活新栏目。
- 栏目坐标使用物理屏幕坐标存储，避免跨显示器缩放时重复换算。
- 主程序只在位置稳定、栏目切换或进程退出时接收坐标快照。

### 5.4 AnimationTimeline

Sidecar 本地执行自动化动画：

```text
startPosition
targetPosition
startTimestamp
duration
easing
sequenceId
```

- 使用高精度单调时钟。
- 渲染线程根据当前时间计算位置，不依赖定时器回调次数。
- 新动作通过递增 `sequenceId` 取消旧动作。
- 到达目标后先产生 `ARRIVED` 事件；主程序收到后才派发真实点击。
- 点击结果不依赖反馈是否成功。
- 主程序必须为 `ARRIVED` 设置超时；超时后仍可派发真实输入，但记录显示层故障。

### 5.5 DirectCompositionRenderer

建议采用：

- 无边框 `WS_POPUP` 工具窗口。
- `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT`。
- `WM_NCHITTEST` 永远返回 `HTTRANSPARENT`。
- DirectComposition 负责位置、透明度和缩放合成。
- Direct2D 或 WIC 负责光标帧解码。
- 使用 `DwmFlush` 或 DirectComposition 提交节奏同步桌面合成。
- 按显示器刷新率运行；窗口跨屏时重建对应显示器的呈现参数。
- 光标图层保持最小尺寸，不创建覆盖整个屏幕的大型透明像素缓冲。

Z 序规则：

- 仅当 AI-FREE 窗口树是实际前台目标时提升浮层。
- 不使用永久 `TOPMOST`。
- 对嵌入软件重新聚焦、宿主窗口重排和 DPI 变化事件执行一次 Z 序修复。
- AI-FREE 失焦时立即隐藏，禁止覆盖其他应用。

### 5.6 CursorAssetCache

- Sidecar 直接读取 `resources/cursors`。
- 启动时解析 ANI 元数据并预解码所有帧。
- 缓存热点、帧序列和帧持续时间。
- 播放过程不进行文件 IO、Base64 转换或重复图片解码。
- 资源加载失败时使用内置静态回退指针，不能导致进程退出。

### 5.7 SystemCursorLease

系统指针显隐必须是租约，不是一个孤立的布尔值。

租约生效条件：

- Sidecar 与主程序心跳正常。
- AI-FREE 主窗口可见、未最小化并属于前台窗口树。
- 鼠标实际命中当前活动栏目窗口树。
- 原生浮层可见且至少成功提交一帧。

恢复条件：

- 鼠标离开目标窗口树。
- 主窗口失焦、隐藏、最小化或退出。
- 栏目切换或目标 HWND 销毁。
- 渲染设备丢失。
- Named Pipe 断开或心跳超时。
- Sidecar 收到关闭信号。

实现要求：

- 记录自身对 `ShowCursor` 计数器所做的调整，并成对恢复。
- 同时注册进程退出、异常处理和控制台关闭清理。
- 主程序保留独立 watchdog；Sidecar 失联时启动一个仅负责恢复指针的安全路径。
- 不使用 `SetSystemCursor`，避免修改用户全局鼠标资源。

## 6. IPC 协议

### 6.1 传输

- 使用仅限当前用户会话访问的 Windows Named Pipe。
- 每次启动生成随机 pipe 名称和 256-bit 启动令牌。
- 首帧必须完成版本、PID、令牌和会话校验。
- 消息使用长度前缀 JSON；资源帧不通过 IPC 传输，只传资产 ID。
- 单条消息限制大小，拒绝未知命令和过期 `sequenceId`。

### 6.2 命令

```text
HELLO
REGISTER_TARGET
REMOVE_TARGET
ACTIVATE_TARGET
UPDATE_TARGET_RECT
SET_CURSOR_ASSET
MOVE_AUTOMATION
CLICK_FEEDBACK
SUSPEND
RESUME
SHUTDOWN
PING
```

`REGISTER_TARGET`：

```json
{
  "tabId": "stable-tab-id",
  "targetHwnd": "123456",
  "ownerHwnd": "654321",
  "rectPhysical": {"x": 0, "y": 0, "width": 1200, "height": 800},
  "initialPosition": {"x": 600, "y": 400}
}
```

`MOVE_AUTOMATION`：

```json
{
  "tabId": "stable-tab-id",
  "sequenceId": 42,
  "targetPhysical": {"x": 850, "y": 520},
  "durationMs": 180,
  "easing": "ease-out"
}
```

### 6.3 事件

```text
READY
POSITION_SNAPSHOT
ARRIVED
FEEDBACK_FINISHED
TARGET_LOST
RENDER_DEVICE_LOST
CURSOR_RESTORED
PONG
ERROR
```

所有请求和事件携带 `sessionId`、`tabId`、`sequenceId` 或 `requestId`，防止旧响应污染新栏目。

## 7. 主程序接入

新增 `main/features/cursor-sidecar` 业务域：

```text
cursor-sidecar-service.js
cursor-sidecar-client.js
cursor-sidecar-process.js
cursor-sidecar-protocol.js
```

职责边界：

- `main/composition` 只创建服务并注入 Browser Runtime、External App Runtime 和 Tab Manager。
- `CursorSidecarService` 管理栏目注册、激活、区域同步和生命周期。
- Chromium 与软件自动化只调用统一的 `moveAndWait()`、`feedback()`。
- renderer/sidebar 不接触 Sidecar、不新增 `window.*` API。
- 不新增第二套 Electron 浮层兼容层。

### 7.1 浏览器栏目

Chromium Runtime 在 HWND 附着完成后注册：

- `tabId`
- Chromium HWND
- AI-FREE 主窗口 HWND
- 物理屏幕区域

目标坐标必须由 Chromium 内核解析为权威物理屏幕坐标。禁止在主程序中通过固定工具栏高度或经验偏移换算。

推荐两阶段动作：

1. Chromium 解析目标但不点击，返回物理屏幕坐标和提交坐标。
2. Sidecar 移动并返回 `ARRIVED`。
3. Chromium 使用同一次解析得到的提交坐标派发真实输入。

三步必须在同一个 Profile 操作事务中，禁止其他导航或动作插入。

### 7.2 软件栏目

External App Runtime 在窗口嵌入成功后注册目标 HWND 与物理区域。

软件 UI 自动化获得的 UIA/视觉坐标统一转换为物理屏幕坐标后交给 Sidecar。真实输入仍由 Native Host 派发；Sidecar 不调用 `SendInput`。

### 7.3 栏目生命周期

| AI-FREE 事件 | Sidecar 动作 |
|---|---|
| 新建栏目 | `REGISTER_TARGET` |
| 激活栏目 | `ACTIVATE_TARGET` |
| 布局变化 | `UPDATE_TARGET_RECT` |
| 切换栏目 | 保存旧坐标并激活新目标 |
| 关闭栏目 | `REMOVE_TARGET` |
| 最小化/隐藏 | `SUSPEND` |
| 恢复 | `RESUME` 并重新校验 HWND |
| 应用退出 | `SHUTDOWN`，超时后终止进程 |

## 8. 失败隔离

- Sidecar 未启动：真实输入继续执行，不显示虚拟鼠标，系统鼠标保持可见。
- Sidecar 动画超时：记录错误后继续派发真实输入。
- 目标 HWND 失效：Sidecar 恢复系统指针并上报 `TARGET_LOST`。
- DirectComposition 设备丢失：立即恢复系统指针，重建设备，成功提交首帧后再获取租约。
- 主程序崩溃：心跳超时触发 Sidecar 恢复指针并退出。
- Sidecar 崩溃：主程序 watchdog 确保系统指针可见，并按退避策略重启一次。
- 连续失败超过阈值：本次会话禁用虚拟鼠标，不能反复闪烁或影响点击。

## 9. 分阶段实施

### 阶段 A：性能与安全原型

只实现：

- 单个 HWND 目标。
- 真实鼠标跟随。
- DirectComposition 静态光标。
- 系统指针租约。
- 前台/遮挡判定。
- 心跳断开恢复。

验收后才能继续。原型必须证明：

- 120/144 Hz 显示器上接近刷新率。
- 连续快速拖动无明显拖尾。
- 其他窗口覆盖 AI-FREE 时不隐藏系统鼠标。
- 强制结束主程序和 Sidecar 后系统鼠标均可恢复。

### 阶段 B：多栏目状态机

- 加入 `REGISTER_TARGET`、`ACTIVATE_TARGET` 和坐标快照。
- 覆盖浏览器/软件切换、关闭、最小化和多显示器。
- 主程序只保存稳定快照。

### 阶段 C：自动化动画与反馈

- 加入本地时间线、`sequenceId` 取消、`ARRIVED`。
- 加入 ANI 预解码、按下状态和波纹。
- 验证显示失败不阻断点击。

### 阶段 D：浏览器权威坐标

- Chromium 增加目标预解析协议。
- 屏幕坐标和真实提交坐标由同一解析结果产生。
- 整个预解析—动画—点击保持单事务。

### 阶段 E：完整替换

完成所有验收后：

1. 删除 Electron `BrowserWindow` 鼠标浮层。
2. 删除 Chromium 自绘动画鼠标。
3. 删除任何系统鼠标换图案兼容路径。
4. 删除逐帧鼠标 IPC。
5. 保留且只保留 Sidecar 统一接口。

不得以“暂时兼容”为理由长期保留两套显示实现。

## 10. 测试与门禁

### 10.1 单元测试

- 协议解析、大小限制和会话校验。
- 栏目独立坐标与切换恢复。
- `sequenceId` 取消和过期事件丢弃。
- 心跳租约超时。
- 系统指针显隐调用严格配对。
- DPI/物理坐标换算。
- Sidecar 不可用时真实输入继续。

### 10.2 Native 测试

- 60/120/144 Hz 帧时间统计。
- 多显示器和 100%/125%/150%/200% 混合 DPI。
- `WindowFromPoint` 遮挡判定。
- HWND 销毁、重建和进程退出。
- DirectComposition 设备丢失与恢复。
- 强制结束主程序/Sidecar 后系统鼠标恢复。
- 浮层 `HTTRANSPARENT` 命中测试。

### 10.3 集成测试

- 浏览器、软件各自跟随和自动化点击。
- 同一坐标的显示位置与真实点击位置误差不超过 1 物理像素。
- 栏目切换不继承坐标。
- 最小化后屏幕不存在孤儿鼠标。
- 其他应用覆盖 AI-FREE 时无顶层泄漏。
- 1000 次自动化动作无重复鼠标或残留浮层。

### 10.4 项目门禁

按风险依次运行：

```text
原生 Cursor Host 单元/性能测试
npm run guardrails
npm run verify
npm run test:acceptance
npm run accept:chromium-phase3
npm run build:win
npm run check:packaged-runtime
```

任何性能指标或系统指针恢复测试失败，都不能进入完整替换阶段。

## 11. 打包与更新

- Cursor Host 必须静态链接运行库或随包提供明确依赖。
- 对 EXE 和 manifest 记录 SHA-256，启动前校验。
- Windows 安装包为 Cursor Host 添加代码签名，降低安全软件误报。
- 源码测试、`.generated/app` 和打包态统一通过路径解析模块定位。
- 更新时先写入新版本目录，验证后原子切换 manifest，禁止覆盖正在运行的 EXE。
- 主程序与 Sidecar 协议版本不兼容时拒绝连接，系统鼠标保持可见。

## 12. 可观测性

仅记录结构化、低频事件：

- 启动、握手、协议版本。
- 激活目标和 HWND 失效。
- 平均/95/99 分位帧时间。
- 动画超时、设备丢失和恢复。
- 系统指针租约获取/释放原因。

禁止记录逐帧坐标、用户输入内容、窗口标题中的敏感信息或任何凭据。

## 13. 完成定义

方案只有同时满足以下条件才算完成：

- 浏览器和软件只使用一个 Sidecar 显示实现。
- 真实拖动在 120/144 Hz 显示器上无明显低帧率和拖尾。
- 显示位置与真实点击坐标一致，无固定偏移补丁。
- 最小化、失焦、遮挡、崩溃和强制退出均能恢复系统鼠标。
- 浮层不接收鼠标事件，不影响真实输入。
- Sidecar 显示失败不会导致自动化动作失败。
- 源码、开发生成态和打包态全部通过对应门禁。
- Electron 浮层、Chromium 自绘鼠标和系统图案替换旧路径已经删除。

