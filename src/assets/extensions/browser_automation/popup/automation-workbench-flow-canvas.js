'use strict';

function normalizeSidebarFlowSelection(steps) {
    const validIds = new Set(steps.map((step, index) => getSidebarStepId(step, index)));
    sidebarSelectedFlowNodeIds = new Set(Array.from(sidebarSelectedFlowNodeIds).filter((id) => validIds.has(id)));
    if (sidebarSelectedFlowNodeId && !validIds.has(sidebarSelectedFlowNodeId)) sidebarSelectedFlowNodeId = '';
    if (sidebarFlowConnectSourceId && !validIds.has(sidebarFlowConnectSourceId)) {
        sidebarFlowConnectSourceId = '';
        sidebarFlowConnectSourcePort = 'right';
        sidebarFlowConnectMode = false;
    }
}

function applySidebarFlowCanvasSize(size, steps) {
    sidebarFlowSvgNode.setAttribute('width', String(size.width));
    sidebarFlowSvgNode.setAttribute('height', String(size.height));
    for (const node of [sidebarFlowSvgNode, sidebarFlowNodesNode, sidebarFlowViewportNode]) {
        if (!node) continue;
        node.style.width = `${size.width}px`;
        node.style.height = `${size.height}px`;
    }
    applySidebarFlowViewTransform();
    sidebarFlowCanvasNode.classList.toggle('is-connect-mode', sidebarFlowConnectMode);
    sidebarFlowEmptyNode?.classList.toggle('is-hidden', steps.length > 0);
}

function createEdgeGroupCounter() {
    const counters = new Map();
    return (key) => {
        const next = counters.get(key) || 0;
        counters.set(key, next + 1);
        return next;
    };
}

function resolveSidebarFlowEdgePorts(edge, sourceStep, from, to) {
    const condition = String(sourceStep.type || '').trim().toLowerCase() === 'condition';
    const edgeLabel = String(edge.label || 'next').trim().toLowerCase();
    const fromPort = edge.fromPort === 'left' ? 'left' : 'right';
    const toPort = edge.toPort === 'right' ? 'right' : 'left';
    let sourceOffset = 35;
    if (condition && edgeLabel === 'true') sourceOffset = 25;
    if (condition && edgeLabel === 'false') sourceOffset = 50;
    return {
        condition,
        edgeLabel,
        fromPort,
        toPort,
        sx: Number(from.x || 0) + (fromPort === 'right' ? 168 : 0),
        sy: Number(from.y || 0) + sourceOffset,
        tx: Number(to.x || 0) + (toPort === 'right' ? 168 : 0),
        ty: Number(to.y || 0) + 35
    };
}

function renderSidebarFlowEdgeLabel(edge, ports, geometry) {
    if (!ports.condition || !['true', 'false'].includes(ports.edgeLabel)) return '';
    const label = String(edge.label || 'next').trim() || 'next';
    return `<text class="sidebar-flow-edge-label" x="${geometry.labelX}" y="${geometry.labelY}">${escapeHtml(label)}</text>`;
}

function renderSidebarFlowEdge(edge, context) {
    const from = context.nodeMap.get(edge.from);
    const to = context.nodeMap.get(edge.to);
    if (!from || !to) return '';
    const sourceStep = getSidebarFlowStepById(context.steps, edge.from) || {};
    const ports = resolveSidebarFlowEdgePorts(edge, sourceStep, from, to);
    const sourceIndex = context.takeGroupIndex(`from:${edge.from}|${ports.fromPort}|${ports.sy}`);
    const targetIndex = context.takeGroupIndex(`to:${edge.to}|${ports.toPort}`);
    const spread = Math.min(Math.max(sourceIndex, targetIndex), 3) * 12;
    const geometry = buildSidebarFlowEdgeGeometry(
        ports.sx, ports.sy, ports.tx, ports.ty, ports.fromPort, ports.toPort, spread
    );
    const labelMarkup = renderSidebarFlowEdgeLabel(edge, ports, geometry);
    return `<path class="sidebar-flow-edge" data-flow-edge-id="${escapeHtml(edge.id)}" d="${escapeHtml(geometry.path)}" marker-end="url(#sidebar-flow-arrow)"></path>${labelMarkup}`;
}

