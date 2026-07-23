'use strict';

const CARD_ACTIONS = [
  'rules', 'list', 'get', 'write', 'patch_step', 'insert_step',
  'delete_step', 'move_step', 'delete', 'run', 'stop',
];
const SAFE_STEP_TYPES = [
  'navigate', 'click', 'type', 'wait', 'condition', 'get_credits',
  'save_cookies', 'clear_current_page_cache', 'screenshot',
];

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required };
}

const NATIVE_BROWSER_TOOL_DEFS = Object.freeze([
  {
    name: 'manage_card',
    description: '管理并运行软件自动化卡片。支持规则、列表、完整读写、局部步骤编辑、删除、断点续跑和停止；禁止任意页面脚本。',
    destructive: true,
    input_schema: objectSchema({
      action: { type: 'string', enum: CARD_ACTIONS },
      id: { type: 'string' },
      card_name: { type: 'string' },
      cardData: { type: 'object' },
      step_index: { type: 'number' },
      to_step_index: { type: 'number' },
      insert_after: { type: 'number' },
      stepData: { type: 'object' },
      stepPatch: { type: 'object' },
      replace: { type: 'boolean' },
      inputs: { type: 'object' },
      start_step: { type: 'number' },
      loop_count: { type: 'number' },
      timeout_seconds: { type: 'number' },
    }, ['action']),
  },
  {
    name: 'browser_download',
    description: '下载 HTTP/HTTPS 文件到 AI-Workspace，或自动保存当前浏览器会话；不提供手动 Cookie 管理。',
    destructive: true,
    input_schema: objectSchema({
      action: { type: 'string', enum: ['download', 'save_session', 'info'] },
      url: { type: 'string' },
      media_type: { type: 'string', enum: ['image', 'video', 'audio'] },
      directory: { type: 'string' },
      filename: { type: 'string' },
      use_cookies: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      timeout_ms: { type: 'number' },
      max_bytes: { type: 'number' },
    }, ['action']),
  },
  {
    name: 'browser_tab',
    description: '列出、切换、新建、覆盖导航、关闭标签页以及前进后退。',
    input_schema: objectSchema({
      action: { type: 'string', enum: ['list', 'switch', 'replace', 'navigate', 'close', 'back', 'forward'] },
      url: { type: 'string' },
      tab_id: { type: 'number' },
      tabId: { type: 'number' },
      id: { type: 'number' },
    }, ['action']),
  },
  {
    name: 'browser_observe',
    description: '读取当前页面可见交互元素、文本、媒体和 iframe，并返回临时元素引用及下载链接。',
    input_schema: objectSchema({
      limit: { type: 'number' },
      max_items: { type: 'number' },
      filter: { type: ['string', 'array'] },
      tag: { type: ['string', 'array'] },
      tags: { type: ['string', 'array'] },
      keyword: { type: 'string' },
      query: { type: 'string' },
      text_filter: { type: 'string' },
      selector: { type: 'string' },
      include_text: { type: 'boolean' },
      include_media: { type: 'boolean' },
      mark: { type: 'boolean' },
      highlight_duration_ms: { type: 'number' },
    }),
  },
  {
    name: 'browser_screenshot',
    description: '截取当前页面可视区、整页、元素或指定区域，返回 PNG dataUrl。',
    input_schema: objectSchema({
      selector: { type: 'string' },
      text: { type: 'string' },
      full_page: { type: 'boolean' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      margin: { type: 'number' },
      format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
      quality: { type: 'number' },
    }),
  },
  {
    name: 'browser_action',
    description: '在当前页面点击、双击、右键、上传文件、滚动、输入或发送按键。',
    destructive: true,
    input_schema: objectSchema({
      action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'upload_file', 'scroll', 'type', 'press_key'] },
      ref: { type: 'string' },
      selector: { type: 'string' },
      text: { type: 'string' },
      nth: { type: 'number' },
      path: { type: 'string' },
      paths: { type: 'array', items: { type: 'string' } },
      mode: { type: 'string', enum: ['open', 'open-multiple', 'upload-folder'] },
      x: { type: 'number' },
      y: { type: 'number' },
      direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
      amount: { type: 'number' },
      clear_first: { type: 'boolean' },
      submit: { type: 'boolean' },
      key: { type: 'string' },
      ctrl: { type: 'boolean' },
      shift: { type: 'boolean' },
      alt: { type: 'boolean' },
      meta: { type: 'boolean' },
    }, ['action']),
  },
  {
    name: 'browser_wait',
    description: '等待指定 CSS selector 出现，或固定等待一段时间。',
    input_schema: objectSchema({
      selector: { type: 'string' },
      ms: { type: 'number' },
    }),
  },
]);

module.exports = { CARD_ACTIONS, NATIVE_BROWSER_TOOL_DEFS, SAFE_STEP_TYPES };
