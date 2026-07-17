// 个人中心账号资料卡、内嵌登录注册表单与会话切换。

let sidebarAccountAuthMode = 'login';
let sidebarAuthPreviousFocus = null;
let accountCenterPreviousFocus = null;
const isStandaloneAccountCenterPopup = new URLSearchParams(window.location.search).get('accountCenterPopup') === '1';
const shouldAutoOpenVipPlans = new URLSearchParams(window.location.search).get('showVipPlans') === '1';
let selectedVipPlanCode = 'vip_quarterly';
let selectedVipTier = 'vip';
let vipPlanCatalog = [];
let vipTierCatalog = [];
let vipPlansOpenRequested = shouldAutoOpenVipPlans;

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
  const registering = sidebarAccountAuthMode === 'register';
  const modeSwitch = safeGetEl('sidebar-auth-mode-switch');
  const modeLabel = safeGetEl('sidebar-auth-mode-label');
  if (modeSwitch) {
    modeSwitch.dataset.targetMode = registering ? 'login' : 'register';
    modeSwitch.setAttribute('aria-label', registering ? '切换到登录' : '切换到注册');
  }
  if (modeLabel) modeLabel.textContent = registering ? '去登录' : '去注册';
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
  const panel = safeGetEl('sidebar-account-auth');
  if (!panel) return;
  if (panel.hidden) sidebarAuthPreviousFocus = document.activeElement;
  setSidebarAuthMode(mode);
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  if (safeGetEl('account-center-dialog')?.hidden === false) {
    setTimeout(() => safeGetEl('sidebar-auth-username')?.focus(), 0);
  }
}

function closeSidebarAccountAuth() {
  const panel = safeGetEl('sidebar-account-auth');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  const password = safeGetEl('sidebar-auth-password');
  const confirmation = safeGetEl('sidebar-auth-password-confirm');
  if (password) password.value = '';
  if (confirmation) confirmation.value = '';
  setSidebarAuthStatus('');
  sidebarAuthPreviousFocus?.focus?.();
  sidebarAuthPreviousFocus = null;
}

function openAccountCenterDialog() {
  const dialog = safeGetEl('account-center-dialog');
  if (!dialog || !dialog.hidden) return;
  accountCenterPreviousFocus = document.activeElement;
  dialog.hidden = false;
  dialog.setAttribute('aria-hidden', 'false');
  document.body.classList.add('account-center-open');
  setTimeout(() => {
    const profile = safeGetEl('sidebar-account-session');
    if (profile?.dataset.authenticated === 'true') safeGetEl('account-center-dialog-close')?.focus();
    else safeGetEl('sidebar-auth-username')?.focus();
  }, 0);
}

function isSidebarAccountAuthenticated() {
  return safeGetEl('sidebar-account-session')?.dataset.authenticated === 'true';
}

// 返回 true 表示本次操作已被登录门禁接管。复用顶部头像的独立个人中心
// 浮窗，只通知主进程打开窗口，不发起任何业务服务器请求。
function redirectToSidebarAccountLogin() {
  if (isSidebarAccountAuthenticated()) return false;
  window.electronAPI?.send?.('open-account-center-popup');
  return true;
}

function closeAccountCenterDialog() {
  const dialog = safeGetEl('account-center-dialog');
  if (!dialog || dialog.hidden) return;
  closeAccountProfileMenu();
  if (isStandaloneAccountCenterPopup) {
    window.electronAPI?.send?.('close-account-center-popup');
    return;
  }
  dialog.hidden = true;
  dialog.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('account-center-open');
  accountCenterPreviousFocus?.focus?.();
  accountCenterPreviousFocus = null;
}

window.openAccountCenterDialog = openAccountCenterDialog;
window.closeAccountCenterDialog = closeAccountCenterDialog;
window.isSidebarAccountAuthenticated = isSidebarAccountAuthenticated;
window.redirectToSidebarAccountLogin = redirectToSidebarAccountLogin;

