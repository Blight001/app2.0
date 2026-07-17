# 功能覆盖矩阵（阶段 0 初版）

方案 §4.1 要求的矩阵。本文件为**骨架初版**：功能编号、入口、当前自动化测试映射已填；
前置状态 / 异常流程 / 边界条件 / 状态恢复 / 人工验收列在进入对应域整改（阶段 3/4）时补全——
方案规定"整改每个模块前必须先建立矩阵"，因此各域矩阵的完成时点为该域整改启动时，本文件先固化功能盘点与测试缺口。

图例：测试列 `❌` = 无自动化测试；`📄` = 仅源码文本断言（按方案 §4.2 不算功能证明）；`✅` = 行为测试。

## AI 域（AI-*）

| 编号 | 功能 | 入口 | 现有测试 |
|---|---|---|---|
| AI-CHAT-01 | 发送对话（模型/配额/消息窗口裁剪） | IPC `ai-control-chat` | 📄 ai-control-message-window 相关 |
| AI-CHAT-STOP-01 | 停止/连续停止/迟到响应隔离 | IPC `ai-control-chat-stop` | ❌ |
| AI-TOOL-01 | 窗口工具本地派发优先于插件桥 | chat 工具调用 | 📄 ai-window-tools-default.test.js |
| AI-TOOL-02 | 插件工具经 AutomationBridge 派发 | chat 工具调用 | ❌ |
| AI-HIST-01..06 | 历史 list/get/save/delete/rename/create | IPC `ai-control-history-*` | ❌ |
| AI-MODEL-01 | 模型列表获取 | IPC `ai-control-get-models` | ❌ |
| AI-CARD-01 | 自动化卡片获取/选择 | IPC `ai-control-get/select-automation-card(s)` | ❌ |
| AI-API-01 | 自定义 API 配置 | IPC `get/set-ai-control-custom-api` | ❌ |
| AI-GIFT-01 | AI 礼品码兑换 | IPC `ai-control-redeem-gift-code` | ❌ |

## 浏览器域（BR-*）

| 编号 | 功能 | 入口 | 现有测试 |
|---|---|---|---|
| BR-TAB-01 | 标签增/切/关/排序/重命名/缩放 | IPC `add-tab` 等 (on) | 📄 部分 tabs 文本断言 |
| BR-WIN-01 | 独立浏览器创建（VIP 限制/失败回滚） | IPC `create-independent-browser` | 📄 |
| BR-HIST-01 | 浏览器历史 增/开/改/删/批量 | IPC `*-browser-history` | 📄 settings 导出断言 |
| BR-PROF-01 | Profile 保存/恢复/迁移/孤儿清理 | 启动+IPC `cleanup-orphan-browser-profiles` | ❌ |
| BR-SET-01 | 浏览器设置（UA/时区/语言/指纹/代理） | IPC `get/set/reset-ai-free-browser-settings` | 📄 check-browser-settings 脚本 |
| BR-RT-01 | Chromium runtime 握手/重启/状态 | IPC `get-browser-runtime-state`/`restart-browser-runtime` | 📄 check-chromium-* 脚本 |
| BR-CLEAN-01 | 会话数据清理/清除确认 | IPC `clear-browser-runtime-data` 等 | ❌ |

## 网络域（NET-*）

| 编号 | 功能 | 入口 | 现有测试 |
|---|---|---|---|
| NET-CLASH-01 | Clash 启动/停止/状态/进程状态机 | IPC `start/stop-clash-mini` 等 | 📄 部分 clash 文本断言 |
| NET-CLASH-02 | 代理切换/选项列表 | IPC `switch-clash-mini-proxy` | ❌ |
| NET-CFG-01 | 配置保存/导入/订阅刷新/Geo 本地化 | IPC `save-clash-config`/`refresh-subscription-url` | 📄 geo 本地化断言 |
| NET-LAT-01 | 延迟探测（TLS/超时/并发/排序） | IPC `test-min-latency` | ❌ |
| NET-SYS-01 | 系统代理开关与恢复 | IPC `update-system-proxy-enabled` | ❌ |
| NET-MAGIC-01 | 按浏览器 opt-in 魔法代理 | IPC `apply-network-magic-to-browser` 等 | 📄 |
| NET-QUOTA-01 | 流量配额/计数/礼品码 | IPC `get-proxy-traffic-quota` 等 | 📄 proxy-traffic 相关 |
| NET-DIAG-01 | 网络诊断 | IPC `network:diagnose` | ❌ |

