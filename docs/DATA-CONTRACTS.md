# AI-FREE 数据与兼容契约

最后核对：2026-07-25。除非有显式迁移、兼容读取和恢复测试，下列路径、字段语义及失败
行为均视为稳定契约。

## 1. IPC 结果与错误

新接口使用：

```js
{ ok: true, data }
{ ok: false, error: { code, message, retryable, details? } }
```

实现位于 `src/app/contracts/ipc-result.js`。现有 legacy handler 在迁移前可以保留旧结果，
但不得静默改变成功/失败语义。

工作域发送方校验失败统一返回：

```js
{
  ok: false,
  error: {
    code: 'WORKSPACE_ACCESS_DENIED',
    message: '...',
    retryable: false
  }
}
```

未注册、已销毁或不属于允许工作域的 `event.sender` 都必须失败且无业务副作用。

## 2. IPC 注册契约

- invoke、renderer event 和主进程 push 通道的真源是
  `src/app/contracts/ipc-channels.js`。
- 需要 payload 校验的通道先登记 `requestSchema`，schema 真源是
  `src/app/contracts/ipc-payloads.js`。
- handler/listener 只能经 `main/ipc/registry.js` 注册，并由返回的 registry
  `dispose()` 成对释放。
- preload 方法固定绑定单一通道，禁止向 renderer 暴露接受任意 channel 的
  `invoke`、`send` 或 `on`。
- 工作域迁移期间优先保留现有通道名，通过 scoped preload 和 sender 授权缩小权限。

具体通道与 domain 以源码契约表为准；不得维护第二份手工数量真源。

## 3. 当前持久化路径

| 路径 | 数据 | 兼容要求 |
|---|---|---|
| `userData/store/content` | 账号凭据、授权及部分运行配置 | 加密/校验后写入；保留旧字段读取 |
| `userData/account_sessions/` | 账号会话 | 不写入 Cookie/Storage 明文；旧会话继续读取 |
| `userData/chromium-profiles/` | Chromium Profile | 不因工作域分离移动 |
| `userData/Partitions/`、`userData/tab-*` | Electron/标签分区 | 只清理已确认不在使用的分区 |
| `userData/ai-chat-history/*.json` | AI 会话历史 | 分类前保留；无法可靠归属的历史只读 |
| `userData/extensions/browser_automation/automation-cards.json` | 当前自动化卡片缓存 | 保留旧路径读取；迁移按明确 domain 分类 |
| `userData/software/ai-history/*.json` | Software AI 会话 | 只写可靠归属的软件会话；旧文件保留 |
| `userData/software/automation/automation-cards.json` | Software Automation 卡片 | 强制 `domain: software`；与 Browser 选择状态隔离 |
| `userData/app-window-state.json` | 当前混合主窗口布局 | 新窗口状态新增写入，不破坏此文件 |
| `userData/ai-server-device-credentials.json` | AI Server Device 凭据 | 由安全存储封装，不记录明文 |
| `userData/logs/` | 结构化运行日志 | 禁止 Cookie、API Key、卡密和 token |
| 安装目录 `AI-Workspace/` | AI 下载与沙箱文件 | 路径解析集中管理，写入必须限制在沙箱内 |

`getStorePath()`、`config/paths.js` 及各领域 repository/path resolver 是路径真源。业务代码
不得复制开发态、`.generated/app` 或 packaged runtime 特判。

## 4. 工作域目录

```text
shared/ui-preferences.json
software/ai-history/
software/automation/
```

新增数据包含 `schemaVersion`，迁移必须幂等、原子写入，并在失败时保留旧数据。
连续两个稳定版本确认无需回退前，不删除旧读取能力或旧文件。

## 5. AI 会话契约

- 共享模型 client、流解析、消息裁剪和错误映射必须无工作域状态。
- 新 run 标识必须包含工作域：
  `browser:<conversationId>:<runId>` 或 `software:<conversationId>:<runId>`。
- Browser AI 不得获得软件 HWND、进程或 `software_ui` 工具。
- Software AI 不得获得 Cookie、Profile、浏览器历史或网页 MCP。
- stop 只能停止同一工作域的 run；事件只发送给发起窗口。
- 旧历史只有在存在可靠字段时才分类，无法判断时不猜测。

## 6. 自动化卡片契约

新卡片最低 schema：

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

- Browser runner 拒绝 `domain: 'software'`，Software runner 反之。
- 进度事件包含 `domain`、`taskId` 和目标标识。
- stop 只停止同域同任务。
- 旧卡片按明确类型或步骤能力分类；混合卡片进入兼容区，不自动拆分。

## 7. 浏览器与软件运行数据

浏览器选择与软件选择不得复用同一个活动标签：

```js
browserSelection = { browserProfileId, tabId }
softwareSelection = { softwareProfileId, hwnd, pid }
```

Chromium Profile、历史 ID、partition 与 runtime target 的既有含义在 Browser
Workspace 迁移时保持。软件实例的 HWND/PID 只在 Software Workspace 生命周期内有效，
不得持久化为可跨启动复用的可信句柄。

## 8. 迁移和恢复

- 首次启动只读检测旧数据，再决定是否生成新领域副本。
- 原子写入临时文件必须与目标同目录，并在成功替换或失败后清理。
- 损坏数据返回可诊断错误，不使用宽泛 `catch` 假装成功。
- 重复迁移结果一致；写入失败后旧版本仍可启动并读取旧数据。
- 迁移测试至少覆盖成功、缺失、损坏、写入失败和重复执行。
