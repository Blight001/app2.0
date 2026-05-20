const vscode = require('vscode');
const { SidebarProvider } = require('./sidebarProvider');
const { PanelManager } = require('./panelManager');
const { ClashMiniService } = require('./clashMiniService');
const { LicenseService } = require('./services/licenseService');
const { LogService } = require('./services/logService');

function getConfigUrl(key) {
  return vscode.workspace.getConfiguration('aiFreeTools').get(key);
}

async function activate(context) {
  const logService = new LogService();
  const panelManager = new PanelManager(context, { logService });
  const clashMini = new ClashMiniService(context, { logService });
  const licenseService = new LicenseService(context, { logService });
  const sidebarProvider = new SidebarProvider(context, {
    panelManager,
    clashMini,
    licenseService,
    logService,
    getConfigUrl,
  });
  logService.info('AI Free Tools VS Code 插件已激活');

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

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
