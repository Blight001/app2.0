'use strict';

{
  function setOptionalValue(object, key, value, transform = String) {
    const text = String(value ?? '').trim();
    if (!text) delete object[key];
    else object[key] = transform(text);
  }

  function createTextField(label, value, onInput, options = {}) {
    const field = document.createElement('label');
    field.className = 'automation-step-field';
    field.textContent = label;
    const input = options.multiline ? document.createElement('textarea') : document.createElement('input');
    input.value = value === undefined || value === null ? '' : String(value);
    if (options.type) input.type = options.type;
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener('input', () => onInput(input.value));
    field.appendChild(input);
    return field;
  }

  function createSelectField(label, value, entries, onChange) {
    const field = document.createElement('label');
    field.className = 'automation-step-field';
    field.textContent = label;
    const select = document.createElement('select');
    for (const [optionValue, optionLabel] of entries) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      select.appendChild(option);
    }
    select.value = String(value || '');
    select.addEventListener('change', () => onChange(select.value));
    field.appendChild(select);
    return field;
  }

  function addCommonFields(body, editor, step, stepTypes, stepLabels) {
    const sync = () => editor.syncJson();
    body.append(
      createTextField('步骤名称', step.name, (value) => {
        step.name = value;
        sync();
      }),
      createSelectField('步骤类型', step.type, stepTypes.map((type) => [type, stepLabels[type]]), (value) => {
        step.type = value;
        if (!step.name) step.name = stepLabels[value];
        editor.render();
      }),
      createTextField('选择器', step.selector, (value) => {
        setOptionalValue(step, 'selector', value);
        sync();
      }, { placeholder: '#submit / text=登录' }),
      createTextField('网址', step.url, (value) => {
        setOptionalValue(step, 'url', value);
        sync();
      }, { placeholder: '仅访问网页步骤需要' }),
      createTextField('输入文本 / 默认值', step.text, (value) => {
        setOptionalValue(step, 'text', value);
        sync();
      }, { multiline: true }),
      createTextField('变量名', step.variable, (value) => {
        setOptionalValue(step, 'variable', value);
        sync();
      }, { placeholder: '例如 email、password' }),
      createTextField('超时（毫秒）', step.timeout, (value) => {
        setOptionalValue(step, 'timeout', value, Number);
        sync();
      }, { type: 'number' }),
      createTextField('匹配序号', step.nth, (value) => {
        setOptionalValue(step, 'nth', value, Number);
        sync();
      }, { type: 'number' }),
      createTextField('轮询间隔（毫秒）', step.poll_interval_ms, (value) => {
        setOptionalValue(step, 'poll_interval_ms', value, Number);
        sync();
      }, { type: 'number' }),
      createTextField('失败重试次数', step.retry_count, (value) => {
        setOptionalValue(step, 'retry_count', value, Number);
        sync();
      }, { type: 'number' }),
      createTextField('重试间隔（毫秒）', step.retry_delay_ms, (value) => {
        setOptionalValue(step, 'retry_delay_ms', value, Number);
        sync();
      }, { type: 'number' }),
      createTextField('读取失败默认值', step.default, (value) => {
        setOptionalValue(step, 'default', value);
        sync();
      }),
      createSelectField('定位方式', step.by || '', [
        ['', '默认'], ['css_selector', 'CSS 选择器'], ['text', '可见文本'], ['auto', '自动'],
      ], (value) => {
        setOptionalValue(step, 'by', value);
        sync();
      }),
    );
  }

  function createCheckbox(step, key, label, sync) {
    const option = document.createElement('label');
    option.className = 'automation-step-optional';
    const control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = step[key] === true;
    control.addEventListener('change', () => {
      if (control.checked) step[key] = true;
      else delete step[key];
      sync();
    });
    option.append(control, document.createTextNode(label));
    return option;
  }

  function addSpecialFields(body, editor, step) {
    const sync = () => editor.syncJson();
    if (step.type === 'wait') {
      body.append(
        createTextField('等待文本出现', step.wait_for_text, (value) => {
          setOptionalValue(step, 'wait_for_text', value);
          sync();
        }),
        createTextField('等待元素消失（选择器）', step.wait_for_element_hidden, (value) => {
          setOptionalValue(step, 'wait_for_element_hidden', value);
          sync();
        }),
        createTextField('等待文本消失', step.wait_for_text_hidden, (value) => {
          setOptionalValue(step, 'wait_for_text_hidden', value);
          sync();
        }),
      );
    }
    if (step.type === 'type') {
      body.append(
        createCheckbox(step, 'clear_first', '输入前清空', sync),
        createCheckbox(step, 'click_before_type', '输入前点击', sync),
        createCheckbox(step, 'submit', '输入后按 Enter', sync),
      );
    }
  }

  window.AutomationStepFields = Object.freeze({
    addCommonFields,
    addSpecialFields,
    createCheckbox,
    createSelectField,
  });
}
