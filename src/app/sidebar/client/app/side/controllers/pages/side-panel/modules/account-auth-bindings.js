function bindAccountPopupDismiss() {
  if (!isStandaloneAccountCenterPopup) {
    document.addEventListener('pointerdown', () => window.aiFree?.account?.dismissCenterPopup?.(), true);
  }
}

function bindAccountDialogControls() {
  safeGetEl('sidebar-auth-mode-switch')?.addEventListener('click', (event) => {
    setSidebarAuthMode(event.currentTarget?.dataset.targetMode);
  });
  document.querySelectorAll('[data-account-center-close]').forEach((element) => element.addEventListener('click', closeAccountCenterDialog));
  document.querySelectorAll('[data-vip-benefits-close]').forEach((element) => element.addEventListener('click', closeVipBenefitsDialog));
  safeGetEl('account-profile-avatar')?.addEventListener('click', toggleAccountProfileMenu);
  safeGetEl('account-profile-menu')?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeAccountProfileMenu);
  document.addEventListener('keydown', closeAccountDialogOnEscape);
}

function closeAccountDialogOnEscape(event) {
  if (event.key !== 'Escape') return;
  if (safeGetEl('vip-benefits-dialog')?.hidden === false) return closeVipBenefitsDialog();
  closeAccountCenterDialog();
}

function bindVipPlanControls() {
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
  safeGetEl('vip-gold-theme-action')?.addEventListener('click', activateVipGoldTheme);
  safeGetEl('account-vip-card')?.addEventListener('click', openVipAccountCenter);
  safeGetEl('unified-redeem-gift')?.addEventListener('click', redeemUnifiedGiftCode);
  safeGetEl('unified-gift-code')?.addEventListener('keydown', redeemGiftCodeOnEnter);
}

function activateVipGoldTheme() {
  const status = safeGetEl('vip-plan-status');
  if (window.isSidebarVipActive?.() !== true) {
    if (status) status.textContent = '土豪金主题为 VIP 专属权益，请先开通 VIP';
    return;
  }
  document.documentElement.classList.remove('theme-light');
  document.documentElement.classList.add('theme-gold');
  document.documentElement.dataset.theme = 'gold';
  try { localStorage.setItem('ai-free.control-panel.theme', 'gold'); } catch (_) {}
  window.aiFree?.ui?.emitAppThemeChanged?.('gold');
  if (status) status.textContent = '土豪金主题已启用';
}

function redeemGiftCodeOnEnter(event) {
  if (event.key === 'Enter') void redeemUnifiedGiftCode();
}

function bindAccountAuthControls() {
  safeGetEl('sidebar-auth-submit')?.addEventListener('click', submitSidebarAccountAuth);
  safeGetEl('sidebar-device-login')?.addEventListener('click', submitSidebarDeviceLogin);
  safeGetEl('account-logout-btn')?.addEventListener('click', logoutSidebarAccount);
  ['sidebar-auth-username', 'sidebar-auth-password', 'sidebar-auth-password-confirm'].forEach((id) => {
    safeGetEl(id)?.addEventListener('keydown', submitAccountAuthOnEnter);
  });
}

function submitAccountAuthOnEnter(event) {
  if (event.key === 'Enter') void submitSidebarAccountAuth();
}

function subscribeAccountApi(api, method, handler) {
  if (api && typeof api[method] === 'function') api[method](handler);
}

function bindAccountApiEvents() {
  const rootApi = window.aiFree || {};
  subscribeAccountApi(rootApi.account, 'onSessionUpdated', handleAccountSessionUpdate);
  subscribeAccountApi(rootApi.account, 'onPopupSnapshot', applyAccountPopupSnapshot);
  subscribeAccountApi(rootApi.account, 'onPopupDismiss', handleAccountPopupDismiss);
  subscribeAccountApi(rootApi.license, 'onVipAccessRequired', openVipAccountCenter);
  subscribeAccountApi(rootApi.license, 'onOpenVipPlans', handleOpenVipPlans);
}

function handleAccountSessionUpdate(session = {}) {
  renderSidebarAccountSession(session);
  if (isStandaloneAccountCenterPopup && vipPlansOpenRequested && session.authenticated === true) openVipBenefitsDialog();
}

function handleAccountPopupDismiss() {
  if (isStandaloneAccountCenterPopup) document.documentElement.classList.add('account-center-popup-closing');
}

function handleOpenVipPlans() {
  vipPlansOpenRequested = true;
  if (isStandaloneAccountCenterPopup && isSidebarAccountAuthenticated()) openVipBenefitsDialog();
}

function applyAccountPopupSnapshot(snapshot = {}) {
  if (!isStandaloneAccountCenterPopup) return;
  document.documentElement.classList.toggle('theme-light', snapshot.theme === 'light');
  document.documentElement.classList.toggle('theme-gold', snapshot.theme === 'gold');
  document.documentElement.dataset.theme = snapshot.theme === 'gold' ? 'gold' : (snapshot.theme === 'light' ? 'light' : 'dark');
  setAccountPopupSnapshotText('announcement-title', snapshot.announcementTitle, 'textContent');
  setAccountPopupSnapshotText('announcement-icon', snapshot.announcementIcon, 'textContent');
  setAccountPopupSnapshotText('announcement-content', snapshot.announcementHtml, 'innerHTML');
  setAccountPopupSnapshotText('tutorial-link', snapshot.tutorialUrl, 'href');
  setAccountPopupSnapshotText('app-version', snapshot.appVersion, 'textContent');
}

function setAccountPopupSnapshotText(id, value, property) {
  const element = safeGetEl(id);
  if (element && value) element[property] = value;
}

function initializeAccountSessionView() {
  setSidebarAuthMode('login');
  window.aiFree?.account?.getSession?.().then((session) => {
    renderSidebarAccountSession(session || {});
    if (isStandaloneAccountCenterPopup && vipPlansOpenRequested && session?.authenticated === true) {
      openVipBenefitsDialog();
    }
  }).catch(() => {
    renderSidebarAccountSession({ authenticated: false });
  });
  if (isStandaloneAccountCenterPopup) setTimeout(openAccountCenterDialog, 0);
  bindAccountPopupResize();
}

function bindAccountPopupResize() {
  if (!isStandaloneAccountCenterPopup || typeof ResizeObserver !== 'function') return;
  const accountCard = document.querySelector('.account-profile-shell');
  if (!accountCard) return;
  const notifyPopupSize = () => {
    const height = Math.ceil(accountCard.getBoundingClientRect().height) + 20;
    window.aiFree?.account?.resizeCenterPopup?.({ height });
  };
  new ResizeObserver(notifyPopupSize).observe(accountCard);
  setTimeout(notifyPopupSize, 0);
}

function bindSidebarAccountAuth() {
  const modal = safeGetEl('sidebar-account-auth');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  bindAccountPopupDismiss();
  bindAccountDialogControls();
  bindVipPlanControls();
  bindAccountAuthControls();
  bindAccountApiEvents();
  initializeAccountSessionView();
}
