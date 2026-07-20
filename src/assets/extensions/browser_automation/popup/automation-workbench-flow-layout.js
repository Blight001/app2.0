'use strict';

const SIDEBAR_FLOW_LAYOUT = {
    marginX: 34,
    marginY: 40,
    laneWidth: 244,
    stepHeight: 140
};

function getSidebarFlowLayoutForIndex(index = 0) {
    return {
        x: SIDEBAR_FLOW_LAYOUT.marginX,
        y: SIDEBAR_FLOW_LAYOUT.marginY + index * SIDEBAR_FLOW_LAYOUT.stepHeight
    };
}

// 分层自动布局：主干自上而下走同一竖列（行=执行深度），
// 条件分支向右展开占用相邻车道（列=分支序），回环边不参与分层。
// 长流程竖排更贴合侧边栏画布的纵向空间。
function computeSidebarFlowLayeredLayout(stepIds = [], edges = [], start = '') {
    const ids = (Array.isArray(stepIds) ? stepIds : []).map((id) => String(id || '').trim()).filter(Boolean);
    if (ids.length === 0) return new Map();
    const idSet = new Set(ids);
    const outgoing = buildSidebarFlowOutgoing(ids, edges, idSet);
    const graph = buildSidebarFlowForwardGraph(ids, outgoing, idSet.has(start) ? start : ids[0]);
    const depth = computeSidebarFlowDepth(ids, graph.forward, graph.pendingIncoming);
    const row = computeSidebarFlowRows(ids, depth, graph.preds);
    return createSidebarFlowPositions(ids, depth, row);
}

function buildSidebarFlowOutgoing(ids, edges, idSet) {
    const outgoing = new Map(ids.map((id) => [id, []]));
    (Array.isArray(edges) ? edges : []).forEach((edge) => {
        const from = String(edge?.from || '').trim();
        const to = String(edge?.to || '').trim();
        if (idSet.has(from) && idSet.has(to) && from !== to) {
            outgoing.get(from).push({ to, label: String(edge?.label || 'next').trim().toLowerCase() });
        }
    });
    return outgoing;
}

function buildSidebarFlowForwardGraph(ids, outgoing, startId) {
    const visited = new Set();
    const stackSet = new Set();
    const forward = new Map(ids.map((id) => [id, []]));
    const preds = new Map(ids.map((id) => [id, []]));
    const pendingIncoming = new Map(ids.map((id) => [id, 0]));
    const dfs = (id) => {
        visited.add(id);
        stackSet.add(id);
        (outgoing.get(id) || []).forEach((link) => {
            if (stackSet.has(link.to)) {
                return;
            }
            forward.get(id).push(link);
            preds.get(link.to).push({ from: id, label: link.label });
            pendingIncoming.set(link.to, (pendingIncoming.get(link.to) || 0) + 1);
            if (!visited.has(link.to)) {
                dfs(link.to);
            }
        });
        stackSet.delete(id);
    };
    dfs(startId);
    ids.filter((id) => !visited.has(id)).forEach(dfs);
    return { forward, preds, pendingIncoming };
}

function computeSidebarFlowDepth(ids, forward, pendingIncoming) {
    const depth = new Map();
    const queue = ids.filter((id) => (pendingIncoming.get(id) || 0) === 0);
    queue.forEach((id) => depth.set(id, 0));
    let cursor = 0;
    while (cursor < queue.length) {
        const id = queue[cursor];
        cursor += 1;
        (forward.get(id) || []).forEach((link) => {
            depth.set(link.to, Math.max(depth.get(link.to) || 0, (depth.get(id) || 0) + 1));
            pendingIncoming.set(link.to, (pendingIncoming.get(link.to) || 0) - 1);
            if ((pendingIncoming.get(link.to) || 0) === 0) {
                queue.push(link.to);
            }
        });
    }
    ids.filter((id) => !depth.has(id)).forEach((id) => depth.set(id, 0));
    return depth;
}

function computeSidebarFlowRows(ids, depth, preds) {
    const byDepth = new Map();
    ids.forEach((id) => {
        const level = depth.get(id) || 0;
        if (!byDepth.has(level)) {
            byDepth.set(level, []);
        }
        byDepth.get(level).push(id);
    });
    const orderIndex = new Map(ids.map((id, index) => [id, index]));
    const row = new Map();
    Array.from(byDepth.keys()).sort((a, b) => a - b).forEach((level) => {
        const bucket = byDepth.get(level) || [];
        const scored = bucket.map((id, localIndex) => {
            const sources = preds.get(id) || [];
            const score = sources.length === 0
                ? localIndex
                : sources.reduce((sum, pred) => {
                    const bias = pred.label === 'false' ? 0.51 : pred.label === 'true' ? -0.02 : 0;
                    return sum + (row.get(pred.from) || 0) + bias;
                }, 0) / sources.length;
            return { id, score };
        });
        scored.sort((a, b) => a.score - b.score || (orderIndex.get(a.id) || 0) - (orderIndex.get(b.id) || 0));
        let nextFree = -Infinity;
        scored.forEach((item) => {
            // -0.01 让分支汇合点（重心恰为 .5）取整时贴回主干行
            const assigned = Math.max(Math.round(item.score - 0.01), nextFree);
            row.set(item.id, assigned);
            nextFree = assigned + 1;
        });
    });
    return row;
}

