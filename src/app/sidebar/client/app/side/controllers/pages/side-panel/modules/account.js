let selectedAccountIds = new Set();
let openAccountIds = new Set();
let currentAccountId = null;
let accountContextMenuEl = null;
let currentContextMenuAccountId = null;
let accountTargetUrl = '';
let accountListRenderTimer = null;
let accountPanelHideTimer = null;

// 格式化/规范化：normalizeAccountId的具体业务逻辑。
function normalizeAccountId(accountId) {
  return String(accountId || '').trim();
}

// 设置/更新/持久化：setOpenedAccountIds的具体业务逻辑。
function setOpenedAccountIds(nextOpenAccountIds) {
  if (!nextOpenAccountIds) return;
  const rawIds = nextOpenAccountIds instanceof Set
    ? Array.from(nextOpenAccountIds)
    : Array.isArray(nextOpenAccountIds)
      ? nextOpenAccountIds
      : [nextOpenAccountIds];
  openAccountIds = new Set(rawIds.map((id) => normalizeAccountId(id)).filter(Boolean));
}

// 移除/删除：removeOpenedAccountId的具体业务逻辑。
function removeOpenedAccountId(accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) return;
  if (openAccountIds.has(normalizedAccountId)) {
    openAccountIds.delete(normalizedAccountId);
    refreshAccountItemStates();
  }
  if (currentAccountId === normalizedAccountId) {
    currentAccountId = null;
    refreshAccountItemStates();
  }
}

// 设置/更新/持久化：setCurrentAccountId的具体业务逻辑。
function setCurrentAccountId(nextCurrentAccountId) {
  const normalizedCurrentId = normalizeAccountId(nextCurrentAccountId);
  currentAccountId = normalizedCurrentId || null;
}

// 设置/更新/持久化：applyAccountState的具体业务逻辑。
function applyAccountState({ openAccountIds: nextOpenAccountIds, currentAccountId: nextCurrentAccountId } = {}) {
  if (Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'openAccountIds')) {
    setOpenedAccountIds(nextOpenAccountIds);
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'currentAccountId')) {
    setCurrentAccountId(nextCurrentAccountId);
  }
  refreshAccountItemStates();
}

// 处理：scheduleAccountListRender的具体业务逻辑。
function scheduleAccountListRender(delayMs = 80) {
  if (accountListRenderTimer) {
    clearTimeout(accountListRenderTimer);
  }
  accountListRenderTimer = setTimeout(() => {
    accountListRenderTimer = null;
    if (Array.isArray(lastAccountListSnapshot)) {
      renderAccountList(lastAccountListSnapshot);
    } else {
      refreshAccountItemStates();
    }
  }, delayMs);
}

// 渲染/刷新：refreshTabsStateFromBackend的具体业务逻辑。
async function refreshTabsStateFromBackend() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return false;
  }

  try {
    const result = await window.electronAPI.invoke('get-tabs-state');
    if (result && result.ok && Array.isArray(result.tabs)) {
      syncOpenStateWithTabs(result.tabs);
      scheduleAccountListRender(0);
      return true;
    }
  } catch (error) {
    console.warn('刷新账号状态失败:', error?.message || error);
  }

  return false;
}

// 获取/读取/解析：loadAccountList的具体业务逻辑。
async function loadAccountList() {
  try {
    const result = await window.electronAPI.invoke('get-all-accounts');
    if (result && result.ok && result.accounts) {
      lastAccountListSnapshot = Array.isArray(result.accounts) ? result.accounts.slice() : [];
      scheduleAccountListRender(60);
    } else {
      lastAccountListSnapshot = [];
      scheduleAccountListRender(0);
    }
  } catch (e) {
    console.error('加载账号列表失败:', e);
    lastAccountListSnapshot = [];
    scheduleAccountListRender(0);
  }
}

// 格式化/规范化：normalizeCardKey的具体业务逻辑。
function normalizeCardKey(key) {
  return String(key || '').trim();
}

