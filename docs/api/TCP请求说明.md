# `server_vue/comm` TCP 请求说明

本文档整理 `server_vue/comm` 下的 TCP 协议消息，分为两类：

- 客户端协议：`comm/tcp/client/server.py` + `comm/tcp/client/handlers.py`
- 注册器协议：同一套 TCP 服务器中复用的注册器消息处理

## 1. TCP 消息格式

TCP 消息头使用固定结构：

- `msg_id`：4 字节
- `msg_type`：2 字节
- `data_len`：4 字节
- `data`：JSON 序列化后的业务数据

对应实现见 `pack_message()` 和 `unpack_message_header()`。

## 2. 客户端 TCP 请求

### 2.1 请求类型总表

| 类型值 | 常量 | 方向 | 处理函数 | 作用 |
| --- | --- | --- | --- | --- |
| `0x0001` | `MSG_TYPE_VALIDATE_KEY_REQ` | 请求 | `handle_tcp_validate_key()` | 验证卡密和设备号 |
| `0x0003` | `MSG_TYPE_FETCH_COOKIE_REQ` | 请求 | `handle_tcp_fetch_cookie()` | 验证后获取 Cookie |
| `0x0005` | `MSG_TYPE_CLIENT_CONFIG_REQ` | 请求 | `handle_tcp_client_config()` | 获取客户端配置 |
| `0x0007` | `MSG_TYPE_HEARTBEAT` | 请求 | `handle_tcp_heartbeat()` | 心跳保活 |
| `0x000A` | `MSG_TYPE_GET_PROXY_STATUS_REQ` | 请求 | `handle_tcp_get_proxy_status()` | 获取代理状态和流量信息 |
| `0x000E` | `MSG_TYPE_GET_TARGET_URL_REQ` | 请求 | `handle_tcp_get_target_url()` | 获取目标访问地址 |
| `0x000F` | `MSG_TYPE_GET_TUTORIAL_URL_REQ` | 请求 | `handle_tcp_get_tutorial_url()` | 获取教程地址 |
| `0x0010` | `MSG_TYPE_GET_ALLOWED_PLATFORMS_REQ` | 请求 | `handle_tcp_get_allowed_platforms()` | 获取允许的平台列表 |
| `0x0012` | `MSG_TYPE_UNBIND_DEVICE_REQ` | 请求 | `handle_tcp_unbind_device()` | 解绑设备 |
| `0x0014` | `MSG_TYPE_GET_AI_REFRESH_TIME_REQ` | 请求 | `handle_tcp_get_ai_refresh_time()` | 查询 AI 账号刷新时间 |

### 2.2 注册器相关请求

| 类型值 | 常量 | 方向 | 处理函数 | 作用 |
| --- | --- | --- | --- | --- |
| `0x0201` | `MSG_TYPE_REGISTRATION_HELLO_REQ` | 请求 | `handle_tcp_registration_hello()` | 注册器握手 |
| `0x0203` | `MSG_TYPE_REGISTRATION_STATE_REPORT_REQ` | 请求 | `handle_tcp_registration_state_report()` | 注册器状态上报 |
| `0x0207` | `MSG_TYPE_REGISTRATION_HEARTBEAT_REQ` | 请求 | `handle_tcp_registration_heartbeat()` | 注册器心跳 |
| `0x0209` | `MSG_TYPE_REGISTRATION_SUCCESS_REQ` | 请求 | `handle_tcp_registration_success()` | 注册成功通知 |

### 2.3 响应类型

服务器会返回对应的响应消息类型：

