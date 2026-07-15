// 顶部标签栏控制（渲染进程）
// 优先使用 preload 暴露的 window.electronAPI；在主窗口未启用 contextIsolation 时回退到 ipcRenderer

const AppShellUtils = window.RendererControllerUtils || {};
const IPC = AppShellUtils.getIpcBridge ? AppShellUtils.getIpcBridge() : (() => {
  if (window.electronAPI && typeof window.electronAPI.send === 'function' && typeof window.electronAPI.on === 'function') {
    return {
      send: window.electronAPI.send,
      on: window.electronAPI.on,
      invoke: typeof window.electronAPI.invoke === 'function' ? window.electronAPI.invoke.bind(window.electronAPI) : null,
    };
  }
  try {
    const { ipcRenderer } = require('electron');
    return {
      send: ipcRenderer.send.bind(ipcRenderer),
      on: (channel, fn) => ipcRenderer.on(channel, (_evt, ...args) => fn(...args)),
      invoke: ipcRenderer.invoke.bind(ipcRenderer),
    };
  } catch (_) {
    return { send: () => {}, on: () => {}, invoke: () => Promise.resolve({ ok: false, message: 'IPC 不可用' }) };
  }
})();
const showControllerError = AppShellUtils.showUserError
  ? (prefix, err) => AppShellUtils.showUserError(`${prefix}: ${err && (err.message || String(err))}`)
  : (prefix, err) => {
      const msg = err && (err.message || String(err));
      if (window.MessageModal && typeof window.MessageModal.showErrorMessage === 'function') {
        window.MessageModal.showErrorMessage(`${prefix}: ${msg}`);
      } else {
        console.warn(`[标签栏] ${prefix}:`, msg);
      }
    };

const APP_THEME_STORAGE_KEY = 'ai-free.control-panel.theme';
const appShellUpdateState = {
  activated: false,
  version: '',
};

function normalizeAppTheme(theme) {
  return String(theme || '').trim() === 'light' ? 'light' : 'dark';
}

function getSavedAppTheme() {
  try {
    return normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch (_) {
    return 'dark';
  }
}

function applyAppShellTheme(theme, options = {}) {
  const nextTheme = normalizeAppTheme(theme);
  const isLight = nextTheme === 'light';
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.dataset.theme = nextTheme;
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.title = isLight ? '切换到深色模式' : '切换到白色模式';
    themeToggleBtn.setAttribute('aria-label', themeToggleBtn.title);
    themeToggleBtn.setAttribute('aria-pressed', String(isLight));
  }
  if (options.persist === true) {
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, nextTheme);
    } catch (_) {}
  }
}

applyAppShellTheme(getSavedAppTheme());

if (IPC && typeof IPC.on === 'function') {
  IPC.on('app-theme-changed', (theme) => {
    applyAppShellTheme(theme, { persist: true });
  });
  IPC.on('independent-browser-create-failed', (payload = {}) => {
    if (String(payload?.tabId || '') === String(pendingRenameTabId || '')) pendingRenameTabId = null;
    showControllerError('新建浏览器窗口失败', new Error(payload?.error || '浏览器环境启动失败'));
  });
  IPC.on('app-shell-account-updated', (session = {}) => {
    renderAppShellAccount(session);
  });
  IPC.on('app-update-activated', (payload = {}) => {
    appShellUpdateState.activated = true;
    renderAppShellUpdateProgress({ ...payload, phase: 'confirmed' });
  });
  IPC.on('app-update-progress', (payload = {}) => {
    renderAppShellUpdateProgress(payload);
  });
  IPC.on('app-update-complete', (payload = {}) => {
    appShellUpdateState.activated = true;
    renderAppShellUpdateProgress({ ...payload, phase: 'completed', percent: 100 });
  });
  IPC.on('app-update-error', () => resetAppShellUpdateProgress());
  IPC.on('app-update-skip', () => resetAppShellUpdateProgress());
}

