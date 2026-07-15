const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { ChromiumRuntime } = require('../src/app/main/browser-runtime/chromium-runtime');
const { ChromiumWindowBridge } = require('../src/app/main/browser-runtime/chromium-window-bridge');
const { RUNTIME_STATUS } = require('../src/app/main/browser-runtime/runtime-types');

test('refocusing the app keeps Chromium above delayed Electron renderer reordering', async () => {
  const parentWindow = new EventEmitter();
  const calls = [];
  const runtime = new ChromiumRuntime({
    store: {
      getState: () => ({
        status: RUNTIME_STATUS.READY,
        hostHwnd: 'host-1',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    },
    windowBridge: {
      setHostBounds: () => calls.push('bounds'),
      raiseHostWindow: () => calls.push('raise'),
      showHostWindow: () => calls.push('show'),
    },
    logger: { warn() {} },
  });
  const instance = {
    parentWindow,
    parentFocusHandler: null,
    parentFocusRaiseTimers: new Set(),
  };

  runtime.bindParentWindowFocus('profile-1', instance);
  parentWindow.emit('focus');
  assert.deepEqual(calls, ['raise']);
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.deepEqual(calls, ['raise', 'raise', 'raise']);
  runtime.unbindParentWindowFocus(instance);
  assert.equal(instance.parentFocusRaiseTimers.size, 0);
});

test('an already loaded legacy native host skips focus repaint safely', () => {
  const bridge = new ChromiumWindowBridge({ binding: {} });
  assert.equal(bridge.raiseHostWindow('host-1'), true);
});

test('native host does not schedule or synchronously flush repeated focus paints', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../native/browser-host/src/browser_host_window.cc',
  ), 'utf8');

  assert.doesNotMatch(source, /ScheduleVisualSync|WM_TIMER|DwmFlush|RDW_UPDATENOW/);
  assert.match(source, /if \(ok && !was_visible\)/);
  assert.match(source, /RaiseHostWindow[\s\S]*SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE/);
});

test('native mouse input focuses Chromium before dispatching the original click', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../native/browser-host/src/mouse_click_monitor.cc',
  ), 'utf8');

  const focusCall = source.indexOf('FocusBrowserChildWindow(child);');
  const callbackCall = source.indexOf('napi_call_threadsafe_function(');
  assert.ok(focusCall >= 0, 'mouse hook must restore Chromium keyboard focus');
  assert.ok(callbackCall > focusCall, 'focus transfer must precede asynchronous click handling');
});
