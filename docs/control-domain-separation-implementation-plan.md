# AI-FREE 浏览器控制与软件控制分离落地方案

状态：提案  
适用版本：AI-FREE 2.6.x 后续演进  
目标：在保持现有公开行为和用户数据兼容的前提下，将个人主页、浏览器控制、软件控制拆成三个独立运行边界，并建立“验收后冻结”的长期维护机制。

## 1. 决策摘要

AI-FREE 后续采用“三窗口、两工作域、一组稳定公共能力”的结构：

```text
AI-FREE 进程
├── Home Workspace
│   └── 个人主页、账号、授权、更新、启动入口
├── Browser Workspace
│   ├── AI-FREE Chromium
│   ├── 浏览器侧边栏
│   ├── 浏览器 AI
│   ├── 浏览器自动化
│   └── 浏览器配置
└── Software Workspace
    ├── 外部软件承载区
    ├── 软件侧边栏
    ├── 软件 AI
    ├── 软件自动化
    └── 软件配置
```

三个窗口可以共享视觉组件和纯逻辑，但不得共享可变业务状态、业务控制器、任务队列或工具集合。浏览器工作域不得直接调用软件域内部模块，软件工作域也不得直接调用浏览器域内部模块。

本次调整不采用一次性全量重写。实施顺序固定为：

1. 先建立契约、测试和新窗口骨架。
2. 再迁移浏览器域，验证后冻结。
3. 再迁移软件域，验证后冻结。
4. 最后将旧主窗口收缩为个人主页，并删除已无调用方的混合装配代码。

## 2. 当前状态与主要耦合点

现有项目已经有 `features/browser`、`features/external-app`、Chromium Runtime、软件自动化和对应测试，这些能力应迁移复用，不应重写。

当前需要拆开的主要耦合点是：

- `services/app-shell*` 同时管理主窗口、浏览器内容、侧边栏和部分公共生命周期。
- `app-shell.html` 与同一套 renderer controller 同时表达浏览器标签和外部软件标签。
- 单个 preload 向所有页面暴露账号、浏览器、软件、AI、自动化、网络和更新能力。
- 单个侧边栏同时加载浏览器设置、软件设置、AI 控制和自动化页面。
- 浏览器标签与 `runtimeType: external-app` 软件标签共用一套 TabManager 和活动标签状态。
- AI 对话通过当前选择动态混合 `software_window`、浏览器 MCP 和 `software_ui` 工具。
- 自动化卡片的展示入口、选择状态和运行状态仍由同一套侧边栏上下文承载。
- UI 广播目前可同时发送到主窗口和单个 side view，缺少明确的工作域路由。

以上问题的解决目标不是简单拆文件，而是消除运行时状态、权限和生命周期的交叉影响。

## 3. 范围与非目标

### 3.1 本方案范围

- 启动后仅展示个人主页。
- 点击入口分别创建或聚焦浏览器工作窗口、软件控制工作窗口。
- 两个工作窗口采用一致的主内容区加右侧 AI/自动化侧边栏布局。
- 浏览器和软件分别拥有独立窗口状态、选择状态、AI 会话、自动化运行和配置。
- 建立按工作域授权的 preload 与 IPC。
- 保留账号、授权、更新、日志等有明确公共属性的基础能力。
- 保持旧账号、许可证、浏览器 Profile、浏览器历史及其他用户数据可读取。
- 两个工作窗口沿用当前产品的标签区、主内容区和右侧控制栏布局，不在本轮重新设计整体视觉。
- 本轮移除自定义鼠标光标、轨迹和点击动画的运行时展示，但保留实际鼠标点击、拖拽和键盘自动化。

### 3.2 非目标

- 不替换 Electron、Chromium Fork、AutomationBridge 或 Native Host。
- 不在本次工作中升级依赖或更换前端框架。
- 不重写已经通过 Chromium phase 3 验收的底层浏览器协议。
- 不重写已经通过单元测试的软件窗口捕获和输入协议。
- 不在本轮重新设计自定义鼠标光标；Cursor Sidecar 的视觉展示不接入新工作窗口。
- 不为了目录整齐批量改名或格式化整个项目。
- 不在第一阶段改变现有 IPC 名称和持久化格式；契约调整采用兼容迁移。

## 4. 目标架构

