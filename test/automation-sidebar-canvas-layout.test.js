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
  assert.ok(html.includes('id="sidebar-save-card"'));
  assert.ok(html.includes('id="sidebar-card-settings-modal"'));
  assert.ok(html.includes('aria-labelledby="sidebar-card-settings-title" hidden'));
  assert.ok(html.includes('<h3 class="sidebar-section__title">基础信息</h3>'));
  assert.ok(html.includes('<h3 class="sidebar-section__title">附加信息</h3>'));
  assert.ok(html.includes('id="sidebar-card-name" type="text" required aria-required="true"'));
  assert.ok(html.includes('id="sidebar-card-website" type="url" required aria-required="true"'));
  assert.match(css, /\.sidebar-card-settings-modal\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /\.sidebar-card-settings-modal\[hidden\]\s*\{\s*display:\s*none;/);
  assert.ok(html.includes('class="sidebar-flow-stage"'));
  assert.ok(html.includes('class="sidebar-step-list sidebar-node-settings"'));
  assert.ok(html.includes('aria-label="节点设置" aria-hidden="true"'));
  assert.ok(!html.includes('sidebar-step-list-title'));
  assert.ok(!html.includes('节点详情'));
  assert.match(css, /\.sidebar-node-settings\s*\{[\s\S]*?position:\s*absolute;/);
  assert.ok(!css.includes('right: 12px;\n      display: none;'));
  assert.match(css, /\.sidebar-node-settings\.is-open\s*\{\s*display:\s*block;/);
});

test('node settings stay hidden until a flow node is selected', () => {
  const workbench = read('popup/automation-workbench.js');
  const bindings = read('popup/bindings.js');

  assert.ok(workbench.includes("sidebarSelectedFlowNodeId = '';"));
  assert.ok(workbench.includes("card.classList.toggle('is-selected', selected)"));
  assert.ok(workbench.includes("sidebarStepListNode.classList.toggle('is-open', hasSelection)"));
  assert.ok(workbench.includes('function clearSidebarFlowNodeSelection()'));
  assert.ok(workbench.includes('function positionSidebarNodeSettings()'));
  assert.ok(workbench.includes('rightSpace >= 240'));
  assert.ok(workbench.includes('belowSpace >= 80'));
  assert.ok(bindings.includes("handleSidebarFlowNodeClick(String(node.dataset.flowNodeId || '').trim(), {"));
  assert.ok(bindings.includes('clearSidebarFlowNodeSelection();'));
  assert.ok(bindings.includes('function setSidebarCardSettingsOpen(open = false)'));
  assert.ok(bindings.includes('function validateSidebarRequiredFields()'));
  assert.ok(bindings.includes("showActionToast('请先填写标红的必填项目', 'error')"));
  assert.ok(bindings.includes("event.key === 'Escape'"));
});

test('canvas uses a draggable step palette, ports, zoom, and pan without legacy toolbar buttons', () => {
  const html = read('popup.html');
  const workbench = read('popup/automation-workbench.js');
  const bindings = read('popup/bindings.js');

  assert.ok(!html.includes('id="sidebar-add-step"'));
  assert.ok(!html.includes('id="sidebar-refresh-card"'));
  assert.ok(!html.includes('id="sidebar-flow-connect"'));
  assert.ok(!html.includes('id="sidebar-flow-layout"'));
  assert.ok(html.includes('id="sidebar-step-palette"'));
  assert.ok(html.includes('draggable="true" data-step-template-type="condition"'));
  assert.ok(html.includes('id="sidebar-flow-viewport"'));
  assert.ok(html.includes('id="sidebar-flow-zoom-reset"'));
  assert.ok(workbench.includes('data-flow-port="left"'));
  assert.ok(workbench.includes('data-flow-port="right"'));
  assert.ok(workbench.includes('function beginSidebarFlowCanvasPan(event)'));
  assert.ok(workbench.includes('function addSidebarStepToCanvas('));
  assert.ok(bindings.includes("addEventListener('drop'"));
  assert.ok(bindings.includes("addEventListener('wheel'"));
});

test('cookie page omits notes, card keys, saved records, and date filtering', () => {
  const html = read('popup.html');
  const bindings = read('popup/bindings.js');
  const cookieCredentials = read('popup/cookie-credentials.js');

  assert.ok(!html.includes('id="cookie-note"'));
  assert.ok(!html.includes('id="cookie-card-key"'));
  assert.ok(!html.includes('id="save-cookie-credentials"'));
  assert.ok(!html.includes('id="cookie-credential-date-filter"'));
  assert.ok(!html.includes('id="cookie-credential-list"'));
  assert.ok(!html.includes('id="cookie-credential-edit-panel"'));
  assert.ok(!html.includes('id="copy-account-password"'));
  assert.ok(!html.includes('id="copy-cookie-account"'));
  assert.ok(!html.includes('id="copy-cookie-password"'));
  assert.ok(!bindings.includes('copyCookieAccountButton'));
  assert.ok(!bindings.includes('copyCookiePasswordButton'));
  assert.ok(!cookieCredentials.includes(' · 过期：${escapeHtml(expiry)}'));
});

test('cookie actions share one size, use semantic colors, and use a custom cache confirmation', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const bindings = read('popup/bindings.js');

  assert.ok(html.includes('id="capture" class="cookie-action-btn cookie-action-btn--blue"'));
  assert.ok(html.includes('id="import-cookie" class="cookie-action-btn cookie-action-btn--green"'));
  assert.ok(html.includes('id="clear-current-page-cache" class="cookie-action-btn cookie-action-btn--red"'));
  assert.match(css, /\.cookie-action-btn\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.ok(html.includes('id="clear-cache-confirm-modal"'));
  assert.ok(html.includes('id="clear-cache-confirm-submit"'));
  assert.ok(css.includes('.cookie-confirm-modal[hidden]'));
  assert.ok(bindings.includes('function setClearCacheConfirmOpen(open = false)'));
  assert.ok(!bindings.includes('window.confirm('));
  assert.ok(bindings.includes("clearCacheConfirmSubmitButton?.addEventListener('click'"));
});

test('agent modal hides local bridge details and keeps only visible options', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const agentAccount = read('popup/agent-account.js');

  assert.ok(!html.includes('本机桥接'));
  assert.ok(!html.includes('桥接地址'));
  assert.ok(!html.includes('插件会自动连接本机 AI-FREE'));
  assert.ok(!html.includes('id="agent-server-url"'));
  assert.ok(!html.includes('id="agent-connect-btn"'));
  assert.ok(!html.includes('id="agent-disconnect-btn"'));
  assert.ok(!agentAccount.includes("$('agent-server-url')"));
  assert.ok(!agentAccount.includes('localBridgeUrl:'));
  assert.ok(!html.includes('id="agent-status-pill"'));
  assert.ok(!html.includes('id="agent-account-ava"'));
  assert.ok(html.includes('class="agent-status-dot is-red" id="agent-status-dot"'));
  assert.ok(html.includes('class="agent-chip__name" id="agent-account-name"'));
  assert.ok(html.includes('class="agent-chip__status" id="agent-status-label"'));
  assert.ok(agentAccount.includes("status === 'enrolled' ? 'is-green' : 'is-red'"));
  assert.ok(css.includes('.agent-chip__status'));
});

