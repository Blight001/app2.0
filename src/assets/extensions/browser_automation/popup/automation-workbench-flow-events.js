'use strict';

function sidebarFlowText(value) {
    return String(value || '').trim();
}

function normalizeSidebarFlowPort(value) {
    return sidebarFlowText(value).toLowerCase() === 'left' ? 'left' : 'right';
}

function sidebarFlowNumber(value) {
    return Number(value) || 0;
}

function canBeginSidebarFlowPortDrag(event) {
    return Boolean(event && event.button === 0 && sidebarFlowCanvasNode && sidebarFlowSvgNode);
}

function handleSidebarFlowNodeClick(stepId = '', options = {}) {
    const id = String(stepId || '').trim();
    if (!id) {
        return false;
    }
    if (sidebarFlowSuppressNodeClick) {
        sidebarFlowSuppressNodeClick = false;
        return false;
    }
    const toggle = options.toggle === true || options.additive === true;
    selectSidebarFlowNode(id, { additive: toggle, toggle });
    return true;
}

function getSidebarFlowPortPoint(stepId = '', port = 'right', label = '') {
    const id = sidebarFlowText(stepId);
    const portSide = normalizeSidebarFlowPort(port);
    const node = getSidebarFlowNode(id);
    if (!id || !node) {
        return null;
    }
    const step = getSidebarFlowStepById(collectSidebarSteps(), id) || {};
    const isConditionOutput = sidebarFlowText(step.type).toLowerCase() === 'condition' && portSide === 'right';
    const normalizedLabel = sidebarFlowText(label).toLowerCase();
    let yOffset = 35;
    if (isConditionOutput && normalizedLabel === 'true') yOffset = 25;
    if (isConditionOutput && normalizedLabel === 'false') yOffset = 50;
    return {
        x: sidebarFlowNumber(node.x) + (portSide === 'right' ? 168 : 0),
        y: sidebarFlowNumber(node.y) + yOffset,
        side: portSide
    };
}

function buildSidebarFlowPortDragPath(sourcePoint, targetPoint, targetSide = 'left') {
    if (!sourcePoint || !targetPoint) return '';
    return buildSidebarFlowEdgeGeometry(
        Number(sourcePoint.x || 0),
        Number(sourcePoint.y || 0),
        Number(targetPoint.x || 0),
        Number(targetPoint.y || 0),
        sourcePoint.side === 'left' ? 'left' : 'right',
        targetSide === 'right' ? 'right' : 'left'
    ).path;
}

function getSidebarFlowDropPort(clientX, clientY, sourceId) {
    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest?.('[data-flow-port]') || null;
    if (!target || String(target.dataset.flowNodeId || '').trim() === sourceId) return null;
    return String(target.dataset.flowRole || 'any').trim().toLowerCase() === 'source' ? null : target;
}

function clearSidebarFlowDropTarget() {
    sidebarFlowPortDragState?.dropTarget?.classList.remove('is-drop-target');
    if (sidebarFlowPortDragState) sidebarFlowPortDragState.dropTarget = null;
}

function updateSidebarFlowPortPreview(moveEvent, context) {
    if (!sidebarFlowPortDragState) return;
    const { id, previewPath, sourcePoint } = context;
    const targetPort = getSidebarFlowDropPort(moveEvent.clientX, moveEvent.clientY, id);
    if (targetPort !== sidebarFlowPortDragState.dropTarget) {
        clearSidebarFlowDropTarget();
        targetPort?.classList.add('is-drop-target');
        if (targetPort) sidebarFlowPortDragState.dropTarget = targetPort;
    }
    const canvasRect = sidebarFlowCanvasNode.getBoundingClientRect();
    let targetPoint = {
        x: (moveEvent.clientX - canvasRect.left - sidebarFlowViewState.x) / sidebarFlowViewState.scale,
        y: (moveEvent.clientY - canvasRect.top - sidebarFlowViewState.y) / sidebarFlowViewState.scale
    };
    let targetSide = targetPoint.x >= sourcePoint.x ? 'left' : 'right';
    if (targetPort) {
        targetSide = String(targetPort.dataset.flowPort || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
        targetPoint = getSidebarFlowPortPoint(
            String(targetPort.dataset.flowNodeId || '').trim(),
            targetSide,
            String(targetPort.dataset.flowLabel || '')
        ) || targetPoint;
    }
    previewPath.setAttribute('d', buildSidebarFlowPortDragPath(sourcePoint, targetPoint, targetSide));
}

function finishSidebarFlowPortDrag(upEvent, cancelled, context, handlers) {
    document.removeEventListener('pointermove', handlers.onMove);
    document.removeEventListener('pointerup', handlers.onUp);
    document.removeEventListener('pointercancel', handlers.onCancel);
    document.removeEventListener('keydown', handlers.onKeyDown);
    const targetPort = !cancelled && upEvent
        ? getSidebarFlowDropPort(upEvent.clientX, upEvent.clientY, context.id)
        : null;
    clearSidebarFlowDropTarget();
    let edge = null;
    if (targetPort) {
        const targetId = String(targetPort.dataset.flowNodeId || '').trim();
        const targetSide = String(targetPort.dataset.flowPort || '').trim().toLowerCase() === 'left' ? 'left' : 'right';
        edge = addSidebarFlowEdge(context.id, targetId, context.sourceLabel, context.portSide, targetSide);
    }
    sidebarFlowPortDragState = null;
    sidebarFlowConnectSourceId = '';
    sidebarFlowConnectSourcePort = 'right';
    sidebarFlowConnectMode = false;
    sidebarFlowConnectLabel = 'next';
    if (edge) syncSidebarEditorToHiddenJson();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    if (edge) showActionToast('已创建 A → B 连线', 'success');
    else if (targetPort && !cancelled) showActionToast('该连线已存在', 'info');
}

function createSidebarFlowPortDragHandlers(context) {
    const handlers = {};
    handlers.onMove = (event) => updateSidebarFlowPortPreview(event, context);
    handlers.onUp = (event) => finishSidebarFlowPortDrag(event, false, context, handlers);
    handlers.onCancel = () => finishSidebarFlowPortDrag(null, true, context, handlers);
    handlers.onKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        finishSidebarFlowPortDrag(null, true, context, handlers);
    };
    return handlers;
}