### 4.1 目录建议

在现有依赖方向内逐步形成以下结构：

```text
src/app/
├── main/
│   ├── composition/
│   │   ├── build-home-workspace.js
│   │   ├── build-browser-workspace.js
│   │   ├── build-software-workspace.js
│   │   └── build-shared-services.js
│   ├── features/
│   │   ├── home/
│   │   ├── browser/
│   │   ├── browser-ai/
│   │   ├── browser-automation/
│   │   ├── external-app/
│   │   ├── software-ai/
│   │   └── software-automation/
│   ├── workspace/
│   │   ├── workspace-registry.js
│   │   ├── home-window-controller.js
│   │   ├── browser-window-controller.js
│   │   └── software-window-controller.js
│   └── preload/
│       ├── home-preload.js
│       ├── browser-preload.js
│       ├── software-preload.js
│       └── preload-helpers.js
├── renderer/
│   ├── home/
│   ├── browser-workspace/
│   ├── software-workspace/
│   └── shared-ui/
└── shared/
    ├── contracts/
    └── pure/
```

目录名称可以根据现有项目约定微调，但职责边界不可回退。

### 4.2 允许的依赖方向

```text
entry
  → shared composition
      → home workspace
      → browser workspace
      → software workspace

browser workspace → browser domain → Chromium/runtime repository
software workspace → software domain → external-app/native repository

renderer → scoped preload → scoped IPC adapter → domain application service
```

禁止以下依赖：

- `features/browser*` 引用 `features/external-app` 或 `features/software-*`。
- `features/software-*` 引用 `features/browser`、浏览器历史或 Chromium Profile 逻辑。
- Home Workspace 引用 TabManager、Chromium Runtime 或软件自动化执行器。
- renderer 直接引用 Electron、主进程文件或另一个工作域的 renderer controller。
- shared 模块读取文件系统、Electron、DOM 或网络。
- 通过全局变量或通用事件名跨工作域同步业务状态。

确实需要协作时，只能依赖显式的小接口，例如 `AccountSessionReader`、`LicenseAccessReader`、`AppUpdateService`，不能把整个 services/deps 对象传入工作域。

## 5. 窗口与生命周期设计

### 5.1 Workspace Registry

主进程新增唯一的工作区注册表，维护：

```js
{
  home: { window, status },
  browser: { window, sideView, status, dispose },
  software: { window, sideView, status, dispose }
}
```

注册表只负责实例所有权和生命周期，不承载业务规则。每个工作域自行返回 `dispose()`，释放本域的：

- IPC 注册。
- webContents 订阅。
- listener 和 timer。
- AI 运行及取消控制器。
- 自动化任务。
- Runtime 连接或子进程引用。
- side view 与弹窗。

### 5.2 窗口行为

- 应用 ready 后只创建 Home Window。
- “打开 AI-FREE 浏览器”调用 `openBrowserWorkspace()`。
- “打开 AI-FREE 软件控制”调用 `openSoftwareWorkspace()`。
- 目标窗口已存在时恢复、显示并聚焦，不重复创建。
- 两个工作窗口可以同时存在，关闭一个不得改变另一个的活动目标或任务状态。
- 工作窗口关闭时，默认停止该工作域内仍在运行的 AI 和自动化任务；如未来支持后台运行，必须作为显式产品选项单独设计。
- Home Window 关闭遵循统一退出策略；不得因为 Home Window 被隐藏而误销毁其他工作域。
- `app.activate` 在无窗口时只恢复 Home Window，不隐式启动浏览器或软件控制。

### 5.3 UI 布局

浏览器和软件窗口不创建新的顶部工作栏，直接沿用当前 UI 的主要结构。参考基线为本方案确认时的软件现有界面：

```text
┌──────────────── AI-FREE 窗口标题栏 ─────────────────┐
├──────────────── 工作对象标签栏 ────────────┬─────────┤
│                                           │ 侧栏栏目 │
├───────────────────────────────────────────┤─────────┤
│                                           │         │
│ 主内容区                                   │ 控制侧栏 │
│                                           │         │
│                                           │         │
└───────────────────────────────────────────┴─────────┘
```

Browser Workspace：

