'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.join(
  __dirname,
  '../../../src/app/sidebar/client/app/side/controllers/pages/automation/automation-flow-canvas.js',
);

function loadCanvasApi() {
  const context = vm.createContext({ window: {}, document: {} });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return context.window.AutomationFlowCanvas;
}

test('画布自动排版按流程深度横向展开并分离分支', () => {
  const { computeLayout } = loadCanvasApi();
  const card = {
    steps: [
      { id: 'start' },
      { id: 'condition' },
      { id: 'success' },
      { id: 'failure' },
    ],
    flow: {
      start: 'start',
      nodes: [],
      edges: [
        { from: 'start', to: 'condition', label: 'next' },
        { from: 'condition', to: 'success', label: 'true' },
        { from: 'condition', to: 'failure', label: 'false' },
      ],
    },
  };

  const layout = JSON.parse(JSON.stringify(computeLayout(card)));
  const positions = Object.fromEntries(layout.map((node) => [node.id, node]));
  assert.ok(positions.condition.x > positions.start.x);
  assert.equal(positions.success.x, positions.failure.x);
  assert.notEqual(positions.success.y, positions.failure.y);
});

test('画布连线路径支持正向和回环方向', () => {
  const { buildEdgePath } = loadCanvasApi();
  assert.match(buildEdgePath({ x: 10, y: 20 }, { x: 200, y: 80 }), /^M 10 20 C /);
  assert.match(buildEdgePath({ x: 200, y: 20 }, { x: 10, y: 80 }), /, 10 80$/);
});
