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

- [ ] ESLint + 格式检查 + TypeScript checkJs + 依赖边界检查
- [ ] `npm run verify` 聚合门禁
- [ ] 分层测试目录（unit/contract/integration/packaging/acceptance/fixtures/helpers）
- [ ] 有效场景重写为行为测试，删除旧扁平测试
- [ ] scripts/check-* 断言迁入 test/
- [ ] 行数（≤500）/函数（≤80）/复杂度（≤15）渐进门禁 + 超限存量清单

## 阶段 2：装配、类型和 IPC 基础设施

- [ ] bootstrap.js 收缩为 ≤250 行 composition root
- [ ] AppContext / 统一错误类型 / 集中路径解析 / 结构化日志
- [ ] contracts + payload 校验 + 窄化 preload + 可释放 IPC 注册器
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