- 左侧保留现有 AI-FREE 浏览器标签栏、Chromium 页面区、地址栏和页面承载方式。
- 右侧保留当前固定控制侧栏、收起/展开、宽度和深色视觉样式。
- 侧栏顶部只显示“AI 控制”“自动化”“浏览器配置”。
- 不再显示“软件配置”，也不加载软件设置 controller、状态或 API。

Software Workspace：

- 左侧采用与当前浏览器工作区一致的标签栏和主内容布局，主内容改为外部软件承载区。
- 一个软件实例对应本工作区内的软件标签；不得加入 Browser Workspace 的标签集合。
- 右侧沿用相同的控制侧栏外观和交互。
- 侧栏顶部只显示“AI 控制”“自动化”“软件配置”。
- 不显示“浏览器配置”，也不加载浏览器历史、Profile、网络或浏览器设置 controller。

个人主页不复用工作区标签栏。它保持轻量主页结构，仅展示个人信息、运行状态、全局入口和“打开 AI-FREE 浏览器”“打开 AI-FREE 软件控制”两个主要操作。

布局的复用应提取为无业务状态的 `WorkspaceFrame`。本轮只允许为工作域分离调整栏目显隐、页面装配和状态来源，不修改已经确认的主区域/侧栏比例、标签交互、主题风格和常用操作位置。确需修改视觉细节时，应作为独立 UI 任务验收，不能夹带在域迁移中。

允许共享的内容：

- 颜色、字体、间距和主题 token。
- 分栏、折叠、拖动宽度等纯布局逻辑。
- 无业务含义的按钮、对话框、消息和日志展示组件。
- `Result`、分页、时间格式化等纯数据工具。

禁止共享的内容：

- 当前浏览器、当前软件、活动标签等选择状态。
- AI 会话 store。
- 自动化卡片 store 和运行控制器。
- 设置表单状态。
- IPC API 对象。
- 业务错误处理和重试策略。

### 5.4 鼠标光标的临时处理

截图中主内容区由自动化绘制的自定义鼠标光标、移动轨迹、点击波纹或拖拽动画，本轮全部从产品运行链路移除：

- Browser Workspace 和 Software Workspace 都不绘制 AI 自定义光标。
- 不因 AI 工具执行而覆盖或替换系统鼠标光标。
- 实际点击、双击、拖拽、滚动、键盘输入和坐标换算能力继续保留。
- 工具执行结果仍通过侧栏步骤状态和日志反馈，不能依赖光标动画表示成功。
- Cursor Sidecar 不由新工作区 composition 启动，也不注册仅供视觉反馈的 listener。
- 现有 Cursor Sidecar 源实现和针对底层协议的测试暂时保留为隔离模块，但不进入新工作区运行时装配；待新的鼠标交互方案确认后，必须明确选择重新设计接入或删除，不增加永久 no-op 兼容层。
- 新工作区打包验收应确认不会产生 Cursor Sidecar 孤儿进程、窗口覆盖层或残留资源锁。

## 6. IPC 与权限隔离

### 6.1 三套 preload

每个窗口加载独立 preload，并只暴露本窗口需要的冻结 API。

Home：

```text
window.aiFree.home
window.aiFree.account
window.aiFree.license
window.aiFree.updates
window.aiFree.ui
```

Browser Workspace：

```text
window.aiFree.browser
window.aiFree.browserAi
window.aiFree.browserAutomation
window.aiFree.network
window.aiFree.workspace
```

Software Workspace：

```text
window.aiFree.software
window.aiFree.softwareAi
window.aiFree.softwareAutomation
window.aiFree.workspace
```

账号展示如在工作窗口内需要，只暴露只读快照和订阅，不暴露完整登录、登出或凭据操作。

### 6.2 IPC 发送方校验

只缩小 preload 不足以形成安全边界。IPC adapter 还必须通过 Workspace Registry 校验 `event.sender` 属于哪个工作域：

- Home sender 不能调用浏览器或软件控制通道。
- Browser sender 不能调用软件 UI、软件启动或软件自动化通道。
- Software sender 不能调用浏览器 Profile、浏览器历史或浏览器自动化通道。
- 已销毁或未注册的 webContents 一律返回稳定错误。

错误统一使用：

```js
{ ok: false, error: { code: 'WORKSPACE_ACCESS_DENIED', message, retryable: false } }
```

