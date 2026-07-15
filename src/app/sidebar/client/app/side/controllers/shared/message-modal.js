/**
 * 消息弹窗模块
 * 提供统一的弹窗显示功能，支持服务器消息和自定义消息
 */

(function initMessageModalModule() {
const MessageModalUtils = window.RendererControllerUtils || {};
const messageModalGetEl = MessageModalUtils.getEl || ((id) => document.getElementById(id));
const messageModalEscapeHtml = MessageModalUtils.escapeHtml || ((text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
});
const ServerMessageUtils = window.AiFreeServerMessageUtils || {};
const getServerMessageText = ServerMessageUtils.getServerMessageText || (() => '');
const getServerMessageType = ServerMessageUtils.getServerMessageType || (() => '');
const getUpdateVersion = ServerMessageUtils.getUpdateVersion || (() => '');
const isShutdownAnnouncement = ServerMessageUtils.isShutdownAnnouncement || (() => false);
const isUpdateLikeMessage = ServerMessageUtils.isUpdateLikeMessage || (() => false);

// 消息队列与处理（支持优先级）
const MESSAGE_PRIORITY = { error: 40, warning: 30, maintenance: 35, success: 20, info: 10, confirm: 50 };
let messageQueue = [];
let isDisplayingMessage = false;
let currentMessageItem = null;
let loadingModalVisible = false;
let pendingLoadingMessage = '';
let lastShownUpdateVersion = '';

// 队列处理：enqueueMessage的具体业务逻辑。
function enqueueMessage(item) {
  // item: { type, message, priority, kind('info'|'confirm'), resolve callbacks... }
  item._seq = _seqCounter++;
  messageQueue.push(item);
  // 保持队列按优先级降序，然后按入队顺序
  messageQueue.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a._seq - b._seq;
  });
  processQueue();
}

let _seqCounter = 0;
// 处理/分发：processQueue的具体业务逻辑。
function processQueue() {
  if (loadingModalVisible) return;
  if (isDisplayingMessage) return;
  if (!messageQueue.length) {
    if (pendingLoadingMessage) {
      displayLoadingMessageItem(pendingLoadingMessage);
      pendingLoadingMessage = '';
    }
    return;
  }
  const item = messageQueue.shift();
  isDisplayingMessage = true;
  currentMessageItem = item;
  displayMessageItem(item);
}

// 处理：finishCurrentMessage的具体业务逻辑。
function finishCurrentMessage() {
  isDisplayingMessage = false;
  currentMessageItem = null;
  // next tick to allow DOM cleanup
  setTimeout(processQueue, 50);
}

