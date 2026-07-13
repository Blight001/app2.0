# AI-FREE Chromium Fork

此目录只保存版本锁、GN 参数、补丁队列和可重复构建脚本。Chromium 完整源码及
`out` 目录固定在 `E:\chromium-ai-free\src`，不得复制进 app2.1 Git 仓库。

锁定基线为 Chromium `150.0.7871.114`，commit
`f405107495a07cb1bfcf687d4af8d91117098db6`。补丁必须按 `patches/series`
顺序应用，禁止直接修改 `out/AI-Free` 中的生成文件。

Windows 产品图标母版固定为 `assets/AI-FREE.png`，`0005` 补丁包含由该母版
生成的 16/32/48/64/128/256 多尺寸 ICO；源文件与生成 ICO 的 SHA-256 均记录
在 `version-lock.json`。

执行顺序：

```powershell
powershell -ExecutionPolicy Bypass -File chromium-fork/scripts/check-environment.ps1
powershell -ExecutionPolicy Bypass -File chromium-fork/scripts/sync-source.ps1
powershell -ExecutionPolicy Bypass -File chromium-fork/scripts/apply-patches.ps1
powershell -ExecutionPolicy Bypass -File chromium-fork/scripts/build.ps1
powershell -ExecutionPolicy Bypass -File chromium-fork/scripts/stage-runtime.ps1
```

需要代理时，在执行同步前设置
`$env:AI_FREE_CHROMIUM_PROXY='http://127.0.0.1:端口'`。同步脚本会先串行完成
depot_tools Python/CIPD bootstrap，再启动并行 gclient 任务，避免首次安装时的
`.cipd_bin` 竞争。

正式运行目录是 `resources/chromium/`。stage 脚本复制完整 Chromium 运行时，
包括 DLL、PAK、locales、resources、Vulkan/SwiftShader 文件和版本目录。