新通道先登记到集中 IPC contract、补 payload schema 和 checkJs/TypeScript 类型，再通过 registry 注册并返回 disposer。

### 6.3 迁移策略

第一轮不批量重命名现有通道：

- 先将现有浏览器通道只绑定到 Browser preload。
- 将现有软件通道只绑定到 Software preload。
- 对混合 AI 和自动化通道新增明确的 `workspaceType` 契约，并在主进程入口校验。
- 当调用方全部迁移并有契约测试后，再决定是否将混合通道替换为领域命名通道。

任何兼容入口都必须写明删除条件，不能永久保留第二套 façade。

## 7. 状态与配置隔离

### 7.1 状态所有权

| 状态 | 唯一所有者 |
|---|---|
| 账号会话、授权、更新 | Shared Services |
| Home UI 状态 | Home Workspace |
| 浏览器标签、Profile、历史、网络选择 | Browser Workspace |
| 软件实例、HWND、软件目录、焦点目标 | Software Workspace |
| 浏览器 AI 会话与选中浏览器 | Browser AI |
| 软件 AI 会话与选中软件 | Software AI |
| 浏览器自动化运行 | Browser Automation |
| 软件自动化运行 | Software Automation |

不得以“当前活动标签”同时表达浏览器目标和软件目标。建议拆成：

```text
browserSelection = { browserProfileId, tabId }
softwareSelection = { softwareProfileId, hwnd, pid }
```

### 7.2 持久化布局

保留现有 `userData` 根目录，新增领域目录：

```text
userData/
├── shared/
│   └── ui-preferences.json
├── browser/
│   ├── settings.json
│   ├── ai/
│   └── automation/
├── software/
│   ├── settings.json
│   ├── ai/
│   └── automation/
├── chromium-profiles/       # 旧路径继续兼容
├── account_sessions/        # 旧路径继续兼容
└── store/content            # 旧凭据路径继续兼容
```

浏览器 Profile 等已有稳定大数据路径不为目录整齐而搬迁。

### 7.3 配置边界

公共配置仅限：

- 主题、语言、缩放等展示偏好。
- 账号和授权。
- 更新策略。
- 日志级别。

浏览器专属配置：

- Profile、主页、代理、UA、时区、语言、指纹、扩展、下载。
- 浏览器 AI 的模型选择、提示偏好和 MCP 调用限制。
- 浏览器自动化的默认浏览器、超时、重试和卡片。

软件专属配置：

- 软件目录、窗口匹配、附着方式、截图和输入策略。
- 危险操作确认、软件控制权限。
- 软件 AI 的模型选择、提示偏好和工具限制。
- 软件自动化的默认软件、超时、重试和卡片。

模型服务地址或 API Key 可以由安全凭据仓库统一加密保存，但浏览器域和软件域分别保存“选择哪个凭据、模型和参数”。业务代码只获得凭据引用解析接口，不直接共享配置对象。

### 7.4 迁移要求

- 首次启动新版本时只读检测旧配置，不立即覆盖。
- 使用 `schemaVersion` 和幂等迁移。
- 原子写入，失败时保留旧文件并返回可诊断错误。
- 旧 AI 历史按是否存在 `softwareProfileId` 等可靠字段分类；无法可靠分类的历史进入“旧版历史”只读区，不猜测归属。
- 旧自动化卡片必须通过明确的卡片类型或步骤能力分类；混合卡片暂时保留在兼容区，不自动拆分。
- 连续两个稳定版本确认无回退需求前，不删除旧配置读取能力。

## 8. AI 控制分离

### 8.1 公共 AI 基础设施

可以共享但必须保持无工作域状态：

- 模型 HTTP client。
- 消息裁剪、摘要和格式转换纯函数。
- 流式响应解析。
- 通用错误映射。
- 安全凭据读取接口。

### 8.2 Browser AI

Browser AI 只允许获得：

- 浏览器窗口管理能力。
- 当前 Browser Workspace 中已连接 Chromium 的网页工具。
- 浏览器自动化卡片工具。
- 浏览器下载、网络等经过授权的能力。

不得注入 `software_ui` 或软件 HWND/进程信息。

### 8.3 Software AI

Software AI 只允许获得：

- 软件目录和软件窗口管理能力。
- 当前 Software Workspace 选择的软件 UI 工具。
- 软件自动化卡片工具。
- 截图、输入、坐标换算等软件域能力。

