'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');
const { createBrowserRuntimeManager } = require('../../../src/app/main/browser-runtime');
const { ChromiumWindowBridge } = require('../../../src/app/main/browser-runtime/chromium-window-bridge');
const { createSoftwareCatalog } = require('../../../src/app/main/features/external-app/software-catalog');
const { createAiSoftwareUiTools } = require('../../../src/app/main/services/ai-software-ui-tools');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-external-app-'));
const executablePath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
let manager = null;
let window = null;
let launchedPid = 0;
const launchedPids = new Set();

async function waitForValue(read, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function cleanup(exitCode) {
  try { await manager?.stopAll(); } catch (_) {}
  for (const pid of launchedPids) {
    try { process.kill(pid); } catch (_) {}
  }
  try { if (window && !window.isDestroyed()) window.destroy(); } catch (_) {}
  try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch (_) {}
  app.exit(exitCode);
}

async function verifyOwnedPopupAutomation() {
  const scriptPath = path.join(testRoot, 'owned-popup.ps1');
  fs.writeFileSync(scriptPath, [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$form = New-Object System.Windows.Forms.Form',
    "$form.Text = 'AI-FREE Popup Owner'",
    '$form.Width = 500',
    '$form.Height = 360',
    '$timer = New-Object System.Windows.Forms.Timer',
    '$timer.Interval = 1500',
    '$timer.Add_Tick({',
    '  $timer.Stop()',
    "  [System.Windows.Forms.MessageBox]::Show($form, 'Choose an action', 'AI-FREE Modal', 'OKCancel') | Out-Null",
    '  $form.Close()',
    '})',
    '$form.Add_Shown({ $timer.Start() })',
    '[System.Windows.Forms.Application]::Run($form)',
  ].join('\r\n'));
  const popupProcess = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
  ], { windowsHide: true, stdio: 'ignore' });
  launchedPids.add(popupProcess.pid);
  const ownerHwnd = await waitForValue(
    () => manager.windowBridge.findMainWindowByProcessId(popupProcess.pid),
  );
  assert.ok(ownerHwnd, '应发现弹窗测试程序的主窗口');
  const state = await manager.launchProfile({
    profileId: 'external-popup-acceptance',
    runtimeType: 'external-app',
    softwareId: 'running-window',
    displayName: 'AI-FREE Popup Owner',
    existingWindowHwnd: ownerHwnd,
    existingWindowPid: popupProcess.pid,
  }, { x: 0, y: 0, width: 800, height: 560 });
  const tools = createAiSoftwareUiTools({
    windowBridge: manager.windowBridge,
    target: manager.externalApp.getAutomationTarget(state.profileId),
  });
  const observed = await waitForValue(async () => {
    try {
      const result = await tools.execute(
        'software_ui', { action: 'observe', mode: 'accessibility', limit: 40, max_depth: 6 },
      );
      return result.popup ? result : null;
    } catch (_) {
      return null;
    }
  }, 5000);
  assert.ok(observed?.popup, '软件模态弹窗应自动成为 UI Automation 根节点');
  const button = observed.items.find(
    (item) => item.type === 'button' && Number.isFinite(item.click_x),
  );
  assert.ok(button?.ref, '模态弹窗应暴露可点击按钮');
  const clicked = await tools.execute(
    'software_ui', { action: 'mouse_click', ref: button.ref, refresh: false },
  );
  assert.equal(clicked.method, 'mouse');
  assert.ok(
    await waitForValue(() => !manager.windowBridge.isWindowAlive(ownerHwnd)),
    '系统鼠标点击应关闭模态弹窗及测试程序',
  );
  await manager.stop(state.profileId, 'external-app');
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 900,
    height: 650,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  await window.loadURL('data:text/html,<title>External App Embed Acceptance</title>');
  const bindingPath = String(process.env.AI_FREE_BROWSER_HOST_BINDING || '').trim();
  const windowBridge = bindingPath
    ? new ChromiumWindowBridge({ bindingPath, logger: console })
    : undefined;
  manager = createBrowserRuntimeManager({
    userDataDir: testRoot,
    resourcesPath: process.resourcesPath,
    getParentWindow: () => window,
    logger: console,
    windowBridge,
  });
  try {
    const child = spawn(executablePath, [], {
      cwd: path.dirname(executablePath),
      windowsHide: false,
      stdio: 'ignore',
    });
    launchedPid = child.pid;
    launchedPids.add(launchedPid);
    const desktopHwnd = await waitForValue(
      () => manager.windowBridge.findMainWindowByProcessId(launchedPid),
    );
    assert.ok(desktopHwnd, '应检测到刚打开的记事本窗口');
    const originalPlacement = manager.windowBridge.getWindowPlacementSnapshot(desktopHwnd);
    assert.ok(originalPlacement, '应记录记事本停靠前的窗口状态');
    const discovered = await waitForValue(() => (
      manager.windowBridge.listVisibleTopLevelWindows()
        .find((entry) => entry.hwnd === desktopHwnd && entry.pid === launchedPid)
    ));
    assert.ok(discovered, '记事本应出现在桌面可见窗口列表');
    assert.equal(
      path.normalize(discovered.executablePath).toLowerCase(),
      path.normalize(executablePath).toLowerCase(),
    );
    const catalog = createSoftwareCatalog({
      listVisibleWindows: () => [discovered],
      resolveIconDataUrl: async (filePath) => {
        const icon = await app.getFileIcon(filePath, { size: 'normal' });
        return icon.isEmpty() ? '' : icon.toDataURL();
      },
    });
    const [software] = await catalog.listAvailable();
    assert.match(software.iconDataUrl, /^data:image\/png;base64,/);
    const state = await manager.launchProfile({
      profileId: 'external-app-acceptance',
      runtimeType: 'external-app',
      softwareId: 'running-window',
      displayName: discovered.title,
      existingWindowHwnd: discovered.hwnd,
      existingWindowPid: discovered.pid,
    }, { x: 0, y: 0, width: 800, height: 560 });
    assert.equal(state.status, 'ready');
    assert.equal(state.embedded, true);
    assert.equal(state.docked, true);
    assert.equal(
      manager.windowBridge.isExternalWindowDocked(
        window.getNativeWindowHandle(),
        state.browserHwnd,
      ),
      true,
    );
    const uiTools = createAiSoftwareUiTools({
      windowBridge: manager.windowBridge,
      target: manager.externalApp.getAutomationTarget('external-app-acceptance'),
    });
    const observed = await uiTools.execute('software_ui', {
      action: 'observe',
      mode: 'accessibility',
      limit: 80,
      max_depth: 10,
    });
    assert.equal(observed.success, true);
    assert.ok(observed.items.length > 0 && observed.items.length <= 80);
    const editable = observed.items.find(
      (item) => Array.isArray(item.actions) && item.actions.includes('set_value'),
    );
    assert.ok(editable?.ref, 'UI Automation 应发现记事本的可写控件');
    const typed = await uiTools.execute('software_ui', {
      action: 'type',
      ref: editable.ref,
      text: 'AI-FREE UI Automation acceptance',
      refresh: false,
    });
    assert.equal(typed.success, true);
    const observedAfterType = await uiTools.execute('software_ui', {
      action: 'observe',
      mode: 'accessibility',
      limit: 80,
      max_depth: 10,
    });
    assert.ok(
      observedAfterType.items.some(
        (item) => String(item.value || '').includes('AI-FREE UI Automation acceptance'),
      ),
      'UI Automation 写入结果应能被后续 observe 读取',
    );
    const visual = await uiTools.execute('software_ui', { action: 'screenshot' });
    assert.match(visual.dataUrl, /^data:image\/png;base64,/);
    assert.ok(visual.width > 0 && visual.height > 0);
    assert.equal(visual.observation_mode, 'visual');
    const visualX = Math.round(
      (editable.x + editable.width / 2 - visual.originX)
      * visual.width / visual.sourceWidth,
    );
    const visualY = Math.round(
      (editable.y + editable.height / 2 - visual.originY)
      * visual.height / visual.sourceHeight,
    );
    const clickedVisual = await uiTools.execute('software_ui', {
      action: 'click',
      observation_id: visual.observation_id,
      x: visualX,
      y: visualY,
    });
    assert.equal(clickedVisual.action_result.method, 'mouse');
    const typedVisual = await uiTools.execute('software_ui', {
      action: 'type',
      observation_id: clickedVisual.observation_id,
      text: ' visual-input',
      refresh: false,
    });
    assert.equal(typedVisual.method, 'keyboard');
    const observedAfterVisualInput = await uiTools.execute('software_ui', {
      action: 'observe',
      mode: 'accessibility',
      limit: 80,
      max_depth: 10,
    });
    assert.ok(
      observedAfterVisualInput.items.some(
        (item) => String(item.value || '').includes('visual-input'),
      ),
      '截图坐标点击和 SendInput 文字输入应形成可验证闭环',
    );
    const dockedPlacement = manager.windowBridge.getWindowPlacementSnapshot(state.browserHwnd);
    const [windowX, windowY] = window.getPosition();
    window.setPosition(windowX + 70, windowY + 45);
    const followedPlacement = await waitForValue(() => {
      const placement = manager.windowBridge.getWindowPlacementSnapshot(state.browserHwnd);
      return placement
        && Math.abs(placement.x - dockedPlacement.x - 70) <= 2
        && Math.abs(placement.y - dockedPlacement.y - 45) <= 2
        ? placement
        : null;
    }, 5000);
    assert.ok(followedPlacement, '移动 AI-FREE 后软件窗口应自动对齐跟随');
    const inspectMs = Math.max(0, Number(process.env.AI_FREE_EXTERNAL_APP_INSPECT_MS) || 0);
    if (inspectMs) await new Promise((resolve) => setTimeout(resolve, inspectMs));
    const stopped = await manager.stop('external-app-acceptance', 'external-app');
    assert.equal(stopped.status, 'stopped');
    const restoredPlacement = await waitForValue(
      () => {
        const placement = manager.windowBridge.getWindowPlacementSnapshot(state.browserHwnd);
        return placement
          && placement.x === originalPlacement.x
          && placement.y === originalPlacement.y
          && placement.width === originalPlacement.width
          && placement.height === originalPlacement.height
          ? placement
          : null;
      },
      5000,
    );
    assert.ok(manager.windowBridge.isWindowAlive(state.browserHwnd), '关闭栏目后软件应继续运行');
    assert.ok(restoredPlacement, '关闭栏目后应恢复软件原始位置和尺寸');
    assert.equal(restoredPlacement.minimized, originalPlacement.minimized);
    assert.equal(restoredPlacement.maximized, originalPlacement.maximized);
    assert.equal(restoredPlacement.visible, originalPlacement.visible);
    await verifyOwnedPopupAutomation();
    console.log('[external-app-embed] PASS');
    await cleanup(0);
  } catch (error) {
    console.error('[external-app-embed] FAIL', error?.stack || error);
    await cleanup(1);
  }
}).catch(async (error) => {
  console.error('[external-app-embed] BOOT FAIL', error?.stack || error);
  await cleanup(1);
});