// 处理：maskCardKey的具体业务逻辑。
function maskCardKey(key) {
  const normalized = normalizeCardKey(key);
  if (!normalized) return '未绑定卡密';
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 4)}****${normalized.slice(-4)}`;
}

// 获取/读取/解析：resolveAccountExpiryTimestamp的具体业务逻辑。
function resolveAccountExpiryTimestamp(account) {
  const raw = account?.serverRecycleTimeTs ?? account?.serverRecycleTimeIso ?? account?.serverRecycleTime ?? '';
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }

  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    return text.length >= 13 ? num : num * 1000;
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

// 格式化/规范化：formatAccountExpiryDiff的具体业务逻辑。
function formatAccountExpiryDiff(account) {
  const expiryTs = resolveAccountExpiryTimestamp(account);
  if (!expiryTs) return '未知';

  const diffSeconds = Math.round((expiryTs - Date.now()) / 1000);
  if (diffSeconds <= 0) return '已过期';
  return formatRemainingValidity(diffSeconds) || '未知';
}

// 获取/读取/解析：getAccountTypeLabel的具体业务逻辑。
function getAccountTypeLabel(account) {
  return account.currentAccountTypeLabel
    || (account.currentAccountType === 'shared'
      ? '循环账号'
      : account.currentAccountType === 'one_time'
        ? '绑定账号'
        : account.currentAccountType === 'disposable'
          ? '次抛账号'
          : '');
}

// 获取/读取/解析：getAccountPlatformLabel的具体业务逻辑。
function getAccountPlatformLabel(account) {
  return String(
    account?.platform
    || account?.platformName
    || ''
  ).trim() || '未知平台';
}

// 获取/读取/解析：getAccountRecordLabel的具体业务逻辑。
function getAccountRecordLabel(account) {
  const platformLabel = getAccountPlatformLabel(account);
  const accountLabel = String(
    account?.accountName
    || account?.displayName
    || account?.id
    || ''
  ).trim();
  if (!accountLabel) return platformLabel || '账号记录';
  if (!platformLabel || platformLabel === '未知平台') return accountLabel;
  return `${platformLabel}-${accountLabel}`;
}

// 获取/读取/解析：getAccountRecordLabelById的具体业务逻辑。
function getAccountRecordLabelById(accountId) {
  const targetId = String(accountId || '').trim();
  if (!targetId) return '账号记录';
  const source = Array.isArray(lastAccountListSnapshot)
    ? lastAccountListSnapshot.find((account) => String(account?.id || '') === targetId)
    : null;
  return getAccountRecordLabel(source);
}

// 格式化/规范化：formatAccountLastUsedText的具体业务逻辑。
function formatAccountLastUsedText(account) {
  const raw = String(account?.lastUsedAt || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';

// 处理：pad的具体业务逻辑。
  const pad = (value) => String(value).padStart(2, '0');
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `最后使用: ${text}`;
}

// 获取/读取/解析：getVisibleAccounts的具体业务逻辑。
function getVisibleAccounts(accounts) {
  return Array.isArray(accounts) ? accounts : [];
}

// 获取/读取/解析：getSelectedAccountIds的具体业务逻辑。
function getSelectedAccountIds(visibleAccounts) {
  const visibleIdSet = new Set((visibleAccounts || []).map((account) => String(account.id || '')));
  return Array.from(selectedAccountIds).filter((id) => visibleIdSet.has(id));
}

// 同步/连接：syncSelectionWithVisibleAccounts的具体业务逻辑。
function syncSelectionWithVisibleAccounts(visibleAccounts) {
  const visibleIdSet = new Set((visibleAccounts || []).map((account) => String(account.id || '')));
  selectedAccountIds = new Set(Array.from(selectedAccountIds).filter((id) => visibleIdSet.has(id)));
}

// 处理：isEditableTarget的具体业务逻辑。
function isEditableTarget(target) {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

// 获取/读取：getAccountPanelEl的具体业务逻辑。
function getAccountPanelEl() {
  return safeGetEl('account-panel');
}

// 获取/读取：getAccountDropdownToggleBtn的具体业务逻辑。
function getAccountDropdownToggleBtn() {
  return safeGetEl('account-history-toggle-btn');
}

// 设置/更新：setAccountPanelOpen的具体业务逻辑。
function setAccountPanelOpen(nextOpen) {
  const panel = getAccountPanelEl();
  const toggleBtn = getAccountDropdownToggleBtn();
  if (!panel || !toggleBtn) return false;

  const isOpen = !!nextOpen;
  if (isOpen) {
    if (accountPanelHideTimer) {
      clearTimeout(accountPanelHideTimer);
      accountPanelHideTimer = null;
    }
    panel.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
    });
    toggleBtn.setAttribute('aria-expanded', 'true');
  } else {
    toggleBtn.setAttribute('aria-expanded', 'false');
    panel.classList.remove('is-open');
    hideAccountContextMenu();
    accountPanelHideTimer = setTimeout(() => {
      if (panel && !panel.classList.contains('is-open')) {
        panel.hidden = true;
      }
    }, 220);
  }

  return isOpen;
}

// 切换/更新：toggleAccountPanel的具体业务逻辑。
function toggleAccountPanel(forceOpen) {
  const panel = getAccountPanelEl();
  if (!panel) return false;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.hidden;
  return setAccountPanelOpen(nextOpen);
}

// 处理：isAccountPanelActive的具体业务逻辑。
function isAccountPanelActive() {
  const panel = getAccountPanelEl();
  return !!panel && !panel.hidden && panel.classList.contains('is-open');
}

// 处理：selectAllVisibleAccounts的具体业务逻辑。
function selectAllVisibleAccounts() {
  const visibleAccounts = getVisibleAccounts(lastAccountListSnapshot);
  const nextSelectedIds = visibleAccounts
    .map((account) => String(account?.id || '').trim())
    .filter(Boolean);

  selectedAccountIds = new Set(nextSelectedIds);
  refreshAccountItemStates();
  return nextSelectedIds.length;
}

// 同步/连接：syncOpenStateWithTabs的具体业务逻辑。
function syncOpenStateWithTabs(tabs) {
  const nextOpenAccountIds = new Set();
  let nextCurrentAccountId = null;

  (Array.isArray(tabs) ? tabs : []).forEach((tab) => {
    const accountId = String(tab?.accountId || '').trim();
    if (!accountId) return;
    nextOpenAccountIds.add(accountId);
    if (tab?.isActive) {
      nextCurrentAccountId = accountId;
    }
  });

  applyAccountState({
    openAccountIds: nextOpenAccountIds,
    currentAccountId: nextCurrentAccountId,
  });
}

// 渲染/刷新：refreshAccountItemStates的具体业务逻辑。
function refreshAccountItemStates() {
  const accountList = safeGetEl('account-list');
  if (!accountList) return;

  const items = accountList.querySelectorAll('.account-item');
  items.forEach((item) => {
    const accountId = String(item.dataset.accountId || '');
    item.classList.toggle('selected', selectedAccountIds.has(accountId));
    item.classList.toggle('opened', openAccountIds.has(accountId));
    item.classList.toggle('active', currentAccountId === accountId);
  });
}

// 渲染/刷新：refreshAccountTargetUrl的具体业务逻辑。
async function refreshAccountTargetUrl() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    accountTargetUrl = '';
    return accountTargetUrl;
  }

  try {
    const targetUrl = await window.electronAPI.invoke('get-target-url');
    accountTargetUrl = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  } catch (_) {
    accountTargetUrl = '';
  }

  return accountTargetUrl;
}

// 启动/打开/显示：openAccountPlatformUrl的具体业务逻辑。
async function openAccountPlatformUrl() {
  const targetUrl = accountTargetUrl || await refreshAccountTargetUrl();
  if (!targetUrl) return;
  if (window.electronAPI && typeof window.electronAPI.send === 'function') {
    window.electronAPI.send('open-tutorial', targetUrl);
  }
}

// 移除/删除：deleteAccounts的具体业务逻辑。
async function deleteAccounts(accountIds) {
  const ids = Array.from(new Set((accountIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return;

  const confirmText = ids.length === 1
    ? `确认删除当前账号记录：${getAccountRecordLabelById(ids[0])}？`
    : `确认删除选中的 ${ids.length} 条账号记录？`;
  const confirmed = await new Promise((resolve) => {
    if (window.MessageModal && typeof window.MessageModal.showConfirmDialog === 'function') {
      window.MessageModal.showConfirmDialog(
        confirmText,
        () => resolve(true),
        () => resolve(false),
        'warning'
      );
      return;
    }

    resolve(false);
  });

  if (!confirmed) return;

  const result = await window.electronAPI.invoke('delete-accounts', { accountIds: ids });
  if (!result || result.ok !== true) {
    throw new Error((result && (result.error || result.message)) || '删除账号失败');
  }

  ids.forEach((id) => selectedAccountIds.delete(id));
  if (ids.includes(String(currentAccountId || ''))) {
    currentAccountId = null;
  }

  if (window.MessageModal && typeof window.MessageModal.showSuccessMessage === 'function') {
    window.MessageModal.showSuccessMessage(result.message || '账号删除成功');
  }

  await loadAccountList();
}

// 停止/关闭/清理：hideAccountContextMenu的具体业务逻辑。
function hideAccountContextMenu() {
  if (accountContextMenuEl) {
    accountContextMenuEl.classList.remove('visible');
  }
  currentContextMenuAccountId = null;
}

// 校验/保护：ensureAccountContextMenu的具体业务逻辑。
function ensureAccountContextMenu() {
  if (accountContextMenuEl) return accountContextMenuEl;

  const menu = document.createElement('div');
  menu.className = 'account-context-menu';
  menu.innerHTML = `
    <div class="account-context-menu-hint" data-role="hint">将删除当前账号记录</div>
    <button type="button" class="account-context-menu-item" data-action="delete-selection">删除账号</button>
  `;

  menu.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  menu.addEventListener('click', async (e) => {
    const item = e.target && e.target.closest ? e.target.closest('.account-context-menu-item') : null;
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();

    const action = item.dataset.action;
    const targetId = currentContextMenuAccountId;
    hideAccountContextMenu();

    try {
      if (action === 'delete-selection') {
        const ids = getSelectedAccountIds(getVisibleAccounts(lastAccountListSnapshot));
        if (!ids.length) {
          if (!targetId) throw new Error('请先选择要删除的账号');
          await deleteAccounts([targetId]);
          return;
        }
        await deleteAccounts(ids);
      }
    } catch (err) {
      if (window.MessageModal && typeof window.MessageModal.showErrorMessage === 'function') {
        window.MessageModal.showErrorMessage(err?.message || String(err));
      }
    }
  });

  document.body.appendChild(menu);
  accountContextMenuEl = menu;
  return menu;
}

// 处理：triggerAccountImportUnlock的具体业务逻辑。
function triggerAccountImportUnlock() {
  if (window.electronAPI && typeof window.electronAPI.send === 'function') {
    window.electronAPI.send('reveal-cookie-import');
    return true;
  }
  return false;
}

// 同步/连接：bindCookieImportConfirmListener的具体业务逻辑。
function bindCookieImportConfirmListener() {
  if (!window.electronAPI || typeof window.electronAPI.on !== 'function') {
    return;
  }

  if (window.__cookieImportConfirmListenerBound) {
    return;
  }
  window.__cookieImportConfirmListenerBound = true;

  window.electronAPI.on('cookie-import-confirm-request', (payload = {}) => {
    const requestId = String(payload.requestId || '').trim();
    const platformLabel = String(payload.platformLabel || '未知平台').trim() || '未知平台';
    const targetUrl = String(payload.targetUrl || '').trim();
    const message = `导入的账号是否属于当前平台「${platformLabel}」？`;
    const detail = [
      `当前服务器平台：${platformLabel}`,
      targetUrl ? `当前链接：${targetUrl}` : '当前链接：未提供',
      '',
      '确认后会保存平台名称和链接。',
      '取消则中止导入，不保存平台名称和链接。',
    ].join('\n');

// 处理：sendResponse的具体业务逻辑。
    const sendResponse = (confirmed) => {
      if (!requestId) return;
      if (window.electronAPI && typeof window.electronAPI.send === 'function') {
        window.electronAPI.send('cookie-import-confirm-response', {
          requestId,
          confirmed: confirmed === true,
          cancelled: confirmed === false,
          decidedUnknown: false,
        });
      }
    };

    if (!window.MessageModal || typeof window.MessageModal.showConfirmDialog !== 'function') {
      sendResponse(false);
      return;
    }

    window.MessageModal.showConfirmDialog(
      `${message}\n${detail}`,
      () => sendResponse(true),
      () => sendResponse(false),
      'info'
    );
  });
}

// 处理/分发：handleAccountRecordButtonDoubleClick的具体业务逻辑。
function handleAccountRecordButtonDoubleClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const unlocked = triggerAccountImportUnlock();
  if (unlocked) {
    console.log('[侧边栏] 已触发功能面板按钮双击，已显示导入按钮');
    return;
  }

  console.warn('[侧边栏] 当前环境不支持解锁导入按钮');
}

// 启动/打开/显示：showAccountContextMenu的具体业务逻辑。
function showAccountContextMenu(accountId, x, y) {
  const menu = ensureAccountContextMenu();
  currentContextMenuAccountId = String(accountId || '').trim() || null;

  const visibleAccounts = getVisibleAccounts(lastAccountListSnapshot);
  const selectedIds = getSelectedAccountIds(visibleAccounts);
  const deleteBtn = menu.querySelector('[data-action="delete-selection"]');
  const hintEl = menu.querySelector('[data-role="hint"]');
  if (deleteBtn) {
    const effectiveCount = selectedIds.length || (currentContextMenuAccountId ? 1 : 0);
    deleteBtn.disabled = effectiveCount === 0;
    deleteBtn.textContent = effectiveCount > 1 ? `删除选中账号 (${effectiveCount})` : '删除当前账号';
    deleteBtn.title = effectiveCount > 1 ? `删除选中的 ${effectiveCount} 条账号记录` : '删除当前账号记录';
  }
  if (hintEl) {
    if (selectedIds.length > 1) {
      hintEl.textContent = `将删除选中的 ${selectedIds.length} 条账号记录`;
    } else if (currentContextMenuAccountId) {
      hintEl.textContent = `将删除当前账号记录：${getAccountRecordLabelById(currentContextMenuAccountId)}`;
    } else {
      hintEl.textContent = '将删除当前账号记录';
    }
  }

  menu.style.visibility = 'hidden';
  menu.classList.add('visible');
  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(window.innerWidth - rect.width - 8, 8);
  const maxTop = Math.max(window.innerHeight - rect.height - 8, 8);
  menu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`;
  menu.style.visibility = 'visible';
}

