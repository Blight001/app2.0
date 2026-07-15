// 侧边栏 VPN / Clash Mini 相关逻辑
const TextPreviewUtils = window.AiFreeTextPreviewUtils || {};
let proxyTrafficQuotaSnapshot = null;
let backgroundBestRouteSelectionPending = false;

function formatProxyTrafficBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${Math.round(bytes)}B`;
}

function renderProxyTrafficQuota(quota) {
  const normalized = window.AiFreeQuotaDisplay?.normalizeTrafficQuota?.(quota) || quota;
  proxyTrafficQuotaSnapshot = normalized && typeof normalized === 'object' ? normalized : null;
  if (typeof renderAccountProxyTrafficUsage === 'function') {
    renderAccountProxyTrafficUsage(proxyTrafficQuotaSnapshot);
  }
  if (vpnSwitchBtn) {
    vpnSwitchBtn.textContent = isVpnEnabled ? '关闭网络魔法' : '开启网络魔法';
    vpnSwitchBtn.title = isVpnEnabled ? '点击关闭网络魔法' : '点击开启网络魔法';
  }
}
const decodeBase64Preview = TextPreviewUtils.decodeBase64Preview || (() => '');
const previewText = TextPreviewUtils.previewText || ((value, maxLen = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
});

// 设置/更新/持久化：setVpnNodeSelectorOpen的具体业务逻辑。
function setVpnNodeSelectorOpen(open, { force = false } = {}) {
  const triggerBtn = vpnNodeSelectorToggleBtn;
  if (!triggerBtn || !vpnNodeSelectorPanel) return;
  const shouldOpen = !!open && (force || !triggerBtn.disabled);
  if (shouldOpen) {
    if (vpnNodeSelectorHideTimer) {
      clearTimeout(vpnNodeSelectorHideTimer);
      vpnNodeSelectorHideTimer = null;
    }
    vpnNodeSelectorPanel.hidden = false;
    requestAnimationFrame(() => {
      vpnNodeSelectorPanel.classList.add('is-open');
    });
    triggerBtn.setAttribute('aria-expanded', 'true');
    return;
  }

  triggerBtn.setAttribute('aria-expanded', 'false');
  vpnNodeSelectorPanel.classList.remove('is-open');
  vpnNodeSelectorHideTimer = setTimeout(() => {
    if (vpnNodeSelectorPanel && !vpnNodeSelectorPanel.classList.contains('is-open')) {
      vpnNodeSelectorPanel.hidden = true;
    }
  }, 220);
}

function setVpnNodeSelectorButtonsDisabled(disabled) {
  const nextDisabled = !!disabled;
  if (testLatencyBtn) {
    testLatencyBtn.disabled = nextDisabled;
  }
  if (vpnNodeSelectorToggleBtn) {
    vpnNodeSelectorToggleBtn.disabled = nextDisabled;
  }
}

// 校验/保护：canUseVpnFeatures的具体业务逻辑。
function canUseVpnFeatures() {
  return isVpnEnabled === true && isLicenseValidated();
}

// 网络魔法启动流程（含启动后的后台自动选路）是否仍在进行。
// 主进程在启动过程中会持续推送 clash-mini-status，核心刚拉起时
// running 已经是 true，但后台选路还没接管；若不把“流程进行中”本身
// 纳入判定，这个窗口里选路按钮会被放开一瞬，用户点击就会干扰启动。
function isNetworkMagicStartFlowActive() {
  return clashMiniStartFlowPromise !== null
    || backgroundBestRouteSelectionPending
    || autoStartClashMiniInFlight;
}

// “检测最优路线 / 手动选择路线”可用性的唯一出口：所有状态事件、
// 外部批量启停按钮之后都应经由本函数收敛，不要在别处直接改 disabled。
function applyVpnActionAvailability() {
  if (sideButtonLockSnapshot) {
    // 面板整体锁定期间强制禁用，防止外部 setButtonsDisabled('.VPN-btn', false) 穿透锁。
    setVpnNodeSelectorButtonsDisabled(true);
    return;
  }
  const canUse = canUseVpnFeatures();
  const disabled = !canUse || vpnNodeSelectorBusy || isNetworkMagicStartFlowActive();
  setVpnNodeSelectorButtonsDisabled(disabled);

  if (testLatencyBtn) {
    testLatencyBtn.title = !isLicenseValidated()
      ? '请先完成验证'
      : !isVpnEnabled
        ? '请先开启网络魔法'
        : '测试并切换到最低延时节点';
  }
}

// 测速/后台选路期间锁定网络工具面板。
// “一键启动 XX”羊毛平台按钮不参与锁定：测速只影响代理节点切换，
// 不应阻塞用户正常打开平台页面（其可用性仍由卡密验证与额度状态控制）。
function lockSidePanelButtons() {
  if (sideButtonLockSnapshot) return;
  const panel = document.querySelector('.settings-network-tools') || document.getElementById('side-panel');
  if (!panel) return;
  const buttons = Array.from(panel.querySelectorAll('button'))
    .filter((button) => !button.classList.contains('open-wool-platform-btn'));
  sideButtonLockSnapshot = buttons.map((button) => ({
    button,
    disabled: button.disabled,
  }));
  buttons.forEach((button) => {
    button.disabled = true;
  });
}

// 锁定期间其他模块可能批量启用按钮（如验证通过后的 enableAllLicenseRequiredButtons
// 会放开所有 .VPN-btn），用快照把锁重新压回去，避免锁被穿透。
function reassertSidePanelLock() {
  if (!sideButtonLockSnapshot) return;
  sideButtonLockSnapshot.forEach((entry) => {
    if (entry?.button) {
      entry.button.disabled = true;
    }
  });
}

// 处理：unlockSidePanelButtons的具体业务逻辑。
function unlockSidePanelButtons() {
  if (!sideButtonLockSnapshot) return;
  sideButtonLockSnapshot.forEach((entry) => {
    if (entry?.button) {
      entry.button.disabled = entry.disabled;
    }
  });
  sideButtonLockSnapshot = null;
  syncLatencyButtonState();
  syncVpnNodeSelectorState();
}

// 格式化/规范化：normalizeProxyEntries的具体业务逻辑。
function normalizeProxyEntries(entries, currentName) {
  const selectedName = String(currentName || '').trim();
  const list = Array.isArray(entries) ? entries : [];
  return list.map((item) => {
    const name = String(item?.name || '').trim();
    const delay = Number(item?.delay);
    const hasDelay = Number.isFinite(delay) && delay > 0;
    return {
      name,
      delay: hasDelay ? delay : null,
      delayText: String(item?.delayText || (item?.error ? '超时' : (hasDelay ? `${Math.round(delay)}ms` : '测速中...'))),
      selected: name === selectedName,
    };
  }).filter((item) => item.name);
}

// 同步/连接：mergeProxyEntriesWithPrevious的具体业务逻辑。
function mergeProxyEntriesWithPrevious(entries, previousEntries, currentName) {
  const nextList = Array.isArray(entries) ? entries : [];
  const previousList = Array.isArray(previousEntries) ? previousEntries : [];
  const previousMap = new Map(
    previousList
      .map((item) => [String(item?.name || '').trim(), item])
      .filter(([name]) => !!name),
  );

  return nextList.map((item) => {
    const name = String(item?.name || '').trim();
    const previous = previousMap.get(name) || {};
    const nextDelay = Number(item?.delay);
    const hasNextDelay = Number.isFinite(nextDelay) && nextDelay > 0;
    const previousDelay = Number(previous?.delay);
    const hasPreviousDelay = Number.isFinite(previousDelay) && previousDelay > 0;
    const hasDelay = hasNextDelay || hasPreviousDelay;
    const delay = hasNextDelay ? nextDelay : (hasPreviousDelay ? previousDelay : null);
    return {
      name,
      delay,
      delayText: String(
        item?.delayText
        || previous?.delayText
        || (item?.error || previous?.error ? '超时' : (hasDelay ? `${Math.round(delay)}ms` : '测速中...')),
      ),
      selected: name === String(currentName || '').trim(),
    };
  }).filter((item) => item.name);
}

// 获取/读取/解析：getVpnNodeSelectorNames的具体业务逻辑。
function getVpnNodeSelectorNames() {
  return Array.isArray(clashMiniProxyState.names) && clashMiniProxyState.names.length > 0
    ? clashMiniProxyState.names
    : (Array.isArray(clashMiniProxyState.proxies)
      ? Array.from(new Set(clashMiniProxyState.proxies.map((item) => String(item?.name || '').trim()).filter(Boolean)))
      : []);
}

// 创建/初始化：buildVpnNodeSelectorNamesKey的具体业务逻辑。
function buildVpnNodeSelectorNamesKey(names) {
  return Array.isArray(names) ? names.join('\u0001') : '';
}

// 获取/读取/解析：getProxyItemByName的具体业务逻辑。
function getProxyItemByName(name) {
  const list = Array.isArray(clashMiniProxyState.proxies) ? clashMiniProxyState.proxies : [];
  return list.find((item) => String(item?.name || '').trim() === String(name || '').trim()) || {};
}

// 获取/读取/解析：getVpnNodeSelectorSelectedName的具体业务逻辑。
function getVpnNodeSelectorSelectedName() {
  const current = String(clashMiniProxyState.current || '').trim();
  if (current) return current;
  const selectedProxy = Array.isArray(clashMiniProxyState.proxies)
    ? clashMiniProxyState.proxies.find((item) => item && item.selected === true)
    : null;
  return String(selectedProxy?.name || '').trim();
}

// 获取/读取/解析：getVpnDelayColor的具体业务逻辑。
function getVpnDelayColor(delay, hasDelay) {
  if (!hasDelay) {
    return 'hsl(0, 100%, 50%)';
  }

  const value = Math.max(0, Number(delay) || 0);
  if (value <= 300) {
    const ratio = value / 300;
    const hue = 120 - (ratio * 60);
    return `hsl(${hue}, 100%, 50%)`;
  }

  const ratio = Math.min(1, (value - 300) / 300);
  const hue = 60 - (ratio * 60);
  return `hsl(${hue}, 100%, 50%)`;
}

// 获取/读取/解析：getVpnDelayBackground的具体业务逻辑。
function getVpnDelayBackground(delay, hasDelay) {
  if (!hasDelay) {
    return {
      background: 'hsla(0, 100%, 50%, 0.16)',
      backgroundSelected: 'hsla(0, 100%, 50%, 0.28)',
    };
  }

  const value = Math.max(0, Number(delay) || 0);
  let hue;
  if (value <= 300) {
    const ratio = value / 300;
    hue = 120 - (ratio * 60);
  } else {
    const ratio = Math.min(1, (value - 300) / 300);
    hue = 60 - (ratio * 60);
  }

  return {
    background: `hsla(${hue}, 100%, 50%, 0.18)`,
    backgroundSelected: `hsla(${hue}, 100%, 50%, 0.30)`,
  };
}

// 设置/更新/持久化：updateVpnNodeSelectorButton的具体业务逻辑。
function updateVpnNodeSelectorButton(button, name, index, proxyItem, selectedName) {
  if (!button) return;
  const rawDelay = Number(proxyItem.delay);
  const hasDelay = Number.isFinite(rawDelay) && rawDelay > 0;
  const delayText = String(proxyItem.delayText || (hasDelay ? `${Math.round(rawDelay)}ms` : '测速中...'));
  const delayColor = getVpnDelayColor(rawDelay, hasDelay);
  const delayBackground = getVpnDelayBackground(rawDelay, hasDelay);
  const isSelected = String(name || '').trim() === String(selectedName || '').trim();

  button.className = `vpn-node-option${isSelected ? ' is-selected' : ''}`;
  // 测速/选路期间面板会被重建或增量渲染，新按钮也要继承禁用状态。
  button.disabled = vpnNodeSelectorBusy === true || backgroundBestRouteSelectionPending === true;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  button.style.animationDelay = `${Math.min(index, 8) * 45}ms`;
  button.dataset.nodeName = name;
  button.style.setProperty('--vpn-delay-bg', delayBackground.background);
  button.style.setProperty('--vpn-delay-bg-selected', delayBackground.backgroundSelected);

  const metaEl = button.querySelector('.vpn-node-option-meta');
  if (metaEl) {
    metaEl.className = 'vpn-node-option-meta';
    metaEl.style.color = delayColor;
    metaEl.textContent = delayText;
  }
}

// 创建/初始化：buildVpnNodeSelectorButton的具体业务逻辑。
function buildVpnNodeSelectorButton(name, index, proxyItem, selectedName) {
  const button = document.createElement('button');
  button.type = 'button';
  updateVpnNodeSelectorButton(button, name, index, proxyItem, selectedName);

  const main = document.createElement('div');
  main.className = 'vpn-node-option-main';
  const nameEl = document.createElement('div');
  nameEl.className = 'vpn-node-option-name';
  nameEl.textContent = name;
  const metaEl = document.createElement('div');
  metaEl.className = 'vpn-node-option-meta';
  main.append(nameEl, metaEl);
  const checkEl = document.createElement('span');
  checkEl.className = 'vpn-node-option-check';
  checkEl.setAttribute('aria-hidden', 'true');
  button.append(main, checkEl);

  button.addEventListener('click', async () => {
    if (isNetworkMagicStartFlowActive() || vpnNodeSelectorBusy || !window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
      return;
    }

    const currentName = String(clashMiniProxyState.current || '').trim();
    const groupName = String(clashMiniProxyState.groupName || '节点选择').trim() || '节点选择';
    const nodeName = String(name || '').trim();
    if (!nodeName || nodeName === currentName) {
      setVpnNodeSelectorOpen(false);
      return;
    }

    setVpnNodeSelectorBusy(true);
    try {
      const result = await window.electronAPI.invoke('switch-clash-mini-proxy', {
        groupName,
        nodeName,
      });
      if (!result || result.ok !== true) {
        throw new Error((result && (result.error || result.message)) || '切换节点失败');
      }

      clashMiniProxyState.current = String(result.current || result.name || nodeName).trim();
      clashMiniProxyState.proxies = normalizeProxyEntries(clashMiniProxyState.proxies, clashMiniProxyState.current);
      syncVpnNodeSelectorState();
      scheduleVpnNodeSelectorRender({ forceFull: true });
      setVpnNodeSelectorOpen(false);

      if (window.MessageModal && typeof window.MessageModal.showSuccessMessage === 'function') {
        window.MessageModal.showSuccessMessage(`已切换到节点：${clashMiniProxyState.current}`);
      }
    } catch (error) {
      if (window.MessageModal && typeof window.MessageModal.showErrorMessage === 'function') {
        window.MessageModal.showErrorMessage(error?.message || String(error));
      }
    } finally {
      setVpnNodeSelectorBusy(false);
    }
  });

  return button;
}

// 处理：scheduleVpnNodeSelectorRender的具体业务逻辑。
function scheduleVpnNodeSelectorRender({ forceFull = false } = {}) {
  if (!vpnNodeSelectorGrid) return;
  if (forceFull) {
    vpnNodeSelectorRenderedNamesKey = '';
  }
  if (vpnNodeSelectorRenderScheduled) return;
  vpnNodeSelectorRenderScheduled = true;
  vpnNodeSelectorRenderRaf = requestAnimationFrame(() => {
    vpnNodeSelectorRenderScheduled = false;
    vpnNodeSelectorRenderRaf = null;
    renderVpnNodeSelectorOptions();
  });
}

const clashMiniConfigPreheatState = {
  signature: '',
  promise: null,
  result: null,
};

const clashMiniWarmupState = {
  promise: null,
};

let autoStartClashMiniInFlight = false;
let clashMiniStartFlowPromise = null;
let vpnNodeSelectorRenderScheduled = false;
let vpnNodeSelectorRenderRaf = null;
let vpnNodeSelectorOptionNodes = new Map();
let vpnNodeSelectorRenderedNamesKey = '';

// 获取/读取/解析：getClashMiniConfigSignature的具体业务逻辑。
function getClashMiniConfigSignature(key, deviceId) {
  return `${String(key || '').trim()}::${String(deviceId || '').trim()}`;
}

// 获取/读取/解析：resolveClashMiniCredentialsSnapshot的具体业务逻辑。
async function resolveClashMiniCredentialsSnapshot({ key = '', deviceId = '' } = {}) {
  let nextKey = String(key || '').trim();
  let nextDeviceId = String(deviceId || '').trim();

  if (!nextKey || !nextDeviceId) {
    const credentialsResp = await window.electronAPI.invoke('get-user-credentials').catch(() => null);
    const credentials = credentialsResp && credentialsResp.ok === true && credentialsResp.credentials
      ? credentialsResp.credentials
      : {};

    if (!nextKey) {
      nextKey = String(
        safeGetEl('key-input')?.value
        || credentials.key
        || globalCurrentKey
        || '',
      ).trim();
    }

    if (!nextDeviceId) {
      nextDeviceId = String(
        safeGetEl('device-id')?.value
        || credentials.deviceId
        || globalCurrentDeviceId
        || '',
      ).trim();
    }
  }

  if (!nextDeviceId && window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    const deviceIdResp = await window.electronAPI.invoke('license-get-device-id').catch(() => null);
    nextDeviceId = String(deviceIdResp || '').trim();
  }

  return {
    key: nextKey,
    deviceId: nextDeviceId,
  };
}

// 同步/连接：syncClashMiniConfigFromServer的具体业务逻辑。
async function syncClashMiniConfigFromServer(options = {}) {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    throw new Error('当前环境不支持获取 Clash 配置');
  }

  const { key, deviceId } = await resolveClashMiniCredentialsSnapshot(options);

  if (!key || !deviceId) {
    throw new Error('账号未登录或缺少设备号，无法获取 Clash 配置');
  }

  console.log('[侧边栏][Clash] 开始获取客户端配置...');
  const clashResp = await window.electronAPI.invoke('get-clash-config', { key, deviceId });
  if (!clashResp || clashResp.ok !== true) {
    throw new Error((clashResp && (clashResp.error || clashResp.message)) || '获取客户端配置失败');
  }

  console.log('[侧边栏][Clash] 已获取客户端配置，开始导入...');
  const configContent = String(clashResp.content || clashResp.configContent || '').trim();
  const subscriptionUrl = String(clashResp.proxySubscriptionUrl || '').trim();
  const importContent = configContent || '';
  const importSource = configContent ? 'content' : 'empty';
  console.log('[侧边栏][Clash] 客户端配置摘要:', JSON.stringify({
    ok: !!clashResp.ok,
    proxySubscriptionUrl: subscriptionUrl,
    contentLength: configContent.length,
    contentSource: String(clashResp.contentSource || importSource),
    importSource,
    importPreview: previewText(importContent),
    importDecodedPreview: decodeBase64Preview(importContent),
  }, null, 2));

  const saveResp = await window.electronAPI.invoke('save-clash-config', {
    clashConfig: importContent,
    configContent: importContent,
    content: importContent,
    subscriptionUrl,
  });

  if (!saveResp || saveResp.ok !== true) {
    if (saveResp && saveResp.rawContent) {
      console.error('[侧边栏][Clash] 导入失败时的原始配置内容:');
      console.error(saveResp.rawContent);
    }
    throw new Error((saveResp && (saveResp.error || saveResp.message)) || '导入 Clash 配置失败');
  }

  console.log('[侧边栏][Clash] Clash 配置已同步到本地运行目录');
  return {
    key,
    deviceId,
    clashResp,
    saveResp,
  };
}

// 校验/保护：ensureClashMiniConfigPreheated的具体业务逻辑。
async function ensureClashMiniConfigPreheated(options = {}) {
  const { key, deviceId } = await resolveClashMiniCredentialsSnapshot(options);
  if (!key || !deviceId) {
    throw new Error('账号未登录或缺少设备号，无法预热 Clash 配置');
  }

  const signature = getClashMiniConfigSignature(key, deviceId);
  const force = options.force === true;
  if (force && clashMiniConfigPreheatState.promise) {
    await clashMiniConfigPreheatState.promise.catch(() => {});
  }
  if (!force && clashMiniConfigPreheatState.result && clashMiniConfigPreheatState.signature === signature) {
    return clashMiniConfigPreheatState.result;
  }

  if (!force && clashMiniConfigPreheatState.promise && clashMiniConfigPreheatState.signature === signature) {
    return clashMiniConfigPreheatState.promise;
  }

// 处理：promise的具体业务逻辑。
  const promise = (async () => {
    console.log('[侧边栏][Clash] 开始预热客户端配置...');
    const result = await syncClashMiniConfigFromServer({ key, deviceId });
    clashMiniConfigPreheatState.result = result;
    clashMiniConfigPreheatState.signature = signature;
    return result;
  })();

  clashMiniConfigPreheatState.signature = signature;
  clashMiniConfigPreheatState.promise = promise;

  try {
    return await promise;
  } catch (error) {
    if (clashMiniConfigPreheatState.signature === signature) {
      clashMiniConfigPreheatState.result = null;
      clashMiniConfigPreheatState.signature = '';
    }
    throw error;
  } finally {
    if (clashMiniConfigPreheatState.promise === promise) {
      clashMiniConfigPreheatState.promise = null;
    }
  }
}

// 处理：warmupClashMiniProcess的具体业务逻辑。
async function warmupClashMiniProcess() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return null;
  }
  if (!window.electron || typeof window.electron.startClashMini !== 'function') {
    return null;
  }

  if (clashMiniWarmupState.promise) {
    return clashMiniWarmupState.promise;
  }

// 处理：promise的具体业务逻辑。
  const promise = (async () => {
    try {
      const autoStartEnabled = await getNetworkMagicAutoStartEnabled();
      if (!autoStartEnabled) {
        console.log('[侧边栏][Clash] 已关闭网络魔法记忆，跳过启动期预热...');
        return { ok: true, skipped: true };
      }

      console.log('[侧边栏][Clash] 开始预热 Clash 运行环境，先同步客户端配置，再提前启动代理端口...');
      await ensureClashMiniConfigPreheated();
      return await window.electron.startClashMini();
    } catch (error) {
      console.warn('[侧边栏][Clash] 预热 Clash 运行环境失败:', error?.message || error);
      return { ok: false, error: error?.message || String(error) };
    }
  })();

  clashMiniWarmupState.promise = promise;
  try {
    return await promise;
  } finally {
    if (clashMiniWarmupState.promise === promise) {
      clashMiniWarmupState.promise = null;
    }
  }
}

// 启动/打开/显示：runBestRouteSelection的具体业务逻辑。
async function runBestRouteSelection({
  keepPanelOpen = false,
  showPanel = true,
  refreshOptions = true,
  concurrency,
  reportProgress = true,
} = {}) {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    throw new Error('当前环境不支持最低延时测试');
  }
  if (!isVpnEnabled) {
    throw new Error('请先开启网络魔法');
  }

  if (refreshOptions) {
    await loadVpnNodeSelectorOptions({ force: true, probeDelays: false }).catch(() => {});
  }
  if (showPanel) {
    setVpnNodeSelectorOpen(true, { force: true });
  }

  const result = await window.electronAPI.invoke('test-min-latency', {
    names: Array.isArray(clashMiniProxyState.names) ? clashMiniProxyState.names : [],
    concurrency,
    reportProgress,
  });
  if (!result || result.ok !== true) {
    throw new Error((result && (result.error || result.message)) || '最低延时测试失败');
  }

  const bestName = String(result.bestName || result?.best?.name || '').trim();
  const bestDelay = Number(result.bestDelay ?? result?.best?.delay);

  if (bestName) {
    clashMiniProxyState.current = bestName;
    clashMiniProxyState.names = Array.isArray(result.entries)
      ? Array.from(new Set(result.entries.map((item) => String(item?.name || '').trim()).filter(Boolean)))
      : clashMiniProxyState.names;
    clashMiniProxyState.proxies = normalizeProxyEntries(result.entries, bestName);
    const bestEntry = clashMiniProxyState.proxies.find((item) => item.name === bestName);
    if (bestEntry && Number.isFinite(bestDelay) && bestDelay > 0) {
      bestEntry.delay = bestDelay;
      bestEntry.delayText = `${Math.round(bestDelay)}ms`;
      bestEntry.selected = true;
    }
    syncVpnNodeSelectorState();
    scheduleVpnNodeSelectorRender({ forceFull: true });
  }

  if (keepPanelOpen && showPanel) {
    setVpnNodeSelectorOpen(true);
  } else if (!showPanel) {
    setVpnNodeSelectorOpen(false);
  }

  return { bestName, bestDelay, result };
}

// 设置/更新/持久化：setVpnNodeSelectorBusy的具体业务逻辑。
function setVpnNodeSelectorBusy(busy) {
  vpnNodeSelectorBusy = busy === true;
  applyVpnActionAvailability();
  if (vpnNodeSelectorGrid) {
    vpnNodeSelectorGrid.classList.toggle('is-busy', vpnNodeSelectorBusy);
    vpnNodeSelectorGrid.querySelectorAll('button').forEach((button) => {
      button.disabled = vpnNodeSelectorBusy;
    });
  }
}

// 同步/连接：syncVpnNodeSelectorState的具体业务逻辑。
function syncVpnNodeSelectorState() {
  if (!testLatencyBtn || !vpnNodeSelectorPanel) return;
  const enabled = canUseVpnFeatures();
  applyVpnActionAvailability();
  if (!enabled) {
    setVpnNodeSelectorOpen(false);
    vpnNodeSelectorPanel.hidden = true;
    return;
  }

  if (vpnNodeSelectorGroup) {
    vpnNodeSelectorGroup.textContent = String(clashMiniProxyState.groupName || '节点选择').trim() || '节点选择';
  }
}

// 渲染/刷新：renderVpnNodeSelectorOptions的具体业务逻辑。
function renderVpnNodeSelectorOptions() {
  if (!vpnNodeSelectorGrid) return;

  const names = getVpnNodeSelectorNames();
  const namesKey = buildVpnNodeSelectorNamesKey(names);
  const selectedName = getVpnNodeSelectorSelectedName();

  if (names.length === 0) {
    vpnNodeSelectorOptionNodes.clear();
    vpnNodeSelectorRenderedNamesKey = '';
    vpnNodeSelectorGrid.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'vpn-node-option';
    empty.style.gridColumn = '1 / -1';
    empty.style.cursor = 'default';
    empty.setAttribute('aria-checked', 'false');
    const main = document.createElement('div');
    main.className = 'vpn-node-option-main';
    const nameEl = document.createElement('div');
    nameEl.className = 'vpn-node-option-name';
    nameEl.textContent = '暂无可用节点';
    const metaEl = document.createElement('div');
    metaEl.className = 'vpn-node-option-meta';
    metaEl.textContent = '请先启动网络魔法';
    main.append(nameEl, metaEl);
    const checkEl = document.createElement('span');
    checkEl.className = 'vpn-node-option-check';
    empty.append(main, checkEl);
    vpnNodeSelectorGrid.appendChild(empty);
    return;
  }

  const needsRebuild = vpnNodeSelectorRenderedNamesKey !== namesKey
    || vpnNodeSelectorGrid.children.length !== names.length;
  if (needsRebuild) {
    vpnNodeSelectorOptionNodes.clear();
    vpnNodeSelectorGrid.innerHTML = '';
    vpnNodeSelectorRenderedNamesKey = namesKey;
    names.forEach((name, index) => {
      const proxyItem = getProxyItemByName(name);
      const button = buildVpnNodeSelectorButton(name, index, proxyItem, selectedName);
      vpnNodeSelectorOptionNodes.set(name, button);
      vpnNodeSelectorGrid.appendChild(button);
    });
    return;
  }

  names.forEach((name, index) => {
    const proxyItem = getProxyItemByName(name);
    let button = vpnNodeSelectorOptionNodes.get(name);
    if (!button || !vpnNodeSelectorGrid.contains(button)) {
      button = buildVpnNodeSelectorButton(name, index, proxyItem, selectedName);
      vpnNodeSelectorOptionNodes.set(name, button);
      vpnNodeSelectorGrid.appendChild(button);
      return;
    }
    updateVpnNodeSelectorButton(button, name, index, proxyItem, selectedName);
  });
}

// 设置/更新/持久化：applyClashMiniLatencyProgress的具体业务逻辑。
function applyClashMiniLatencyProgress(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.groupName && String(payload.groupName).trim() !== String(clashMiniProxyState.groupName || '').trim()) {
    return;
  }

  const nextBestName = String(payload.bestName || '').trim();
  const nextBestDelay = Number(payload.bestDelay);
  const hasBest = nextBestName && Number.isFinite(nextBestDelay) && nextBestDelay > 0;

  if (!Array.isArray(clashMiniProxyState.proxies) || clashMiniProxyState.proxies.length === 0) {
    clashMiniProxyState.proxies = [];
  }

  if (payload.phase === 'done' && Array.isArray(payload.entries) && payload.entries.length > 0) {
    clashMiniProxyState.proxies = normalizeProxyEntries(payload.entries, nextBestName || clashMiniProxyState.current);
    syncVpnNodeSelectorState();
    scheduleVpnNodeSelectorRender({ forceFull: true });
    return;
  }

  const index = Number(payload.index);
  const hasIndex = Number.isInteger(index) && index >= 0;
  const entryName = String(payload.name || '').trim();
  const targetIndex = hasIndex && clashMiniProxyState.proxies[index]
    ? index
    : clashMiniProxyState.proxies.findIndex((item) => String(item?.name || '').trim() === entryName);

  if (targetIndex >= 0 && clashMiniProxyState.proxies[targetIndex]) {
    const nextDelay = Number(payload.delay);
    const hasDelay = Number.isFinite(nextDelay) && nextDelay > 0;
    clashMiniProxyState.proxies[targetIndex] = {
      ...clashMiniProxyState.proxies[targetIndex],
      delay: hasDelay ? nextDelay : null,
      delayText: hasDelay
        ? `${Math.round(nextDelay)}ms`
        : String(payload.error || clashMiniProxyState.proxies[targetIndex].delayText || '测速中...'),
      selected: hasBest && String(clashMiniProxyState.proxies[targetIndex].name || '').trim() === nextBestName,
    };
  }

  if (hasBest) {
    clashMiniProxyState.current = nextBestName;
    clashMiniProxyState.proxies = clashMiniProxyState.proxies.map((item) => ({
      ...item,
      selected: String(item?.name || '').trim() === nextBestName,
    }));
  }

  syncVpnNodeSelectorState();
  scheduleVpnNodeSelectorRender();
}

// 获取/读取/解析：loadVpnNodeSelectorOptions的具体业务逻辑。
async function loadVpnNodeSelectorOptions({ force = false, probeDelays = true } = {}) {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') return null;
  if (!force && !isVpnEnabled) return null;
  if (vpnNodeSelectorBusy) return null;

  try {
    const result = await window.electronAPI.invoke('get-clash-mini-proxy-options', {
      includeDelays: probeDelays === true,
    });
    if (!result || result.ok !== true) {
      clashMiniProxyState = {
        groupName: String(result?.groupName || '节点选择').trim() || '节点选择',
        current: '',
        names: [],
        proxies: [],
      };
      syncVpnNodeSelectorState();
      scheduleVpnNodeSelectorRender({ forceFull: true });
      return result;
    }

    clashMiniProxyState = {
      groupName: String(result.groupName || '节点选择').trim() || '节点选择',
      current: String(result.current || '').trim(),
      names: Array.isArray(result.names) && result.names.length > 0
        ? result.names
        : (Array.isArray(result.proxies)
          ? Array.from(new Set(result.proxies.map((item) => String(item?.name || '').trim()).filter(Boolean)))
          : []),
      proxies: probeDelays
        ? Array.isArray(result.proxies) ? result.proxies : []
        : mergeProxyEntriesWithPrevious(result.proxies, clashMiniProxyState.proxies, String(result.current || '').trim()),
    };

    syncVpnNodeSelectorState();
    scheduleVpnNodeSelectorRender({ forceFull: true });
    return result;
  } catch (error) {
    console.warn('[侧边栏] 获取节点列表失败:', error?.message || error);
    return null;
  }
}

// 供外部模块（connection-sync 等）在批量启停按钮后调用，收敛选路按钮状态。
function syncLatencyButtonState() {
  if (!testLatencyBtn) return;
  if (sideButtonLockSnapshot) {
    // 面板锁定期间外部批量启用不得生效，把快照内按钮重新压回禁用。
    reassertSidePanelLock();
    return;
  }
  if (testLatencyBtn.dataset.busy === '1' && canUseVpnFeatures()) {
    // withBusyButton 正在接管测速按钮，等它收尾后再统一恢复。
    return;
  }
  applyVpnActionAvailability();
  syncVpnNodeSelectorState();
}

// 设置/更新/持久化：applyClashMiniStatus的具体业务逻辑。
function applyClashMiniStatus(status, { startBtn, vpnBtn, loadProxyOptions = true } = {}) {
  try {
    const wasRunning = isVpnEnabled === true;
    const running = status && status.running === true;
    const enabled = status && (
      status.running === true
      || status.enabled === true
      || status.proxyAppliedByApp === true
    );
    const isBusy = !!(
      (startBtn && startBtn.dataset.busy === '1')
      || (vpnBtn && vpnBtn.dataset.busy === '1')
    );
    isVpnEnabled = enabled;
    if (startBtn) {
      startBtn.textContent = running ? 'Clash Mini 运行中' : '启动 Clash Mini';
      startBtn.title = running
        ? (enabled ? 'Clash Mini 已启动，点击后会再次尝试启动' : 'Clash Mini 已启动，但网络魔法未开启')
        : '点击启动 Clash Mini 代理模块';
      startBtn.disabled = running || isBusy;
    }
    if (vpnBtn) {
      vpnBtn.textContent = enabled ? '关闭网络魔法' : '开启网络魔法';
      vpnBtn.title = enabled ? '点击关闭网络魔法' : '点击开启网络魔法';
      if (isBusy) {
        vpnBtn.disabled = true;
      }
    }
    syncLatencyButtonState();
    syncVpnNodeSelectorState();
    if (typeof syncLoggedOutProtectedEntryAvailability === 'function') {
      syncLoggedOutProtectedEntryAvailability();
    }
    if (enabled && !wasRunning && loadProxyOptions) {
      loadVpnNodeSelectorOptions({ force: true, probeDelays: false }).catch(() => {});
    } else if (!enabled && wasRunning) {
      clashMiniProxyState.current = '';
      clashMiniProxyState.names = [];
      clashMiniProxyState.proxies = [];
      syncVpnNodeSelectorState();
      scheduleVpnNodeSelectorRender({ forceFull: true });
    }
  } catch (_) {}
}

// 启动成功后调度后台自动选路。必须在创建定时器之前同步置位
// backgroundBestRouteSelectionPending：状态事件和按钮 busy 收尾即使随后到达，
// applyVpnActionAvailability 也不会产生一帧可点击的空窗。
function scheduleBestRouteSelection() {
  if (backgroundBestRouteSelectionPending) return;
  backgroundBestRouteSelectionPending = true;
  applyVpnActionAvailability();
  // setTimeout(0)：等启动按钮 withBusyButton 的收尾（微任务）先执行完，
  // 再对面板做整体快照锁定，否则快照会把“忙碌中”的禁用状态当成原始状态。
  setTimeout(() => {
    void runBackgroundBestRouteSelection();
  }, 0);
}

// 后台自动选路：从准备阶段起锁定网络工具面板（开关、手动选路、测速均不可操作，
// “一键启动”平台按钮除外），结束后统一解锁并恢复各按钮应有状态。
async function runBackgroundBestRouteSelection() {
  lockSidePanelButtons();
  try {
    // 给刚完成重启的 Chromium 留出短暂稳定时间；等待期间按钮保持锁定。
    await new Promise((resolve) => setTimeout(resolve, 500));
    await loadVpnNodeSelectorOptions({ force: true, probeDelays: false }).catch(() => {});
    setVpnNodeSelectorBusy(true);
    await runBestRouteSelection({
      keepPanelOpen: true,
      showPanel: true,
      refreshOptions: false,
      concurrency: 4,
      reportProgress: true,
    });
  } catch (error) {
    console.warn('[侧边栏][Clash] 后台自动选路失败，保留当前节点:', error?.message || error);
  } finally {
    setVpnNodeSelectorBusy(false);
    backgroundBestRouteSelectionPending = false;
    unlockSidePanelButtons();
  }
}

// 获取/读取/解析：getNetworkMagicAutoStartEnabled的具体业务逻辑。
async function getNetworkMagicAutoStartEnabled() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return true;
  }
  try {
    const result = await window.electronAPI.invoke('get-network-magic-auto-start-enabled');
    if (result && result.ok === true && typeof result.enabled === 'boolean') {
      return result.enabled;
    }
  } catch (_) {}
  return true;
}

// 设置/更新/持久化：persistNetworkMagicAutoStartEnabled的具体业务逻辑。
async function persistNetworkMagicAutoStartEnabled(enabled) {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return { ok: false };
  }
  return window.electronAPI.invoke('set-network-magic-auto-start-enabled', { enabled: !!enabled });
}

// 停止/关闭/清理：stopClashMiniFlow的具体业务逻辑。
async function stopClashMiniFlow({ startBtn, vpnBtn } = {}) {
  if (typeof window.electron.stopClashMini !== 'function') {
    throw new Error('当前环境不支持停止 Clash Mini');
  }
  const result = await window.electron.stopClashMini();
  if (!result || result.ok !== true) {
    throw new Error((result && (result.error || result.message)) || '关闭网络魔法失败');
  }
  await persistNetworkMagicAutoStartEnabled(false).catch(() => {});
  applyClashMiniStatus(result, { startBtn, vpnBtn });
  return '开启网络魔法';
}

// 完整启动流程（单次执行体，勿直接调用，统一走 startClashMiniFlow）：
//  1. 需要刷新配置且核心已在运行时，先停掉旧进程；
//  2. 拉取并导入服务器最新 Clash 配置（手动开启时强制刷新）；
//  3. 启动核心、应用浏览器代理；
//  4. 记忆“自动启动”偏好；
//  5. 调度后台自动选路（不阻塞“启动中”按钮，最慢节点的超时不占用开关）；
//  6. 把最终状态应用到按钮 UI。
async function startClashMiniFlowOnce({ startBtn, vpnBtn, fetchConfig = true } = {}) {
  if (typeof window.electron.startClashMini !== 'function') {
    throw new Error('当前环境不支持启动 Clash Mini');
  }

  const currentStatus = window.electron.getClashMiniStatus
    ? await window.electron.getClashMiniStatus().catch(() => null)
    : null;
  const shouldRestartForFreshConfig = fetchConfig && currentStatus && currentStatus.running === true;
  if (shouldRestartForFreshConfig && typeof window.electron.stopClashMini === 'function') {
    const stopResult = await window.electron.stopClashMini().catch((error) => ({ ok: false, error: error?.message || String(error) }));
    if (!stopResult || stopResult.ok !== true) {
      throw new Error((stopResult && (stopResult.error || stopResult.message)) || '重启网络魔法前停止当前进程失败');
    }
  }

  if (fetchConfig) {
    // 手动点击“开启网络魔法”必须以服务器当前配置为准。即使启动期已经
    // 预热过相同账号，也重新请求并导入一次，save-clash-config 会清理
    // 旧运行配置后覆盖 config.yaml。
    console.log('[侧边栏][Clash] 手动开启网络魔法，强制获取最新 YAML 并覆盖旧配置...');
    await ensureClashMiniConfigPreheated({ force: true });
  }
  const result = await window.electron.startClashMini();
  if (!result || result.ok !== true) {
    const error = new Error((result && (result.error || result.message)) || '启动网络魔法失败');
    if (result?.cancelled === true) {
      error.code = 'CLASH_MINI_START_CANCELLED';
      error.cancelled = true;
    }
    throw error;
  }

  await persistNetworkMagicAutoStartEnabled(true).catch(() => {});
  scheduleBestRouteSelection();
  applyClashMiniStatus(result, { startBtn, vpnBtn, loadProxyOptions: false });

  return '关闭网络魔法';
}

// 启动流程的统一入口。恢复状态、验证后自动开启和手动点击可能在相邻时刻
// 同时触发：共享同一个启动任务，核心只启动一次，后台自动选路也只跑一次。
// clashMiniStartFlowPromise 同时是“启动流程进行中”的状态标记，
// applyVpnActionAvailability 靠它在整个流程期间保持选路按钮禁用。
function startClashMiniFlow(options = {}) {
  if (clashMiniStartFlowPromise) {
    return clashMiniStartFlowPromise;
  }

  const sharedPromise = startClashMiniFlowOnce(options).finally(() => {
    if (clashMiniStartFlowPromise === sharedPromise) {
      clashMiniStartFlowPromise = null;
    }
    // 流程结束后重新收敛：成功时 backgroundBestRouteSelectionPending 已接棒
    // 继续禁用，失败时回落到“未开启”状态（canUseVpnFeatures 为 false）。
    applyVpnActionAvailability();
  });
  clashMiniStartFlowPromise = sharedPromise;
  // 流程开始立即禁用选路按钮，堵住启动期间状态事件带来的可点击空窗。
  applyVpnActionAvailability();
  return sharedPromise;
}

// 开关按钮入口：根据当前状态决定启动还是停止。
async function toggleClashMini({ startBtn, vpnBtn } = {}) {
  if (!window.electron) {
    throw new Error('当前环境不支持网络魔法操作');
  }

  // 启动流程尚未结束时，把重复点击并入进行中的启动任务，
  // 避免核心刚拉起（running 已为 true）时误触发“关闭”。
  if (clashMiniStartFlowPromise) {
    return clashMiniStartFlowPromise;
  }

  const status = window.electron.getClashMiniStatus
    ? await window.electron.getClashMiniStatus()
    : null;
  const running = status && status.running === true;
  const enabled = status && (
    status.running === true
    || status.enabled === true
    || status.proxyAppliedByApp === true
  );

  return running && enabled
    ? stopClashMiniFlow({ startBtn, vpnBtn })
    : startClashMiniFlow({ startBtn, vpnBtn, fetchConfig: true });
}

function showNetworkMagicOperationError(error) {
  // 软件退出会主动取消尚未完成的 Clash Mini 启动，并关闭相关 socket。
  // 这是预期清理，不应再弹错误框打断退出流程。
  if (
    window.__aiFreeAppClosing === true
    || error?.cancelled === true
    || error?.code === 'CLASH_MINI_START_CANCELLED'
  ) {
    return;
  }
  const message = String(error?.message || error || '网络魔法操作失败').trim() || '网络魔法操作失败';
  console.error('[侧边栏][Clash] 网络魔法操作失败:', message);
  if (window.MessageModal && typeof window.MessageModal.showErrorMessage === 'function') {
    window.MessageModal.showErrorMessage(message);
    return;
  }
  if (typeof window.alert === 'function') window.alert(message);
}

function observeNetworkMagicTask(task) {
  if (task && typeof task.catch === 'function') {
    task.catch(showNetworkMagicOperationError);
  }
  return task;
}

// 自动开启网络魔法的统一入口（面板初始化恢复 / 卡密验证通过 / 恢复登录态共用）。
// 满足以下条件才会启动：卡密已验证、用户开启了“自动启动”记忆、核心未在运行、
// 且用户没有正在手动操作开关。key/deviceId 缺省时由预热流程自行解析。
async function autoStartNetworkMagicIfEligible({ startBtn, vpnBtn, key = '', deviceId = '' } = {}) {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    return;
  }
  if (!hasValidatedInSession && !isLicenseValidated()) {
    return;
  }
  if (autoStartClashMiniInFlight) {
    return;
  }
  if (vpnBtn && vpnBtn.dataset.busy === '1') {
    return;
  }

  // 从条件评估阶段就置位“进行中”：预热启动（warmup）等并行流程推送的
  // 状态事件即使在评估期间到达，选路按钮也不会被放开一瞬。
  autoStartClashMiniInFlight = true;
  try {
    const autoStartEnabled = await getNetworkMagicAutoStartEnabled();
    if (!autoStartEnabled) {
      return;
    }

    const status = window.electron.getClashMiniStatus
      ? await window.electron.getClashMiniStatus().catch(() => null)
      : null;
    if (status && status.running === true) {
      return;
    }

    console.log('[侧边栏][Clash] 满足自动启动条件，开始启用网络魔法');
    await ensureClashMiniConfigPreheated({ key, deviceId });
    await startClashMiniFlow({ startBtn, vpnBtn, fetchConfig: false });
  } catch (error) {
    console.warn('[侧边栏] 自动开启网络魔法失败:', error?.message || error);
  } finally {
    autoStartClashMiniInFlight = false;
    // 无论正常结束还是提前退出，都重新收敛一次按钮可用性。
    applyVpnActionAvailability();
  }
}

// 同步/连接：bindClashMiniControls的具体业务逻辑。
function bindClashMiniControls() {
  const startBtn = safeGetEl('start-clash-mini-btn');
  const vpnBtn = safeGetEl('VPN-switch');
  const dreamBtn = safeGetEl('open-dream-page-btn');
  testLatencyBtn = safeGetEl('test-min-latency-btn');
  vpnNodeSelectorToggleBtn = safeGetEl('vpn-node-selector-toggle-btn');
  vpnNodeSelectorPanel = safeGetEl('vpn-node-selector-panel');
  vpnNodeSelectorGrid = safeGetEl('vpn-node-selector-grid');
  vpnNodeSelectorGroup = safeGetEl('vpn-node-selector-group');
  vpnSwitchBtn = vpnBtn;
  const statusHandlersBound = window.__clashMiniConsoleBound === true;

  if (startBtn && startBtn.dataset.bound !== '1') {
    startBtn.addEventListener('click', () => {
      observeNetworkMagicTask(withBusyButton(startBtn, [vpnBtn, dreamBtn], () => toggleClashMini({ startBtn, vpnBtn }), {
        preserveTextAfterResolve: true,
      }));
    });
    startBtn.dataset.bound = '1';
  }

  if (vpnBtn && vpnBtn.dataset.bound !== '1') {
    vpnBtn.addEventListener('click', () => {
      if (window.redirectToSidebarAccountLogin?.()) return;
      observeNetworkMagicTask(withBusyButton(vpnBtn, [startBtn, dreamBtn], () => toggleClashMini({ startBtn, vpnBtn }), {
        preserveTextAfterResolve: true,
      }));
    });
    vpnBtn.dataset.bound = '1';
  }

  if (testLatencyBtn && testLatencyBtn.dataset.bound !== '1') {
    testLatencyBtn.dataset.loadingText = '测试中...';
    testLatencyBtn.addEventListener('click', () => {
      if (testLatencyBtn.disabled) return;
      if (sideButtonLockSnapshot || isNetworkMagicStartFlowActive()) return;
      lockSidePanelButtons();
      withBusyButton(testLatencyBtn, [vpnBtn], async () => {
        try {
          const { bestName, bestDelay } = await runBestRouteSelection({ keepPanelOpen: false });
          if (window.MessageModal && typeof window.MessageModal.showSuccessMessage === 'function') {
            window.MessageModal.showSuccessMessage(
              bestName
                ? `已切换到最低延时节点：${bestName}${Number.isFinite(bestDelay) ? ` (${bestDelay}ms)` : ''}`
                : '最低延时测试完成',
            );
          }
        } finally {
          unlockSidePanelButtons();
        }
      });
    });
    testLatencyBtn.dataset.bound = '1';
  }

  if (vpnNodeSelectorToggleBtn && vpnNodeSelectorToggleBtn.dataset.bound !== '1') {
    vpnNodeSelectorToggleBtn.addEventListener('click', async () => {
      if (vpnNodeSelectorToggleBtn.disabled) return;
      if (sideButtonLockSnapshot || isNetworkMagicStartFlowActive()) return;
      const shouldOpen = !vpnNodeSelectorPanel || vpnNodeSelectorPanel.hidden || !vpnNodeSelectorPanel.classList.contains('is-open');
      if (shouldOpen && (!Array.isArray(clashMiniProxyState.names) || clashMiniProxyState.names.length === 0)) {
        await loadVpnNodeSelectorOptions({ force: true, probeDelays: false });
      }
      setVpnNodeSelectorOpen(shouldOpen);
    });
    vpnNodeSelectorToggleBtn.dataset.bound = '1';
  }

  if (!window.__vpnNodeSelectorBound) {
    window.__vpnNodeSelectorBound = true;
    document.addEventListener('click', (event) => {
      if (!vpnNodeSelectorPanel || !testLatencyBtn || !vpnNodeSelectorToggleBtn) return;
      const target = event.target;
      if (!target) return;
      if (vpnNodeSelectorPanel.contains(target) || testLatencyBtn.contains(target) || vpnNodeSelectorToggleBtn.contains(target)) {
        return;
      }
      setVpnNodeSelectorOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setVpnNodeSelectorOpen(false);
      }
    });
  }

  if (!statusHandlersBound && window.electronAPI && typeof window.electronAPI.on === 'function') {
    window.electronAPI.on('app-shutting-down', () => {
      window.__aiFreeAppClosing = true;
    });

    window.electronAPI.on('clash-mini-status', (status) => {
      applyClashMiniStatus(status, { startBtn, vpnBtn });
    });

    window.electronAPI.on('proxy-traffic-quota', (quota) => {
      renderProxyTrafficQuota(quota);
    });

    window.electronAPI.on('proxy-traffic-exhausted', (quota) => {
      renderProxyTrafficQuota(quota);
      window.MessageModal?.showErrorMessage?.('网络魔法流量已用完，代理已自动关闭。请到个人中心兑换流量。');
    });
    window.electronAPI.on('clash-mini-runtime-failed', (payload = {}) => {
      applyClashMiniStatus({ ok: true, running: false, enabled: false }, { startBtn, vpnBtn });
      if (window.__aiFreeAppClosing !== true) {
        window.MessageModal?.showErrorMessage?.(payload.message || '网络魔法运行异常，已恢复为直连模式。');
      }
    });

    window.electronAPI.on('clash-mini-latency-progress', (payload) => {
      applyClashMiniLatencyProgress(payload);
    });

    window.__clashMiniConsoleBound = true;
  }

  if (!window.__aiFreeClosingGuardBound) {
    window.__aiFreeClosingGuardBound = true;
    window.addEventListener('beforeunload', () => {
      window.__aiFreeAppClosing = true;
    });
  }

  if (window.electron && typeof window.electron.getClashMiniStatus === 'function') {
    window.electron.getClashMiniStatus()
      .then((status) => applyClashMiniStatus(status, { startBtn, vpnBtn }))
      .catch(() => {});
  }

  if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    window.electronAPI.invoke('get-proxy-traffic-quota').then((result) => {
      if (result?.ok && result.quota) renderProxyTrafficQuota(result.quota);
    }).catch(() => {});
  }

  if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    autoStartNetworkMagicIfEligible({ startBtn, vpnBtn }).catch(() => {});
  }
}
