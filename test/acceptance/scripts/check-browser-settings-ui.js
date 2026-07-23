const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { attachContextMenu } = require('../../../src/app/main/utils/removeWatermark');
const performanceProbeStartedAt = process.hrtime.bigint();

let accountCenterOpenRequests = 0;
let accountLoginOpenRequests = 0;
let browserHistoryOpenRequests = 0;
ipcMain.on('toggle-account-center-popup', () => { accountCenterOpenRequests += 1; });
ipcMain.on('open-account-center-popup', () => { accountLoginOpenRequests += 1; });
ipcMain.handle('open-browser-history', (_event, payload = {}) => {
  browserHistoryOpenRequests += 1;
  return { ok: true, historyId: payload.historyId, name: '平台 A' };
});

ipcMain.handle('get-ai-free-browser-settings', () => ({
  ok: true,
  settings: require('../../../src/app/main/utils/ai-free-browser-settings').normalizeAiFreeBrowserSettings({}),
  runtimeInfo: { chromiumVersion: process.versions.chrome, electronVersion: process.versions.electron },
  activeTab: null,
}));
ipcMain.handle('get-ai-control-settings', () => ({
  ok: true,
  settings: { mcpCallLimit: 100 },
  limits: { mcpCallLimit: { min: 1, max: 1000 } },
}));
ipcMain.handle('set-ai-control-settings', (_event, payload = {}) => ({
  ok: true,
  settings: { mcpCallLimit: Number(payload.mcpCallLimit) },
}));
for (const [channel, response] of /** @type {Array<[string, any]>} */ ([
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
  ['ai-control-get-browser-connections', {
    ok: true,
    connections: [],
    softwareTargets: [{
      profileId: 'software-notepad',
      name: '记事本',
      pid: 321,
      isActive: true,
      toolCount: 1,
    }],
  }],
  ['ai-control-history-list', { ok: true, sessions: [] }],
  ['ai-control-get-models', {
    ok: true,
    models: [{ id: 'fixture-model', name: 'Fixture Model' }],
    quota: null,
  }],
  ['ai-control-get-automation-cards', { ok: true, cards: [] }],
  ['refresh-wool-platforms', { ok: true, woolPlatforms: [] }],
  ['get-ai-server-device-status', {
    ok: true,
    status: {
      phase: 'idle', server: 'http://49.234.181.190:3000', account: '',
      serviceName: 'AI-FREE', connected: false, registered: false,
      serviceId: '', toolCount: 0, aiConfigId: null, message: '尚未连接 AI 服务器',
    },
  }],
  ['focus-sidebar-input', { ok: true }],
  ['list-available-software', { ok: true, data: [{
    id: 'notepad',
    name: '记事本',
    description: 'Windows 文本编辑器',
    iconText: '记',
    experimental: false,
  }] }],
])) ipcMain.handle(channel, () => response);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 805,
    height: 1200,
    show: !!process.env.AI_FREE_UI_CAPTURE,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, '../../../src/app/main/preload.js') },
  });
  attachContextMenu(win.webContents, {
    rendererContextMenuSelector: '.browser-history-item, #browser-history-context-menu',
  });
  await win.loadFile(path.join(__dirname, '../../../src/app/sidebar/index.html'));
  await new Promise((resolve) => setTimeout(resolve, 120));
  const firstSidebarReadyMs = Number(process.hrtime.bigint() - performanceProbeStartedAt) / 1e6;
  const result = await win.webContents.executeJavaScript(`(async () => {
    const gear = document.getElementById('ai-chat-browser-trigger');
    gear.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const controlTarget = document.getElementById('ai-chat-browser');
    const softwareTargetOption = controlTarget?.querySelector(
      'option[value="software:software-notepad"]',
    );
    const mcpInput = document.getElementById('ai-browser-mcp-call-limit');
    const mcpDefault = mcpInput?.value || '';
    if (mcpInput) mcpInput.value = '125';
    document.getElementById('ai-browser-mcp-call-limit-save')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const mcpSaved = mcpInput?.value || '';
    const mcpStatus = document.getElementById('ai-browser-mcp-call-limit-status')?.textContent || '';
    const configDialog = document.getElementById('ai-custom-api-dialog');
    configDialog.hidden = false;
    showAiConfigPage('custom');
    document.getElementById('ai-server-device-title')?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const serverDevicePage = {
      customHidden: document.querySelector('[data-ai-config-content="custom"]')?.hidden === true,
      serverVisible: document.querySelector('[data-ai-config-content="server"]')?.hidden === false,
      serverDefault: document.getElementById('ai-server-device-server')?.value || '',
      titleActive: document.getElementById('ai-server-device-title')?.classList.contains('is-active') === true,
    };
    configDialog.hidden = true;
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
      browserHistoryMaxHeight: parseFloat(
        getComputedStyle(document.getElementById('browser-history-list')).maxHeight,
      ),
      browserConfigLabel: document.querySelector('[data-tab="ai-free-settings-panel"] span:last-child')?.textContent.trim() || '',
      mcpDefault,
      mcpSaved,
      mcpStatus,
      serverDevicePage,
      softwareTarget: {
        exists: !!softwareTargetOption,
        selected: softwareTargetOption?.selected === true,
        text: softwareTargetOption?.textContent || '',
      },
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
    || result.browserHistoryMaxHeight <= 238
    || result.browserConfigLabel !== '浏览器配置'
    || result.mcpDefault !== '100'
    || result.mcpSaved !== '125'
    || result.mcpStatus !== '已保存'
    || result.serverDevicePage.customHidden !== true
    || result.serverDevicePage.serverVisible !== true
    || result.serverDevicePage.titleActive !== true
    || result.serverDevicePage.serverDefault !== 'http://49.234.181.190:3000'
    || result.softwareTarget.exists !== true
    || result.softwareTarget.selected !== true
    || !result.softwareTarget.text.includes('记事本')
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
  const browserHistoryInteractionResult = await win.webContents.executeJavaScript(`(async () => {
    const getMain = () => document.querySelector('[data-history-id="shared-browser"] .browser-history-main');
    const initialMain = getMain();
    initialMain.click();
    const selectedRow = document.querySelector('[data-history-id="shared-browser"]');
    const selectedBorderColor = getComputedStyle(selectedRow).borderColor;
    getMain().click();
    const rightClickTarget = getMain();
    const rightClickBounds = rightClickTarget.getBoundingClientRect();
    const contextPoint = {
      x: Math.round(rightClickBounds.left + rightClickBounds.width / 2),
      y: Math.round(rightClickBounds.top + rightClickBounds.height / 2),
    };
    rightClickTarget.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 2, clientX: contextPoint.x, clientY: contextPoint.y,
    }));
    rightClickTarget.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: contextPoint.x, clientY: contextPoint.y,
    }));
    rightClickTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true, button: 2, clientX: 40, clientY: 80,
    }));
    const contextMenuVisible = document.getElementById('browser-history-context-menu')
      ?.classList.contains('is-visible') === true;
    const contextTargetSelected = document.querySelector('[data-history-id="shared-browser"]')
      ?.classList.contains('is-selected') === true;
    getMain().dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, button: 0,
    }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    document.getElementById('refresh-browser-history').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      contextMenuVisible,
      contextTargetSelected,
      contextPoint,
      refreshAnimationName: getComputedStyle(
        document.querySelector('[data-history-id="shared-browser"]'),
      ).animationName,
      selectedBorderColor,
    };
  })()`);
  win.webContents.emit('context-menu', {}, browserHistoryInteractionResult.contextPoint);
  await new Promise((resolve) => setTimeout(resolve, 30));
  browserHistoryInteractionResult.contextMenuVisibleAfterMainRouting = await win.webContents.executeJavaScript(
    `document.getElementById('browser-history-context-menu')?.classList.contains('is-visible') === true`,
  );
  if (
    browserHistoryInteractionResult.contextMenuVisible !== true
    || browserHistoryInteractionResult.contextMenuVisibleAfterMainRouting !== true
    || browserHistoryInteractionResult.contextTargetSelected !== false
    || browserHistoryInteractionResult.refreshAnimationName !== 'none'
    || browserHistoryInteractionResult.selectedBorderColor === 'rgb(240, 68, 68)'
    || browserHistoryOpenRequests !== 1
  ) {
    throw new Error(`浏览器记录交互校验失败: ${JSON.stringify({
      ...browserHistoryInteractionResult,
      browserHistoryOpenRequests,
    })}`);
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
        && authForm.getAttribute('role') !== 'dialog'
        && dialog.querySelector('#sidebar-auth-username')?.spellcheck === false;
      const emptyStatusSpaceCollapsed = getComputedStyle(
        dialog.querySelector('#sidebar-auth-status'),
      ).display === 'none';
      const modeSwitch = dialog.querySelector('#sidebar-auth-mode-switch');
      const modeLabel = dialog.querySelector('#sidebar-auth-mode-label');
      modeSwitch?.click();
      const registerModeWorks = dialog.querySelector('#sidebar-auth-confirm-group')?.hidden === false
        && dialog.querySelector('#sidebar-auth-submit')?.textContent === '注册并登录'
        && modeLabel?.textContent === '去登录';
      modeSwitch?.click();
      const loginModeWorks = dialog.querySelector('#sidebar-auth-confirm-group')?.hidden === true
        && dialog.querySelector('#sidebar-auth-submit')?.textContent === '登录'
        && modeLabel?.textContent === '去注册'
        && dialog.querySelector('.sidebar-auth-mode-arrow')?.textContent === '→';
      document.getElementById('account-center-dialog-close').click();
      setTimeout(() => resolve({
        oldTabRemoved,
        opened,
        profileVisible,
        sameColumn,
        titleAndBackgroundRemoved,
        inlineAuthVisible,
        emptyStatusSpaceCollapsed,
        registerModeWorks,
        loginModeWorks,
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
  await win.loadFile(path.join(__dirname, '../../../src/app/sidebar/index.html'), {
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
  await win.loadFile(path.join(__dirname, '../../../src/app/views/app-shell.html'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  win.webContents.send('update-tabs', [{
    id: 'software-notepad',
    title: '记事本',
    runtimeType: 'external-app',
    runtimeStatus: 'ready',
    isActive: true,
  }]);
  win.webContents.send('ai-control-browser-selection-changed', {
    profileIds: [],
    softwareProfileId: 'software-notepad',
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const softwareParticleResult = await win.webContents.executeJavaScript(`(() => {
    const tab = document.querySelector('.tab[data-id="software-notepad"]');
    const layer = tab?.querySelector('.ai-browser-particle-layer');
    return {
      tabRendered: !!tab,
      aiConnected: tab?.classList.contains('ai-browser-connected') === true,
      particleLayerVisible: !!layer && getComputedStyle(layer).display === 'block',
      particlesCreated: layer?.childElementCount === 10,
    };
  })()`);
  if (Object.values(softwareParticleResult).some((value) => value !== true)) {
    throw new Error(`嵌入式软件 AI 粒子效果校验失败: ${JSON.stringify(softwareParticleResult)}`);
  }
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
  const workingSetMb = app.getAppMetrics().reduce((sum, metric) => (
    sum + Number((metric.memory && metric.memory.workingSetSize) || 0)
  ), 0) / 1024;
  const destroyStartedAt = process.hrtime.bigint();
  win.destroy();
  const destroyMs = Number(process.hrtime.bigint() - destroyStartedAt) / 1e6;
  console.log(`browser settings, standalone account popup and app-shell avatar UI checks passed (${result.rows} rows)`);
  console.log(`[performance-baseline] first-sidebar-ready=${firstSidebarReadyMs.toFixed(1)}ms working-set=${workingSetMb.toFixed(1)}MB window-destroy=${destroyMs.toFixed(1)}ms`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