let tabsContainer = document.getElementById('tabs-container');
let addTabBtn = document.getElementById('add-tab-btn');
let newBrowserWindowBtn = document.getElementById('new-browser-window-btn');
let accountCenterBtn = document.getElementById('account-center-btn');

function setAppShellUpdateVisible(visible) {
  const widget = document.getElementById('update-widget');
  if (widget) widget.hidden = !visible;
}

function resetAppShellUpdateProgress() {
  appShellUpdateState.activated = false;
  appShellUpdateState.version = '';
  const ring = document.getElementById('update-widget-ring');
  const percent = document.getElementById('update-widget-percent');
  const widget = document.getElementById('update-widget');
  if (ring) ring.style.setProperty('--update-progress', '0%');
  if (percent) percent.textContent = '0%';
  if (widget) widget.title = '准备更新';
  setAppShellUpdateVisible(false);
}

function renderAppShellUpdateProgress(payload = {}) {
  const phase = String(payload.phase || '').trim().toLowerCase();
  if (phase === 'error' || phase === 'failed' || phase === 'skip') {
    resetAppShellUpdateProgress();
    return;
  }
  if (!appShellUpdateState.activated && !['confirmed', 'downloading', 'opening', 'completed'].includes(phase)) {
    return;
  }

  const rawPercent = Number(payload.percent);
  const percentValue = Number.isFinite(rawPercent)
    ? Math.max(0, Math.min(100, Math.round(rawPercent)))
    : (phase === 'completed' ? 100 : 0);
  const version = String(payload.version || payload.targetVersion || payload.latestVersion || payload.latest_version || '').trim();
  const message = String(payload.message || payload.content || '').trim();
  if (version) appShellUpdateState.version = version;

  const ring = document.getElementById('update-widget-ring');
  const percent = document.getElementById('update-widget-percent');
  const widget = document.getElementById('update-widget');
  if (ring) ring.style.setProperty('--update-progress', `${percentValue}%`);
  if (percent) percent.textContent = `${percentValue}%`;
  if (widget) {
    const versionLabel = appShellUpdateState.version ? ` v${appShellUpdateState.version}` : '';
    widget.title = phase === 'completed'
      ? `更新${versionLabel}已下载完成`
      : (message || `正在更新${versionLabel}：${percentValue}%`);
  }
  setAppShellUpdateVisible(true);
}

function bindThemeToggleBtnOnce() {
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (!themeToggleBtn || themeToggleBtn.dataset.bound === '1') return;
  themeToggleBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const currentTheme = document.documentElement.classList.contains('theme-light') ? 'light' : 'dark';
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyAppShellTheme(nextTheme, { persist: true });
    IPC.send('app-theme-changed', nextTheme);
  });
  themeToggleBtn.dataset.bound = '1';
  applyAppShellTheme(document.documentElement.classList.contains('theme-light') ? 'light' : 'dark');
}

// 监听/绑定：onReady的具体业务逻辑。
function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

let toggleSidebarClickLock = false;
let sidebarReopenHintTimer = null;
let draggedTabId = null;
let dragHoverTabId = null;
let dragHoverPosition = null;
let currentContextMenuTabId = null;
const tabElementById = new Map();
let pendingRenameTabId = null;

function clearSidebarReopenHint() {
  if (sidebarReopenHintTimer) {
    clearTimeout(sidebarReopenHintTimer);
    sidebarReopenHintTimer = null;
  }
  const button = document.getElementById('add-tab-btn');
  if (!button) return;
  button.classList.remove('sidebar-reopen-hint');
  button.title = '单击切换侧栏，双击打开网页控制台';
  button.setAttribute('aria-label', '切换侧栏');
}

function renderAppShellAccount(session = {}) {
  accountCenterBtn = document.getElementById('account-center-btn');
  if (!accountCenterBtn) return;
  const authenticated = session.authenticated === true;
  const username = authenticated ? String(session.username || '').trim() : '';
  accountCenterBtn.dataset.authenticated = authenticated ? 'true' : 'false';
  accountCenterBtn.title = authenticated ? (username || '个人中心') : '个人中心（未登录）';
  accountCenterBtn.setAttribute('aria-label', authenticated
    ? `打开 ${username || '当前账号'} 的个人中心`
    : '打开个人中心（未登录）');
}

