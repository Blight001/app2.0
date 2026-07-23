'use strict';

const crypto = require('crypto');
const { SAFE_STEP_TYPES } = require('./native-tool-definitions');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSafeStep(step, index) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`第 ${index + 1} 步必须是对象`);
  }
  const type = text(step.type);
  if (!SAFE_STEP_TYPES.includes(type)) throw new Error(`第 ${index + 1} 步类型不受支持: ${type}`);
  if (type === 'condition' && text(step.condition_mode || step.condition) === 'js') {
    throw new Error('软件自动化不允许 JS 条件');
  }
  if (step.script !== undefined) throw new Error('软件自动化不允许任意页面脚本');
}

function normalizeCardData(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('卡片数据必须是对象');
  const card = clone(source);
  card.name = text(card.name);
  if (!card.name) throw new Error('卡片名称不能为空');
  card.website = text(card.website);
  if (!Array.isArray(card.steps)) throw new Error('卡片 steps 必须是数组');
  card.steps = card.steps.map((step, index) => {
    assertSafeStep(step, index);
    return {
      ...step,
      id: text(step.id) || `step_${index + 1}_${crypto.randomBytes(4).toString('hex')}`,
      name: text(step.name) || text(step.type),
      type: text(step.type),
    };
  });
  normalizeFlow(card);
  return card;
}

function normalizeFlow(card) {
  const ids = new Set(card.steps.map((step) => step.id));
  const source = card.flow && typeof card.flow === 'object' && !Array.isArray(card.flow)
    ? card.flow
    : {};
  const nodes = (Array.isArray(source.nodes) ? source.nodes : [])
    .filter((node) => ids.has(text(node?.id)))
    .map((node) => ({ id: text(node.id), x: Number(node.x) || 0, y: Number(node.y) || 0 }));
  for (const [index, step] of card.steps.entries()) {
    if (!nodes.some((node) => node.id === step.id)) nodes.push({ id: step.id, x: 40 + index * 220, y: 40 });
  }
  const edges = (Array.isArray(source.edges) ? source.edges : []).filter((edge) => (
    ids.has(text(edge?.from)) && ids.has(text(edge?.to)) && text(edge.from) !== text(edge.to)
  )).map((edge) => ({ from: text(edge.from), to: text(edge.to), label: text(edge.label) || 'next' }));
  card.flow = {
    version: Number(source.version) || 1,
    start: ids.has(text(source.start)) ? text(source.start) : (card.steps[0]?.id || ''),
    nodes,
    edges,
  };
}

function readState(store) {
  const cached = store.read();
  return cached?.state && Array.isArray(cached.state.items)
    ? cached.state
    : { items: [], selectedId: '' };
}

function findItem(state, args = {}) {
  const id = text(args.id) || text(state.selectedId);
  const byId = state.items.find((item) => text(item?.id) === id);
  if (byId) return byId;
  const name = text(args.card_name);
  const matches = name
    ? state.items.filter((item) => text(item?.cardName || item?.cardData?.name) === name)
    : [];
  if (matches.length > 1) throw new Error(`存在多个同名卡片「${name}」，请使用 id`);
  if (matches[0]) return matches[0];
  throw new Error(id || name ? '自动化卡片不存在或已删除' : '当前没有自动化卡片');
}

function itemSummary(item) {
  return {
    id: text(item.id),
    cardName: text(item.cardName || item.cardData?.name || item.id),
    stepCount: Array.isArray(item.cardData?.steps) ? item.cardData.steps.length : 0,
    savedAt: text(item.savedAt),
  };
}

module.exports = { clone, findItem, itemSummary, normalizeCardData, readState, text };
