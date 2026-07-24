'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  ExternalAppAutomationClient,
} = require('../../../src/app/main/browser-runtime/external-app-automation-client');
const {
  ChromiumWindowBridge,
} = require('../../../src/app/main/browser-runtime/chromium-window-bridge');

class FakeWorker extends EventEmitter {
  constructor(_path, options) {
    super();
    this.options = options;
    this.messages = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
    queueMicrotask(() => {
      this.emit('message', {
        id: message.id,
        result: { success: true, method: message.method },
      });
    });
  }

  unref() {}

  async terminate() {
    this.terminated = true;
    return 0;
  }
}

test('软件自动化客户端在独立 worker 中串行返回原生结果', async () => {
  const client = new ExternalAppAutomationClient({
    bindingPath: 'C:/native/browser_host.node',
    workerPath: 'C:/worker.js',
    Worker: FakeWorker,
  });
  const result = await client.execute(
    'observeExternalWindowUi', { childHwnd: '100' },
  );
  assert.deepEqual(result, {
    success: true,
    method: 'observeExternalWindowUi',
  });
  assert.equal(client.worker.options.workerData.bindingPath, 'C:/native/browser_host.node');
  assert.deepEqual(client.worker.messages[0].options, { childHwnd: '100' });
  const worker = client.worker;
  await client.dispose();
  assert.equal(worker.terminated, true);
});

test('软件自动化 worker 错误会拒绝全部等待中的调用', async () => {
  class FailingWorker extends FakeWorker {
    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => this.emit('error', new Error('worker failed')));
    }
  }
  const client = new ExternalAppAutomationClient({
    bindingPath: 'C:/native/browser_host.node',
    Worker: FailingWorker,
  });
  await assert.rejects(
    client.execute('captureExternalWindow', {}),
    /worker failed/,
  );
  assert.equal(client.pending.size, 0);
});

test('软件自动化动作不注入鼠标显示资源', async () => {
  const calls = [];
  const bridge = new ChromiumWindowBridge({
    binding: {},
    automationClient: {
      execute: async (method, options) => {
        calls.push({ method, options });
        return { success: true };
      },
    },
  });
  await bridge.performExternalWindowUiActionAsync({ action: 'click', x: 10, y: 20 });
  assert.equal(calls[0].method, 'performExternalWindowUiAction');
  assert.equal(calls[0].options.cursorPath, undefined);
});