function beginSidebarFlowPortDrag(event, stepId = '', port = '', label = '', role = 'any') {
    if (!canBeginSidebarFlowPortDrag(event)) return false;
    const id = sidebarFlowText(stepId);
    const portSide = normalizeSidebarFlowPort(port);
    const sourceLabel = sidebarFlowText(label).toLowerCase();
    const sourcePoint = getSidebarFlowPortPoint(id, portSide, sourceLabel);
    if (!id || !sourcePoint || sidebarFlowText(role).toLowerCase() === 'target') return false;
    event.preventDefault();
    event.stopPropagation();
    sidebarSelectedFlowNodeId = '';
    sidebarSelectedFlowNodeIds = new Set();
    sidebarFlowConnectMode = true;
    sidebarFlowConnectSourceId = id;
    sidebarFlowConnectSourcePort = portSide;
    sidebarFlowConnectLabel = 'next';
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.setAttribute('class', 'sidebar-flow-edge-preview');
    previewPath.setAttribute('marker-end', 'url(#sidebar-flow-arrow)');
    previewPath.setAttribute('d', buildSidebarFlowPortDragPath(sourcePoint, sourcePoint, portSide));
    sidebarFlowSvgNode.appendChild(previewPath);
    const context = { id, portSide, previewPath, sourceLabel, sourcePoint };
    sidebarFlowPortDragState = { sourceId: id, sourcePort: portSide, sourceLabel, sourcePoint, previewPath, dropTarget: null };
    const handlers = createSidebarFlowPortDragHandlers(context);
    const { onMove, onUp, onCancel, onKeyDown } = handlers;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown);
    return true;
}

function deleteSidebarFlowEdge(edgeId = '') {
    const id = String(edgeId || '').trim();
    if (!id) {
        return null;
    }
    const edge = sidebarFlowState.edges.find((item) => String(item.id || '') === id) || null;
    sidebarFlowState = {
        ...sidebarFlowState,
        edges: sidebarFlowState.edges.filter((item) => String(item.id || '') !== id)
    };
    syncSidebarEditorToHiddenJson();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return edge;
}

function deleteSelectedSidebarFlowNodes(fallbackStepId = '') {
    const fallbackId = String(fallbackStepId || '').trim();
    const selectedIds = new Set(sidebarSelectedFlowNodeIds);
    if (selectedIds.size === 0 && fallbackId) {
        selectedIds.add(fallbackId);
    }
    if (selectedIds.size === 0) {
        return 0;
    }

    const currentCard = collectSidebarCardDataFromForm();
    const steps = ensureSidebarStepIds(Array.isArray(currentCard?.steps) ? currentCard.steps : []);
    const retainedSteps = steps.filter((step, index) => !selectedIds.has(getSidebarStepId(step, index)));
    const deletedCount = steps.length - retainedSteps.length;
    if (deletedCount <= 0) {
        return 0;
    }

    const retainedIds = new Set(retainedSteps.map((step, index) => getSidebarStepId(step, index)));
    const nextStartId = retainedSteps.length > 0 ? getSidebarStepId(retainedSteps[0], 0) : '';
    currentCard.steps = retainedSteps;
    currentCard.flow = {
        ...sidebarFlowState,
        start: retainedIds.has(sidebarFlowState.start) ? sidebarFlowState.start : nextStartId,
        nodes: sidebarFlowState.nodes.filter((node) => retainedIds.has(String(node.id || ''))),
        edges: sidebarFlowState.edges.filter((edge) => retainedIds.has(edge.from) && retainedIds.has(edge.to))
    };
    if (selectedIds.has(sidebarFlowConnectSourceId)) {
        sidebarFlowConnectMode = false;
        sidebarFlowConnectSourceId = '';
        sidebarFlowConnectSourcePort = 'right';
        sidebarFlowConnectLabel = 'next';
    }
    sidebarSelectedFlowNodeId = '';
    sidebarSelectedFlowNodeIds = new Set();
    renderSidebarCardEditor(currentCard);
    syncSidebarEditorToHiddenJson();
    return deletedCount;
}

