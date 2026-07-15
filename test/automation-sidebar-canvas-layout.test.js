const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.join(__dirname, '../src/assets/extensions/browser_automation');

function read(relativePath) {
  return fs.readFileSync(path.join(extensionRoot, relativePath), 'utf8');
}

test('automation sidebar is canvas-first and keeps node settings in a canvas overlay', () => {
  const html = read('popup.html');
  const css = read('popup.css');

  assert.ok(html.includes('id="sidebar-card-settings-open"'));
  assert.ok(html.includes('id="sidebar-card-settings-modal"'));
  assert.ok(html.includes('aria-labelledby="sidebar-card-settings-title" hidden'));
  assert.ok(html.includes('<h3 class="sidebar-section__title">基础信息</h3>'));
  assert.ok(html.includes('<h3 class="sidebar-section__title">附加信息</h3>'));
  assert.match(css, /\.sidebar-card-settings-modal\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /\.sidebar-card-settings-modal\[hidden\]\s*\{\s*display:\s*none;/);
  assert.ok(html.includes('class="sidebar-flow-stage"'));
  assert.ok(html.includes('class="sidebar-step-list sidebar-node-settings"'));
  assert.ok(html.includes('aria-label="节点设置" aria-hidden="true"'));
  assert.ok(!html.includes('sidebar-step-list-title'));
  assert.ok(!html.includes('节点详情'));
  assert.match(css, /\.sidebar-node-settings\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*12px;[\s\S]*?right:\s*12px;/);
  assert.match(css, /\.sidebar-node-settings\.is-open\s*\{\s*display:\s*block;/);
});

test('node settings stay hidden until a flow node is selected', () => {
  const workbench = read('popup/automation-workbench.js');
  const bindings = read('popup/bindings.js');

  assert.ok(workbench.includes("sidebarSelectedFlowNodeId = '';"));
  assert.ok(workbench.includes("card.classList.toggle('is-selected', selected)"));
  assert.ok(workbench.includes("sidebarStepListNode.classList.toggle('is-open', hasSelection)"));
  assert.ok(workbench.includes('function clearSidebarFlowNodeSelection()'));
  assert.ok(bindings.includes("handleSidebarFlowNodeClick(String(node.dataset.flowNodeId || '').trim())"));
  assert.ok(bindings.includes('clearSidebarFlowNodeSelection();'));
  assert.ok(bindings.includes('function setSidebarCardSettingsOpen(open = false)'));
  assert.ok(bindings.includes("event.key === 'Escape'"));
});
