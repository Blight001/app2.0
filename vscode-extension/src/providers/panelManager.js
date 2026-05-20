const vscode = require('vscode');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

class PanelManager {
  constructor(context, deps = {}) {
    this.context = context;
    this.logService = deps.logService || null;
    this.panels = new Map();
  }

  async openUrl(key, title, targetUrl, options = {}) {
    const normalizedUrl = String(targetUrl || '').trim();
    if (!normalizedUrl) {
      this.logService?.warn?.(`打开 ${title} 失败：缺少打开地址`, { source: 'panel' });
      return { ok: false, message: '缺少打开地址' };
    }

    this.logService?.info?.(`打开页面：${title}`, { source: 'panel', url: normalizedUrl, mode: options.mode || 'simpleBrowser' });
    const mode = String(options.mode || 'simpleBrowser').trim();
    if (mode === 'simpleBrowser') {
      const opened = await this.openInSimpleBrowser(title, normalizedUrl);
      if (opened.ok) {
        this.logService?.success?.(`已用 VS Code 内置浏览器打开：${title}`, { source: 'panel', url: normalizedUrl, openedWith: opened.openedWith });
        return { ok: true, targetUrl: normalizedUrl, openedWith: opened.openedWith };
      }
      this.logService?.warn?.(`内置浏览器打开失败，回退到 Webview Panel：${title}`, { source: 'panel', url: normalizedUrl, message: opened.message || '' });
    }

    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal(vscode.ViewColumn.One);
      existing.webview.html = this.renderPanelHtml(existing.webview, title, normalizedUrl);
      this.logService?.info?.(`已切换到现有页面：${title}`, { source: 'panel', url: normalizedUrl });
      return { ok: true, targetUrl: normalizedUrl, alreadyOpen: true };
    }

    const panel = vscode.window.createWebviewPanel(
      `aiFreeTools.${key}`,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key), null, this.context.subscriptions);
    panel.webview.html = this.renderPanelHtml(panel.webview, title, normalizedUrl);
    this.logService?.success?.(`已用 Webview Panel 打开：${title}`, { source: 'panel', url: normalizedUrl });
    return { ok: true, targetUrl: normalizedUrl, alreadyOpen: false };
  }

  async openInSimpleBrowser(title, targetUrl) {
    const uri = vscode.Uri.parse(targetUrl);
    try {
      await vscode.commands.executeCommand('simpleBrowser.api.open', uri, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
      });
      return { ok: true, openedWith: 'simpleBrowser.api.open' };
    } catch (apiError) {
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', targetUrl);
        return { ok: true, openedWith: 'simpleBrowser.show' };
      } catch (_) {
        return { ok: false, message: apiError?.message || String(apiError) };
      }
    }
  }

  renderPanelHtml(webview, title, targetUrl) {
    const scriptNonce = nonce();
    const safeTitle = escapeHtml(title);
    const safeUrl = escapeHtml(targetUrl);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http: https:; img-src ${webview.cspSource} data: http: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    html, body { height: 100%; margin: 0; background: #0b1018; color: #e5e7eb; font-family: var(--vscode-font-family); }
    .toolbar { height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid rgba(255,255,255,.12); background: #111827; box-sizing: border-box; }
    .title { font-size: 12px; font-weight: 600; color: #f9fafb; white-space: nowrap; }
    .url { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9ca3af; font-size: 11px; }
    button, a.button { height: 24px; border: 1px solid rgba(255,255,255,.18); color: #e5e7eb; background: #1f2937; border-radius: 4px; padding: 0 8px; text-decoration: none; font-size: 12px; display: inline-flex; align-items: center; cursor: pointer; }
    iframe { width: 100%; height: calc(100% - 36px); border: 0; background: #fff; display: block; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">${safeTitle}</span>
    <span class="url" title="${safeUrl}">${safeUrl}</span>
    <button id="reload" type="button">刷新</button>
    <a class="button" href="${safeUrl}">在浏览器打开</a>
  </div>
  <iframe id="page" src="${safeUrl}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe>
  <script nonce="${scriptNonce}">
    const iframe = document.getElementById('page');
    document.getElementById('reload').addEventListener('click', () => {
      iframe.src = iframe.src;
    });
  </script>
</body>
</html>`;
  }
}

module.exports = {
  PanelManager,
};