function bindAccountCenterBtnOnce() {
  accountCenterBtn = document.getElementById('account-center-btn');
  if (!accountCenterBtn || accountCenterBtn.dataset.bound === '1') return;
  accountCenterBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = accountCenterBtn.getBoundingClientRect();
    IPC.send('toggle-account-center-popup', {
      anchor: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    });
  });
  accountCenterBtn.dataset.bound = '1';
  if (typeof IPC.invoke === 'function') {
    IPC.invoke('account-get-session')
      .then((session) => renderAppShellAccount(session || {}))
      .catch(() => renderAppShellAccount({ authenticated: false }));
  }
}

function bindAccountCenterOutsideDismissOnce() {
  if (document.documentElement.dataset.accountCenterOutsideDismissBound === '1') return;
  document.documentElement.dataset.accountCenterOutsideDismissBound = '1';
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target?.closest?.('#account-center-btn')) return;
    IPC.send('dismiss-account-center-popup');
  }, true);
}

function beginTabRename(tabElement, options = {}) {
  if (!tabElement || tabElement.querySelector('.tab-title-editor')) return;
  const historyId = String(tabElement.dataset.browserHistoryId || '').trim();
  const titleSpan = tabElement.querySelector('.tab-title');
  if (!historyId || !titleSpan) return;
  const previousName = String(titleSpan.textContent || '').trim() || '新建窗口';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-title-editor';
  input.value = previousName;
  input.setAttribute('aria-label', '浏览器窗口名称');
  titleSpan.replaceWith(input);
  let completed = false;
  const finish = async (save) => {
    if (completed) return;
    completed = true;
    const requestedName = input.value;
    const replacement = document.createElement('span');
    replacement.className = 'tab-title';
    replacement.textContent = previousName;
    input.replaceWith(replacement);
    if (!save) return;
    try {
      const response = await IPC.invoke('rename-browser-history', { historyId, name: requestedName });
      if (!response?.ok) throw new Error(response?.error || '重命名失败');
      replacement.textContent = response.name;
    } catch (error) {
      showControllerError('重命名浏览器窗口失败', error);
    }
  };
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
  });
  // 新建窗口期间 Chromium HWND 正在创建/嵌入，原生焦点可能短暂变化。
  // 自动重命名必须等用户明确按 Enter；双击编辑仍保留失焦保存习惯。
  if (options.commitOnBlur !== false) {
    input.addEventListener('blur', () => void finish(true));
  }
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

// 停止/关闭/清理：clearDragIndicators的具体业务逻辑。
function clearDragIndicators() {
  if (!tabsContainer) return;
  tabsContainer.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.remove('dragging', 'drop-before', 'drop-after');
  });
  dragHoverTabId = null;
  dragHoverPosition = null;
}

// 获取/读取/解析：getDropPosition的具体业务逻辑。
function getDropPosition(event, tabElement) {
  if (!tabElement) return 'before';
  const rect = tabElement.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;
  return event.clientX < midpoint ? 'before' : 'after';
}

// 设置/更新/持久化：updateDragHoverState的具体业务逻辑。
function updateDragHoverState(tabElement, position) {
  if (!tabsContainer) return;
  tabsContainer.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.remove('drop-before', 'drop-after');
  });
  if (!tabElement) return;
  tabElement.classList.add(position === 'after' ? 'drop-after' : 'drop-before');
  dragHoverTabId = tabElement.dataset.id || null;
  dragHoverPosition = position;
}

// 停止/关闭/清理：hideTabContextMenu的具体业务逻辑。
function hideTabContextMenu() {
  currentContextMenuTabId = null;
}

// 校验/保护：ensureTabContextMenu的具体业务逻辑。
function ensureTabContextMenu() {
  return null;
}