不得注入浏览器 Cookie、Profile、网页标签、浏览器历史或网页 MCP。

### 8.4 会话与停止隔离

每次 AI run 的主键包含工作域：

```text
browser:<conversationId>:<runId>
software:<conversationId>:<runId>
```

停止 Browser AI 不能中止 Software AI。事件推送必须定向发送到发起窗口，不能广播到所有 side view。

## 9. 自动化分离

建议定义两个独立 application service：

- `BrowserAutomationService`
- `SoftwareAutomationService`

二者可以共享纯逻辑的流程定义、校验器和进度事件格式，但运行器、工具目录、目标解析和任务仓库必须独立。

卡片最低契约：

```js
{
  schemaVersion: 1,
  domain: 'browser' | 'software',
  id,
  name,
  steps,
  createdAt,
  updatedAt
}
```

运行时必须验证：

- Browser runner 拒绝 `domain: software`。
- Software runner 拒绝 `domain: browser`。
- 任务事件包含 `domain`、`taskId` 和目标标识。
- stop 只停止同域同任务。
- 一个工作域关闭时只清理本域任务。

如果产品未来需要跨浏览器与软件的组合流程，应建立第三个显式的 Orchestration 域，由它调用两个公开 application contract；不能让其中一个域反向依赖另一个域。

## 10. 分阶段实施

### 阶段 0：冻结基线和补齐契约

改动内容：

- 补齐实际缺失的 `docs/ARCHITECTURE.md`、`docs/DATA-CONTRACTS.md` 和故障文档，确保与当前代码一致。
- 建立浏览器、软件、Home 功能矩阵。
- 记录现有 IPC、存储路径、窗口生命周期、AI 工具和自动化卡片契约。
- 为当前可用功能补齐行为测试，形成迁移前基线。
- 给现有功能编号，例如 `HOME-*`、`BWS-*`、`SWS-*`。

退出条件：

- 当前浏览器和软件功能都有成功、失败、关闭恢复测试。
- 不依赖源码字符串的行为基线可复现。
- 已确定每一项现有数据的迁移或保留策略。

### 阶段 1：建立 Workspace 骨架

改动内容：

- 新增 Workspace Registry 和三个窗口 controller。
- 新增 Home 页面，只提供个人信息和两个启动入口。
- 浏览器、软件工作窗口先加载最小占位壳。
- 新增 sender 校验和 scoped preload。
- 建立沿用当前 UI 布局的 `WorkspaceFrame`，不改变主内容区和右侧栏的主要视觉关系。
- 从新工作区装配中排除自定义鼠标光标和 Cursor Sidecar 视觉运行链路。
- 增加每个窗口独立创建、聚焦、关闭和 dispose 测试。

退出条件：

- 启动只显示 Home。
- 两个入口可以独立打开和聚焦窗口。
- 关闭一个窗口不影响另一个。
- 越权 IPC 在主进程被拒绝。

### 阶段 2：迁移 Browser Workspace

改动内容：

- 将现有 Chromium、标签、Profile、历史、浏览器设置和网络 UI 迁入 Browser Workspace。
- 将 Browser side view 从旧 AppShell 状态中剥离。
- Browser AI 只装配浏览器工具。
- Browser Automation 使用独立状态、仓库和事件路由。
- 保持现有 Chromium Runtime 和 Profile 路径。

退出条件：

- 浏览器功能矩阵全部通过。
- Browser Workspace 不引用软件域模块。
- Browser preload 不暴露软件控制。
- Browser 侧栏只包含 AI 控制、自动化和浏览器配置。
- 浏览器点击、滚动、拖拽仍可执行，但不显示自定义鼠标光标。
- 真实 Chromium phase 3、浏览器 UI、会话存储和打包态通过。

完成后冻结 Browser Workspace 的公开 contract。后续软件迁移不得修改其内部实现，除非浏览器回归测试证明必须修复。

### 阶段 3：迁移 Software Workspace

改动内容：

- 将软件目录、外部软件启动、嵌入/附着、焦点、截图和输入迁入 Software Workspace。
- 软件实例不再进入浏览器 TabManager。
- Software AI 只装配软件工具。
- Software Automation 使用独立卡片仓库、任务状态和事件。
- 软件设置从混合侧边栏剥离。

