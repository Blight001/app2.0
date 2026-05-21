# AI-FREE

AI-FREE 是一个基于 Electron 的桌面工具外壳，主要用于 AI 工作流相关应用的启动编排、平台配置、浏览器扩展集成，以及随应用一起提供的注册器桥接工作区。

当前版本：`2.5.8`

## 项目作用

- 通过 `config/platforms-config.json` 切换目标平台
- 通过 `src/app/main` 下的主进程代码启动应用
- 通过 `src/assets/extensions` 提供内置扩展和工具模块
- 通过 `scripts/` 和 `scripts/windows/` 提供启动与打包辅助脚本
- 在 `docs/` 中保留详细的协议、接口和使用说明

## 仓库结构

```text
├── config/                  # 运行时与平台配置
├── control-panel/           # 本地控制面板 Web UI 与静态服务器
├── docs/                    # 接口、架构和使用说明
├── scripts/                 # 启动与打包辅助脚本
│   └── windows/             # Windows 批处理和构建脚本
├── src/
│   ├── app/
│   │   ├── main/            # 主进程代码
│   │   ├── renderer/        # 渲染进程控制器与样式
│   │   └── views/           # HTML 外壳页面（app-shell、license）
│   └── assets/
│       └── extensions/      # 内置扩展与工具
├── vscode-extension/        # 独立的 VS Code 侧边栏封装
├── package.json             # 项目元数据、脚本和 Electron Builder 配置
└── README_zh-CN.md          # 中文说明文档
```

## 关键路径

- `src/app/main/main.js`：Electron 入口文件
- `src/app/main/bootstrap.js`：主进程启动装配逻辑
- `src/app/main/services/`：窗口外壳、生命周期、标签页和运行时服务
- `src/app/main/ipc/`：IPC 注册与处理器
- `src/app/views/`：应用外壳与许可证页面
- `src/app/renderer/`：渲染进程控制器与样式
- `src/assets/extensions/`：内置扩展：`remove_watermark`、`clash-mini`、`transform`、`Toonflow-app`、`registration`
- `scripts/run-electron.js`：Electron 启动包装脚本
- `scripts/set-side-url.js`：启动/构建前设置侧边栏 URL（本地或远程）
- `scripts/ensure-registration-bridge.js`：启动/构建前同步注册器桥接工作区

## 环境要求

- Node.js 16 或更高版本
- npm

## 快速开始

```bash
npm install
npm start
```

`npm start` 会通过 `scripts/run-electron.js` 启动 Electron。启动前的 `prestart` 钩子会先运行 `scripts/set-side-url.js` 设置侧边栏 URL，并通过 `scripts/ensure-registration-bridge.js` 准备注册器桥接工作区。

如果你想用开发态方式启动，可以执行：

```bash
npm run start:dev
```

## 打包构建

Windows 安装包构建命令：

```bash
npm run build:win
```

Windows 便携包构建命令：

```bash
npm run build:portable
```

构建产物会输出到 `appbuild/`。

## 配置说明

主要运行时配置集中在 `config/platforms-config.json`。

常见字段说明：

- `platforms`：应用元数据，例如 `name`、`appId` 和图标路径
- `platformConfigs.tcp`：后端 TCP 服务的主机和端口
- `platformConfigs.targetUrl`：应用默认加载的目标页面
- `platformConfigs.tutorialUrl`：界面中的教程链接
- `platformConfigs.allowedPlatforms`：验证时允许的平台标签
- `platformConfigs.systemProxyEnabled`：是否启用系统代理

当前默认目标地址指向的是 CapCut AI creator 页面。

## Windows 辅助脚本

如果你更习惯使用批处理脚本，可以直接用 `scripts/windows/` 下的文件：

- `v-start.bat`：启动应用
- `v-debug.bat`：按调试方式启动
- `v-debug-http.bat`：按 HTTP 调试方式启动
- `build.bat`：Windows 构建脚本
- `backup.bat`：生成备份快照

## 相关组件

- `control-panel/`：本地控制面板 Web UI 及其静态服务器（在 `/control-panel/` 提供服务）
- `vscode-extension/`：面向 AI Free Tools 控制面板的独立 VS Code 侧边栏封装

## 文档索引

- `docs/architecture/项目文件职责说明.md`
- `docs/api/HTTP请求说明.md`
- `docs/api/TCP请求说明.md`
- `docs/api/自动更新消息说明.md`
- `docs/usage/软件使用教程.txt`

## 许可证

ISC
