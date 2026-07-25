# AI-FREE 当前架构

最后核对：2026-07-25。本文描述工作域分离完成后的默认运行架构；实施记录见
[浏览器控制与软件控制分离落地方案](control-domain-separation-implementation-plan.md)。

## 1. 进程与入口

```text
src/app/main/main.js
  → entry/start-app.js
    → bootstrap.js
      → composition/create-core-services.js
      → services/app-shell.js
      → services/tab-manager.js
      → services/app-lifecycle.js
```

- 主进程是唯一的 composition root。`main/composition` 只创建服务并装配依赖。
- `main/features` 承载账号、AI、浏览器、浏览器自动化、网络、扩展、外部软件和更新能力。
- renderer 与 sidebar 只能经冻结的 `window.aiFree` 具名 API 调用主进程。
- IPC 通道登记在 `contracts/ipc-channels.js`，payload 校验在
  `contracts/ipc-payloads.js`，注册统一经过 `main/ipc/registry.js`。
- 正式浏览器能力只连接项目提供的 Chromium Fork；网页自动化经受认证的
  Chromium Runtime Bridge 执行。

## 2. 当前窗口边界

```text
Home Window
├── 账号与运行摘要
├── 打开 Browser Workspace
└── 打开 Software Workspace

Browser Window                  Software Window
├── Browser 标签壳             ├── Software 标签壳
├── Browser side view           ├── Software side view
└── Browser TabManager          └── SoftwareTabManager
    └── Chromium runtime            └── external-app runtime
```

启动默认只创建 Home。Browser 与 Software 可独立创建、聚焦、关闭和重开；各自拥有
窗口、side view、标签、活动目标、AI run 和自动化状态。三个窗口分别使用
`home-preload.js`、`browser-preload.js` 和 `software-preload.js`。

## 3. 当前领域与依赖

允许的长期依赖方向：

```text
main/entry → main/composition → main/features → injected platform/repository
                                      ↑
renderer/sidebar → preload → contracts/IPC adapters
browser automation → Chromium Runtime Bridge
software control → external-app runtime/native bridge
```

Browser 与 Software 共享底层 `BrowserRuntimeManager` 和账号/授权基础设施，但只能
通过注入的 application contract 使用；不共享活动标签、AI registry、卡片 store 或
side view 事件路由。新工作区不装配 Cursor Sidecar。

## 4. 状态所有权

公共状态：

- `app-context.js`：退出、更新安装挂起、应用会话 ID 和调试写入钩子。
- `license-cache.js`：账号凭据引用、授权快照和服务端运行配置。
- `app-state.js`：Home/Browser 窗口引用和 Browser 标签状态。

状态所有权：

| 状态 | 目标所有者 |
|---|---|
| 账号、授权、更新 | Shared Services |
| Home 窗口与主页 UI | Home Workspace |
| Chromium 标签、Profile、历史、网络 | Browser Workspace |
| 软件实例、HWND、PID、焦点目标 | Software Workspace |
| AI 会话、停止控制器 | 对应 Browser/Software AI |
| 卡片选择、任务与停止控制器 | 对应 Browser/Software Automation |

`Workspace Registry` 只维护实例和生命周期，不得承载上述业务状态。

## 5. 资源生命周期

- `registerAppLifecycle` 负责 Electron ready、activate、window-all-closed 和退出装配。
- `createIpcRegistry().dispose()` 精确释放它注册的 handler/listener。
- Chromium runtime、AutomationBridge、Clash、定时器与窗口监听必须由创建它们的
  工作域释放。
- 工作域关闭只允许清理本域资源；应用退出再执行公共资源的最终清理。
- `.generated/app` 由 `npm run prepare:source` 生成，不得直接编辑。

## 6. 目标工作域边界

```text
entry
  → shared composition
    → Home Workspace
    → Browser Workspace → browser domain → Chromium runtime
    → Software Workspace → software domain → external-app/native runtime
```

禁止 Browser 与 Software 内部模块互相引用，禁止 Home 引用 TabManager、Chromium
runtime 或软件执行器。确需共享的能力只能是纯逻辑、无业务状态 UI 或账号/授权/更新
等窄 application contract。

## 7. 变更与验证

Browser 与 Software 的稳定公开契约分别位于
`docs/control-domain-separation/browser/CONTRACT.md` 和
`docs/control-domain-separation/software/CONTRACT.md`。每次变更先运行最小相关测试，
再运行：

```text
npm run guardrails
npm run verify
```

涉及 Electron、Chromium、Native Host、窗口或生命周期时还需运行
`npm run test:acceptance`；涉及打包资源或路径时运行 `npm run build:win` 与
`npm run check:packaged-runtime`。
