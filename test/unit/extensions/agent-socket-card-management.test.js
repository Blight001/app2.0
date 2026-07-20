'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(
  __dirname,
  '../../../src/assets/extensions/browser_automation/background/09_agent_socket.js',
);

function createContext(overrides = {}) {
  const context = vm.createContext({
    console,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Date,
    globalThis: { AI_FREE_BROWSER_ENVIRONMENT: {} },
    ...overrides,
  });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return context;
}

test('卡片写入校验接受合法分支流并拒绝悬空节点与未知步骤类型', () => {
  const context = createContext();
  const valid = {
    website: 'https://example.com',
    steps: [
      { id: 'start', type: 'navigate', url: 'https://example.com' },
      { id: 'done', type: 'screenshot' },
    ],
    flow: {
      start: 'start',
      nodes: [{ id: 'start' }, { id: 'done' }],
      edges: [{ from: 'start', to: 'done', label: 'next' }],
    },
  };
  assert.doesNotThrow(() => context.validateCardDataForWrite(valid));
  assert.throws(() => context.validateCardDataForWrite({
    steps: [{ id: 'start', type: 'invented_step' }],
    flow: { start: 'missing', edges: [{ from: 'start', to: 'missing' }] },
  }), /卡片校验失败/);
});

test('步骤局部编辑保持 1-based 索引并返回被编辑或删除的步骤', () => {
  const context = createContext();
  const steps = [{ type: 'navigate' }, { type: 'click', selector: '#old' }];
  const patched = context.applyCardStepEdit(
    steps,
    { step_index: 2, stepPatch: { selector: '#new' } },
    'patch_step',
    'patch_step',
  );
  assert.equal(patched.step.selector, '#new');

  const inserted = context.applyCardStepEdit(
    steps,
    { insert_after: 0, step: { type: 'wait', selector: '#ready' } },
    'insert_step',
    'insert_step',
  );
  assert.equal(inserted.stepIndex, 1);
  assert.equal(steps[0].type, 'wait');

  const moved = context.applyCardStepEdit(
    steps,
    { step_index: 1, to_step_index: 3 },
    'move_step',
    'move_step',
  );
  assert.equal(moved.toStepIndex, 3);
  assert.equal(steps[2].type, 'wait');

  const deleted = context.applyCardStepEdit(
    steps,
    { step_index: 3 },
    'delete_step',
    'delete_step',
  );
  assert.equal(deleted.deletedStep.type, 'wait');
});

test('工具失败映射保留步骤现场并优先使用显式错误码', () => {
  const context = createContext();
  assert.equal(context.inferAgentToolErrorCode(new Error('页面加载超时')), 'NAVIGATION_TIMEOUT');
  assert.equal(context.inferAgentToolErrorCode({ code: 'CUSTOM_FAILURE' }), 'CUSTOM_FAILURE');
  const error = Object.assign(new Error('找不到按钮'), {
    failure: {
      errorCode: 'ELEMENT_NOT_FOUND',
      stepIndex: 2,
      stepTotal: 3,
      stepName: '提交',
      selector: '#submit',
      failureSnapshot: { url: 'https://example.com' },
    },
  });
  const result = context.buildAgentToolFailureResult(error, {
    tool: 'manage_card', args: { card_id: 'card-1' },
  });

  assert.equal(result.errorCode, 'ELEMENT_NOT_FOUND');
  assert.equal(result.cardId, 'card-1');
  assert.equal(result.stepIndex, 2);
  assert.equal(result.failureSnapshot.url, 'https://example.com');
});
