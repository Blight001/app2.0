'use strict';

const crypto = require('crypto');
const { callOptional, firstText } = require('../../../shared/safe-values');
const { normalizeCardData: normalizeNativeCardData } = require('../browser-automation/native-card-data');

function readCardState(bridge) {
  const cached = callOptional(bridge, 'getCardCacheState');
  const state = cached && cached.state;
  return state && Array.isArray(state.items) ? state : { items: [], selectedId: '' };
}

function cardSummary(item) {
  return {
    id: firstText(item && item.id),
    name: firstText(
      item && item.cardName,
      item && item.cardData && item.cardData.name,
      item && item.id,
      '未命名卡片',
    ),
    stepCount: item && item.cardData && Array.isArray(item.cardData.steps)
      ? item.cardData.steps.length
      : 0,
    savedAt: firstText(item && item.savedAt),
  };
}

function requireCardStore(bridge) {
  if (!bridge || typeof bridge.getCardCacheState !== 'function'
    || typeof bridge.setCardCacheState !== 'function') {
    throw new Error('软件卡片库不可用');
  }
}

function findCard(bridge, input = {}) {
  requireCardStore(bridge);
  const state = readCardState(bridge);
  const id = firstText(input.id, state.selectedId).trim();
  const item = state.items.find((entry) => firstText(entry && entry.id).trim() === id);
  if (!item) throw new Error(id ? `自动化卡片不存在或已被删除: ${id}` : '当前没有自动化卡片');
  return { item, state };
}

function normalizeCardData(input = {}) {
  return normalizeNativeCardData(input.cardData);
}

async function getAutomationCards({ bridge }) {
  const cached = callOptional(bridge, 'getCardCacheState') || { state: { items: [], selectedId: '' } };
  const items = cached.state && Array.isArray(cached.state.items) ? cached.state.items : [];
  return {
    ok: true,
    selectedId: firstText(cached.state && cached.state.selectedId),
    cards: items.map(cardSummary).filter((item) => item.id),
  };
}

function getAutomationCard(bridge, input = {}) {
  const { item } = findCard(bridge, input);
  return {
    ok: true,
    data: {
      ...cardSummary(item),
      cardData: item.cardData && typeof item.cardData === 'object' ? item.cardData : {},
    },
  };
}

function saveAutomationCard(bridge, input = {}, options = {}) {
  requireCardStore(bridge);
  const state = readCardState(bridge);
  const cardData = normalizeCardData(input);
  const requestedId = firstText(input.id).trim();
  const existingIndex = state.items.findIndex((item) => firstText(item && item.id) === requestedId);
  const id = requestedId || options.createId();
  const savedAt = options.nowIso();
  const previous = existingIndex >= 0 ? state.items[existingIndex] : {};
  const item = { ...previous, id, cardName: cardData.name, cardData, savedAt };
  const items = [...state.items];
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.push(item);
  const savedState = bridge.setCardCacheState({ items, selectedId: id });
  return { ok: true, data: { ...cardSummary(item), cardData, selectedId: savedState.selectedId } };
}

function deleteAutomationCard(bridge, input = {}) {
  const { item, state } = findCard(bridge, input);
  const deletedId = firstText(item.id);
  const items = state.items.filter((entry) => firstText(entry && entry.id) !== deletedId);
  const previousSelectedId = firstText(state.selectedId);
  const selectionSurvives = items.some((entry) => firstText(entry && entry.id) === previousSelectedId);
  const selectedId = selectionSurvives ? previousSelectedId : firstText(items[0] && items[0].id);
  const savedState = bridge.setCardCacheState({ items, selectedId });
  return { ok: true, data: { deletedId, selectedId: firstText(savedState.selectedId) } };
}

function supportsCardRuns(bridge, connection) {
  const full = callOptional(bridge, 'getConnection', connection && connection.id);
  return full && Array.isArray(full.tools)
    && full.tools.some((tool) => firstText(tool && tool.name) === 'manage_card');
}

async function runAutomationCard(bridge, input = {}, onProgress) {
  const { item } = findCard(bridge, input);
  if (typeof bridge.dispatch !== 'function') throw new Error('浏览器自动化执行通道不可用');
  const connections = callOptional(bridge, 'listConnections') || [];
  const requestedId = firstText(input.connectionId).trim();
  const connection = requestedId
    ? connections.find((entry) => firstText(entry && entry.id) === requestedId)
    : connections.find((entry) => entry && entry.online !== false && supportsCardRuns(bridge, entry));
  if (!connection || !supportsCardRuns(bridge, connection)) {
    throw new Error('没有已连接且支持自动化卡片的浏览器');
  }
  const args = { action: 'run', id: firstText(item.id) };
  if (input.inputs && typeof input.inputs === 'object') args.inputs = input.inputs;
  if (Number(input.startStep) > 0) args.start_step = Math.floor(Number(input.startStep));
  if (Number(input.loopCount) > 1) args.loop_count = Math.min(100, Math.floor(Number(input.loopCount)));
  if (typeof onProgress === 'function') {
    args.onProgress = (event) => onProgress({
      ...event,
      cardId: firstText(item.id),
      connectionId: connection.id,
    });
  }
  const result = await bridge.dispatch(connection.id, 'manage_card', args, { timeoutMs: 30 * 60 * 1000 });
  return { ok: true, data: { connectionId: connection.id, result } };
}

async function stopAutomationCard(bridge) {
  if (typeof bridge?.dispatch !== 'function') throw new Error('浏览器自动化执行通道不可用');
  let stopped = 0;
  for (const connection of callOptional(bridge, 'listConnections') || []) {
    if (!supportsCardRuns(bridge, connection)) continue;
    const result = await bridge.dispatch(connection.id, 'manage_card', { action: 'stop' });
    if (result?.stopped) stopped += 1;
  }
  return { ok: true, data: { stopped } };
}

function selectAutomationCard(bridge, input = {}) {
  const selected = callOptional(bridge, 'selectCard', input && input.id);
  if (!selected || !selected.item) throw new Error('软件卡片库不可用');
  return {
    ok: true,
    selectedId: firstText(selected.state && selected.state.selectedId),
    card: {
      id: firstText(selected.item.id),
      name: firstText(selected.item.cardName, selected.item.cardData && selected.item.cardData.name, selected.item.id, '未命名卡片'),
      stepCount: selected.item.cardData && Array.isArray(selected.item.cardData.steps) ? selected.item.cardData.steps.length : 0,
    },
  };
}

function createAutomationCardService({
  bridge, now = Date.now, logger: _logger = console, onProgress,
}) {
  const context = { bridge };
  const options = {
    createId: () => crypto.randomUUID(),
    nowIso: () => new Date(now()).toISOString(),
  };
  return {
    deleteAutomationCard: (input) => deleteAutomationCard(bridge, input),
    getAutomationCard: (input) => getAutomationCard(bridge, input),
    getAutomationCards: () => getAutomationCards(context),
    runAutomationCard: (input) => runAutomationCard(bridge, input, onProgress),
    saveAutomationCard: (input) => saveAutomationCard(bridge, input, options),
    selectAutomationCard: (input) => selectAutomationCard(bridge, input),
    stopAutomationCard: () => stopAutomationCard(bridge),
  };
}

module.exports = { createAutomationCardService };
