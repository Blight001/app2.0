# 超限存量清单（阶段 1 渐进门禁）

生成：`node scripts/check-guardrails.js --update`（2026-07-17）。
存量不阻塞提交，但新增代码不得让任何计数超过基线；每整改一个文件后重新 --update 收紧基线。

当前基线：eslint errors=2，>500 行文件=34，>80 行函数=120 处，复杂度>15=381 处，tsc checkJs errors=332

## 超过 500 行的自有源码文件

- `scripts/check-browser-runtime.js` — File has too many lines (822). Maximum allowed is 500.
- `src/app/main/bootstrap.js` — File has too many lines (569). Maximum allowed is 500.
- `src/app/main/browser-runtime/chromium-runtime.js` — File has too many lines (597). Maximum allowed is 500.
- `src/app/main/ipc/account_remember.js` — File has too many lines (701). Maximum allowed is 500.
- `src/app/main/ipc/register/clash-mini-core.js` — File has too many lines (1907). Maximum allowed is 500.
- `src/app/main/ipc/register/license.js` — File has too many lines (836). Maximum allowed is 500.
- `src/app/main/ipc/register/settings.js` — File has too many lines (1337). Maximum allowed is 500.
- `src/app/main/ipc/register/ui.js` — File has too many lines (813). Maximum allowed is 500.
- `src/app/main/lib/account-storage.js` — File has too many lines (611). Maximum allowed is 500.
- `src/app/main/lib/auth-cookie.js` — File has too many lines (1033). Maximum allowed is 500.
- `src/app/main/lib/http-client.js` — File has too many lines (503). Maximum allowed is 500.
- `src/app/main/lib/session-storage.js` — File has too many lines (667). Maximum allowed is 500.
- `src/app/main/services/app-lifecycle.js` — File has too many lines (1631). Maximum allowed is 500.
- `src/app/main/services/app-shell.js` — File has too many lines (798). Maximum allowed is 500.
- `src/app/main/services/app-updater.js` — File has too many lines (1273). Maximum allowed is 500.
- `src/app/main/services/extension-manager.js` — File has too many lines (1722). Maximum allowed is 500.
- `src/app/main/services/tab-manager.js` — File has too many lines (1067). Maximum allowed is 500.
- `src/app/renderer/controllers/pages/app-shell/tabs.js` — File has too many lines (1158). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/pages/ai-control.js` — File has too many lines (2850). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js` — File has too many lines (803). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account.js` — File has too many lines (697). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/browser-settings.js` — File has too many lines (646). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/license.js` — File has too many lines (504). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/vpn.js` — File has too many lines (1024). Maximum allowed is 500.
- `src/app/sidebar/client/app/side/controllers/shared/message-modal.js` — File has too many lines (555). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/background/01_state.js` — File has too many lines (929). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/background/02_sidebar_page.js` — File has too many lines (665). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/background/06_automation_run.js` — File has too many lines (1317). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/background/09_agent_socket.js` — File has too many lines (1421). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/content/observe.js` — File has too many lines (1359). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/popup/automation-flow.js` — File has too many lines (515). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/popup/automation-workbench.js` — File has too many lines (2809). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/popup/bindings.js` — File has too many lines (1375). Maximum allowed is 500.
- `src/assets/extensions/browser_automation/popup/cookie-credentials.js` — File has too many lines (1190). Maximum allowed is 500.
