// 侧边栏功能可用性与运行时值同步。
// TCP 连接状态展示已移除：功能按钮不再依赖“是否连接成功”，仅由卡密验证状态驱动。

let currentRemainingUsageText = '';
const woolPlatformQuotaText = new Map();

function formatWoolPlatformQuotaText(quota) {
  if (!quota || typeof quota !== 'object') return '';
  if (quota.enabled === false) return '未开通';
  if (quota.expired === true) return '已过期';
  if (quota.exhausted === true) return '次数已用尽';

  const parts = [];
  const remaining = Number(quota.remaining_usage_times);
  if (quota.remaining_usage_times === null || quota.remaining_usage_times === undefined) {
    parts.push('无限次');
  } else if (Number.isFinite(remaining)) {
    parts.push(`剩余 ${Math.max(0, remaining)} 次`);
  }

  const seconds = Number(quota.remaining_seconds);
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) parts.push('已到期');
    else if (seconds >= 86400) parts.push(`剩余 ${Math.ceil(seconds / 86400)} 天`);
    else if (seconds >= 3600) parts.push(`剩余 ${Math.ceil(seconds / 3600)} 小时`);
    else parts.push(`剩余 ${Math.max(1, Math.ceil(seconds / 60))} 分钟`);
  } else if (!quota.expiry_date && !quota.validity_seconds) {
    parts.push('长期有效');
  } else if (quota.validity_seconds && !quota.activated_at) {
    parts.push('首次使用计时');
  }
  return parts.join(' · ');
}

function applyWoolPlatformButtonLabel(button) {
  if (!button) return;
  const baseLabel = String(button.dataset.baseLabel || button.textContent || '').replace(/\s*\(剩余次数：.*\)$/, '').trim();
  button.dataset.baseLabel = baseLabel;
  button.replaceChildren(document.createTextNode(baseLabel));
  const platform = String(button.dataset.platform || '').trim();
  const quotaText = woolPlatformQuotaText.get(platform) || currentRemainingUsageText;
  if (quotaText && platform) {
    const remaining = document.createElement('span');
    remaining.className = 'wool-platform-remaining';
    remaining.textContent = `（${quotaText}）`;
    button.appendChild(remaining);
  }
}

function setWoolPlatformRemainingUsage(value, platform = '') {
  const platformName = String(platform || '').trim();
  if (platformName) {
    woolPlatformQuotaText.set(platformName, String(value ?? '').trim());
  } else {
    currentRemainingUsageText = String(value ?? '').trim();
  }
  document.querySelectorAll('.open-wool-platform-btn').forEach(applyWoolPlatformButtonLabel);
}

// 设置/更新/持久化：setButtonsDisabled的具体业务逻辑。
function setButtonsDisabled(selector, disabled) {
  document.querySelectorAll(selector).forEach((button) => {
    button.disabled = disabled;
  });
}

// 设置/更新/持久化：setLicenseRequiredButtonsDisabled的具体业务逻辑。
function setLicenseRequiredButtonsDisabled(disabled) {
  const nextDisabled = !!disabled;
  setButtonsDisabled('.requires-license', nextDisabled);
  document.querySelectorAll('.open-wool-platform-btn').forEach((button) => {
    button.disabled = nextDisabled || button.dataset.quotaUnavailable === 'true';
  });
  syncLoggedOutProtectedEntryAvailability();
}

// 设置/更新/持久化：setAccountTabDisabled的具体业务逻辑。
function setAccountTabDisabled(disabled) {
  const accountTabBtn = safeGetEl('account-history-toggle-btn');
  if (accountTabBtn) {
    accountTabBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    accountTabBtn.classList.toggle('is-disabled', !!disabled);
  }
}

// 处理：isLicenseValidated的具体业务逻辑。
function isLicenseValidated() {
  const validateBtn = safeGetEl('validate-key-btn');
  return !!(validateBtn && validateBtn.classList.contains('validated'));
}

// 未登录时，受保护的主入口仍保持可点击；真正的点击处理器会在任何
// IPC/网络操作前跳转到登录。测速和手动选路不是登录入口，继续禁用。
function syncLoggedOutProtectedEntryAvailability() {
  const accountSession = safeGetEl('sidebar-account-session');
  const authenticated = accountSession?.dataset.authenticated === 'true';

  const restoreAuthenticatedTitle = (button) => {
    if (!button?.hasAttribute('data-authenticated-title')) return;
    button.title = button.dataset.authenticatedTitle || '';
    button.removeAttribute('data-authenticated-title');
  };

  if (authenticated) {
    document.querySelectorAll('.open-wool-platform-btn').forEach(restoreAuthenticatedTitle);
    restoreAuthenticatedTitle(safeGetEl('VPN-switch'));
    return;
  }

  document.querySelectorAll('.open-wool-platform-btn').forEach((button) => {
    if (button.dataset.busy !== '1') {
      if (button.title !== '登录后使用羊毛资源') {
        button.dataset.authenticatedTitle = button.title || '';
      }
      button.disabled = false;
      button.title = '登录后使用羊毛资源';
    }
  });

  const vpnButton = safeGetEl('VPN-switch');
  if (vpnButton && vpnButton.dataset.busy !== '1') {
    if (vpnButton.title !== '登录后使用网络魔法') {
      vpnButton.dataset.authenticatedTitle = vpnButton.title || '';
    }
    vpnButton.disabled = false;
    vpnButton.title = '登录后使用网络魔法';
  }
}

