# 外部 MCP 网关

AI-FREE 2.6.9 起可通过本机回环网关向外部 MCP 客户端开放软件窗口工具和各浏览器窗口内部工具。

## 权限与生命周期

- 仅向近期经服务端验证的有效 VIP 会员开放，不信任手工修改的本地会员字段。
- 网关只监听 `127.0.0.1`，与浏览器扩展通道使用不同的随机会话令牌。
- 软件启动后在 Electron `userData` 目录原子发布 `ai-free-mcp-bridge.json`，让非会员也能查询状态并获得明确提示；软件退出时删除。
- 退出登录、会员过期、验证失败或重新获得会员权限时轮换令牌；旧令牌立即被拒绝。
- 描述文件包含敏感的临时令牌，不得记录、上传或复制到项目目录。

## HTTP 接口

描述文件给出 loopback `endpoint`、临时 `token`、进程 ID 和更新时间。客户端通过 `X-AI-Free-MCP-Token` 或 Bearer token 调用：

- `GET /mcp/v1/status`：网关、会员门禁、工具和连接数量；非会员也可查询。
- `GET /mcp/v1/tools`：软件窗口工具、动态浏览器工具和在线窗口连接。
- `POST /mcp/v1/call`：以 `{name, arguments}` 调用工具。

存在多个浏览器窗口时，动态浏览器工具必须传 `browser_id`；也可在名称唯一时传 `browser_name`。`save_cookies` 的外部调用会移除上传参数，并拒绝任何 Cookie 原始内容回传或上传请求。

## 错误码

- `AI_FREE_MCP_UNAUTHORIZED`：会话令牌缺失或无效。
- `AI_FREE_MCP_VIP_REQUIRED`：当前没有实时有效的 VIP 权限；工具列表和调用返回 HTTP 403。
- `AI_FREE_MCP_NOT_FOUND`：接口不存在。
- `AI_FREE_MCP_CALL_FAILED`：工具参数、窗口路由或内部执行失败。