// 启动/打开/显示：showTabContextMenu的具体业务逻辑。
async function showTabContextMenu(tab, event) {
  const tabId = String(tab?.id || '').trim();
  currentContextMenuTabId = tabId;
  try {
    if (typeof IPC.invoke !== 'function') {
      throw new Error('当前环境不支持标签菜单');
    }
    const resp = await IPC.invoke('show-tab-context-menu', {
      tabId,
      x: Number(event?.clientX ?? 0),
      y: Number(event?.clientY ?? 0),
      browserProxyMode: String(tab?.browserProxyMode || 'inherit').trim() || 'inherit',
    });
    if (!resp || resp.ok !== true) {
      throw new Error((resp && (resp.message || resp.error)) || '打开菜单失败');
    }
  } catch (err) {
    showControllerError('打开标签菜单失败', err);
  }
}

// 创建/初始化：bindTabContextMenuDismissal的具体业务逻辑。
function bindTabContextMenuDismissal() {
  return;
}

// 创建/初始化：buildTabTooltip的具体业务逻辑。
function buildTabTooltip(tab) {
  const title = String(tab?.title || '').trim() || '未命名标签页';
  const tabId = String(tab?.id || '').trim() || 'unknown';
  const accountId = String(tab?.accountId || '').trim() || 'none';
  const browserProxyMode = String(tab?.browserProxyMode || 'inherit').trim() || 'inherit';
  const activeText = tab?.isActive ? '是' : '否';
  const profile = tab?.browserProfile && typeof tab.browserProfile === 'object' ? tab.browserProfile : null;
  const browserBrand = String(profile?.browserBrand || '未知').trim() || '未知';
  const browserType = String(profile?.browserType || '').trim();
  const regionLabel = String(profile?.regionLabel || '').trim();
  const region = String(profile?.region || '').trim();
  const sourceIp = String(profile?.sourceIp || '').trim();
  const sourceCountryCode = String(profile?.sourceCountryCode || '').trim();
  const sourceCountry = String(profile?.sourceCountry || '').trim();
  const locale = String(profile?.locale || '').trim();
  const timezoneId = String(profile?.timezoneId || '').trim();
  const acceptLanguage = String(profile?.acceptLanguage || '').trim();
  const userAgent = String(profile?.userAgent || '').trim();
  return [
    `标题: ${title}`,
    `tabId: ${tabId}`,
    `accountId: ${accountId}`,
    `当前激活: ${activeText}`,
    `代理模式: ${browserProxyMode}`,
    `运行时: ${String(tab?.runtimeType || 'chromium')} (${String(tab?.runtimeStatus || 'starting')})`,
    `浏览器: ${browserBrand}${browserType ? ` (${browserType})` : ''}`,
    `来源IP: ${sourceIp || '自动'}`,
    `来源国家: ${sourceCountry || sourceCountryCode || '自动'}`,
    `地区: ${regionLabel || region || '自动'}`,
    `语言: ${locale || '自动'}`,
    `时区: ${timezoneId || '自动'}`,
    `Accept-Language: ${acceptLanguage || '自动'}`,
    `UA: ${userAgent || '自动'}`,
  ].join('\n');
}

// 设置/更新/持久化：applyAdaptiveTabSizing的具体业务逻辑。
function applyAdaptiveTabSizing() {
  if (!tabsContainer) return;
  const tabs = tabsContainer.querySelectorAll('.tab');
  if (!tabs.length) return;

  const rect = tabsContainer.getBoundingClientRect();
  const containerWidth = Math.max(rect.width || tabsContainer.clientWidth || 0, 0);
  const tabCount = tabs.length;
  const gapCount = Math.max(tabCount - 1, 0);
  const tabGap = parseFloat(getComputedStyle(tabsContainer).gap) || 4;
  const createButtonWidth = newBrowserWindowBtn?.offsetWidth || 0;
  const availableWidth = Math.max(containerWidth - createButtonWidth - ((gapCount + 1) * tabGap), 320);
  const idealWidth = Math.floor(availableWidth / tabCount);
  const tabWidth = Math.max(108, Math.min(220, idealWidth));

  tabs.forEach((tab) => {
    tab.style.flex = `0 0 ${tabWidth}px`;
    tab.style.width = `${tabWidth}px`;
    tab.style.maxWidth = `${tabWidth}px`;
    tab.style.minWidth = `${tabWidth}px`;
  });
}

