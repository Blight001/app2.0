# AI-FREE API 驱动 UI 光标实施方案

## 1. 结论

`resources/cursor-runtime/ai-free-cursor-host.exe` 是一个独立的 Win32 UI
渲染进程，不是系统鼠标代理。它只接收 API 命令并显示一个置顶、透明、
不可激活、命中穿透的 UI 光标。

Host 不再：

- 采样真实鼠标；
- 隐藏或替换 Windows 系统光标；
- 查找前台窗口、子窗口或判断光标是否位于栏目内；
- 保存浏览器/软件栏目状态；
- 根据焦点或窗口关系自行决定显隐；
- 运行额外的系统光标恢复看门狗。

显隐、位置、按键和拖拽都只有一个状态源：主程序发给 Host 的协议命令。
窗口切换时，主程序明确发送 `HIDE_CURSOR` 或 `SHOW_CURSOR`。

## 2. 运行结构

```text
浏览器自动化 ─┐
              ├─ CursorSidecarService ── 命名管道 v2 ── Cursor Host
软件 UI 自动化 ┘                                      │
                                                       └─ TOPMOST UI
真实点击/键盘 ── Chromium Runtime 或 Native Host
```

真实输入与光标显示保持分离。UI 光标显示失败时，真实输入继续执行。

Host 使用：

- Win32 独立无所有者窗口；
- `HWND_TOPMOST`；
- `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT`；
- `WM_NCHITTEST -> HTTRANSPARENT`；
- DirectComposition + Direct2D；
- ANI 资源的静态第一帧，避免动画资源自身造成闪烁。

## 3. 协议 v2

所有消息使用 4 字节 little-endian 长度前缀和 UTF-8 JSON。会话由随机
256-bit token 鉴权，Host 只接受当前会话命名管道。

### 3.1 命令

| 命令 | 作用 |
|---|---|
| `HELLO` | 鉴权并确认协议版本 |
| `SHOW_CURSOR` | 显示；可同时指定 `positionPhysical` |
| `HIDE_CURSOR` | 隐藏并清除按下/拖拽/效果状态 |
| `MOVE_CURSOR` | 移动到物理屏幕坐标；`durationMs=0` 为瞬移 |
| `POINTER_DOWN` | 显示左键或右键按下状态 |
| `POINTER_UP` | 结束按下和拖拽状态 |
| `CLICK_EFFECT` | 播放左键或右键点击波纹 |
| `PING` | 心跳 |
| `SHUTDOWN` | 正常关闭 |

`MOVE_CURSOR` 支持 `linear`、`ease-out` 和 `ease-in-out`。拖拽由
`POINTER_DOWN(left) -> MOVE_CURSOR -> POINTER_UP(left)` 组成，不存在另一套
拖拽状态。

### 3.2 事件

| 事件 | 作用 |
|---|---|
| `READY` | Host 已鉴权并可接收 UI 命令 |
| `ARRIVED` | 指定移动序列已经到达 |
| `FEEDBACK_FINISHED` | 点击效果结束 |
| `PERFORMANCE` | 渲染帧耗时统计 |
| `RENDER_DEVICE_LOST` | DirectComposition 设备发生恢复 |
| `ERROR` | 命令被拒绝或协议错误 |

Host 不上报位置快照或目标窗口丢失；栏目位置由
`CursorSidecarService` 保存。

## 4. 软件对接

`CursorSidecarService` 提供以下稳定方法：

- `showCursor(position?)`
- `hideCursor()`
- `moveAndWait(tabId, target, {durationMs, easing})`
- `feedback(tabId, sequenceId, button)`
- `pointerDown(button)`
- `pointerUp(button)`
- `dragAndWait(tabId, start, end, options)`

浏览器和软件 UI 使用同一服务：

- `click` / `double_click`：左键效果；
- `right_click`：右键效果；
- `drag`：左键按下、平滑移动、抬起；
- 主窗口 `blur/hide/minimize/closed`：隐藏；
- 主窗口 `show/restore/focus`：在活动栏目的最后坐标显示。
- 主窗口移动：活动栏目重新读取物理区域，保存坐标按区域位移同步平移；
- 栏目隐藏/显示：保存该栏目的可见状态并明确向 Host 发显隐命令；
- 栏目切换：每个栏目独立保存位置、可见状态和按键状态，再恢复到 Host。

注册栏目只在 JavaScript 中保存物理区域和最终坐标，不再向原生 Host
发送 HWND。

## 5. 性能与验收

当前显示目标固定按用户环境验证 75 Hz。自动化覆盖：

1. 75 Hz 帧间隔统计；
2. 瞬移和丝滑移动；
3. 静态 ANI 第一帧；
4. 左键与右键不同颜色效果；
5. 拖拽按下、移动、抬起；
6. 窗口移动后光标按相同物理位移同步移动；
7. 显示、隐藏及窗口切换后恢复各窗口独立状态；
8. 浏览器和外部软件使用相同 API；
9. 连续 1000 次移动；
10. 源码、开发运行态和打包运行态的协议版本与 SHA-256 校验。

相关命令：

```text
npm run build:cursor-host
npm run accept:cursor-sidecar
npm run guardrails
npm run verify
npm run test:acceptance
npm run build:win
npm run check:packaged-runtime
```

## 6. 产物

```text
native/cursor-host/                         # C++ 源码与原生测试
resources/cursors/[CC] Handwrite v1.ani    # 静态取第一帧
resources/cursor-runtime/
  ai-free-cursor-host.exe
  cursor-runtime-manifest.json             # schema 1 / protocol 2 / SHA-256
```

开发、测试和打包都从源代码构建并重新生成运行产物，不手工修改 EXE。
