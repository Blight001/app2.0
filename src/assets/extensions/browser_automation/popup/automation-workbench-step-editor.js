'use strict';

function sidebarStepViewValue(step, field, fallback = '') {
    const value = step?.[field];
    return String(value ?? fallback).trim();
}

function buildSidebarSelectOptions(options, selected) {
    return options.map(([value, label]) => (
        `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
    )).join('');
}

function createSidebarStepView(step, index, expanded) {
    const type = sidebarStepViewValue(step, 'type', 'navigate') || 'navigate';
    const name = sidebarStepViewValue(step, 'name', `步骤${index + 1}`) || `步骤${index + 1}`;
    const conditionMode = sidebarStepViewValue(step, 'condition_mode')
        || sidebarStepViewValue(step, 'condition', 'selector_exists')
        || 'selector_exists';
    return {
        step,
        index,
        expandedClass: expanded ? ' is-expanded' : '',
        type,
        name,
        stepId: getSidebarStepId(step, index),
        conditionMode,
        selector: sidebarStepViewValue(step, 'selector'),
        text: sidebarStepViewValue(step, 'text'),
        variable: sidebarStepViewValue(step, 'variable'),
        url: sidebarStepViewValue(step, 'url'),
        timeout: sidebarStepViewValue(step, 'timeout'),
        by: sidebarStepViewValue(step, 'by', 'css_selector') || 'css_selector',
        script: sidebarStepViewValue(step, 'script'),
        waitForText: sidebarStepViewValue(step, 'wait_for_text'),
        waitForElementHidden: sidebarStepViewValue(step, 'wait_for_element_hidden'),
        waitForTextHidden: sidebarStepViewValue(step, 'wait_for_text_hidden'),
        nth: sidebarStepViewValue(step, 'nth'),
        pollInterval: sidebarStepViewValue(step, 'poll_interval_ms'),
        defaultValue: sidebarStepViewValue(step, 'default'),
        clearFirst: step?.clear_first === true || step?.clearFirst === true,
        clickBeforeType: step?.click_before_type === true || step?.clickBeforeType === true,
        optional: step?.optional === true || sidebarStepViewValue(step, 'optional') === 'true'
    };
}

function buildSidebarStepIdentityFields(view) {
    const typeOptions = buildSidebarSelectOptions([
        ['navigate', '访问网页'], ['click', '点击元素'], ['type', '输入内容'], ['wait', '等待条件'],
        ['condition', '判断分支'], ['get_credits', '获取积分'], ['save_cookies', '获取Cookie'],
        ['clear_current_page_cache', '清理当前页缓存'], ['external_script', '执行脚本'], ['screenshot', '截图']
    ], view.type);
    const byOptions = buildSidebarSelectOptions([
        ['css_selector', 'css_selector'], ['text', 'text'], ['auto', 'auto']
    ], view.by);
    const conditionOptions = buildSidebarSelectOptions([
        ['selector_exists', '元素存在'], ['selector_missing', '元素不存在'], ['text_exists', '文本存在'],
        ['text_missing', '文本不存在'], ['url_matches', 'URL 匹配'], ['js', 'JS 表达式']
    ], view.conditionMode);
    return `
      <div class="full"><label>步骤名称</label><input data-sidebar-step-field="name" type="text" value="${escapeHtml(view.name)}"><input data-sidebar-step-field="id" type="hidden" value="${escapeHtml(view.stepId)}"></div>
      <div class="sidebar-step-setting is-visible"><label>步骤类型</label><select data-sidebar-step-field="type">${typeOptions}</select></div>
      <div class="full sidebar-step-type-description" data-step-type-description></div>
      <div class="sidebar-step-setting" data-step-types="click,type,get_credits"><label>选择器类型</label><select data-sidebar-step-field="by">${byOptions}</select></div>
      <div class="sidebar-step-setting" data-step-types="condition"><label>判断方式</label><select data-sidebar-step-field="condition_mode">${conditionOptions}</select></div>
      <div class="full sidebar-step-setting" data-step-types="click,type,wait,condition,get_credits" data-condition-modes="selector_exists,selector_missing"><div class="sidebar-step-selector-head"><label>选择器</label><button type="button" class="button-secondary sidebar-step-selector-btn" data-sidebar-step-action="selector">设置选择器</button></div><input data-sidebar-step-field="selector" type="text" value="${escapeHtml(view.selector)}" placeholder="可直接粘贴 HTML 元素片段"></div>
      <div class="full sidebar-step-setting" data-step-types="type,condition" data-condition-modes="text_exists,text_missing,url_matches"><label data-step-text-label>输入文本（变量默认值）</label><input data-sidebar-step-field="text" type="text" value="${escapeHtml(view.text)}" placeholder="type 步骤要输入的默认文本；运行前可按变量名覆盖"></div>
      <div class="full sidebar-step-setting" data-step-types="type"><label>变量名（仅输入步骤，留空自动按顺序 var1/var2…）</label><input data-sidebar-step-field="variable" type="text" value="${escapeHtml(view.variable)}" placeholder="如 email / password / username"></div>
      <div class="full sidebar-step-setting" data-step-types="navigate"><label>跳转 URL</label><input data-sidebar-step-field="url" type="text" value="${escapeHtml(view.url)}"></div>
    `;
}

function buildSidebarStepOptionFields(view) {
    return `
      <div class="sidebar-step-setting" data-step-types="click,type,get_credits"><label>匹配序号</label><input data-sidebar-step-field="nth" type="number" min="0" step="1" value="${escapeHtml(view.nth)}" placeholder="0"></div>
      <div class="sidebar-step-setting" data-step-types="click,type,condition,get_credits"><label>轮询间隔(ms)</label><input data-sidebar-step-field="poll_interval_ms" type="number" min="50" step="50" value="${escapeHtml(view.pollInterval)}"></div>
      <div class="sidebar-step-setting" data-step-types="navigate,click,type,wait,condition,get_credits"><label>超时(ms)</label><input data-sidebar-step-field="timeout" type="number" min="0" step="100" value="${escapeHtml(view.timeout)}"></div>
      <div class="sidebar-step-setting" data-step-types="navigate,click,type,wait,condition,get_credits,external_script,clear_current_page_cache"><label>可选</label><label style="display:flex;align-items:center;gap:8px;margin:0;"><input data-sidebar-step-field="optional" type="checkbox"${view.optional ? ' checked' : ''}><span>跳过失败继续</span></label></div>
      <div class="full sidebar-step-setting" data-step-types="type"><label>输入行为</label><div class="sidebar-step-checkboxes"><label><input data-sidebar-step-field="clear_first" type="checkbox"${view.clearFirst ? ' checked' : ''}> 输入前清空</label><label><input data-sidebar-step-field="click_before_type" type="checkbox"${view.clickBeforeType ? ' checked' : ''}> 输入前点击</label></div></div>
      <div class="full sidebar-step-setting" data-step-types="wait"><label>等待文本</label><input data-sidebar-step-field="wait_for_text" type="text" value="${escapeHtml(view.waitForText)}"></div>
      <div class="full sidebar-step-setting" data-step-types="wait"><label>等待元素消失</label><input data-sidebar-step-field="wait_for_element_hidden" type="text" value="${escapeHtml(view.waitForElementHidden)}"></div>
      <div class="full sidebar-step-setting" data-step-types="wait"><label>等待文本消失</label><input data-sidebar-step-field="wait_for_text_hidden" type="text" value="${escapeHtml(view.waitForTextHidden)}"></div>
      <div class="full sidebar-step-setting" data-step-types="get_credits"><label>未读取到内容时的默认值</label><input data-sidebar-step-field="default" type="text" value="${escapeHtml(view.defaultValue)}"></div>
      <div class="full sidebar-step-setting" data-step-types="external_script,condition" data-condition-modes="js"><label data-step-script-label>脚本</label><textarea data-sidebar-step-field="script" rows="5">${escapeHtml(view.script)}</textarea></div>
    `;
}

function buildSidebarStepCardHtml(step = {}, index = 0, expanded = false) {
    const view = createSidebarStepView(step, index, expanded);
    return `
      <div class="sidebar-step-card${view.expandedClass}" data-sidebar-step-card data-step-index="${index}" data-step-id="${escapeHtml(view.stepId)}" data-step-type="${escapeHtml(view.type)}">
        <textarea data-sidebar-step-field="raw_json" hidden aria-hidden="true">${escapeHtml(JSON.stringify(step))}</textarea>
        <div class="sidebar-step-card__header"><div class="sidebar-step-card__title-wrap"><h4 class="sidebar-step-card__title">步骤 ${index + 1}-${view.name} <span class="sidebar-step-status" data-step-status></span></h4><div class="sidebar-step-card__summary">${buildSidebarStepSummary(step)}</div></div><div class="sidebar-step-card__actions"><button type="button" class="button-secondary sidebar-step-card__close" data-sidebar-step-action="close" aria-label="关闭节点设置">关闭</button><button type="button" class="button-secondary" data-sidebar-step-action="up">上移</button><button type="button" class="button-secondary" data-sidebar-step-action="down">下移</button><button type="button" class="button-secondary" data-sidebar-step-action="delete">删除</button></div></div>
        <div class="sidebar-step-error" data-step-error hidden></div>
        <div class="sidebar-step-card__body"><div class="sidebar-step-card__grid">${buildSidebarStepIdentityFields(view)}${buildSidebarStepOptionFields(view)}</div></div>
      </div>
    `;
}

function updateSidebarStepSettingsVisibility(stepCard) {
    if (!stepCard) {
        return;
    }
    const type = String(stepCard.querySelector('[data-sidebar-step-field="type"]')?.value || 'navigate').trim().toLowerCase() || 'navigate';
    const conditionMode = String(stepCard.querySelector('[data-sidebar-step-field="condition_mode"]')?.value || 'selector_exists').trim().toLowerCase();
    stepCard.dataset.stepType = type;

    stepCard.querySelectorAll('[data-step-types]').forEach((field) => {
        const allowedTypes = String(field.dataset.stepTypes || '').split(',').map((item) => item.trim()).filter(Boolean);
        const allowedModes = String(field.dataset.conditionModes || '').split(',').map((item) => item.trim()).filter(Boolean);
        const typeMatches = allowedTypes.length === 0 || allowedTypes.includes(type);
        const modeMatches = type !== 'condition' || allowedModes.length === 0 || allowedModes.includes(conditionMode);
        field.classList.toggle('is-visible', typeMatches && modeMatches);
    });

    const descriptions = {
        navigate: '访问指定 URL；未填写时使用卡片设置中的目标网址。',
        click: '定位页面元素并执行点击。',
        type: '定位可输入元素并写入固定文本或运行变量。',
        wait: '可等待元素或文本出现，也可等待元素或文本消失。',
        condition: '计算 true / false，并沿画布中对应标签的连线继续执行。',
        get_credits: '读取目标元素的文本并写入执行结果。',
        save_cookies: '保存当前页面的 Cookie 及本地存储，无需额外参数。',
        clear_current_page_cache: '清理当前页面缓存与站点存储，无需额外参数。',
        external_script: '在当前页面上下文执行 JavaScript。',
        screenshot: '截取当前标签页可见区域并保存，无需额外参数。'
    };
    const description = stepCard.querySelector('[data-step-type-description]');
    if (description) {
        description.textContent = descriptions[type] || '';
    }

    const textLabel = stepCard.querySelector('[data-step-text-label]');
    if (textLabel) {
        textLabel.textContent = type === 'condition' ? '判断文本 / URL 片段' : '输入文本（变量默认值）';
    }
    const textInput = stepCard.querySelector('[data-sidebar-step-field="text"]');
    if (textInput) {
        textInput.placeholder = type === 'condition' ? '输入需要匹配的文本或 URL 片段' : '运行前可按变量名覆盖';
    }
    const scriptLabel = stepCard.querySelector('[data-step-script-label]');
    if (scriptLabel) {
        scriptLabel.textContent = type === 'condition' ? '判断表达式 / 脚本' : '执行脚本';
    }
}

function resetSidebarStepStatuses() {
  if (!sidebarStepListNode) return;
  sidebarStepListNode.querySelectorAll('[data-sidebar-step-card]').forEach((card) => {
    card.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');
    const statusEl = card.querySelector('.sidebar-step-status') || card.querySelector('[data-step-status]');
    if (statusEl) statusEl.textContent = '';
    const errEl = card.querySelector('.sidebar-step-error') || card.querySelector('[data-step-error]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  });
  if (sidebarFlowNodesNode) {
    sidebarFlowNodesNode.querySelectorAll('[data-flow-node-id]').forEach((node) => {
      node.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');
    });
  }
}

function getSidebarStepErrorElement(card) {
  let element = card.querySelector('.sidebar-step-error') || card.querySelector('[data-step-error]');
  if (element) return element;
  element = document.createElement('div');
  element.className = 'sidebar-step-error';
  element.setAttribute('data-step-error', '');
  const header = card.querySelector('.sidebar-step-card__header');
  if (header?.parentNode) header.parentNode.insertBefore(element, header.nextSibling);
  else card.appendChild(element);
  return element;
}

function applySidebarStepStatusVisuals(card, errorElement, status, errorReason) {
  const labels = { success: '✓ 通过', error: '✗ 失败', running: '⟳ 执行中', pending: '○ 待执行' };
  const normalizedStatus = labels[status] ? status : 'pending';
  card.classList.add(`is-${normalizedStatus}`);
  errorElement.hidden = normalizedStatus !== 'error' || !errorReason;
  errorElement.textContent = normalizedStatus === 'error' && errorReason ? String(errorReason) : '';
  return labels[normalizedStatus];
}

function applyExecutionStatusToSidebarStep(stepIndex, status = 'pending', errorReason = '') {
  if (!sidebarStepListNode || !stepIndex) return;
  const idx = Number(stepIndex);
  const card = sidebarStepListNode.querySelector(`[data-sidebar-step-card][data-step-index="${Math.max(0, idx - 1)}"]`);
  if (!card) return;

  card.classList.remove('is-pending', 'is-success', 'is-error', 'is-running');

  const statusEl = card.querySelector('.sidebar-step-status') || card.querySelector('[data-step-status]');
  const errEl = getSidebarStepErrorElement(card);
  const label = applySidebarStepStatusVisuals(card, errEl, status, errorReason);

  if (statusEl) {
    statusEl.textContent = label;
  }
  applyExecutionStatusToSidebarFlowStep(idx, status);
}

function collectSidebarStepCards() {
    if (!sidebarStepListNode) {
        return [];
    }

    return Array.from(sidebarStepListNode.querySelectorAll('[data-sidebar-step-card]'));
}

function createSidebarStepFieldReader(stepCard) {
    return (name) => {
        const control = stepCard.querySelector(`[data-sidebar-step-field="${name}"]`);
        if (!control) return '';
        return control.type === 'checkbox' ? control.checked === true : String(control.value || '').trim();
    };
}

function readSidebarBaseStep(readField) {
    try {
        const rawStep = readField('raw_json');
        const parsed = rawStep ? JSON.parse(rawStep) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
        return {};
    }
}

function collectSidebarStepFieldValues(readField, selectorNormalization) {
    const value = (name) => String(readField(name) || '').trim();
    return {
        selector: String(selectorNormalization.selector || value('selector')).trim(),
        text: value('text'),
        variable: value('variable'),
        url: value('url'),
        by: value('by'),
        conditionMode: value('condition_mode'),
        timeout: value('timeout'),
        nth: value('nth'),
        pollInterval: value('poll_interval_ms'),
        waitForText: value('wait_for_text'),
        waitForElementHidden: value('wait_for_element_hidden'),
        waitForTextHidden: value('wait_for_text_hidden'),
        script: value('script'),
        defaultValue: value('default'),
        clearFirst: readField('clear_first') === true,
        clickBeforeType: readField('click_before_type') === true,
        optional: readField('optional') === true
    };
}

const SIDEBAR_SELECTOR_STEP_TYPES = ['click', 'type', 'wait', 'get_credits'];
const SIDEBAR_INTERACTIVE_STEP_TYPES = ['click', 'type', 'get_credits'];

function applySidebarStepSelectorFields(step, fields, selectorNormalization) {
    const type = String(step.type || '').trim().toLowerCase();
    const selectorCondition = type === 'condition' && ['selector_exists', 'selector_missing'].includes(fields.conditionMode);
    if (fields.selector && (SIDEBAR_SELECTOR_STEP_TYPES.includes(type) || selectorCondition)) step.selector = fields.selector;
    if (selectorNormalization.converted && SIDEBAR_INTERACTIVE_STEP_TYPES.includes(type)) step.by = 'css_selector';
    else if (fields.by && SIDEBAR_INTERACTIVE_STEP_TYPES.includes(type)) step.by = fields.by;
}

function applySidebarStepCoreFields(step, fields) {
    const type = String(step.type || '').trim().toLowerCase();
    const textCondition = type === 'condition' && ['text_exists', 'text_missing', 'url_matches'].includes(fields.conditionMode);
    if (fields.text && (type === 'type' || textCondition)) step.text = fields.text;
    if (fields.variable && type === 'type') step.variable = fields.variable;
    if (fields.url && type === 'navigate') step.url = fields.url;
    if (fields.conditionMode && type === 'condition') step.condition_mode = fields.conditionMode;
}

function applySidebarStepNumericFields(step, fields) {
    const type = String(step.type || '').trim().toLowerCase();
    const timeout = fields.timeout ? Number(fields.timeout) : Number.NaN;
    const nth = fields.nth ? Number(fields.nth) : Number.NaN;
    const pollInterval = fields.pollInterval ? Number(fields.pollInterval) : Number.NaN;
    if (Number.isFinite(timeout) && ['navigate', 'click', 'type', 'wait', 'condition', 'get_credits'].includes(type)) step.timeout = timeout;
    if (Number.isFinite(nth) && SIDEBAR_INTERACTIVE_STEP_TYPES.includes(type)) step.nth = nth;
    if (Number.isFinite(pollInterval) && ['click', 'type', 'condition', 'get_credits'].includes(type)) step.poll_interval_ms = pollInterval;
}

function applySidebarStepWaitFields(step, fields) {
    const type = String(step.type || '').trim().toLowerCase();
    if (fields.waitForText && type === 'wait') step.wait_for_text = fields.waitForText;
    if (fields.waitForElementHidden && type === 'wait') step.wait_for_element_hidden = fields.waitForElementHidden;
    if (fields.waitForTextHidden && type === 'wait') step.wait_for_text_hidden = fields.waitForTextHidden;
}

function applySidebarStepSpecialFields(step, fields) {
    const type = String(step.type || '').trim().toLowerCase();
    if (fields.script && (type === 'external_script' || (type === 'condition' && fields.conditionMode === 'js'))) step.script = fields.script;
    if (fields.defaultValue && type === 'get_credits') step.default = fields.defaultValue;
    if (type === 'type' && fields.clearFirst) step.clear_first = true;
    if (type === 'type' && fields.clickBeforeType) step.click_before_type = true;
    if (fields.optional) step.optional = true;
}

function clearStaleSidebarStepFields(step) {
    [
        'selector', 'text', 'variable', 'url', 'by', 'condition_mode', 'condition',
        'timeout', 'nth', 'poll_interval_ms', 'wait_for_text', 'wait_for_element_hidden',
        'wait_for_text_hidden', 'script', 'expression', 'default', 'optional',
        'clear_first', 'clearFirst', 'click_before_type', 'clickBeforeType'
    ].forEach((key) => delete step[key]);
}

function readSidebarStepCard(stepCard, index = 0) {
    if (!stepCard) {
        return null;
    }

    const readField = createSidebarStepFieldReader(stepCard);

    const selectorControl = stepCard.querySelector('[data-sidebar-step-field="selector"]');
    const selectorNormalization = normalizeSidebarStepSelectorControl(stepCard, selectorControl);

    const baseStep = readSidebarBaseStep(readField);
    const step = {
        ...baseStep,
        id: String(readField('id') || stepCard.dataset.stepId || `step_${index + 1}`).trim() || `step_${index + 1}`,
        name: String(readField('name') || `步骤${index + 1}`).trim() || `步骤${index + 1}`,
        type: String(readField('type') || 'navigate').trim() || 'navigate'
    };
    const fields = collectSidebarStepFieldValues(readField, selectorNormalization);
    clearStaleSidebarStepFields(step);
    applySidebarStepSelectorFields(step, fields, selectorNormalization);
    applySidebarStepCoreFields(step, fields);
    applySidebarStepNumericFields(step, fields);
    applySidebarStepWaitFields(step, fields);
    applySidebarStepSpecialFields(step, fields);

    return step;
}
