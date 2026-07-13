# Chromium Runtime 客户端实施记录

## 已落地

- `src/app/main/browser-runtime/`：统一运行时接口、Electron 兼容实现、Chromium 状态机、启动器、命名管道协议、心跳与故障状态。
- `native/browser-host/`：N-API Win32 宿主窗口、PID/Session/HWND 校验、嵌入/解绑、尺寸、显示、焦点和窗口存活检查。
- Profile 数据固定在 `userData/chromium-profiles/<immutable-id>/`，包含独立 Chromium 数据、下载、Crashpad、日志和单实例写锁。
- 标签管理器支持 `electron`/`chromium` 双模式。Phase 2 起 `npm start` 进入正式 Fork 模式；`npm run start:prototype` 才允许系统浏览器原型；`npm run start:electron` 显式进入旧 Electron 模式。
- 正式 Chromium 模式启动失败会直接返回明确错误，既不回退 Electron BrowserView，
  也不搜索系统 Chrome/Edge 或外部路径。只有显式设置
  `AI_FREE_CHROMIUM_HANDSHAKE=prototype` 的开发排障模式允许回退。
- Chromium Profile 随环境切换执行 show/hide/focus，随主窗口布局 resize，应用退出前统一优雅关闭并在超时后回收进程树。
- 已禁止 `--no-sandbox` 等不安全参数，并移除 Electron 全局 `ignore-certificate-errors`。
- IPC 提供 `get-browser-runtime-state` 和 `restart-browser-runtime`，崩溃后可查询并重启环境。

## 启用方式

1. 安装 Visual Studio Build Tools 2026 的 C++ 桌面、MSVC x64、ATL/MFC 工作负载和 Windows 11 SDK。
2. 执行 `npm run build:native-host`。脚本在 `node-gyp` 无法识别 Build Tools 注册信息时会使用 MSVC 和 Electron SDK 缓存直接构建。
3. 将完整 Chromium Fork 运行目录放到 `resources/chromium/`。正式模式只接受其中的 `ai-free-browser.exe`，忽略外部路径和系统 Chrome；只有 prototype 开发态允许 `AI_FREE_CHROMIUM_PATH` 和自动发现。
4. Chromium Fork 实现方案中的五个 `--hs-*` 参数和长度前缀 JSON 命名管道握手。
5. 设置 Profile 的 `runtimeType: "chromium"`。全局验证可临时设置 `AI_FREE_BROWSER_RUNTIME=chromium`。

Phase 0 使用原版 Chromium 时，额外设置 `AI_FREE_CHROMIUM_HANDSHAKE=prototype`。
该模式只按本应用启动并持有的 PID 枚举窗口，不能进入生产包。

## 验证

```powershell
npm run check:browser-runtime
npm run build:native-host
npm --prefix native/browser-host test
```

当前机器已生成 Electron 40 x64 对应的 `native/browser-host/build/Release/browser_host.node`。
Native API 加载测试和真实 HWND 嵌入冒烟测试已通过。冒烟测试使用系统 Chrome、独立临时 Profile 和 prototype PID 窗口发现，取得独立 Chromium PID、Browser HWND、Host HWND，运行时进入 `ready`，自动关闭后完成资源回收。

嵌入成功后会再次验证 `GetParent(browserHwnd) == hostHwnd` 和 `IsChild(hostHwnd, browserHwnd)`；验证失败则阻止状态进入 `ready`。运行态包含 `embedded: true` 与 `productName: "AI-FREE"`。Native Host 会清除外部浏览器的 `WS_EX_APPWINDOW`，把 Browser HWND 作为子窗口显示在 Electron 预留区域，并同步宿主尺寸。

## 品牌边界

- 客户端运行时标签、宿主窗口标题和嵌入子窗口标题统一显示为“AI-FREE”。
- 系统 Google Chrome 仅用于 Phase 0 冒烟测试；启动器在非 prototype 模式下不会自动选择它。
- 真正修改进程文件名、版本资源、图标、设置页、关于页和 Chromium WebUI 字符串，必须在 Chromium Fork 源码中完成。
- 正式 Fork 产物目录为 `resources/chromium/`，打包时会复制到应用 `resources/chromium/`。
- 不允许通过复制和重命名 Google 签名二进制来伪装产品品牌。

可重复执行：

```powershell
npm run build:native-host
npm run check:browser-runtime
npm --prefix native/browser-host test
$env:AI_FREE_SMOKE_AUTO_CLOSE='1'
npm run smoke:chromium
```

