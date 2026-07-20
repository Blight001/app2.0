function getClashMiniConfigSignature(key, deviceId) {
  return `${String(key || '').trim()}::${String(deviceId || '').trim()}`;
}

// 获取/读取/解析：resolveClashMiniCredentialsSnapshot的具体业务逻辑。
async function resolveClashMiniCredentialsSnapshot({ key = '', deviceId = '' } = {}) {
  let nextKey = String(key || '').trim();
  let nextDeviceId = String(deviceId || '').trim();

  if (!nextKey || !nextDeviceId) {
    const credentials = await loadClashMiniStoredCredentials();
    const filled = fillMissingClashCredentials(nextKey, nextDeviceId, credentials);
    nextKey = filled.key;
    nextDeviceId = filled.deviceId;
  }

  if (!nextDeviceId) nextDeviceId = await loadClashMiniDeviceId();

  return {
    key: nextKey,
    deviceId: nextDeviceId,
  };
}

function fillMissingClashCredentials(key, deviceId, credentials) {
  return {
    key: key || firstClashCredential(safeGetEl('key-input')?.value, credentials.key, globalCurrentKey),
    deviceId: deviceId || firstClashCredential(safeGetEl('device-id')?.value, credentials.deviceId, globalCurrentDeviceId),
  };
}

async function loadClashMiniDeviceId() {
  if (typeof window.aiFree?.license?.getDeviceId !== 'function') return '';
  const response = await window.aiFree.license.getDeviceId().catch(() => null);
  return String(response || '').trim();
}

async function loadClashMiniStoredCredentials() {
  const response = await window.aiFree.license.getUserCredentials().catch(() => null);
  return response?.ok === true && response.credentials ? response.credentials : {};
}

function firstClashCredential(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

// 同步/连接：syncClashMiniConfigFromServer的具体业务逻辑。
async function syncClashMiniConfigFromServer(options = {}) {
  if (typeof window.aiFree?.network?.getClashConfig !== 'function') {
    throw new Error('当前环境不支持获取 Clash 配置');
  }

  const { key, deviceId } = await resolveClashMiniCredentialsSnapshot(options);

  if (!key || !deviceId) {
    throw new Error('账号未登录或缺少设备号，无法获取 Clash 配置');
  }

  const clashResp = await window.aiFree.network.getClashConfig( { key, deviceId });
  assertClashConfigResponse(clashResp);

  const configContent = String(clashResp.content || clashResp.configContent || '').trim();
  const subscriptionUrl = String(clashResp.proxySubscriptionUrl || '').trim();
  const importContent = configContent || '';

  const saveResp = await window.aiFree.network.saveClashConfig( {
    clashConfig: importContent,
    configContent: importContent,
    content: importContent,
    subscriptionUrl,
  });

  assertClashConfigSaved(saveResp);

  return {
    key,
    deviceId,
    clashResp,
    saveResp,
  };
}

function assertClashConfigResponse(response) {
  if (response?.ok === true) return;
  throw new Error(response?.error || response?.message || '获取客户端配置失败');
}

function assertClashConfigSaved(response) {
  if (response?.ok === true) return;
  if (response?.rawContent) {
    console.error('[侧边栏][Clash] 导入失败时的原始配置内容:');
    console.error(response.rawContent);
  }
  throw new Error(response?.error || response?.message || '导入 Clash 配置失败');
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

// 启动/打开/显示：runBestRouteSelection的具体业务逻辑。
async function runBestRouteSelection({
  keepPanelOpen = false,
  showPanel = true,
  refreshOptions = true,
  concurrency,
  reportProgress = true,
} = {}) {
  assertBestRouteSelectionAvailable();
  await prepareBestRouteSelection(refreshOptions, showPanel);

  const result = await invokeBestRouteSelection(concurrency, reportProgress);
  const { bestName, bestDelay } = resolveBestRouteResult(result);
  if (bestName) applyBestRouteResult(result, bestName, bestDelay);
  settleBestRoutePanel(keepPanelOpen, showPanel);

  return { bestName, bestDelay, result };
}

async function invokeBestRouteSelection(concurrency, reportProgress) {
  const result = await window.aiFree.network.testMinLatency({
    names: Array.isArray(clashMiniProxyState.names) ? clashMiniProxyState.names : [],
    concurrency,
    reportProgress,
  });
  if (result?.ok !== true) throw new Error(result?.error || result?.message || '最低延时测试失败');
  return result;
}

function resolveBestRouteResult(result) {
  return {
    bestName: String(result.bestName || result?.best?.name || '').trim(),
    bestDelay: Number(result.bestDelay ?? result?.best?.delay),
  };
}

function assertBestRouteSelectionAvailable() {
  if (typeof window.aiFree?.network?.testMinLatency !== 'function') throw new Error('当前环境不支持最低延时测试');
  if (!isVpnEnabled) throw new Error('请先开启网络魔法');
}

async function prepareBestRouteSelection(refreshOptions, showPanel) {
  if (refreshOptions) await loadVpnNodeSelectorOptions({ force: true, probeDelays: false }).catch(() => {});
  if (showPanel) setVpnNodeSelectorOpen(true, { force: true });
}

function applyBestRouteResult(result, bestName, bestDelay) {
  clashMiniProxyState.current = bestName;
  if (Array.isArray(result.entries)) {
    clashMiniProxyState.names = Array.from(new Set(
      result.entries.map((item) => String(item?.name || '').trim()).filter(Boolean),
    ));
  }
  clashMiniProxyState.proxies = normalizeProxyEntries(result.entries, bestName);
  const bestEntry = clashMiniProxyState.proxies.find((item) => item.name === bestName);
  if (bestEntry && Number.isFinite(bestDelay) && bestDelay > 0) {
    Object.assign(bestEntry, { delay: bestDelay, delayText: `${Math.round(bestDelay)}ms`, selected: true });
  }
  syncVpnNodeSelectorState();
  scheduleVpnNodeSelectorRender({ forceFull: true });
}

function settleBestRoutePanel(keepPanelOpen, showPanel) {
  if (keepPanelOpen && showPanel) setVpnNodeSelectorOpen(true);
  else if (!showPanel) setVpnNodeSelectorOpen(false);
}

// 设置/更新/持久化：setVpnNodeSelectorBusy的具体业务逻辑。
