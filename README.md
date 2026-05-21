# AI-FREE

AI-FREE is an Electron desktop shell for AI workflow tools. It focuses on platform configuration, startup orchestration, browser extension integration, and the registration bridge used by the bundled extension workspace.

Current package version: `2.5.8`

## What It Does

- Switches target platforms through `config/platforms-config.json`
- Boots the app through the Electron main process under `src/app/main`
- Ships bundled extensions and helper modules under `src/assets/extensions`
- Uses lightweight startup scripts in `scripts/` and `scripts/windows/`
- Keeps detailed protocol, API, and usage notes in `docs/`

## Repository Layout

```text
├── config/                  # Runtime and platform configuration
├── control-panel/           # Local control-panel web UI and static server
├── docs/                    # API, architecture, and usage notes
├── scripts/                 # Startup and packaging helpers
│   └── windows/             # Windows batch/build helpers
├── src/
│   ├── app/
│   │   ├── main/            # Main-process code
│   │   ├── renderer/        # Renderer/UI controllers and styles
│   │   └── views/           # HTML shells (app-shell, license)
│   └── assets/
│       └── extensions/      # Bundled extensions and tools
├── vscode-extension/        # Standalone VS Code sidebar wrapper
├── package.json             # App metadata, scripts, and Electron Builder config
└── README_zh-CN.md          # Chinese README
```

## Key Paths

- `src/app/main/main.js`: Electron entry point
- `src/app/main/bootstrap.js`: main-process bootstrap logic
- `src/app/main/services/`: shell, lifecycle, tabs, and runtime services
- `src/app/main/ipc/`: IPC registration and handlers
- `src/app/views/`: app shell and license pages
- `src/app/renderer/`: renderer controllers and styles
- `src/assets/extensions/`: bundled extensions: `remove_watermark`, `clash-mini`, `transform`, `Toonflow-app`, and `registration`
- `scripts/run-electron.js`: Electron launch wrapper
- `scripts/set-side-url.js`: sets the side-panel URL (local or remote) before launch/build
- `scripts/ensure-registration-bridge.js`: syncs the registration bridge workspace before launch/build

## Requirements

- Node.js 16 or newer
- npm

## Getting Started

```bash
npm install
npm start
```

`npm start` runs the Electron app through `scripts/run-electron.js`. The `prestart` hook first runs `scripts/set-side-url.js` to set the side-panel URL and `scripts/ensure-registration-bridge.js` to prepare the registration bridge before launch.

For a dev-style launch, use:

```bash
npm run start:dev
```

## Build

Windows packaging is handled by Electron Builder:

```bash
npm run build:win
```

To build a portable Windows package:

```bash
npm run build:portable
```

Build output is written to `appbuild/`.

## Configuration

The main runtime settings live in `config/platforms-config.json`.

Important fields:

- `platforms`: app metadata such as `name`, `appId`, and icon paths
- `platformConfigs.tcp`: host and port for the backend TCP service
- `platformConfigs.targetUrl`: default target page loaded by the app
- `platformConfigs.tutorialUrl`: tutorial link used by the UI
- `platformConfigs.allowedPlatforms`: allowed platform labels for validation
- `platformConfigs.systemProxyEnabled`: whether system proxy should be enabled

The default target URL currently points to the CapCut AI creator page.

## Windows Helpers

If you prefer batch files, use the helpers in `scripts/windows/`:

- `v-start.bat`: launch the app
- `v-debug.bat`: launch with debug-oriented defaults
- `v-debug-http.bat`: launch with HTTP debug defaults
- `build.bat`: build from Windows
- `backup.bat`: create a backup snapshot

## Related Components

- `control-panel/`: local control-panel web UI and its static server (served at `/control-panel/`)
- `vscode-extension/`: standalone VS Code sidebar wrapper for the AI Free Tools control panel

## Documentation

- `docs/architecture/项目文件职责说明.md`
- `docs/api/HTTP请求说明.md`
- `docs/api/TCP请求说明.md`
- `docs/api/自动更新消息说明.md`
- `docs/usage/软件使用教程.txt`

## License

ISC
