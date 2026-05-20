/**
 * 工具函数模块
 * 包含各种通用的工具函数
 */

const { ipcRenderer } = require('electron');
const { logger, consoleManager } = require('../console.js');

let messageAutoHideTimer = null;
let confirmDialogResolver = null;
let confirmDialogKeydownHandler = null;

function resolveMessageElements(elements) {
    if (typeof document === 'undefined') {
        return {
            messageDialog: null,
            messageText: null,
            messageOkBtn: null
        };
    }

    if (elements && elements.messageDialog && elements.messageText) {
        return elements;
    }

    return {
        messageDialog: document.getElementById('message-dialog'),
        messageText: document.getElementById('message-text'),
        messageOkBtn: document.getElementById('message-ok-btn')
    };
}

function resolveConfirmElements(elements) {
    if (typeof document === 'undefined') {
        return {
            confirmDialog: null,
            confirmTitle: null,
            confirmText: null,
            confirmCloseBtn: null,
            confirmCancelBtn: null,
            confirmOkBtn: null
        };
    }

    if (elements && elements.confirmDialog && elements.confirmText) {
        return elements;
    }

    return {
        confirmDialog: document.getElementById('confirm-dialog'),
        confirmTitle: document.getElementById('confirm-title'),
        confirmText: document.getElementById('confirm-text'),
        confirmCloseBtn: document.getElementById('confirm-close-btn'),
        confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
        confirmOkBtn: document.getElementById('confirm-ok-btn')
    };
}

/**
 * 显示非阻塞提示
 */
function showMessage(message, type = 'info', elements) {
    const resolved = resolveMessageElements(elements);
    const dialog = resolved.messageDialog;
    const text = resolved.messageText;

    if (!dialog || !text) {
        const levelMap = {
            error: 'error',
            warning: 'warning',
            success: 'info',
            info: 'info'
        };
        const method = levelMap[type] || 'info';
        logger[method](message);
        return;
    }

    if (messageAutoHideTimer) {
        clearTimeout(messageAutoHideTimer);
        messageAutoHideTimer = null;
    }

    text.textContent = message;
    dialog.dataset.messageType = type;
    dialog.style.display = 'flex';
    dialog.classList.remove('hide');

    const scheduleShow = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 0);

    scheduleShow(() => {
        dialog.classList.add('show');
    });

    messageAutoHideTimer = setTimeout(() => {
        hideMessageDialog(resolved);
    }, 5000);
}

/**
 * 隐藏消息提示
 */
function hideMessageDialog(elements) {
    const resolved = resolveMessageElements(elements);
    const dialog = resolved.messageDialog;
    if (!dialog) return;

    if (messageAutoHideTimer) {
        clearTimeout(messageAutoHideTimer);
        messageAutoHideTimer = null;
    }

    dialog.classList.remove('show');
    dialog.classList.add('hide');

    setTimeout(() => {
        if (dialog.classList.contains('hide')) {
            dialog.style.display = 'none';
            dialog.classList.remove('hide');
        }
    }, 220);
}

function hideConfirmDialog(elements) {
    const resolved = resolveConfirmElements(elements);
    const dialog = resolved.confirmDialog;
    if (!dialog) {
        return;
    }

    dialog.classList.remove('show');
    dialog.style.display = 'none';

    if (confirmDialogKeydownHandler) {
        document.removeEventListener('keydown', confirmDialogKeydownHandler, true);
        confirmDialogKeydownHandler = null;
    }

    confirmDialogResolver = null;
}

