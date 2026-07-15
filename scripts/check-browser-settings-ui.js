const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let accountCenterOpenRequests = 0;
let accountLoginOpenRequests = 0;
ipcMain.on('toggle-account-center-popup', () => { accountCenterOpenRequests += 1; });
ipcMain.on('open-account-center-popup', () => { accountLoginOpenRequests += 1; });

ipcMain.handle('get-ai-free-browser-settings', () => ({
  ok: true,
  settings: require('../src/app/main/utils/ai-free-browser-settings').normalizeAiFreeBrowserSettings({}),
  runtimeInfo: { chromiumVersion: process.versions.chrome, electronVersion: process.versions.electron },
  activeTab: null,
}));
for (const [channel, response] of [
  ['get-extension-manager-state', { ok: true, extensions: [] }],
  ['get-clash-mini-status', { running: false }],
  ['get-user-credentials', { ok: true, credentials: {} }],
  ['get-all-accounts', []],
  ['get-target-url', 'https://www.baidu.com/'],
  ['get-platform-name', 'AI-FREE'],
  ['get-wool-platforms', [{ name: 'AI-FREE', targetUrl: 'https://www.baidu.com/' }]],
  ['get-tutorial-url', 'https://www.baidu.com/'],
  ['consume-auto-validate-flag', { pending: false }],
  ['get-network-magic-auto-start-enabled', { ok: true, enabled: false }],
  ['get-browser-history', {
    ok: true,
    history: [{
      id: 'shared-browser',
      name: '平台 A',
      accountDisplayName: '账号123456',
      accountType: 'shared',
      accountTypeLabel: '循环账号',
      autoDeleteAt: 2_000_000_000_000,
      isOpen: false,
      isActive: false,
    }],
  }],
  ['account-get-session', { authenticated: false }],
  ['get-proxy-traffic-quota', { ok: false }],
  ['ai-control-get-browser-connections', { ok: true, connections: [] }],
  ['ai-control-history-list', { ok: true, sessions: [] }],
  ['ai-control-get-models', { ok: true, models: [], quota: null }],
  ['focus-sidebar-input', { ok: true }],
]) ipcMain.handle(channel, () => response);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 805,
    height: 1200,
    show: !!process.env.AI_FREE_UI_CAPTURE,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, '../src/app/main/preload.js') },
  });
  await win.loadFile(path.join(__dirname, '../src/app/sidebar/index.html'));
  await new Promise((resolve) => setTimeout(resolve, 120));
  const result = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-tab="ai-free-settings-panel"]').click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const panel = document.getElementById('ai-free-settings-panel');
    const labels = Array.from(panel.querySelectorAll('.vb-label')).map((item) => item.textContent.trim());
    return {
      active: panel.classList.contains('active'),
      controlInactive: document.getElementById('account-center-dialog').hidden,
      rows: panel.querySelectorAll('.vb-row').length,
      labels,
      browserHistoryVisible: !!document.getElementById('browser-history-list'),
      browserHistoryText: document.getElementById('browser-history-list')?.textContent || '',
      accountHistoryRemoved: !document.getElementById('account-history-toggle-btn') && !document.getElementById('account-panel'),
      removedNetworkHeading: !document.getElementById('network-tools-title') && !panel.querySelector('.settings-network-tools-hint'),
      overflowY: getComputedStyle(document.querySelector('.main-wrapper')).overflowY,
    };
  })()`);
  const required = ['操作系统', '代理设置', 'User Agent', 'WebRTC', 'Canvas', 'WebGL 图像', 'AudioContext', 'CPU', 'MAC 地址', '端口扫描保护', '启动参数'];
  if (
    !result.active
    || !result.controlInactive
    || !result.browserHistoryVisible
    || !result.browserHistoryText.includes('账号123456')
    || !result.browserHistoryText.includes('循环账号')
    || !result.browserHistoryText.includes('自动删除：')
    || !result.accountHistoryRemoved
    || !result.removedNetworkHeading
    || result.rows < 30
    || required.some((label) => !result.labels.includes(label))
  ) {
    throw new Error(`AI-FREE 参数面板校验失败: ${JSON.stringify(result)}`);
  }
  const promptResult = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    window.MessageModal.hideLoadingMessage();
    window.MessageModal.hideServerMessageModal();
    const deadline = Date.now() + 1500;
    const submitWhenReady = () => {
      const input = document.querySelector('.modal-prompt-input');
      if (!input) {
        if (Date.now() < deadline) return setTimeout(submitWhenReady, 25);
        return resolve('__missing_input__');
      }
      input.value = '新名称';
      document.getElementById('prompt-dialog-confirm-btn')?.click();
    };
    window.MessageModal.showPromptDialog('请输入名称', '原名称', (value) => resolve(value), null, { title: '重命名浏览器' });
    submitWhenReady();
  })`);
  if (promptResult !== '新名称') {
    throw new Error(`软件重命名弹窗校验失败: ${JSON.stringify(promptResult)}`);
  }
  const aiLoginTriggerResult = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const input = document.getElementById('ai-chat-input');
    input.value = '测试未登录发送';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('ai-chat-form').requestSubmit();
    setTimeout(() => resolve({
      accountDialogHidden: document.getElementById('account-center-dialog').hidden,
      authFormVisible: document.getElementById('sidebar-account-auth').hidden === false,
      authFormEmbedded: document.getElementById('sidebar-account-auth').parentElement
        === document.getElementById('sidebar-account-session'),
    }), 80);
  })`);
  if (
    accountLoginOpenRequests !== 1
    || aiLoginTriggerResult.accountDialogHidden !== true
    || aiLoginTriggerResult.authFormVisible !== true
    || aiLoginTriggerResult.authFormEmbedded !== true
  ) {
    throw new Error(`AI 未登录独立浮窗触发校验失败: ${JSON.stringify({
      accountLoginOpenRequests,
      ...aiLoginTriggerResult,
    })}`);
  }
  const accountCenterResult = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const dialog = document.getElementById('account-center-dialog');
    const oldTabRemoved = !document.querySelector('[data-tab="personal-center-panel"]')
      && !document.getElementById('personal-center-panel');
    window.openAccountCenterDialog();
    setTimeout(() => {
      const opened = !dialog.hidden
        && dialog.getAttribute('aria-hidden') === 'false';
      const profileVisible = !!dialog.querySelector('#sidebar-account-session')
        && !!dialog.querySelector('#announcement-bar')
        && !!dialog.querySelector('.personal-footer');
      const accountCard = dialog.querySelector('#sidebar-account-session');
      const sameColumn = dialog.querySelector('#announcement-bar')?.parentElement === accountCard
        && dialog.querySelector('.personal-footer')?.parentElement === accountCard;
      const titleAndBackgroundRemoved = !dialog.querySelector('#account-center-dialog-title')
        && getComputedStyle(dialog.querySelector('.account-center-dialog-backdrop')).backgroundColor === 'rgba(0, 0, 0, 0)'
        && getComputedStyle(dialog.querySelector('.account-center-dialog-panel')).backgroundColor === 'rgba(0, 0, 0, 0)';
      const authForm = dialog.querySelector('#sidebar-account-auth');
      const inlineAuthVisible = authForm?.hidden === false
        && authForm.parentElement === accountCard
        && !authForm.hasAttribute('aria-modal')
        && authForm.getAttribute('role') !== 'dialog';
      dialog.querySelector('[data-auth-mode="register"]')?.click();
      const registerModeWorks = dialog.querySelector('#sidebar-auth-confirm-group')?.hidden === false
        && dialog.querySelector('#sidebar-auth-submit')?.textContent === '注册并登录';
      dialog.querySelector('[data-auth-mode="login"]')?.click();
      document.getElementById('account-center-dialog-close').click();
      setTimeout(() => resolve({
        oldTabRemoved,
        opened,
        profileVisible,
        sameColumn,
        titleAndBackgroundRemoved,
        inlineAuthVisible,
        registerModeWorks,
        closed: dialog.hidden,
      }), 30);
    }, 30);
  })`);
  if (Object.values(accountCenterResult).some((value) => value !== true)) {
    throw new Error(`个人中心头像弹窗校验失败: ${JSON.stringify(accountCenterResult)}`);
  }
  if (process.env.AI_FREE_UI_CAPTURE) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(process.env.AI_FREE_UI_CAPTURE, image.toPNG());
  }
  await win.loadFile(path.join(__dirname, '../src/app/sidebar/index.html'), {
    query: { accountCenterPopup: '1' },
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const standalonePopupResult = await win.webContents.executeJavaScript(`(() => {
    const panelStyle = getComputedStyle(document.querySelector('.account-center-dialog-panel'));
    const bodyStyle = getComputedStyle(document.querySelector('.account-center-dialog-body'));
    return {
      popupMode: document.documentElement.classList.contains('account-center-popup'),
      dialogOpened: !document.getElementById('account-center-dialog').hidden,
      sidebarNavRemoved: getComputedStyle(document.querySelector('.tab-nav')).display === 'none',
      pageTransparent: getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'
        && getComputedStyle(document.querySelector('.control-shell')).backgroundColor === 'rgba(0, 0, 0, 0)',
      heightUnbounded: panelStyle.maxHeight === 'none',
      verticalScrollRemoved: bodyStyle.overflowY === 'visible',
    };
  })()`);
  if (Object.values(standalonePopupResult).some((value) => value !== true)) {
    throw new Error(`个人中心独立浮窗模式校验失败: ${JSON.stringify(standalonePopupResult)}`);
  }
  if (process.env.AI_FREE_ACCOUNT_UI_CAPTURE) {
    win.setSize(430, 720);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(process.env.AI_FREE_ACCOUNT_UI_CAPTURE, image.toPNG());
    win.setSize(805, 1200);
  }
  await win.loadFile(path.join(__dirname, '../src/app/views/app-shell.html'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const shellAccountResult = await win.webContents.executeJavaScript(`(() => {
    const updateWidget = document.getElementById('update-widget');
    const theme = document.getElementById('theme-toggle-btn');
    const avatar = document.getElementById('account-center-btn');
    const gear = document.getElementById('add-tab-btn');
    const createButton = document.getElementById('new-browser-window-btn');
    const logo = avatar?.querySelector('img');
    const wasLight = document.documentElement.classList.contains('theme-light');
    theme?.click();
    const avatarBeforeGear = avatar?.nextElementSibling === gear;
    avatar?.click();
    return {
      controlsOrdered: updateWidget?.nextElementSibling === theme && theme?.nextElementSibling === avatar,
      avatarBeforeGear,
      logoLoaded: !!logo?.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0,
      unauthenticated: avatar?.dataset.authenticated === 'false',
      themeToggled: document.documentElement.classList.contains('theme-light') !== wasLight,
      modernGearIcon: !!gear?.querySelector('svg.settings-icon') && !gear.textContent.includes('⚙'),
      modernCreateIcon: !!createButton?.querySelector('svg.new-window-icon') && createButton.textContent.trim() === '',
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (Object.values(shellAccountResult).some((value) => value !== true) || accountCenterOpenRequests !== 1) {
    throw new Error(`主窗口个人中心独立浮窗入口校验失败: ${JSON.stringify({ ...shellAccountResult, accountCenterOpenRequests })}`);
  }
  win.webContents.send('app-update-activated', { version: '9.9.9', percent: 0 });
  win.webContents.send('app-update-progress', { version: '9.9.9', phase: 'downloading', percent: 64 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const shellUpdateResult = await win.webContents.executeJavaScript(`(() => {
    const widget = document.getElementById('update-widget');
    const ring = document.getElementById('update-widget-ring');
    return {
      visible: widget?.hidden === false,
      percent: document.getElementById('update-widget-percent')?.textContent === '64%',
      ringProgress: ring?.style.getPropertyValue('--update-progress') === '64%',
    };
  })()`);
  if (Object.values(shellUpdateResult).some((value) => value !== true)) {
    throw new Error(`主窗口更新进度圆球校验失败: ${JSON.stringify(shellUpdateResult)}`);
  }
  win.webContents.send('app-update-skip', {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  const updateHiddenAfterSkip = await win.webContents.executeJavaScript(
    `document.getElementById('update-widget')?.hidden === true`,
  );
  if (!updateHiddenAfterSkip) throw new Error('主窗口更新进度圆球在跳过更新后未隐藏');
  if (process.env.AI_FREE_SHELL_UI_CAPTURE) {
    win.setSize(1000, 700);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1000, height: 42 });
    fs.writeFileSync(process.env.AI_FREE_SHELL_UI_CAPTURE, image.toPNG());
  }
  console.log(`browser settings, standalone account popup and app-shell avatar UI checks passed (${result.rows} rows)`);
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
