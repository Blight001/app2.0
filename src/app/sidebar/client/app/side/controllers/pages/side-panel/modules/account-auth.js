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

function formatAccountUsageNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Math.max(0, number));
}

function setAccountUsageText(id, value) {
  const element = safeGetEl(id);
  if (element) element.textContent = value;
}

/** 根据剩余比例返回状态：pending | unlimited | ok | warn | critical | exhausted */
function resolveAccountUsageStatus({ hasData, unlimited, exhausted, remainingRatio }) {
  if (!hasData) return 'pending';
  if (unlimited) return 'unlimited';
  if (exhausted) return 'exhausted';
  if (!Number.isFinite(remainingRatio)) return 'ok';
  if (remainingRatio <= 0) return 'exhausted';
  if (remainingRatio <= 0.1) return 'critical';
  if (remainingRatio <= 0.25) return 'warn';
  return 'ok';
}

function setAccountUsageStatus(cardSelector, badgeId, status, label) {
  const card = document.querySelector(cardSelector);
  const badge = safeGetEl(badgeId);
  if (card) card.dataset.status = status;
  if (badge) {
    badge.dataset.status = status;
    badge.textContent = label;
  }
}

function formatAccountUsagePercent(ratio) {
  if (!Number.isFinite(ratio)) return '--';
  const percent = Math.max(0, Math.min(100, ratio * 100));
  if (percent > 0 && percent < 0.1) return '<0.1%';
  if (percent >= 99.95 && percent < 100) return '99.9%';
  return `${percent.toFixed(percent >= 10 || percent === 0 ? 0 : 1)}%`;
}

function setAccountUsageProgress(barId, percent, status) {
  const bar = safeGetEl(barId);
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  bar.style.width = `${clamped}%`;
  bar.dataset.status = status;
}

function renderAccountProxyTrafficUsage(quota) {
  const usage = quota && typeof quota === 'object' ? quota : null;
  const unlimited = Boolean(usage?.unlimited);
  const exhausted = Boolean(usage?.exhausted);
  const totalBytes = usage ? Number(usage.quota_bytes) : NaN;
  const remainingBytes = usage ? Number(usage.remaining_bytes) : NaN;
  const usedBytes = usage ? Number(usage.used_bytes) : NaN;
  const remainingRatio = unlimited
    ? 1
    : (Number.isFinite(totalBytes) && totalBytes > 0 && Number.isFinite(remainingBytes)
      ? remainingBytes / totalBytes
      : (exhausted ? 0 : NaN));
  const usedRatio = unlimited
    ? 0
    : (Number.isFinite(totalBytes) && totalBytes > 0 && Number.isFinite(usedBytes)
      ? usedBytes / totalBytes
      : (exhausted ? 1 : NaN));
  const status = resolveAccountUsageStatus({
    hasData: Boolean(usage),
    unlimited,
    exhausted,
    remainingRatio,
  });
  const statusLabel = !usage ? '待同步' : (unlimited ? '不限量' : (status === 'exhausted' ? '已用完' : status === 'critical' || status === 'warn' ? '偏低' : '可用'));

  setAccountUsageStatus('.account-traffic-usage', 'account-traffic-status', status, statusLabel);
  setAccountUsageProgress('account-traffic-progress', unlimited ? 8 : (Number.isFinite(remainingRatio) ? remainingRatio * 100 : 0), status);
  setAccountUsageText('account-traffic-percent', !usage ? '--' : (unlimited ? '—' : formatAccountUsagePercent(usedRatio)));
  setAccountUsageText('account-traffic-total', usage ? (unlimited ? '不限量' : formatProxyTrafficBytes(usage.quota_bytes)) : '--');
  setAccountUsageText('account-traffic-remaining', usage ? (unlimited ? '不限量' : formatProxyTrafficBytes(usage.remaining_bytes)) : '--');
  setAccountUsageText('account-traffic-used', usage ? formatProxyTrafficBytes(usage.used_bytes) : '--');
  setAccountUsageText('account-traffic-upload', usage ? formatProxyTrafficBytes(usage.upload_used_bytes) : '--');
  setAccountUsageText('account-traffic-download', usage ? formatProxyTrafficBytes(usage.download_used_bytes) : '--');
}

