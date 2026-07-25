'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createAiSoftwareUiTools } = require('../../services/ai-software-ui-tools');
const { normalizeSoftwareCardData } = require('./software-card-data');

const CARD_FILE_NAME = 'automation-cards.json';

function normalizeState(source = {}) {
  const items = (Array.isArray(source.items) ? source.items : []).filter((item) => (
    item && typeof item === 'object' && String(item.id || '').trim()
  )).map((item) => ({
    ...item,
    cardData: normalizeSoftwareCardData(item.cardData),
  }));
  const selected = String(source.selectedId || '').trim();
  return {
    items,
    selectedId: items.some((item) => item.id === selected)
      ? selected
      : String(items[0]?.id || ''),
  };
}

function createStore(dataDir) {
  const filePath = path.join(path.resolve(dataDir), CARD_FILE_NAME);
  function read() {
    if (!fs.existsSync(filePath)) {
      return { exists: false, state: { items: [], selectedId: '' } };
    }
    return {
      exists: true,
      state: normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}')),
    };
  }
  function write(source = {}) {
    const state = normalizeState(source);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify({
        schemaVersion: 1,
        domain: 'software',
        updatedAt: new Date().toISOString(),
        ...state,
      }, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, filePath);
    } finally {
      try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch (_) {}
    }
    return state;
  }
  return { filePath, read, write };
}

function connectionFromTarget(target) {
  return {
    id: String(target.profileId || ''),
    name: String(target.name || '外部软件'),
    online: true,
    profileId: String(target.profileId || ''),
    tools: [{ name: 'manage_card' }],
    target,
  };
}

function createSoftwareAutomationBridge(options = {}) {
  const store = createStore(options.cardCacheDir);
  const runs = new Map();
  const listTargets = () => (
    options.browserRuntimeManager?.externalApp?.listAutomationTargets?.() || []
  );
  const listConnections = () => listTargets().map(connectionFromTarget);
  const getConnection = (id) => listConnections().find((item) => item.id === String(id)) || null;

  function selectCard(id) {
    const cached = store.read();
    const item = cached.state.items.find((entry) => entry.id === String(id || '').trim());
    if (!item) throw new Error('自动化卡片不存在或已被删除');
    return { item, state: store.write({ ...cached.state, selectedId: item.id }) };
  }

  async function runCard(connection, args = {}) {
    const selected = selectCard(args.id);
    const controller = new AbortController();
    runs.get(connection.id)?.abort();
    runs.set(connection.id, controller);
    const tools = createAiSoftwareUiTools({
      windowBridge: options.browserRuntimeManager?.windowBridge,
      cursorSidecarService: null,
      target: connection.target,
    });
    const steps = selected.item.cardData.steps;
    try {
      for (const [index, step] of steps.entries()) {
        if (controller.signal.aborted) return { stopped: true };
        options.onProgress?.({
          domain: 'software',
          taskId: `${connection.id}:${selected.item.id}`,
          cardId: selected.item.id,
          targetId: connection.id,
          step: index + 1,
          total: steps.length,
        });
        await tools.execute('software_ui', {
          ...(step.args || {}),
          ...step,
          action: step.action,
        });
      }
      return { completed: true, steps: steps.length };
    } finally {
      if (runs.get(connection.id) === controller) runs.delete(connection.id);
    }
  }

  async function dispatch(connectionId, tool, args = {}) {
    const connection = getConnection(connectionId);
    if (!connection) throw new Error('所选软件窗口已经关闭');
    if (tool !== 'manage_card') throw new Error(`Software runner 不支持工具: ${tool}`);
    if (args.action === 'stop') {
      const run = runs.get(connection.id);
      run?.abort();
      runs.delete(connection.id);
      return { stopped: Boolean(run) };
    }
    if (args.action !== 'run') throw new Error(`不支持的卡片动作: ${args.action}`);
    return runCard(connection, args);
  }

  return Object.freeze({
    cardCacheFilePath: store.filePath,
    dispatch,
    dispose: () => {
      for (const controller of runs.values()) controller.abort();
      const stopped = runs.size;
      runs.clear();
      return stopped;
    },
    getCardCacheState: store.read,
    getConnection,
    listConnections,
    selectCard,
    setCardCacheState: store.write,
  });
}

module.exports = {
  CARD_FILE_NAME,
  createSoftwareAutomationBridge,
  createStore,
};
