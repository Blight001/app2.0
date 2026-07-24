'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  CursorSidecarService,
} = require('../../../src/app/main/features/cursor-sidecar/cursor-sidecar-service');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.sessionId = 'session';
    this.sent = [];
  }

  send(message) { this.sent.push(message); }
}

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.client = new FakeClient();
    this.stopped = false;
  }

  async start() { return this.client; }
  async stop() { this.stopped = true; }
}

function target(tabId, x) {
  return {
    tabId,
    targetHwnd: '100',
    ownerHwnd: '200',
    rectPhysical: { x, y: 20, width: 800, height: 600 },
  };
}

test('cursor sidecar keeps independent targets and restores active coordinates', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  await service.registerTarget(target('two', 1000));
  await service.activateTarget('one');
  process.client.emit('POSITION_SNAPSHOT', {
    tabId: 'one',
    positionPhysical: { x: 333, y: 222 },
  });
  await service.activateTarget('two');
  await service.activateTarget('one');

  const registrations = process.client.sent.filter((item) => item.type === 'REGISTER_TARGET');
  assert.equal(registrations.length, 5);
  assert.deepEqual(service.positions.get('one'), { x: 333, y: 222 });
  assert.deepEqual(registrations.at(-1).initialPosition, { x: 333, y: 222 });
  assert.equal(process.client.sent.at(-1).tabId, 'one');
  await service.shutdown();
  assert.equal(process.stopped, true);
});

test('moveAndWait resolves ARRIVED and ignores stale sequence events', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  await service.activateTarget('one');
  const pending = service.moveAndWait('one', { x: 400, y: 300 }, { durationMs: 20 });
  await Promise.resolve();
  process.client.emit('ARRIVED', { tabId: 'one', sequenceId: 0 });
  process.client.emit('ARRIVED', { tabId: 'one', sequenceId: 1 });
  assert.deepEqual(await pending, {
    displayed: true,
    tabId: 'one',
    sequenceId: 1,
  });
  await service.shutdown();
});

test('sidecar unavailability never rejects the real input path', async () => {
  const process = new FakeProcess();
  process.start = async () => { throw new Error('missing'); };
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  service.disabled = false;
  const result = await service.moveAndWait('one', { x: 1, y: 2 });
  assert.deepEqual(result, { displayed: false, reason: 'sidecar_unavailable' });
});