// 设置/更新/持久化：applyFeatureAvailability的具体业务逻辑。
function applyFeatureAvailability({
  licenseRequiredDisabled = true,
  vpnDisabled = true,
  accountTabDisabled = true,
} = {}) {
  setLicenseRequiredButtonsDisabled(licenseRequiredDisabled);
  setButtonsDisabled('.VPN-btn', vpnDisabled);
  setAccountTabDisabled(accountTabDisabled);
  syncLatencyButtonState();
  syncLoggedOutProtectedEntryAvailability();
}

// 设置/更新/持久化：setDreamButtonPlatformName的具体业务逻辑。
function setDreamButtonPlatformName(platformName) {
  const normalized = String(platformName || '').trim();
  if (!normalized) return;
  currentPlatformName = normalized;
  const dreamBtn = safeGetEl('open-dream-page-btn');
  if (dreamBtn) {
    dreamBtn.dataset.baseLabel = `一键启动 ${normalized}`;
    dreamBtn.dataset.platform = normalized;
    applyWoolPlatformButtonLabel(dreamBtn);
  }
}

// 渲染/刷新：按当前用户获准的羊毛平台生成独立启动按钮。
function renderWoolPlatformButtons(platforms) {
  const container = safeGetEl('wool-platform-buttons');
  if (!container) return;
  const items = (Array.isArray(platforms) ? platforms : [])
    .map((item) => ({
      name: String(item?.name || item?.platform || item?.platform_name || '').trim(),
      targetUrl: String(item?.targetUrl || item?.target_url || '').trim(),
      quota: item?.quota && typeof item.quota === 'object' ? item.quota : null,
    }))
    .filter((item) => item.name && item.targetUrl);

  const sectionTitle = safeGetEl('wool-resource-title');
  if (sectionTitle) sectionTitle.hidden = items.length === 0;

  container.innerHTML = '';
  container.hidden = items.length === 0;
  woolPlatformQuotaText.clear();
  items.forEach((item) => {
    const quotaText = formatWoolPlatformQuotaText(item.quota);
    if (quotaText) woolPlatformQuotaText.set(item.name, quotaText);
  });
  if (!items.length) {
    return;
  }

  items.forEach((item, index) => {
    const button = document.createElement('button');
    if (index === 0) button.id = 'open-dream-page-btn';
    button.type = 'button';
    button.className = 'main-button btn-large-blue requires-license open-wool-platform-btn';
    button.dataset.platform = item.name;
    button.dataset.targetUrl = item.targetUrl;
    button.dataset.baseLabel = `一键启动 ${item.name}`;
    applyWoolPlatformButtonLabel(button);
    const quotaUnavailable = item.quota?.expired === true || item.quota?.exhausted === true;
    button.dataset.quotaUnavailable = quotaUnavailable ? 'true' : 'false';
    button.disabled = !isLicenseValidated() || quotaUnavailable;
    if (item.quota?.account_type) button.title = `账号类型：${item.quota.account_type}`;
    container.appendChild(button);
  });
  syncLoggedOutProtectedEntryAvailability();
}

// 设置/更新/持久化：setTutorialLinkHref的具体业务逻辑。
function setTutorialLinkHref(tutorialUrl) {
  const normalized = String(tutorialUrl || '').trim();
  const tutorialLink = safeGetEl('tutorial-link');
  if (tutorialLink) {
    if (normalized) {
      tutorialLink.setAttribute('href', normalized);
      tutorialLink.dataset.tutorialUrl = normalized;
      tutorialLink.removeAttribute('aria-disabled');
      tutorialLink.title = '打开服务器下发的教程链接';
    } else {
      tutorialLink.removeAttribute('href');
      tutorialLink.dataset.tutorialUrl = '';
      tutorialLink.setAttribute('aria-disabled', 'true');
      tutorialLink.title = '教程链接尚未同步';
    }
  }
}

// 设置/更新/持久化：setTargetUrl的具体业务逻辑。
function setTargetUrl(nextTargetUrl) {
  DREAM_URL = String(nextTargetUrl || '').trim() || 'https://dreamina.capcut.com/ai-tool/home?';
  const buttons = document.querySelectorAll('.open-wool-platform-btn');
  if (buttons.length === 1 && !String(buttons[0].dataset.targetUrl || '').trim()) {
    buttons[0].dataset.targetUrl = DREAM_URL;
  }
}