function renderSidebarFlowNode(step, index, nodeMap) {
    const id = getSidebarStepId(step, index);
    const node = nodeMap.get(id) || getSidebarFlowLayoutForIndex(index);
    const type = String(step?.type || 'navigate').trim() || 'navigate';
    const name = String(step?.name || `步骤${index + 1}`).trim() || `步骤${index + 1}`;
    const meta = buildSidebarFlowNodeMeta(step);
    const condition = type === 'condition';
    const classes = [
        'sidebar-flow-node',
        `is-type-${type.replace(/[^a-z0-9_-]+/gi, '-')}`,
        sidebarSelectedFlowNodeIds.has(id) ? 'is-selected' : '',
        id === sidebarFlowConnectSourceId ? 'is-connect-source' : ''
    ].filter(Boolean).join(' ');
    const rightPort = condition
        ? `<button type="button" class="sidebar-flow-port sidebar-flow-port--right sidebar-flow-port--condition-true" data-flow-port="right" data-flow-role="source" data-flow-label="true" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 条件成立输出端点"></button><button type="button" class="sidebar-flow-port sidebar-flow-port--right sidebar-flow-port--condition-false" data-flow-port="right" data-flow-role="source" data-flow-label="false" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 条件不成立输出端点"></button>`
        : `<button type="button" class="sidebar-flow-port sidebar-flow-port--right" data-flow-port="right" data-flow-role="any" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 右侧端点"></button>`;
    return `<div class="${classes}" data-flow-node-id="${escapeHtml(id)}" data-step-index="${index}" style="left:${Math.max(0, Number(node.x || 0))}px;top:${Math.max(0, Number(node.y || 0))}px;"><button type="button" class="sidebar-flow-port sidebar-flow-port--left" data-flow-port="left" data-flow-role="${condition ? 'target' : 'any'}" data-flow-node-id="${escapeHtml(id)}" aria-label="${escapeHtml(name)} 左侧端点"></button><div class="sidebar-flow-node__top"><span class="sidebar-flow-node__badge">#${index + 1}</span><span class="sidebar-flow-node__type">${escapeHtml(formatStepTypeLabel(type))}</span></div><div class="sidebar-flow-node__title">${escapeHtml(name)}</div>${meta ? `<div class="sidebar-flow-node__meta">${escapeHtml(meta)}</div>` : ''}${rightPort}</div>`;
}

function renderSidebarFlowCanvas(cardData = null) {
    if (!isSidebarLayout() || !sidebarFlowCanvasNode || !sidebarFlowSvgNode || !sidebarFlowNodesNode) {
        return;
    }

    const steps = ensureSidebarStepIds(Array.isArray(cardData?.steps) ? cardData.steps : collectSidebarSteps());
    sidebarFlowState = normalizeSidebarFlowForSteps(cardData?.flow || sidebarFlowState, steps);
    normalizeSidebarFlowSelection(steps);

    const size = getSidebarFlowCanvasSize(sidebarFlowState.nodes);
    applySidebarFlowCanvasSize(size, steps);
    const nodeMap = new Map(sidebarFlowState.nodes.map((node) => [String(node.id || ''), node]));
    const edgeContext = { nodeMap, steps, takeGroupIndex: createEdgeGroupCounter() };
    const edgeMarkup = sidebarFlowState.edges.map((edge) => renderSidebarFlowEdge(edge, edgeContext)).join('');
    sidebarFlowSvgNode.innerHTML = `
      <defs>
        <marker id="sidebar-flow-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#64748b"></path>
        </marker>
      </defs>
      ${edgeMarkup}
    `;

    sidebarFlowNodesNode.innerHTML = steps.map((step, index) => renderSidebarFlowNode(step, index, nodeMap)).join('');
    syncSidebarNodeSettingsSelection();
}