// 创建/初始化：createTabElement的具体业务逻辑。
function createTabElement(tab) {
  const tabElement = document.createElement('div');
  tabElement.className = 'tab';
  if (tab.isActive) tabElement.classList.add('active');
  tabElement.dataset.id = tab.id;
  tabElement.draggable = true;
  tabElement.title = buildTabTooltip(tab);
  tabElement.dataset.browserBrand = String(tab?.browserProfile?.browserBrand || '');
  tabElement.dataset.browserType = String(tab?.browserProfile?.browserType || '');
  tabElement.dataset.browserRegion = String(tab?.browserProfile?.region || '');
  tabElement.dataset.browserSourceIp = String(tab?.browserProfile?.sourceIp || '');
  tabElement.dataset.browserLocale = String(tab?.browserProfile?.locale || '');
  tabElement.dataset.browserTimezone = String(tab?.browserProfile?.timezoneId || '');
  tabElement.dataset.browserAcceptLanguage = String(tab?.browserProfile?.acceptLanguage || '');
  tabElement.dataset.runtimeType = String(tab?.runtimeType || 'chromium');
  tabElement.dataset.runtimeStatus = String(tab?.runtimeStatus || 'ready');
  tabElement.dataset.browserHistoryId = String(tab?.browserHistoryId || '');

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = tab.title;
  titleSpan.title = buildTabTooltip(tab);
  tabElement.appendChild(titleSpan);

  if (tab?.runtimeType === 'chromium') {
    const runtimeBadge = document.createElement('button');
    const crashed = tab.runtimeStatus === 'crashed';
    runtimeBadge.type = 'button';
    runtimeBadge.className = `tab-runtime-badge${crashed ? ' crashed' : ''}`;
    runtimeBadge.textContent = crashed ? '重启' : 'C';
    runtimeBadge.title = crashed ? 'AI-FREE 已退出，点击重新启动环境' : `AI-FREE: ${tab.runtimeStatus || 'ready'}`;
    runtimeBadge.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!crashed || typeof IPC.invoke !== 'function' || runtimeBadge.disabled) return;
      runtimeBadge.disabled = true;
      runtimeBadge.textContent = '…';
      try {
        const result = await IPC.invoke('restart-browser-runtime', { profileId: tab.id });
        if (!result?.ok) throw new Error(result?.message || '重启失败');
      } catch (error) {
        showControllerError('重启 AI-FREE 环境失败', error);
        runtimeBadge.disabled = false;
        runtimeBadge.textContent = '重启';
      }
    });
    tabElement.appendChild(runtimeBadge);
  }

  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = 'x';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    IPC.send('close-tab', tab.id);
  });
  closeBtn.addEventListener('auxclick', (e) => {
    e.stopPropagation();
  });
  tabElement.appendChild(closeBtn);

  tabElement.addEventListener('click', () => {
    IPC.send('switch-tab', tab.id);
  });

  tabElement.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginTabRename(tabElement);
  });

  tabElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void showTabContextMenu(tab, e);
  });

  tabElement.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    IPC.send('close-tab', tab.id);
  });

  tabElement.addEventListener('dragstart', (e) => {
    draggedTabId = tab.id;
    tabElement.classList.add('dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id);
    } catch (_) {}
  });

  tabElement.addEventListener('dragend', () => {
    draggedTabId = null;
    clearDragIndicators();
  });

  tabElement.addEventListener('dragover', (e) => {
    if (!draggedTabId || draggedTabId === tab.id) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch (_) {}
    const position = getDropPosition(e, tabElement);
    if (dragHoverTabId !== tab.id || dragHoverPosition !== position) {
      updateDragHoverState(tabElement, position);
    }
  });

  tabElement.addEventListener('dragleave', () => {
    if (dragHoverTabId === tab.id) {
      tabElement.classList.remove('drop-before', 'drop-after');
      dragHoverTabId = null;
      dragHoverPosition = null;
    }
  });

  tabElement.addEventListener('drop', (e) => {
    e.preventDefault();
    const sourceTabId = draggedTabId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    if (!sourceTabId || sourceTabId === tab.id) {
      clearDragIndicators();
      return;
    }
    const position = getDropPosition(e, tabElement);
    IPC.send('reorder-tab', { tabId: sourceTabId, targetTabId: tab.id, position });
    clearDragIndicators();
  });

  return tabElement;
}