function createSidebarFlowPositions(ids, depth, row) {
    const positions = new Map();
    const minRow = ids.reduce((minimum, id) => Math.min(minimum, row.get(id) || 0), Infinity);
    ids.forEach((id) => {
        positions.set(id, {
            x: SIDEBAR_FLOW_LAYOUT.marginX + ((row.get(id) || 0) - minRow) * SIDEBAR_FLOW_LAYOUT.laneWidth,
            y: SIDEBAR_FLOW_LAYOUT.marginY + (depth.get(id) || 0) * SIDEBAR_FLOW_LAYOUT.stepHeight
        });
    });
    return positions;
}

function normalizeSidebarFlowEdge(edge, index, stepIdSet) {
    const from = firstSidebarFlowText(edge, ['from', 'source', 'fromId']);
    const to = firstSidebarFlowText(edge, ['to', 'target', 'toId']);
    if (!from || !to || !stepIdSet.has(from) || !stepIdSet.has(to) || from === to) return null;
    const label = firstSidebarFlowText(edge, ['label', 'branch', 'condition']) || 'next';
    const fromPort = firstSidebarFlowText(edge, ['fromPort', 'sourcePort']).toLowerCase() === 'left' ? 'left' : 'right';
    const toPort = firstSidebarFlowText(edge, ['toPort', 'targetPort']).toLowerCase() === 'right' ? 'right' : 'left';
    return {
        id: String(edge?.id || '').trim() || buildSidebarFlowEdgeId(from, to, label, index),
        from, to, label, fromPort, toPort
    };
}

function firstSidebarFlowText(source, keys) {
    for (const key of keys) {
        const value = String(source?.[key] || '').trim();
        if (value) return value;
    }
    return '';
}

function normalizeSidebarFlowForSteps(flow = null, steps = []) {
    const safeSteps = ensureSidebarStepIds(steps);
    const stepIds = safeSteps.map((step, index) => getSidebarStepId(step, index)).filter(Boolean);
    const stepIdSet = new Set(stepIds);
    const hasExplicitFlow = isSidebarFlowRecord(flow);
    const source = hasExplicitFlow ? flow : {};
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const sourceEdges = Array.isArray(source.edges) ? source.edges : [];
    const nodeById = new Map();

    sourceNodes.forEach((node) => {
        const id = String(node?.id || node?.stepId || '').trim();
        if (!id || !stepIdSet.has(id)) {
            return;
        }
        nodeById.set(id, {
            id,
            x: Number.isFinite(Number(node.x)) ? Number(node.x) : undefined,
            y: Number.isFinite(Number(node.y)) ? Number(node.y) : undefined
        });
    });

    let edges = sourceEdges.map((edge, index) => normalizeSidebarFlowEdge(edge, index, stepIdSet)).filter(Boolean);

    const edgeKeys = new Set();
    edges = edges.filter((edge) => {
        const key = `${edge.from}::${edge.to}::${edge.label}`;
        if (edgeKeys.has(key)) {
            return false;
        }
        edgeKeys.add(key);
        return true;
    });

    if (edges.length === 0 && !hasExplicitFlow && stepIds.length > 1) {
        edges = stepIds.slice(0, -1).map((from, index) => {
            const to = stepIds[index + 1];
            return {
                id: buildSidebarFlowEdgeId(from, to, 'next', index),
                from,
                to,
                label: 'next',
                fromPort: 'right',
                toPort: 'left'
            };
        });
    }

    const start = String(source.start || source.start_node_id || source.startNodeId || '').trim();
    const resolvedStart = stepIdSet.has(start) ? start : (stepIds[0] || '');

    // 没有显式坐标的节点按连线做分层布局，而不是一字排开
    const layeredPositions = computeSidebarFlowLayeredLayout(stepIds, edges, resolvedStart);
    const nodes = safeSteps.map((step, index) => {
        const id = getSidebarStepId(step, index);
        const existing = nodeById.get(id) || {};
        const fallback = layeredPositions.get(id) || getSidebarFlowLayoutForIndex(index);
        return {
            id,
            x: Number.isFinite(Number(existing.x)) ? Math.max(0, Number(existing.x)) : fallback.x,
            y: Number.isFinite(Number(existing.y)) ? Math.max(0, Number(existing.y)) : fallback.y
        };
    });

    return {
        version: 1,
        start: resolvedStart,
        nodes,
        edges
    };
}

function isSidebarFlowRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getSidebarFlowNode(stepId = '') {
    const id = String(stepId || '').trim();
    return sidebarFlowState.nodes.find((node) => String(node.id || '') === id) || null;
}

