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

async function resolveLatestMove(process) {
  await new Promise((resolve) => setImmediate(resolve));
  const move = process.client.sent.filter(
    (item) => item.type === 'MOVE_CURSOR',
  ).at(-1);
  process.client.emit('ARRIVED', {
    tabId: move.tabId,
    sequenceId: move.sequenceId,
  });
  return move;
}

test('targets keep coordinates in JS and activation explicitly shows the UI', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  await service.registerTarget(target('two', 1000));
  await service.activateTarget('one');
  const pending = service.moveAndWait('one', { x: 333, y: 222 }, {
    durationMs: 0,
  });
  await resolveLatestMove(process);
  await pending;
  await service.activateTarget('two');
  await service.activateTarget('one');

  assert.deepEqual(service.positions.get('one'), { x: 333, y: 222 });
  assert.deepEqual(process.client.sent.at(-1), {
    type: 'SHOW_CURSOR',
    sessionId: 'session',
    positionPhysical: { x: 333, y: 222 },
  });
  assert.equal(
    process.client.sent.some((item) => item.type === 'REGISTER_TARGET'),
    false,
  );
  await service.shutdown();
});

test('move API supports instant/smooth arrival and ignores stale events', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  const pending = service.moveAndWait(
    'one', { x: 400, y: 300 }, { durationMs: 75 },
  );
  await new Promise((resolve) => setImmediate(resolve));
  process.client.emit('ARRIVED', { tabId: 'one', sequenceId: 0 });
  process.client.emit('ARRIVED', { tabId: 'one', sequenceId: 1 });
  assert.deepEqual(await pending, {
    displayed: true,
    tabId: 'one',
    sequenceId: 1,
  });
  assert.equal(
    process.client.sent.find((item) => item.type === 'MOVE_CURSOR').durationMs,
    75,
  );
  await service.shutdown();
});

test('window lifecycle maps only to explicit hide and show commands', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  const mainWindow = new EventEmitter();
  await service.registerTarget(target('one', 10));
  await service.activateTarget('one');
  service.bindMainWindow(mainWindow);
  process.client.sent.length = 0;

  mainWindow.emit('blur');
  mainWindow.emit('focus');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    process.client.sent.map((item) => item.type),
    ['HIDE_CURSOR', 'SHOW_CURSOR'],
  );
  await service.shutdown();
});

test('moving a window translates only that window cursor state', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  await service.registerTarget(target('two', 1000));
  await service.activateTarget('one');
  const pending = service.moveAndWait('one', { x: 333, y: 222 }, {
    durationMs: 0,
  });
  await resolveLatestMove(process);
  await pending;
  process.client.sent.length = 0;

  await service.registerTarget({
    ...target('one', 110),
    rectPhysical: { x: 110, y: 70, width: 800, height: 600 },
  });

  assert.deepEqual(service.positions.get('one'), { x: 433, y: 272 });
  assert.deepEqual(service.positions.get('two'), { x: 1400, y: 320 });
  assert.deepEqual(process.client.sent.at(-1), {
    type: 'SHOW_CURSOR',
    sessionId: 'session',
    positionPhysical: { x: 433, y: 272 },
  });
  await service.shutdown();
});

test('window visibility and pressed state remain independent when switching', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  await service.registerTarget(target('two', 1000));
  await service.activateTarget('one');
  service.pointerDown('left');
  service.setTargetVisibility('one', false);
  await service.activateTarget('two');
  service.pointerDown('right');
  process.client.sent.length = 0;

  await service.activateTarget('one');
  assert.deepEqual(
    process.client.sent.map((item) => item.type),
    ['HIDE_CURSOR'],
  );
  service.setTargetVisibility('one', true);
  assert.deepEqual(
    process.client.sent.slice(-2).map((item) => [item.type, item.button]),
    [['SHOW_CURSOR', undefined], ['POINTER_DOWN', 'left']],
  );
  await service.shutdown();
});

test('left/right effects and drag have distinct API commands', async () => {
  const process = new FakeProcess();
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  await service.registerTarget(target('one', 10));
  service.feedback('one', 7, 'right');
  assert.equal(process.client.sent.at(-1).button, 'right');

  const drag = service.dragAndWait(
    'one', { x: 100, y: 100 }, { x: 300, y: 250 },
  );
  await resolveLatestMove(process);
  await resolveLatestMove(process);
  const result = await drag;
  assert.equal(result.displayed, true);
  assert.deepEqual(
    process.client.sent
      .filter((item) => item.type.startsWith('POINTER_'))
      .map((item) => item.type),
    ['POINTER_DOWN', 'POINTER_UP'],
  );
  await service.shutdown();
});

test('sidecar unavailability never rejects the real input path', async () => {
  const process = new FakeProcess();
  process.start = async () => { throw new Error('missing'); };
  const service = new CursorSidecarService({ process, logger: { warn() {} } });
  service.disabled = false;
  const result = await service.moveAndWait('one', { x: 1, y: 2 });
  assert.deepEqual(result, {
    displayed: false,
    reason: 'sidecar_unavailable',
  });
});
