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
  probeClashMiniProxyDelay,
  readClashProbeSettings,
  startClashMiniProcess,
  waitForClashMiniControlApi,
  invokeClashMiniControl,
} = require('./clash-mini-core');

// 获取/读取/解析：resolveLatencyConcurrency的具体业务逻辑。
function resolveLatencyConcurrency(totalCount, requestedConcurrency) {
  const total = Math.max(1, Math.floor(Number(totalCount) || 0));
  const defaultConcurrency = total >= 80 ? 48 : total >= 24 ? 32 : total >= 12 ? 16 : 8;
  const requested = Number(requestedConcurrency);
  const base = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : defaultConcurrency;
  return Math.max(1, Math.min(total, 64, base));
}

// 处理：testClashMiniLowestLatency的具体业务逻辑。
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

  const concurrency = resolveLatencyConcurrency(uniqueNames.length, options.concurrency);

  emitClashMiniLog(ui, 'info', `参与测试的节点数量: ${uniqueNames.length}，并发度: ${concurrency}`);

  const entries = new Array(uniqueNames.length);
  let cursor = 0;
  let completed = 0;
  let best = null;
// 处理：reportProgress的具体业务逻辑。
  const reportProgress = (payload = {}) => {
    try {
      ui?.sendToSide?.('clash-mini-latency-progress', {
        groupName,
        url: latencyUrl,
        timeout,
        total: uniqueNames.length,
        concurrency,
        ...payload,
      });
    } catch (_) {}
  };

  reportProgress({ phase: 'start' });

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

  const valid = entries.filter((item) => typeof item.delay === 'number' && Number.isFinite(item.delay) && item.delay > 0);
  valid.sort((a, b) => a.delay - b.delay);
  best = valid[0] || best || null;
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
  switchClashMiniProxyNode,
  testClashMiniLowestLatency,
};
