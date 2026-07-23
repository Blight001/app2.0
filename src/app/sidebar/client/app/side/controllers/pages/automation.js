'use strict';

{
  const automationState = {
    cards: [],
    currentId: '',
    loaded: false,
    loading: false,
    dirty: false,
    dialogs: null,
    editor: null,
    flowWindow: null,
    nodes: {},
  };

  function automationElement(id) {
    return document.getElementById(id);
  }

  function setAutomationStatus(message = '', type = '') {
    const node = automationState.nodes.status;
    if (!node) return;
    node.textContent = message;
    node.className = `automation-status${type ? ` is-${type}` : ''}`;
  }

  function setAutomationBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.defaultText = button.textContent;
      button.textContent = busyText;
    } else {
      button.textContent = button.dataset.defaultText || button.textContent;
    }
    button.disabled = busy;
  }

  function formatAutomationDate(value) {
    const timestamp = Date.parse(String(value || ''));
    if (!Number.isFinite(timestamp)) return '尚未保存';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  function createAutomationCardItem(card) {
    const button = document.createElement('button');
    button.className = `automation-card-item${card.id === automationState.currentId ? ' is-active' : ''}`;
    button.type = 'button';
    button.dataset.cardId = card.id;
    const name = document.createElement('strong');
    name.textContent = card.name || '未命名卡片';
    const date = document.createElement('span');
    date.textContent = formatAutomationDate(card.savedAt);
    const count = document.createElement('span');
    count.className = 'automation-card-step-count';
    count.textContent = `${Number(card.stepCount || 0)} 步`;
    button.append(name, date, count);
    button.addEventListener('click', () => void selectAutomationCard(card.id));
    return button;
  }

  function renderAutomationCardList() {
    const { list, count } = automationState.nodes;
    count.textContent = `${automationState.cards.length} 张卡片`;
    if (!automationState.cards.length) {
      const empty = document.createElement('div');
      empty.className = 'automation-empty-list';
      empty.textContent = '软件卡片库为空，可新建或导入卡片。';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...automationState.cards.map(createAutomationCardItem));
  }

  function markAutomationDirty() {
    automationState.dirty = true;
    automationState.nodes.mode.textContent = automationState.currentId ? '已修改，尚未保存' : '新建卡片';
    automationState.nodes.title.textContent = automationState.nodes.name.value.trim() || '未命名卡片';
  }

  function readAutomationFormCard() {
    const card = automationState.editor.getCard();
    card.name = automationState.nodes.name.value.trim();
    card.website = automationState.nodes.website.value.trim();
    card.description = automationState.nodes.description.value.trim();
    const retries = Number(automationState.nodes.retries.value);
    if (Number.isFinite(retries) && retries >= 0) card.retry_count = retries;
    else delete card.retry_count;
    const popupRules = automationState.nodes.popups.value.split(/\r?\n/)
      .map((rule) => rule.trim()).filter(Boolean);
    if (popupRules.length) card.popups = popupRules;
    else delete card.popups;
    return card;
  }

  function showAutomationCard(cardData, options = {}) {
    automationState.dialogs?.closeAll();
    automationState.flowWindow?.close();
    const card = window.AutomationCardEditor.normalizeCardData(cardData);
    automationState.currentId = String(options.id || '');
    automationState.dirty = options.dirty === true;
    automationState.nodes.name.value = card.name;
    automationState.nodes.website.value = card.website;
    automationState.nodes.description.value = card.description;
    automationState.nodes.retries.value = card.retry_count ?? '';
    automationState.nodes.popups.value = Array.isArray(card.popups)
      ? card.popups.join('\n')
      : String(card.popups || '');
    automationState.nodes.title.textContent = card.name || '未命名卡片';
    automationState.nodes.mode.textContent = automationState.currentId ? '编辑卡片' : '新建卡片';
    automationState.nodes.empty.hidden = true;
    automationState.nodes.form.hidden = false;
    automationState.editor.setCard(card, markAutomationDirty);
    renderAutomationCardList();
    setAutomationStatus('');
  }

  function showAutomationEmpty() {
    automationState.dialogs?.closeAll();
    automationState.flowWindow?.close();
    automationState.currentId = '';
    automationState.nodes.form.hidden = true;
    automationState.nodes.empty.hidden = false;
    renderAutomationCardList();
  }

  async function readAndSelectAutomationCard(cardId) {
    const api = window.aiFree && window.aiFree.automation;
    if (!api) throw new Error('软件自动化能力不可用');
    const result = await api.getCard({ id: cardId });
    if (!result || !result.ok || !result.data || !result.data.cardData) {
      throw new Error(result?.error || '卡片读取失败');
    }
    const selected = await api.selectCard({ id: cardId });
    if (!selected || !selected.ok) {
      throw new Error(selected?.error || selected?.message || '卡片选择失败');
    }
    return result.data;
  }

  async function selectAutomationCard(id) {
    const cardId = String(id || '').trim();
    if (!cardId || automationState.loading) return;
    automationState.loading = true;
    setAutomationStatus('正在读取卡片…');
    try {
      const data = await readAndSelectAutomationCard(cardId);
      showAutomationCard(data.cardData, { id: data.id });
    } catch (error) {
      setAutomationStatus(error?.message || String(error), 'error');
    } finally {
      automationState.loading = false;
    }
  }

  async function applyAutomationCardList(result, preferredId) {
    automationState.cards = Array.isArray(result.cards) ? result.cards : [];
    automationState.loaded = true;
    renderAutomationCardList();
    const selectedId = String(preferredId || automationState.currentId || result.selectedId || '');
    const exists = automationState.cards.some((card) => card.id === selectedId);
    automationState.loading = false;
    if (exists) await selectAutomationCard(selectedId);
    else if (!automationState.currentId) showAutomationEmpty();
  }

  async function loadAutomationCards(preferredId = '') {
    if (automationState.loading) return;
    automationState.loading = true;
    setAutomationStatus('正在同步软件卡片库…');
    try {
      const result = await window.aiFree?.automation.listCards();
      if (!result?.ok) throw new Error(result?.error || result?.message || '卡片列表读取失败');
      await applyAutomationCardList(result, preferredId);
      setAutomationStatus('');
    } catch (error) {
      automationState.loading = false;
      renderAutomationCardList();
      setAutomationStatus(error?.message || String(error), 'error');
    }
  }

  function validateAutomationCardSettings(cardData) {
    const nodes = automationState.nodes;
    const invalidField = cardData.name
      ? [nodes.website, nodes.retries].find((field) => !field.checkValidity())
      : nodes.name;
    if (!invalidField) return true;
    const message = cardData.name ? invalidField.validationMessage : '请填写卡片名称。';
    setAutomationStatus(message, 'error');
    automationState.dialogs.open(nodes.editDialog, { focusTarget: invalidField });
    return false;
  }

  async function saveAutomationCard(options = {}) {
    const button = automationState.nodes.save;
    const cardData = readAutomationFormCard();
    if (!validateAutomationCardSettings(cardData)) return null;
    setAutomationBusy(button, true, '保存中…');
    try {
      const result = await window.aiFree?.automation.saveCard({
        id: automationState.currentId,
        cardData,
      });
      if (!result?.ok || !result.data?.id) throw new Error(result?.error || '卡片保存失败');
      automationState.currentId = result.data.id;
      automationState.dirty = false;
      await loadAutomationCards(result.data.id);
      if (!options.silent) setAutomationStatus('卡片已保存到软件卡片库。', 'success');
      return result.data;
    } catch (error) {
      setAutomationStatus(error?.message || String(error), 'error');
      return null;
    } finally {
      setAutomationBusy(button, false);
    }
  }

  async function deleteAutomationCard() {
    if (!automationState.currentId) {
      showAutomationEmpty();
      return;
    }
    const name = automationState.nodes.name.value.trim() || '当前卡片';
    if (!window.confirm(`确定删除“${name}”吗？此操作无法撤销。`)) return;
    setAutomationStatus('正在删除卡片…');
    try {
      const result = await window.aiFree?.automation.deleteCard({ id: automationState.currentId });
      if (!result?.ok) throw new Error(result?.error || '卡片删除失败');
      automationState.currentId = '';
      showAutomationEmpty();
      await loadAutomationCards(result.data?.selectedId || '');
      setAutomationStatus('卡片已删除。', 'success');
    } catch (error) {
      setAutomationStatus(error?.message || String(error), 'error');
    }
  }

  async function runAutomationCard() {
    const hasSteps = readAutomationFormCard().steps.length > 0;
    if (!hasSteps) {
      setAutomationStatus('至少添加一个步骤后才能运行。', 'error');
      return;
    }
    const needsSave = automationState.dirty || !automationState.currentId;
    const saved = needsSave
      ? await saveAutomationCard({ silent: true }) : { id: automationState.currentId };
    if (!saved) return;
    await dispatchAutomationCardRun(saved.id);
  }

  function readAutomationRunOptions() {
    const inputText = automationState.nodes.runInputs.value.trim();
    return {
      inputs: inputText ? JSON.parse(inputText) : {},
      startStep: Number(automationState.nodes.startStep.value) || 1,
      loopCount: Number(automationState.nodes.loopCount.value) || 1,
    };
  }

  function formatAutomationRunResult(execution) {
    if (execution.summary) return execution.summary;
    if (execution.success === false) {
      return `第 ${execution.stepIndex || '?'} 步失败：${execution.error || '未知错误'}`;
    }
    return `流程运行完成：${execution.stepsExecuted || 0}/${execution.stepsTotal || 0} 步`;
  }

  async function dispatchAutomationCardRun(cardId) {
    const button = automationState.nodes.run;
    setAutomationBusy(button, true, '运行中…');
    automationState.nodes.stop.hidden = false;
    setAutomationStatus('已发送到当前连接的自动化浏览器，请等待执行完成…');
    try {
      const result = await window.aiFree?.automation.runCard({
        id: cardId,
        ...readAutomationRunOptions(),
      });
      if (!result?.ok) throw new Error(result?.error || '卡片运行失败');
      const execution = result.data?.result || {};
      const summary = formatAutomationRunResult(execution);
      setAutomationStatus(summary, execution.success === false ? 'error' : 'success');
    } catch (error) {
      setAutomationStatus(error?.message || String(error), 'error');
    } finally {
      setAutomationBusy(button, false);
      automationState.nodes.stop.hidden = true;
    }
  }

  async function stopAutomationCard() {
    automationState.nodes.stop.disabled = true;
    setAutomationStatus('正在停止自动化流程…');
    try {
      const result = await window.aiFree?.automation.stopCard();
      if (!result?.ok) throw new Error(result?.error || '停止自动化失败');
      setAutomationStatus(
        result.data?.stopped ? '已发送停止指令。' : '当前没有正在运行的自动化流程。',
        'success',
      );
    } catch (error) {
      setAutomationStatus(error?.message || String(error), 'error');
    } finally {
      automationState.nodes.stop.disabled = false;
    }
  }

  function applyAutomationJson() {
    try {
      const card = automationState.editor.applyJson(automationState.nodes.json.value);
      automationState.nodes.name.value = card.name;
      automationState.nodes.website.value = card.website;
      automationState.nodes.description.value = card.description;
      markAutomationDirty();
      setAutomationStatus('JSON 已应用，请检查流程后保存。', 'success');
    } catch (error) {
      setAutomationStatus(`JSON 格式错误：${error?.message || error}`, 'error');
    }
  }

  async function importAutomationFiles(files) {
    if (!files?.length) return;
    try {
      const cards = await window.AutomationCardTransfer.importFiles(files);
      let lastId = '';
      for (const cardData of cards) {
        const result = await window.aiFree?.automation.saveCard({ cardData });
        if (!result?.ok) throw new Error(result?.error || '导入卡片保存失败');
        lastId = result.data.id;
      }
      await loadAutomationCards(lastId);
      setAutomationStatus(`已导入并保存 ${cards.length} 张卡片。`, 'success');
    } catch (error) {
      setAutomationStatus(`导入失败：${error?.message || error}`, 'error');
    }
  }

  function syncAutomationSettingsToEditor(nodes) {
    const card = automationState.editor.card;
    card.name = nodes.name.value;
    card.website = nodes.website.value;
    card.description = nodes.description.value;
    const retries = Number(nodes.retries.value);
    if (nodes.retries.value && Number.isFinite(retries)) card.retry_count = retries;
    else delete card.retry_count;
    const popups = nodes.popups.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (popups.length) card.popups = popups;
    else delete card.popups;
  }

  async function copyAutomationJson() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('系统剪贴板不可用');
      await navigator.clipboard.writeText(automationState.nodes.json.value);
      setAutomationStatus('完整卡片 JSON 已复制。', 'success');
    } catch (error) {
      setAutomationStatus(`复制失败：${error?.message || error}`, 'error');
    }
  }

  function bindAutomationForm() {
    const nodes = automationState.nodes;
    for (const input of [nodes.name, nodes.website, nodes.description, nodes.retries, nodes.popups]) {
      input.addEventListener('input', () => {
        syncAutomationSettingsToEditor(nodes);
        automationState.editor.syncJson();
        markAutomationDirty();
      });
    }
    nodes.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveAutomationCard();
    });
    nodes.applyJson.addEventListener('click', applyAutomationJson);
    nodes.copyJson.addEventListener('click', () => void copyAutomationJson());
    nodes.run.addEventListener('click', () => void runAutomationCard());
    nodes.stop.addEventListener('click', () => void stopAutomationCard());
    nodes.delete.addEventListener('click', () => void deleteAutomationCard());
  }

  function bindAutomationToolbar() {
    const nodes = automationState.nodes;
    nodes.newCard.addEventListener('click', () => {
      showAutomationCard({ name: '新自动化卡片', website: '', description: '', steps: [] }, { dirty: true });
      automationState.dialogs.open(nodes.editDialog, { focusTarget: nodes.name });
      nodes.name.select();
    });
    nodes.refresh.addEventListener('click', () => void loadAutomationCards());
    nodes.importButton.addEventListener('click', () => nodes.importFile.click());
    nodes.importFile.addEventListener('change', () => {
      void importAutomationFiles(nodes.importFile.files);
      nodes.importFile.value = '';
    });
    nodes.exportButton.addEventListener('click', () => {
      if (!automationState.editor || automationState.nodes.form.hidden) {
        setAutomationStatus('请先选择一张卡片。', 'error');
        return;
      }
      window.AutomationCardTransfer.exportCard(readAutomationFormCard());
      setAutomationStatus('当前卡片已导出。', 'success');
    });
    automationElement('automation-panel')?.addEventListener('automation:refresh', () => {
      void loadAutomationCards();
    });
    document.querySelector('[data-tab="automation-panel"]')?.addEventListener('click', () => {
      if (!automationState.loaded) void loadAutomationCards();
    });
  }

  function collectAutomationNodes() {
    const ids = {
      addStep: 'automation-add-step', applyJson: 'automation-apply-json',
      copyJson: 'automation-copy-json',
      count: 'automation-card-count', delete: 'automation-delete-card',
      description: 'automation-card-description', empty: 'automation-editor-empty',
      editButton: 'automation-edit-card', editDialog: 'automation-edit-dialog',
      flowButton: 'automation-edit-flow',
      form: 'automation-card-form', importButton: 'automation-import-card',
      exportButton: 'automation-export-card',
      importFile: 'automation-import-file', json: 'automation-card-json',
      list: 'automation-card-list', mode: 'automation-editor-mode',
      name: 'automation-card-name', newCard: 'automation-new-card',
      jsonButton: 'automation-edit-json', jsonDialog: 'automation-json-dialog',
      popups: 'automation-card-popups',
      retries: 'automation-card-retries', runInputs: 'automation-run-inputs',
      startStep: 'automation-run-start-step', loopCount: 'automation-run-loop-count',
      refresh: 'automation-refresh', run: 'automation-run-card',
      stop: 'automation-stop-card',
      save: 'automation-save-card', status: 'automation-status',
      title: 'automation-editor-title', website: 'automation-card-website',
    };
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, automationElement(id)]));
  }

  function initializeAutomationPage() {
    automationState.nodes = collectAutomationNodes();
    if (!automationState.nodes.form || !window.AutomationCardEditor) return;
    automationState.editor = window.AutomationCardEditor.createEditor({
      json: automationState.nodes.json,
    });
    automationState.dialogs = window.AutomationDialogs.create();
    automationState.flowWindow = window.AutomationFlowWindow.create({
      getCard: readAutomationFormCard,
      onChange(card) {
        automationState.editor.setCard(card, markAutomationDirty);
        markAutomationDirty();
      },
      onSave: () => saveAutomationCard(),
      onError: (message) => setAutomationStatus(message, 'error'),
    });
    bindAutomationForm();
    automationState.dialogs.bind(automationState.nodes);
    automationState.nodes.flowButton.addEventListener('click', automationState.flowWindow.open);
    bindAutomationToolbar();
    window.aiFree?.automation.onProgress?.((event) => {
      if (!event || event.cardId !== automationState.currentId) return;
      const loop = Number(event.loopCount) > 1
        ? `循环 ${event.loopIndex}/${event.loopCount} · `
        : '';
      if (event.phase === 'step_start') {
        setAutomationStatus(`${loop}正在执行 ${event.stepIndex}/${event.stepTotal}：${event.stepName}`);
      } else if (event.phase === 'step_failed') {
        setAutomationStatus(`${loop}第 ${event.stepIndex} 步失败：${event.error}`, 'error');
      } else if (event.phase === 'stopped') {
        setAutomationStatus('自动化流程已停止。', 'success');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initializeAutomationPage);
}
