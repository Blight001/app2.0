# VS Code 插件迁移进度

软件端(Electron)→ VS Code 插件的功能迁移与对齐记录。

## 已完成(与软件端对齐)

### 卡密 / 运行时配置
- 卡密验证:卡状态搜索 + 解析服务器 `/api/validate_key` 二次验证。
- 运行时配置展示:平台、账号类型、教程链接、目标站、到期时间、剩余次数。
- 设备解绑:`/api/unbind_device`,成功后清空本地验证态并刷新 UI。
- 启动自动验证:激活时对已保存卡密静默重验,刷新到期/次数。
- 真实连接状态:反映「卡密是否验证 + 网络魔法是否运行」(替换原硬编码)。
- 凭据 / 验证态持久化于 VS Code globalState。

### 网络魔法(Clash)
- 从服务器 `/api/client/config` 取配置(直连 YAML / base64 / vmess 订阅),归一化为可运行 `config.yaml`。
- 启动 / 停止 `verge-mihomo`;节点列表、节点切换、延迟测速。
- 刷新线路:重新拉取服务器配置,运行中则自动重启。
- 代理接入:设置 VS Code 全局 `http.proxy` 指向本地混合端口,内置浏览器走代理;插件停用 / Clash 停止时还原。
- 按设置自动开启:激活时若 `networkMagicAutoStart` 开启且已验证,自动启动。

### 账号历史
- 拉取服务器账号(`/api/fetch_cookie`)并记录:账号、平台、类型、回收时间、cookie 数。
- 侧边栏列表展示,支持删除单条记录、点击回填卡密。

### 其它
- 侧边栏底部彩色调试控制台:扩展宿主日志 + 运行时诊断,带历史。
- 打开即梦 / 视频剪辑 / 无限画布 / 自动分镜 / 教程页(Simple Browser,Webview 兜底)。

## 暂缓 / 待攻关
- **账号免登录(cookie 注入)**:VS Code 无法向内置浏览器里的第三方站点注入 cookie。
  `fetchAccount` 仅获取并记录账号,留有 `TODO` 钩子。
  既定方案(待现有功能实测通过后实施):外部 Edge + CDP —— 自己拉起
  `msedge.exe`(`--remote-debugging-port` + 每账号独立 `--user-data-dir` + `--proxy-server`),
  导航前经 CDP `Network.setCookie` 注入,实现免登录、多开、走代理、cookie 隔离。
  届时所有目标站点改用外部 Edge 打开,全局 `http.proxy` 不再需要。

## 不迁移(Electron 专属 / VS Code 不需要)
- 多标签 BrowserView(add/close/switch/reorder-tab、右键菜单、缩放)。
- 注入式浏览器扩展(去水印 / 翻译、extension-popup/options)。
- 系统代理注入开关(已用 `http.proxy` 替代)。
- 自动更新、注册器、桌面快捷方式、托盘、Electron 窗口行为。

## 代码结构
```
src/
  extension.js            激活、命令、服务装配;停用时还原 http.proxy 并停 Clash
  providers/
    sidebarProvider.js    Webview 消息路由
    panelManager.js       Simple Browser / Webview 打开 URL
  services/
    clashMiniService.js   verge-mihomo 进程、取/应用配置、代理开关
    clashConfig.js        服务器 Clash 配置归一化(YAML/base64/vmess)
    proxyController.js     设置 / 还原全局 http.proxy
    licenseService.js      凭据、卡密验证、运行时配置
    accountStore.js        账号历史持久化
    serverResolver.js      读 platforms-config.json,解析验证服务器
    httpClient.js          HTTP 助手(验证/取cookie/配置/订阅/解绑)
    logService.js          调试日志,流式推送到侧边栏控制台
media/                     sidebar.html / sidebar.js / sidebar.css + modules/*.css
```

## 待 Windows 宿主实测
- UI 在真实 VS Code 中的渲染与交互。
- `verge-mihomo.exe` 路径与启动、节点测速/切换是否生效。
- 全局 `http.proxy` 是否真正使内置浏览器走代理,停用后是否还原。
- 启动自动验证 / 自动开启网络魔法的时序是否符合预期。
</content>
</invoke>
