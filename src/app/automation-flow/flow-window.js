'use strict';

{
  const MESSAGE_SCOPE = 'ai-free-automation-flow';
  let editor = null;

  function element(id) {
    return document.getElementById(id);
  }

  function post(type, payload = {}) {
    window.opener?.postMessage({ scope: MESSAGE_SCOPE, type, ...payload }, '*');
  }

  function setStatus(message = '', error = false) {
    const status = element('flow-window-status');
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  function collectNodes() {
    return {
      list: element('automation-flow-list'),
      count: element('automation-step-count'),
      json: element('automation-card-json'),
      canvas: element('automation-flow-canvas'),
      viewport: element('automation-flow-viewport'),
      edges: element('automation-flow-edges'),
      canvasNodes: element('automation-flow-nodes'),
      canvasEmpty: element('automation-canvas-empty'),
      autoLayout: element('automation-auto-layout'),
      zoomOut: element('automation-zoom-out'),
      zoomReset: element('automation-zoom-reset'),
      zoomIn: element('automation-zoom-in'),
    };
  }

  function publishChange() {
    post('change', { card: editor.getCard() });
    setStatus('有未保存的修改');
  }

  function initializeCard(card) {
    editor.setCard(card, publishChange);
    element('flow-window-title').textContent = `${card?.name || '未命名卡片'} · 流程与详细步骤`;
    setStatus('');
  }

  function addPaletteNode(type, position) {
    editor.addStep(type, position);
    setStatus('已添加节点');
  }

  function bindPalette() {
    document.querySelectorAll('[data-step-type]').forEach((button) => {
      button.addEventListener('click', () => addPaletteNode(button.dataset.stepType));
      button.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-ai-free-step', button.dataset.stepType);
      });
    });
    const canvas = element('automation-flow-canvas');
    canvas.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    canvas.addEventListener('drop', (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/x-ai-free-step');
      if (!type) return;
      const point = editor.canvas.toCanvasPoint(event);
      addPaletteNode(type, { x: point.x - 84, y: point.y - 36 });
    });
  }

  function bindWindowActions() {
    element('flow-window-close').addEventListener('click', () => window.close());
    element('flow-window-save').addEventListener('click', () => {
      setStatus('正在保存…');
      post('save', { card: editor.getCard() });
    });
    window.addEventListener('message', (event) => {
      if (event.source !== window.opener || event.data?.scope !== MESSAGE_SCOPE) return;
      if (event.data.type === 'initialize' && event.data.card) initializeCard(event.data.card);
      if (event.data.type === 'saved' && !event.data.ok) setStatus(event.data.error || '保存失败', true);
    });
  }

  function initialize() {
    editor = window.AutomationCardEditor.createEditor(collectNodes());
    bindPalette();
    bindWindowActions();
    post('ready');
  }

  document.addEventListener('DOMContentLoaded', initialize);
}