function showConfirmDialog(message, options = {}, elements) {
    const resolved = resolveConfirmElements(elements);
    const dialog = resolved.confirmDialog;
    const text = resolved.confirmText;
    const title = resolved.confirmTitle;

    if (!dialog || !text) {
        const fallbackConfirm = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(String(message || ''))
            : false;
        return Promise.resolve(fallbackConfirm);
    }

    hideConfirmDialog(resolved);

    if (title) {
        title.textContent = String(options.title || '请确认');
    }
    text.textContent = String(message || '');
    dialog.style.display = 'flex';
    dialog.classList.add('show');

    return new Promise((resolve) => {
        confirmDialogResolver = resolve;

        const finish = (result) => {
            const currentResolve = confirmDialogResolver;
            hideConfirmDialog(resolved);
            if (typeof currentResolve === 'function') {
                currentResolve(result);
            }
        };

        if (resolved.confirmOkBtn) {
            resolved.confirmOkBtn.onclick = () => finish(true);
        }
        if (resolved.confirmCancelBtn) {
            resolved.confirmCancelBtn.onclick = () => finish(false);
        }
        if (resolved.confirmCloseBtn) {
            resolved.confirmCloseBtn.onclick = () => finish(false);
        }

        confirmDialogKeydownHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            }
        };
        document.addEventListener('keydown', confirmDialogKeydownHandler, true);
    });
}

/**
 * 日志输出（兼容旧接口）
 */
function logToConsole(message, level = 'info') {
    const levelMap = {
        'debug': 'debug',
        'info': 'info',
        'warning': 'warning',
        'error': 'error',
        'success': 'info'
    };

    const method = levelMap[level] || 'info';
    logger[method](message);
}

/**
 * 清空控制台
 */
function clearConsole() {
    consoleManager.clear();
    logger.info('控制台已清空');
}

/**
 * 保存控制台日志
 */
function saveConsoleLog() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `console_log_${timestamp}.txt`;
    consoleManager.saveLog(filename);
    logger.info(`日志已保存到: ${filename}`);
}

/**
 * 调整并发数量
 */
function adjustConcurrent(delta, elements, updateCookieTestConfigFn) {
    const input = elements && elements.concurrentCount
        ? elements.concurrentCount
        : document.getElementById('concurrent-count');

    if (!input) {
        return;
    }

    const currentValue = parseInt(input.value) || 1;
    const newValue = Math.max(1, Math.min(10, currentValue + delta));
    input.value = newValue;

    if (updateCookieTestConfigFn) {
        updateCookieTestConfigFn();
    }
}

/**
 * Random配置辅助函数
 */
function toggleCharsetField(type, elements) {
    const typeSelect = type === 'email' ? elements.emailRandomType : elements.passwordRandomType;
    const charsetInput = type === 'email' ? elements.emailRandomCharset : elements.passwordRandomCharset;
    const charsetGroup = charsetInput.closest('.form-group');

    if (typeSelect.value === 'custom') {
        charsetGroup.style.display = 'block';
        charsetInput.required = true;
    } else {
        charsetGroup.style.display = 'none';
        charsetInput.required = false;
        charsetInput.value = '';
    }
}

/**
 * 浏览器检测功能
 */
async function detectBrowser(elements, showMessage, updateBrowserOptions, updateBrowserSettings, logger) {
    try {
        elements.detectBrowserBtn.disabled = true;
        elements.detectBrowserBtn.textContent = '检测中...';

        logger.info('开始检测系统浏览器...');
        const result = await ipcRenderer.invoke('detect-browser');

        if (result.success && result.browsers && result.browsers.length > 0) {
            updateBrowserOptions(result.browsers, elements);
            updateBrowserSettings();

            const browserNames = result.browsers.map(b => b.name).join(', ');
            logger.info(`检测到 ${result.browsers.length} 个浏览器: ${browserNames}`);
            showMessage(`成功检测到 ${result.browsers.length} 个浏览器: ${browserNames}`, 'success', elements);
        } else {
            logger.warning('未检测到系统浏览器');
            showMessage('未检测到系统浏览器，请手动选择浏览器类型', 'error', elements);
        }
    } catch (error) {
        logger.error(`浏览器检测失败: ${error.message}`);
        showMessage(`浏览器检测失败: ${error.message}`, 'error', elements);
    } finally {
        elements.detectBrowserBtn.disabled = false;
        elements.detectBrowserBtn.textContent = '自动检测';
    }
}

