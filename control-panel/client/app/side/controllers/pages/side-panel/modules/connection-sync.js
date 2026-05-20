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
  setButtonsDisabled('#open-dream-page-btn', nextDisabled);
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
}

// 设置/更新/持久化：setDreamButtonPlatformName的具体业务逻辑。
function setDreamButtonPlatformName(platformName) {
  const normalized = String(platformName || '').trim();
  if (!normalized) return;
  currentPlatformName = normalized;
  const dreamBtn = safeGetEl('open-dream-page-btn');
  if (dreamBtn) {
    dreamBtn.textContent = `一键启动 ${normalized}AI`;
  }
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
}

// 设置/更新/持久化：updateButtonStatesBasedOnConnection的具体业务逻辑。
function updateButtonStatesBasedOnConnection(connected) {
  if (connected) {
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

// 设置/更新/持久化：updateConnectionStatus的具体业务逻辑。
function updateConnectionStatus(data) {
  try {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) {
      return;
    }

    const { status, message } = data;
    statusEl.classList.remove('status-connecting', 'status-connected', 'status-disconnected', 'status-http');

    switch (status) {
      case 'connecting':
        statusEl.classList.add('status-connecting');
        statusEl.innerHTML = '<span class="status-dot"></span>服务器连接中...';
        break;
      case 'connected':
        statusEl.classList.add('status-connected');
        statusEl.innerHTML = '<span class="status-dot"></span>网络状态良好';
        updateButtonStatesBasedOnConnection(true);
        if (window.__autoStartVpnLoading === true && window.MessageModal && typeof window.MessageModal.hideLoadingMessage === 'function') {
          window.__autoStartVpnLoading = false;
          window.MessageModal.hideLoadingMessage();
        }
        break;
      case 'http':
        statusEl.classList.add('status-http');
        statusEl.innerHTML = '<span class="status-dot"></span>' + (message || '网络兼容模式');
        updateButtonStatesBasedOnConnection(true);
        if (window.__autoStartVpnLoading === true && window.MessageModal && typeof window.MessageModal.hideLoadingMessage === 'function') {
          window.__autoStartVpnLoading = false;
          window.MessageModal.hideLoadingMessage();
        }
        break;
      case 'disconnected':
        statusEl.classList.add('status-disconnected');
        statusEl.innerHTML = '<span class="status-dot"></span>' + (message || '服务器已断开');
        updateButtonStatesBasedOnConnection(false);
        if (window.__autoStartVpnLoading === true && window.MessageModal && typeof window.MessageModal.hideLoadingMessage === 'function') {
          window.__autoStartVpnLoading = false;
          window.MessageModal.hideLoadingMessage();
        }
        break;
      default:
        statusEl.classList.add('status-disconnected');
        statusEl.innerHTML = '<span class="status-dot"></span>' + (message || '未知状态');
        updateButtonStatesBasedOnConnection(false);
        if (window.__autoStartVpnLoading === true && window.MessageModal && typeof window.MessageModal.hideLoadingMessage === 'function') {
          window.__autoStartVpnLoading = false;
          window.MessageModal.hideLoadingMessage();
        }
    }
  } catch (e) {
    console.warn('[侧边栏] 更新TCP连接状态失败:', e);
  }
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

// 设置/更新/持久化：applyConnectionState的具体业务逻辑。
function applyConnectionState(result) {
  if (result && result.status) {
    updateConnectionStatus(result);
    updateButtonStatesBasedOnConnection(result.status === 'connected' || result.status === 'http');
  } else {
    updateButtonStatesBasedOnConnection(false);
  }
}

// 渲染/刷新：refreshConnectionState的具体业务逻辑。
async function refreshConnectionState() {
  try {
    const result = await window.electronAPI.invoke('get-connection-status');
    applyConnectionState(result);
    return result;
  } catch (_) {
    applyConnectionState(null);
    return null;
  }
}

// 同步/连接：bindRuntimeValueListeners的具体业务逻辑。
function bindRuntimeValueListeners() {
  window.electronAPI.on('platform-name-updated', (data) => {
    try {
      const platformName = data && data.platformName;
      if (!platformName) return;
      setDreamButtonPlatformName(platformName);
      void refreshTutorialUrl();
    } catch (e) {
      console.warn('[侧边栏] 处理平台名称更新事件失败:', e?.message || e);
    }
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

  window.electronAPI.on('connection-status', (data) => {
    updateConnectionStatus(data);
    if (data && (data.status === 'connected' || data.status === 'http')) {
      refreshPlatformName()
        .then(() => refreshTutorialUrl())
        .catch((e) => console.warn('[侧边栏] 连接后刷新平台名称失败:', e?.message || e));
    }
  });

  window.electronAPI.on('active-zoom', () => {});
}

// 获取/读取/解析：loadInitialConnectionState的具体业务逻辑。
function loadInitialConnectionState() {
  setTimeout(() => {
    void refreshConnectionState();
  }, 500);
}

// 获取/读取/解析：loadInitialRuntimeValues的具体业务逻辑。
function loadInitialRuntimeValues() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return;
  }

  void refreshPlatformName().then(() => refreshTutorialUrl());
  void refreshTargetUrl();
}