## 后续阶段边界

Phase 2 不包含以下能力：

- 当前 Windows 用户专属 Pipe ACL 的双端验证；
- 内置扩展 bootstrap、Cookie/Storage 迁移和下载/权限事件；
- 新窗口完整管理、Crashpad 符号与指纹内核补丁。

在这些外部补丁完成前，现有 BrowserView 路径不会被删除。

## Phase 2：AI-FREE Chromium Fork

### 锁定版本与环境

| 项目 | 锁定值 |
|---|---|
| Chromium | `150.0.7871.114` |
| Chromium tag | `refs/tags/150.0.7871.114` |
| Chromium commit | `f405107495a07cb1bfcf687d4af8d91117098db6` |
| 源码目录 | `E:\chromium-ai-free\src`（独立于 app2.1） |
| depot_tools | `953e42245133578f3af7abebe9f929f2cfc549cf` |
| Visual Studio | Build Tools 2026 `18.7.11925.98`，实际路径 `C:\VSBuildTools` |
| MSVC | `19.51.36248` x64 |
| Windows SDK | `10.0.26100.8249` |
| GN 输出目录 | `out/AI-Free` |
| 构建命令 | `autoninja -C out/AI-Free -j 16 chrome` |

完整锁定清单位于 `native/chromium-fork/version-lock.json`，Visual Studio
组件清单位于 `native/chromium-fork/toolchain.vsconfig`，GN 参数位于
`native/chromium-fork/args.gn`。本构建使用 `symbol_level=0`，不生成大体积 PDB。
Windows SDK Debugging Tools `10.0.26100.8249` 已通过微软官方 SDK 安装器补齐，
`dbghelp.dll`、`dbgeng.dll` 均已验证。构建脚本显式设置非默认 VS 路径
`C:\VSBuildTools`，并在构建阶段关闭 Python UTF-8 强制模式，以兼容中文 Windows
下 `icacls` 的 CP936 输出。该路径同时避免了根目录 `C:\Program`
与未加引号的 `C:\Program Files\...` 命令行发生路径歧义。

### 补丁队列

补丁按 `native/chromium-fork/patches/series` 固定顺序应用：

1. `0001-ai-free-branding.patch`：公司、产品、安装器和版本资源品牌。
2. `0001a-ai-free-ui-strings.patch`：产品名、窗口标题、任务管理器、设置/版本页
   使用的 AI-FREE UI 字符串。
3. `0001b-ai-free-about-and-logo-strings.patch`：登录/同步、关于页、帮助入口、应用菜单、
   设置、组件提示、隐私沙盒、策略页面和产品徽标的 AI-FREE 中英文品牌字符串。
4. `0001c-ai-free-disable-google-api-warning.patch`：AI-FREE 不捆绑 Google 私有 API Key，
   因此禁止首个窗口显示缺少 Google API Key 的启动提示条。
5. `0002-ai-free-runtime-switches.patch`：五个 `--hs-*` 私有参数。
6. `0003-ai-free-runtime-pipe.patch`：长度前缀 JSON Named Pipe 握手、heartbeat、
   六条双向命令及 Cookie/Storage 会话导入。
7. `0004-ai-free-browser-window-handshake.patch`：Browser 顶层 HWND 主动上报。
8. `0005-ai-free-windows-icon.patch`：从 `native/chromium-fork/assets/AI-FREE.png`
   生成的关于页、版本页、快捷方式、文档关联、Windows 磁贴和多尺寸
   ICO 全量品牌图标（二进制 Git patch）。
9. `0006-ai-free-embedded-input-activation.patch`：仅在显式
   `--hs-embed-mode=child-window` 下修正嵌入子 HWND 的激活判断与鼠标按下焦点恢复，
   防止 Electron 窗口切换后点击穿透。
10. `0007-ai-free-embedded-window-lockdown.patch`：仅在显式
    `--hs-embed-mode=child-window` 下禁用窗口拖动、标签拖出、关闭/最小化/最大化、
    用户界面的新建与关闭标签页入口；普通 Chromium 模式不受影响。
11. `0008-ai-free-extension-popup-auto-dismiss.patch`：修复嵌入 Browser HWND 跨越
    Chromium/Electron 原生窗口树后，部分扩展浮窗无法收到窗口树激活事件而残留；
    嵌入模式下扩展 Popup 改为原生失焦自动关闭，并以 150ms 鼠标位置看门狗补偿
    插件图标 Hover Card 偶发丢失 `OnMouseExited`；普通 Chromium 行为保持不变。
