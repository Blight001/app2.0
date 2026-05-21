# AI Free Tools VS Code Extension

This folder contains a standalone VS Code extension wrapper for the existing AI Free Tools sidebar.

## Development

```powershell
npm install
npm run check
code vscode-extension
```

Press `F5` from the `vscode-extension` workspace to launch an Extension Development Host.

## Install For Developer Testing

Open this folder as a VS Code extension project:

```powershell
cd vscode-extension
npm install
code .
```

Then press `F5`. VS Code will open a new Extension Development Host window with the extension loaded.

You can also launch it from the repository root:

```powershell
code --extensionDevelopmentPath=.\vscode-extension
```

If your debug console shows many missing `.map` warnings from unrelated VS Code extensions, use:

```powershell
.\run-dev-host.bat
```

The launch configuration disables source map loading to keep the debug console clean while leaving VS Code's built-in browser commands available.

## Package VSIX

Run:

```powershell
.\package-vsix.bat
```

The script installs dependencies, runs syntax checks, and creates a `.vsix` package in this folder.

Install the packaged extension with:

```powershell
code --install-extension ai-free-tools-vscode-0.1.0.vsix
```

## Scope

- Provides a VS Code Activity Bar container and sidebar Webview View.
- Opens launch targets in VS Code Simple Browser / Webview Panels.
- Validates license keys (card-status search + resolved server `/api/validate_key`) and surfaces runtime config: platform, account type, tutorial URL, target URL, expiry, and remaining usage.
- Device unbind via `/api/unbind_device`.
- Account history stores the accounts returned by the server `/api/fetch_cookie`, shown in the sidebar with delete support.
- Magic network (Clash): fetches the Clash config from the server `/api/client/config` (direct YAML or base64 / vmess subscription), starts `verge-mihomo`, and points VS Code's global `http.proxy` at the local mixed port so the built-in browser routes through it. Includes node list, node switching, latency testing, and line refresh. Manual config import is removed.
- Remembers the latest key, validation state, and account records in VS Code global extension storage.
- Shows a colored debug console at the bottom of the sidebar for extension-host logs and runtime diagnostics.
- Account auto-login (cookie injection) is not yet implemented — VS Code cannot inject cookies into a third-party site shown in the built-in browser; `fetchAccount` records the account and leaves a `TODO` hook for a future external-Edge + CDP approach.
- Does not migrate Electron auto-update, BrowserView tab management, injected browser extensions, desktop shortcuts, tray, or Electron window behavior.

## Source Layout

- `src/extension.js` wires VS Code activation, commands, and service composition; restores `http.proxy` and stops Clash on deactivate.
- `src/providers/sidebarProvider.js` owns Webview View message routing.
- `src/providers/panelManager.js` opens URLs through VS Code Simple Browser with a Webview fallback.
- `src/services/clashMiniService.js` manages the `verge-mihomo` process, fetches/applies server config, and toggles the browser proxy.
- `src/services/clashConfig.js` normalizes server Clash config (direct YAML / base64 / vmess subscription) into a runnable `config.yaml`.
- `src/services/proxyController.js` sets and restores VS Code's global `http.proxy`.
- `src/services/licenseService.js` stores credentials, coordinates key validation, and exposes runtime config.
- `src/services/accountStore.js` persists server-returned account records for the history list.
- `src/services/serverResolver.js` reads `config/platforms-config.json` and resolves the validation server.
- `src/services/httpClient.js` contains HTTP helpers (validate key, fetch cookie, client config, subscription, unbind device).
- `src/services/logService.js` keeps bounded debug entries and streams them to the sidebar console.