// 创建/初始化：createAccountItem的具体业务逻辑。
function createAccountItem(account) {
  const accountId = String(account.id || '');
  const item = document.createElement('div');
  item.className = 'account-item';
  item.dataset.accountId = accountId;
  item.classList.toggle('selected', selectedAccountIds.has(accountId));
  item.classList.toggle('opened', openAccountIds.has(accountId));
  item.classList.toggle('active', currentAccountId === accountId);

  const recordLabel = getAccountRecordLabel(account);
  const accountTypeLabel = getAccountTypeLabel(account);
  const expiryText = formatAccountExpiryDiff(account);
  const lastUsedText = formatAccountLastUsedText(account);
  const metaParts = [];
  if (accountTypeLabel) metaParts.push(`类型: ${accountTypeLabel}`);

  item.innerHTML = `
    <div class="account-info">
      <div class="account-name">${escapeHtml(recordLabel)}</div>
      <div class="account-meta">${escapeHtml(metaParts.join(' · '))}</div>
      ${lastUsedText ? `<div class="account-meta account-meta-secondary">${escapeHtml(lastUsedText)}</div>` : ''}
      <div class="account-meta">${escapeHtml(`剩余时间: ${expiryText}`)}</div>
    </div>
    <div class="account-actions">
      <button type="button" class="btn-switch" data-account-id="${escapeHtml(accountId)}">打开</button>
    </div>
  `;

  item.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.btn-switch')) return;

    if (e.ctrlKey || e.metaKey) {
      if (selectedAccountIds.has(accountId)) {
        selectedAccountIds.delete(accountId);
      } else {
        selectedAccountIds.add(accountId);
      }
    } else {
      if (selectedAccountIds.size === 1 && selectedAccountIds.has(accountId)) {
        selectedAccountIds.clear();
      } else {
        selectedAccountIds = new Set([accountId]);
      }
    }
    refreshAccountItemStates();
  });

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!selectedAccountIds.has(accountId)) {
      selectedAccountIds = new Set([accountId]);
      refreshAccountItemStates();
    }
    showAccountContextMenu(accountId, e.clientX, e.clientY);
  });

  const switchBtn = item.querySelector('.btn-switch');
  if (switchBtn) {
    switchBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetAccountId = e.target.dataset.accountId;
      if (!targetAccountId) return;

      switchBtn.disabled = true;
      switchBtn.textContent = '打开中...';

      try {
        const result = await window.electronAPI.invoke('switch-account', { accountId: targetAccountId });
        if (result && result.ok) {
          await loadAccountList();
        } else {
          throw new Error(result?.error || '打开失败');
        }
      } catch (err) {
        if (window.MessageModal && window.MessageModal.showErrorMessage) {
          window.MessageModal.showErrorMessage('打开账号失败: ' + (err?.message || String(err)));
        }
      } finally {
        switchBtn.disabled = false;
        switchBtn.textContent = '打开';
      }
    });
  }

  return item;
}