12. `0009-ai-free-embedded-omnibox-read-only.patch`：仅在嵌入模式下把地址栏设为
    只读，保留当前网址展示，同时禁用聚焦/提交地址栏命令、“粘贴并转到”、中键
    粘贴和网址拖放；不修改 `chrome.tabs` 扩展 API 或 Runtime Bridge 导航接口。
13. `0010-ai-free-embedded-toolbar-simplification.patch`：嵌入模式下将所有带工具栏
    Action 的已加载插件统一视为固定状态；地址栏保留原始宽度分配作为透明占位，
    但不绘制输入框，并隐藏网址文字、收藏、PWA 安装、权限、翻译等全部内部控件，
    同时关闭该区域的鼠标事件并隐藏账号头像。这样导航按钮、插件按钮及其他工具栏
    区域不会因地址栏被压缩而错位；普通 Chromium 模式不受影响。

嵌入模式只封锁用户界面、菜单、快捷键和标签右键菜单，不修改 Chromium 扩展
`chrome.tabs` API。外部扩展需要新建空白页时，声明 `tabs` 权限后可直接调用：

```js
const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
```

扩展也可继续使用 `chrome.tabs.update`、`chrome.tabs.remove` 管理自己创建的标签页；
这些调用不经过被禁用的浏览器用户命令入口。

Phase 2 的前六个补丁已在 Chromium 150 对应文件快照上执行完整回放测试。
Phase 3 更新后的 Runtime Bridge、Browser HWND 交接及输入激活补丁已对当前锁定
checkout 执行逐补丁反向一致性检查，确认 patch 内容与已编译源码完全一致。真实
blob-less checkout 使用 `git apply --index`，避免为创建
补丁提交树而下载全部 promisor blob，同时保留工作树与索引校验。首次真实编译
发现 M150 的 JSON API 已使用 `JSONReader::ReadDict(..., JSON_PARSE_RFC)` 和
`base::DictValue`；修复已同步写回 overlay 与 runtime pipe 补丁，并在全新基线
worktree 再次顺序应用前 6 个补丁通过。Chromium 端不调用 `SetParent`；仍由
`browser_host.node` 唯一执行样式切换、父子窗口绑定和嵌入验证。

### 构建与产物

```powershell
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/check-environment.ps1
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/sync-source.ps1
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/apply-patches.ps1
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/build.ps1
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/stage-runtime.ps1
```

`gn gen out/AI-Free --fail-on-unused-args` 生成 31,029 个 targets；随后
`autoninja -C out/AI-Free -j 16 chrome` 完成 57,527 个构建动作。最终 Ninja
dry-run 返回 `no work to do`。`chrome.exe` 与 `chrome.dll` 的 Windows 版本资源
均为 `AI-FREE 150.0.7871.114`。

stage 脚本复制完整运行目录到 `resources/chromium/`，包括 EXE、DLL、PAK、
`locales/`、`resources/`、MEIPreload、SwiftShader/Vulkan 和 VC runtime；当前产物
为 480 个文件、约 477.7 MiB。正式入口为 `ai-free-browser.exe`。脚本同时设置
`ALL RESTRICTED APPLICATION PACKAGES` 继承只读/执行 ACL，确保复制后的 Chromium
AppContainer 网络服务不因无法读取 EXE/DLL 而崩溃。禁止只复制 EXE。

### 已执行验收（2026-07-13）

- `npm run check:browser-runtime`：通过；正式模式仅接受
  `resources/chromium/ai-free-browser.exe`，系统 Chrome/外部路径回退测试通过。
- `npm run check:chromium-handshake`：通过；长度前缀、token/profile/PID/session
  校验与 heartbeat 协议测试通过。
- `npm run check:chromium-embedded-policy`：通过；嵌入窗口样式、窗口/标签用户入口
  封锁、扩展 `chrome.tabs.create` 保留和扩展浮窗失焦关闭策略检查通过。
- Chromium 增量构建：窗口策略涉及的 8 个 C++ 文件，以及最新的
  `extension_popup.cc`、`toolbar_action_hover_card_controller.cc` 均成功编译，
  `chrome.dll` 与主程序完成链接并已重新 stage 到 `resources/chromium/`；正式 Fork
  双 Profile 嵌入短验收通过。
