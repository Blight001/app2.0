'use strict';

const crypto = require('crypto');

const SOFTWARE_ACTIONS = new Set([
  'observe',
  'screenshot',
  'click',
  'mouse_click',
  'double_click',
  'right_click',
  'type',
  'press_key',
  'scroll',
  'drag',
  'focus',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSoftwareCardData(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('卡片数据必须是对象');
  }
  const card = clone(source);
  card.name = String(card.name || '').trim();
  if (!card.name) throw new Error('卡片名称不能为空');
  if (card.domain && card.domain !== 'software') {
    throw new Error('Software runner 拒绝非 software 卡片');
  }
  if (!Array.isArray(card.steps)) throw new Error('卡片 steps 必须是数组');
  card.domain = 'software';
  card.steps = card.steps.map((step, index) => {
    const action = String(step?.action || step?.type || '').trim();
    if (!SOFTWARE_ACTIONS.has(action)) {
      throw new Error(`第 ${index + 1} 步不是受支持的软件操作: ${action || '空'}`);
    }
    return {
      ...step,
      id: String(step.id || '').trim() || `software_${crypto.randomUUID()}`,
      name: String(step.name || action).trim(),
      action,
      type: 'software_ui',
    };
  });
  return card;
}

module.exports = {
  SOFTWARE_ACTIONS,
  normalizeSoftwareCardData,
};
