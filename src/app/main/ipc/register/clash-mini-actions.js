const fs = require('fs');
const {
  collectClashMiniProxyDelays,
  emitClashMiniLog,
  fetchClashMiniProxyNames,
  formatClashMiniDelayText,
  getClashMiniManualGroupName,
  getClashMiniRuntimeRoot,
  getClashMiniStatus,
  normalizeProbeTimeout,
  normalizeProbeUrl,
  probeClashMiniGroupDelay,
  probeClashMiniProxyDelay,
  readClashProbeSettings,
  startClashMiniProcess,
  waitForClashMiniControlApi,
  invokeClashMiniControl,
} = require('./clash-mini-core');

// 获取/读取/解析：resolveLatencyConcurrency的具体业务逻辑。
function resolveLatencyConcurrency(totalCount, requestedConcurrency) {
  const total = Math.max(1, Math.floor(Number(totalCount) || 0));
  // Mihomo 每个测速任务都会建立真实网络连接。过高并发会同时挤占 CPU、
  // DNS 和 socket，反而拖慢主界面；默认保持温和，手动传值也限制上限。
  const defaultConcurrency = total >= 80 ? 8 : total >= 24 ? 6 : total >= 12 ? 4 : 3;
  const requested = Number(requestedConcurrency);
  const base = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : defaultConcurrency;
  return Math.max(1, Math.min(total, 12, base));
}

// 读取一批节点当前最新一条 delay history（时间戳 + 延迟）。
// 批量测速期间靠对比时间戳变化识别“该节点已出结果”，实现增量进度。
async function readLatestDelayHistorySnapshot(coreDir, names) {
  const response = await invokeClashMiniControl(coreDir, 'get', '/proxies', { timeoutMs: 5000 });
  const proxies = response && typeof response === 'object' && response.proxies && typeof response.proxies === 'object'
    ? response.proxies
    : {};
  const snapshot = new Map();
  names.forEach((name) => {
    const history = Array.isArray(proxies[name]?.history) ? proxies[name].history : [];
    const latest = history.length > 0 ? history[history.length - 1] : null;
    snapshot.set(name, {
      time: String(latest?.time || ''),
      delay: Number(latest?.delay),
    });
  });
  return snapshot;
}

// 批量路径：一次 /group/{组名}/delay 让内核并发测完整组，外部只等结果。
// 期间每 800ms 轮询一次本地控制接口的 history，把已出结果的节点增量推给界面。
// 成功返回 entries 数组；端点不可用（老内核 404 等）返回 null，由调用方回退。
async function runGroupBatchLatencyTest({ coreDir, groupName, uniqueNames, latencyUrl, timeout, reportProgress, ui }) {
  let baseline = null;
  try {
    baseline = await readLatestDelayHistorySnapshot(coreDir, uniqueNames);
  } catch (_) {
    // 基线读取失败则放弃增量进度（否则会把旧测速记录误报成新结果），批量测速本身不受影响。
    baseline = null;
  }

  const batchPromise = probeClashMiniGroupDelay(coreDir, groupName, latencyUrl, timeout);

  let pollingActive = baseline !== null;
  const reported = new Set();
  let best = null;
  const poller = (async () => {
    while (pollingActive) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!pollingActive) break;
      let snapshot = null;
      try {
        snapshot = await readLatestDelayHistorySnapshot(coreDir, uniqueNames);
      } catch (_) {
        break;
      }
      uniqueNames.forEach((name, index) => {
        if (reported.has(name)) return;
        const current = snapshot.get(name);
        const before = baseline.get(name);
        if (!current || !current.time || current.time === before?.time) return;
        reported.add(name);
        const delay = Number(current.delay);
        const normalizedDelay = Number.isFinite(delay) && delay > 0 ? delay : null;
        if (normalizedDelay != null && (!best || normalizedDelay < best.delay)) {
          best = { name, delay: normalizedDelay };
        }
        reportProgress({
          phase: 'probe',
          index,
          completed: reported.size,
          name,
          delay: normalizedDelay,
          ...(normalizedDelay == null ? { error: '超时' } : {}),
          bestName: best?.name || '',
          bestDelay: best?.delay || null,
        });
      });
    }
  })();

  let delayMap = null;
  try {
    delayMap = await batchPromise;
  } catch (error) {
    pollingActive = false;
    await poller.catch(() => {});
    emitClashMiniLog(ui, 'warning', `批量测速接口不可用，回退逐节点测速: ${error?.message || error}`);
    return null;
  }
  pollingActive = false;
  await poller.catch(() => {});

  return uniqueNames.map((name) => {
    const delay = Number(delayMap[name]);
    const normalizedDelay = Number.isFinite(delay) && delay > 0 ? delay : null;
    return normalizedDelay != null
      ? { name, delay: normalizedDelay }
      : { name, delay: null, error: '超时' };
  });
}