function resolveSidebarVipState(session = {}) {
  const sources = [session.validation?.result, session.validation, session.result, session, session.account]
    .filter((item) => item && typeof item === 'object');
  const verification = sources.find((source) => source.vip_server_verified === true);
  const verifiedAt = Date.parse(String(verification?.vip_verified_at || ''));
  const now = Date.now();
  const serverVerified = Number.isFinite(verifiedAt)
    && verifiedAt <= now + 60 * 1000
    && now - verifiedAt <= 10 * 60 * 1000;
  let enabled = false;
  let statusResolved = false;
  let expiryDate = '';
  let tier = 'vip';
  for (const source of sources) {
    const hasStatus = ['is_vip', 'isVip', 'vip_active', 'vipActive']
      .some((key) => Object.prototype.hasOwnProperty.call(source, key));
    if (!statusResolved && hasStatus) {
      enabled = source.is_vip === true || source.isVip === true || source.vip_active === true || source.vipActive === true
        || Number(source.is_vip) === 1 || Number(source.isVip) === 1;
      statusResolved = true;
    }
    const candidate = String(source.vip_expiry_date || source.vipExpiryDate || '').trim();
    if (!expiryDate && candidate) expiryDate = candidate;
    const candidateTier = String(source.vip_tier || source.vipTier || '').trim().toLowerCase();
    if (/^[a-z][a-z0-9_-]{1,31}$/.test(candidateTier)) tier = candidateTier;
  }
  const expiresAt = expiryDate ? Date.parse(expiryDate.includes('T') ? expiryDate : expiryDate.replace(' ', 'T')) : null;
  const active = serverVerified && enabled
    && (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now));
  return { active, tier: active ? tier : null, expiryDate, permanent: active && !expiryDate };
}

function closeVipBenefitsDialog() {
  const dialog = safeGetEl('vip-benefits-dialog');
  if (!dialog || dialog.hidden) return;
  dialog.hidden = true;
  dialog.setAttribute('aria-hidden', 'true');
}

function applyVipComparisonColumns(element, tierCount) {
  if (!element) return;
  element.style.gridTemplateColumns = `minmax(90px, 1.25fr) minmax(54px, .8fr) repeat(${Math.max(1, tierCount)}, minmax(64px, .8fr))`;
}

function renderVipPermissionComparison(items = [], tiers = []) {
  const container = safeGetEl('vip-permission-rows');
  const table = safeGetEl('vip-permission-table');
  const tierList = Array.isArray(tiers) ? tiers : [];
  const comparisonItems = Array.isArray(items) ? items.filter((item) => (
    item?.code !== 'weekly_wool_quota'
    || tierList.some((tier) => Number(tier?.weekly_wool_quota || 0) > 0)
  )) : [];
  const hasComparison = Boolean(container && comparisonItems.length && tierList.length);
  if (table) table.hidden = !hasComparison;
  if (!hasComparison) {
    container?.replaceChildren();
    return;
  }
  const head = safeGetEl('vip-permission-head');
  if (head) {
    const labels = ['功能', '普通', ...tierList.map((item) => String(item.display_name || item.tier || '会员'))];
    head.replaceChildren(...labels.map((label) => {
      const cell = document.createElement('strong');
      cell.textContent = label;
      return cell;
    }));
    applyVipComparisonColumns(head, tierList.length);
  }
  container.replaceChildren(...comparisonItems.map((item) => {
    const row = document.createElement('div');
    row.className = 'vip-permission-row';
    const name = document.createElement('span');
    const free = document.createElement('span');
    name.textContent = String(item?.name || 'VIP 权益');
    free.textContent = String(item?.free || '-');
    const tierCells = tierList.map((tier) => {
      const cell = document.createElement('strong');
      cell.textContent = String(item?.tiers?.[tier.tier] ?? item?.[tier.tier] ?? '-');
      return cell;
    });
    row.append(name, free, ...tierCells);
    applyVipComparisonColumns(row, tierList.length);
    return row;
  }));
}

