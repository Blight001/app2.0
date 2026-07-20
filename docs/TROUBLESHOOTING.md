# 故障定位手册

## 先执行

```powershell
npm run verify
npm run guardrails
```

按失败层级再执行单独的 `test:unit`、`test:contract`、`test:integration`、`test:packaging` 或 `test:acceptance`。不要先删除 userData、Profile 或构建缓存。

## 常见问题

### Renderer 报 “No handler registered”

检查通道是否先登记在 `contracts/ipc-channels.js`、registrar 是否匹配、注册器是否过早 `dispose()`。禁止恢复覆盖 `ipcMain.handle/on` 的 monkeypatch。

### 侧边栏能加载但主题/按钮无响应

检查 HTML 中基础 shell/state 脚本是否早于消费它们的模块加载；用 `npm run check:browser-settings-ui` 复现。不要用源码字符串断言替代真实点击/事件验证。

### Chromium 无法启动或 Profile 被锁

运行 `npm run check:chromium-handshake` 和 `npm run accept:chromium-phase3`。确认 `resources/chromium/ai-free-browser.exe`、Named Pipe、managed PID 和 Profile lock 在 graceful stop 后释放。测试必须隔离 userData。

### 自动化扩展 403

同时检查 `X-AI-Free-Browser-Token` 与 `X-AI-Free-Browser-Pid`。源扩展的 `00_environment.js` 应保持空 token；实际 token 只在 userData 的会话运行副本中。

### Windows 构建 EBUSY/EPERM

Chromium 与 Clash Core 必须在 `win-unpacked` 生成后串行复制；杀毒扫描可能短暂占用 exe。构建脚本有有界重试，禁止改回 electron-builder 并行 extraResources。

### 打包版找不到扩展/native/logo

依次运行 `npm run prepare:source`、`npm run check:packaged-runtime`。扩展应在 `app.asar.unpacked`，native host/logo/Chromium/Clash 应在 resources 外部目录。不要把可执行资源或 logo 同时打入 ASAR 与外部目录。

### 覆盖率或渐进门禁失败

新增行为测试或拆函数后，只在计数下降时运行 `node scripts/check-guardrails.js --update`。禁止上调基线、排除自有低覆盖模块、添加 eslint disable 或降低 package.json 覆盖率阈值。

## 恢复策略

`.generated/app` 和 `appbuild` 都是可重建产物；源码与用户数据不应被构建修改。发生数据故障时先复制对应 userData 文件，再通过 repository 的旧格式读取路径验证，禁止直接清空整个 userData。
