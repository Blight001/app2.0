// 个人中心账号资料卡、登录弹窗与会话切换。

let sidebarAccountAuthMode = 'login';
let sidebarAuthPreviousFocus = null;

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
  const confirmGroup = safeGetEl('sidebar-auth-confirm-group');
  if (confirmGroup) confirmGroup.hidden = !registering;

  const password = safeGetEl('sidebar-auth-password');
  if (password) password.autocomplete = registering ? 'new-password' : 'current-password';
  const submit = safeGetEl('sidebar-auth-submit');
  if (submit) {
    submit.textContent = registering ? '注册并登录' : '登录';
    submit.dataset.loadingText = registering ? '注册中...' : '登录中...';
  }
  setSidebarAuthStatus('');
}

function openSidebarAccountAuth(mode = 'login') {
  const modal = safeGetEl('sidebar-account-auth');
  if (!modal) return;
  sidebarAuthPreviousFocus = document.activeElement;
  setSidebarAuthMode(mode);
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('account-auth-open');
  setTimeout(() => safeGetEl('sidebar-auth-username')?.focus(), 0);
}

function closeSidebarAccountAuth() {
  const modal = safeGetEl('sidebar-account-auth');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('account-auth-open');
  const password = safeGetEl('sidebar-auth-password');
  const confirmation = safeGetEl('sidebar-auth-password-confirm');
  if (password) password.value = '';
  if (confirmation) confirmation.value = '';
  setSidebarAuthStatus('');
  sidebarAuthPreviousFocus?.focus?.();
  sidebarAuthPreviousFocus = null;
}

function closeAccountProfileMenu() {
  const menu = safeGetEl('account-profile-menu');
  const avatar = safeGetEl('account-profile-avatar');
  if (menu) menu.hidden = true;
  if (avatar) avatar.setAttribute('aria-expanded', 'false');
}

function toggleAccountProfileMenu(event) {
  event?.stopPropagation?.();
  const profile = safeGetEl('sidebar-account-session');
  const menu = safeGetEl('account-profile-menu');
  const avatar = safeGetEl('account-profile-avatar');
  if (profile?.dataset.authenticated !== 'true' || !menu || !avatar) return;
  const opening = menu.hidden;
  menu.hidden = !opening;
  avatar.setAttribute('aria-expanded', opening ? 'true' : 'false');
}

function renderSidebarAccountSession(session = {}) {
  const authenticated = session.authenticated === true;
  const profile = safeGetEl('sidebar-account-session');
  const usernameDisplay = safeGetEl('account-username-display');
  const usernameInput = safeGetEl('sidebar-auth-username');
  const profileName = safeGetEl('account-profile-name');
  const loginButton = safeGetEl('account-login-open-btn');
  const registerButton = safeGetEl('account-register-open-btn');
  const giftInput = safeGetEl('ai-chat-gift-code');
  const giftButton = safeGetEl('ai-chat-redeem-gift');
  const username = authenticated ? String(session.username || '').trim() : '';

  if (profile) profile.dataset.authenticated = authenticated ? 'true' : 'false';
  if (usernameDisplay) usernameDisplay.value = username;
  if (usernameInput && username) usernameInput.value = username;
  if (profileName) profileName.textContent = username || '未登录';
  if (loginButton) loginButton.hidden = authenticated;
  if (registerButton) registerButton.hidden = authenticated;
  closeAccountProfileMenu();
  if (giftInput) {
    giftInput.disabled = !authenticated;
    giftInput.placeholder = authenticated ? '输入兑换码' : '登录后输入兑换码';
    if (!authenticated) giftInput.value = '';
  }
  if (giftButton) giftButton.disabled = !authenticated;

  const expireEl = safeGetEl('expire-time');
  const usageEl = safeGetEl('usage-times');
  if (expireEl) {
    expireEl.textContent = authenticated ? '同步中' : '登录后显示';
    expireEl.style.color = '';
  }
  if (usageEl) {
    usageEl.textContent = authenticated ? '同步中' : '登录后显示';
    usageEl.style.color = '';
  }

  if (authenticated) {
    const account = session.account && typeof session.account === 'object' ? session.account : {};
    const validation = session.validation && typeof session.validation === 'object' ? session.validation : {};
    if (typeof displayExpirationInfo === 'function') {
      displayExpirationInfo({ ...account, ...validation });
    }
    closeSidebarAccountAuth();
  }
}

async function submitSidebarAccountAuth() {
  const submit = safeGetEl('sidebar-auth-submit');
  if (!submit || submit.dataset.busy === '1') return;

  const username = String(safeGetEl('sidebar-auth-username')?.value || '').trim();
  const password = String(safeGetEl('sidebar-auth-password')?.value || '');
  const passwordConfirm = String(safeGetEl('sidebar-auth-password-confirm')?.value || '');
  const registering = sidebarAccountAuthMode === 'register';

  if (!username) return setSidebarAuthStatus('请输入用户名', 'error');
  if (password.length < 6) return setSidebarAuthStatus('密码至少需要 6 位', 'error');
  if (registering && password !== passwordConfirm) return setSidebarAuthStatus('两次输入的密码不一致', 'error');

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
    });
    if (!response?.ok) throw new Error(response?.message || '账号操作失败，请稍后重试');

    renderSidebarAccountSession({
      authenticated: true,
      username,
      platformName: response.platformName || '',
      account: response.account || {},
      validation: response.validation || {},
    });
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
  } catch (error) {
    window.MessageModal?.showErrorMessage?.('退出账号失败: ' + (error?.message || String(error)));
  } finally {
    button.dataset.busy = '0';
    button.disabled = false;
    button.textContent = originalText;
  }
}

function bindSidebarAccountAuth() {
  const modal = safeGetEl('sidebar-account-auth');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';

  document.querySelectorAll('.sidebar-auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => setSidebarAuthMode(tab.dataset.authMode));
  });
  document.querySelectorAll('[data-auth-close]').forEach((element) => {
    element.addEventListener('click', closeSidebarAccountAuth);
  });
  safeGetEl('account-profile-avatar')?.addEventListener('click', toggleAccountProfileMenu);
  safeGetEl('account-profile-menu')?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeAccountProfileMenu);
  safeGetEl('account-login-open-btn')?.addEventListener('click', () => openSidebarAccountAuth('login'));
  safeGetEl('account-register-open-btn')?.addEventListener('click', () => openSidebarAccountAuth('register'));
  safeGetEl('sidebar-auth-submit')?.addEventListener('click', submitSidebarAccountAuth);
  safeGetEl('account-logout-btn')?.addEventListener('click', logoutSidebarAccount);
  ['sidebar-auth-username', 'sidebar-auth-password', 'sidebar-auth-password-confirm'].forEach((id) => {
    safeGetEl(id)?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submitSidebarAccountAuth();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeSidebarAccountAuth();
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
