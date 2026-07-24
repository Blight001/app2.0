'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFrameDecoder,
  encodeMessage,
} = require('../../../scripts/run-cursor-host-prototype');

test('cursor prototype transport decodes fragmented length-prefixed messages', () => {
  const received = [];
  const decode = createFrameDecoder((message) => received.push(message));
  const first = encodeMessage({ type: 'READY', sessionId: 'one' });
  const second = encodeMessage({ type: 'PONG', requestId: '2' });
  const combined = Buffer.concat([first, second]);

  decode(combined.subarray(0, 3));
  decode(combined.subarray(3, 11));
  decode(combined.subarray(11));

  assert.deepEqual(received, [
    { type: 'READY', sessionId: 'one' },
    { type: 'PONG', requestId: '2' },
  ]);
});

test('cursor prototype transport rejects oversized messages', () => {
  assert.throws(
    () => encodeMessage({ value: 'x'.repeat(64 * 1024) }),
    /超过 64 KiB/,
  );
});