function syncSidebarNodeSettingsSelection() {
    if (!sidebarStepListNode) {
        return false;
    }

    let hasSelection = false;
    collectSidebarStepCards().forEach((card) => {
        const selected = Boolean(sidebarSelectedFlowNodeId)
            && String(card.dataset.stepId || '').trim() === sidebarSelectedFlowNodeId;
        card.classList.toggle('is-selected', selected);
        card.classList.toggle('is-expanded', selected);
        hasSelection = hasSelection || selected;
    });
    sidebarStepListNode.classList.toggle('is-open', hasSelection);
    sidebarStepListNode.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
    if (hasSelection) {
        window.requestAnimationFrame(() => positionSidebarNodeSettings());
    }
    return hasSelection;
}

function escapeSidebarFlowNodeId(value) {
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/"/g, '\\"');
}

function positionSidebarNodeSettings() {
    if (!sidebarStepListNode?.classList.contains('is-open') || !sidebarFlowCanvasNode || !sidebarSelectedFlowNodeId) {
        return false;
    }
    const stage = sidebarFlowCanvasNode.closest('.sidebar-flow-stage');
    const safeId = escapeSidebarFlowNodeId(sidebarSelectedFlowNodeId);
    const selectedNode = sidebarFlowNodesNode?.querySelector(`[data-flow-node-id="${safeId}"]`);
    if (!stage || !selectedNode) {
        return false;
    }

    const gap = 12;
    const margin = 12;
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = selectedNode.getBoundingClientRect();
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const desiredPanelWidth = Math.min(390, Math.max(240, stageWidth - margin * 2));
    const nodeLeft = nodeRect.left - stageRect.left;
    const nodeTop = nodeRect.top - stageRect.top;
    const nodeRight = nodeRect.right - stageRect.left;
    const nodeBottom = nodeRect.bottom - stageRect.top;
    const rightSpace = stageWidth - nodeRight - margin - gap;
    const leftSpace = nodeLeft - margin - gap;
    const belowSpace = stageHeight - nodeBottom - margin - gap;
    const aboveSpace = nodeTop - margin - gap;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

    let panelWidth = desiredPanelWidth;
    let left = margin;
    let top = margin;
    let maxHeight = Math.max(140, stageHeight - margin * 2);
    if (rightSpace >= 240) {
        panelWidth = Math.min(desiredPanelWidth, rightSpace);
        left = nodeRight + gap;
        top = clamp(nodeTop, margin, stageHeight - margin - 180);
    } else if (leftSpace >= 240) {
        panelWidth = Math.min(desiredPanelWidth, leftSpace);
        left = nodeLeft - panelWidth - gap;
        top = clamp(nodeTop, margin, stageHeight - margin - 180);
    } else if (belowSpace >= 80 || aboveSpace < 80 || belowSpace >= aboveSpace) {
        left = clamp(nodeLeft, margin, stageWidth - panelWidth - margin);
        top = nodeBottom + gap;
        maxHeight = Math.max(80, stageHeight - top - margin);
    } else {
        left = clamp(nodeLeft, margin, stageWidth - panelWidth - margin);
        maxHeight = aboveSpace;
        top = Math.max(margin, nodeTop - gap - maxHeight);
    }

    sidebarStepListNode.style.width = `${panelWidth}px`;
    sidebarStepListNode.style.left = `${Math.round(left)}px`;
    sidebarStepListNode.style.top = `${Math.round(top)}px`;
    sidebarStepListNode.style.maxHeight = `${Math.round(maxHeight)}px`;
    return true;
}

function applySidebarFlowViewTransform() {
    if (!sidebarFlowViewportNode) {
        return;
    }
    const { scale, x, y } = sidebarFlowViewState;
    sidebarFlowViewportNode.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    const resetButton = document.getElementById('sidebar-flow-zoom-reset');
    if (resetButton) {
        resetButton.textContent = `${Math.round(scale * 100)}%`;
    }
    if (sidebarSelectedFlowNodeId) {
        window.requestAnimationFrame(() => positionSidebarNodeSettings());
    }
}

