# AI-FREE 故障排查

最后核对：2026-07-25。

## 源码与生成态不一致

现象：源码已修改，但开发运行或测试仍表现为旧逻辑。

处理：

```text
npm run prepare:source
```

运行入口使用 `.generated/app`。只修改 `src/` 和构建脚本，不直接编辑 `.generated/`
或 `appbuild/`。

## IPC 注册失败

现象：启动提示通道未登记、重复注册或 payload 无效。

检查：

1. 通道是否先登记在 `src/app/contracts/ipc-channels.js`。
2. `requestSchema` 是否存在于 `ipc-payloads.js`。
3. 是否有两个 registrar 注册同一通道。
4. 生命周期重建前是否调用旧 registry 的 `dispose()`。

不要通过 monkeypatch、吞异常或 `removeHandler` 清空其它所有者的 handler 绕过错误。

## 工作域访问被拒绝

`WORKSPACE_ACCESS_DENIED` 表示 sender 未注册、已销毁或调用了不属于本工作域的能力。
检查 Workspace Registry 中窗口/side view 的注册和释放顺序，以及 scoped preload
是否只绑定本域通道。不要扩大 preload 白名单作为修复。

## Chromium 未启动或未附着

检查项目资源中的 AI-FREE Chromium Fork、握手环境变量、Profile 锁和 Runtime Bridge
诊断。正式模式不得回退到系统 Chrome、Edge 或调用方传入的外部路径。

最小验证：

```text
npm run check:browser-runtime
npm run accept:chromium-phase3
```

## 外部软件未嵌入或输入失败

确认目标 HWND/PID 仍有效、窗口未被销毁、DPI/坐标换算正确，并检查 Software Workspace
是否拥有目标。不要把软件实例重新加入 Browser Workspace 的 TabManager 作为回退。

最小验证：

```text
npm run check:external-app-embed
npm run check:software-settings-ui
```

## Cursor Sidecar 残留

新工作区不应启动 Cursor Sidecar。若出现覆盖层、孤儿进程或资源锁，检查新 workspace
composition 是否误注入 `cursorSidecarService`，以及关闭时是否释放监听和子进程。底层
模块暂时保留不代表它可以进入新工作区运行链路。

## 退出后仍有资源

按工作域检查 AI run、自动化 task、IPC registry、webContents listener、timer、
Runtime 连接、子进程、端口和文件锁。关闭一个工作域只清理该域；应用退出再清理公共
服务。验证时同时打开 Browser 与 Software，再分别关闭，确认另一域继续运行。

## 门禁或验收失败

先运行最小相关测试，再依次运行：

```text
npm run guardrails
npm run verify
```

窗口、Chromium、Native Host 或生命周期变更还需 `npm run test:acceptance`；打包路径或
资源变更还需 `npm run build:win` 和 `npm run check:packaged-runtime`。不得更新
guardrail baseline 或放宽阈值规避失败。
