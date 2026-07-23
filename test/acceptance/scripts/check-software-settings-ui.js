'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

let openedSoftwareId = '';

ipcMain.handle('list-available-software', () => ({
  ok: true,
  data: [{
    id: 'window-test',
    name: '现有窗口',
    description: '已打开窗口 · Test.exe',
    iconText: '现',
    experimental: true,
    running: true,
  }],
}));
ipcMain.handle('open-external-software', (_event, payload) => {
  openedSoftwareId = String(payload?.softwareId || '');
  return { ok: true, data: { tabId: 'software-notepad-test' } };
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '../../../src/app/main/preload.js'),
    },
  });
  await window.loadFile(path.join(__dirname, '../../../src/app/sidebar/index.html'));
  const result = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-tab="software-settings-panel"]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const card = document.querySelector('[data-software-id="window-test"]');
    const initialAction = card?.querySelector('.software-card-action')?.textContent || '';
    card?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      active: document.getElementById('software-settings-panel').classList.contains('active'),
      heading: document.querySelector('#software-settings-panel h2')?.textContent || '',
      cardName: card?.querySelector('.software-card-heading')?.textContent || '',
      action: card?.querySelector('.software-card-action')?.textContent || '',
      runningBadge: card?.querySelector('.software-card-badge')?.textContent || '',
      initialAction,
    };
  })()`);
  if (
    result.active !== true
    || result.heading !== '可嵌入的桌面窗口'
    || result.cardName !== '现有窗口已打开'
    || result.action !== '已打开'
    || result.runningBadge !== '已打开'
    || result.initialAction !== '嵌入'
    || openedSoftwareId !== 'window-test'
  ) {
    throw new Error(`软件配置栏目校验失败: ${JSON.stringify({ ...result, openedSoftwareId })}`);
  }
  console.log('[software-settings-ui] PASS');
  window.destroy();
  app.exit(0);
}).catch((error) => {
  console.error('[software-settings-ui] FAIL', error?.stack || error);
  app.exit(1);
});