// 将队列项渲染到 DOM 的函数
function displayMessageItem(item) {
  createModalHTML();
  ensureModalInitialized();

  const modal = messageModalGetEl('server-message-modal');
  const content = messageModalGetEl('server-message-content');
  const title = messageModalGetEl('server-message-title');
  const icon = messageModalGetEl('server-message-icon');
  const actions = messageModalGetEl('server-message-modal').querySelector('.modal-actions');

  if (!modal || !content || !title || !icon || !actions) {
    console.error('消息弹窗元素未找到');
    finishCurrentMessage();
    return;
  }

  const type = item.type || 'info';
  const typeConfig = {
    info: { icon: 'ℹ️', title: '系统消息', className: 'modal-info', sound: { freq1: 800, freq2: 600 } },
    success: { icon: '✅', title: '操作成功', className: 'modal-success', sound: { freq1: 523, freq2: 659 } },
    warning: { icon: '⚠️', title: '警告提示', className: 'modal-warning', sound: { freq1: 440, freq2: 554 } },
    maintenance: { icon: '🔧', title: '系统维护', className: 'modal-maintenance', sound: { freq1: 330, freq2: 262 } },
    error: { icon: '❌', title: '错误提示', className: 'modal-error', sound: { freq1: 220, freq2: 165 } },
    update: { icon: '⬆️', title: '发现新版本', className: 'modal-info', sound: { freq1: 784, freq2: 988 } },
    confirm: { icon: '❓', title: '请确认', className: 'modal-info', sound: { freq1: 800, freq2: 600 } }
  };

  const config = typeConfig[type] || typeConfig.info;

  // 设置文本/标题/图标
  content.textContent = item.message || '';
  title.textContent = item.title || config.title;
  icon.textContent = item.icon || config.icon;

  let promptInput = null;
  if (item.kind === 'prompt') {
    content.replaceChildren();
    const promptMessage = document.createElement('div');
    promptMessage.className = 'modal-prompt-message';
    promptMessage.textContent = item.message || '';
    promptInput = document.createElement('input');
    promptInput.className = 'modal-prompt-input';
    promptInput.type = 'text';
    promptInput.value = String(item.initialValue || '');
    promptInput.placeholder = String(item.placeholder || '');
    promptInput.maxLength = Math.max(1, Number(item.maxLength) || 80);
    promptInput.autocomplete = 'off';
    content.append(promptMessage, promptInput);
  }

  // 设置样式
  const modalContent = modal.querySelector('.modal-content');
  if (modalContent) modalContent.className = `modal-content ${config.className}`;
  modal.classList.remove('modal-update-toast');
  if (modalContent) modalContent.classList.remove('modal-update-toast-content');

  // 设置按钮
  if (item.kind === 'update') {
    // 更新弹窗只负责“提醒用户并收集确认”。
    // 真正的下载、解压都交给主进程完成；安装器会在用户关闭软件后启动。
    actions.innerHTML = `
      <button id="update-now-btn" class="btn-blue">确认下载</button>
      <button id="update-later-btn" class="btn-gray" style="margin-left: 10px;">稍后再说</button>
    `;
    const updateNowBtn = messageModalGetEl('update-now-btn');
    const updateLaterBtn = messageModalGetEl('update-later-btn');
    const payload = item.payload || {};

    if (updateNowBtn) {
      updateNowBtn.addEventListener('click', async () => {
        try {
          if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
            console.warn('[消息弹窗] start-app-update 不可用');
            hideServerMessageModal();
            return;
          }

          // 点击后立刻关闭弹窗，避免阻塞用户操作。
          // 后续进度和结果由右侧公告区接管。
          hideServerMessageModal();
          window.electronAPI.invoke('start-app-update', payload).catch((e) => {
            console.warn('[消息弹窗] 启动更新失败:', e?.message || e);
          });
        } catch (e) {
          console.warn('[消息弹窗] 启动更新失败:', e?.message || e);
        }
      });
    }

    if (updateLaterBtn) {
      updateLaterBtn.addEventListener('click', () => {
        hideServerMessageModal();
      });
    }
  } else if (item.kind === 'confirm') {
    actions.innerHTML = `
      <button id="confirm-dialog-btn" class="btn-blue">${messageModalEscapeHtml(item.confirmText || '确定')}</button>
      <button id="cancel-dialog-btn" class="btn-gray" style="margin-left: 10px;">${messageModalEscapeHtml(item.cancelText || '取消')}</button>
    `;
    const confirmBtn = messageModalGetEl('confirm-dialog-btn');
    const cancelBtn = messageModalGetEl('cancel-dialog-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        try {
          if (item.onConfirm) await item.onConfirm();
        } catch (e) {
          console.error('Confirm callback error:', e);
        }
        hideServerMessageModal();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        try { if (item.onCancel) item.onCancel(); } catch (_) {}
        hideServerMessageModal();
      });
    }
  } else if (item.kind === 'prompt') {
    actions.innerHTML = `
      <button id="prompt-dialog-confirm-btn" class="btn-blue">${messageModalEscapeHtml(item.confirmText || '保存')}</button>
      <button id="prompt-dialog-cancel-btn" class="btn-gray" style="margin-left: 10px;">${messageModalEscapeHtml(item.cancelText || '取消')}</button>
    `;
    const confirmBtn = messageModalGetEl('prompt-dialog-confirm-btn');
    const cancelBtn = messageModalGetEl('prompt-dialog-cancel-btn');
    const submitPrompt = async () => {
      const value = String(promptInput?.value || '').trim();
      if (item.required !== false && !value) {
        promptInput?.classList.add('is-invalid');
        promptInput?.focus();
        return;
      }
      if (confirmBtn) confirmBtn.disabled = true;
      try {
        if (item.onConfirm) await item.onConfirm(value);
        hideServerMessageModal();
      } catch (e) {
        console.error('Prompt callback error:', e);
        if (confirmBtn) confirmBtn.disabled = false;
      }
    };
    confirmBtn?.addEventListener('click', () => void submitPrompt());
    cancelBtn?.addEventListener('click', () => {
      try { if (item.onCancel) item.onCancel(); } catch (_) {}
      hideServerMessageModal();
    });
    promptInput?.addEventListener('input', () => promptInput.classList.remove('is-invalid'));
    promptInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submitPrompt();
      }
    });
    const focusPromptInput = () => requestAnimationFrame(() => {
      promptInput?.focus();
      promptInput?.select();
    });
    if (window.electronAPI?.invoke) {
      void window.electronAPI.invoke('focus-sidebar-input').finally(focusPromptInput);
    } else {
      focusPromptInput();
    }
  } else {
    actions.innerHTML = '<button id="acknowledge-message" class="btn-blue">我知道了</button>';
    const ack = messageModalGetEl('acknowledge-message');
    if (ack) {
      ack.addEventListener('click', () => {
        hideServerMessageModal();
      });
    }
  }

  // 显示弹窗并播放声音
  modal.style.display = 'flex';
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(config.sound.freq1, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(config.sound.freq2, audioContext.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.warn('无法播放提示音:', e.message);
  }
}

