'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isProcessAlive,
} = require('../../../src/app/main/browser-runtime/chromium-runtime-process');

test('PID 存活探测只把 ESRCH 视为进程已经退出', () => {
  assert.equal(isProcessAlive(123, { kill() {} }), true);
  assert.equal(isProcessAlive(123, {
    kill() {
      const error = new Error('missing');
      error.code = 'ESRCH';
      throw error;
    },
  }), false);
  assert.equal(isProcessAlive(123, {
    kill() {
      const error = new Error('denied');
      error.code = 'EPERM';
      throw error;
    },
  }), true);
  assert.equal(isProcessAlive(0, { kill() {} }), false);
});