function selectVipPlan(code) {
  selectedVipPlanCode = String(code || `${selectedVipTier}_quarterly`);
  document.querySelectorAll('.vip-plan-option').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.vipPlan === selectedVipPlanCode);
  });
  const selected = document.querySelector(`.vip-plan-option[data-vip-plan="${selectedVipPlanCode}"]`);
  const status = safeGetEl('vip-plan-status');
  if (status && selected) {
    status.textContent = `已选择 ${selected.querySelector('span')?.textContent || 'VIP 套餐'}，请使用对应礼品码开通`;
  }
}

function renderVipPlanTier(tier) {
  const requestedTier = String(tier || '').trim().toLowerCase();
  selectedVipTier = vipTierCatalog.some((item) => item.tier === requestedTier)
    ? requestedTier
    : (vipTierCatalog[0]?.tier || 'vip');
  document.querySelectorAll('#vip-tier-tabs [data-vip-tier]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.vipTier === selectedVipTier);
  });
  const list = safeGetEl('vip-plan-list');
  const plans = vipPlanCatalog.filter((plan) => plan.tier === selectedVipTier);
  if (list) {
    list.hidden = plans.length === 0;
    if (!plans.length) {
      list.replaceChildren();
    } else list.replaceChildren(...plans.map((plan) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `vip-plan-option${plan.billing_cycle === 'quarterly' ? ' is-recommended' : ''}`;
      button.dataset.vipPlan = String(plan.code || '');
      if (plan.billing_cycle === 'quarterly') {
        const badge = document.createElement('em');
        badge.textContent = '推荐';
        button.appendChild(badge);
      }
      const name = document.createElement('span');
      const price = document.createElement('strong');
      const duration = document.createElement('small');
      name.textContent = String(plan.name || '会员套餐');
      price.textContent = `¥${Number(plan.price_cents || 0) / 100}`;
      duration.textContent = `${Number(plan.duration_days || 0)} 天`;
      button.append(name, price, duration);
      return button;
    }));
  }
  const preferred = plans.find((plan) => plan.code === selectedVipPlanCode)
    || plans.find((plan) => plan.billing_cycle === 'quarterly') || plans[0];
  if (preferred) selectVipPlan(preferred.code);
}

function renderVipPlans(result = {}) {
  vipPlanCatalog = Array.isArray(result.plans) ? result.plans : [];
  vipTierCatalog = Array.isArray(result.tiers) ? result.tiers : [];
  renderVipPermissionComparison(result.permission_comparison, vipTierCatalog);
  const tabs = safeGetEl('vip-tier-tabs');
  if (tabs) {
    tabs.hidden = vipTierCatalog.length === 0;
    tabs.replaceChildren(...vipTierCatalog.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.vipTier = String(item.tier || 'vip');
      button.textContent = String(item.display_name || item.tier || '会员');
      return button;
    }));
    if (vipTierCatalog.length) tabs.style.gridTemplateColumns = `repeat(${vipTierCatalog.length}, minmax(72px, 1fr))`;
  }
  const activeTier = result.membership?.vip_tier;
  if (result.membership?.is_vip === true && activeTier) {
    const activeName = vipTierCatalog.find((item) => item.tier === activeTier)?.display_name || activeTier.toUpperCase();
    if (safeGetEl('account-vip-title')) safeGetEl('account-vip-title').textContent = `${activeName} 已开通`;
  }
  renderVipPlanTier(activeTier || selectedVipTier);
  const themeAction = safeGetEl('vip-gold-theme-action');
  const vipActive = result.membership?.is_vip === true || window.isSidebarVipActive?.() === true;
  themeAction?.classList.toggle('is-locked', !vipActive);
  if (themeAction) themeAction.title = vipActive ? '立即切换土豪金主题' : '开通 VIP 后解锁土豪金主题';
}