// 渲染/刷新：renderAccountList的具体业务逻辑。
function renderAccountList(accounts) {
  lastAccountListSnapshot = Array.isArray(accounts) ? accounts.slice() : [];
  const accountList = safeGetEl('account-list');
  const accountEmpty = safeGetEl('account-empty');
  if (!accountList) return;

  const visibleAccounts = getVisibleAccounts(accounts);
  syncSelectionWithVisibleAccounts(visibleAccounts);

  accountList.innerHTML = '';

  if (visibleAccounts.length === 0) {
    if (accountEmpty) {
      accountEmpty.style.display = 'block';
      accountList.appendChild(accountEmpty);
    }
    return;
  }

  if (accountEmpty) {
    accountEmpty.style.display = 'none';
  }

  const fragment = document.createDocumentFragment();
  const platformGroups = new Map();
  visibleAccounts.forEach((account) => {
    const platform = getAccountPlatformLabel(account);
    if (!platformGroups.has(platform)) platformGroups.set(platform, []);
    platformGroups.get(platform).push(account);
  });
  platformGroups.forEach((platformAccounts, platform) => {
    const heading = document.createElement('div');
    heading.className = 'account-platform-heading';
    heading.textContent = `${platform}（${platformAccounts.length}）`;
    fragment.appendChild(heading);
    platformAccounts.forEach((account) => {
      fragment.appendChild(createAccountItem(account));
    });
  });
  accountList.appendChild(fragment);
}

