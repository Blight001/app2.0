# AI-FREE Cursor Host

Windows x64 用户态原生鼠标 Sidecar，实现
`docs/native-cursor-sidecar-implementation-plan.md` 的统一显示链：

- `WH_MOUSE_LL` 事件采样，渲染线程只读取最新物理屏幕坐标；
- DirectComposition/Direct2D 小尺寸、无激活、命中穿透浮层；
- 多栏目独立坐标、激活切换、稳定位置快照和动态 HWND/物理区域；
- 本地自动化时间线、序列取消、到达事件和点击波纹反馈；
- WIC 启动预解码 ANI 帧、热点、序列和持续时间，失败时使用静态回退；
- owner/target HWND 的前台、遮挡、最小化和可见性判定；
- 当前 Windows 用户独占的 Named Pipe，长度前缀 JSON、令牌握手和心跳租约；
- `ShowCursor` 调用配对，以及独立 watchdog 在 Sidecar 异常退出后恢复指针。

## 构建

安装 Visual Studio 2022 Build Tools（“使用 C++ 的桌面开发”和 Windows
10/11 SDK）后，在项目根目录运行：

```powershell
npm run build:cursor-host
```

正式项目构建脚本直接调用 MSVC 并使用静态 CRT；`CMakeLists.txt` 用于原生
开发和 IDE 配置，不是生成态或打包态的旁路。

## 原型协议

进程启动参数：

```text
--pipe <随机名称>
--token <64 位十六进制令牌>
--session <安全会话 ID>
--cursor-asset <ANI 资源绝对路径，可选>
```

原型调试仍可额外传入 `--owner-hwnd` 和 `--target-hwnd`。Pipe 支持方案文档
第 6 节定义的完整命令集。每条 UTF-8 JSON 消息前有一个 little-endian
`uint32` 长度；单条消息最大 64 KiB。`HELLO` 必须包含
`version: "1"`、调用方 PID、会话 ID 和启动令牌。心跳超过 500 ms 后浮层
立即隐藏并释放系统指针租约。
