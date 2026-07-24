# AI-FREE Cursor Host

Windows x64 的 API 驱动 UI 光标：

- 独立 `HWND_TOPMOST` 窗口；
- DirectComposition/Direct2D 渲染；
- 无激活、命中穿透，不影响真实点击；
- API 控制显隐、瞬移、平滑移动、左右键效果和拖拽；
- ANI 只解码静态第一帧，避免动态光标闪烁；
- 当前 Windows 用户独占的 Named Pipe、令牌握手和心跳。

它不采样真实鼠标、不隐藏系统光标、不解析目标 HWND，也不根据焦点自行
改变状态。主程序是唯一状态源。

## 构建

安装 Visual Studio 2022 Build Tools（“使用 C++ 的桌面开发”和 Windows
10/11 SDK）后，在项目根目录运行：

```powershell
npm run build:cursor-host
```

正式构建脚本直接调用 MSVC 并使用静态 CRT；`CMakeLists.txt` 用于原生
开发和 IDE 配置。

## 启动参数

```text
--pipe <随机名称>
--token <64 位十六进制令牌>
--session <安全会话 ID>
--cursor-asset <ANI 资源绝对路径，可选>
```

协议版本为 `2`。每条 UTF-8 JSON 消息前有 little-endian `uint32` 长度，
单条消息最大 64 KiB。完整命令见
`docs/native-cursor-sidecar-implementation-plan.md`。