// 同步/连接：syncTabElement的具体业务逻辑。
function syncTabElement(tabElement, tab) {
  const titleSpan = tabElement.querySelector('.tab-title');
  if (titleSpan) {
    if (titleSpan.textContent !== tab.title) {
      titleSpan.textContent = tab.title;
    }
    titleSpan.title = buildTabTooltip(tab);
  }
  tabElement.title = buildTabTooltip(tab);
  tabElement.dataset.browserBrand = String(tab?.browserProfile?.browserBrand || '');
  tabElement.dataset.browserType = String(tab?.browserProfile?.browserType || '');
  tabElement.dataset.browserRegion = String(tab?.browserProfile?.region || '');
  tabElement.dataset.browserSourceIp = String(tab?.browserProfile?.sourceIp || '');
  tabElement.dataset.browserLocale = String(tab?.browserProfile?.locale || '');
  tabElement.dataset.browserTimezone = String(tab?.browserProfile?.timezoneId || '');
  tabElement.dataset.browserAcceptLanguage = String(tab?.browserProfile?.acceptLanguage || '');
  tabElement.dataset.browserHistoryId = String(tab?.browserHistoryId || '');
  tabElement.classList.toggle('active', !!tab.isActive);
}

function bindNewBrowserWindowBtnOnce() {
  newBrowserWindowBtn = document.getElementById('new-browser-window-btn');
  if (!newBrowserWindowBtn || newBrowserWindowBtn.dataset.bound === '1') return;
  newBrowserWindowBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (newBrowserWindowBtn.disabled) return;
    newBrowserWindowBtn.disabled = true;
    try {
      const response = await IPC.invoke('create-independent-browser', { name: '新建窗口' });
      if (!response?.ok) throw new Error(response?.error || '新建浏览器窗口失败');
      pendingRenameTabId = String(response.tabId || '');
      const tabElement = tabElementById.get(pendingRenameTabId);
      if (tabElement) {
        beginTabRename(tabElement, { commitOnBlur: false });
        pendingRenameTabId = null;
      }
    } catch (error) {
      showControllerError('新建浏览器窗口失败', error);
    } finally {
      newBrowserWindowBtn.disabled = false;
    }
  });
  newBrowserWindowBtn.dataset.bound = '1';
}

// 同步/连接：bindAddTabBtnOnce的具体业务逻辑。
function bindAddTabBtnOnce() {
  addTabBtn = document.getElementById('add-tab-btn');
  if (!addTabBtn) return;
  if (addTabBtn.dataset.bound === '1') return;
  addTabBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearSidebarReopenHint();

    if (toggleSidebarClickLock) return;
    toggleSidebarClickLock = true;
    IPC.send('toggle-sidebar');
    setTimeout(() => { toggleSidebarClickLock = false; }, 300);
  });
  addTabBtn.addEventListener('dblclick', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const invokeFn = IPC.invoke;
      if (typeof invokeFn !== 'function') {
        throw new Error('当前环境不支持打开网页控制台');
      }
      const resp = await invokeFn('open-active-web-console');
      if (!resp || resp.ok !== true) {
        throw new Error((resp && (resp.message || resp.error)) || '打开网页控制台失败');
      }
    } catch (err) {
      showControllerError('打开网页控制台失败', err);
    }
  });
  addTabBtn.dataset.bound = '1';
}

