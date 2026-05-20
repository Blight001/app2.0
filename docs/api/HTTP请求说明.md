# `server_vue/comm` HTTP 请求说明

本文档整理 `server_vue/comm` 下对外暴露的 HTTP 接口，分为两类：

- `comm/http/client/routes.py`：客户端使用的 HTTP 接口
- `comm/tcp/registry/routes.py`：注册器/管理端使用的 HTTP 接口

## 1. 客户端 HTTP 接口

蓝图前缀为 `/api`，实际路径形如 `/api/...`。

| 方法 | 路径 | 作用 | 主要参数 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` / `POST` | `/api/validate_key` | 验证卡密和设备号 | `key`, `device_id` | 直接调用统一校验核心 `validate_key_core()` |
| `GET` | `/api/client/config` | 获取客户端配置 | 无 | 返回订阅、代理、分组等配置 |
| `POST` | `/api/fetch_cookie` | 验证后获取 Cookie | `key`, `platform`, `device_id` | 先校验卡密，再分配账号、扣次数、返回 Cookie |
| `GET` / `POST` | `/api/refresh-time` | 查询 AI 账号刷新时间 | `key`, `device_id`/`deviceId`, `platform`, `account` | 使用只读校验，不做次数消耗 |
| `POST` | `/api/upload_ai_cookie` | 上传 AI Cookie | 请求体由 `process_ai_cookie_upload()` 解析 | `source='http'` |
| `POST` | `/api/unbind_device` | 解绑设备 | `key`, `device_id`/`deviceId` | 校验状态后执行解绑 |
| `POST` | `/api/get_proxy_status` | 获取代理状态 | 请求体透传给 TCP 处理器 | 实际复用 TCP handler |
| `GET` | `/api/get_target_url` | 获取目标访问地址 | 无 | 实际复用 TCP handler |
| `GET` | `/api/get_tutorial_url` | 获取教程地址 | 无 | 实际复用 TCP handler |
| `GET` | `/api/get_allowed_platforms` | 获取允许的平台列表 | 无 | 实际复用 TCP handler |

### 1.1 关键链路

- `/api/validate_key` 和 `/api/fetch_cookie` 都会调用 `comm.tcp.helpers.validate_key_core()`
- `/api/fetch_cookie` 在通过校验后，还会调用：
  - `get_user_by_key()`
  - `check_rate_limit()`
  - `authorize_platform()`
  - `get_account_with_strategy()`
  - `load_account_cookies()`
  - `consume_usage_quota()`
  - `update_account_usage()`

### 1.2 常见返回

- 成功校验：`{"valid": true, ...}`
- 缺少参数：`{"valid": false, "message": "缺少卡密"}` 或 `{"valid": false, "message": "缺少设备号"}`
- 验证失败：会返回 `message` 和必要的 `status`
- 次数用尽：通常出现在 `fetch_cookie` 阶段，返回 `{"ok": false, "message": "卡密使用次数已用尽"}`

## 2. 注册器 HTTP 接口

蓝图前缀同样为 `/api`，这些接口主要用于管理注册器卡片、默认执行方案和在线客户端。
多数接口带有 `@admin_required`，属于管理端接口。

| 方法 | 路径 | 作用 | 主要参数 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/registration_cards` | 获取服务器注册卡片列表 | 无 | 返回 `data` 和 `total` |
| `POST` | `/api/registration_cards` | 新增/保存注册卡片 | `card` 或整包 JSON | 以文件形式保存到 `registration_cards` 目录 |
| `DELETE` | `/api/registration_cards/<card_name>` | 删除注册卡片 | `card_name` | 按文件名删除 |
| `GET` | `/api/registration_default_execution_plan` | 获取默认执行方案 | 无 | 返回默认注册器方案 |
| `POST` | `/api/registration_default_execution_plan` | 保存默认执行方案 | `plan` 或整包 JSON | 保存并校验 `server_card_name` |
| `GET` | `/api/registration_clients` | 获取注册器客户端列表 | `include_offline` | 合并数据库和在线 TCP 状态 |
| `PUT` / `POST` | `/api/registration_clients/<instance_id>/meta` | 更新注册器客户端元信息 | `instance_id` + JSON | 用于修改名称、备注、排序等 |
| `POST` | `/api/registration_clients/<instance_id>/control` | 控制单个注册器客户端 | `instance_id` + `command` | 下发控制命令 |
| `POST` | `/api/registration_clients/batch_control` | 批量控制注册器客户端 | `commands` 或批量字段 | 面向多个实例执行控制 |