function setSidebarFlowZoom(nextScale = 1, clientX = null, clientY = null) {
    if (!sidebarFlowCanvasNode) {
        return 1;
    }
    const oldScale = sidebarFlowViewState.scale;
    const scale = Math.min(2, Math.max(0.4, Number(nextScale) || 1));
    const rect = sidebarFlowCanvasNode.getBoundingClientRect();
    const hasClientX = clientX !== null && clientX !== undefined && Number.isFinite(Number(clientX));
    const hasClientY = clientY !== null && clientY !== undefined && Number.isFinite(Number(clientY));
    const anchorX = hasClientX ? Number(clientX) - rect.left : rect.width / 2;
    const anchorY = hasClientY ? Number(clientY) - rect.top : rect.height / 2;
    const logicalX = (anchorX - sidebarFlowViewState.x) / oldScale;
    const logicalY = (anchorY - sidebarFlowViewState.y) / oldScale;
    sidebarFlowViewState = {
        scale,
        x: anchorX - logicalX * scale,
        y: anchorY - logicalY * scale
    };
    applySidebarFlowViewTransform();
    return scale;
}

function zoomSidebarFlowBy(delta = 0, clientX = null, clientY = null) {
    return setSidebarFlowZoom(sidebarFlowViewState.scale + Number(delta || 0), clientX, clientY);
}

function resetSidebarFlowView() {
    sidebarFlowViewState = { scale: 1, x: 0, y: 0 };
    applySidebarFlowViewTransform();
}

function beginSidebarFlowCanvasPan(event) {
    if (!event || event.button !== 0 || !sidebarFlowCanvasNode) {
        return false;
    }
    event.preventDefault();
    sidebarFlowPanState = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: sidebarFlowViewState.x,
        startY: sidebarFlowViewState.y
    };
    sidebarFlowCanvasNode.classList.add('is-panning');
    const onMove = (moveEvent) => {
        if (!sidebarFlowPanState) return;
        sidebarFlowViewState = {
            ...sidebarFlowViewState,
            x: sidebarFlowPanState.startX + moveEvent.clientX - sidebarFlowPanState.startClientX,
            y: sidebarFlowPanState.startY + moveEvent.clientY - sidebarFlowPanState.startClientY
        };
        applySidebarFlowViewTransform();
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        sidebarFlowPanState = null;
        sidebarFlowCanvasNode.classList.remove('is-panning');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return true;
}

function addSidebarStepToCanvas(stepType = 'navigate', clientX = null, clientY = null) {
    const currentCard = collectSidebarCardDataFromForm();
    if (!currentCard || !sidebarFlowCanvasNode) {
        return null;
    }
    const step = buildSidebarStepTemplate(stepType);
    const steps = ensureSidebarStepIds([...(Array.isArray(currentCard.steps) ? currentCard.steps : []), step]);
    const stepId = getSidebarStepId(steps[steps.length - 1], steps.length - 1);
    let flow = normalizeSidebarFlowForSteps(currentCard.flow || sidebarFlowState, steps);
    const rect = sidebarFlowCanvasNode.getBoundingClientRect();
    const hasClientX = clientX !== null && clientX !== undefined && Number.isFinite(Number(clientX));
    const hasClientY = clientY !== null && clientY !== undefined && Number.isFinite(Number(clientY));
    const screenX = hasClientX ? Number(clientX) - rect.left : rect.width / 2;
    const screenY = hasClientY ? Number(clientY) - rect.top : rect.height / 2;
    const x = Math.max(0, (screenX - sidebarFlowViewState.x) / sidebarFlowViewState.scale - 84);
    const y = Math.max(0, (screenY - sidebarFlowViewState.y) / sidebarFlowViewState.scale - 36);
    flow = {
        ...flow,
        nodes: flow.nodes.map((node) => node.id === stepId ? { ...node, x, y } : node)
    };
    currentCard.steps = steps;
    currentCard.flow = flow;
    renderSidebarCardEditor(currentCard);
    selectSidebarFlowNode(stepId, { scroll: false });
    syncSidebarEditorToHiddenJson();
    return steps[steps.length - 1];
}