function renderAccountAiUsage(quota) {
  const normalized = window.AiFreeQuotaDisplay?.normalizeAIQuota?.(quota) || quota;
  const usage = normalized && typeof normalized === 'object' ? normalized : null;
  const unlimited = Boolean(usage?.unlimited);
  const total = usage ? Number(usage.quota) : NaN;
  const used = usage ? Number(usage.used) : NaN;
  const remaining = usage ? Number(usage.remaining ?? (total - used)) : NaN;
  const remainingRatio = unlimited
    ? 1
    : (Number.isFinite(total) && total > 0 && Number.isFinite(remaining)
      ? remaining / total
      : (Number.isFinite(remaining) && remaining <= 0 ? 0 : NaN));
  const usedRatio = unlimited
    ? 0
    : (Number.isFinite(total) && total > 0 && Number.isFinite(used)
      ? used / total
      : (Number.isFinite(remaining) && remaining <= 0 ? 1 : NaN));
  const exhausted = !unlimited && (Number.isFinite(remaining) ? remaining <= 0 : false);
  const status = resolveAccountUsageStatus({
    hasData: Boolean(usage),
    unlimited,
    exhausted,
    remainingRatio,
  });
  const statusLabel = !usage ? '待同步' : (unlimited ? '不限量' : (status === 'exhausted' ? '已用完' : status === 'critical' || status === 'warn' ? '偏低' : '可用'));

  setAccountUsageStatus('.account-ai-usage', 'account-ai-status', status, statusLabel);
  setAccountUsageProgress('account-ai-progress', unlimited ? 8 : (Number.isFinite(remainingRatio) ? remainingRatio * 100 : 0), status);
  setAccountUsageText('account-ai-percent', !usage ? '--' : (unlimited ? '—' : formatAccountUsagePercent(usedRatio)));
  setAccountUsageText('account-ai-total', usage ? (unlimited ? '不限量' : `${formatAccountUsageNumber(total)} 点`) : '--');
  setAccountUsageText('account-ai-remaining', usage ? (unlimited ? '不限量' : `${formatAccountUsageNumber(remaining)} 点`) : '--');
  setAccountUsageText('account-ai-used', usage ? `${formatAccountUsageNumber(used)} 点` : '--');
}

window.renderAccountAiUsage = renderAccountAiUsage;