/**
 * 自动检测浏览器
 */
async function autoDetectBrowsers(elements, logger, updateBrowserOptions, updateBrowserSettings, addDefaultBrowserOptions) {
    try {
        logger.info('页面加载时自动检测浏览器...');
        const result = await ipcRenderer.invoke('detect-browser');

        if (result.success && result.browsers && result.browsers.length > 0) {
            updateBrowserOptions(result.browsers, elements);
            
            // 同时更新两个下拉框
            if (elements.testBrowserType) {
                 elements.testBrowserType.innerHTML = elements.browserType.innerHTML;
                 elements.testBrowserType.value = elements.browserType.value;
            }
            
            updateBrowserSettings();
            logger.info(`自动检测到 ${result.browsers.length} 个浏览器: ${result.browsers.map(b => b.name).join(', ')}`);
        } else {
            addDefaultBrowserOptions(elements);
            if (elements.testBrowserType) {
                 addDefaultBrowserOptions({ ...elements, browserType: elements.testBrowserType });
            }
            logger.info('未检测到浏览器，使用默认选项');
        }
    } catch (error) {
        logger.error(`自动检测浏览器失败: ${error.message}`);
        addDefaultBrowserOptions(elements);
        if (elements.testBrowserType) {
             addDefaultBrowserOptions({ ...elements, browserType: elements.testBrowserType });
        }
    }
}

/**
 * 更新浏览器下拉框选项
 */
function updateBrowserOptions(browsers, elements) {
    const previousValue = elements.browserType ? String(elements.browserType.value || '').trim() : '';
    elements.browserType.innerHTML = '';

    addDefaultBrowserOptions(elements);

    const allowedValues = new Set(['electron', 'edge', 'chrome']);
    elements.browserType.value = allowedValues.has(previousValue) ? previousValue : 'electron';
}

/**
 * 添加默认浏览器选项
 */
function addDefaultBrowserOptions(elements) {
    const defaultOptions = [
        { value: 'electron', text: '内置浏览器 (Electron Chromium)' },
        { value: 'edge', text: 'Edge 浏览器' },
        { value: 'chrome', text: 'Chrome 浏览器' }
    ];

    defaultOptions.forEach(optionData => {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.text;
        const hasOption = Array.from(elements.browserType.options || []).some(item => item.value === option.value);
        if (!hasOption) {
            elements.browserType.appendChild(option);
        }
    });

    if (elements.browserType && !elements.browserType.value) {
        elements.browserType.value = 'electron';
    }
}

/**
 * 更新浏览器设置
 */
async function updateBrowserSettings(elements, extraSettings = {}) {
    const browserStatePatch = extraSettings && typeof extraSettings === 'object'
        ? extraSettings
        : {};

    const settings = {
        browser_type: elements.browserType.value,
        browser_source: elements.browserSource ? String(elements.browserSource.value || '').trim() : 'local-browser',
        browser_display_mode: elements.browserDisplayMode && elements.browserDisplayMode.checked ? 'embedded' : 'window',
        region: elements.browserRegion ? String(elements.browserRegion.value || '').trim() : '',
        headless: elements.headlessMode.checked,
        locale: elements.browserLocale ? String(elements.browserLocale.value || '').trim() : '',
        timezone_id: elements.browserTimezoneId ? String(elements.browserTimezoneId.value || '').trim() : '',
        dynamic_fingerprint: elements.browserDynamicFingerprint ? elements.browserDynamicFingerprint.checked : true,
        block_images_videos: elements.browserBlockImagesVideos ? elements.browserBlockImagesVideos.checked : false,
        remove_watermark_plugin: elements.browserRemoveWatermarkPlugin ? elements.browserRemoveWatermarkPlugin.checked : true,
        ...browserStatePatch
    };

    try {
        const applyResult = await ipcRenderer.invoke('update-browser-settings', settings);
        return applyResult;
    } catch (error) {
        return {
            success: false,
            error: error.message || '更新浏览器设置失败'
        };
    }
}

