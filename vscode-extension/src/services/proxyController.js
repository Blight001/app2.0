// 代理生效控制：魔法网络开启时把 VS Code 全局 http.proxy 指向本地混合端口，
// 这样 Simple Browser / Webview 打开的目标站都会走 clash 本地端口代理；关闭时还原。
// 对应软件端 ui.applyClashMiniBrowserProxy 的 VS Code 等价物。

const vscode = require('vscode');

const SAVED_PROXY_KEY = 'aiFreeTools.savedHttpProxy';
const SAVED_STRICT_KEY = 'aiFreeTools.savedHttpProxyStrictSSL';
const APPLIED_KEY = 'aiFreeTools.proxyAppliedByPlugin';

class ProxyController {
  constructor(context, deps = {}) {
    this.context = context;
    this.logService = deps.logService || null;
  }

  getActiveProxy() {
    return String(vscode.workspace.getConfiguration('http').get('proxy') || '').trim();
  }

  async enable(port) {
    const targetPort = Number(port);
    if (!Number.isFinite(targetPort) || targetPort <= 0) {
      return { ok: false, error: '无效的代理端口' };
    }
    const proxyUrl = `http://127.0.0.1:${targetPort}`;
    const httpConfig = vscode.workspace.getConfiguration('http');

    // 仅在尚未由本插件接管时，记录用户原始值，避免覆盖丢失
    if (this.context.globalState.get(APPLIED_KEY) !== true) {
      await this.context.globalState.update(SAVED_PROXY_KEY, httpConfig.get('proxy') ?? '');
      await this.context.globalState.update(SAVED_STRICT_KEY, httpConfig.get('proxyStrictSSL'));
    }

    await httpConfig.update('proxy', proxyUrl, vscode.ConfigurationTarget.Global);
    await httpConfig.update('proxyStrictSSL', false, vscode.ConfigurationTarget.Global);
    await this.context.globalState.update(APPLIED_KEY, true);
    this.logService?.info?.(`已将 VS Code http.proxy 指向本地代理：${proxyUrl}`, { source: 'proxy', proxyUrl });
    return { ok: true, proxyUrl };
  }

  async disable() {
    if (this.context.globalState.get(APPLIED_KEY) !== true) {
      return { ok: true, restored: false };
    }
    const httpConfig = vscode.workspace.getConfiguration('http');
    const savedProxy = this.context.globalState.get(SAVED_PROXY_KEY, '');
    const savedStrict = this.context.globalState.get(SAVED_STRICT_KEY);

    await httpConfig.update('proxy', savedProxy || undefined, vscode.ConfigurationTarget.Global);
    await httpConfig.update(
      'proxyStrictSSL',
      savedStrict === undefined ? undefined : savedStrict,
      vscode.ConfigurationTarget.Global,
    );
    await this.context.globalState.update(APPLIED_KEY, false);
    this.logService?.info?.('已还原 VS Code http.proxy 设置', { source: 'proxy' });
    return { ok: true, restored: true };
  }
}

module.exports = {
  ProxyController,
};