function renderSidebarAccountSession(session = {}) {
  const authenticated = session.authenticated === true;
  const profile = safeGetEl('sidebar-account-session');
  const usernameDisplay = safeGetEl('account-username-display');
  const usernameInput = safeGetEl('sidebar-auth-username');
  const profileName = safeGetEl('account-profile-name');
  const loginButton = safeGetEl('account-login-open-btn');
  const registerButton = safeGetEl('account-register-open-btn');
  const giftInput = safeGetEl('unified-gift-code');
  const giftButton = safeGetEl('unified-redeem-gift');
  const usageDetails = safeGetEl('account-usage-details');
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
  if (usageDetails) usageDetails.hidden = !authenticated;

  if (!authenticated && typeof setWoolPlatformRemainingUsage === 'function') {
    setWoolPlatformRemainingUsage('');
  }

  if (!authenticated) {
    renderAccountProxyTrafficUsage(null);
    renderAccountAiUsage(null);
  }

  if (authenticated) {
    const account = session.account && typeof session.account === 'object' ? session.account : {};
    const validation = session.validation && typeof session.validation === 'object' ? session.validation : {};
    if (typeof displayExpirationInfo === 'function') {
      displayExpirationInfo({ ...account, ...validation });
    }
    closeSidebarAccountAuth();
    window.electronAPI?.invoke?.('get-proxy-traffic-quota').then((result) => {
      if (result?.ok && result.quota && typeof renderProxyTrafficQuota === 'function') {
        renderProxyTrafficQuota(result.quota);
      }
    }).catch(() => {});
    window.electronAPI?.invoke?.('ai-control-get-models').then((result) => {
      if (result?.ok) renderAccountAiUsage(result.quota || null);
    }).catch(() => {});
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

function unifiedGiftFailureMessage(woolResult, aiResult, trafficResult) {
  const results = [woolResult, trafficResult, aiResult].filter(Boolean);
  const meaningful = results.find((result) => {
    const message = String(result?.message || result?.error || '').trim();
    return message && Number(result?.status) !== 404 && !message.includes('不存在');
  });
  if (meaningful) return meaningful.message || meaningful.error;
  if (results.some((result) => Number(result?.status) >= 500)) return '服务器兑换服务异常，请稍后重试或联系管理员';
  return '兑换码不存在或已失效';
}

async function redeemUnifiedGiftCode() {
  const input = safeGetEl('unified-gift-code');
  const button = safeGetEl('unified-redeem-gift');
  const code = String(input?.value || '').trim();
  if (!code || !button || button.dataset.busy === '1') {
    if (!code) window.MessageModal?.showErrorMessage?.('请输入兑换码');
    return;
  }
  const originalText = button.textContent;
  button.dataset.busy = '1';
  button.disabled = true;
  button.textContent = '兑换中...';
  try {
    const woolResult = await window.electronAPI.invoke('redeem-wool-gift-code', { code })
      .catch((error) => ({ ok: false, message: error?.message || String(error) }));
    if (woolResult?.ok) {
      const woolPlatforms = woolResult.validation?.woolPlatforms || woolResult.validation?.wool_platforms;
      if (Array.isArray(woolPlatforms) && typeof renderWoolPlatformButtons === 'function') {
        renderWoolPlatformButtons(woolPlatforms);
      }
      if (input) input.value = '';
      window.MessageModal?.showSuccessMessage?.(woolResult.message || '羊毛额度兑换成功');
      return;
    }

    const aiResult = await window.electronAPI.invoke('ai-control-redeem-gift-code', { code })
      .catch((error) => ({ ok: false, message: error?.message || String(error) }));
    if (aiResult?.ok) {
      const displayQuota = window.AiFreeQuotaDisplay?.recordAIResetAfterRedeem?.(
        aiResult.quota,
        aiResult.added_quota,
      ) || aiResult.quota;
      if (displayQuota) {
        window.dispatchEvent(new CustomEvent('ai-control-quota-updated', { detail: displayQuota }));
      }
      if (input) input.value = '';
      window.MessageModal?.showSuccessMessage?.(aiResult.message || '对话额度兑换成功');
      return;
    }

    const trafficResult = await window.electronAPI.invoke('redeem-proxy-traffic-gift-code', { code })
      .catch((error) => ({ ok: false, message: error?.message || String(error) }));
    if (!trafficResult?.ok) throw new Error(unifiedGiftFailureMessage(woolResult, aiResult, trafficResult));
    if (input) input.value = '';
    const displayQuota = window.AiFreeQuotaDisplay?.recordTrafficResetAfterRedeem?.(
      trafficResult.quota,
      trafficResult.added_bytes,
    ) || trafficResult.quota;
    if (displayQuota && typeof renderProxyTrafficQuota === 'function') {
      renderProxyTrafficQuota(displayQuota);
    }
    window.MessageModal?.showSuccessMessage?.(trafficResult.message || '流量兑换成功');
  } catch (error) {
    window.MessageModal?.showErrorMessage?.(error?.message || String(error));
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
  safeGetEl('unified-redeem-gift')?.addEventListener('click', redeemUnifiedGiftCode);
  safeGetEl('unified-gift-code')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void redeemUnifiedGiftCode();
  });
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
