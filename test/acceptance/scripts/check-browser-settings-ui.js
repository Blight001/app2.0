const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { attachContextMenu } = require('../../../src/app/main/utils/removeWatermark');
const performanceProbeStartedAt = process.hrtime.bigint();

let browserHistoryOpenRequests = 0;
let homeSwitchRequests = 0;
let independentBrowserCreateRequests = 0;
let accountSessionRequests = 0;
let accountCenterRequests = 0;
let browserSettingsPageVisible = null;
let windowCloseBehavior = 'ask';
const automationOperations = [];
ipcMain.handle('open-browser-history', (_event, payload = {}) => {
  browserHistoryOpenRequests += 1;
  return { ok: true, historyId: payload.historyId, name: '平台 A' };
});
ipcMain.on('switch-tab', (_event, tabId) => {
  if (tabId === null) homeSwitchRequests += 1;
});
ipcMain.on('set-browser-settings-page-visible', (_event, visible) => {
  browserSettingsPageVisible = visible === true;
});
ipcMain.handle('create-independent-browser', () => {
  independentBrowserCreateRequests += 1;
  return { ok: true, pending: false, tabId: 'acceptance-browser', historyId: 'acceptance-history' };
});
ipcMain.handle('account-get-session', () => {
  accountSessionRequests += 1;
  return { authenticated: false };
});
ipcMain.on('request-account-center', () => { accountCenterRequests += 1; });
ipcMain.handle('get-window-close-behavior', () => ({ ok: true, data: { behavior: windowCloseBehavior } }));
ipcMain.handle('set-window-close-behavior', (_event, payload = {}) => {
  windowCloseBehavior = String(payload.behavior || '');
  return { ok: true, data: { behavior: windowCloseBehavior } };
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
ipcMain.handle('ai-control-manage-automation-card', (_event, input = {}) => {
  automationOperations.push(input);
  if (input.action === 'write') {
    const item = { id: input.id || 'acceptance-card', cardName: input.cardData?.name, cardData: input.cardData, updatedAt: Date.now() };
    return { ok: true, data: { success: true, item, state: { selectedId: item.id, items: [item] } } };
  }
  return { ok: true, data: { success: true, selectedId: '', items: [] } };
});
for (const [channel, response] of /** @type {Array<[string, any]>} */ ([
  ['get-extension-manager-state', { ok: true, extensions: [] }],
  ['get-clash-mini-status', { running: false }],
  ['get-user-credentials', { ok: true, credentials: {} }],
  ['get-all-accounts', []],
  ['get-target-url', 'https://www.baidu.com/'],
  ['get-platform-name', 'AI-FREE'],
  ['get-wool-platforms', [{ name: 'AI-FREE', targetUrl: 'https://www.baidu.com/' }]],
  ['refresh-wool-platforms', { ok: true, platforms: [] }],
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
      lastOpenedAt: 1_900_000_000_000,
    }],
  }],
  ['get-proxy-traffic-quota', { ok: false }],
  ['ai-control-get-browser-connections', { ok: true, connections: [] }],
  ['ai-control-get-automation-cards', { ok: true, cards: [], selectedId: '' }],
  ['ai-control-history-list', { ok: true, sessions: [] }],
  ['ai-control-get-models', { ok: true, models: [], quota: null }],
  ['get-ai-server-device-status', {
    ok: true,
    status: {
      phase: 'idle', server: 'http://49.234.181.190:3000', account: '',
      serviceName: 'AI-FREE', connected: false, registered: false,
      serviceId: '', toolCount: 0, aiConfigId: null, message: '尚未连接 AI 服务器',
    },
  }],
  ['focus-sidebar-input', { ok: true }],
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
  await win.loadFile(path.join(__dirname, '../../../src/app/sidebar/index.html'), {
    query: { page: 'browser-settings' },
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const firstSidebarReadyMs = Number(process.hrtime.bigint() - performanceProbeStartedAt) / 1e6;
  const result = await win.webContents.executeJavaScript(`(async () => {
    const initialDefault = {
      settingsActive: document.getElementById('ai-free-settings-panel')?.classList.contains('active') === true,
      settingsTabRemoved: !document.querySelector('[data-tab="ai-free-settings-panel"]'),
      aiPanelRemoved: !document.getElementById('ai-control-panel'),
    };
    const navButtons = Array.from(document.querySelectorAll('.tab-nav .tab-button'));
    const navTops = navButtons.map((button) => Math.round(button.getBoundingClientRect().top));
    document.getElementById('browser-settings-create-browser')?.click();
    await window.redirectToSidebarAccountLogin?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const panel = document.getElementById('ai-free-settings-panel');
    const labels = Array.from(panel.querySelectorAll('.vb-label')).map((item) => item.textContent.trim());
    const animationProbe = buildVpnNodeSelectorButton('动画测试节点', 0, { delay: null }, '');
    document.getElementById('vpn-node-selector-grid')?.appendChild(animationProbe);
    const nodeAnimationName = getComputedStyle(animationProbe).animationName;
    animationProbe.remove();
    const initialCanvasNodeCount = document.querySelectorAll('.automation-flow-node').length;
    document.querySelector('[data-canvas-add="condition"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const conditionNode = Array.from(document.querySelectorAll('.automation-flow-node')).at(-1);
    conditionNode?.click();
    const nodeName = document.querySelector('[data-node-field="name"]');
    nodeName.value = '验收判断节点';
    nodeName.dispatchEvent(new Event('change', { bubbles: true }));
    const falsePort = conditionNode?.querySelector('.automation-flow-port.is-false');
    const firstInput = document.querySelector('.automation-flow-node .automation-flow-port.is-input');
    const sourceBounds = falsePort?.getBoundingClientRect();
    const targetBounds = firstInput?.getBoundingClientRect();
    falsePort?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: sourceBounds?.x || 0, clientY: sourceBounds?.y || 0,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0,
      clientX: (targetBounds?.left || 0) + (targetBounds?.width || 0) / 2,
      clientY: (targetBounds?.top || 0) + (targetBounds?.height || 0) / 2,
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.getElementById('automation-card-name').value = '画布验收卡片';
    document.getElementById('automation-editor').requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const canvasSteps = JSON.parse(document.getElementById('automation-card-steps').value || '[]');
    return {
      active: panel.classList.contains('active'),
      dedicatedSettingsPage: document.documentElement.classList.contains('browser-settings-page'),
      sidebarNavigationRemoved: !document.querySelector('.tab-nav'),
      configHomeLogoVisible: !!document.querySelector('.browser-settings-home img[data-app-logo]')?.src,
      configHomeCreateVisible: document.getElementById('browser-settings-create-browser')
        ?.getBoundingClientRect().width > 0,
      nodeToggleRemoved: !document.getElementById('vpn-node-selector-toggle-btn'),
      nodePanelVisible: document.getElementById('vpn-node-selector-panel')?.hidden === false,
      nodePanelStatic: getComputedStyle(document.getElementById('vpn-node-selector-panel')).position === 'relative',
      allNodesExpanded: getComputedStyle(document.getElementById('vpn-node-selector-grid')).maxHeight === 'none'
        && getComputedStyle(document.getElementById('vpn-node-selector-grid')).overflow === 'visible',
      nodeAnimationDisabled: nodeAnimationName === 'none',
      initialDefault,
      navRemoved: navTops.length === 0,
      accountCenterRemoved: !document.getElementById('account-center-panel'),
      standaloneLoginRemoved: !document.getElementById('sidebar-account-auth')
        && !document.getElementById('account-profile-name'),
      rows: panel.querySelectorAll('.vb-row').length,
      labels,
      browserHistoryVisible: !!document.getElementById('browser-history-list'),
      browserHistoryText: document.getElementById('browser-history-list')?.textContent || '',
      browserHistoryMaxHeight: parseFloat(
        getComputedStyle(document.getElementById('browser-history-list')).maxHeight,
      ),
      browserConfigTabRemoved: !document.querySelector('[data-tab="ai-free-settings-panel"]'),
      languageIpControlRemoved: !document.getElementById('language-by-ip'),
      localeInputVisible: document.getElementById('browser-locale')?.hidden === false,
      localePlaceholder: document.getElementById('browser-locale')?.placeholder || '',
      accountHistoryRemoved: !document.getElementById('account-history-toggle-btn') && !document.getElementById('account-panel'),
      automationPluginSectionRemoved: !document.getElementById('extension-plugin-list')
        && !document.getElementById('import-extension-plugin'),
      automationWorkbenchVisible: document.getElementById('automation-workbench')
        ?.getBoundingClientRect().width > 0,
      automationWorkbenchBelowHome: document.getElementById('automation-workbench')
        ?.getBoundingClientRect().top > document.querySelector('.browser-settings-home')?.getBoundingClientRect().bottom,
      automationUsesNativeCopy: document.getElementById('automation-workbench')
        ?.textContent.includes('原生 Chromium 控制') === true,
      canvasVisible: document.getElementById('automation-flow-canvas')?.getBoundingClientRect().height >= 400,
      canvasAddedNode: initialCanvasNodeCount === 1 && document.querySelectorAll('.automation-flow-node').length === 2,
      canvasConditionPorts: conditionNode?.querySelectorAll('.automation-flow-port.is-true, .automation-flow-port.is-false').length === 2,
      canvasEdgeVisible: document.querySelectorAll('.automation-flow-edge').length >= 1,
      canvasManualBranch: Array.from(document.querySelectorAll('.automation-flow-edge-label'))
        .some((label) => label.textContent === 'false'),
      canvasInspectorEdited: canvasSteps.some((step) => step.name === '验收判断节点' && step.type === 'condition'),
      removedNetworkHeading: !document.getElementById('network-tools-title') && !panel.querySelector('.settings-network-tools-hint'),
      overflowY: getComputedStyle(document.querySelector('.main-wrapper')).overflowY,
    };
  })()`);
  if (process.env.AI_FREE_BROWSER_SETTINGS_UI_CAPTURE) {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(process.env.AI_FREE_BROWSER_SETTINGS_UI_CAPTURE, image.toPNG());
  }
  const required = ['操作系统', '代理设置', 'User Agent', 'WebRTC', 'Canvas', 'WebGL 图像', 'AudioContext', 'CPU', 'MAC 地址', '端口扫描保护', '启动参数'];
  if (
    !result.active
    || !result.dedicatedSettingsPage
    || !result.sidebarNavigationRemoved
    || !result.configHomeLogoVisible
    || !result.configHomeCreateVisible
    || !result.automationWorkbenchVisible
    || !result.automationWorkbenchBelowHome
    || !result.automationUsesNativeCopy
    || !result.canvasVisible
    || !result.canvasAddedNode
    || !result.canvasConditionPorts
    || !result.canvasEdgeVisible
    || !result.canvasManualBranch
    || !result.canvasInspectorEdited
    || !result.nodeToggleRemoved
    || !result.nodePanelVisible
    || !result.nodePanelStatic
    || !result.allNodesExpanded
    || !result.nodeAnimationDisabled
    || Object.values(result.initialDefault).some((value) => value !== true)
    || !result.navRemoved
    || !result.accountCenterRemoved
    || !result.standaloneLoginRemoved
    || !result.browserHistoryVisible
    || result.browserHistoryMaxHeight <= 238
    || !result.browserConfigTabRemoved
    || !result.languageIpControlRemoved
    || !result.localeInputVisible
    || !result.localePlaceholder.includes('留空跟随系统')
    || !result.browserHistoryText.includes('账号123456')
    || !result.browserHistoryText.includes('循环账号')
    || !result.browserHistoryText.includes('自动删除：')
    || !result.accountHistoryRemoved
    || !result.automationPluginSectionRemoved
    || !result.removedNetworkHeading
    || result.rows < 30
    || required.some((label) => !result.labels.includes(label))
  ) {
    throw new Error(`AI-FREE 参数面板校验失败: ${JSON.stringify(result)}`);
  }
  if (independentBrowserCreateRequests !== 1) {
    throw new Error('浏览器配置首页的新建按钮未创建浏览器');
  }
  if (accountSessionRequests !== 1) {
    throw new Error(`浏览器配置首页仅应在登录门禁触发时读取账号会话，实际请求 ${accountSessionRequests} 次`);
  }
  if (accountCenterRequests !== 1) {
    throw new Error(`未登录操作应请求侧边栏个人中心，实际请求 ${accountCenterRequests} 次`);
  }
  const savedCanvas = automationOperations.find((input) => input.action === 'write')?.cardData;
  if (!savedCanvas?.flow?.nodes?.length || !savedCanvas.flow.edges?.some((edge) => edge.label === 'false')) {
    throw new Error('流程画布没有通过软件 IPC 保存 nodes/edges 数据');
  }
  const browserHistoryInteractionResult = await win.webContents.executeJavaScript(`(async () => {
    const getMain = () => document.querySelector('[data-history-id="shared-browser"] .browser-history-main');
    const initialMain = getMain();
    initialMain.click();
    const selectedRow = document.querySelector('[data-history-id="shared-browser"]');
    const selectedBorderColor = getComputedStyle(selectedRow).borderColor;
    const selectedAnimationName = getComputedStyle(selectedRow).animationName;
    const selectedName = selectedRow.querySelector('.browser-history-name');
    const selectedNameTransitionProperty = getComputedStyle(selectedName).transitionProperty;
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
      selectedAnimationName,
      selectedNameTransitionProperty,
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
    || browserHistoryInteractionResult.selectedAnimationName !== 'none'
    || browserHistoryInteractionResult.selectedNameTransitionProperty.split(', ')
      .includes('transform')
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
  await win.loadFile(path.join(__dirname, '../../../src/app/sidebar/index.html'));
  await new Promise((resolve) => setTimeout(resolve, 120));
  const aiLoginTriggerResult = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const input = document.getElementById('ai-chat-input');
    input.value = '测试未登录发送';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('ai-chat-form').requestSubmit();
    window.openAccountCenterPanel();
    setTimeout(() => resolve({
      accountPanelActive: document.getElementById('account-center-panel').classList.contains('active'),
      authFormVisible: document.getElementById('sidebar-account-auth').hidden === false,
      authFormEmbedded: document.getElementById('sidebar-account-auth').parentElement
        === document.getElementById('sidebar-account-session'),
    }), 80);
  })`);
  if (
    aiLoginTriggerResult.accountPanelActive !== true
    || aiLoginTriggerResult.authFormVisible !== true
    || aiLoginTriggerResult.authFormEmbedded !== true
  ) {
    throw new Error(`AI 未登录切换个人中心栏目校验失败: ${JSON.stringify(aiLoginTriggerResult)}`);
  }
  const accountCenterResult = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const panel = document.getElementById('account-center-panel');
    document.querySelector('[data-tab="account-center-panel"]')?.click();
    setTimeout(async () => {
      const active = panel.classList.contains('active')
        && document.querySelector('[data-tab="account-center-panel"]')?.classList.contains('active');
      const profileVisible = !!panel.querySelector('#sidebar-account-session')
        && !!panel.querySelector('#announcement-bar')
        && !!panel.querySelector('.personal-footer');
      const accountCard = panel.querySelector('#sidebar-account-session');
      const sameColumn = panel.querySelector('#announcement-bar')?.parentElement === accountCard
        && panel.querySelector('.personal-footer')?.parentElement === accountCard;
      const dialogShellRemoved = !document.getElementById('account-center-dialog')
        && !document.querySelector('.account-center-dialog-backdrop')
        && !document.querySelector('.account-center-dialog-panel');
      const authForm = panel.querySelector('#sidebar-account-auth');
      const inlineAuthVisible = authForm?.hidden === false
        && authForm.parentElement === accountCard
        && !authForm.hasAttribute('aria-modal')
        && authForm.getAttribute('role') !== 'dialog'
        && panel.querySelector('#sidebar-auth-username')?.spellcheck === false;
      const emptyStatusSpaceCollapsed = getComputedStyle(
        panel.querySelector('#sidebar-auth-status'),
      ).display === 'none';
      const modeSwitch = panel.querySelector('#sidebar-auth-mode-switch');
      const modeLabel = panel.querySelector('#sidebar-auth-mode-label');
      modeSwitch?.click();
      const registerModeWorks = panel.querySelector('#sidebar-auth-confirm-group')?.hidden === false
        && panel.querySelector('#sidebar-auth-submit')?.textContent === '注册并登录'
        && modeLabel?.textContent === '去登录';
      modeSwitch?.click();
      const loginModeWorks = panel.querySelector('#sidebar-auth-confirm-group')?.hidden === true
        && panel.querySelector('#sidebar-auth-submit')?.textContent === '登录'
        && modeLabel?.textContent === '去注册'
        && panel.querySelector('.sidebar-auth-mode-arrow')?.textContent === '→';
      const closeBehaviorAsk = panel.querySelector('input[name="window-close-behavior"][value="ask"]');
      const closeBehaviorHide = panel.querySelector('input[name="window-close-behavior"][value="hide"]');
      const closeBehaviorLoaded = closeBehaviorAsk?.checked === true;
      const nativeSelectRemoved = !panel.querySelector('select#window-close-behavior');
      closeBehaviorHide.click();
      await new Promise((done) => setTimeout(done, 30));
      const persistedCloseBehavior = await window.aiFree?.ui?.getWindowCloseBehavior?.();
      const closeBehaviorSaved = closeBehaviorHide.checked === true
        && panel.querySelector('#window-close-behavior-status')?.textContent === '已保存';
      const closeBehaviorPersisted = persistedCloseBehavior?.ok === true
        && persistedCloseBehavior.data?.behavior === 'hide';
      resolve({
        active,
        profileVisible,
        sameColumn,
        dialogShellRemoved,
        inlineAuthVisible,
        emptyStatusSpaceCollapsed,
        registerModeWorks,
        loginModeWorks,
        closeBehaviorLoaded,
        nativeSelectRemoved,
        closeBehaviorSaved,
        closeBehaviorPersisted,
      });
    }, 30);
  })`);
  if (Object.values(accountCenterResult).some((value) => value !== true)) {
    throw new Error(`个人中心侧边栏栏目校验失败: ${JSON.stringify(accountCenterResult)}`);
  }
  if (process.env.AI_FREE_UI_CAPTURE) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(process.env.AI_FREE_UI_CAPTURE, image.toPNG());
  }
  if (process.env.AI_FREE_ACCOUNT_UI_CAPTURE) {
    win.setSize(430, 720);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(process.env.AI_FREE_ACCOUNT_UI_CAPTURE, image.toPNG());
    win.setSize(805, 1200);
  }
  homeSwitchRequests = 0;
  independentBrowserCreateRequests = 0;
  await win.loadFile(path.join(__dirname, '../../../src/app/views/app-shell.html'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const shellAccountResult = await win.webContents.executeJavaScript(`(async () => {
    const updateWidget = document.getElementById('update-widget');
    const theme = document.getElementById('theme-toggle-btn');
    const gear = document.getElementById('add-tab-btn');
    const createButton = document.getElementById('new-browser-window-btn');
    const homeCreateButton = document.getElementById('shell-home-create-browser');
    const wasLight = document.documentElement.classList.contains('theme-light');
    theme?.click();
    createButton?.click();
    homeCreateButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      controlsOrdered: updateWidget?.nextElementSibling === theme && theme?.nextElementSibling === gear,
      avatarRemoved: !document.getElementById('account-center-btn'),
      themeToggled: document.documentElement.classList.contains('theme-light') !== wasLight,
      modernGearIcon: !!gear?.querySelector('svg.settings-icon') && !gear.textContent.includes('⚙'),
      modernCreateIcon: !!createButton?.querySelector('svg.new-window-icon') && createButton.textContent.trim() === '',
      homeVisible: document.getElementById('browser-empty-state')?.hidden === false,
      homeLogoVisible: !!document.querySelector('#browser-empty-state img[data-app-logo]'),
      recentBrowserVisible: document.getElementById('shell-home-recent-list')?.textContent.includes('平台 A') === true,
      prominentHomeCreateButton: getComputedStyle(homeCreateButton).display === 'inline-flex',
    };
  })()`);
  shellAccountResult.topPlusOpenedHome = homeSwitchRequests === 1;
  shellAccountResult.homeCreateRequestedBrowser = independentBrowserCreateRequests === 1;
  shellAccountResult.settingsPageVisibleByDefault = browserSettingsPageVisible === true;
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (Object.values(shellAccountResult).some((value) => value !== true)) {
    throw new Error(`主窗口内置首页与控件校验失败: ${JSON.stringify(shellAccountResult)}`);
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
  console.log(`browser settings, sidebar account center and app-shell controls UI checks passed (${result.rows} rows)`);
  console.log(`[performance-baseline] first-sidebar-ready=${firstSidebarReadyMs.toFixed(1)}ms working-set=${workingSetMb.toFixed(1)}MB window-destroy=${destroyMs.toFixed(1)}ms`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
