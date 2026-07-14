'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

async function main() {
  const projectDir = path.resolve(__dirname, '..');
  const appOutDir = path.resolve(
    process.env.PACKAGED_APP_DIR || path.join(projectDir, 'appbuild', 'win-unpacked'),
  );
  const sidebarPath = process.env.SIDEBAR_HTML_PATH
    ? path.resolve(process.env.SIDEBAR_HTML_PATH)
    : path.join(
      appOutDir,
      'resources',
      'app.asar',
      'src',
      'app',
      'sidebar',
      'index.html',
    );
  const appShellPath = process.env.SIDEBAR_HTML_PATH
    ? path.join(projectDir, 'src', 'app', 'views', 'app-shell.html')
    : path.join(
      appOutDir,
      'resources',
      'app.asar',
      'src',
      'app',
      'views',
      'app-shell.html',
    );
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(sidebarPath);
  const logos = await window.webContents.executeJavaScript(`(() => {
    return Array.from(document.querySelectorAll('img[data-app-logo]')).map((image) => ({
      src: image.src,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }));
  })()`);
  if (logos.length !== 3 || logos.some((logo) => (
    !logo.complete || logo.naturalWidth <= 0 || logo.naturalHeight <= 0
  ))) {
    throw new Error('侧边栏头像、登录图标或 AI 空白对话 Logo 无法加载');
  }
  const accountDialog = await window.webContents.executeJavaScript(`(() => {
    window.openAccountCenterDialog?.();
    const dialog = document.getElementById('account-center-dialog');
    const card = document.getElementById('sidebar-account-session');
    const result = {
      opened: !!dialog && !dialog.hidden,
      sameColumn: document.getElementById('announcement-bar')?.parentElement === card
        && document.querySelector('.personal-footer')?.parentElement === card,
      titleRemoved: !document.getElementById('account-center-dialog-title'),
      backgroundRemoved: getComputedStyle(document.querySelector('.account-center-dialog-backdrop')).backgroundColor === 'rgba(0, 0, 0, 0)'
        && getComputedStyle(document.querySelector('.account-center-dialog-panel')).backgroundColor === 'rgba(0, 0, 0, 0)',
    };
    window.closeAccountCenterDialog?.();
    return result;
  })()`);
  if (Object.values(accountDialog).some((value) => value !== true)) {
    throw new Error(`打包后的账号信息弹窗结构异常: ${JSON.stringify(accountDialog)}`);
  }
  await window.loadFile(appShellPath);
  const shellAvatar = await window.webContents.executeJavaScript(`(() => {
    const button = document.getElementById('account-center-btn');
    const gear = document.getElementById('add-tab-btn');
    const image = button?.querySelector('img[data-app-logo]');
    return image ? {
      src: image.src,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      beforeGear: button.nextElementSibling === gear,
    } : null;
  })()`);
  console.log(JSON.stringify({ sidebarPath, logos, accountDialog, appShellPath, shellAvatar }));
  if (!shellAvatar
    || !shellAvatar.complete
    || shellAvatar.naturalWidth <= 0
    || shellAvatar.naturalHeight <= 0
    || shellAvatar.beforeGear !== true) {
    throw new Error('主窗口个人中心头像未能在侧栏齿轮左侧正常加载');
  }
  window.destroy();
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error?.stack || error);
    app.exit(1);
  });