// 回退路径：老内核不支持组批量测速时，沿用外部 worker 池逐节点探测。
async function runPerNodeLatencyTest({ coreDir, uniqueNames, latencyUrl, timeout, concurrency, reportProgress }) {
  const entries = new Array(uniqueNames.length);
  let cursor = 0;
  let completed = 0;
  let best = null;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < uniqueNames.length) {
      const currentIndex = cursor++;
      const name = uniqueNames[currentIndex];
      try {
        const probe = await probeClashMiniProxyDelay(coreDir, name, latencyUrl, timeout);
        const delay = Number(probe.delay);
        const normalizedDelay = Number.isFinite(delay) ? delay : null;
        entries[currentIndex] = { name, delay: normalizedDelay };
        completed += 1;
        if (normalizedDelay != null && normalizedDelay > 0 && (!best || normalizedDelay < best.delay)) {
          best = { name, delay: normalizedDelay };
        }
        reportProgress({
          phase: 'probe',
          index: currentIndex,
          completed,
          name,
          delay: normalizedDelay,
          bestName: best?.name || '',
          bestDelay: best?.delay || null,
        });
      } catch (error) {
        entries[currentIndex] = { name, delay: null, error: error?.message || String(error) };
        completed += 1;
        reportProgress({
          phase: 'probe',
          index: currentIndex,
          completed,
          name,
          delay: null,
          error: error?.message || String(error),
          bestName: best?.name || '',
          bestDelay: best?.delay || null,
        });
      }
    }
  });

  await Promise.all(workers);
  return entries;
}

// 最低延时测试主流程：优先用内核组批量测速（一次调用、总耗时≈单节点超时上限），
// 失败时回退外部逐节点探测；两条路径共用进度上报、选优与切换逻辑。
async function testClashMiniLowestLatency(ui, options = {}) {
  let status = getClashMiniStatus();
  if (!status.running) {
    emitClashMiniLog(ui, 'info', '最低延时测试需要先启动 Clash Mini，正在尝试启动');
    const startResult = await startClashMiniProcess(ui);
    if (!startResult?.ok) {
      return startResult;
    }
    status = getClashMiniStatus();
  }

  const coreDir = status.coreDir || getClashMiniRuntimeRoot();
  if (!coreDir || !fs.existsSync(coreDir)) {
    return { ok: false, error: 'Clash Mini 运行目录不存在' };
  }

  const probeSettings = readClashProbeSettings() || {};
  const latencyUrl = normalizeProbeUrl(options.url || probeSettings.latencyUrl, 'http://www.gstatic.com/generate_204');
  const timeout = normalizeProbeTimeout(options.timeout || probeSettings.latencyTimeoutMs, 5000);
  const groupName = String(options.groupName || getClashMiniManualGroupName(coreDir)).trim() || '节点选择';

  emitClashMiniLog(ui, 'info', `准备测试最低延时: 分组=${groupName}，URL=${latencyUrl}，超时=${timeout}ms`);

  const apiReady = await waitForClashMiniControlApi(coreDir, 15000);
  if (!apiReady) {
    return { ok: false, error: 'Clash Mini 控制接口未就绪' };
  }

  const groupInfo = await fetchClashMiniProxyNames(coreDir, groupName);
  const candidateNames = Array.isArray(options.names) && options.names.length > 0
    ? options.names
    : groupInfo.names;
  const uniqueNames = Array.from(new Set(candidateNames.map((item) => String(item || '').trim()).filter(Boolean)));
  if (uniqueNames.length === 0) {
    return { ok: false, error: `分组 ${groupName} 中没有可测试的节点` };
  }

  const shouldReportProgress = options.reportProgress !== false;
  const reportProgress = (payload = {}) => {
    if (!shouldReportProgress) return;
    try {
      ui?.sendToSide?.('clash-mini-latency-progress', {
        groupName,
        url: latencyUrl,
        timeout,
        total: uniqueNames.length,
        ...payload,
      });
    } catch (_) {}
  };

  reportProgress({ phase: 'start' });

  emitClashMiniLog(ui, 'info', `参与测试的节点数量: ${uniqueNames.length}，优先使用内核批量测速`);
  let entries = await runGroupBatchLatencyTest({
    coreDir,
    groupName,
    uniqueNames,
    latencyUrl,
    timeout,
    reportProgress,
    ui,
  });

  if (!entries) {
    const concurrency = resolveLatencyConcurrency(uniqueNames.length, options.concurrency);
    emitClashMiniLog(ui, 'info', `回退逐节点测速，并发度: ${concurrency}`);
    entries = await runPerNodeLatencyTest({
      coreDir,
      uniqueNames,
      latencyUrl,
      timeout,
      concurrency,
      reportProgress,
    });
  }

  const valid = entries.filter((item) => typeof item.delay === 'number' && Number.isFinite(item.delay) && item.delay > 0);
  valid.sort((a, b) => a.delay - b.delay);
  const best = valid[0] || null;
  if (!best) {
    reportProgress({ phase: 'done', entries, bestName: '', bestDelay: null });
    return {
      ok: false,
      error: '未找到可用的最低延时节点',
      entries,
      groupName,
      url: latencyUrl,
      timeout,
    };
  }

  await invokeClashMiniControl(coreDir, 'put', `/proxies/${encodeURIComponent(groupName)}`, {
    data: { name: best.name },
    timeoutMs: 10000,
  });

  emitClashMiniLog(ui, 'info', `最低延时节点已选中: ${best.name} (${best.delay}ms)`);
  reportProgress({
    phase: 'done',
    entries,
    bestName: best.name,
    bestDelay: best.delay,
  });

  return {
    ok: true,
    entries,
    groupName,
    url: latencyUrl,
    timeout,
    best,
    bestName: best.name,
    bestDelay: best.delay,
    running: true,
  };
}