// 启动/打开/显示：displayLoadingMessageItem的具体业务逻辑。
function displayLoadingMessageItem(message) {
  createModalHTML();
  ensureModalInitialized();

  const modal = messageModalGetEl('server-message-modal');
  const content = messageModalGetEl('server-message-content');
  const title = messageModalGetEl('server-message-title');
  const icon = messageModalGetEl('server-message-icon');
  const closeBtn = messageModalGetEl('close-message-modal');
  const actions = messageModalGetEl('server-message-modal')?.querySelector('.modal-actions');
  const modalContent = modal?.querySelector('.modal-content');

  if (!modal || !content || !title || !icon || !actions || !modalContent) {
    return;
  }

  loadingModalVisible = true;
  isDisplayingMessage = false;
  currentMessageItem = null;

  content.textContent = message || '处理中，请稍等...';
  title.textContent = '系统消息';
  icon.textContent = '⏳';
  modalContent.className = 'modal-content modal-info';
  actions.innerHTML = '';
  if (closeBtn) closeBtn.style.display = 'none';
  modal.dataset.loading = '1';
  modal.style.display = 'flex';
}

/**
 * 创建弹窗HTML结构
 * 这个函数会动态创建弹窗的HTML元素并插入到body中
 */
function createModalHTML() {
  // 检查是否已经存在弹窗
  if (document.getElementById('server-message-modal')) {
    return;
  }

  // 创建弹窗HTML结构
  const modalHTML = `
    <div id="server-message-modal" class="modal-overlay" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-header-content">
            <div class="modal-icon" id="server-message-icon">ℹ️</div>
            <h3 id="server-message-title">系统消息</h3>
          </div>
          <button id="close-message-modal" class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div id="server-message-content"></div>
          <div class="modal-actions">
            <button id="acknowledge-message" class="btn-blue">我知道了</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // 将弹窗插入到body末尾
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * 显示服务器消息弹窗
 * @param {Object} messageData - 消息数据对象
 * @param {string} messageData.message - 消息内容
 * @param {string} messageData.type - 消息类型：'info'(默认), 'success', 'warning', 'error', 'announcement'
 * @param {string} messageData.message_type - 公告消息的类型（当type为'announcement'时使用）
 */
function showServerMessage(messageData) {
  // 处理不同类型的服务器消息
  let type = messageData.type || 'info';
  let message = messageData.message || '收到服务器消息';
  const messageType = getServerMessageType(messageData);
  const messageText = getServerMessageText(messageData) || message;

  if (isUpdateLikeMessage(messageData)) {
    return;
  }

  // 如果是公告消息，使用 message_type 作为显示类型
  if (type === 'announcement') {
    if (messageType === 'update' || messageType === 'upgrade') {
      return;
    }
    if (isShutdownAnnouncement(messageData) || messageType === 'shutdown' || messageText.includes('软件暂时无法使用') || messageText.includes('停用')) {
      return;
    }
    // 服务器公告类型映射到前端显示类型
    const announcementTypeMap = {
      'normal': 'info',
      'warning': 'warning',
      'error': 'error',
      'maintenance': 'maintenance', // maintenance使用专用样式
      'success': 'success'
    };

    type = announcementTypeMap[messageType] || 'info';
  }

  const priority = MESSAGE_PRIORITY[type] || MESSAGE_PRIORITY.info;
  enqueueMessage({
    kind: 'info',
    type,
    title: messageData.title || undefined,
    message,
    priority
  });
}

/**
 * 隐藏消息弹窗
 */
function hideServerMessageModal() {
  const modal = messageModalGetEl('server-message-modal');
  if (modal) {
    modal.style.display = 'none';
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.classList.remove('modal-update-toast-content');
    }
    // 当手动隐藏弹窗时，结束当前消息并继续下一个
    finishCurrentMessage();
  }
}

/**
 * 显示自定义消息弹窗
 * @param {string} message - 要显示的消息内容
 * @param {string} type - 消息类型：'info'(默认), 'success', 'warning', 'error'
 */
function showMessage(message, type = 'info') {
  showServerMessage({ message: message, type: type });
}

// 启动/打开/显示：showUpdateMessage的具体业务逻辑。
function showUpdateMessage(messageData = {}) {
  const payload = messageData && typeof messageData === 'object' ? messageData : {};
  const versionKey = getUpdateVersion(payload);
  if (versionKey && versionKey === lastShownUpdateVersion) {
    return;
  }
  if (versionKey) {
    lastShownUpdateVersion = versionKey;
  }
  enqueueMessage({
    kind: 'update',
    type: 'update',
    title: payload.title || '发现新版本',
    message: payload.content || payload.message || `发现新版本 v${versionKey}`.trim(),
    priority: MESSAGE_PRIORITY.confirm + 5,
    payload,
  });
}

// 启动/打开/显示：showLoadingMessage的具体业务逻辑。
function showLoadingMessage(message = '处理中，请稍等...') {
  pendingLoadingMessage = String(message || '处理中，请稍等...');
  processQueue();
}

// 停止/关闭/清理：hideLoadingMessage的具体业务逻辑。
function hideLoadingMessage() {
  const modal = messageModalGetEl('server-message-modal');
  const closeBtn = messageModalGetEl('close-message-modal');
  const actions = messageModalGetEl('server-message-modal')?.querySelector('.modal-actions');
  if (!modal) return;

  if (modal.dataset.loading === '1') {
    modal.style.display = 'none';
    modal.dataset.loading = '0';
    if (closeBtn) closeBtn.style.display = '';
    if (actions) {
      actions.innerHTML = '<button id="acknowledge-message" class="btn-blue">我知道了</button>';
      const ack = messageModalGetEl('acknowledge-message');
      if (ack) {
        ack.addEventListener('click', () => {
          hideServerMessageModal();
        });
      }
    }
  }

  loadingModalVisible = false;
  pendingLoadingMessage = '';
  setTimeout(processQueue, 50);
}

/**
 * 显示确认对话框
 * @param {string} message - 要显示的消息内容
 * @param {Function} onConfirm - 用户点击确认时的回调函数
 * @param {Function} onCancel - 用户点击取消时的回调函数
 * @param {string} type - 消息类型：'info'(默认), 'success', 'warning', 'error'
 * @param {Object} options - 可选标题、图标和按钮文字
 */
function showConfirmDialog(message, onConfirm, onCancel, type = 'info', options = {}) {
  // 将确认对话加入队列，按确认优先级处理
  const priority = MESSAGE_PRIORITY.confirm || (MESSAGE_PRIORITY.info + 10);
  enqueueMessage({
    kind: 'confirm',
    type: type === 'info' ? 'confirm' : type,
    title: String(options?.title || '').trim() || undefined,
    icon: String(options?.icon || '').trim() || undefined,
    confirmText: String(options?.confirmText || '').trim() || undefined,
    cancelText: String(options?.cancelText || '').trim() || undefined,
    message,
    priority,
    onConfirm,
    onCancel
  });
}

// 侧边栏统一承载浏览器数据清理确认，避免使用系统原生弹窗。
function bindBrowserDataClearConfirmListener() {
  if (!window.electronAPI || typeof window.electronAPI.on !== 'function') return;
  if (window.__browserDataClearConfirmListenerBound) return;
  window.__browserDataClearConfirmListenerBound = true;

  window.electronAPI.on('browser-data-clear-confirm-request', (payload = {}) => {
    const requestId = String(payload?.requestId || '').trim();
    const browserTitle = String(payload?.title || '当前浏览器').trim() || '当前浏览器';
    if (!requestId) return;
    const respond = async (confirmed) => {
      try {
        const result = await window.electronAPI.invoke('resolve-browser-data-clear-confirm', {
          requestId,
          confirmed: confirmed === true,
        });
        if (confirmed !== true) return;
        if (!result?.ok) {
          showErrorMessage(result?.message || result?.error || '清空浏览器数据失败');
          return;
        }
        showSuccessMessage('浏览器数据已清空');
      } catch (error) {
        if (confirmed === true) showErrorMessage(error?.message || '清空浏览器数据失败');
      }
    };
    showConfirmDialog(
      `确认清空"${browserTitle}"的浏览器数据?\n\nCookie、缓存、浏览历史、本地存储和页面会话将被删除，浏览器会自动重新打开。窗口配置和已下载文件会保留。`,
      () => respond(true),
      () => respond(false),
      'warning',
      {
        title: '清空浏览器数据',
        confirmText: '确认清空',
        cancelText: '取消',
      },
    );
  });
}

// 启动/打开/显示：显示软件内置文本输入弹窗。
function showPromptDialog(message, initialValue, onConfirm, onCancel, options = {}) {
  enqueueMessage({
    kind: 'prompt',
    type: options.type || 'confirm',
    title: options.title || '请输入',
    message,
    initialValue,
    placeholder: options.placeholder || '',
    maxLength: options.maxLength || 80,
    required: options.required !== false,
    confirmText: options.confirmText || '保存',
    cancelText: options.cancelText || '取消',
    priority: MESSAGE_PRIORITY.confirm,
    onConfirm,
    onCancel,
  });
}

/**
 * 初始化弹窗事件绑定
 * 这个函数需要在 DOM 加载完成后调用
 * 由于弹窗是动态创建的，这个函数会在首次显示弹窗时自动调用
 */
function initMessageModal() {
  // 确保弹窗HTML已创建
  createModalHTML();

  const modal = messageModalGetEl('server-message-modal');
  const closeBtn = messageModalGetEl('close-message-modal');
  const acknowledgeBtn = messageModalGetEl('acknowledge-message');

  if (closeBtn) {
    closeBtn.addEventListener('click', hideServerMessageModal);
  }

  if (acknowledgeBtn) {
    acknowledgeBtn.addEventListener('click', hideServerMessageModal);
  }

  // 点击遮罩层关闭弹窗
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (modal.dataset.loading === '1') return;
      if (e.target === modal) {
        hideServerMessageModal();
      }
    });
  }

  // ESC键关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (modal && modal.dataset.loading === '1') return;
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      hideServerMessageModal();
    }
  });
}

// 标记弹窗是否已初始化
let isModalInitialized = false;
let lastServerMessageFingerprint = '';

/**
 * 确保弹窗已初始化
 * 这个函数会在显示弹窗前自动调用
 */
function ensureModalInitialized() {
  if (!isModalInitialized) {
    initMessageModal();
    isModalInitialized = true;
  }
}

/**
 * 监听服务器消息
 * 这个函数需要在 electronAPI 可用时调用
 */
function initServerMessageListener() {
  bindBrowserDataClearConfirmListener();
  if (window.__messageModalServerListenerBound) {
    return;
  }

  if (window.electronAPI && window.electronAPI.on) {
    window.__messageModalServerListenerBound = true;
    window.electronAPI.on('app-update-notice', (messageData) => {
      showUpdateMessage(messageData);
    });
    window.electronAPI.on('server-message', (messageData) => {
      const messageType = getServerMessageType(messageData);
      const messageText = getServerMessageText(messageData);
      const announcementId = messageData?.announcement_id ?? '-';
      const fingerprint = JSON.stringify([
        String(announcementId),
        String(messageData?.type || ''),
        String(messageType || ''),
        String(messageText || '').trim(),
      ]);
      if (fingerprint === lastServerMessageFingerprint) {
        console.log(`[公告] 跳过连续重复消息: #${announcementId}`);
        return;
      }
      lastServerMessageFingerprint = fingerprint;
      const logText = String(messageText || '').replace(/\s+/g, ' ').slice(0, 160);
      console.log(`[公告] #${announcementId} ${messageType || 'normal'}: ${logText}`);

      // 特殊处理账号cookie自动处理消息
      if (messageData.type === 'account_cookie_auto_process' && messageData.data && messageData.data.autoProcess) {
        console.log('[消息弹窗] 检测到账号cookie自动处理消息，转发到侧边栏处理');

        // 显示处理提示
        if (window.MessageModal) {
          window.MessageModal.showInfoMessage(messageData.message || '正在自动处理服务器推送的账号...');
        }

        // 转发到侧边栏的账号处理逻辑
        // 模拟触发server-account-cookie-received事件
        if (window.electronAPI && window.electronAPI.send) {
          console.log('[消息弹窗] 正在发送账号 Cookie 数据到侧边栏');
          window.electronAPI.send('server-account-cookie-received', messageData.data);
        } else {
          console.error('[消息弹窗] electronAPI.send不可用，无法转发账号cookie数据');
        }

        return; // 不显示普通的服务器消息弹窗
      }

      // 更新/停用类公告交给专门流程；其余服务器公告在这里弹窗显示。
      if (isUpdateLikeMessage(messageData)) {
        return;
      }

      if (messageData.type === 'app-update-notice') {
        showUpdateMessage(messageData);
        return;
      }

      if (isShutdownAnnouncement(messageData) || (messageData.type === 'announcement' && (messageType === 'shutdown' || messageText.includes('软件暂时无法使用') || messageText.includes('停用')))) {
        console.log('[消息弹窗] 检测到停用公告，跳过弹窗显示');
        return;
      }

      showServerMessage(messageData);
    });
  }
}

// 便捷方法：显示不同类型的消息
function showInfoMessage(message) {
  showMessage(message, 'info');
}

// 启动/打开/显示：showSuccessMessage的具体业务逻辑。
function showSuccessMessage(message) {
  showMessage(message, 'success');
}

// 启动/打开/显示：showWarningMessage的具体业务逻辑。
function showWarningMessage(message) {
  showMessage(message, 'warning');
}

// 启动/打开/显示：showErrorMessage的具体业务逻辑。
function showErrorMessage(message) {
  showMessage(message, 'error');
}

// 导出模块接口
window.MessageModal = {
  showServerMessage,
  hideServerMessageModal,
  showMessage,
  showUpdateMessage,
  showInfoMessage,
  showSuccessMessage,
  showWarningMessage,
  showErrorMessage,
  showLoadingMessage,
  hideLoadingMessage,
  showConfirmDialog,
  bindBrowserDataClearConfirmListener,
  showPromptDialog,
  initMessageModal,
  initServerMessageListener,
  createModalHTML,
  ensureModalInitialized
};
}());
