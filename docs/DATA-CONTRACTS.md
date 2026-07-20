# 数据与 IPC 契约

## IPC

- 真源：`src/app/contracts/ipc-channels.js`。
- 输入 schema：`src/app/contracts/ipc-payloads.js`；诊断只记录字段路径与原因，不记录字段值。
- 类型：`src/app/contracts/ipc-contracts.ts`。
- 新接口结果：`IpcResult<T>`；失败包含稳定 `code`、用户可读 `message`、`retryable` 和可选脱敏 `details`。
- 注册：`src/app/main/ipc/registry.js`；未登记或重复通道立即失败，`dispose()` 精确移除本注册器监听器。

## 持久化兼容

账号、聊天历史、浏览器 Profile、许可证、代理配置和扩展状态继续读取原路径与旧字段。repository/service 必须：

1. 对缺失文件返回明确空状态；区分缺失和损坏。
2. 校验后写入，使用临时文件/原子替换的模块不得退化为直接覆盖。
3. 新字段保持旧读取器可忽略；删除/重命名字段前提供幂等迁移。
4. 不在日志、fixture 或 snapshot 中保存 Cookie、API Key、卡密、设备凭据和临时 token。

## Chromium/扩展桥

AutomationBridge 仅接受 loopback、正确应用 token 和仍存活的 managed Chromium PID。扩展源目录的环境文件不含运行 token；每次启动把凭据写入 userData 下独立运行副本，退出清理。

外部 MCP 网关与 AutomationBridge 共用 loopback 监听器，但使用独立的 256-bit 会话令牌。描述文件始终发布，以便非会员获得明确的权限提示；工具列表和调用仅在服务端近期验证为有效 VIP 后开放。会员状态切换时轮换令牌，退出时删除描述文件。外部调用不得上传或回传 Cookie 原始内容。接口与权限行为见 [api/外部MCP网关.md](api/外部MCP网关.md)。

打包约束：自研扩展位于 ASAR unpack，Chromium、Clash Core、native host 和 logo 位于 external resources。`check:packaged-runtime` 是该文件布局的可执行契约。