| 类型值 | 常量 | 对应请求 |
| --- | --- | --- |
| `0x0002` | `MSG_TYPE_VALIDATE_KEY_RESP` | 验证卡密 |
| `0x0004` | `MSG_TYPE_FETCH_COOKIE_RESP` | 获取 Cookie |
| `0x0006` | `MSG_TYPE_CLIENT_CONFIG_RESP` | 获取客户端配置 |
| `0x0008` | `MSG_TYPE_HEARTBEAT_RESP` | 心跳 |
| `0x000B` | `MSG_TYPE_GET_PROXY_STATUS_RESP` | 获取代理状态 |
| `0x0013` | `MSG_TYPE_UNBIND_DEVICE_RESP` | 解绑设备 |
| `0x0015` | `MSG_TYPE_GET_AI_REFRESH_TIME_RESP` | 查询 AI 刷新时间 |
| `0x0202` | `MSG_TYPE_REGISTRATION_HELLO_RESP` | 注册器握手 |
| `0x0204` | `MSG_TYPE_REGISTRATION_STATE_REPORT_RESP` | 注册器状态上报 |
| `0x0206` | `MSG_TYPE_REGISTRATION_COMMAND_RESP` | 注册器命令 |
| `0x0208` | `MSG_TYPE_REGISTRATION_HEARTBEAT_RESP` | 注册器心跳 |
| `0x020A` | `MSG_TYPE_REGISTRATION_SUCCESS_RESP` | 注册成功通知 |

## 3. 关键处理链路

### 3.1 卡密验证

- TCP 服务器在 `self.message_handlers` 中把 `0x0001` 映射到 `handle_tcp_validate_key()`
- `handle_tcp_validate_key()` 直接调用 `comm.tcp.helpers.validate_key_core()`
- `TCPServer._process_message()` 在验证成功后会记录客户端信息

### 3.2 获取 Cookie

- `handle_tcp_fetch_cookie()` 先调用 `validate_key_core()`
- 再执行：
  - `get_user_by_key()`
  - `check_rate_limit()`
  - `authorize_platform()`
  - `get_account_with_strategy()`
  - `load_account_cookies()`
  - `consume_usage_quota()`
  - `update_account_usage()`
  - `log_cookie_usage()`
  - `update_user_stats()`

### 3.3 注册器消息

- 注册器消息也走同一个 TCP 服务器
- 处理器在 `comm.tcp.client.handlers` 中实现
- 相关状态会同步到 `registration_clients` 和 `registration_snapshots`

## 4. 相关代码位置

- TCP 服务器：`server_vue/comm/tcp/client/server.py`
- TCP 客户端处理器：`server_vue/comm/tcp/client/handlers.py`
- TCP 通用校验：`server_vue/comm/tcp/helpers.py`
- 注册器路由：`server_vue/comm/tcp/registry/routes.py`

## 5. 各请求对应返回结果

以下为 TCP 消息体中常见的响应 JSON 结构。实际 TCP 响应外层还会包一层消息头，业务数据位于消息体内。

### 5.1 客户端 TCP 请求返回

#### `0x0001` `MSG_TYPE_VALIDATE_KEY_REQ`

- 成功时主要返回：
  - `valid: true`
  - `ok: true`
  - `success: true`
  - `state: "active"`
  - `status: "active"`
  - `expire_at: string`
  - `days_left: number`
  - `expires_in_seconds: number`
  - `account_type` / `accountType`
  - `account_type_label` / `accountTypeLabel`
  - `max_usage_times`
  - `used_usage_times`
  - `remaining_usage_times`
  - `max_device_count`
  - `device_bind_count`
  - `device_binding_status`
  - `max_unbind_times`
  - `used_unbind_times`
  - `remaining_unbind_times`
  - `regionCandidates` / `region_candidates`
  - `regionInfo` / `region_info`
  - `message: "验证成功"`
- 失败时常见返回：
  - `valid: false`
  - `message: string`
  - 可能附带 `status`
  - 设备绑定失败时可能附带 `max_device_count`、`device_bind_count`

#### `0x0003` `MSG_TYPE_FETCH_COOKIE_REQ`

- 成功时主要返回：
  - `ok: true`
  - `cookies: array`
  - `server_recycle_time` / `serverRecycleTime`
  - `refresh_info` / `refreshInfo`
  - `refresh_status` / `refreshStatus`
  - `next_refresh_at` / `nextRefreshAt`
  - `remaining_seconds` / `remainingSeconds`
  - `remaining_minutes` / `remainingMinutes`
  - `ai_account_expiry_time` / `aiAccountExpiryTime`
  - `region: string`
  - `platform: string`
  - `account_type` / `accountType`
  - `account_type_label` / `accountTypeLabel`
  - `user_account_type` / `userAccountType`
  - `user_account_type_label` / `userAccountTypeLabel`
  - `current_account_type` / `currentAccountType`
  - `current_account_type_label` / `currentAccountTypeLabel`
  - `message: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0005` `MSG_TYPE_CLIENT_CONFIG_REQ`

