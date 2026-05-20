(function initAiFreeToolsSidebar() {
  const vscode = acquireVsCodeApi();
  let nextRequestId = 1;
  const pending = new Map();
  const listeners = new Map();
  const state = {
    validated: false,
    vpnEnabled: false,
    consoleEntries: [],
    records: [],
    theme: 'dark',
    proxyState: {
      groupName: '节点选择',
      current: '',
      names: [],
      proxies: [],
    },
  };

  function invoke(channel, payload) {
    const id = nextRequestId++;
    vscode.postMessage({ type: 'invoke', id, channel, payload });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`请求超时: ${channel}`));
      }, 60000);
    });
  }

  function emit(channel, payload) {
    const set = listeners.get(channel);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (_) {}
    }
  }

  window.electronAPI = {
    invoke,
    send: (channel, payload) => invoke(channel, payload).catch(() => {}),
    on: (channel, fn) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(fn);
      return fn;
    },
    off: (channel, fn) => {
      listeners.get(channel)?.delete(fn);
    },
    removeListener: (channel, fn) => {
      listeners.get(channel)?.delete(fn);
    },
  };

  window.electron = {
    openDreamPage: (payload) => invoke('open-dream-page', payload),
    openAiCanvasProPage: () => invoke('open-ai-canvas-pro-page'),
    openToonflowPage: () => invoke('open-toonflow-page'),
    openTutorialPage: () => invoke('open-tutorial'),
    startClashMini: (options) => invoke('start-clash-mini', options),
    stopClashMini: () => invoke('stop-clash-mini'),
    getClashMiniStatus: () => invoke('get-clash-mini-status'),
    getAppVersion: () => invoke('get-app-version'),
  };

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'invokeResult') {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.ok) item.resolve(message.result);
      else item.reject(new Error(message.error || '请求失败'));
      return;
    }
    if (message.type === 'event') {
      emit(message.channel, message.payload);
    }
  });

  const $ = (id) => document.getElementById(id);

  function setConnection(text, className) {
    const el = $('connection-status');
    if (!el) return;
    el.className = `status-indicator ${className || 'status-connected'}`;
    el.innerHTML = `<span class="status-dot"></span>${text}`;
  }

  function showMessage(text, type = 'info') {
    const content = $('announcement-content');
    if (!content) return;
    const color = type === 'error' ? '#fecaca' : type === 'success' ? '#bbf7d0' : '#dbeafe';
    content.innerHTML = `<p style="color:${color}">${escapeHtml(text)}</p>`;
  }

  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.body.classList.toggle('theme-light', state.theme === 'light');
    const btn = $('theme-toggle-btn');
    if (btn) {
      btn.textContent = state.theme === 'light' ? '☾' : '☀';
      btn.title = state.theme === 'light' ? '切换到深色模式' : '切换到浅色模式';
      btn.setAttribute('aria-pressed', state.theme === 'light' ? 'true' : 'false');
    }
    try {
      localStorage.setItem('ai-free.vscode-sidebar.theme', state.theme);
    } catch (_) {}
  }

  function initTheme() {
    let saved = '';
    try {
      saved = localStorage.getItem('ai-free.vscode-sidebar.theme') || '';
    } catch (_) {}
    applyTheme(saved === 'light' ? 'light' : 'dark');
  }

  function formatConsoleTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function appendConsoleLine(entry) {
    if (!entry || typeof entry !== 'object') return;
    state.consoleEntries.push(entry);
    if (state.consoleEntries.length > 300) {
      state.consoleEntries.splice(0, state.consoleEntries.length - 300);
    }
    const container = $('debug-console-lines');
    if (!container) return;
    const row = document.createElement('div');
    const level = String(entry.level || 'info').toLowerCase();
    const source = entry.source ? `[${entry.source}] ` : '';
    row.className = `debug-console-line is-${level}`;
    row.innerHTML = `<span class="debug-console-time">${escapeHtml(formatConsoleTime(entry.timestamp))}</span><span class="debug-console-level">${escapeHtml(level.toUpperCase())}</span><span class="debug-console-text">${escapeHtml(source + (entry.message || entry.text || ''))}</span>`;
    container.appendChild(row);
    while (container.children.length > 300) {
      container.removeChild(container.firstChild);
    }
    container.scrollTop = container.scrollHeight;
  }

  function renderConsoleHistory(entries) {
    const container = $('debug-console-lines');
    if (!container) return;
    container.innerHTML = '';
    state.consoleEntries = [];
    (Array.isArray(entries) ? entries : []).forEach(appendConsoleLine);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = text || button.dataset.loadingText || '处理中...';
      return;
    }
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function syncLicenseControls() {
    for (const button of document.querySelectorAll('.requires-license')) {
      button.disabled = !state.validated;
    }
    const vpnBtn = $('VPN-switch');
    if (vpnBtn) vpnBtn.disabled = !state.validated;
    syncVpnButtons();
  }

  function formatRecordTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function renderAccountRecords(records = state.records) {
    const list = $('account-list');
    if (!list) return;
    state.records = Array.isArray(records) ? records : [];
    list.innerHTML = '';
    if (!state.records.length) {
      const empty = document.createElement('div');
      empty.className = 'account-empty';
      empty.id = 'account-empty';
      empty.textContent = '暂无保存的账号';
      list.appendChild(empty);
      return;
    }
    const bucket = document.createElement('details');
    bucket.className = 'account-bucket';
    bucket.open = true;
    bucket.innerHTML = `
      <summary class="account-bucket-summary">
        <span class="account-bucket-title">账号记录</span>
        <span class="account-bucket-summary-meta"><span class="account-bucket-meta">${state.records.length} 条</span></span>
      </summary>
      <div class="account-bucket-content"></div>
    `;
    const content = bucket.querySelector('.account-bucket-content');
    for (const record of state.records) {
      const account = String(record?.account || '').trim();
      if (!account) continue;
      const metaParts = [];
      if (record?.platform) metaParts.push(String(record.platform));
      if (record?.currentAccountTypeLabel) metaParts.push(String(record.currentAccountTypeLabel));
      if (record?.serverRecycleTime) metaParts.push(`回收 ${String(record.serverRecycleTime)}`);
      if (record?.lastUsedAt) metaParts.push(formatRecordTime(record.lastUsedAt));
      const item = document.createElement('div');
      item.className = 'account-item active';
      item.tabIndex = 0;
      item.innerHTML = `
        <div class="account-info">
          <div class="account-name">${escapeHtml(account)}</div>
          <div class="account-meta">${metaParts.map(escapeHtml).join(' · ')}</div>
        </div>
        <div class="account-actions">
          <button class="btn-switch" type="button">使用卡密</button>
          <button class="btn-delete" type="button" title="删除该账号记录">删除</button>
        </div>
      `;
      const useRecord = () => {
        const key = String(record?.key || '').trim();
        if (key && $('key-input')) $('key-input').value = key;
        setAccountPanelOpen(false);
        showMessage(key ? `已填入账号 ${account} 对应的卡密` : `账号 ${account}`, 'success');
      };
      item.querySelector('.btn-switch')?.addEventListener('click', (event) => {
        event.stopPropagation();
        useRecord();
      });
      item.querySelector('.btn-delete')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
          await invoke('delete-account-record', { id: record.id });
          showMessage(`已删除账号记录：${account}`, 'success');
        } catch (error) {
          showMessage(error.message || String(error), 'error');
        }
      });
      item.addEventListener('click', useRecord);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          useRecord();
        }
      });
      content.appendChild(item);
    }
    list.appendChild(bucket);
  }

  function setAccountPanelOpen(open) {
    const panel = $('account-panel');
    const toggle = $('account-history-toggle-btn');
    if (!panel || !toggle) return;
    panel.hidden = !open;
    panel.classList.toggle('is-open', !!open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function syncVpnButtons() {
    const enabled = state.vpnEnabled;
    const vpnBtn = $('VPN-switch');
    if (vpnBtn) {
      vpnBtn.textContent = enabled ? '关闭网络魔法' : '开启网络魔法';
      vpnBtn.disabled = !state.validated;
    }
    const testBtn = $('test-min-latency-btn');
    const toggleBtn = $('vpn-node-selector-toggle-btn');
    if (testBtn) testBtn.disabled = !state.validated || !enabled;
    if (toggleBtn) toggleBtn.disabled = !state.validated || !enabled;
  }

  function applyClashStatus(status) {
    const enabled = !!(status && (status.running || status.enabled || status.proxyAppliedByApp));
    state.vpnEnabled = enabled;
    syncVpnButtons();
    if (enabled) {
      loadProxyOptions(false).catch(() => {});
      showMessage(`网络魔法已开启，PID: ${status.pid || 'unknown'}。VS Code 已切换到本地端口代理，内置浏览器打开的站点将走代理。`, 'success');
    }
  }

  function normalizeProxyEntries(entries, currentName) {
    const selectedName = String(currentName || '').trim();
    return (Array.isArray(entries) ? entries : []).map((item) => ({
      name: String(item?.name || '').trim(),
      delay: Number.isFinite(Number(item?.delay)) ? Number(item.delay) : null,
      delayText: String(item?.delayText || item?.error || '测速中...'),
      selected: String(item?.name || '').trim() === selectedName,
    })).filter((item) => item.name);
  }

  function renderProxyOptions() {
    const grid = $('vpn-node-selector-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const names = Array.isArray(state.proxyState.names) ? state.proxyState.names : [];
    const proxies = Array.isArray(state.proxyState.proxies) ? state.proxyState.proxies : [];
    const current = String(state.proxyState.current || '').trim();
    if ($('vpn-node-selector-group')) {
      $('vpn-node-selector-group').textContent = state.proxyState.groupName || '节点选择';
    }
    if (!names.length) {
      const empty = document.createElement('div');
      empty.className = 'vpn-node-option';
      empty.textContent = state.vpnEnabled ? '暂无可用节点' : '请先开启网络魔法';
      grid.appendChild(empty);
      return;
    }
    for (const name of names) {
      const proxy = proxies.find((item) => item.name === name) || { name, delayText: '测速中...' };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vpn-node-option${name === current ? ' is-selected' : ''}`;
      btn.innerHTML = `<div class="vpn-node-option-main"><div class="vpn-node-option-name">${escapeHtml(name)}</div><div class="vpn-node-option-meta">${escapeHtml(proxy.delayText || '测速中...')}</div></div><span class="vpn-node-option-check" aria-hidden="true"></span>`;
      btn.addEventListener('click', async () => {
        if (name === state.proxyState.current) {
          setNodeSelectorOpen(false);
          return;
        }
        try {
          const result = await invoke('switch-clash-mini-proxy', {
            groupName: state.proxyState.groupName,
            nodeName: name,
          });
          if (!result || result.ok !== true) throw new Error(result?.error || result?.message || '切换节点失败');
          state.proxyState.current = name;
          state.proxyState.proxies = normalizeProxyEntries(state.proxyState.proxies, name);
          renderProxyOptions();
          setNodeSelectorOpen(false);
          showMessage(`已切换到节点：${name}`, 'success');
        } catch (error) {
          showMessage(error.message || String(error), 'error');
        }
      });
      grid.appendChild(btn);
    }
  }

  function setNodeSelectorOpen(open) {
    const panel = $('vpn-node-selector-panel');
    const toggle = $('vpn-node-selector-toggle-btn');
    if (!panel || !toggle) return;
    panel.hidden = !open;
    panel.classList.toggle('is-open', !!open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function loadProxyOptions(includeDelays) {
    const result = await invoke('get-clash-mini-proxy-options', { includeDelays: includeDelays === true });
    if (!result || result.ok !== true) return result;
    state.proxyState = {
      groupName: String(result.groupName || '节点选择'),
      current: String(result.current || ''),
      names: Array.isArray(result.names) ? result.names : [],
      proxies: normalizeProxyEntries(result.proxies, result.current),
    };
    renderProxyOptions();
    return result;
  }

  async function validateKey() {
    const key = $('key-input')?.value?.trim() || '';
    const deviceId = $('device-id')?.value?.trim() || '';
    const btn = $('validate-key-btn');
    setBusy(btn, true, '验证中...');
    try {
      const result = await invoke('validate-key', { key, device_id: deviceId });
      if (!result || result.ok !== true) throw new Error(result?.message || result?.error || '验证失败');
      state.validated = true;
      $('expire-time').textContent = result.expire_at || result.validation?.expire_at || result.resolved?.expiryDate || '已验证';
      $('usage-times').textContent = formatUsageText(result);
      applyRuntimeConfig(result.runtimeConfig);
      syncLicenseControls();
      refreshConnectionStatus();
      showMessage(result.message || '验证完成', 'success');
    } catch (error) {
      state.validated = false;
      syncLicenseControls();
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(btn, false);
    }
  }

  function formatUsageText(result) {
    const remaining = result?.remaining_usage_times
      ?? result?.validation?.remaining_usage_times
      ?? result?.licenseUsage?.remaining_usage_times
      ?? result?.licenseUsage?.remainingUsageTimes
      ?? null;
    const max = result?.validation?.max_usage_times
      ?? result?.licenseUsage?.max_usage_times
      ?? result?.licenseUsage?.maxUsageTimes
      ?? null;
    if (remaining !== null && remaining !== undefined && remaining !== '') {
      return max !== null && max !== undefined && max !== '' ? `${remaining}/${max}` : String(remaining);
    }
    const days = result?.days_left ?? result?.validation?.days_left ?? result?.licenseUsage?.days_left ?? null;
    if (days !== null && days !== undefined && days !== '') return `剩余 ${days} 天`;
    return '已验证';
  }

  function applyRuntimeConfig(config) {
    if (!config || typeof config !== 'object') return;
    const platform = String(config.platformName || '').trim();
    const typeLabel = String(config.accountTypeLabel || config.currentAccountTypeLabel || '').trim();
    if ($('platform-name')) $('platform-name').textContent = platform || '—';
    if ($('account-type')) $('account-type').textContent = typeLabel || '—';
    const expire = String(config.expire_at || '').trim();
    if (expire && $('expire-time')) $('expire-time').textContent = expire;
    const remaining = config.remainingUsageTimes;
    const max = config.maxUsageTimes;
    if (remaining !== null && remaining !== undefined && $('usage-times')) {
      $('usage-times').textContent = (max !== null && max !== undefined) ? `${remaining}/${max}` : String(remaining);
    } else if ((config.days_left ?? null) !== null && $('usage-times')) {
      $('usage-times').textContent = `剩余 ${config.days_left} 天`;
    }
    if (config.tutorialUrl && $('tutorial-link')) $('tutorial-link').dataset.url = config.tutorialUrl;
  }

  function applySavedCredentials(credentials = {}) {
    const key = String(credentials.key || '').trim();
    const deviceId = String(credentials.deviceId || credentials.device_id || '').trim();
    if (key && $('key-input')) $('key-input').value = key;
    if (deviceId && $('device-id')) $('device-id').value = deviceId;
    if (credentials.validated === true || credentials.licenseValidated === true) {
      state.validated = true;
      const validation = credentials.validation || {};
      const runtimeConfig = credentials.runtimeConfig || {};
      $('expire-time').textContent = validation.expire_at || runtimeConfig.expire_at || '已验证';
      $('usage-times').textContent = formatUsageText({ validation, licenseUsage: validation });
      applyRuntimeConfig(runtimeConfig);
      syncLicenseControls();
    }
  }

  async function openWithButton(button, channel) {
    setBusy(button, true, button.dataset.loadingText || '打开中...');
    try {
      const result = await invoke(channel);
      if (!result || result.ok !== true) throw new Error(result?.message || result?.error || '打开失败');
      showMessage(`已打开：${result.targetUrl || channel}`, 'success');
    } catch (error) {
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(button, false);
      syncLicenseControls();
    }
  }

  async function toggleVpn() {
    const btn = $('VPN-switch');
    setBusy(btn, true, state.vpnEnabled ? '关闭中...' : '启动中...');
    try {
      const result = state.vpnEnabled ? await invoke('stop-clash-mini') : await invoke('start-clash-mini');
      if (!result || result.ok !== true) throw new Error(result?.error || result?.message || '网络魔法操作失败');
      applyClashStatus(result);
      if (!state.vpnEnabled) {
        state.proxyState = { groupName: '节点选择', current: '', names: [], proxies: [] };
        renderProxyOptions();
      }
    } catch (error) {
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(btn, false);
      syncLicenseControls();
      refreshConnectionStatus();
    }
  }

  async function testMinLatency() {
    const btn = $('test-min-latency-btn');
    setBusy(btn, true, '测试中...');
    try {
      const result = await invoke('test-min-latency', {
        groupName: state.proxyState.groupName,
        names: state.proxyState.names,
      });
      if (!result || result.ok !== true) throw new Error(result?.error || result?.message || '最低延时测试失败');
      state.proxyState.current = result.bestName || state.proxyState.current;
      state.proxyState.proxies = normalizeProxyEntries(result.entries, state.proxyState.current);
      renderProxyOptions();
      showMessage(`已切换到最低延时节点：${result.bestName || ''}${result.bestDelay ? ` (${Math.round(result.bestDelay)}ms)` : ''}`, 'success');
    } catch (error) {
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(btn, false);
      syncLicenseControls();
    }
  }

  async function fetchAccount() {
    const btn = $('fetch-account-btn');
    setBusy(btn, true, '获取中...');
    try {
      const result = await invoke('fetch-account');
      if (!result || result.ok !== true) throw new Error(result?.message || result?.error || '账号获取失败');
      showMessage(`已获取账号：${result.account || '未知账号'}（Cookie ${result.cookieCount || 0} 项）`, 'success');
    } catch (error) {
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(btn, false);
    }
  }

  async function unbindDevice() {
    const btn = $('unbind-device-btn');
    setBusy(btn, true, '解绑中...');
    try {
      const result = await invoke('unbind-device');
      if (!result || result.ok !== true) throw new Error(result?.message || result?.error || '解绑失败');
      showMessage(result.message || '解绑成功', 'success');
    } catch (error) {
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(btn, false);
      syncLicenseControls();
    }
  }

  async function refreshLine() {
    const btn = $('refresh-line-btn');
    setBusy(btn, true, '刷新中...');
    try {
      const result = await invoke('refresh-subscription-url');
      if (!result || result.ok !== true) throw new Error(result?.error || result?.message || '刷新线路失败');
      applyClashStatus(result);
      showMessage('线路配置已刷新', 'success');
    } catch (error) {
      showMessage(error.message || String(error), 'error');
    } finally {
      setBusy(btn, false);
      syncLicenseControls();
    }
  }

  async function refreshConnectionStatus() {
    try {
      const s = await invoke('get-connection-status');
      const cls = s?.status === 'connected'
        ? 'status-connected'
        : (s?.status === 'http' ? 'status-connecting' : 'status-disconnected');
      setConnection(s?.message || 'VS Code 插件模式', cls);
    } catch (_) {}
  }

  function bind() {
    initTheme();
    $('validate-key-btn')?.addEventListener('click', validateKey);
    $('unbind-device-btn')?.addEventListener('click', unbindDevice);
    $('refresh-line-btn')?.addEventListener('click', refreshLine);
    $('open-dream-page-btn')?.addEventListener('click', (event) => openWithButton(event.currentTarget, 'open-dream-page'));
    $('account-history-toggle-btn')?.addEventListener('click', () => {
      const panel = $('account-panel');
      renderAccountRecords();
      setAccountPanelOpen(!panel || panel.hidden);
    });
    $('open-opencut-page-btn')?.addEventListener('click', (event) => openWithButton(event.currentTarget, 'open-opencut-page'));
    $('open-ai-canvas-pro-page-btn')?.addEventListener('click', (event) => openWithButton(event.currentTarget, 'open-ai-canvas-pro-page'));
    $('open-toonflow-page-btn')?.addEventListener('click', (event) => openWithButton(event.currentTarget, 'open-toonflow-page'));
    $('tutorial-link')?.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const result = await invoke('open-tutorial');
        if (!result || result.ok !== true) throw new Error(result?.message || result?.error || '教程链接打开失败');
      } catch (error) {
        showMessage(error.message || String(error), 'error');
      }
    });
    $('VPN-switch')?.addEventListener('click', toggleVpn);
    $('test-min-latency-btn')?.addEventListener('click', testMinLatency);
    $('vpn-node-selector-toggle-btn')?.addEventListener('click', async () => {
      const panel = $('vpn-node-selector-panel');
      const shouldOpen = !panel || panel.hidden;
      if (shouldOpen && state.vpnEnabled && !state.proxyState.names.length) {
        await loadProxyOptions(false).catch(() => {});
      }
      setNodeSelectorOpen(shouldOpen);
    });
    $('fetch-account-btn')?.addEventListener('click', fetchAccount);
    $('theme-toggle-btn')?.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });
    $('remove-watermark-switch')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.currentTarget.checked = false;
      showMessage('VS Code 插件模式暂不支持浏览器扩展注入，请在软件端使用去水印插件。', 'info');
    });
    $('translate-ext-switch')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.currentTarget.checked = false;
      showMessage('VS Code 插件模式暂不支持浏览器扩展注入，请在软件端使用翻译插件。', 'info');
    });
    $('debug-console-clear-btn')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.consoleEntries = [];
      const container = $('debug-console-lines');
      if (container) container.innerHTML = '';
    });

    window.electronAPI.on('clash-mini-status', applyClashStatus);
    window.electronAPI.on('clash-mini-latency-progress', (payload) => {
      if (payload?.phase === 'done' && Array.isArray(payload.entries)) {
        state.proxyState.current = payload.bestName || state.proxyState.current;
        state.proxyState.proxies = normalizeProxyEntries(payload.entries, state.proxyState.current);
        renderProxyOptions();
      }
    });
    window.electronAPI.on('app-version', (version) => {
      if ($('app-version')) $('app-version').textContent = `v${version}`;
    });
    window.electronAPI.on('update-device-id', (deviceId) => {
      if ($('device-id')) $('device-id').value = deviceId || '';
    });
    window.electronAPI.on('license-credentials-updated', applySavedCredentials);
    window.electronAPI.on('runtime-config-updated', applyRuntimeConfig);
    window.electronAPI.on('account-list-updated', (payload) => {
      renderAccountRecords(payload?.records || []);
    });
    window.electronAPI.on('debug-console-line', appendConsoleLine);
    window.electronAPI.on('debug-console-history', renderConsoleHistory);
  }

  async function boot() {
    bind();
    syncLicenseControls();
    setConnection('VS Code 插件模式', 'status-connected');
    try {
      const [deviceId, version, status, credentialsResp, consoleResp, accountsResp] = await Promise.all([
        invoke('license-get-device-id'),
        invoke('get-app-version'),
        invoke('get-clash-mini-status'),
        invoke('get-user-credentials'),
        invoke('get-debug-console-history'),
        invoke('get-account-records'),
      ]);
      if ($('device-id')) $('device-id').value = deviceId || '';
      if ($('app-version')) $('app-version').textContent = `v${version}`;
      applySavedCredentials(credentialsResp?.credentials || {});
      renderAccountRecords(accountsResp?.records || []);
      renderConsoleHistory(consoleResp?.entries || []);
      applyClashStatus(status);
      refreshConnectionStatus();
      const savedKey = $('key-input')?.value?.trim() || '';
      if (savedKey && !state.validated) {
        setTimeout(() => validateKey().catch(() => {}), 300);
      }
    } catch (error) {
      setConnection('初始化失败', 'status-disconnected');
      showMessage(error.message || String(error), 'error');
    }
  }

  boot();
}());