const { DEFAULT_EMAIL_HOST, DEFAULT_EMAIL_PORT } = require('../../core/email/email-defaults');

/**
 * 邮箱连接功能
 */
async function connectEmail(elements, appendEmailLog, updateEmailStatus) {
    // 优先使用输入框的值，如果为空则尝试使用placeholder，最后使用默认值
    const hostInput = document.getElementById('email-host');
    const portInput = document.getElementById('email-port');
    
    let host = hostInput.value.trim();
    if (!host) {
        // 如果输入框为空，则使用默认值
        host = DEFAULT_EMAIL_HOST;
    }

    let port = parseInt(portInput.value, 10);
    if (isNaN(port)) {
        port = DEFAULT_EMAIL_PORT;
    }

    appendEmailLog(`尝试连接到邮箱服务器 ${host}:${port} ...`);
    updateEmailStatus('连接中...', 'connecting');

    const result = await ipcRenderer.invoke('email-connect', { host, port });
    if (result && result.success) {
        appendEmailLog('邮箱客户端已连接');
        const connectBtn = document.getElementById('email-connect-btn');
        const disconnectBtn = document.getElementById('email-disconnect-btn');
        if (connectBtn) connectBtn.disabled = true;
        if (disconnectBtn) disconnectBtn.disabled = false;
        updateEmailStatus(`已连接: ${host}:${port}`, 'connected');
    } else {
        appendEmailLog(`连接失败: ${result && result.error ? result.error : '未知错误'}`);
        const connectBtn = document.getElementById('email-connect-btn');
        const disconnectBtn = document.getElementById('email-disconnect-btn');
        if (connectBtn) connectBtn.disabled = false;
        if (disconnectBtn) disconnectBtn.disabled = true;
        updateEmailStatus('连接失败', 'disconnected');
    }
}

/**
 * 邮箱断开连接
 */
async function disconnectEmail(elements, appendEmailLog, updateEmailStatus) {
    window.__emailManualDisconnect = true;
    const result = await ipcRenderer.invoke('email-disconnect');
    if (result && result.success) {
        appendEmailLog('邮箱客户端已断开连接');
        const connectBtn = document.getElementById('email-connect-btn');
        const disconnectBtn = document.getElementById('email-disconnect-btn');
        if (connectBtn) connectBtn.disabled = false;
        if (disconnectBtn) disconnectBtn.disabled = true;
        updateEmailStatus('未连接', 'disconnected');
    } else {
        window.__emailManualDisconnect = false;
        appendEmailLog(`断开连接失败: ${result && result.error ? result.error : '未知错误'}`);
    }
}

function setEmailModeButtonsActive(mode) {
    const connectModeBtn = document.getElementById('email-mode-connect-btn');
    const outlookModeBtn = document.getElementById('email-mode-outlook-btn');
    const tempModeBtn = document.getElementById('email-mode-temp-btn');
    const apiModeBtn = document.getElementById('email-mode-api-btn');
    if (connectModeBtn) {
        connectModeBtn.classList.toggle('active', mode === 'connect');
        connectModeBtn.setAttribute('aria-pressed', mode === 'connect' ? 'true' : 'false');
    }
    if (outlookModeBtn) {
        outlookModeBtn.classList.toggle('active', mode === 'outlook');
        outlookModeBtn.setAttribute('aria-pressed', mode === 'outlook' ? 'true' : 'false');
    }
    if (tempModeBtn) {
        tempModeBtn.classList.toggle('active', mode === 'temp');
        tempModeBtn.setAttribute('aria-pressed', mode === 'temp' ? 'true' : 'false');
    }
    if (apiModeBtn) {
        apiModeBtn.classList.toggle('active', mode === 'api');
        apiModeBtn.setAttribute('aria-pressed', mode === 'api' ? 'true' : 'false');
    }
}

