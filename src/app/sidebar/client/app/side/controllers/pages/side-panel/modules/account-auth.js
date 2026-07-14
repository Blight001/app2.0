// 侧边栏账号登录、注册与会话切换。

let sidebarAccountAuthMode = 'login';
let sidebarAccountPlatformsLoaded = false;

function invokeSidebarAccountAuth(payload, timeoutMs = 20000) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('登录请求超时，请检查服务器或重启软件后重试')), timeoutMs);
  });
  return Promise.race([
    window.electronAPI.invoke('account-authenticate', payload),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function setSidebarAuthStatus(message = '', type = '') {
  const status = safeGetEl('sidebar-auth-status');
  if (!status) return;
  status.textContent = String(message || '');
  status.dataset.type = type;
}

function setSidebarAuthMode(mode) {
  sidebarAccountAuthMode = mode === 'register' ? 'register' : 'login';
  document.querySelectorAll('.sidebar-auth-tab').forEach((tab) => {
    const active = tab.dataset.authMode === sidebarAccountAuthMode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const registering = sidebarAccountAuthMode === 'register';
  const title = safeGetEl('sidebar-account-auth-title');
  if (title) title.textContent = registering ? '注册账号' : '登录账号';
  const platformGroup = safeGetEl('sidebar-auth-platform-group');
  const platformLabel = safeGetEl('sidebar-auth-platform-label');
  const confirmGroup = safeGetEl('sidebar-auth-confirm-group');
  if (platformGroup) platformGroup.hidden = false;
  if (platformLabel) platformLabel.textContent = registering ? '注册平台' : '登录平台（可自动查找）';
  if (confirmGroup) confirmGroup.hidden = !registering;

  const password = safeGetEl('sidebar-auth-password');
  if (password) password.autocomplete = registering ? 'new-password' : 'current-password';
  const submit = safeGetEl('sidebar-auth-submit');
  if (submit) {
    submit.textContent = registering ? '注册并登录' : '登录';
    submit.dataset.loadingText = registering ? '注册中...' : '登录中...';
  }
  setSidebarAuthStatus('');

  void loadSidebarAccountPlatforms();
}

function renderSidebarAccountSession(session = {}) {
  const authenticated = session.authenticated === true;
  const authPanel = safeGetEl('sidebar-account-auth');
  const sessionPanel = safeGetEl('sidebar-account-session');
  const usernameDisplay = safeGetEl('account-username-display');
  const usernameInput = safeGetEl('sidebar-auth-username');

  if (authPanel) authPanel.hidden = authenticated;
  if (sessionPanel) sessionPanel.hidden = !authenticated;
  if (usernameDisplay) usernameDisplay.value = authenticated ? String(session.username || '') : '';
  if (usernameInput && session.username) usernameInput.value = String(session.username);
}

async function loadSidebarAccountPlatforms() {
  const select = safeGetEl('sidebar-auth-platform');
  if (!select || !window.electronAPI?.invoke) return;

  select.disabled = true;
  try {
    const response = await window.electronAPI.invoke('account-get-platforms');
    const platforms = Array.isArray(response?.platforms) ? response.platforms : [];
    select.replaceChildren();
    if (platforms.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = response?.message || '暂无可用平台';
      select.appendChild(option);
      sidebarAccountPlatformsLoaded = false;
      return;
    }

    if (sidebarAccountAuthMode === 'login') {
      const automaticOption = document.createElement('option');
      automaticOption.value = '';
      automaticOption.textContent = '自动查找账号所在平台';
      select.appendChild(automaticOption);
    }

    for (const item of platforms) {
      const option = document.createElement('option');
      option.value = String(item.tenant_id || item.id || '');
      option.textContent = String(item.platform_name || item.name || item.id || '');
      select.appendChild(option);
    }
    sidebarAccountPlatformsLoaded = true;
  } catch (error) {
    select.replaceChildren();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '平台加载失败';
    select.appendChild(option);
    sidebarAccountPlatformsLoaded = false;
  } finally {
    select.disabled = false;
  }
}

async function submitSidebarAccountAuth() {
  const submit = safeGetEl('sidebar-auth-submit');
  if (!submit || submit.dataset.busy === '1') return;

  const username = String(safeGetEl('sidebar-auth-username')?.value || '').trim();
  const password = String(safeGetEl('sidebar-auth-password')?.value || '');
  const passwordConfirm = String(safeGetEl('sidebar-auth-password-confirm')?.value || '');
  const tenantId = String(safeGetEl('sidebar-auth-platform')?.value || '').trim();
  const registering = sidebarAccountAuthMode === 'register';

  if (!username) return setSidebarAuthStatus('请输入用户名', 'error');
  if (password.length < 6) return setSidebarAuthStatus('密码至少需要 6 位', 'error');
  if (registering && password !== passwordConfirm) return setSidebarAuthStatus('两次输入的密码不一致', 'error');
  if (registering && !tenantId) return setSidebarAuthStatus('请选择注册平台', 'error');

  const originalText = submit.textContent;
  submit.dataset.busy = '1';
  submit.disabled = true;
  submit.textContent = submit.dataset.loadingText || '处理中...';
  setSidebarAuthStatus(registering ? '正在创建账号...' : '正在登录...');

  try {
    const response = await invokeSidebarAccountAuth({
      mode: sidebarAccountAuthMode,
      username,
      password,
      tenantId,
    });
    if (!response?.ok) {
      throw new Error(response?.message || '账号操作失败，请稍后重试');
    }

    safeGetEl('sidebar-auth-password').value = '';
    safeGetEl('sidebar-auth-password-confirm').value = '';
    renderSidebarAccountSession({
      authenticated: true,
      username,
      tenantId,
      platformName: response.platformName || '',
    });
    setSidebarAuthStatus('');
  } catch (error) {
    setSidebarAuthStatus(error?.message || String(error), 'error');
  } finally {
    submit.dataset.busy = '0';
    submit.disabled = false;
    submit.textContent = originalText;
  }
}

async function logoutSidebarAccount() {
  const button = safeGetEl('account-logout-btn');
  if (!button || button.dataset.busy === '1') return;
  const originalText = button.textContent;
  button.dataset.busy = '1';
  button.disabled = true;
  button.textContent = '退出中...';

  try {
    const response = await window.electronAPI.invoke('account-logout');
    if (!response?.ok) throw new Error(response?.message || '退出失败');
    renderSidebarAccountSession({ authenticated: false });
    setSidebarAuthMode('login');
    const keyInput = safeGetEl('key-input');
    const deviceInput = safeGetEl('device-id');
    if (keyInput) keyInput.value = '';
    if (deviceInput) deviceInput.value = '';
    if (typeof resetLicenseStateToValidate === 'function') resetLicenseStateToValidate();
    if (typeof applyFeatureAvailability === 'function') applyFeatureAvailability();
    safeGetEl('sidebar-auth-username')?.focus();
  } catch (error) {
    window.MessageModal?.showErrorMessage?.('退出账号失败: ' + (error?.message || String(error)));
  } finally {
    button.dataset.busy = '0';
    button.disabled = false;
    button.textContent = originalText;
  }
}

function bindSidebarAccountAuth() {
  const authPanel = safeGetEl('sidebar-account-auth');
  if (!authPanel || authPanel.dataset.bound === '1') return;
  authPanel.dataset.bound = '1';

  document.querySelectorAll('.sidebar-auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => setSidebarAuthMode(tab.dataset.authMode));
  });
  safeGetEl('sidebar-auth-submit')?.addEventListener('click', submitSidebarAccountAuth);
  safeGetEl('account-logout-btn')?.addEventListener('click', logoutSidebarAccount);
  ['sidebar-auth-username', 'sidebar-auth-password', 'sidebar-auth-password-confirm'].forEach((id) => {
    safeGetEl(id)?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submitSidebarAccountAuth();
    });
  });

  window.electronAPI?.on?.('account-session-updated', (session = {}) => {
    renderSidebarAccountSession(session);
  });

  setSidebarAuthMode('login');
  window.electronAPI.invoke('account-get-session').then((session) => {
    renderSidebarAccountSession(session || {});
  }).catch(() => {
    renderSidebarAccountSession({ authenticated: false });
  });
}