async function loadVipPlans() {
  const status = safeGetEl('vip-plan-status');
  if (status) status.textContent = '正在读取服务器套餐与价格…';
  try {
    const result = await window.electronAPI?.invoke?.('get-vip-plans');
    if (!result?.ok) throw new Error(result?.message || 'VIP 套餐暂时不可用');
    renderVipPlans(result);
    if (result.weekly_grant?.granted && status) {
      status.textContent = '本周会员 AI、网络魔法与羊毛额度已到账';
    }
  } catch (error) {
    if (status) status.textContent = error?.message || '套餐价格读取失败，当前显示默认价格';
  }
}

function openVipBenefitsDialog() {
  const dialog = safeGetEl('vip-benefits-dialog');
  if (!dialog) return;
  if (!isSidebarAccountAuthenticated()) {
    openSidebarAccountAuth('login');
    return;
  }
  dialog.hidden = false;
  dialog.setAttribute('aria-hidden', 'false');
  selectVipPlan(selectedVipPlanCode);
  void loadVipPlans();
  setTimeout(() => dialog.querySelector('.vip-benefits-close')?.focus?.(), 0);
}

function openVipAccountCenter() {
  if (isStandaloneAccountCenterPopup) {
    openVipBenefitsDialog();
    return;
  }
  // Chromium 原生窗口会在鼠标悬停时抢回焦点。VIP 门禁弹窗不能因此被
  // 当作“点击外部”关闭；显式点击其它区域和关闭按钮仍会发送关闭事件。
  window.electronAPI?.send?.('open-account-center-popup', { dismissOnBlur: false, showVipPlans: true });
}

function renderAccountVipState(session = {}) {
  const vip = resolveSidebarVipState(session);
  const profile = safeGetEl('sidebar-account-session');
  const card = safeGetEl('account-vip-card');
  const title = safeGetEl('account-vip-title');
  const description = safeGetEl('account-vip-description');
  const action = card?.querySelector?.('.account-vip-action');
  if (profile) profile.dataset.vip = vip.active ? 'true' : 'false';
  if (card) card.dataset.active = vip.active ? 'true' : 'false';
  if (title) title.textContent = vip.active ? `${String(vip.tier || 'vip').toUpperCase()} 已开通` : '开通会员';
  if (description) {
    description.textContent = vip.active
      ? (vip.permanent ? '永久有效' : `有效期至 ${vip.expiryDate}`)
      : '无限浏览器窗口 · 自定义插件和模型';
  }
  if (action) action.textContent = vip.active ? '已解锁' : '立即开通';
  return vip;
}

window.isSidebarVipActive = (session) => session
  ? resolveSidebarVipState(session).active
  : safeGetEl('sidebar-account-session')?.dataset.vip === 'true';
window.openVipAccountCenter = openVipAccountCenter;
window.openVipBenefitsDialog = openVipBenefitsDialog;

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
  const giftInput = safeGetEl('unified-gift-code');
  const giftButton = safeGetEl('unified-redeem-gift');
  const usageDetails = safeGetEl('account-usage-details');
  const vipCard = safeGetEl('account-vip-card');
  const username = authenticated ? String(session.username || '').trim() : '';

  if (profile) profile.dataset.authenticated = authenticated ? 'true' : 'false';
  if (vipCard) vipCard.hidden = !authenticated;
  renderAccountVipState(authenticated ? session : {});
  if (typeof syncLoggedOutProtectedEntryAvailability === 'function') {
    syncLoggedOutProtectedEntryAvailability();
  }
  window.electronAPI?.send?.('sync-app-shell-account', { authenticated, username });
  if (usernameDisplay) usernameDisplay.value = username;
  if (usernameInput && username) usernameInput.value = username;
  if (profileName) profileName.textContent = username || '未登录';
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
    closeVipBenefitsDialog();
    renderAccountProxyTrafficUsage(null);
    renderAccountAiUsage(null);
    openSidebarAccountAuth(sidebarAccountAuthMode);
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