退出条件：

- 软件功能矩阵全部通过。
- Software Workspace 不引用浏览器历史、Profile 或网页 MCP。
- Software preload 不暴露浏览器控制。
- Software 侧栏只包含 AI 控制、自动化和软件配置。
- 外部软件嵌入、输入自动化、软件设置 UI 和关闭恢复验收通过。
- 软件控制期间不启动 Cursor Sidecar，不出现自定义光标覆盖层或残留进程。

完成后冻结 Software Workspace 的公开 contract。

### 阶段 4：收缩旧 AppShell

改动内容：

- 将旧主窗口正式替换为 Home Workspace。
- 删除旧混合侧边栏入口、混合活动标签状态和无调用方的兼容装配。
- 将公共账号、授权、更新事件改为定向订阅或只读快照。
- 更新打包资源和启动验收脚本。

退出条件：

- 旧混合入口没有运行时调用方。
- 不存在同时接受浏览器目标和软件目标的活动标签状态。
- preload、IPC、listener 和窗口资源均能成对释放。
- 三窗口源码态、生成态和打包态行为一致。

### 阶段 5：兼容清理

至少经过两个稳定版本后执行：

- 根据遥测或可复现升级测试确认旧数据迁移成功。
- 删除达到明确删除条件的临时兼容读取器。
- 不删除仍可能被旧版本用户使用的数据。
- 更新架构文档、数据契约和故障手册为最终状态。

## 11. “验收后冻结”机制

为实现确认好的功能后续尽量不动，采用以下规则：

### 11.1 稳定契约清单

每个工作域维护 `CONTRACT.md`，记录：

- 对外 application service 方法。
- IPC 名称、payload、结果和错误码。
- 持久化 schema 和路径。
- 生命周期与 dispose 语义。
- 用户可见行为。
- 真实环境验收命令。

未修改契约时，其他工作域只能通过这些接口使用能力，不能引用内部文件。

### 11.2 所有权与变更条件

- Browser 团队任务默认不得修改 Software 内部文件。
- Software 团队任务默认不得修改 Browser 内部文件。
- Home 或公共 UI 任务不得顺带修改两类业务服务。
- 跨域变更必须在方案或 PR 描述中列出原因、影响契约和回归范围。
- 只有缺陷、安全问题、明确产品变更或底层契约升级才能修改已冻结模块。

### 11.3 自动架构门禁

在现有 `npm run guardrails` 中逐步增加：

- 禁止 Browser → Software 引用。
- 禁止 Software → Browser 引用。
- 禁止 Home → Browser/Software 内部实现引用。
- 禁止 renderer 跨工作域引用。
- 校验每个 preload 的能力白名单。
- 校验 IPC sender 授权。
- 校验自动化卡片 domain 与 runner 一致。

门禁保持零基线，不增加例外名单规避问题。

### 11.4 契约测试优先

已冻结功能的测试重点是公开行为，而非内部函数名。重构某个工作域时，只要契约测试和真实验收不变，其他域无需随之修改。

## 12. 验证矩阵

每个阶段依次执行最小相关测试、guardrails 和 verify。

| 场景 | 必须验证 |
|---|---|
| 冷启动 | 仅出现 Home，无 Chromium 和软件进程被隐式启动 |
| 打开浏览器 | 创建或聚焦 Browser Workspace，不创建 Software Workspace |
| 打开软件控制 | 创建或聚焦 Software Workspace，不启动 Chromium |
| 同时运行 | 两个工作域选择、AI、自动化和日志互不串线 |
| 关闭浏览器窗口 | Browser AI/任务/监听释放，软件任务继续 |
| 关闭软件窗口 | Software AI/任务/监听释放，浏览器继续 |
| IPC 越权 | 返回 `WORKSPACE_ACCESS_DENIED`，没有副作用 |
| AI 停止 | 只停止发起工作域对应 run |
| 自动化停止 | 只停止同域同 task |
| 配置修改 | 只修改目标工作域配置 |
| Browser 侧栏 | 仅有 AI 控制、自动化、浏览器配置 |
| Software 侧栏 | 仅有 AI 控制、自动化、软件配置 |
| 输入自动化 | 点击、拖拽、滚动和键盘输入可用，不绘制自定义光标 |
| 升级旧数据 | 成功、损坏、写入失败和重复迁移均可恢复 |
| 退出应用 | Chromium、外部软件附着、sidecar、timer、端口和文件锁无残留 |