// 设置/更新/持久化：根据卡密验证状态刷新功能按钮可用性。
// 参数保留以兼容既有调用点；语义为“服务可用”（HTTP 通信下恒为可用），
// 实际是否放开功能仍取决于卡密是否已验证。
function updateButtonStatesBasedOnConnection(available) {
  if (available) {
    if (isLicenseValidated()) {
      applyFeatureAvailability({
        licenseRequiredDisabled: false,
        vpnDisabled: false,
        accountTabDisabled: false,
      });
    } else {
      applyFeatureAvailability();
    }
  } else {
    const validateBtn = safeGetEl('validate-key-btn');
    applyFeatureAvailability({
      licenseRequiredDisabled: true,
      vpnDisabled: !isLicenseValidated(),
      accountTabDisabled: true,
    });

    if (!hasValidatedInSession) {
      if (validateBtn) {
        validateBtn.classList.remove('validated');
        validateBtn.disabled = false;
        validateBtn.textContent = '验证';
        validateBtn.title = '请手动点击验证';
      }
    }
  }
}

// 设置/更新/持久化：enableAllLicenseRequiredButtons的具体业务逻辑。
function enableAllLicenseRequiredButtons() {
  setLicenseRequiredButtonsDisabled(false);
  setButtonsDisabled('.VPN-btn', false);
  setAccountTabDisabled(false);
  syncLatencyButtonState();
}

// 渲染/刷新：根据卡密验证状态刷新功能可用性（替代原“获取 TCP 连接状态”逻辑）。
function refreshFeatureAvailability() {
  updateButtonStatesBasedOnConnection(true);
}

// 渲染/刷新：refreshPlatformName的具体业务逻辑。
async function refreshPlatformName() {
  try {
    const platformName = await window.electronAPI.invoke('get-platform-name');
    setDreamButtonPlatformName(platformName);
    return platformName;
  } catch (error) {
    console.error('[侧边栏] 获取平台名字失败:', error);
    return '';
  }
}

// 获取/读取/解析：从主进程缓存恢复“平台名 + 目标地址”，避免错过登录阶段的推送事件。
async function refreshWoolPlatforms() {
  try {
    const woolPlatforms = await window.electronAPI.invoke('get-wool-platforms');
    renderWoolPlatformButtons(Array.isArray(woolPlatforms) ? woolPlatforms : []);
    return Array.isArray(woolPlatforms) ? woolPlatforms : [];
  } catch (error) {
    console.error('[侧边栏] 获取羊毛平台列表失败:', error);
    return [];
  }
}

// 渲染/刷新：refreshTutorialUrl的具体业务逻辑。
async function refreshTutorialUrl() {
  try {
    const tutorialUrl = await window.electronAPI.invoke('get-tutorial-url');
    setTutorialLinkHref(tutorialUrl);
  } catch (error) {
    console.error('[侧边栏] 获取教程链接失败:', error);
  }
}

// 渲染/刷新：refreshTargetUrl的具体业务逻辑。
async function refreshTargetUrl() {
  try {
    const targetUrl = await window.electronAPI.invoke('get-target-url');
    setTargetUrl(targetUrl);
  } catch (error) {
    console.error('[侧边栏] 获取目标链接失败:', error);
    setTargetUrl('');
  }
}

// 兼容旧调用名：不再查询连接状态，仅按卡密验证状态刷新功能按钮。
async function refreshConnectionState() {
  refreshFeatureAvailability();
  return null;
}

// 同步/连接：bindRuntimeValueListeners的具体业务逻辑。
function bindRuntimeValueListeners() {
  window.electronAPI.on('platform-name-updated', (data) => {
    try {
      const platformName = data && data.platformName;
      if (!platformName) return;
      setDreamButtonPlatformName(platformName);
      if (Array.isArray(data?.woolPlatforms)) renderWoolPlatformButtons(data.woolPlatforms);
      void refreshTutorialUrl();
    } catch (e) {
      console.warn('[侧边栏] 处理平台名称更新事件失败:', e?.message || e);
    }
  });

  window.electronAPI.on('wool-platforms-updated', (data) => {
    renderWoolPlatformButtons(data?.woolPlatforms || []);
  });

  window.electronAPI.on('tutorial-url-updated', (data) => {
    try {
      const tutorialUrl = data && data.tutorialUrl;
      if (typeof tutorialUrl !== 'string') return;
      setTutorialLinkHref(tutorialUrl);
    } catch (e) {
      console.warn('[侧边栏] 处理教程链接更新事件失败:', e?.message || e);
    }
  });

  window.electronAPI.on('target-url-updated', (data) => {
    try {
      const targetUrl = data && data.targetUrl;
      if (!targetUrl || typeof targetUrl !== 'string') return;
      setTargetUrl(targetUrl);
    } catch (e) {
      console.warn('[侧边栏] 处理目标链接更新事件失败:', e?.message || e);
    }
  });

  window.electronAPI.on('active-zoom', () => {});
}

// 获取/读取/解析：loadInitialConnectionState的具体业务逻辑。
// 保留函数名以兼容初始化流程；现仅按卡密验证状态刷新功能可用性。
function loadInitialConnectionState() {
  setTimeout(() => {
    refreshFeatureAvailability();
  }, 500);
}

// 获取/读取/解析：loadInitialRuntimeValues的具体业务逻辑。
function loadInitialRuntimeValues() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return;
  }

  void refreshWoolPlatforms();
  void refreshPlatformName().then(() => refreshTutorialUrl());
  void refreshTargetUrl();
}
