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
- Opens launch targets in VS Code Webview Panels.
- Keeps Clash Mini start, stop, node list, node switching, and latency testing.
- Validates license keys in the sidebar. The extension first queries the same card-status search endpoint used by the desktop app, then performs a second validation against the resolved server `/api/validate_key`.
- Remembers the latest key and validation state in VS Code global extension storage.
- Shows a colored debug console at the bottom of the sidebar for extension-host logs and runtime diagnostics.
- Does not migrate Electron auto-update, BrowserView tab management, injected browser extensions, desktop shortcuts, tray, or Electron window behavior.

## Source Layout

- `src/extension.js` wires VS Code activation and commands.
- `src/sidebarProvider.js` owns Webview View message routing only.
- `src/panelManager.js` opens URLs through VS Code Simple Browser with a Webview fallback.
- `src/services/licenseService.js` stores credentials and coordinates key validation.
- `src/services/serverResolver.js` reads `config/platforms-config.json` and resolves the validation server.
- `src/services/httpClient.js` contains small HTTP helpers used by services.
- `src/services/logService.js` keeps bounded debug entries and streams them to the sidebar console.