function selectSidebarFlowNode(stepId = '', options = {}) {
    const id = String(stepId || '').trim();
    if (!id) {
        return false;
    }
    const toggle = options.toggle === true;
    const additive = options.additive === true || toggle;
    if (!additive) {
        sidebarSelectedFlowNodeIds = new Set([id]);
    } else if (toggle && sidebarSelectedFlowNodeIds.has(id)) {
        sidebarSelectedFlowNodeIds.delete(id);
    } else {
        sidebarSelectedFlowNodeIds.add(id);
    }
    const remainingSelection = Array.from(sidebarSelectedFlowNodeIds);
    sidebarSelectedFlowNodeId = sidebarSelectedFlowNodeIds.has(id)
        ? id
        : (remainingSelection[remainingSelection.length - 1] || '');
    const currentCard = collectSidebarCardDataFromForm();
    renderSidebarFlowCanvas(currentCard);
    syncSidebarNodeSettingsSelection();
    return sidebarSelectedFlowNodeIds.has(id);
}

function clearSidebarFlowNodeSelection() {
    if (!sidebarSelectedFlowNodeId && sidebarSelectedFlowNodeIds.size === 0) {
        return false;
    }
    sidebarSelectedFlowNodeId = '';
    sidebarSelectedFlowNodeIds = new Set();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return true;
}

function prepareSidebarFlowNodeContextSelection(stepId = '') {
    const id = String(stepId || '').trim();
    if (!id) {
        return 0;
    }
    if (!sidebarSelectedFlowNodeIds.has(id)) {
        sidebarSelectedFlowNodeIds = new Set([id]);
    }
    sidebarSelectedFlowNodeId = '';
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return sidebarSelectedFlowNodeIds.size;
}

function setSidebarFlowConnectMode(enabled = false) {
    sidebarFlowConnectMode = enabled === true;
    sidebarFlowConnectSourceId = sidebarFlowConnectMode ? sidebarFlowConnectSourceId : '';
    sidebarFlowConnectSourcePort = sidebarFlowConnectMode ? sidebarFlowConnectSourcePort : 'right';
    sidebarFlowConnectLabel = sidebarFlowConnectMode ? sidebarFlowConnectLabel : 'next';
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return sidebarFlowConnectMode;
}

function toggleSidebarFlowConnectMode() {
    return setSidebarFlowConnectMode(!sidebarFlowConnectMode);
}

function resolveSidebarFlowEdgeLabel(sourceStep, sourceId, preferredLabel) {
    const requested = String(preferredLabel || '').trim();
    if (requested) return requested;
    if (String(sourceStep.type || '').trim().toLowerCase() !== 'condition') return 'next';
    const usedLabels = new Set(sidebarFlowState.edges
        .filter((edge) => edge.from === sourceId)
        .map((edge) => String(edge.label || '').trim().toLowerCase()));
    if (!usedLabels.has('true')) return 'true';
    return usedLabels.has('false') ? 'next' : 'false';
}

function sidebarFlowEdgeExists(sourceId, targetId, label) {
    return sidebarFlowState.edges.some((edge) => (
        edge.from === sourceId
        && edge.to === targetId
        && String(edge.label || 'next') === label
    ));
}

function createSidebarFlowEdge(sourceId, targetId, label, fromPort, toPort) {
    return {
        id: buildSidebarFlowEdgeId(sourceId, targetId, label, sidebarFlowState.edges.length),
        from: sourceId,
        to: targetId,
        label,
        fromPort: String(fromPort || '').trim().toLowerCase() === 'left' ? 'left' : 'right',
        toPort: String(toPort || '').trim().toLowerCase() === 'right' ? 'right' : 'left'
    };
}

function addSidebarFlowEdge(from = '', to = '', preferredLabel = '', fromPort = 'right', toPort = 'left') {
    const sourceId = String(from || '').trim();
    const targetId = String(to || '').trim();
    if (!sourceId || !targetId || sourceId === targetId) {
        return null;
    }
    const currentSteps = collectSidebarSteps();
    const sourceStep = getSidebarFlowStepById(currentSteps, sourceId) || {};
    const label = resolveSidebarFlowEdgeLabel(sourceStep, sourceId, preferredLabel);
    if (sidebarFlowEdgeExists(sourceId, targetId, label)) return null;
    const edge = createSidebarFlowEdge(sourceId, targetId, label, fromPort, toPort);
    sidebarFlowState = {
        ...sidebarFlowState,
        edges: [...sidebarFlowState.edges, edge]
    };
    return edge;
}