async function submitSidebarDeviceLogin() {
  const button = safeGetEl('sidebar-device-login');
  if (!button || button.dataset.busy === '1') return;
  const originalText = button.textContent;
  button.dataset.busy = '1';
  button.disabled = true;
  button.textContent = '正在识别本机设备...';
  setSidebarAuthStatus('正在使用本机设备号找回账号...');
  try {
    const response = await invokeSidebarAccountAuth({ mode: 'device' });
    if (!response?.ok) throw new Error(response?.message || '设备号登录失败');
    renderSidebarAccountSession({
      authenticated: true,
      username: String(response.account?.username || '').trim(),
      platformName: response.platformName || '',
      account: response.account || {},
      validation: response.validation || {},
    });
  } catch (error) {
    setSidebarAuthStatus(error?.message || String(error), 'error');
  } finally {
    button.dataset.busy = '0';
    button.disabled = false;
    button.textContent = originalText;
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

function unifiedGiftFailureMessage(vipResult, woolResult, aiResult, trafficResult) {
  const results = [vipResult, woolResult, trafficResult, aiResult].filter(Boolean);
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
    const vipResult = await window.electronAPI.invoke('redeem-vip-gift-code', { code })
      .catch((error) => ({ ok: false, message: error?.message || String(error) }));
    if (vipResult?.ok) {
      if (input) input.value = '';
      renderSidebarAccountSession(vipResult.session || {
        authenticated: true,
        username: safeGetEl('account-username-display')?.value || '',
        account: { is_vip: true, vip_tier: vipResult.vip_tier || 'vip', vip_expiry_date: vipResult.vip_expiry_date || null },
        validation: vipResult.validation || {},
      });
      window.MessageModal?.showSuccessMessage?.(vipResult.message || 'VIP 开通成功');
      return;
    }

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
    if (!trafficResult?.ok) throw new Error(unifiedGiftFailureMessage(vipResult, woolResult, aiResult, trafficResult));
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

  if (!isStandaloneAccountCenterPopup) {
    document.addEventListener('pointerdown', () => {
      window.electronAPI?.send?.('dismiss-account-center-popup');
    }, true);
  }

  safeGetEl('sidebar-auth-mode-switch')?.addEventListener('click', (event) => {
    setSidebarAuthMode(event.currentTarget?.dataset.targetMode);
  });
  document.querySelectorAll('[data-account-center-close]').forEach((element) => {
    element.addEventListener('click', closeAccountCenterDialog);
  });
  document.querySelectorAll('[data-vip-benefits-close]').forEach((element) => {
    element.addEventListener('click', closeVipBenefitsDialog);
  });
  safeGetEl('vip-plan-list')?.addEventListener('click', (event) => {
    const option = event.target?.closest?.('.vip-plan-option');
    if (option?.dataset?.vipPlan) selectVipPlan(option.dataset.vipPlan);
  });
  safeGetEl('vip-tier-tabs')?.addEventListener('click', (event) => {
    const tierButton = event.target?.closest?.('[data-vip-tier]');
    if (tierButton?.dataset?.vipTier) renderVipPlanTier(tierButton.dataset.vipTier);
  });
  safeGetEl('vip-use-gift-code')?.addEventListener('click', () => {
    closeVipBenefitsDialog();
    safeGetEl('unified-gift-code')?.focus?.();
  });
  safeGetEl('vip-gold-theme-action')?.addEventListener('click', () => {
    const status = safeGetEl('vip-plan-status');
    if (window.isSidebarVipActive?.() !== true) {
      if (status) status.textContent = '土豪金主题为 VIP 专属权益，请先开通 VIP';
      return;
    }
    document.documentElement.classList.remove('theme-light');
    document.documentElement.classList.add('theme-gold');
    document.documentElement.dataset.theme = 'gold';
    try { localStorage.setItem('ai-free.control-panel.theme', 'gold'); } catch (_) {}
    window.electronAPI?.send?.('app-theme-changed', 'gold');
    if (status) status.textContent = '土豪金主题已启用';
  });
  safeGetEl('account-profile-avatar')?.addEventListener('click', toggleAccountProfileMenu);
  safeGetEl('account-profile-menu')?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeAccountProfileMenu);
  safeGetEl('sidebar-auth-submit')?.addEventListener('click', submitSidebarAccountAuth);
  safeGetEl('sidebar-device-login')?.addEventListener('click', submitSidebarDeviceLogin);
  safeGetEl('account-logout-btn')?.addEventListener('click', logoutSidebarAccount);
  safeGetEl('account-vip-card')?.addEventListener('click', openVipAccountCenter);
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
    if (event.key !== 'Escape') return;
    if (safeGetEl('vip-benefits-dialog')?.hidden === false) {
      closeVipBenefitsDialog();
      return;
    }
    closeAccountCenterDialog();
  });

  window.electronAPI?.on?.('account-session-updated', (session = {}) => {
    renderSidebarAccountSession(session);
    if (isStandaloneAccountCenterPopup && vipPlansOpenRequested && session.authenticated === true) {
      openVipBenefitsDialog();
    }
  });
  window.electronAPI?.on?.('vip-access-required', () => {
    openVipAccountCenter();
  });
  window.electronAPI?.on?.('open-vip-plans', () => {
    vipPlansOpenRequested = true;
    if (isStandaloneAccountCenterPopup && isSidebarAccountAuthenticated()) openVipBenefitsDialog();
  });
  window.electronAPI?.on?.('account-popup-snapshot', (snapshot = {}) => {
    if (!isStandaloneAccountCenterPopup) return;
    document.documentElement.classList.toggle('theme-light', snapshot.theme === 'light');
    document.documentElement.classList.toggle('theme-gold', snapshot.theme === 'gold');
    document.documentElement.dataset.theme = snapshot.theme === 'gold' ? 'gold' : (snapshot.theme === 'light' ? 'light' : 'dark');
    const title = safeGetEl('announcement-title');
    const icon = safeGetEl('announcement-icon');
    const content = safeGetEl('announcement-content');
    const tutorial = safeGetEl('tutorial-link');
    const version = safeGetEl('app-version');
    if (title && snapshot.announcementTitle) title.textContent = snapshot.announcementTitle;
    if (icon && snapshot.announcementIcon) icon.textContent = snapshot.announcementIcon;
    if (content && snapshot.announcementHtml) content.innerHTML = snapshot.announcementHtml;
    if (tutorial && snapshot.tutorialUrl) tutorial.href = snapshot.tutorialUrl;
    if (version && snapshot.appVersion) version.textContent = snapshot.appVersion;
  });
  window.electronAPI?.on?.('account-popup-dismiss', () => {
    if (!isStandaloneAccountCenterPopup) return;
    document.documentElement.classList.add('account-center-popup-closing');
  });

  setSidebarAuthMode('login');
  window.electronAPI.invoke('account-get-session').then((session) => {
    renderSidebarAccountSession(session || {});
    if (isStandaloneAccountCenterPopup && vipPlansOpenRequested && session?.authenticated === true) {
      openVipBenefitsDialog();
    }
  }).catch(() => {
    renderSidebarAccountSession({ authenticated: false });
  });
  if (isStandaloneAccountCenterPopup) setTimeout(() => {
    openAccountCenterDialog();
  }, 0);
  if (isStandaloneAccountCenterPopup && typeof ResizeObserver === 'function') {
    const accountCard = document.querySelector('.account-profile-shell');
    if (accountCard) {
      const notifyPopupSize = () => {
        const height = Math.ceil(accountCard.getBoundingClientRect().height) + 20;
        window.electronAPI?.send?.('resize-account-center-popup', { height });
      };
      new ResizeObserver(notifyPopupSize).observe(accountCard);
      setTimeout(notifyPopupSize, 0);
    }
  }
}