onReady(() => {
  tabsContainer = document.getElementById('tabs-container');
  bindAddTabBtnOnce();
  bindThemeToggleBtnOnce();
  bindAccountCenterBtnOnce();
  bindAccountCenterOutsideDismissOnce();
  bindNewBrowserWindowBtnOnce();

  // 初始化设置按钮动画监听器
  initSettingsBtnAnimation();
});

// 设置按钮动画监听器
function initSettingsBtnAnimation() {
  const addTabBtn = document.getElementById('add-tab-btn');
  if (!addTabBtn) return;

  IPC.on('sidebar-collapse', () => {
    console.log('[标签栏] 收到收起动画事件');
    addTabBtn.classList.add('collapsing');
    addTabBtn.classList.remove('expanding');
    setTimeout(() => {
      addTabBtn.classList.remove('collapsing');
    }, 400);
  });

  IPC.on('sidebar-reopen-hint', () => {
    clearSidebarReopenHint();
    sidebarReopenHintTimer = setTimeout(() => {
      addTabBtn.classList.add('sidebar-reopen-hint');
      addTabBtn.title = '点击这里重新打开侧栏';
      addTabBtn.setAttribute('aria-label', '点击这里重新打开侧栏');
      // CSS 完成平滑放大、停留和缩回；结束后只清理状态类。
      sidebarReopenHintTimer = setTimeout(clearSidebarReopenHint, 1850);
    }, 420);
  });

  IPC.on('sidebar-expand', () => {
    console.log('[标签栏] 收到展开动画事件');
    addTabBtn.classList.add('expanding');
    addTabBtn.classList.remove('collapsing');
    clearSidebarReopenHint();
    setTimeout(() => {
      addTabBtn.classList.remove('expanding');
    }, 150);
  });
}
// 从主进程接收标签数据
IPC.on('update-tabs', (tabs) => {
  if (!tabsContainer) {
    tabsContainer = document.getElementById('tabs-container');
    if (!tabsContainer) return;
  }
  const nextTabIds = tabs.map((tab) => String(tab.id));
  const nextTabIdSet = new Set(nextTabIds);

  for (const [tabId, element] of tabElementById.entries()) {
    if (!nextTabIdSet.has(tabId)) {
      try { element.remove(); } catch (_) {}
      tabElementById.delete(tabId);
    }
  }

  const fragment = document.createDocumentFragment();
  tabs.forEach((tab) => {
    const tabId = String(tab.id);
    let tabElement = tabElementById.get(tabId);
    if (!tabElement) {
      tabElement = createTabElement(tab);
      tabElementById.set(tabId, tabElement);
    } else {
      syncTabElement(tabElement, tab);
    }
    fragment.appendChild(tabElement);
  });

  if (newBrowserWindowBtn) fragment.appendChild(newBrowserWindowBtn);

  tabsContainer.replaceChildren(fragment);

  if (pendingRenameTabId) {
    const pendingTabElement = tabElementById.get(String(pendingRenameTabId));
    if (pendingTabElement) {
      beginTabRename(pendingTabElement, { commitOnBlur: false });
      pendingRenameTabId = null;
    }
  }

  applyAdaptiveTabSizing();
  console.log(`标签页已更新: 总数=${tabs.length}, 自适应宽度已应用`);
});

window.addEventListener('click', hideTabContextMenu);
window.addEventListener('blur', hideTabContextMenu);
window.addEventListener('resize', () => {
  hideTabContextMenu();
  applyAdaptiveTabSizing();
});
window.addEventListener('scroll', hideTabContextMenu, true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTabContextMenu();
});

// 事件绑定统一通过 bindAddTabBtnOnce，并带幂等保护，避免重复绑定导致抖动
