'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatRunRegistry } = require('../../../src/app/main/features/ai-chat/chat-run-registry');

test('停止只影响同一渲染进程和 requestId，连续停止保持幂等', () => {
  const registry = createChatRunRegistry();
  const firstEvent = { sender: { id: 1 } };
  const otherEvent = { sender: { id: 2 } };
  const first = registry.begin(firstEvent, 'request');
  const other = registry.begin(otherEvent, 'request');
  assert.deepEqual(registry.stop(firstEvent, 'request'), { ok: true, stopped: true });
  assert.equal(first.run.controller.signal.aborted, true);
  assert.equal(other.run.controller.signal.aborted, false);
  registry.finish(first.key, first.run);
  assert.deepEqual(registry.stop(firstEvent, 'request'), { ok: true, stopped: false });
});

test('相同 requestId 的新运行会中止旧运行，旧运行迟到清理不会删除新运行', () => {
  const registry = createChatRunRegistry();
  const event = { sender: { id: 7 } };
  const oldRun = registry.begin(event, 'same');
  const currentRun = registry.begin(event, 'same');
  assert.equal(oldRun.run.controller.signal.aborted, true);
  registry.finish(oldRun.key, oldRun.run);
  assert.equal(registry.get(event, 'same'), currentRun.run);
  assert.deepEqual(registry.insert(event, 'same', '继续'), { ok: true, queued: 1 });
});

test('工作域 dispose 只批量取消本 registry 的运行', () => {
  const browser = createChatRunRegistry({ domain: 'browser' });
  const software = createChatRunRegistry({ domain: 'software' });
  const event = { sender: { id: 7 } };
  const browserRun = browser.begin(event, 'same');
  const softwareRun = software.begin(event, 'same');

  assert.equal(browser.cancelAll(), 1);
  assert.equal(browserRun.run.controller.signal.aborted, true);
  assert.equal(softwareRun.run.controller.signal.aborted, false);
  assert.equal(browser.get(event, 'same'), undefined);
});
