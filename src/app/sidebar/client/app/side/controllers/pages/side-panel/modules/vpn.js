// 侧边栏 VPN / Clash Mini 相关逻辑
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

function getPositiveVpnDelay(source) {
  const value = Number(source && source.delay);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeMergedProxyEntry(item, previous, currentName) {
  const name = String((item && item.name) || '').trim();
  const nextDelay = getPositiveVpnDelay(item);
  const previousDelay = getPositiveVpnDelay(previous);
  const delay = nextDelay !== null ? nextDelay : previousDelay;
  const hasError = (item && item.error) || (previous && previous.error);
  const itemText = item && item.delayText;
  const previousText = previous && previous.delayText;
  return {
    name,
    delay,
    delayText: String(itemText || previousText
      || (hasError ? '超时' : (delay !== null ? `${Math.round(delay)}ms` : '测速中...'))),
    selected: name === String(currentName || '').trim(),
  };
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
    const name = String((item && item.name) || '').trim();
    const previous = previousMap.get(name) || {};
    return normalizeMergedProxyEntry(item, previous, currentName);
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

  button.addEventListener('click', () => switchVpnNode(name));

  return button;
}

function getVpnSwitchRequest(name) {
  const currentName = String(clashMiniProxyState.current || '').trim();
  const nodeName = String(name || '').trim();
  if (!nodeName || nodeName === currentName) return null;
  return {
    groupName: String(clashMiniProxyState.groupName || '节点选择').trim() || '节点选择',
    nodeName,
  };
}

function applyVpnSwitchResult(result, nodeName) {
  clashMiniProxyState.current = String(result.current || result.name || nodeName).trim();
  clashMiniProxyState.proxies = normalizeProxyEntries(clashMiniProxyState.proxies, clashMiniProxyState.current);
  syncVpnNodeSelectorState();
  scheduleVpnNodeSelectorRender({ forceFull: true });
  setVpnNodeSelectorOpen(false);
  const modal = window.MessageModal;
  if (modal && typeof modal.showSuccessMessage === 'function') {
    modal.showSuccessMessage(`已切换到节点：${clashMiniProxyState.current}`);
  }
}

function showVpnSwitchError(error) {
  const modal = window.MessageModal;
  if (!modal || typeof modal.showErrorMessage !== 'function') return;
  modal.showErrorMessage(error && error.message ? error.message : String(error));
}

async function switchVpnNode(name) {
    const networkApi = window.aiFree && window.aiFree.network;
    if (isNetworkMagicStartFlowActive() || vpnNodeSelectorBusy || !networkApi || typeof networkApi.switchClashProxy !== 'function') {
      return;
    }

    const request = getVpnSwitchRequest(name);
    if (!request) {
      setVpnNodeSelectorOpen(false);
      return;
    }

    setVpnNodeSelectorBusy(true);
    try {
      const result = await networkApi.switchClashProxy(request);
      if (!result || result.ok !== true) {
        throw new Error((result && (result.error || result.message)) || '切换节点失败');
      }
      applyVpnSwitchResult(result, request.nodeName);
    } catch (error) {
      showVpnSwitchError(error);
    } finally {
      setVpnNodeSelectorBusy(false);
    }
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

let autoStartClashMiniInFlight = false;
let clashMiniStartFlowPromise = null;
let vpnNodeSelectorRenderScheduled = false;
let vpnNodeSelectorRenderRaf = null;
let vpnNodeSelectorOptionNodes = new Map();
let vpnNodeSelectorRenderedNamesKey = '';

// 获取/读取/解析：getClashMiniConfigSignature的具体业务逻辑。
