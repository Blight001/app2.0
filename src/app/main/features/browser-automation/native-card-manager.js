'use strict';

const crypto = require('crypto');
const { findItem, itemSummary, normalizeCardData, readState, text } = require('./native-card-data');
const { SAFE_STEP_TYPES } = require('./native-tool-definitions');
const { runNativeCard } = require('./native-card-runner');

function saveState(store, state) {
  return store.write(state);
}

function saveItem(store, state, cardData, requestedId = '') {
  const id = text(requestedId) || crypto.randomUUID();
  const index = state.items.findIndex((item) => text(item?.id) === id);
  const item = { id, cardName: cardData.name, cardData, savedAt: new Date().toISOString() };
  const items = [...state.items];
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
  saveState(store, { items, selectedId: id });
  return { ...itemSummary(item), cardData, overwritten: index >= 0, cardCount: items.length };
}

function stepIndex(args, length, allowEnd = false) {
  const value = Number(args.step_index);
  const maximum = allowEnd ? length + 1 : length;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`step_index 必须在 1-${maximum} 之间`);
  }
  return value - 1;
}

function editStep(store, state, item, args, action) {
  const card = normalizeCardData(item.cardData);
  if (action === 'insert_step') {
    const index = args.step_index
      ? stepIndex(args, card.steps.length, true)
      : Math.min(card.steps.length, Math.max(0, Number(args.insert_after) || card.steps.length));
    card.steps.splice(index, 0, args.stepData);
  } else {
    const index = stepIndex(args, card.steps.length);
    if (action === 'delete_step') card.steps.splice(index, 1);
    if (action === 'patch_step') {
      const patch = args.stepPatch || args.stepData || args.patch || args.step;
      card.steps[index] = args.replace === true ? patch : { ...card.steps[index], ...patch };
    }
    if (action === 'move_step') {
      const target = Number(args.to_step_index) - 1;
      if (!Number.isInteger(target) || target < 0 || target >= card.steps.length) {
        throw new Error('to_step_index 超出卡片步骤范围');
      }
      card.steps.splice(target, 0, ...card.steps.splice(index, 1));
    }
  }
  return saveItem(store, state, normalizeCardData(card), item.id);
}

function deleteItem(store, state, item) {
  const items = state.items.filter((entry) => text(entry?.id) !== text(item.id));
  saveState(store, { items, selectedId: text(items[0]?.id) });
  return { deleted: true, id: text(item.id), cardCount: items.length };
}

function rules() {
  return {
    rules: true,
    stepTypes: SAFE_STEP_TYPES,
    forbidden: ['external_script', 'condition_mode=js', '手动 Cookie 管理'],
    flow: {
      version: 1,
      nodes: [{ id: '步骤 id', x: 40, y: 40 }],
      edges: [{ from: '步骤 id', to: '步骤 id', label: 'next | true | false' }],
      start: '起始步骤 id',
    },
  };
}

async function runCardLoops(runtime, profileId, card, args) {
  const loopCount = Math.max(1, Math.min(100, Number(args.loop_count) || 1));
  const runs = [];
  for (let index = 0; index < loopCount; index += 1) {
    if (args.signal?.aborted) {
      return { success: false, stopped: true, errorCode: 'CARD_RUN_STOPPED', error: '自动化运行已停止' };
    }
    const run = await runNativeCard(runtime, profileId, card, {
      ...args,
      loopIndex: index + 1,
      onProgress: typeof args.onProgress === 'function'
        ? (event) => args.onProgress({ ...event, loopIndex: index + 1, loopCount })
        : undefined,
    });
    runs.push(run);
    if (run.success === false) return { ...run, loopIndex: index + 1, loopCount, runs };
  }
  const last = runs.at(-1) || {};
  return {
    ...last,
    loopCount,
    runs,
    summary: loopCount > 1
      ? `循环执行完成：${loopCount} 次，共 ${runs.reduce((sum, run) => sum + Number(run.stepsExecuted || 0), 0)} 步`
      : '',
  };
}

async function manageNativeCard(context, args = {}) {
  const { store, runtime, profileId } = context;
  const action = text(args.action).toLowerCase();
  if (action === 'rules') return rules();
  const state = readState(store);
  if (action === 'list') return { items: state.items.map(itemSummary), selectedId: state.selectedId };
  if (action === 'write') {
    return { action, ...saveItem(store, state, normalizeCardData(args.cardData), args.id) };
  }
  const item = findItem(state, args);
  if (action === 'get') return { ...itemSummary(item), cardData: item.cardData };
  if (action === 'delete') return deleteItem(store, state, item);
  if (['patch_step', 'insert_step', 'delete_step', 'move_step'].includes(action)) {
    return { action, ...editStep(store, state, item, args, action) };
  }
  if (action === 'run') {
    const card = normalizeCardData(item.cardData);
    saveState(store, { ...state, selectedId: item.id });
    return runCardLoops(runtime, profileId, card, args);
  }
  throw new Error(`不支持的 manage_card action: ${action}`);
}

module.exports = { manageNativeCard, rules };