- `npm start`：成功进入“打包内核 + Named Pipe 握手，禁止系统浏览器回退”正式
  模式；主应用未选择 Chromium profile 时不会预启动外部浏览器。
- 真实模式短测：2 个 profile 均从打包目录启动，20 次切换和 20 秒 soak 通过；
  未设置 `AI_FREE_CHROMIUM_HANDSHAKE`/`AI_FREE_CHROMIUM_PATH`。
- 正式 500 次连续切换：通过；随后 `7200000 ms`（2 小时）soak 通过。两个
  profile 的原始根 PID 全程未变化，1 小时时 handles 为 1478/1479、内存约
  152.3/150.9 MiB，结束后 `stopAll` 将根浏览器进程清理为 0。
- 独立真实输入验收：通过 `focusChildWindow` 聚焦嵌入 Browser HWND，发送
  Ctrl+L、粘贴、Enter、滚轮，并执行 resize/focus；窗口保持存活，heartbeat
  持续更新，窗口标题为 `Example Domain - AI-FREE`。
- 最终 EXE 关联图标已提取并与 `AI-FREE.png` 目视核对一致；产品/文件描述为
  `AI-FREE`，版本为 `150.0.7871.114`。

### Phase 2 验收状态

- [x] 磁盘、NTFS、内存、VS、MSVC、SDK 和 depot_tools 检查。
- [x] 版本/commit/depot_tools/GN 参数/命令锁定。
- [x] 七段可重复补丁队列；Phase 2 队列完成独立回放，Phase 3 变更完成源码/补丁
  反向一致性校验。
- [x] Electron 正式入口禁止系统 Chrome/外部路径静默回退。
- [x] Named Pipe hello/hello-accepted/heartbeat 自动检查。
- [x] Electron Runtime 在 ready 前校验 `bridgeConnected`、`sessionId`、`browserHwnd`，嵌入后设置 `embedded=true`。
- [x] Electron 40 x64 `browser_host.node` 重新编译并通过 API 测试。
- [x] Chromium 完整源码、DEPS、CIPD 与 hooks 同步。
- [x] `out/AI-Free` 全量编译及完整运行目录 stage。
- [x] 正式 Fork 品牌、真实握手、Browser HWND 上报和 Native Host 嵌入。
- [x] 连续切换 500 次。
- [x] 输入、滚轮、快捷键、focus 和 resize 真实 HWND 验收。
- [x] 2 小时 HWND/session/heartbeat 稳定性验收。

自动验收入口为 `npm run accept:chromium-phase2`；默认执行 500 次切换并持续
2 小时检查 HWND、sessionId、embedded 和 heartbeat，不设置 prototype 变量。

## Phase 3：双向 Runtime Bridge 与会话导入

### 协议与线程模型

握手成功后，Electron 和 Chromium 继续复用同一条长度前缀 JSON Named Pipe。
最大帧长为 4 MiB；Chromium 的阻塞命令读取与 heartbeat 位于独立 ThreadPool
任务，写操作由连接级锁串行化，因此等待 `ReadFile` 不会停止 heartbeat。命令通过
校验后统一投递 Chromium UI 线程，再访问 `Browser`、`WebContents`、Cookie Store
或 StoragePartition。

所有请求都必须包含以下关联字段：

```json
{
  "type": "navigate",
  "protocolVersion": 1,
  "profileId": "profile-a",
  "sessionId": "runtime-session-id",
  "requestId": "electron-pid-time-sequence",
  "url": "https://example.test/"
}
```

成功与失败都使用原 `requestId` 返回，不允许无响应地伪装成功：

```json
{
  "type": "response",
  "protocolVersion": 1,
  "profileId": "profile-a",
  "sessionId": "runtime-session-id",
  "requestId": "electron-pid-time-sequence",
  "command": "navigate",
  "ok": true,
  "result": { "url": "https://example.test/", "title": "Example" }
}
```

```json
{
  "type": "response",
  "protocolVersion": 1,
  "profileId": "profile-a",
  "sessionId": "runtime-session-id",
  "requestId": "electron-pid-time-sequence",
  "command": "set-storage",
  "ok": false,
  "error": { "code": "STORAGE_ORIGIN_MISMATCH", "message": "..." }
}
```

命令白名单固定为 `navigate`、`reload`、`close-browser`、`set-cookies`、
`set-storage`、`clear-session`。协议版本、Profile、Session、requestId、命令名、
URL/origin 和帧长均在 Chromium 端再次校验；错误使用稳定 `code` 和可读 `message`。