// 设置/更新/持久化：setCookieImportSectionVisible的具体业务逻辑。
function setCookieImportSectionVisible(visible) {
  const section = safeGetEl('cookie-import-section');
  if (!section) return;
  section.hidden = !visible;
  section.classList.toggle('visible', !!visible);
}

// 同步/连接：bindCookieImportButton的具体业务逻辑。
function bindCookieImportButton() {
  const btn = safeGetEl('cookie-import-btn');
  if (!btn || btn.dataset.bound === '1') return;

  btn.addEventListener('click', async () => {
    withBusyButton(btn, [], async () => {
      if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
        throw new Error('当前环境不支持导入账号');
      }
      const resp = await window.electronAPI.invoke('import-cookie-file');
      if (!resp || resp.ok !== true) {
        if (resp && resp.cancelled) return;
        throw new Error((resp && (resp.error || resp.message)) || '账号导入失败');
      }
      await loadAccountList();
      if (window.MessageModal && typeof window.MessageModal.showSuccessMessage === 'function') {
        window.MessageModal.showSuccessMessage(resp.message || '账号导入成功');
      }
    });
  });

  btn.dataset.bound = '1';
}

// 同步/连接：bindAccountPanel的具体业务逻辑。
function bindAccountPanel() {
  loadAccountList();
  bindCookieImportButton();
  bindCookieImportConfirmListener();
  void refreshAccountTargetUrl().then(() => {
    if (Array.isArray(lastAccountListSnapshot) && lastAccountListSnapshot.length > 0) {
      scheduleAccountListRender(40);
    }
  });
  if (cookieImportUnlocked) {
    setCookieImportSectionVisible(true);
  }

  const accountToggleBtn = getAccountDropdownToggleBtn();
  if (accountToggleBtn && accountToggleBtn.dataset.bound !== '1') {
    accountToggleBtn.addEventListener('click', () => {
      if (accountToggleBtn.getAttribute('aria-disabled') === 'true') {
        return;
      }
      const isOpen = toggleAccountPanel();
      if (isOpen) {
        void loadAccountList();
      }
    });
    accountToggleBtn.dataset.bound = '1';
  }

  const mainPanelTabBtn = document.querySelector('[data-tab="personal-center-panel"]');
  if (mainPanelTabBtn && mainPanelTabBtn.dataset.accountUnlockBound !== '1') {
    mainPanelTabBtn.addEventListener('dblclick', handleAccountRecordButtonDoubleClick);
    mainPanelTabBtn.dataset.accountUnlockBound = '1';
  }

  if (!window.__accountHistoryPanelOpenBound) {
    window.__accountHistoryPanelOpenBound = true;
    window.addEventListener('account-history-panel-open-request', () => {
      // 历史账号按钮已移至“浏览器配置”面板的羊毛资源栏目
      const settingsTab = document.querySelector('[data-tab="ai-free-settings-panel"]');
      if (settingsTab && !settingsTab.classList.contains('active')) {
        settingsTab.click();
      }
      const wasOpened = setAccountPanelOpen(true);
      if (wasOpened) {
        void loadAccountList();
      }
    });
  }

  document.addEventListener('click', (event) => {
    hideAccountContextMenu();

    const panel = getAccountPanelEl();
    const toggleBtn = getAccountDropdownToggleBtn();
    if (!panel || !toggleBtn || !isAccountPanelActive()) return;
    const target = event.target;
    if (panel.contains(target) || toggleBtn.contains(target)) return;

    setAccountPanelOpen(false);
  });
  window.addEventListener('blur', hideAccountContextMenu);
  window.addEventListener('scroll', (event) => {
    hideAccountContextMenu();

    const panel = getAccountPanelEl();
    const target = event.target instanceof Element ? event.target : null;
    if (panel && target && panel.contains(target)) {
      return;
    }

    if (isAccountPanelActive()) {
      setAccountPanelOpen(false);
    }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideAccountContextMenu();
      if (isAccountPanelActive()) {
        setAccountPanelOpen(false);
      }
    }
// 处理：isSelectAll的具体业务逻辑。
    const isSelectAll = (e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && !e.altKey;
    if (!isSelectAll) return;
    if (!isAccountPanelActive() || isEditableTarget(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    selectAllVisibleAccounts();
  });

  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('account-list-updated', () => {
      loadAccountList();
      void refreshTabsStateFromBackend();
    });

    window.electronAPI.on('update-tabs', (tabs = []) => {
      syncOpenStateWithTabs(tabs);
      scheduleAccountListRender(40);
    });

    window.electronAPI.on('tab-closed', (data = {}) => {
      removeOpenedAccountId(data && data.accountId);
      scheduleAccountListRender(0);
    });

    window.electronAPI.on('platform-name-updated', () => {
      scheduleAccountListRender(40);
    });

    window.electronAPI.on('target-url-updated', (data) => {
      accountTargetUrl = String(data && data.targetUrl ? data.targetUrl : '').trim();
      scheduleAccountListRender(40);
    });

    window.electronAPI.on('cookie-import-unlock', () => {
      cookieImportUnlocked = true;
      setCookieImportSectionVisible(true);
      bindCookieImportButton();
    });
  }
}