- 成功时主要返回：
  - `ok: true`
  - `proxy_subscription_url: string`
  - `yaml_file: string`
  - `yaml_content: string`
  - `profiles_yaml_content: string`
  - `red_yaml_content: string`
  - `content: string`
  - `configContent: string`
  - `custom_group: object | null`
  - `custom_group_link: string`
  - `custom_group_template_name: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0007` `MSG_TYPE_HEARTBEAT`

- 成功时主要返回：
  - `ok: true`
  - `status: "pong"`
  - `probe_id`
  - `source`
  - `timestamp`
  - `message: "心跳响应成功"`
- 失败时常见返回：
  - `ok: false`
  - `status: "error"`
  - `message: string`

#### `0x000A` `MSG_TYPE_GET_PROXY_STATUS_REQ`

- 成功时主要返回：
  - `ok: true`
  - `status: object`
- `status` 中当前实现通常包含：
  - `sys_proxy_enabled: boolean`
  - `pac_enabled: boolean`
  - `traffic_used: number`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x000E` `MSG_TYPE_GET_TARGET_URL_REQ`

- 成功时主要返回：
  - `ok: true`
  - `targetUrl: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x000F` `MSG_TYPE_GET_TUTORIAL_URL_REQ`

- 成功时主要返回：
  - `ok: true`
  - `tutorialUrl: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0010` `MSG_TYPE_GET_ALLOWED_PLATFORMS_REQ`

- 成功时主要返回：
  - `ok: true`
  - `allowedPlatforms: array`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0012` `MSG_TYPE_UNBIND_DEVICE_REQ`

- 成功时主要返回：
  - `ok: true`
  - `message: "解绑成功"`
  - `data: object`
- `data` 为解绑后的用户信息
- 失败时常见返回：
  - `ok: false`
  - `message: string`
  - 可能附带 `status`

#### `0x0014` `MSG_TYPE_GET_AI_REFRESH_TIME_REQ`

- 成功时主要返回：
  - `ok: true`
  - `message: string`
  - `data: object`
- `data` 中为刷新倒计时、下次刷新时间、状态等字段
- 失败时常见返回：
  - `ok: false`
  - `message: string`

### 5.2 注册器 TCP 请求返回

#### `0x0201` `MSG_TYPE_REGISTRATION_HELLO_REQ`

- 成功时主要返回：
  - `ok: true`
  - `instance_id: string`
  - `message: "registration bridge connected"`
  - `server_time: string`
  - `registration_default_execution_plan` / `registrationDefaultExecutionPlan`
  - `snapshot: object`
  - `supported_commands: array`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0203` `MSG_TYPE_REGISTRATION_STATE_REPORT_REQ`

- 成功时主要返回：
  - `ok: true`
  - `instance_id: string`
  - `message: "registration state stored"`
  - `server_time: string`
  - `snapshot: object`
  - `registration_default_execution_plan` / `registrationDefaultExecutionPlan`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0207` `MSG_TYPE_REGISTRATION_HEARTBEAT_REQ`

- 成功时主要返回：
  - `ok: true`
  - `instance_id: string`
  - `server_time: string`
  - `snapshot: object`
  - `registration_default_execution_plan` / `registrationDefaultExecutionPlan`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `0x0209` `MSG_TYPE_REGISTRATION_SUCCESS_REQ`

- 成功时主要返回：
  - `ok: true`
  - `instance_id: string`
  - `task_id: string`
  - `email: string`
  - `card_name: string`
  - `points: number`
  - `duplicate: boolean`
  - `registration_success_count: number`
  - `last_registration_success_at: string`
  - `data: object`
  - `message: "registration success recorded"`
  - `server_time: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`
