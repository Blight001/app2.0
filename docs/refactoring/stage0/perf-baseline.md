# 性能基线（阶段 0）

采集日期：2026-07-17。环境：Windows 11，开发树（非打包），Node 24.12。

## 已采集

| 指标 | 数值 | 来源 |
|---|---|---|
| `npm test` 全量（174 用例） | ~1.1–1.5 s | node:test 输出 duration_ms |
| 主进程加载 → IPC 注册完成 | < 0.5 s | run-2026-07-17T12-42-28 日志时间戳（20:42:28.131 → .230） |
| 主进程加载 → 侧边栏 loadFile 发起 | ~0.6 s | 同上（→ .7xx） |
| 隔离 Electron 侧边栏页面加载（含主题应用） | < 3 s（脚本整体） | scratchpad 冒烟脚本 |

## 待补（标注原因）

| 指标 | 阻塞原因 |
|---|---|
| 开发版完整启动时间（窗口可交互） | 打包版 AI-FREE.exe 常驻运行，与 dev 实例共用 `%APPDATA%/ai-free` userData，缓存锁冲突导致 dev 启动异常。需隔离 userData 的启动脚本（阶段 1 建设）或停打包版后测量 |
| 侧边栏打开耗时 / 内存占用 / 退出耗时 | 同上 |
| 打包版启动基线 | 需在无 dev 冲突时对 appbuild/win-unpacked 测量 |

## 冲突说明（对后续集成测试的约束）

用户日常运行打包版（appbuild/），任何"真实 Electron 集成测试"必须 `app.setPath('userData', 隔离目录)`，
且 AutomationBridge 端口 18765 会被打包版占用（EADDRINUSE），测试须用 `AI_FREE_AUTOMATION_BRIDGE_PORT` 换端口或容忍降级。