function getSidebarFlowStepById(steps = [], stepId = '') {
    const id = String(stepId || '').trim();
    return (Array.isArray(steps) ? steps : []).find((step, index) => getSidebarStepId(step, index) === id) || null;
}

function buildSidebarFlowNodeMeta(step = {}) {
    const value = firstSidebarFlowText(step, [
        'selector', 'url', 'text', 'wait_for_text', 'script', 'condition_mode', 'condition'
    ]);
    if (!value) {
        return '';
    }
    return value.length > 42 ? `${value.slice(0, 39)}...` : value;
}

// 把折点序列拼成带圆角的正交路径（直线段 + 拐角二次贝塞尔）。
function buildSidebarFlowRoundedPath(points = [], radius = 14) {
    if (!Array.isArray(points) || points.length < 2) {
        return '';
    }
    const parts = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length - 1; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];
        const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        if (!(r >= 1)) {
            parts.push(`L ${curr.x} ${curr.y}`);
            continue;
        }
        const inX = curr.x - ((curr.x - prev.x) / inLen) * r;
        const inY = curr.y - ((curr.y - prev.y) / inLen) * r;
        const outX = curr.x + ((next.x - curr.x) / outLen) * r;
        const outY = curr.y + ((next.y - curr.y) / outLen) * r;
        parts.push(`L ${inX} ${inY}`, `Q ${curr.x} ${curr.y} ${outX} ${outY}`);
    }
    const last = points[points.length - 1];
    parts.push(`L ${last.x} ${last.y}`);
    return parts.join(' ');
}

// 生成一条连线的正交走线与标签锚点。
// 正向（目标在源出口前方）走"横-竖-横"；
// 目标在上/下方时先探出端口，沿车道间隙竖走，再从目标行前的空隙横穿接入，不横穿节点；
// 同行反向（回环）绕到两节点下方；同侧端口沿外侧车道竖走。
// spread 用于同一端点引出/汇入的多条线依次错开，避免完全重叠缠绕。
function buildSidebarFlowEdgeGeometry(sx, sy, tx, ty, fromPort = 'right', toPort = 'left', spread = 0) {
    const fromDir = fromPort === 'right' ? 1 : -1;
    const toDir = toPort === 'right' ? 1 : -1;
    const offset = Number(spread) || 0;
    const stub = 26 + offset;
    const sameSide = fromDir === toDir;
    const dx = tx - sx;
    const dy = ty - sy;
    let points;
    let labelX;
    let labelY;

    if (sameSide) {
        const laneX = (fromDir > 0 ? Math.max(sx, tx) : Math.min(sx, tx)) + fromDir * (stub + 22);
        points = [
            { x: sx, y: sy },
            { x: laneX, y: sy },
            { x: laneX, y: ty },
            { x: tx, y: ty }
        ];
        labelX = laneX;
        labelY = (sy + ty) / 2 - 6;
    } else if (dx * fromDir >= stub * 2 + 8) {
        // 正向：中点竖折
        const midX = (sx + tx) / 2 + fromDir * offset;
        points = Math.abs(dy) < 2
            ? [{ x: sx, y: sy }, { x: tx, y: ty }]
            : [
                { x: sx, y: sy },
                { x: midX, y: sy },
                { x: midX, y: ty },
                { x: tx, y: ty }
            ];
        labelX = (sx + midX) / 2;
        labelY = sy - 6;
    } else if (Math.abs(dy) >= 56) {
        // 目标在上/下方：沿源侧车道间隙竖走，从目标行前的空隙横穿接入
        const gapY = ty > sy ? ty - 44 - offset : ty + 44 + offset;
        points = [
            { x: sx, y: sy },
            { x: sx + fromDir * stub, y: sy },
            { x: sx + fromDir * stub, y: gapY },
            { x: tx + toDir * stub, y: gapY },
            { x: tx + toDir * stub, y: ty },
            { x: tx, y: ty }
        ];
        labelX = (sx + fromDir * stub + tx + toDir * stub) / 2;
        labelY = gapY - 6;
    } else {
        // 同行反向（回环）：绕到两节点下方
        const detourY = Math.max(sy, ty) + 86 + offset;
        points = [
            { x: sx, y: sy },
            { x: sx + fromDir * stub, y: sy },
            { x: sx + fromDir * stub, y: detourY },
            { x: tx + toDir * stub, y: detourY },
            { x: tx + toDir * stub, y: ty },
            { x: tx, y: ty }
        ];
        labelX = (sx + tx) / 2;
        labelY = detourY - 6;
    }

    return { path: buildSidebarFlowRoundedPath(points), labelX, labelY };
}

function getSidebarFlowCanvasSize(nodes = []) {
    const maxX = nodes.reduce((value, node) => Math.max(value, Number(node.x || 0)), 0);
    const maxY = nodes.reduce((value, node) => Math.max(value, Number(node.y || 0)), 0);
    return {
        width: Math.max(680, maxX + 260),
        height: Math.max(360, maxY + 170)
    };
}
