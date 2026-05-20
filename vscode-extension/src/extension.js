const vscode = require('vscode');
const { SidebarProvider } = require('./providers/sidebarProvider');
const { PanelManager } = require('./providers/panelManager');
const { ClashMiniService } = require('./services/clashMiniService');
const { LicenseService } = require('./services/licenseService');
const { LogService } = require('./services/logService');
const { AccountStore } = require('./services/accountStore');
const { ProxyController } = require('./services/proxyController');

function getConfigUrl(key) {
  return vscode.workspace.getConfiguration('aiFreeTools').get(key);
}

let activeClashMini = null;
let activeProxyController = null;

async function activate(context) {
  const logService = new LogService();
  const panelManager = new PanelManager(context, { logService });
  const proxyController = new ProxyController(context, { logService });
  const clashMini = new ClashMiniService(context, { logService, proxyController });
  const licenseService = new LicenseService(context, { logService });
  const accountStore = new AccountStore(context);
  const sidebarProvider = new SidebarProvider(context, {
    panelManager,
    clashMini,
    licenseService,
    accountStore,
    logService,
    getConfigUrl,
  });
  activeClashMini = clashMini;
  activeProxyController = proxyController;
  logService.info('AI Free Tools VS Code 插件已激活');

  // 与软件端对齐：激活后自动验证已保存卡密 + 按设置自动开启网络魔法（不阻塞激活）
  sidebarProvider.bootstrap().catch(() => {});

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.commands.registerCommand('aiFreeTools.openDream', () => sidebarProvider.openDreamPage()),
    vscode.commands.registerCommand('aiFreeTools.openOpenCut', () => sidebarProvider.openOpenCutPage()),
    vscode.commands.registerCommand('aiFreeTools.openAiCanvasPro', () => sidebarProvider.openAiCanvasProPage()),
    vscode.commands.registerCommand('aiFreeTools.openToonflow', () => sidebarProvider.openToonflowPage()),
    vscode.commands.registerCommand('aiFreeTools.openTutorial', () => sidebarProvider.openTutorialPage()),
    vscode.commands.registerCommand('aiFreeTools.startClashMini', () => sidebarProvider.startClashMini()),
    vscode.commands.registerCommand('aiFreeTools.stopClashMini', () => sidebarProvider.stopClashMini()),
    {
      dispose: () => {
        sidebarProvider.dispose();
        clashMini.dispose();
      },
    },
  );
}

async function deactivate() {
  try {
    if (activeClashMini) await activeClashMini.stop();
  } catch (_) {}
  try {
    if (activeProxyController) await activeProxyController.disable();
  } catch (_) {}
}

module.exports = {
  activate,
  deactivate,
};