### 会话导入边界

`BrowserRuntimeManager.importSession(profileId, { cookies, browserStorage,
targetUrl })` 只分发给 `ChromiumRuntime`。流程固定为：

1. 在 Electron 主进程规范化输入并校验目标 URL、Cookie domain 和 Storage origin；
   与目标站点无关的 Cookie/Storage 会被安全跳过，格式错误或数据超限仍会终止导入。
2. 发送 `clear-session`，清理当前独立 Profile 的 Cookie、LocalStorage 和
   SessionStorage。
3. 发送 `set-cookies`，由 Chromium 当前 Profile 的 CookieManager 写入 Cookie Store，
   保留 domain、path、secure、httpOnly、sameSite 和 expires。
4. 按 origin 顺序发送 `set-storage`；Chromium 导航到对应 origin，在隔离执行 world
   写入并回读验证 LocalStorage/SessionStorage。
5. 所有会话写入步骤成功后发送 `navigate(targetUrl)`；页面加载超过桥接等待时间时
   保留标签和独立 Profile，让 Chromium 继续加载。其他导入错误会返回业务调用，
   但也不再自动关闭浏览器，便于用户重试或检查现场。

`license.js` 与 `account_remember.js` 已按标签运行时分流：Chromium 标签只调用上述
接口，Electron 标签继续走原有 `auth-cookie`/`webContents.session`。Chromium 分支
不再存在“跳过 Electron webContents 注入但返回成功”的临时路径。

### 构建与验收入口

```powershell
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/build.ps1
powershell -ExecutionPolicy Bypass -File native/chromium-fork/scripts/stage-runtime.ps1
npm run accept:chromium-phase3
```

`accept:chromium-phase3` 使用本机 HTTP 测试站点和两个真实独立 Profile，检查导航、
刷新、普通/HttpOnly Cookie、LocalStorage、SessionStorage、跨 Profile 隔离、非法
session/profile/origin、超大帧、进程/Named Pipe/Profile Lock 回收，并检查 Profile
磁盘上的 Cookie Store 与 Local Storage 文件。它不使用 Electron `webContents` 注入，
也不启用系统 Chrome、调试端口或画面串流。

### Phase 3 实际验收（2026-07-13）

- `npm run accept:chromium-phase3`：通过。`navigate` 改变真实页面地址/标题，
  `reload` 使测试页加载计数递增；两个独立 Chromium Profile 均完成命令响应闭环。
- 普通 Cookie 由测试页 `document.cookie` 实际读到；HttpOnly Cookie 出现在测试
  HTTP 服务收到的请求头中，同时不出现在页面脚本结果中。Cookie Store 文件在独立
  Profile 磁盘目录中存在，不经过 Electron `webContents/session`。
- LocalStorage 与 SessionStorage 均由真实 Chromium 页面回读到导入值；第二个
  Profile 无法读到第一个 Profile 的 Cookie/Storage，反向亦然。
- 非法 `sessionId`、`profileId`、无关 origin 和超过 4 MiB 的消息均被拒绝；关闭后
  根 Chromium 进程、Named Pipe 和 Profile Lock 均释放。
- `npm run accept:chromium-input`：通过 Bridge `navigate` 后的点击、键盘、滚轮、
  resize 与 heartbeat 验收；脚本额外打开第二个 Electron 窗口并切回，未主动调用
  Runtime focus 即可点击得到 `CLICK_OK`。随后手工复验窗口切换，鼠标和键盘均正常。
- Phase 3 最终补丁完成增量 Chromium 编译并重新 stage；最终 Ninja dry-run 返回
  `no work to do`。`check:browser-runtime`、`check:chromium-handshake`、Native Host
  测试和 20 次切换 + 10 秒 soak 回归均通过。

### 当前限制

- 当前实现仅支持 Windows Win32 子窗口嵌入；其他平台没有独立 Chromium Host。
- Runtime Bridge 单帧上限为 4 MiB。Storage 导入会按 origin 依次导航到受控页面后
  写入并回读，导入期间可能短暂显示中间 origin，全部成功后才进入 `targetUrl`。
- Phase 3 最终输入补丁后执行的是 20 次切换 + 10 秒 soak 回归；500 次切换和 2 小时
  soak 已在此前同一 Chromium 150 Runtime 上通过，但未在最后一个输入补丁后重新跑满。
- 扩展加载、代理、下载、新窗口接管等属于后续独立任务，不在本阶段会话桥接闭环内。
