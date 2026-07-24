'use strict';

const path = require('path');
const { app, BrowserWindow, screen } = require('electron');
const {
  createCursorSidecarService,
} = require('../src/app/main/features/cursor-sidecar/cursor-sidecar-service');

const projectRoot = path.resolve(__dirname, '..');
let window;
let service;

function nativeHandle(browserWindow) {
  const value = browserWindow.getNativeWindowHandle();
  return value.length >= 8
    ? value.readBigUInt64LE(0).toString()
    : String(value.readUInt32LE(0));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function register(tabId, rect, initialPosition) {
  const hwnd = nativeHandle(window);
  const registered = await service.registerTarget({
    tabId,
    targetHwnd: hwnd,
    ownerHwnd: hwnd,
    rectPhysical: rect,
    initialPosition,
  });
  if (!registered) throw new Error(`Sidecar 注册失败: ${tabId}`);
}

async function run() {
  const acceptanceTimeout = setTimeout(async () => {
    console.error('[cursor-sidecar-acceptance] 失败: 验收超过 180 秒');
    try { await service?.shutdown?.(); } catch (_) {}
    try { window?.destroy?.(); } catch (_) {}
    app.exit(1);
  }, 180000);
  window = new BrowserWindow({
    width: 520,
    height: 360,
    show: true,
    webPreferences: { sandbox: true },
  });
  window.loadURL('data:text/html,<body style="background:%23141b2d"></body>');
  window.show();
  window.focus();
  await wait(150);
  const rect = screen.dipToScreenRect(window, window.getBounds());
  const first = { x: rect.x + 80, y: rect.y + 90 };
  const second = { x: rect.x + rect.width - 80, y: rect.y + 110 };
  service = createCursorSidecarService({
    resourcesPath: path.join(projectRoot, 'resources'),
    workingDirectory: projectRoot,
    logger: console,
  });
  service.bindMainWindow(window);
  console.log('[cursor-sidecar-acceptance] 开始注册多栏目');
  await register('accept-one', rect, first);
  await register('accept-two', rect, second);
  await service.activateTarget('accept-one');
  console.log('[cursor-sidecar-acceptance] 开始可见动画与反馈');
  const arrival = await service.moveAndWait(
    'accept-one',
    { x: first.x + 40, y: first.y + 30 },
    { durationMs: 60 },
  );
  if (!arrival.displayed) throw new Error('Sidecar 未返回 ARRIVED');
  service.feedback('accept-one', arrival.sequenceId);
  await wait(300);
  await service.activateTarget('accept-two');
  await service.moveAndWait('accept-two', second, { durationMs: 30 });
  await wait(180);
  if (!service.positions.has('accept-one') ||
      !service.positions.has('accept-two')) {
    throw new Error('多栏目稳定坐标快照缺失');
  }
  console.log('[cursor-sidecar-acceptance] 多栏目坐标快照通过');
  window.hide();
  await wait(80);
  for (let index = 0; index < 1000; index += 1) {
    const result = await service.moveAndWait(
      'accept-two',
      { x: second.x + (index % 3), y: second.y },
      { durationMs: 0 },
    );
    if (!result.displayed) {
      throw new Error(`第 ${index + 1} 次 Sidecar 动作未到达`);
    }
    if ((index + 1) % 100 === 0) {
      console.log(`[cursor-sidecar-acceptance] 已完成 ${index + 1}/1000`);
    }
  }
  await service.shutdown();
  service = null;
  window.destroy();
  window = null;
  clearTimeout(acceptanceTimeout);
  console.log('[cursor-sidecar-acceptance] 多栏目、ANI、反馈和 1000 次动作通过');
  app.quit();
}

app.whenReady().then(run).catch(async (error) => {
  console.error('[cursor-sidecar-acceptance] 失败:', error);
  try { await service?.shutdown?.(); } catch (_) {}
  try { window?.destroy?.(); } catch (_) {}
  app.exit(1);
});
