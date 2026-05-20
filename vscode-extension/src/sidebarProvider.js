const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

class SidebarProvider {
  static viewType = 'aiFreeTools.sidebar';

  constructor(context, deps) {
    this.context = context;
    this.panelManager = deps.panelManager;
    this.clashMini = deps.clashMini;
    this.licenseService = deps.licenseService;
    this.logService = deps.logService;
    this.getConfigUrl = deps.getConfigUrl;
    this.view = null;
    this.clashSubscription = this.clashMini.onEvent((channel, payload) => {
      this.postEvent(channel, payload);
    });
    this.logSubscription = this.logService?.onEntry?.((entry) => {
      this.postEvent('debug-console-line', entry);
    });
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
      ],
    };
    webview.html = this.getHtml(webview);
    webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.context.subscriptions);
    setTimeout(() => {
      this.postEvent('clash-mini-status', this.clashMini.getStatus());
      this.postEvent('app-version', this.context.extension.packageJSON.version);
      this.postEvent('update-device-id', this.licenseService.getDeviceId());
      this.postEvent('license-credentials-updated', this.licenseService.getCredentials());
      this.postEvent('debug-console-history', this.logService?.getEntries?.() || []);
    }, 0);
  }

  getHtml(webview) {
    const htmlPath = path.join(this.context.extensionPath, 'media', 'sidebar.html');
    const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebar.css')));
    const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebar.js')));
    const nonce = getNonce();
    return fs.readFileSync(htmlPath, 'utf8')
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cssUri\}\}/g, cssUri.toString())
      .replace(/\{\{jsUri\}\}/g, jsUri.toString());
  }

  postEvent(channel, payload) {
    try {
      this.view?.webview?.postMessage({ type: 'event', channel, payload });
    } catch (_) {}
  }

  async handleMessage(message) {
    if (!message || message.type !== 'invoke') return;
    const { id, channel, payload } = message;
    try {
      const result = await this.invoke(channel, payload);
      this.view?.webview?.postMessage({ type: 'invokeResult', id, ok: true, result });
    } catch (error) {
      this.view?.webview?.postMessage({
        type: 'invokeResult',
        id,
        ok: false,
        error: error?.message || String(error),
      });
    }
  }

  async invoke(channel, payload = {}) {
    switch (channel) {
      case 'get-app-version':
        return this.context.extension.packageJSON.version;
      case 'get-debug-console-history':
        return { ok: true, entries: this.logService?.getEntries?.() || [] };
      case 'license-get-device-id':
        return this.licenseService.getDeviceId();
      case 'license-get-saved-key':
        return this.licenseService.getCredentials().key || '';
      case 'get-user-credentials':
        return { ok: true, credentials: this.licenseService.getCredentials() };
      case 'get-target-url':
        return this.licenseService.getTargetUrl(this.getConfigUrl('dreamUrl'));
      case 'get-platform-name':
        return this.licenseService.getPlatformName();
      case 'get-tutorial-url':
        return this.licenseService.getTutorialUrl(this.getConfigUrl('tutorialUrl'));
      case 'get-connection-status':
        return { ok: true, status: 'connected', message: 'VS Code 插件模式' };
      case 'validate-key':
        return this.validateKey(payload);
      case 'open-dream-page':
        return this.openDreamPage();
      case 'open-opencut-page':
        return this.openOpenCutPage();
      case 'open-ai-canvas-pro-page':
        return this.openAiCanvasProPage();
      case 'is-ai-canvas-pro-installed':
        return { ok: true, installed: true, vscodeMode: true };
      case 'open-toonflow-page':
        return this.openToonflowPage();
      case 'open-tutorial':
        return this.openTutorialPage();
      case 'get-clash-mini-status':
        return this.clashMini.getStatus();
      case 'start-clash-mini':
        return this.startClashMini();
      case 'stop-clash-mini':
        return this.stopClashMini();
      case 'get-clash-mini-proxy-options':
        return this.clashMini.getProxyOptions(payload);
      case 'test-min-latency':
        return this.clashMini.testMinLatency(payload);
      case 'switch-clash-mini-proxy':
        return this.clashMini.switchProxy(payload);
      case 'save-clash-config':
        return this.clashMini.saveConfig(payload?.content || payload?.configContent || payload?.clashConfig || '');
      case 'get-network-magic-auto-start-enabled':
        return { ok: true, enabled: this.context.globalState.get('networkMagicAutoStart', false) === true };
      case 'set-network-magic-auto-start-enabled':
        await this.context.globalState.update('networkMagicAutoStart', payload?.enabled === true);
        return { ok: true, enabled: payload?.enabled === true };
      default:
        return { ok: false, message: `VS Code 插件暂未实现通道: ${channel}` };
    }
  }

  async validateKey(payload = {}) {
    const result = await this.licenseService.validateKey({
      key: payload.key,
      deviceId: payload.device_id || payload.deviceId,
    });
    if (result.ok) {
      this.postEvent('license-credentials-updated', this.licenseService.getCredentials());
      const runtimeConfig = result.runtimeConfig || {};
      if (runtimeConfig.targetUrl) this.postEvent('target-url-updated', { targetUrl: runtimeConfig.targetUrl });
      if (runtimeConfig.tutorialUrl) this.postEvent('tutorial-url-updated', { tutorialUrl: runtimeConfig.tutorialUrl });
      if (runtimeConfig.platformName) this.postEvent('platform-name-updated', { platformName: runtimeConfig.platformName });
    }
    return result;
  }

  async openDreamPage() {
    return this.openConfiguredUrl('dream', '即梦 AI', 'dreamUrl');
  }

  async openOpenCutPage() {
    return this.openConfiguredUrl('opencut', '视频剪辑', 'openCutUrl');
  }

  async openAiCanvasProPage() {
    return this.openConfiguredUrl('aiCanvasPro', '无限画布', 'aiCanvasProUrl');
  }

  async openToonflowPage() {
    return this.openConfiguredUrl('toonflow', '自动分镜', 'toonflowUrl');
  }

  async openTutorialPage() {
    return this.openConfiguredUrl('tutorial', '使用教程', 'tutorialUrl');
  }

  async openConfiguredUrl(key, title, configKey) {
    let targetUrl = this.getConfigUrl(configKey);
    if (configKey === 'dreamUrl') {
      targetUrl = this.licenseService.getTargetUrl(targetUrl);
    } else if (configKey === 'tutorialUrl') {
      targetUrl = this.licenseService.getTutorialUrl(targetUrl);
    }
    return this.panelManager.openUrl(key, title, targetUrl, {
      mode: this.getConfigUrl('openMode') || 'simpleBrowser',
    });
  }

  async startClashMini() {
    const result = await this.clashMini.start();
    this.postEvent('clash-mini-status', this.clashMini.getStatus());
    return result;
  }

  async stopClashMini() {
    const result = await this.clashMini.stop();
    this.postEvent('clash-mini-status', this.clashMini.getStatus());
    return result;
  }

  dispose() {
    this.clashSubscription?.dispose?.();
    this.logSubscription?.dispose?.();
  }
}

module.exports = {
  SidebarProvider,
};