function applySidebarFlowAutoLayout() {
    const currentCard = collectSidebarCardDataFromForm();
    const steps = ensureSidebarStepIds(Array.isArray(currentCard?.steps) ? currentCard.steps : []);
    const stepIds = steps.map((step, index) => getSidebarStepId(step, index));
    if (stepIds.length === 0) {
        return null;
    }
    const start = sidebarFlowState.start && stepIds.includes(sidebarFlowState.start) ? sidebarFlowState.start : stepIds[0];
    const nodePositions = computeSidebarFlowLayeredLayout(stepIds, sidebarFlowState.edges, start);
    sidebarFlowState = {
        ...sidebarFlowState,
        start,
        nodes: stepIds.map((id, index) => ({
            id,
            ...(nodePositions.get(id) || getSidebarFlowLayoutForIndex(index))
        }))
    };
    resetSidebarFlowView();
    syncSidebarEditorToHiddenJson();
    renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    return sidebarFlowState;
}

function createSidebarFlowNodeDragHandlers(id, additive) {
    const onMove = (moveEvent) => {
        if (!sidebarFlowDragState) return;
        const clientDx = moveEvent.clientX - sidebarFlowDragState.startClientX;
        const clientDy = moveEvent.clientY - sidebarFlowDragState.startClientY;
        const dx = clientDx / sidebarFlowViewState.scale;
        const dy = clientDy / sidebarFlowViewState.scale;
        if (Math.hypot(clientDx, clientDy) >= 6) {
            sidebarFlowDragState.moved = true;
            sidebarFlowSuppressNodeClick = true;
        }
        if (!sidebarFlowDragState.moved) return;
        sidebarSelectedFlowNodeIds = new Set(sidebarFlowDragState.dragIds);
        sidebarSelectedFlowNodeId = '';
        sidebarFlowState = {
            ...sidebarFlowState,
            nodes: sidebarFlowState.nodes.map((item) => {
                const start = sidebarFlowDragState.startPositions.get(String(item.id || ''));
                return start ? { ...item, x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy) } : item;
            })
        };
        renderSidebarFlowCanvas(collectSidebarCardDataFromForm());
    };
    const finish = (cancelled = false) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        const moved = sidebarFlowDragState?.moved === true;
        sidebarFlowDragState = null;
        if (moved) syncSidebarEditorToHiddenJson();
        else if (!cancelled) {
            sidebarFlowSuppressNodeClick = true;
            selectSidebarFlowNode(id, { additive, toggle: additive });
        }
        window.setTimeout(() => { sidebarFlowSuppressNodeClick = false; }, 0);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    return { onMove, onUp, onCancel };
}

function beginSidebarFlowNodeDrag(event, stepId = '') {
    if (!event || event.button !== 0) {
        return false;
    }
    if (sidebarFlowConnectMode) {
        return false;
    }
    const id = String(stepId || '').trim();
    const node = getSidebarFlowNode(id);
    if (!id || !node || !sidebarFlowCanvasNode) {
        return false;
    }
    event.preventDefault();
    const additive = event.ctrlKey === true || event.metaKey === true || event.shiftKey === true;
    const dragIds = sidebarSelectedFlowNodeIds.has(id)
        ? Array.from(sidebarSelectedFlowNodeIds)
        : (additive ? [...Array.from(sidebarSelectedFlowNodeIds), id] : [id]);
    const startPositions = new Map(sidebarFlowState.nodes
        .filter((item) => dragIds.includes(String(item.id || '')))
        .map((item) => [String(item.id || ''), {
            x: Number(item.x || 0),
            y: Number(item.y || 0)
        }]));
    const rect = sidebarFlowCanvasNode.getBoundingClientRect();
    sidebarFlowDragState = {
        id,
        dragIds,
        startPositions,
        startClientX: event.clientX,
        startClientY: event.clientY,
        scrollLeft: sidebarFlowCanvasNode.scrollLeft,
        scrollTop: sidebarFlowCanvasNode.scrollTop,
        rectLeft: rect.left,
        rectTop: rect.top,
        moved: false
    };
    const { onMove, onUp, onCancel } = createSidebarFlowNodeDragHandlers(id, additive);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return true;
}

function applyExecutionStatusToSidebarFlowStep(stepIndex, status = 'pending') {
    if (!sidebarFlowNodesNode || !sidebarStepListNode) {
        return;
    }
    const idx = Number(stepIndex);
    const card = sidebarStepListNode.querySelector(`[data-sidebar-step-card][data-step-index="${Math.max(0, idx - 1)}"]`);
    const stepId = String(card?.dataset?.stepId || '').trim();
    if (!stepId) {
        return;
    }
    const safeStepId = typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function' ? CSS.escape(stepId) : stepId.replace(/"/g, '\\"');
    const node = sidebarFlowNodesNode.querySelector(`[data-flow-node-id="${safeStepId}"]`);
    if (!node) {
        return;
    }
    node.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');
    if (status) {
        node.classList.add(`is-${status}`);
    }
}