function setEmailModePanelsActive(mode) {
    const connectPanel = document.getElementById('email-mode-connect-panel');
    const outlookPanel = document.getElementById('email-mode-outlook-panel');
    const tempPanel = document.getElementById('email-mode-temp-panel');
    const apiPanel = document.getElementById('email-mode-api-panel');
    if (connectPanel) {
        connectPanel.classList.toggle('active', mode === 'connect');
    }
    if (outlookPanel) {
        outlookPanel.classList.toggle('active', mode === 'outlook');
    }
    if (tempPanel) {
        tempPanel.classList.toggle('active', mode === 'temp');
    }
    if (apiPanel) {
        apiPanel.classList.toggle('active', mode === 'api');
    }
}

function setUploadModeButtonsActive(mode) {
    const tcpModeBtn = document.getElementById('upload-mode-tcp-btn');
    const httpModeBtn = document.getElementById('upload-mode-http-btn');
    if (tcpModeBtn) {
        tcpModeBtn.classList.toggle('active', mode === 'tcp');
        tcpModeBtn.setAttribute('aria-pressed', mode === 'tcp' ? 'true' : 'false');
    }
    if (httpModeBtn) {
        httpModeBtn.classList.toggle('active', mode === 'http');
        httpModeBtn.setAttribute('aria-pressed', mode === 'http' ? 'true' : 'false');
    }
}

function setUploadModePanelsActive(mode) {
    const tcpPanel = document.getElementById('upload-mode-tcp-panel');
    const httpPanel = document.getElementById('upload-mode-http-panel');
    if (tcpPanel) {
        tcpPanel.classList.toggle('active', mode === 'tcp');
        tcpPanel.hidden = mode !== 'tcp';
    }
    if (httpPanel) {
        httpPanel.classList.toggle('active', mode === 'http');
        httpPanel.hidden = mode !== 'http';
    }
}

function activateUploadMode(mode) {
    const normalizedMode = mode === 'http' ? 'http' : 'tcp';
    setUploadModeButtonsActive(normalizedMode);
    setUploadModePanelsActive(normalizedMode);
    return normalizedMode;
}

async function activateEmailMode(mode, elements, appendEmailLog, updateEmailStatus) {
    const normalizedMode = mode === 'outlook'
        ? 'outlook'
        : mode === 'temp'
            ? 'temp'
            : mode === 'api'
                ? 'api'
                : 'connect';
    setEmailModeButtonsActive(normalizedMode);
    setEmailModePanelsActive(normalizedMode);

    if (normalizedMode === 'temp') {
        if (appendEmailLog) {
            appendEmailLog('切换到临时邮箱模式，正在断开当前邮箱连接...', '#6c757d');
        }
        await disconnectEmail(elements, appendEmailLog, updateEmailStatus);
    } else if (normalizedMode === 'outlook') {
        if (appendEmailLog) {
            appendEmailLog('已切换到 Outlook 模式，等待后续功能接入。', '#0d6efd');
        }
    } else if (normalizedMode === 'api') {
        if (appendEmailLog) {
            appendEmailLog('已切换到 API 连接模式，等待你补充接口配置。', '#0d6efd');
        }
    } else if (updateEmailStatus) {
        updateEmailStatus('未连接', 'disconnected');
    }

    return normalizedMode;
}

/**
 * 添加邮箱日志
 * @param {string} message - 日志消息
 * @param {string} color - 颜色 (gray, yellow, green, red)
 */
function appendEmailLog(message, color) {
    const log = document.getElementById('email-log');
    if (!log) return;
    
    // 限制日志行数，防止卡顿
    const maxLines = 1000;
    if (log.children.length >= maxLines) {
        // 移除最旧的行（例如一次移除100行，避免频繁操作DOM）
        for (let i = 0; i < 100; i++) {
            if (log.firstChild) {
                log.removeChild(log.firstChild);
            }
        }
    }

    const line = document.createElement('div');
    line.style.marginBottom = '4px';
    line.style.wordBreak = 'break-all'; // 防止长文本撑破容器
    
    // 设置颜色
    if (color) {
        line.style.color = color;
    }
    
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.appendChild(line);
    
    // 自动滚动
    const autoScrollCheckbox = document.getElementById('email-auto-scroll');
    if (autoScrollCheckbox && autoScrollCheckbox.checked) {
        log.scrollTop = log.scrollHeight;
    }
}

