const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const httpClient = require('../services/httpClient');

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
    this.accountStore = deps.accountStore;
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
      this.postEvent('account-list-updated', { records: this.accountStore?.list?.() || [] });
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
        return this.getConnectionStatus();
      case 'validate-key':
        return this.validateKey(payload);
      case 'unbind-device':
        return this.unbindDevice();
      case 'refresh-subscription-url':
        return this.refreshLine();
      case 'delete-account-record':
        return this.deleteAccountRecord(payload?.id);
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
      case 'get-account-records':
        return { ok: true, records: this.accountStore?.list?.() || [] };
      case 'fetch-account':
        return this.fetchAccount();
      case 'get-network-magic-auto-start-enabled':
        return { ok: true, enabled: this.context.globalState.get('networkMagicAutoStart', false) === true };
      case 'set-network-magic-auto-start-enabled':
        await this.context.globalState.update('networkMagicAutoStart', payload?.enabled === true);
        return { ok: true, enabled: payload?.enabled === true };
      default:
        return { ok: false, message: `VS Code 插件暂未实现通道: ${channel}` };
    }
  }

  // 激活时与软件端对齐：自动验证已保存卡密，并按设置自动开启网络魔法。
  async bootstrap() {
    const creds = this.licenseService.getCredentials();
    const savedKey = String(creds.key || '').trim();
    if (savedKey) {
      try {
        const result = await this.validateKey({ key: savedKey, deviceId: creds.deviceId });
        if (result?.ok) this.logService?.info?.('已自动验证保存的卡密', { source: 'license' });
        else this.logService?.warn?.(`自动验证未通过：${result?.message || 'unknown'}`, { source: 'license' });
      } catch (error) {
        this.logService?.warn?.(`自动验证异常：${error?.message || error}`, { source: 'license' });
      }
    }
    const autoStart = this.context.globalState.get('networkMagicAutoStart', false) === true;
    if (autoStart && this.licenseService.getCredentials().validated) {
      this.logService?.info?.('按设置自动开启网络魔法', { source: 'clash' });
      try {
        await this.startClashMini();
      } catch (error) {
        this.logService?.warn?.(`自动开启网络魔法失败：${error?.message || error}`, { source: 'clash' });
      }
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
      this.postEvent('runtime-config-updated', {
        platformName: runtimeConfig.platformName || '',
        accountTypeLabel: this.licenseService.getAccountTypeLabel(),
        tutorialUrl: runtimeConfig.tutorialUrl || '',
        targetUrl: runtimeConfig.targetUrl || '',
        serverBase: runtimeConfig.serverBase || '',
        expire_at: runtimeConfig.expire_at || result.expire_at || '',
        days_left: runtimeConfig.days_left ?? result.days_left ?? null,
        maxUsageTimes: runtimeConfig.maxUsageTimes ?? null,
        usedUsageTimes: runtimeConfig.usedUsageTimes ?? null,
        remainingUsageTimes: runtimeConfig.remainingUsageTimes ?? result.remaining_usage_times ?? null,
      });
    }
    return result;
  }

  // 从服务器获取账号（/api/fetch_cookie），写入历史记录并通知侧边栏。
  // 注意：VS Code 无法给第三方站点注入 cookie，本期仅获取+记录+展示，免登录注入后续单独攻关。
  async fetchAccount() {
    const creds = this.licenseService.getCredentials();
    if (!creds.validated) return { ok: false, message: '请先验证卡密' };
    const serverBase = this.licenseService.getServerBase();
    if (!serverBase) return { ok: false, message: '未获取到服务器地址' };
    const platform = this.licenseService.getPlatformName();
    const targetUrl = this.licenseService.getTargetUrl(this.getConfigUrl('dreamUrl'));
    let result;
    try {
      ({ result } = await httpClient.fetchServerCookie(serverBase, {
        key: creds.key,
        deviceId: creds.deviceId,
        platform,
      }, { targetUrl }));
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
    if (!result || result.ok !== true) {
      return { ok: false, message: result?.message || '账号获取失败' };
    }
    const record = await this.accountStore?.addOrUpdate?.({
      account: result.account,
      platform: result.platform || platform,
      key: creds.key,
      deviceId: creds.deviceId,
      currentAccountType: result.currentAccountType,
      currentAccountTypeLabel: result.currentAccountTypeLabel,
      serverRecycleTime: result.serverRecycleTime,
      cookieCount: Array.isArray(result.cookies) ? result.cookies.length : 0,
    });
    this.postEvent('account-list-updated', { records: this.accountStore?.list?.() || [] });
    // TODO(cookie 注入): 后续在此把 result.cookies / result.browserStorage 注入到目标站会话实现免登录。
    return { ok: true, account: result.account, record, cookieCount: Array.isArray(result.cookies) ? result.cookies.length : 0 };
  }

  async openDreamPage() {
    // 打开前从服务器获取账号并记录历史（免登录注入后续跟进）
    await this.fetchAccount().catch(() => {});
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
    const creds = this.licenseService.getCredentials();
    const result = await this.clashMini.start({
      key: creds.key,
      deviceId: creds.deviceId,
      serverBase: this.licenseService.getServerBase(),
    });
    this.postEvent('clash-mini-status', this.clashMini.getStatus());
    return result;
  }

  getConnectionStatus() {
    const creds = this.licenseService.getCredentials();
    const clashRunning = this.clashMini?.isRunning?.() === true;
    if (!creds.validated) {
      return { ok: true, status: 'disconnected', message: '未验证卡密' };
    }
    if (clashRunning) {
      return { ok: true, status: 'connected', message: '网络魔法运行中' };
    }
    return { ok: true, status: 'connected', message: '卡密有效' };
  }

  // 设备解绑：调用 /api/unbind_device，成功后清空已保存卡密验证态
  async unbindDevice() {
    const creds = this.licenseService.getCredentials();
    const key = String(creds.key || '').trim();
    const deviceId = String(creds.deviceId || this.licenseService.getDeviceId() || '').trim();
    if (!key) return { ok: false, message: '请先输入并验证卡密' };
    const serverBase = this.licenseService.getServerBase();
    if (!serverBase) return { ok: false, message: '未获取到服务器地址，请先验证卡密' };
    let result;
    try {
      result = await httpClient.unbindDeviceOnServer(serverBase, { key, deviceId });
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
    if (!result.ok) return { ok: false, message: result.message || '解绑失败' };
    await this.licenseService.clearValidation();
    this.postEvent('license-credentials-updated', this.licenseService.getCredentials());
    this.logService?.success?.(`设备解绑成功：${result.message}`, { source: 'license' });
    return { ok: true, message: result.message || '解绑成功', data: result.data };
  }

  // 重新从服务器拉取线路配置（等价软件端 refresh-subscription-url）
  async refreshLine() {
    const creds = this.licenseService.getCredentials();
    if (!creds.validated) return { ok: false, message: '请先验证卡密' };
    const result = await this.clashMini.refresh({
      key: creds.key,
      deviceId: creds.deviceId,
      serverBase: this.licenseService.getServerBase(),
    });
    this.postEvent('clash-mini-status', this.clashMini.getStatus());
    return result;
  }

  async deleteAccountRecord(id) {
    const removed = await this.accountStore?.remove?.(id);
    this.postEvent('account-list-updated', { records: this.accountStore?.list?.() || [] });
    return { ok: true, removed: removed === true };
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
