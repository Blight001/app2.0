'use strict';

{
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NODE_WIDTH = 168;
  const NODE_HEIGHT = 72;
  const LABELS = Object.freeze({
    navigate: '访问', click: '点击', type: '输入', wait: '等待', condition: '判断',
    get_credits: '积分', save_cookies: '会话', clear_current_page_cache: '缓存',
    screenshot: '截图',
  });

  function createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function flowParts(card) {
    const steps = Array.isArray(card?.steps) ? card.steps : [];
    const nodes = Array.isArray(card?.flow?.nodes) ? card.flow.nodes : [];
    const edges = Array.isArray(card?.flow?.edges) ? card.flow.edges : [];
    return { steps, nodes, edges };
  }

  function buildLayoutGraph(steps, edges) {
    const ids = steps.map((step) => String(step.id));
    const validIds = new Set(ids);
    const outgoing = new Map(ids.map((id) => [id, []]));
    const incoming = new Map(ids.map((id) => [id, 0]));
    for (const edge of edges) {
      const from = String(edge?.from || '');
      const to = String(edge?.to || '');
      if (!validIds.has(from) || !validIds.has(to)) continue;
      outgoing.get(from).push(to);
      incoming.set(to, incoming.get(to) + 1);
    }
    return { ids, validIds, outgoing, incoming };
  }

  function assignLayoutDepths(graph, edges, start) {
    const { ids, outgoing, incoming } = graph;
    const queue = [start, ...ids.filter((id) => id !== start && incoming.get(id) === 0)].filter(Boolean);
    const depthById = new Map();
    while (queue.length) {
      const id = queue.shift();
      if (depthById.has(id)) continue;
      const parentDepths = edges
        .filter((edge) => String(edge?.to || '') === id && depthById.has(String(edge?.from || '')))
        .map((edge) => depthById.get(String(edge.from)));
      depthById.set(id, parentDepths.length ? Math.max(...parentDepths) + 1 : 0);
      queue.push(...outgoing.get(id).filter((target) => !depthById.has(target)));
    }
    for (const id of ids) {
      if (!depthById.has(id)) depthById.set(id, 0);
    }
    return depthById;
  }

  function computeLayout(card) {
    const { steps, edges } = flowParts(card);
    const graph = buildLayoutGraph(steps, edges);
    const start = graph.validIds.has(String(card?.flow?.start || ''))
      ? String(card.flow.start)
      : graph.ids[0];
    const depthById = assignLayoutDepths(graph, edges, start);
    const rows = new Map();
    return graph.ids.map((id) => {
      const depth = depthById.get(id);
      const row = rows.get(depth) || 0;
      rows.set(depth, row + 1);
      return { id, x: 45 + (depth * 230), y: 42 + (row * 120) };
    });
  }

  function edgeEndpoints(card, edge) {
    const { nodes } = flowParts(card);
    const source = nodes.find((node) => String(node?.id || '') === String(edge?.from || ''));
    const target = nodes.find((node) => String(node?.id || '') === String(edge?.to || ''));
    if (!source || !target) return null;
    const label = String(edge?.label || 'next');
    const sourceOffset = label === 'true' ? 23 : (label === 'false' ? 49 : 36);
    return {
      from: { x: Number(source.x) + NODE_WIDTH, y: Number(source.y) + sourceOffset },
      to: { x: Number(target.x), y: Number(target.y) + (NODE_HEIGHT / 2) },
    };
  }

  function buildEdgePath(from, to) {
    const distance = Math.max(54, Math.abs(to.x - from.x) * .48);
    const direction = to.x >= from.x ? 1 : -1;
    return `M ${from.x} ${from.y} C ${from.x + (distance * direction)} ${from.y}, `
      + `${to.x - (distance * direction)} ${to.y}, ${to.x} ${to.y}`;
  }

  function appendArrowDefinition(svg) {
    const defs = createSvgElement('defs');
    const marker = createSvgElement('marker', {
      id: 'automation-canvas-arrow', markerWidth: 8, markerHeight: 8,
      refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth',
    });
    marker.appendChild(createSvgElement('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: '#568fdc' }));
    defs.appendChild(marker);
    svg.appendChild(defs);
  }

  function appendEdge(state, edge, index) {
    const points = edgeEndpoints(state.card, edge);
    if (!points) return;
    const label = String(edge?.label || 'next');
    const group = createSvgElement('g', { 'data-edge-index': index });
    const pathData = buildEdgePath(points.from, points.to);
    const path = createSvgElement('path', {
      d: pathData,
      class: `automation-flow-edge is-${label}`,
      'marker-end': 'url(#automation-canvas-arrow)',
    });
    const hit = createSvgElement('path', { d: pathData, class: 'automation-flow-edge-hit' });
    hit.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      state.callbacks.onDeleteEdge(index);
    });
    const text = createSvgElement('text', {
      x: (points.from.x + points.to.x) / 2,
      y: ((points.from.y + points.to.y) / 2) - 6,
      class: 'automation-flow-edge-label',
    });
    text.textContent = label === 'next' ? '' : label;
    group.append(path, hit, text);
    state.nodes.edges.appendChild(group);
  }

  function drawEdges(state) {
    const svg = state.nodes.edges;
    svg.replaceChildren();
    appendArrowDefinition(svg);
    flowParts(state.card).edges.forEach((edge, index) => appendEdge(state, edge, index));
    if (!state.connecting) return;
    const source = edgeEndpoints(state.card, {
      from: state.connecting.from,
      to: state.connecting.from,
      label: state.connecting.label,
    })?.from;
    if (!source) return;
    svg.appendChild(createSvgElement('path', {
      d: buildEdgePath(source, state.connecting.point),
      class: 'automation-flow-edge-draft',
    }));
  }

  function outputLabels(step) {
    return step.type === 'condition' ? ['true', 'false'] : ['next'];
  }

  function beginConnection(state, event, step, label) {
    event.preventDefault();
    event.stopPropagation();
    state.connecting = {
      pointerId: event.pointerId,
      from: String(step.id),
      label,
      point: canvasPoint(state, event),
    };
    state.nodes.canvas.setPointerCapture(event.pointerId);
    drawEdges(state);
  }

  function createPort(state, step, label, input = false) {
    const port = document.createElement('button');
    port.className = `automation-canvas-port ${input ? 'is-input' : 'is-output'}`;
    port.type = 'button';
    port.dataset.label = label;
    port.title = input ? '连接到此步骤' : `${label} 分支：拖到目标步骤`;
    if (!input) {
      port.addEventListener('pointerdown', (event) => beginConnection(state, event, step, label));
    }
    return port;
  }

  function beginNodeDrag(state, event, step, element) {
    if (event.button !== 0 || event.target.closest('.automation-canvas-port')) return;
    event.preventDefault();
    event.stopPropagation();
    state.selectedId = String(step.id);
    state.dragging = {
      pointerId: event.pointerId,
      id: state.selectedId,
      element,
      origin: canvasPoint(state, event),
      startX: Number.parseFloat(element.style.left) || 0,
      startY: Number.parseFloat(element.style.top) || 0,
      moved: false,
    };
    state.nodes.canvas.setPointerCapture(event.pointerId);
    state.callbacks.onSelectStep(state.selectedId);
  }

  function createCanvasNode(state, step) {
    const flowNode = flowParts(state.card).nodes.find((node) => String(node?.id || '') === String(step.id));
    if (!flowNode) return null;
    const element = document.createElement('article');
    element.className = 'automation-canvas-node';
    if (String(step.id) === String(state.card.flow?.start || '')) element.classList.add('is-start');
    if (String(step.id) === state.selectedId) element.classList.add('is-selected');
    element.dataset.stepId = String(step.id);
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `编辑步骤：${step.name || '未命名步骤'}`);
    element.style.left = `${Number(flowNode.x) || 0}px`;
    element.style.top = `${Number(flowNode.y) || 0}px`;
    const name = document.createElement('strong');
    name.textContent = step.name || '未命名步骤';
    const detail = document.createElement('span');
    detail.textContent = step.selector || step.url || step.text || '点击查看详细设置';
    const type = document.createElement('b');
    type.className = 'automation-canvas-node-type';
    type.textContent = LABELS[step.type] || step.type;
    element.append(createPort(state, step, 'input', true), name, detail, type);
    for (const label of outputLabels(step)) element.appendChild(createPort(state, step, label));
    element.addEventListener('pointerdown', (event) => beginNodeDrag(state, event, step, element));
    element.addEventListener('click', () => state.callbacks.onSelectStep(String(step.id)));
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      state.callbacks.onSelectStep(String(step.id));
    });
    return element;
  }

  function renderNodes(state) {
    state.nodes.canvasNodes.replaceChildren();
    const { steps } = flowParts(state.card);
    state.nodes.canvasEmpty.hidden = steps.length > 0;
    state.nodes.canvasNodes.append(...steps.map((step) => createCanvasNode(state, step)).filter(Boolean));
    drawEdges(state);
  }

  function canvasPoint(state, event) {
    const bounds = state.nodes.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - state.panX) / state.zoom,
      y: (event.clientY - bounds.top - state.panY) / state.zoom,
    };
  }

  function applyTransform(state) {
    state.nodes.viewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    state.nodes.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function moveDraggedNode(state, event) {
    const drag = state.dragging;
    const point = canvasPoint(state, event);
    const x = Math.max(0, drag.startX + point.x - drag.origin.x);
    const y = Math.max(0, drag.startY + point.y - drag.origin.y);
    drag.moved = drag.moved || Math.abs(x - drag.startX) > 2 || Math.abs(y - drag.startY) > 2;
    drag.element.style.left = `${Math.round(x)}px`;
    drag.element.style.top = `${Math.round(y)}px`;
    const node = flowParts(state.card).nodes.find((item) => String(item?.id || '') === drag.id);
    if (node) Object.assign(node, { x: Math.round(x), y: Math.round(y) });
    drawEdges(state);
  }

  function handlePointerMove(state, event) {
    if (state.dragging?.pointerId === event.pointerId) moveDraggedNode(state, event);
    if (state.panning?.pointerId === event.pointerId) {
      state.panX = state.panning.startPanX + event.clientX - state.panning.clientX;
      state.panY = state.panning.startPanY + event.clientY - state.panning.clientY;
      applyTransform(state);
    }
    if (state.connecting?.pointerId === event.pointerId) {
      state.connecting.point = canvasPoint(state, event);
      drawEdges(state);
    }
  }

  function finishPointer(state, event) {
    if (state.dragging?.pointerId === event.pointerId) {
      const { id, moved } = state.dragging;
      state.dragging = null;
      if (moved) state.callbacks.onMoveNode(id);
      renderNodes(state);
    }
    if (state.connecting?.pointerId === event.pointerId) {
      const connection = state.connecting;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.automation-canvas-node');
      state.connecting = null;
      if (target?.dataset.stepId && target.dataset.stepId !== connection.from) {
        state.callbacks.onConnect(connection.from, connection.label, target.dataset.stepId);
      } else {
        drawEdges(state);
      }
    }
    if (state.panning?.pointerId === event.pointerId) state.panning = null;
  }

  function beginPan(state, event) {
    if (event.button !== 0 || event.target.closest('.automation-canvas-node, .automation-flow-edge-hit')) return;
    state.panning = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startPanX: state.panX,
      startPanY: state.panY,
    };
    state.nodes.canvas.setPointerCapture(event.pointerId);
  }

  function setZoom(state, value) {
    state.zoom = Math.min(1.6, Math.max(.5, Math.round(value * 10) / 10));
    applyTransform(state);
  }

  function bindCanvasEvents(state) {
    state.nodes.canvas.addEventListener('pointerdown', (event) => beginPan(state, event));
    state.nodes.canvas.addEventListener('pointermove', (event) => handlePointerMove(state, event));
    state.nodes.canvas.addEventListener('pointerup', (event) => finishPointer(state, event));
    state.nodes.canvas.addEventListener('pointercancel', (event) => finishPointer(state, event));
    state.nodes.zoomOut.addEventListener('click', () => setZoom(state, state.zoom - .1));
    state.nodes.zoomIn.addEventListener('click', () => setZoom(state, state.zoom + .1));
    state.nodes.zoomReset.addEventListener('click', () => {
      Object.assign(state, { zoom: 1, panX: 0, panY: 0 });
      applyTransform(state);
    });
    state.nodes.autoLayout.addEventListener('click', () => {
      const layout = computeLayout(state.card);
      const positions = new Map(layout.map((node) => [node.id, node]));
      for (const node of flowParts(state.card).nodes) {
        const position = positions.get(String(node?.id || ''));
        if (position) Object.assign(node, { x: position.x, y: position.y });
      }
      state.callbacks.onLayout();
    });
  }

  function createFlowCanvas(nodes, callbacks = {}) {
    const state = {
      nodes,
      callbacks: {
        onSelectStep: callbacks.onSelectStep || (() => {}),
        onMoveNode: callbacks.onMoveNode || (() => {}),
        onConnect: callbacks.onConnect || (() => {}),
        onDeleteEdge: callbacks.onDeleteEdge || (() => {}),
        onLayout: callbacks.onLayout || (() => {}),
      },
      card: { steps: [], flow: { nodes: [], edges: [] } },
      zoom: 1,
      panX: 0,
      panY: 0,
      selectedId: '',
      dragging: null,
      connecting: null,
      panning: null,
    };
    bindCanvasEvents(state);
    applyTransform(state);
    return Object.freeze({
      render(card, selectedId = '') {
        state.card = card;
        state.selectedId = String(selectedId || '');
        renderNodes(state);
      },
      resetViewport() {
        Object.assign(state, { zoom: 1, panX: 0, panY: 0 });
        applyTransform(state);
      },
    });
  }

  window.AutomationFlowCanvas = Object.freeze({ createFlowCanvas, computeLayout, buildEdgePath });
}