## 账号域（ACC-*）

| 编号 | 功能 | 入口 | 现有测试 |
|---|---|---|---|
| ACC-AUTH-01 | 登录/登出/会话恢复/安全降级 | IPC `account-authenticate/logout/get-session` | ❌ |
| ACC-REM-01 | 记住密码 保存/列表/删除/切换 | IPC account_remember 9 通道 | 📄 account-session 断言 |
| ACC-COOKIE-01 | Cookie 获取/注入/导入确认 | IPC `fetch-cookies`/`import-cookie-file` | 📄 auth-cookie 文本断言 |
| ACC-POPUP-01 | 账号中心弹窗生命周期 | IPC `*-account-center-popup` | 📄 sidebar assets 检查 |
| LIC-KEY-01 | 卡密验证/设备号/解绑 | IPC `validate-key`/`unbind-device` | ❌ |
| LIC-VIP-01 | VIP 状态门禁（窗口数等） | licenseCache 快照 | 📄 FREE_BROWSER_WINDOW_LIMIT 断言 |
| LIC-REC-01 | 授权记录管理 | IPC `license-*-record(s)` | ❌ |
| LIC-GIFT-01 | VIP/羊毛礼品码 | IPC `redeem-*-gift-code` | ❌ |

## 扩展与更新域（EXT-* / UPD-*）

| 编号 | 功能 | 入口 | 现有测试 |
|---|---|---|---|
| EXT-LOAD-01 | 内置扩展发现/兼容副本/注入/刷新 | 启动 + `get-extension-manager-state` | 📄 extension-compat/refresh 脚本 |
| EXT-CUST-01 | 自定义扩展导入/启停/删除 | IPC `import/remove-extension-plugin` | ❌ |
| EXT-TOKEN-01 | 临时 Token 仅入运行时副本不泄漏 | AutomationBridge | 📄 obfuscation/token 断言 |
| EXT-AUTO-01 | browser_automation 画布/卡片/桥接 | 扩展 UI | 📄 automation-sidebar-* 文本断言 |
| UPD-CHK-01 | 版本判断/公告驱动更新（经主进程版本比较） | 轮询 + `start-app-update` | 📄 更新消息断言 |
| UPD-DL-01 | 下载/校验/取消/失败恢复 | app-updater.js | ❌ |
| UPD-INST-01 | 安装退出/挂起状态恢复 | `global._pendingUpdateInstall*` | ❌ |

## 公告与杂项（ANN-* / MISC-*）

| 编号 | 功能 | 入口 | 现有测试 |
|---|---|---|---|
| ANN-POLL-01 | 公告轮询（licenseCache 门禁/未送达保留/去重） | announcement-poller | 📄 check-announcements + 文本断言 |
| MISC-THEME-01 | 主题三态切换与侧边栏同步 | IPC `app-theme-changed` | ✅（隔离 Electron 冒烟脚本已验证加载+主题应用） |
| MISC-SHORTCUT-01 | 桌面快捷方式创建/提示 | IPC `create-desktop-shortcut` | ❌ |
| MISC-TUT-01 | 教程地址同步/打开 | IPC `get/refresh-tutorial-url`/`open-tutorial` | 📄 |

## 缺口统计（初版）

- 功能项约 45 个；有行为级测试的 **1 个**；仅文本断言 ~20 个；完全无测试 ~24 个。
- 这是阶段 1"重写行为测试"与阶段 3 逐域验收的基准缺口清单。