/**
 * 保存邮箱日志
 */
function saveEmailLog() {
    const log = document.getElementById('email-log');
    if (!log) return;
    
    let content = '';
    for (const child of log.children) {
        content += child.textContent + '\n';
    }
    
    if (!content) {
        showMessage('日志为空，无需保存', 'info', { messageText: document.getElementById('message-text'), messageDialog: document.getElementById('message-dialog'), messageOkBtn: document.getElementById('message-ok-btn') });
        return;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email_log_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 清空邮箱日志
 */
function clearEmailLog() {
    const log = document.getElementById('email-log');
    if (log) {
        log.innerHTML = '';
    }
}

/**
 * 更新邮箱状态显示
 */
function updateEmailStatus(text, status) {
    const statusElement = document.getElementById('email-status');
    if (!statusElement) return;

    statusElement.textContent = text;
    statusElement.classList.remove('status-connected', 'status-connecting', 'status-disconnected');

    switch (status) {
        case 'connected':
            statusElement.classList.add('status-connected');
            break;
        case 'connecting':
            statusElement.classList.add('status-connecting');
            break;
        case 'disconnected':
        default:
            statusElement.classList.add('status-disconnected');
            break;
    }
}

/**
 * 添加验证码到表格
 */
function addEmailCodeToTable(email, code) {
    const tableBody = document.getElementById('email-code-list');
    if (!tableBody) return;

    const row = document.createElement('tr');
    
    const timeCell = document.createElement('td');
    timeCell.textContent = new Date().toLocaleTimeString();
    timeCell.style.padding = '6px';
    timeCell.style.borderBottom = '1px solid #eee';
    
    const emailCell = document.createElement('td');
    emailCell.textContent = email;
    emailCell.style.padding = '6px';
    emailCell.style.borderBottom = '1px solid #eee';
    
    const codeCell = document.createElement('td');
    codeCell.textContent = code;
    codeCell.style.padding = '6px';
    codeCell.style.borderBottom = '1px solid #eee';
    codeCell.style.fontFamily = 'monospace';
    codeCell.style.fontWeight = 'bold';
    codeCell.style.color = '#d63384';

    row.appendChild(timeCell);
    row.appendChild(emailCell);
    row.appendChild(codeCell);

    if (tableBody.firstChild) {
        tableBody.insertBefore(row, tableBody.firstChild);
    } else {
        tableBody.appendChild(row);
    }

    // 最多保留6条记录
    while (tableBody.children.length > 6) {
        tableBody.removeChild(tableBody.lastChild);
    }
}

/**
 * 显示教程弹窗
 */
function showTutorial(type, elements) {
    let title = '';
    let content = '';

    if (type === 'popups') {
        title = '弹窗规则配置教程';
        content = `弹窗规则用于处理页面中可能出现的各种弹窗（如广告、提示框等）。
配置格式为JSON数组，每个对象代表一个弹窗规则。

基本结构:
[
  {
    "name": "规则名称",
    "selector": "CSS选择器",
    "fallback_selectors": ["备用选择器1", "备用选择器2"], // 可选
    "timeout": 5000, // 超时时间(毫秒)，默认5000，可选
    "action": "click" // 动作，默认为click，可选
  }
]

示例:
[
  {
    "name": "关闭广告弹窗",
    "selector": ".modal-close-btn",
    "fallback_selectors": ["div[aria-label='Close']", "#close-ad"]
  },
  {
    "name": "拒绝Cookie",
    "selector": "#reject-cookies-btn"
  }
]

说明:
1. 程序会定期检查这些选择器，如果发现元素存在，就会尝试点击它。
2. 支持标准的CSS选择器语法。
3. fallback_selectors 用于当主selector失效时的备选方案。`;
    } else if (type === 'steps') {
        title = '注册步骤配置教程';
        content = `注册步骤定义了自动注册流程的具体操作。
配置格式为JSON数组，按顺序执行每个步骤。

支持的步骤类型(type):
1. navigate - 访问页面
2. click - 点击元素（可配 preferred_page_contains / page_sync_timeout_ms / skip_page_sync 控制点击后页面同步）
3. type / input - 输入文本 (推荐使用 type)
4. wait - 等待 (支持等待元素 wait_for_element 或固定时间 seconds)
5. loop_click - 循环点击直到条件满足
6. wait_verification_code - 等待并获取验证码（默认邮箱；海卡流程可通过 verification_source: 'haika_sms' 切换）
7. clash-system-proxy - 控制系统代理 (on/off)
8. get_credits - 获取积分
9. select - 下拉框选择
10. screenshot - 截图

示例:
[
  {
    "type": "navigate",
    "name": "打开注册页",
    "url": "https://example.com/register",
    "timeout": 30000
  },
  {
    "type": "type",
    "name": "输入邮箱",
    "selector": "input[type='email']",
    "text": "{account}@example.com", // {account} 为随机生成的用户名
    "timeout": 20000
  },
  {
    "type": "type",
    "name": "输入密码",
    "selector": "input[type='password']",
    "text": "{password}", // {password} 为随机生成的密码
    "timeout": 20000
  },
  {
    "type": "loop_click",
    "name": "循环点击发送验证码",
    "selector": ".send-code-btn",
    "stop_selector": "input.code-input", // 当出现此元素时停止点击
    "interval": 5000,
    "max_loop_attempts": 5
  },
  {
    "type": "wait_verification_code",
    "name": "等待验证码",
    "timeout": 60
  },
  {
    "type": "clash-system-proxy",
    "name": "关闭代理防止验证码错误",
    "action": "off"
  },
  {
    "type": "type",
    "name": "填写验证码",
    "selector": "input.code-input",
    "text": "{code}", // {code} 为获取到的验证码
    "timeout": 60000
  },
  {
    "type": "clash-system-proxy",
    "name": "恢复代理",
    "action": "on"
  },
  {
    "type": "wait",
    "name": "等待注册成功",
    "wait_for_element": ".success-message",
    "timeout": 10000
  },
  {
    "type": "wait",
    "name": "固定等待",
    "seconds": 5
  },
  {
    "type": "get_credits",
    "name": "获取积分",
    "selector": ".credits-value",
    "default": "0",
    "fallback_selectors": [".alt-credits"]
  }
]

变量替换:
- {account}: 自动生成的邮箱用户名 (不含后缀)
- {email}: 完整邮箱地址 (如果配置了)
- {password}: 自动生成的密码
- {code}: 获取到的验证码
- {smsCode}: 海卡验证码（海卡流程使用）`;
    }

    elements.tutorialTitle.textContent = title;
    elements.tutorialContent.textContent = content;
    elements.tutorialDialog.style.display = 'flex';
}

/**
 * 隐藏教程弹窗
 */
function hideTutorial(elements) {
    elements.tutorialDialog.style.display = 'none';
}

// 导出模块
module.exports = {
    showMessage,
    hideMessageDialog,
    showConfirmDialog,
    hideConfirmDialog,
    logToConsole,
    clearConsole,
    saveConsoleLog,
    adjustConcurrent,
    toggleCharsetField,
    detectBrowser,
    autoDetectBrowsers,
    updateBrowserOptions,
    addDefaultBrowserOptions,
    updateBrowserSettings,
    connectEmail,
    disconnectEmail,
    activateEmailMode,
    appendEmailLog,
    activateUploadMode,
    saveEmailLog,
    clearEmailLog,
    updateEmailStatus,
    addEmailCodeToTable,
    showTutorial,
    hideTutorial
};
