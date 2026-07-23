'use strict';

{
  const STEP_LABELS = Object.freeze({
    navigate: '访问网页',
    click: '点击元素',
    type: '输入内容',
    wait: '等待条件',
    condition: '判断分支',
    get_credits: '获取积分',
    save_cookies: '自动保存会话',
    clear_current_page_cache: '清理缓存',
    screenshot: '截图',
  });
  const STEP_TYPES = Object.keys(STEP_LABELS);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStepId(index) {
    return `step_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizeCardData(source = {}) {
    const card = source && typeof source === 'object' && !Array.isArray(source)
      ? cloneJson(source)
      : {};
    card.name = String(card.name || '');
    card.website = String(card.website || '');
    card.description = String(card.description || '');
    card.steps = (Array.isArray(card.steps) ? card.steps : []).map((sourceStep, index) => {
      const step = sourceStep && typeof sourceStep === 'object' && !Array.isArray(sourceStep)
        ? { ...sourceStep }
        : {};
      step.id = String(step.id || createStepId(index + 1));
      step.type = STEP_TYPES.includes(String(step.type || '')) ? String(step.type) : 'click';
      step.name = String(step.name || STEP_LABELS[step.type]);
      return step;
    });
    return card;
  }

  function routeLabelsForStep(step) {
    return step.type === 'condition' ? ['true', 'false'] : ['next'];
  }

  function getFlowEdges(card) {
    return Array.isArray(card.flow?.edges) ? card.flow.edges : [];
  }

  function findRouteTarget(card, step, label) {
    const labels = label === 'next' ? ['next', 'default', ''] : [label];
    const edge = getFlowEdges(card).find((item) => (
      String(item?.from || '') === step.id && labels.includes(String(item?.label || 'next'))
    ));
    return String(edge?.to || '');
  }

  function normalizeFlowCollections(card, stepIds) {
    card.flow.nodes = (Array.isArray(card.flow.nodes) ? card.flow.nodes : [])
      .filter((node) => stepIds.has(String(node?.id || '')));
    card.flow.edges = (Array.isArray(card.flow.edges) ? card.flow.edges : [])
      .filter((edge) => {
        const from = String(edge?.from || '');
        const to = String(edge?.to || '');
        return stepIds.has(from) && stepIds.has(to) && from !== to;
      });
  }

  function normalizeFlowNodes(card) {
    for (const [index, step] of card.steps.entries()) {
      const node = card.flow.nodes.find((item) => String(item?.id || '') === step.id);
      if (!node) {
        card.flow.nodes.push({ id: step.id, x: 40, y: 40 + (index * 120) });
        continue;
      }
      node.x = Number.isFinite(Number(node.x)) ? Number(node.x) : 40;
      node.y = Number.isFinite(Number(node.y)) ? Number(node.y) : 40 + (index * 120);
    }
  }

  function ensureFlow(card) {
    const creating = !card.flow || typeof card.flow !== 'object' || Array.isArray(card.flow);
    if (creating) {
      card.flow = { version: 1, start: card.steps[0]?.id || '', nodes: [], edges: [] };
    }
    const stepIds = new Set(card.steps.map((step) => step.id));
    normalizeFlowCollections(card, stepIds);
    const start = String(card.flow.start || '');
    card.flow.start = stepIds.has(start) ? start : (card.steps[0]?.id || '');
    normalizeFlowNodes(card);
    if (creating) {
      card.flow.edges = card.steps.slice(0, -1).map((step, index) => ({
        from: step.id,
        to: card.steps[index + 1].id,
        label: 'next',
      }));
    }
    return card.flow;
  }

  function setRouteTarget(card, step, label, targetId) {
    const flow = ensureFlow(card);
    const matches = label === 'next' ? ['next', 'default', ''] : [label];
    flow.edges = flow.edges.filter((edge) => !(
      String(edge?.from || '') === step.id && matches.includes(String(edge?.label || 'next'))
    ));
    if (targetId) flow.edges.push({ from: step.id, to: targetId, label });
  }

  function createRouteField(card, step, label, rerender) {
    const entries = [['', '流程结束'], ...card.steps
      .filter((candidate) => candidate.id !== step.id)
      .map((candidate, index) => [candidate.id, `${index + 1}. ${candidate.name}`])];
    const title = label === 'true' ? '条件为真' : (label === 'false' ? '条件为假' : '下一步');
    return window.AutomationStepFields.createSelectField(
      title,
      findRouteTarget(card, step, label),
      entries,
      (value) => {
      setRouteTarget(card, step, label, value);
      rerender();
      },
    );
  }

  function buildStepSummary(step, index) {
    const button = document.createElement('button');
    button.className = 'automation-step-summary';
    button.type = 'button';
    const number = document.createElement('span');
    number.className = 'automation-step-index';
    number.textContent = String(index + 1);
    const copy = document.createElement('span');
    copy.className = 'automation-step-copy';
    const name = document.createElement('strong');
    name.textContent = step.name || STEP_LABELS[step.type] || '未命名步骤';
    const detail = document.createElement('span');
    detail.textContent = step.selector || step.url || step.text || step.condition_mode || '点击展开设置';
    copy.append(name, detail);
    const badge = document.createElement('span');
    badge.className = 'automation-step-badge';
    badge.textContent = STEP_LABELS[step.type] || step.type;
    button.append(number, copy, badge);
    return button;
  }

  function addRouteFields(body, editor, step) {
    for (const label of routeLabelsForStep(step)) {
      body.appendChild(createRouteField(editor.card, step, label, () => editor.render()));
    }
    if (step.type === 'condition') {
      body.appendChild(window.AutomationStepFields.createSelectField(
        '判断方式',
        step.condition_mode || 'selector_exists',
        [
        ['selector_exists', '元素存在'],
        ['selector_missing', '元素不存在'],
        ['text_exists', '文本存在'],
        ['text_missing', '文本不存在'],
        ['url_matches', '网址匹配'],
        ],
        (value) => {
          step.condition_mode = value;
          editor.syncJson();
        },
      ));
    }
  }

  function addStepControls(body, editor, index) {
    const controls = document.createElement('div');
    controls.className = 'automation-step-controls';
    const actions = [
      ['上移', () => editor.moveStep(index, -1), index === 0],
      ['下移', () => editor.moveStep(index, 1), index === editor.card.steps.length - 1],
      ['复制', () => editor.copyStep(index), false],
      ['删除', () => editor.deleteStep(index), false, true],
    ];
    for (const [label, action, disabled, danger] of actions) {
      const button = document.createElement('button');
      button.className = `automation-step-action${danger ? ' is-danger' : ''}`;
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener('click', action);
      controls.appendChild(button);
    }
    body.appendChild(controls);
  }

  function buildStepCard(editor, step, index) {
    const article = document.createElement('article');
    article.className = 'automation-step';
    const summary = buildStepSummary(step, index);
    const body = document.createElement('div');
    body.className = 'automation-step-body';
    body.hidden = editor.openStep !== index;
    summary.addEventListener('click', () => {
      editor.openStep = editor.openStep === index ? -1 : index;
      editor.selectedStepId = editor.openStep === index ? step.id : '';
      body.hidden = editor.openStep !== index;
      editor.canvas?.render(editor.card, editor.selectedStepId);
    });
    window.AutomationStepFields.addCommonFields(body, editor, step, STEP_TYPES, STEP_LABELS);
    addRouteFields(body, editor, step);
    body.appendChild(window.AutomationStepFields.createCheckbox(
      step,
      'optional',
      '失败时跳过此步骤',
      () => editor.syncJson(),
    ));
    window.AutomationStepFields.addSpecialFields(body, editor, step);
    addStepControls(body, editor, index);
    article.append(summary, body);
    return article;
  }

  function syncEditorJson(editor) {
    editor.nodes.json.value = JSON.stringify(editor.card, null, 2);
    editor.canvas?.render(editor.card, editor.selectedStepId);
    editor.onChange(editor.card);
  }

  function renderStepList(editor) {
    const { list, count } = editor.nodes;
    list.replaceChildren();
    count.textContent = `${editor.card.steps.length} 个步骤`;
    if (!editor.card.steps.length) {
      const empty = document.createElement('div');
      empty.className = 'automation-flow-empty';
      empty.textContent = '暂无步骤，请选择步骤类型后点击“添加步骤”。';
      list.appendChild(empty);
    } else {
      list.append(...editor.card.steps.map((step, index) => buildStepCard(editor, step, index)));
    }
  }

  function renderEditor(editor) {
    ensureFlow(editor.card);
    if (editor.nodes.list && editor.nodes.count) renderStepList(editor);
    syncEditorJson(editor);
  }

  function setEditorCard(editor, card, onChange = () => {}) {
    editor.card = normalizeCardData(card);
    editor.openStep = -1;
    editor.selectedStepId = '';
    editor.onChange = () => {};
    renderEditor(editor);
    editor.canvas?.resetViewport();
    editor.onChange = onChange;
  }

  function addEditorStep(editor, type, position) {
    const stepType = STEP_TYPES.includes(type) ? type : 'click';
    const step = {
      id: createStepId(editor.card.steps.length + 1),
      name: STEP_LABELS[stepType],
      type: stepType,
    };
    const previous = editor.card.steps.at(-1);
    editor.card.steps.push(step);
    const previousRoute = previous?.type === 'condition' ? 'true' : 'next';
    if (previous && !findRouteTarget(editor.card, previous, previousRoute)) {
      setRouteTarget(editor.card, previous, previousRoute, step.id);
    }
    ensureFlow(editor.card);
    const flowNode = editor.card.flow.nodes.find((node) => node.id === step.id);
    if (flowNode && position) {
      flowNode.x = Math.max(0, Math.round(Number(position.x) || 0));
      flowNode.y = Math.max(0, Math.round(Number(position.y) || 0));
    }
    editor.openStep = editor.card.steps.length - 1;
    editor.selectedStepId = step.id;
    renderEditor(editor);
  }

  function moveEditorStep(editor, index, offset) {
    const target = index + offset;
    if (target < 0 || target >= editor.card.steps.length) return;
    const [step] = editor.card.steps.splice(index, 1);
    editor.card.steps.splice(target, 0, step);
    editor.openStep = target;
    editor.selectedStepId = step.id;
    renderEditor(editor);
  }

  function copyEditorStep(editor, index) {
    const copy = cloneJson(editor.card.steps[index]);
    copy.id = createStepId(editor.card.steps.length + 1);
    copy.name = `${copy.name || STEP_LABELS[copy.type]} 副本`;
    editor.card.steps.splice(index + 1, 0, copy);
    ensureFlow(editor.card);
    editor.openStep = index + 1;
    editor.selectedStepId = copy.id;
    renderEditor(editor);
  }

  function deleteEditorStep(editor, index) {
    const [removed] = editor.card.steps.splice(index, 1);
    if (editor.card.flow) {
      editor.card.flow.nodes = (editor.card.flow.nodes || []).filter((node) => node.id !== removed.id);
      editor.card.flow.edges = (editor.card.flow.edges || [])
        .filter((edge) => edge.from !== removed.id && edge.to !== removed.id);
      if (editor.card.flow.start === removed.id) editor.card.flow.start = editor.card.steps[0]?.id || '';
    }
    editor.openStep = -1;
    editor.selectedStepId = '';
    renderEditor(editor);
  }

  function createEditor(nodes) {
    const editor = {
      nodes,
      card: normalizeCardData({}),
      openStep: -1,
      selectedStepId: '',
      canvas: null,
      onChange: () => {},
      syncJson() {
        syncEditorJson(this);
      },
      render() {
        renderEditor(this);
      },
      setCard(card, onChange = () => {}) {
        setEditorCard(this, card, onChange);
      },
      getCard() {
        return cloneJson(this.card);
      },
      addStep(type, position) {
        addEditorStep(this, type, position);
      },
      moveStep(index, offset) {
        moveEditorStep(this, index, offset);
      },
      copyStep(index) {
        copyEditorStep(this, index);
      },
      deleteStep(index) {
        deleteEditorStep(this, index);
      },
      applyJson(text) {
        const parsed = JSON.parse(text);
        this.card = normalizeCardData(parsed);
        this.openStep = -1;
        this.selectedStepId = '';
        this.render();
        return this.getCard();
      },
    };
    if (window.AutomationFlowCanvas && nodes.canvas) {
      editor.canvas = window.AutomationFlowCanvas.createFlowCanvas(nodes, {
        onSelectStep(stepId) {
          editor.selectedStepId = stepId;
          editor.openStep = editor.card.steps.findIndex((step) => step.id === stepId);
          renderEditor(editor);
        },
        onMoveNode() {
          syncEditorJson(editor);
        },
        onConnect(from, label, to) {
          const step = editor.card.steps.find((item) => item.id === from);
          if (step) setRouteTarget(editor.card, step, label, to);
          renderEditor(editor);
        },
        onDeleteEdge(index) {
          ensureFlow(editor.card).edges.splice(index, 1);
          renderEditor(editor);
        },
        onLayout() {
          renderEditor(editor);
        },
      });
    }
    return editor;
  }

  window.AutomationCardEditor = Object.freeze({ createEditor, normalizeCardData });
}
