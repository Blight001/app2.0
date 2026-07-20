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
  if (typeof window.aiFree?.network?.getAutoStartEnabled !== 'function') {
    return true;
  }
  try {
    const result = await window.aiFree.network.getAutoStartEnabled();
    if (result && result.ok === true && typeof result.enabled === 'boolean') {
      return result.enabled;
    }
  } catch (_) {}
  return true;
}

// 设置/更新/持久化：persistNetworkMagicAutoStartEnabled的具体业务逻辑。
async function persistNetworkMagicAutoStartEnabled(enabled) {
  if (typeof window.aiFree?.network?.setAutoStartEnabled !== 'function') {
    return { ok: false };
  }
  return window.aiFree.network.setAutoStartEnabled( { enabled: !!enabled });
}

// 停止/关闭/清理：stopClashMiniFlow的具体业务逻辑。
async function stopClashMiniFlow({ startBtn, vpnBtn } = {}) {
  if (typeof window.aiFree.network.stopClash !== 'function') {
    throw new Error('当前环境不支持停止 Clash Mini');
  }
  const result = await window.aiFree.network.stopClash();
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
async function startClashMiniFlowOnce({ startBtn, vpnBtn, fetchConfig = true, key = '', deviceId = '' } = {}) {
  if (typeof window.aiFree.network.startClash !== 'function') {
    throw new Error('当前环境不支持启动 Clash Mini');
  }
  await stopClashForFreshConfig(fetchConfig);
  if (fetchConfig) {
    // 获取服务器配置只能发生在真正启动网络魔法的流程里。个人中心、账号
    // 恢复和普通侧边栏初始化都不得单独预热或刷新代理配置。
    console.log('[侧边栏][Clash] 开启网络魔法，获取最新 YAML 并覆盖旧配置...');
    await ensureClashMiniConfigPreheated({ force: true, key, deviceId });
  }
  const result = await window.aiFree.network.startClash();
  assertClashStarted(result);

  await persistNetworkMagicAutoStartEnabled(true).catch(() => {});
  scheduleBestRouteSelection();
  applyClashMiniStatus(result, { startBtn, vpnBtn, loadProxyOptions: false });
  // 魔法不再强制接管所有浏览器：检测当前浏览器是否选择了魔法端口代理，
  // 未选择时询问是否应用（不阻塞启动流程返回）。
  void promptApplyNetworkMagicToActiveBrowser();

  return '关闭网络魔法';
}

async function stopClashForFreshConfig(fetchConfig) {
  if (!fetchConfig || typeof window.aiFree.network.stopClash !== 'function') return;
  const currentStatus = typeof window.aiFree.network.getClashStatus === 'function'
    ? await window.aiFree.network.getClashStatus().catch(() => null)
    : null;
  if (currentStatus?.running !== true) return;
  const result = await window.aiFree.network.stopClash()
    .catch((error) => ({ ok: false, error: error?.message || String(error) }));
  if (!result?.ok) {
    throw new Error(result?.error || result?.message || '重启网络魔法前停止当前进程失败');
  }
}

function assertClashStarted(result) {
  if (result?.ok === true) return;
  const error = new Error(result?.error || result?.message || '启动网络魔法失败');
  if (result?.cancelled === true) {
    error.code = 'CLASH_MINI_START_CANCELLED';
    error.cancelled = true;
  }
  throw error;
}

// 开启魔法后检测当前激活浏览器：未选择魔法端口代理时弹窗询问是否应用。
async function promptApplyNetworkMagicToActiveBrowser() {
  try {
    if (typeof window.aiFree?.network?.getActiveBrowser !== 'function') return;
    const response = await window.aiFree.network.getActiveBrowser();
    const tab = response?.ok ? response.tab : null;
    if (!tab || tab.magicSelected === true) return;
    if (!window.MessageModal || typeof window.MessageModal.showConfirmDialog !== 'function') return;
    window.MessageModal.showConfirmDialog(`是否将魔法应用到当前的“${tab.name}”浏览器？`, async () => {
      try {
        const result = await window.aiFree.network.applyToBrowser( {
          tabId: tab.id,
          historyId: tab.historyId,
        });
        if (!result?.ok) throw new Error(result?.error || '应用魔法代理失败');
      } catch (error) {
        showNetworkMagicOperationError(error);
      }
    });
  } catch (error) {
    console.warn('[侧边栏][Clash] 检测当前浏览器魔法代理失败:', error?.message || error);
  }
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
  if (!window.aiFree?.network) {
    throw new Error('当前环境不支持网络魔法操作');
  }

  // 启动流程尚未结束时，把重复点击并入进行中的启动任务，
  // 避免核心刚拉起（running 已为 true）时误触发“关闭”。
  if (clashMiniStartFlowPromise) {
    return clashMiniStartFlowPromise;
  }

  const status = window.aiFree.network.getClashStatus
    ? await window.aiFree.network.getClashStatus()
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
  // 个人中心浮窗复用侧边栏页面，但它不是网络魔法入口。即使记住了自动
  // 启动偏好，也不能因为点击头像而启动核心或刷新 Clash 配置。
  if (!canAutoStartNetworkMagic(vpnBtn)) return;

  // 从条件评估阶段就置位“进行中”：预热启动（warmup）等并行流程推送的
  // 状态事件即使在评估期间到达，选路按钮也不会被放开一瞬。
  autoStartClashMiniInFlight = true;
  try {
    if (!await getNetworkMagicAutoStartEnabled()) return;
    if (await isNetworkMagicRunning()) return;

    console.log('[侧边栏][Clash] 满足自动启动条件，开始启用网络魔法');
    await startClashMiniFlow({ startBtn, vpnBtn, fetchConfig: true, key, deviceId });
  } catch (error) {
    console.warn('[侧边栏] 自动开启网络魔法失败:', error?.message || error);
  } finally {
    autoStartClashMiniInFlight = false;
    // 无论正常结束还是提前退出，都重新收敛一次按钮可用性。
    applyVpnActionAvailability();
  }
}

function canAutoStartNetworkMagic(vpnBtn) {
  const isAccountPopup = new URLSearchParams(window.location.search).get('accountCenterPopup') === '1';
  const isValidated = hasValidatedInSession || isLicenseValidated();
  const buttonBusy = vpnBtn?.dataset?.busy === '1';
  return !isAccountPopup && Boolean(window.aiFree?.network) && isValidated
    && !autoStartClashMiniInFlight && !buttonBusy;
}

async function isNetworkMagicRunning() {
  if (typeof window.aiFree.network.getClashStatus !== 'function') return false;
  const status = await window.aiFree.network.getClashStatus().catch(() => null);
  return status?.running === true;
}

// 同步/连接：bindClashMiniControls的具体业务逻辑。
function bindClashMiniControls() {
  const controls = resolveClashMiniControls();
  bindClashToggleButtons(controls);
  bindClashLatencyButton(controls);
  bindVpnNodeSelectorToggle();
  bindVpnNodeSelectorDismissal();
  bindClashStatusHandlers(controls);
  bindAppClosingGuard();
  loadInitialClashStatus(controls);
  if (window.aiFree?.network) autoStartNetworkMagicIfEligible(controls).catch(() => {});
}

function resolveClashMiniControls() {
  const controls = {
    startBtn: safeGetEl('start-clash-mini-btn'),
    vpnBtn: safeGetEl('VPN-switch'),
    dreamBtn: safeGetEl('open-dream-page-btn'),
  };
  testLatencyBtn = safeGetEl('test-min-latency-btn');
  vpnNodeSelectorToggleBtn = safeGetEl('vpn-node-selector-toggle-btn');
  vpnNodeSelectorPanel = safeGetEl('vpn-node-selector-panel');
  vpnNodeSelectorGrid = safeGetEl('vpn-node-selector-grid');
  vpnNodeSelectorGroup = safeGetEl('vpn-node-selector-group');
  vpnSwitchBtn = controls.vpnBtn;
  return controls;
}

function bindClashToggleButtons({ startBtn, vpnBtn, dreamBtn }) {
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
}

function bindClashLatencyButton({ vpnBtn }) {
  if (!testLatencyBtn || testLatencyBtn.dataset.bound === '1') return;
  testLatencyBtn.dataset.loadingText = '测试中...';
  testLatencyBtn.addEventListener('click', () => {
    if (testLatencyBtn.disabled || sideButtonLockSnapshot || isNetworkMagicStartFlowActive()) return;
    lockSidePanelButtons();
    withBusyButton(testLatencyBtn, [vpnBtn], runManualBestRouteSelection);
  });
  testLatencyBtn.dataset.bound = '1';
}

async function runManualBestRouteSelection() {
  try {
    const result = await runBestRouteSelection({ keepPanelOpen: false });
    showBestRouteSelectionResult(result);
  } finally {
    unlockSidePanelButtons();
  }
}

function showBestRouteSelectionResult({ bestName, bestDelay }) {
  if (typeof window.MessageModal?.showSuccessMessage !== 'function') return;
  const delay = Number.isFinite(bestDelay) ? ` (${bestDelay}ms)` : '';
  window.MessageModal.showSuccessMessage(
    bestName ? `已切换到最低延时节点：${bestName}${delay}` : '最低延时测试完成',
  );
}

function bindVpnNodeSelectorToggle() {
  if (!vpnNodeSelectorToggleBtn || vpnNodeSelectorToggleBtn.dataset.bound === '1') return;
  vpnNodeSelectorToggleBtn.addEventListener('click', async () => {
    if (vpnNodeSelectorToggleBtn.disabled || sideButtonLockSnapshot || isNetworkMagicStartFlowActive()) return;
    const shouldOpen = !vpnNodeSelectorPanel?.classList.contains('is-open');
    const needsOptions = shouldOpen && (!Array.isArray(clashMiniProxyState.names) || !clashMiniProxyState.names.length);
    if (needsOptions) await loadVpnNodeSelectorOptions({ force: true, probeDelays: false });
    setVpnNodeSelectorOpen(shouldOpen);
  });
  vpnNodeSelectorToggleBtn.dataset.bound = '1';
}

function bindVpnNodeSelectorDismissal() {
  if (window.__vpnNodeSelectorBound) return;
  window.__vpnNodeSelectorBound = true;
  document.addEventListener('click', (event) => {
    const controls = [vpnNodeSelectorPanel, testLatencyBtn, vpnNodeSelectorToggleBtn].filter(Boolean);
    if (!event.target || controls.some((element) => element.contains(event.target))) return;
    setVpnNodeSelectorOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setVpnNodeSelectorOpen(false);
  });
}

function bindClashStatusHandlers({ startBtn, vpnBtn }) {
  if (window.__clashMiniConsoleBound || typeof window.aiFree?.network?.onClashStatus !== 'function') return;
  window.aiFree.network.onAppShuttingDown(() => { window.__aiFreeAppClosing = true; });
  window.aiFree.network.onClashStatus((status) => applyClashMiniStatus(status, { startBtn, vpnBtn }));
  window.aiFree.network.onProxyTrafficQuota(renderProxyTrafficQuota);
  window.aiFree.network.onProxyTrafficExhausted((quota) => {
    renderProxyTrafficQuota(quota);
    window.MessageModal?.showErrorMessage?.('网络魔法流量已用完，代理已自动关闭。请到个人中心兑换流量。');
  });
  window.aiFree.network.onClashRuntimeFailed((payload = {}) => {
    applyClashMiniStatus({ ok: true, running: false, enabled: false }, { startBtn, vpnBtn });
    if (window.__aiFreeAppClosing !== true) {
      window.MessageModal?.showErrorMessage?.(payload.message || '网络魔法运行异常，已恢复为直连模式。');
    }
  });
  window.aiFree.network.onClashLatencyProgress(applyClashMiniLatencyProgress);
  window.__clashMiniConsoleBound = true;
}

function bindAppClosingGuard() {
  if (window.__aiFreeClosingGuardBound) return;
  window.__aiFreeClosingGuardBound = true;
  window.addEventListener('beforeunload', () => { window.__aiFreeAppClosing = true; });
}

function loadInitialClashStatus({ startBtn, vpnBtn }) {
  if (typeof window.aiFree?.network?.getClashStatus === 'function') {
    window.aiFree.network.getClashStatus()
      .then((status) => applyClashMiniStatus(status, { startBtn, vpnBtn })).catch(() => {});
  }
  if (typeof window.aiFree?.network?.getProxyTrafficQuota === 'function') {
    window.aiFree.network.getProxyTrafficQuota().then((result) => {
      if (result?.ok && result.quota) renderProxyTrafficQuota(result.quota);
    }).catch(() => {});
  }
}
