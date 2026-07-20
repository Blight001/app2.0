# AI-FREE 维护规则

在本目录工作时先阅读 `docs/ARCHITECTURE.md`、`docs/DATA-CONTRACTS.md` 和 `docs/refactoring/PROGRESS.md`。

- 保持 Electron 进程边界和 `composition → features → injected platform/repository` 依赖方向。
- renderer/sidebar 禁止直接 `require('electron')`；不得扩大 `window.electronAPI`，新 UI API 必须是按域命名的窄方法。
- 新 IPC 先登记通道和 schema，使用可释放 registry；不得覆盖 `ipcMain.handle/on` 去重。
- 测试验证公开行为、失败、恢复和副作用。除打包/安全静态约束外，不读取源码匹配字符串、函数名、CSS 或加载顺序。
- 不改写第三方扩展资产；不记录 Cookie、API Key、卡密、设备凭据和 token。
- 开发、测试和打包统一走 `npm run prepare:source`。不要手工编辑 `.generated` 或 `appbuild`。
- 提交前运行 `npm run verify`；涉及 Electron/Chromium/资源路径时再运行 `npm run test:acceptance` 和 packaged runtime 验证。
- 渐进门禁只能收紧，不能提高基线。最终债务与覆盖率缺口记录在 `docs/refactoring/PROGRESS.md`。
