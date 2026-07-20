# AI-FREE 客户端架构索引

## 运行边界

```text
main/entry → main/composition → main/features → injected platform/repository
                                      ↑
renderer/sidebar → preload → contracts/IPC adapters

browser_automation extension ↔ local AutomationBridge ↔ Chromium runtime
```

- `src/app/main/composition`：唯一装配区，只创建依赖、注册生命周期和晚绑定访问器。
- `src/app/main/features`：按 account、ai-chat、browser、network、extensions、updates 组织 application service 与 IPC adapter。
- `src/app/main/platform`：Electron、进程、文件和退出适配器。
- `src/app/contracts`：IPC 通道、payload schema、结果/错误与 TypeScript 类型。
- `src/app/shared`：不依赖 Electron、DOM 或文件系统的纯逻辑。
- `src/app/renderer`、`src/app/sidebar`：窗口 UI 与事件绑定；不得直接 `require('electron')`。
- `src/assets/extensions/browser_automation`：自研扩展；background/content/popup 的入口文件只按确定顺序装配子模块。

## 启动与构建

`scripts/build-source.js` 是开发、测试和打包共用入口。JS 保持源兼容；主进程/preload/contracts/shared TypeScript 编译为 CommonJS，renderer/sidebar TypeScript 编译为 ES modules。输出固定为 `.generated/app`，禁止把生成文件写回 `src`。

Windows 构建先生成 `win-unpacked`，再串行同步 Chromium 与 Clash Core，验证 ASAR/unpacked/native/logo/扩展，最后以 `prepackaged` 生成 NSIS。可执行资源不要交给 electron-builder 并行复制。

## 依赖与变更规则

1. UI/IPC adapter 只能调用 application service；domain 规则通过参数接收 IO。
2. 新 IPC 先登记 `contracts/ipc-channels.js`，必要时增加 `ipc-payloads.js` schema，再由 `ipc/registry.js` 注册并返回 disposer。
3. 新接口使用 `{ok:true,data}` / `{ok:false,error}`；错误码稳定，日志不包含 Cookie、Key、卡密或 token。
4. 数据路径和旧格式是兼容契约。改变 schema 时先校验、幂等迁移并保留可恢复原值。
5. renderer/sidebar 不新增业务性 `window.*`。任意通道 `window.electronAPI` 和旧 `window.electron` façade 已删除；所有桥接必须通过冻结的领域化 `window.aiFree`。
6. `remove_watermark`、`transform` 等第三方资产不参与重构、格式化和覆盖率。

## 验证入口

- `npm run verify`：日常合并门禁。
- `npm run test:unit|test:contract|test:integration|test:packaging|test:acceptance`：分层定位。
- `npm run guardrails`：错误、文件尺寸、函数长度、复杂度和 TypeScript 基线。
- `npm run build:win && npm run check:packaged-runtime`：正式 Windows 产物。
- `npm run accept:chromium-phase3`：Profile、Cookie/storage、拒绝非法输入与退出恢复。

当前验收状态见 [refactoring/PROGRESS.md](refactoring/PROGRESS.md)，故障处理见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