涉及 Browser Workspace：

```text
npm run check:browser-settings
npm run check:browser-settings-ui
npm run accept:chromium-phase3
```

涉及 Software Workspace：

```text
npm run check:external-app-embed
npm run check:software-settings-ui
```

现有 `accept:cursor-sidecar` 不再作为新工作区功能验收项；改为增加“输入能力正常且 Cursor Sidecar 未启动”的行为验收。底层模块保留期间，其协议单元测试继续执行，防止暂存代码静默损坏。

所有代码阶段：

```text
npm run guardrails
npm run verify
```

窗口、Chromium、Native Host 或生命周期发生变化时：

```text
npm run test:acceptance
```

打包资源或路径发生变化时：

```text
npm run build:win
npm run check:packaged-runtime
```

## 13. 风险与控制

### 风险一：为了共享 UI 再次共享业务状态

控制：共享组件只能接收 props/callback，不得导入工作域 API 或 store。

### 风险二：一次拆分同时改变窗口、IPC、数据和 UI

控制：每阶段只切换一个边界；旧能力在新边界验收通过前保持可回退。

### 风险三：旧 AI 历史或卡片无法准确分类

控制：不猜测、不破坏；进入只读兼容区，由用户明确归类后复制到新域。

### 风险四：关闭窗口造成另一个工作域被清理

控制：所有资源以 workspace id 注册，dispose 接受并验证 owner。

### 风险五：公共服务逐渐膨胀为新的万能依赖

控制：公共层只提供账号、授权、更新、日志和纯基础设施；采用窄接口，不传递完整 deps。

### 风险六：现有未提交修改与迁移冲突

控制：实施前逐项确认当前工作树改动归属；先合并或冻结现有 Home/布局工作，再开始结构迁移，不覆盖未知改动。

## 14. 回滚策略

- 每个阶段都保持独立可回滚，不跨阶段批量删除旧入口。
- 新 Workspace 通过内部 feature flag 切换；flag 只用于迁移期，并登记删除版本。
- 数据迁移只新增或复制，稳定前不破坏性删除旧数据。
- Chromium Profile、账号会话、许可证路径保持不变。
- `.generated/app` 继续由 `npm run prepare:source` 生成，不手工修改。
- 若某阶段验收失败，回退该阶段窗口装配，旧数据无需反向迁移。

## 15. 建议的首批任务

以下任务适合作为第一轮实际开发范围：

1. 补齐架构与数据契约文档，并建立三域功能矩阵。
2. 为现有 AppShell、浏览器窗口、外部软件窗口和 AI 工具路由增加迁移基线测试。
3. 新建 Workspace Registry 和 Home Window，不迁移业务。
4. 新建 Browser/Software 空工作窗口及 scoped preload。
5. 实现 IPC sender 工作域注册与越权拒绝。
6. 验证三个窗口独立创建、聚焦、关闭、重开和应用退出。

首批任务不迁移 Chromium、外部软件、AI 或自动化业务。完成并验收窗口边界后，再进入 Browser Workspace 迁移，可显著降低一次性改动风险。

## 16. 完成定义

只有同时满足以下条件，分离工作才算完成：

- 软件启动仅显示个人主页。
- 浏览器和软件控制是两个独立窗口，可单独或同时运行。
- 两个工作窗口保持当前标签区、左侧主内容区和右侧控制栏的布局风格。
- 浏览器侧栏与软件侧栏只展示各自工作域的栏目。
- 两个工作域拥有独立 preload、IPC 权限、状态、配置、AI 和自动化。
- 两个工作域之间不存在内部模块直接依赖。
- 输入自动化保持可用，自定义鼠标光标、轨迹和点击动画不进入本轮运行时。
- 关闭、重启、失败恢复和退出时资源所有权明确且无残留。
- 旧账号、授权、Profile、浏览器历史和可识别业务数据保持兼容。
- 三种运行环境：源码测试、`.generated/app`、packaged runtime 均通过。
- 架构门禁能够阻止未来重新耦合。
- 每个已验收工作域都有稳定契约和可重复执行的行为测试。