## 3. 相关代码位置

- 客户端 HTTP 路由：`server_vue/comm/http/client/routes.py`
- 注册器 HTTP 路由：`server_vue/comm/tcp/registry/routes.py`

## 4. 各请求返回结果说明

以下为当前实现中各 HTTP 请求的主要返回字段，便于客户端对接。除特别说明外，失败时通常返回：

```json
{
  "ok": false,
  "message": "错误原因"
}
```

### 4.1 客户端 HTTP 接口返回

#### `/api/validate_key`

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
  - 如果是设备绑定上限问题，可能附带 `max_device_count`、`device_bind_count`

#### `/api/client/config`

- 成功时主要返回：
  - `ok: true`
  - `proxy_subscription_url: string`
  - `active_id: string`
  - `suggest_switch: boolean`
  - `backup_subscriptions: array`
  - `red_yaml_content: string`
  - `yaml_content: string`
  - `custom_group: object | null`
  - `custom_group_link: string`
  - `custom_group_template_name: string`

#### `/api/fetch_cookie`

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

#### `/api/refresh-time`

- 成功时主要返回：
  - `ok: true`
  - `message: string`
  - `data: object`
- `data` 中通常包含刷新时间相关字段，来源于 `build_ai_refresh_time_payload()`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `/api/upload_ai_cookie`

- 成功时主要返回：
  - `ok: true`
  - `message: "AI账号上传成功"`
  - `data.action: string`
  - `data.cookie_file: string`
  - `data.account: object`
- `data.account` 中通常包含：
  - `id`
  - `platform`
  - `account`
  - `password`
  - `account_type`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `/api/unbind_device`

- 成功时主要返回：
  - `ok: true`
  - `message: "解绑成功"`
  - `data: object`
- `data` 为解绑后的最新用户信息，通常包含绑定数量、解绑次数、状态等字段
- 失败时常见返回：
  - `ok: false`
  - `message: string`
  - 可能附带 `status`

#### `/api/get_proxy_status`

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

#### `/api/get_target_url`

- 成功时主要返回：
  - `ok: true`
  - `targetUrl: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `/api/get_tutorial_url`

- 成功时主要返回：
  - `ok: true`
  - `tutorialUrl: string`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

#### `/api/get_allowed_platforms`

- 成功时主要返回：
  - `ok: true`
  - `allowedPlatforms: array`
- 失败时常见返回：
  - `ok: false`
  - `message: string`

### 4.2 注册器 HTTP 接口返回

#### `/api/registration_cards`

- `GET` 成功时通常返回：
  - `success: true`
  - `data: array`
  - `total: number`
- `POST` 成功时通常返回：
  - `success: true`
  - `message: string`
  - 可能附带 `data`
- `DELETE` 成功时通常返回：
  - `success: true`
  - `message: string`

#### `/api/registration_default_execution_plan`

- `GET` 成功时通常返回默认执行方案对象
- `POST` 成功时通常返回：
  - `success: true`
  - `message: string`
  - `data: object`

#### `/api/registration_clients`

- 成功时通常返回：
  - `success: true`
  - `data: array`
  - 可能附带 `total`

#### `/api/registration_clients/<instance_id>/meta`

- 成功时通常返回：
  - `success: true`
  - `message: string`
  - `data: object`

#### `/api/registration_clients/<instance_id>/control`

- 成功时通常返回：
  - `success: true` 或 `ok: true`
  - `message: string`
  - 可能附带执行结果数据

#### `/api/registration_clients/batch_control`

- 成功时通常返回：
  - `success: true` 或 `ok: true`
  - `message: string`
  - `data: array` 或批量结果对象

#### 注册器 HTTP 接口失败返回

- 常见格式：
  - `success: false`
  - `message: string`