// 获取/读取/解析：getClashMiniProxyGroupOptions的具体业务逻辑。
async function getClashMiniProxyGroupOptions(ui, options = {}) {
  let status = getClashMiniStatus();
  if (!status.running) {
    return {
      ok: false,
      error: 'Clash Mini 未运行',
      running: false,
      groupName: String(options.groupName || getClashMiniManualGroupName(getClashMiniRuntimeRoot())).trim() || '节点选择',
      names: [],
      current: '',
    };
  }

  const coreDir = status.coreDir || getClashMiniRuntimeRoot();
  if (!coreDir || !fs.existsSync(coreDir)) {
    return { ok: false, error: 'Clash Mini 运行目录不存在', running: false, names: [], current: '' };
  }

  const groupName = String(options.groupName || getClashMiniManualGroupName(coreDir)).trim() || '节点选择';
  const apiReady = await waitForClashMiniControlApi(coreDir, 15000);
  if (!apiReady) {
    return { ok: false, error: 'Clash Mini 控制接口未就绪', running: true, groupName, names: [], current: '' };
  }

  const groupInfo = await fetchClashMiniProxyNames(coreDir, groupName);
  const candidateNames = Array.isArray(options.names) && options.names.length > 0
    ? options.names
    : groupInfo.names;
  const names = Array.from(new Set(candidateNames.map((item) => String(item || '').trim()).filter(Boolean)));

  const probeSettings = readClashProbeSettings() || {};
  const latencyUrl = normalizeProbeUrl(options.url || probeSettings.latencyUrl, 'http://www.gstatic.com/generate_204');
  const timeout = normalizeProbeTimeout(options.timeout || probeSettings.latencyTimeoutMs, 5000);
  const includeDelays = options.includeDelays !== false;
  const concurrency = resolveLatencyConcurrency(names.length, options.concurrency);

  const proxies = includeDelays
    ? await collectClashMiniProxyDelays(coreDir, names, latencyUrl, timeout, concurrency)
    : names.map((name) => ({
      name,
      delay: null,
      delayText: '测速中...',
      ok: false,
      selected: name === String(groupInfo.current || '').trim(),
    }));

  return {
    ok: true,
    running: true,
    groupName,
    current: groupInfo.current || '',
    names,
    url: latencyUrl,
    timeout,
    proxies: proxies.length > 0
      ? proxies.map((item) => ({
        ...item,
        selected: item.name === String(groupInfo.current || '').trim(),
      }))
      : names.map((name) => ({
        name,
        delay: null,
        delayText: '超时',
        ok: false,
        selected: name === String(groupInfo.current || '').trim(),
      })),
  };
}

// 处理：switchClashMiniProxyNode的具体业务逻辑。
async function switchClashMiniProxyNode(ui, options = {}) {
  let status = getClashMiniStatus();
  if (!status.running) {
    return {
      ok: false,
      error: 'Clash Mini 未运行',
      running: false,
    };
  }

  const coreDir = status.coreDir || getClashMiniRuntimeRoot();
  if (!coreDir || !fs.existsSync(coreDir)) {
    return { ok: false, error: 'Clash Mini 运行目录不存在' };
  }

  const groupName = String(options.groupName || getClashMiniManualGroupName(coreDir)).trim() || '节点选择';
  const nodeName = String(options.nodeName || options.name || '').trim();
  if (!nodeName) {
    return { ok: false, error: '未提供要切换的节点名称' };
  }

  const apiReady = await waitForClashMiniControlApi(coreDir, 15000);
  if (!apiReady) {
    return { ok: false, error: 'Clash Mini 控制接口未就绪' };
  }

  await invokeClashMiniControl(coreDir, 'put', `/proxies/${encodeURIComponent(groupName)}`, {
    data: { name: nodeName },
    timeoutMs: 10000,
  });

  emitClashMiniLog(ui, 'info', `节点已切换: ${groupName} -> ${nodeName}`);

  return {
    ok: true,
    running: true,
    groupName,
    current: nodeName,
    name: nodeName,
  };
}

module.exports = {
  getClashMiniProxyGroupOptions,
  resolveLatencyConcurrency,
  switchClashMiniProxyNode,
  testClashMiniLowestLatency,
};