test('card import and export use internal JSON dialogs without file pickers or downloads', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const bindings = read('popup/bindings.js');
  const flow = read('popup/automation-flow.js');
  const workbench = read('popup/automation-workbench.js');

  assert.ok(!html.includes('id="card-file"'));
  assert.ok(!html.includes('id="pick-card-file"'));
  assert.ok(html.includes('id="card-data-import-modal"'));
  assert.ok(html.includes('id="card-data-import-input"'));
  assert.ok(html.includes('id="card-data-import-save"'));
  assert.ok(html.includes('id="card-data-import-cancel"'));
  assert.ok(html.includes('id="card-data-export-modal"'));
  assert.ok(html.includes('id="card-data-export-output"'));
  assert.ok(html.includes('id="card-data-export-copy"'));
  assert.ok(html.includes('id="card-data-export-done"'));
  assert.ok(css.includes('.card-data-import-modal[hidden]'));
  assert.ok(css.includes('height: min(360px, calc(100dvh - 20px))'));
  assert.match(css, /#card-data-import-input,[\s\S]*?#card-data-export-output\s*\{[\s\S]*?resize:\s*none;/);
  assert.match(css, /\.card-data-import-modal__actions\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.ok(bindings.includes('function setCardDataImportOpen(open = false'));
  assert.ok(bindings.includes('function setCardDataExportOpen(open = false'));
  assert.ok(bindings.includes('importCardTextToCache(String(cardDataImportInput?.value || \'\'))'));
  assert.ok(bindings.includes("copyTextToClipboard(String(cardDataExportOutput?.value || ''))"));
  assert.ok(!bindings.includes('cardFileInput?.click()'));
  assert.ok(flow.includes('function parseImportedCardText('));
  assert.ok(flow.includes('async function importCardTextToCache('));
  assert.ok(!flow.includes('function readSelectedCardFiles('));
  assert.ok(workbench.includes('const cacheState = await loadCardCacheState().catch('));
  assert.ok(!workbench.includes('await loadCardCache()'));
  assert.ok(workbench.includes('text: stringifyCardData(cardData)'));
  assert.ok(!workbench.includes("downloadJsonFile(`automation_card/"));
});

test('node editor exposes settings only for the selected step type', () => {
  const workbench = read('popup/automation-workbench.js');
  const css = read('popup.css');

  assert.ok(workbench.includes('data-step-types="navigate"'));
  assert.ok(workbench.includes('data-step-types="click,type,get_credits"'));
  assert.ok(workbench.includes('data-step-types="wait"'));
  assert.ok(workbench.includes('data-step-types="external_script,condition" data-condition-modes="js"'));
  assert.ok(workbench.includes('function updateSidebarStepSettingsVisibility(stepCard)'));
  assert.ok(workbench.includes("field.classList.toggle('is-visible', typeMatches && modeMatches)"));
  assert.match(css, /\.sidebar-step-setting\s*\{\s*display:\s*none;/);
  assert.match(css, /\.sidebar-step-setting\.is-visible\s*\{\s*display:\s*block;/);
});

test('ports and node dragging do not open settings, and every step type has its own color', () => {
  const workbench = read('popup/automation-workbench.js');
  const css = read('popup.css');

  assert.ok(workbench.includes('let sidebarFlowSuppressNodeClick = false'));
  assert.ok(workbench.includes("sidebarSelectedFlowNodeIds = new Set();\n    sidebarFlowConnectMode = true;"));
  assert.ok(workbench.includes('sidebarFlowDragState.moved = true'));
  assert.ok(workbench.includes('Math.hypot(clientDx, clientDy) >= 6'));
  assert.ok(workbench.includes('selectSidebarFlowNode(id, { additive, toggle: additive })'));
  assert.ok(workbench.includes("document.addEventListener('pointercancel', onCancel)"));
  assert.ok(workbench.includes('if (sidebarFlowSuppressNodeClick)'));
  for (const type of [
    'navigate', 'click', 'type', 'wait', 'condition', 'get_credits',
    'save_cookies', 'clear_current_page_cache', 'external_script', 'screenshot'
  ]) {
    assert.ok(css.includes(`[data-step-template-type='${type}']`));
    assert.ok(css.includes(`.sidebar-flow-node.is-type-${type}`));
  }
});

test('canvas supports multi-select group dragging, right-click deletion, inline zoom, and generic side ports', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const workbench = read('popup/automation-workbench.js');
  const bindings = read('popup/bindings.js');

  assert.match(html, /sidebar-section__head--canvas[\s\S]*?自动化步骤[\s\S]*?sidebar-flow-zoom-controls/);
  assert.ok(!html.includes('sidebar-step-toolbar'));
  assert.ok(html.includes('id="sidebar-flow-context-menu"'));
  assert.ok(html.includes('id="sidebar-flow-delete-selection"'));
  assert.ok(workbench.includes('let sidebarSelectedFlowNodeIds = new Set();'));
  assert.ok(workbench.includes('const dragIds = sidebarSelectedFlowNodeIds.has(id)'));
  assert.ok(workbench.includes('startPositions,'));
  assert.ok(workbench.includes('function deleteSelectedSidebarFlowNodes('));
  assert.ok(workbench.includes('edges: sidebarFlowState.edges.filter((edge) => retainedIds.has(edge.from) && retainedIds.has(edge.to))'));
  assert.ok(workbench.includes('x: 34 + index * 220'));
  assert.ok(bindings.includes("addEventListener('contextmenu'"));
  assert.ok(bindings.includes('event.ctrlKey === true || event.metaKey === true || event.shiftKey === true'));
  assert.ok(bindings.includes('deleteSelectedSidebarFlowNodes()'));
  assert.match(css, /\.sidebar-flow-port--left\s*\{[\s\S]*?left:\s*0;[\s\S]*?top:\s*50%;/);
  assert.match(css, /\.sidebar-flow-port--right\s*\{[\s\S]*?left:\s*100%;[\s\S]*?top:\s*50%;/);
  assert.match(css, /\.sidebar-flow-port\s*\{[\s\S]*?transition:\s*none !important;[\s\S]*?animation:\s*none !important;/);
  assert.match(css, /\.sidebar-flow-port:hover\s*\{[\s\S]*?transform:\s*translate\(-50%, -50%\);/);
  assert.ok(workbench.includes('const path = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`'));
  assert.ok(workbench.includes("fromPort: 'right'"));
  assert.ok(workbench.includes("toPort: 'left'"));
  assert.ok(workbench.includes('function beginSidebarFlowPortDrag('));
  assert.ok(workbench.includes("document.addEventListener('pointermove', onMove)"));
  assert.ok(workbench.includes("document.addEventListener('pointerup', onUp)"));
  assert.ok(workbench.includes("document.addEventListener('pointercancel', onCancel)"));
  assert.ok(workbench.includes("edge = addSidebarFlowEdge(id, targetId, sourceLabel, portSide, targetSide)"));
  assert.ok(bindings.includes('beginSidebarFlowPortDrag('));
  assert.ok(bindings.includes('if (port) return;'));
  assert.ok(!workbench.includes('function handleSidebarFlowPortClick('));
  assert.ok(css.includes('.sidebar-flow-edge-preview'));
  assert.ok(css.includes('.sidebar-flow-port.is-drop-target'));
  assert.ok(workbench.includes('sidebar-flow-port--condition-true'));
  assert.ok(workbench.includes('sidebar-flow-port--condition-false'));
  assert.ok(workbench.includes('data-flow-role="source" data-flow-label="true"'));
  assert.ok(workbench.includes('data-flow-role="source" data-flow-label="false"'));
  assert.match(css, /\.sidebar-flow-port--condition-true\s*\{[\s\S]*?top:\s*36%;/);
  assert.match(css, /\.sidebar-flow-port--condition-false\s*\{[\s\S]*?top:\s*71%;/);
  assert.ok(!workbench.includes('const portType ='));
  assert.ok(!workbench.includes('data-flow-port="input"'));
  assert.ok(!workbench.includes('data-flow-port="output"'));
  assert.ok(!workbench.includes('<span>输入</span>'));
  assert.ok(!workbench.includes('<span>输出</span>'));
});
