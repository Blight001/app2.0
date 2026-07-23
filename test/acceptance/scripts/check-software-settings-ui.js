'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

let openedSoftwareId = '';
let catalogLoads = 0;
const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

ipcMain.handle('list-available-software', () => {
  catalogLoads += 1;
  return { ok: true, data: [{
    id: 'window-test',
    name: '现有窗口',
    description: 'Test.exe',
    iconDataUrl,
    running: true,
  }, {
    id: 'window-long-name',
    name: 'v-start.bat - AI-FREE-app - Visual Studio Code',
    description: 'Code.exe',
    iconDataUrl,
    running: true,
  }] };
});
ipcMain.handle('open-external-software', (_event, payload) => {
  openedSoftwareId = String(payload?.softwareId || '');
  return { ok: true, data: { tabId: 'software-notepad-test' } };
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 428,
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
    const longCard = document.querySelector('[data-software-id="window-long-name"]');
    const longName = longCard?.querySelector('.software-card-name');
    const initialAction = card?.querySelector('.software-card-action')?.textContent || '';
    card?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      active: document.getElementById('software-settings-panel').classList.contains('active'),
      pickerTitle: document.getElementById('software-picker-title')?.textContent || '',
      refreshVisible: document.getElementById('refresh-software-catalog')?.offsetParent !== null,
      cardName: card?.querySelector('.software-card-name')?.textContent || '',
      iconIsImage: card?.querySelector('.software-card-icon img')?.src.startsWith('data:image/png') === true,
      openedLabelAbsent: !card?.textContent.includes('已打开'),
      longNameTitle: longName?.title || '',
      longCardContained: longCard
        ? longCard.scrollWidth <= longCard.clientWidth
        : false,
      initialAction,
    };
  })()`);
  window.webContents.send('update-tabs', [{ id: 'browser-after-software-close' }]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  if (
    result.active !== true
    || result.pickerTitle !== '选择嵌入的软件'
    || result.refreshVisible !== true
    || result.cardName !== '现有窗口'
    || result.iconIsImage !== true
    || result.openedLabelAbsent !== true
    || result.longNameTitle !== 'v-start.bat - AI-FREE-app - Visual Studio Code'
    || result.longCardContained !== true
    || result.initialAction !== '嵌入'
    || openedSoftwareId !== 'window-test'
    || catalogLoads < 2
  ) {
    throw new Error(`软件配置栏目校验失败: ${JSON.stringify({ ...result, openedSoftwareId, catalogLoads })}`);
  }
  console.log('[software-settings-ui] PASS');
  window.destroy();
  app.exit(0);
}).catch((error) => {
  console.error('[software-settings-ui] FAIL', error?.stack || error);
  app.exit(1);
});
