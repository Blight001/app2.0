# 整改进度跟踪

对应方案：[ai-maintainability-refactor-plan.md](ai-maintainability-refactor-plan.md)。
每完成一项在此更新状态与证据。状态：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 完成。

> 前置说明：整改开始前已完成一轮安全清理（6 个提交：杂物/preview 死代码/远程兜底链/TCP 残留/漂移测试修复/CLAUDE.md），`npm test` 173 通过 0 失败基线成立。

## 阶段 0：冻结现状与建立功能清单

- [~] 核心流程记录（启动 / AI 对话 / 浏览器 / 网络魔法 / 账号 / 扩展 / 更新 / 退出）→ [stage0/flows.md](stage0/flows.md)
- [x] IPC 全量清点（126 通道 + 41 主进程→渲染事件）→ [stage0/ipc-inventory.md](stage0/ipc-inventory.md)
- [x] HTTP / 本地文件 / 环境变量 / 全局状态清点 → [stage0/runtime-inventory.md](stage0/runtime-inventory.md)
- [~] 各域功能覆盖矩阵（初版骨架，逐域整改前补全）→ [stage0/feature-matrix.md](stage0/feature-matrix.md)
- [~] 性能基线 → [stage0/perf-baseline.md](stage0/perf-baseline.md)（dev 实例与打包版共用 userData 冲突，部分指标待隔离环境补测）

## 阶段 1：工程和测试护栏

- [x] ESLint（eslint.config.js，正确性=error / 尺寸复杂度=warn）+ TypeScript checkJs（tsconfig.json）+ 依赖边界初版（渲染层禁 require）
- [x] `npm run verify` = check-guardrails（基线对比门禁）+ 全量测试
- [x] 分层测试目录（test/unit|contract|integration|packaging|acceptance|fixtures|helpers + README）；注意 `node --test` 会执行 test/ 下所有 .js，helpers 必须惰性
- [~] 有效场景重写为行为测试：首个真实 Electron 集成测试落地（integration/electron/sidebar-load.test.js，隔离 userData 探针模式）；其余旧扁平测试随阶段 3/4 各域整改迁移
- [ ] scripts/check-* 断言迁入 test/（随各域整改进行）
- [x] 渐进门禁 + 超限存量清单 → [stage1/over-limit-list.md](stage1/over-limit-list.md)；基线 scripts/guardrail-baseline.json：eslintErrors=2（渲染层存量 require）、>500 行文件=34、>80 行函数=120、复杂度>15=381、tsc=332。任何计数超基线即 verify 失败；整改后 `--update` 收紧

## 阶段 2：装配、类型和 IPC 基础设施

- [ ] bootstrap.js 收缩为 ≤250 行 composition root（当前 629 行）
- [~] AppContext / 统一错误类型 / 集中路径解析 / 结构化日志
  - [x] runtime/app-context.js：8 个业务性 global.* 全部迁入（退出标志/更新挂起/sessionId/调试钩子），2 个只写不读死全局（__APP_CONSOLE_HISTORY__、willQuit）删除
  - [x] contracts/ipc-result.js：AppError + ok/fail/wrapIpcResult 统一返回契约（新接口使用，存量随阶段 3/4 迁移）
  - [x] lib/structured-log.js：domain/operation/correlationId/channel/errorCode 结构化日志（register.js 重建路径为首个消费方）
  - [ ] 集中路径解析（随 bootstrap 收缩一起做）
- [~] contracts + payload 校验 + 窄化 preload + 可释放 IPC 注册器：
  - [x] contracts/ipc-channels.js 通道注册表（105 invoke + 24 event + 50 push）+ 双向一致契约测试 + 单通道单注册校验
  - [x] ipc/registry.js 可释放注册器（未登记抛错/同实例重复抛错/dispose 精确释放），7 个 register 模块全迁移，monkeypatch 去重补丁已删除；顺带修复被补丁掩盖的真实冲突（get-app-console-history 双注册）
  - [x] preload 白名单适配层（迁移期未登记告警不阻断；沙箱窗口降级放行）——上线即抓出 19 个间接发送的漏登记 push 通道并补齐，实机告警清零
  - [ ] payload 运行时校验（schema）——随阶段 3 各域整改逐域补
- [ ] 混合 JS/TS 构建链

## 阶段 3：逐域整改主进程

- [ ] AI 域
- [ ] 浏览器域
- [ ] 网络域
- [ ] 账号域
- [ ] 扩展与更新域

## 阶段 4：渲染层与自研扩展

- [ ] ai-control.js 拆分（store/API client/history/composer/renderer/tool display/selector/bootstrap）
- [ ] 标签栏/账号/VPN/浏览器设置显式模块化
- [ ] CSS tokens/layout/组件拆分
- [ ] browser_automation 整理

## 阶段 5：清理和正式切换

- [ ] 稳定模块迁移 TypeScript
- [ ] 删除兼容层与废弃代码
- [ ] 统一命名/错误码/日志标签
- [ ] 文档更新（AGENTS.md/架构索引/故障定位手册）
- [ ] 四级验收（开发版/真实 Electron/win-unpacked/安装包）

## 执行日志

| 日期 | 内容 |
|---|---|
| 2026-07-17 | 前置安全清理 6 提交完成；阶段 0 启动：IPC/运行时契约清点完成，流程记录与功能矩阵初版建立 |
| 2026-07-17 | 阶段 1 主体落地：ESLint/checkJs/guardrails 基线门禁 + verify + 分层测试目录 + 首个 Electron 集成测试（180 用例 179 过 1 skip）。护栏顺带查出并修复 3 处正确性问题（重复键 ×2、空 try-catch 不可达 ×1） |
| 2026-07-17 | 阶段 2A/2B/2C：IPC 契约注册表 + 可释放注册器（废除 monkeypatch 去重）+ preload 白名单。fail-fast 暴露并修复 get-app-console-history 真实双注册；白名单抓出 19 个漏登记 push 通道。npm start 实机验证 0 handler 错误 0 preload 告警；verify 189 用例全绿 |
| 2026-07-17 | 阶段 2D-1/2D-2：AppContext 迁移全部业务性 global.*（checkJs 门禁提交前拦下一处漏 require 的 ReferenceError）；ipc-result 统一返回契约 + structured-log 结构化日志落地。verify 206 用例 205 过 1 skip；npm start 冒烟启动/退出路径无异常 |
