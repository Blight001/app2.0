(function initAiFreeBrowserSettingsModule() {
  let loaded = false;
  let current = {};
  let browserHistory = [];
  let selectedHistoryId = '';
  let selectedHistoryIds = new Set();
  let historyRefreshTimer = null;
  let browserSettingsPreviousFocus = null;
  let editingDefaultSettings = false;
  const el = (id) => document.getElementById(id);
  const value = (id, fallback = '') => el(id)?.value ?? fallback;
  const checked = (id) => el(id)?.checked === true;
  const setValue = (id, next) => { if (el(id)) el(id).value = next ?? ''; };
  const setChecked = (id, next) => { if (el(id)) el(id).checked = next === true; };
  const number = (id, fallback = 0) => Number.isFinite(Number(value(id))) ? Number(value(id)) : fallback;
  const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
  const randomSeed = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const readPath = (source, path) => path.split('.').reduce((result, key) => result?.[key], source);
  const writePath = (source, path, next) => {
    const keys = path.split('.'); let target = source;
    keys.slice(0, -1).forEach((key) => { target[key] ||= {}; target = target[key]; });
    target[keys.at(-1)] = next;
  };

  function setStatus(message, type = '') {
    const target = el('ai-free-settings-status'); if (!target) return;
    target.textContent = String(message || '');
    target.classList.toggle('is-error', type === 'error');
    target.classList.toggle('is-success', type === 'success');
  }

  function openBrowserSettingsDialog(title = '浏览器参数配置') {
    const dialog = el('browser-settings-dialog');
    if (!dialog) return;
    browserSettingsPreviousFocus = document.activeElement;
    const titleElement = el('browser-settings-dialog-title');
    if (titleElement) titleElement.textContent = title;
    dialog.hidden = false;
    document.body.classList.add('browser-settings-dialog-open');
    setTimeout(() => el('browser-settings-dialog-close')?.focus(), 0);
  }

  function closeBrowserSettingsDialog() {
    const dialog = el('browser-settings-dialog');
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    document.body.classList.remove('browser-settings-dialog-open');
    browserSettingsPreviousFocus?.focus?.();
    browserSettingsPreviousFocus = null;
  }

  function renderBrowserHistory() {
    const list = el('browser-history-list');
    if (!list) return;
    list.replaceChildren();
    if (!browserHistory.length) {
      const empty = document.createElement('div');
      empty.className = 'browser-history-empty';
      empty.textContent = '暂无浏览器记录，点击窗口栏的“+”新建。';
      list.appendChild(empty);
      return;
    }
    browserHistory.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'browser-history-item';
      row.classList.toggle('is-selected', selectedHistoryIds.has(item.id));
      row.classList.toggle('is-open', item.isOpen === true);
      row.classList.toggle('is-active', item.isActive === true);
      row.classList.toggle('has-error', !!item.lastError);
      row.dataset.historyId = item.id;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'browser-history-main';
      main.title = `${item.name || '未命名浏览器'}（单击选择，右键批量操作）`;
      main.setAttribute('aria-pressed', selectedHistoryIds.has(item.id) ? 'true' : 'false');
      main.setAttribute('aria-label', `${item.name || '未命名浏览器'}，${item.isActive ? '当前浏览器' : (item.isOpen ? '已打开' : '已关闭')}，点击选择`);
      const name = document.createElement('span');
      name.className = 'browser-history-name';
      name.textContent = item.name || '未命名浏览器';
      main.append(name);
      const accountMetaParts = [];
      if (item.accountDisplayName) accountMetaParts.push(`账号：${item.accountDisplayName}`);
      if (item.accountTypeLabel) accountMetaParts.push(item.accountTypeLabel);
      if (accountMetaParts.length) {
        const accountMeta = document.createElement('span');
        accountMeta.className = 'browser-history-account-meta';
        accountMeta.textContent = accountMetaParts.join(' · ');
        main.append(accountMeta);
      }
      if (item.accountType === 'shared') {
        const autoDelete = document.createElement('span');
        autoDelete.className = 'browser-history-account-meta browser-history-auto-delete';
        autoDelete.textContent = `自动删除：${formatBrowserHistoryDateTime(item.autoDeleteAt) || '等待服务器同步'}`;
        main.append(autoDelete);
      }
      main.addEventListener('click', () => toggleBrowserHistorySelection(item.id));

      const actions = document.createElement('div');
      actions.className = 'browser-history-actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'browser-history-action browser-history-open';
      open.textContent = '打开';
      open.title = '打开浏览器';
      open.addEventListener('click', () => void openBrowserHistory(item.id));
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'browser-history-action';
      rename.textContent = '重命名';
      rename.addEventListener('click', () => void renameBrowserHistory(item));
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'browser-history-action';
      configure.textContent = '参数';
      configure.addEventListener('click', () => void selectBrowserHistory(item.id, { openDialog: true }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'browser-history-action browser-history-delete';
      remove.textContent = '删除';
      remove.title = item.isOpen ? '关闭窗口并删除记录' : '删除浏览器记录';
      remove.addEventListener('click', () => void deleteBrowserHistory(item));
      actions.append(open, rename, configure, remove);
      row.append(main, actions);
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (!selectedHistoryIds.has(item.id)) selectedHistoryIds = new Set([item.id]);
        renderBrowserHistory();
        showBrowserHistoryContextMenu(event.clientX, event.clientY);
      });
      list.appendChild(row);
    });
  }

  function getSelectedBrowserHistory() {
    return browserHistory.filter((item) => selectedHistoryIds.has(item.id));
  }

  function toggleBrowserHistorySelection(historyId) {
    const id = String(historyId || '');
    if (!id) return;
    const next = new Set(selectedHistoryIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedHistoryIds = next;
    hideBrowserHistoryContextMenu();
    renderBrowserHistory();
  }

  function ensureBrowserHistoryContextMenu() {
    let menu = el('browser-history-context-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'browser-history-context-menu';
    menu.className = 'browser-history-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
      <div class="browser-history-context-summary"></div>
      <button type="button" role="menuitem" data-browser-history-command="open">批量打开</button>
      <button type="button" role="menuitem" data-browser-history-command="rename">批量重命名</button>
      <button type="button" role="menuitem" class="is-danger" data-browser-history-command="delete">批量删除</button>
    `;
    menu.addEventListener('click', (event) => {
      const command = event.target.closest('[data-browser-history-command]')?.dataset.browserHistoryCommand;
      if (!command) return;
      hideBrowserHistoryContextMenu();
      if (command === 'open') void openSelectedBrowserHistory();
      if (command === 'rename') renameSelectedBrowserHistory();
      if (command === 'delete') deleteSelectedBrowserHistory();
    });
    document.body.appendChild(menu);
    return menu;
  }

  function hideBrowserHistoryContextMenu() {
    const menu = el('browser-history-context-menu');
    if (!menu) return;
    menu.classList.remove('is-visible');
    menu.setAttribute('aria-hidden', 'true');
  }

  function showBrowserHistoryContextMenu(x, y) {
    const items = getSelectedBrowserHistory();
    if (!items.length) return;
    const menu = ensureBrowserHistoryContextMenu();
    const summary = menu.querySelector('.browser-history-context-summary');
    if (summary) summary.textContent = `已选择 ${items.length} 个浏览器`;
    menu.querySelectorAll('[data-browser-history-command]').forEach((button) => {
      const label = button.dataset.browserHistoryCommand === 'open'
        ? '打开'
        : button.dataset.browserHistoryCommand === 'rename' ? '重命名' : '删除';
      button.textContent = `${label}选中项（${items.length}）`;
    });
    menu.classList.add('is-visible');
    menu.setAttribute('aria-hidden', 'false');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }

  function formatBrowserHistoryDateTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function refreshBrowserHistory(options = {}) {
    try {
      const response = await window.electronAPI.invoke('get-browser-history');
      if (!response?.ok) throw new Error(response?.error || '读取浏览器记录失败');
      browserHistory = Array.isArray(response.history) ? response.history : [];
      const availableIds = new Set(browserHistory.map((item) => item.id));
      selectedHistoryIds = new Set([...selectedHistoryIds].filter((id) => availableIds.has(id)));
      const keepEmptySelection = !selectedHistoryId && (options.keepEmptySelection === true || editingDefaultSettings);
      if (!keepEmptySelection && (options.keepSelection !== true || !browserHistory.some((item) => item.id === selectedHistoryId))) {
        selectedHistoryId = browserHistory.find((item) => item.isActive)?.id || browserHistory[0]?.id || '';
      }
      renderBrowserHistory();
      return browserHistory;
    } catch (error) {
      const list = el('browser-history-list');
      if (list) list.innerHTML = '<div class="browser-history-empty">浏览器记录读取失败</div>';
      if (options.silent !== true) setStatus(error?.message || String(error), 'error');
      return [];
    }
  }

  async function selectBrowserHistory(historyId, options = {}) {
    editingDefaultSettings = false;
    selectedHistoryId = String(historyId || '');
    renderBrowserHistory();
    const item = browserHistory.find((entry) => entry.id === selectedHistoryId);
    if (options.openDialog === true) {
      openBrowserSettingsDialog(item ? `${item.name} · 参数配置` : '浏览器参数配置');
    }
    setStatus('正在读取独立浏览器参数…');
    try {
      const response = await window.electronAPI.invoke('get-ai-free-browser-settings', { historyId: selectedHistoryId });
      if (!response?.ok) throw new Error(response?.error || '读取参数失败');
      fillForm(response.settings, response.runtimeInfo);
      setStatus('已载入该浏览器的独立参数');
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    }
  }

  async function openDefaultBrowserSettings() {
    editingDefaultSettings = true;
    selectedHistoryId = '';
    renderBrowserHistory();
    openBrowserSettingsDialog('浏览器默认环境配置');
    setStatus('正在读取默认环境参数…');
    try {
      const response = await window.electronAPI.invoke('get-ai-free-browser-settings', {});
      if (!response?.ok) throw new Error(response?.error || '读取默认参数失败');
      fillForm(response.settings, response.runtimeInfo);
      setStatus('已载入浏览器默认环境参数');
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    }
  }

  async function openBrowserHistory(historyId) {
    setStatus('正在打开浏览器…');
    try {
      const response = await window.electronAPI.invoke('open-browser-history', { historyId });
      if (!response?.ok) throw new Error(response?.error || '打开浏览器失败');
      await refreshBrowserHistory({ keepSelection: true, silent: true });
      setStatus(`已打开“${response.name || '浏览器'}”`, 'success');
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    }
  }

  async function renameBrowserHistory(item) {
    if (!window.MessageModal?.showPromptDialog) {
      setStatus('软件重命名弹窗未就绪', 'error');
      return;
    }
    window.MessageModal.showPromptDialog(
      '请输入新的浏览器名称',
      item?.name || '新建窗口',
      async (requestedName) => {
        try {
          const response = await window.electronAPI.invoke('rename-browser-history', { historyId: item.id, name: requestedName });
          if (!response?.ok) throw new Error(response?.error || '重命名失败');
          selectedHistoryId = item.id;
          selectedHistoryIds = new Set([item.id]);
          await refreshBrowserHistory({ keepSelection: true, silent: true });
          setStatus(`已重命名为“${response.name}”`, 'success');
        } catch (error) {
          setStatus(error?.message || String(error), 'error');
          throw error;
        }
      },
      null,
      { title: '重命名浏览器', confirmText: '保存', maxLength: 80 },
    );
  }

  async function deleteBrowserHistory(item) {
    const name = String(item?.name || '新建窗口');
    const message = item?.isOpen
      ? `确认关闭“${name}”并删除该条浏览器记录？`
      : `确认删除“${name}”的浏览器记录？`;
    if (!window.MessageModal?.showConfirmDialog) {
      setStatus('软件确认弹窗未就绪', 'error');
      return;
    }
    window.MessageModal.showConfirmDialog(message, async () => {
      setStatus(`正在删除“${name}”…`);
      try {
        const response = await window.electronAPI.invoke('delete-browser-history', { historyId: item.id });
        if (!response?.ok) throw new Error(response?.error || '删除失败');
        if (selectedHistoryId === item.id) selectedHistoryId = '';
        selectedHistoryIds.delete(item.id);
        await refreshBrowserHistory({ silent: true });
        if (selectedHistoryId) {
          await selectBrowserHistory(selectedHistoryId);
        }
        setStatus(`已删除“${response.name || name}”`, 'success');
      } catch (error) {
        setStatus(error?.message || String(error), 'error');
      }
    }, null, 'warning');
  }

  async function openSelectedBrowserHistory() {
    const items = getSelectedBrowserHistory();
    if (!items.length) return;
    setStatus(`正在打开 ${items.length} 个浏览器…`);
    const failed = [];
    for (const item of items) {
      try {
        const response = await window.electronAPI.invoke('open-browser-history', { historyId: item.id });
        if (!response?.ok) throw new Error(response?.error || '打开失败');
      } catch (error) {
        failed.push(`${item.name}：${error?.message || String(error)}`);
      }
    }
    await refreshBrowserHistory({ keepSelection: true, silent: true });
    if (failed.length) {
      setStatus(`已打开 ${items.length - failed.length} 个，失败 ${failed.length} 个：${failed.join('；')}`, 'error');
    } else {
      setStatus(`已打开 ${items.length} 个浏览器`, 'success');
    }
  }

  function renameSelectedBrowserHistory() {
    const items = getSelectedBrowserHistory();
    if (!items.length) return;
    if (!window.MessageModal?.showPromptDialog) {
      setStatus('软件重命名弹窗未就绪', 'error');
      return;
    }
    const initialName = items.length === 1
      ? items[0].name
      : String(items[0].name || '新建窗口').replace(/\[\d+\]$/, '');
    const message = items.length === 1
      ? '请输入新的浏览器名称'
      : `请输入名称前缀，${items.length} 个浏览器将依次命名为“名称[1]”到“名称[${items.length}]”`;
    window.MessageModal.showPromptDialog(message, initialName, async (requestedName) => {
      const baseName = String(requestedName || '').trim();
      setStatus(`正在重命名 ${items.length} 个浏览器…`);
      try {
        const response = await window.electronAPI.invoke('rename-browser-history-batch', {
          historyIds: items.map((item) => item.id),
          baseName,
        });
        if (!response?.ok) throw new Error(response?.error || '批量重命名失败');
        await refreshBrowserHistory({ keepSelection: true, silent: true });
        setStatus(items.length === 1 ? `已重命名为“${baseName}”` : `已按“${baseName}[n]”重命名 ${items.length} 个浏览器`, 'success');
      } catch (error) {
        setStatus(error?.message || String(error), 'error');
        throw error;
      }
    }, null, { title: items.length === 1 ? '重命名浏览器' : '批量重命名浏览器', confirmText: '保存', maxLength: 70 });
  }

  function deleteSelectedBrowserHistory() {
    const items = getSelectedBrowserHistory();
    if (!items.length) return;
    if (!window.MessageModal?.showConfirmDialog) {
      setStatus('软件确认弹窗未就绪', 'error');
      return;
    }
    const openCount = items.filter((item) => item.isOpen).length;
    const detail = openCount ? `，其中 ${openCount} 个已打开的窗口会先关闭` : '';
    window.MessageModal.showConfirmDialog(`确认删除选中的 ${items.length} 条浏览器记录${detail}？`, async () => {
      const failed = [];
      setStatus(`正在删除 ${items.length} 个浏览器…`);
      for (const item of items) {
        try {
          const response = await window.electronAPI.invoke('delete-browser-history', { historyId: item.id });
          if (!response?.ok) throw new Error(response?.error || '删除失败');
          selectedHistoryIds.delete(item.id);
          if (selectedHistoryId === item.id) selectedHistoryId = '';
        } catch (error) {
          failed.push(`${item.name}：${error?.message || String(error)}`);
        }
      }
      await refreshBrowserHistory({ keepSelection: true, silent: true });
      if (failed.length) {
        setStatus(`已删除 ${items.length - failed.length} 个，失败 ${failed.length} 个：${failed.join('；')}`, 'error');
      } else {
        setStatus(`已删除 ${items.length} 个浏览器`, 'success');
      }
    }, null, 'warning');
  }

  function scheduleBrowserHistoryRefresh() {
    clearTimeout(historyRefreshTimer);
    historyRefreshTimer = setTimeout(() => void refreshBrowserHistory({ keepSelection: true, silent: true }), 120);
  }

  function setSegment(path, next) {
    document.querySelectorAll(`.segmented[data-field="${path}"] button`).forEach((button) => {
      button.classList.toggle('active', button.dataset.value === String(next));
    });
    writePath(current, path, next === 'true' ? true : next === 'false' ? false : next);
    syncConditionalFields();
  }

  function getSegment(path, fallback = '') {
    return document.querySelector(`.segmented[data-field="${path}"] button.active`)?.dataset.value ?? fallback;
  }

  function syncConditionalFields() {
    if (el('custom-proxy-fields')) el('custom-proxy-fields').hidden = getSegment('proxy.mode') !== 'custom';
    if (el('homepage-url')) el('homepage-url').hidden = getSegment('homepage.mode') !== 'custom';
    if (el('browser-user-agent')) el('browser-user-agent').disabled = getSegment('ua.mode') !== 'custom';
    if (el('sec-ch-ua-brands')) el('sec-ch-ua-brands').hidden = getSegment('secChUa.mode') !== 'custom';
    if (el('browser-locale')) el('browser-locale').hidden = checked('language-by-ip');
    if (el('browser-timezone')) el('browser-timezone').hidden = checked('timezone-by-ip');
    if (el('custom-geolocation')) el('custom-geolocation').hidden = checked('geolocation-by-ip') || getSegment('geolocation.permission') === 'block';
    if (el('custom-resolution')) el('custom-resolution').hidden = getSegment('resolution.mode') !== 'custom';
    if (el('webgl-metadata-fields')) el('webgl-metadata-fields').hidden = getSegment('webglMetadata.mode') !== 'custom';
    if (el('launch-args')) el('launch-args').hidden = getSegment('launchArgs.mode') !== 'custom';
  }

  function fillVersions(runtimeInfo = {}, settings = {}) {
    const major = Number(String(runtimeInfo.chromiumVersion || '').split('.')[0]) || 147;
    const browserSelect = el('browser-version');
    if (browserSelect && browserSelect.options.length <= 1) {
      Array.from(new Set([major + 2, major + 1, major, major - 1, major - 2, 147].filter((item) => item > 80)))
        .sort((a, b) => b - a).forEach((item) => browserSelect.add(new Option(String(item), String(item))));
    }
    const kernelSelect = el('kernel-version');
    if (kernelSelect && runtimeInfo.chromiumVersion && kernelSelect.options.length <= 1) {
      kernelSelect.add(new Option(`当前内核 ${runtimeInfo.chromiumVersion}`, runtimeInfo.chromiumVersion));
    }
    setValue('browser-version', settings.browserVersion || '');
    setValue('kernel-version', settings.kernelVersion || 'auto');
  }

  function fillForm(settings, runtimeInfo = {}) {
    current = JSON.parse(JSON.stringify(settings || {}));
    ['os','proxy.mode','homepage.mode','ua.mode','secChUa.mode','webrtc.mode','geolocation.permission','resolution.mode','fonts.mode','canvas.mode','webglImage.mode','webglMetadata.mode','webgpu.mode','audioContext.mode','clientRects.mode','speechVoices.mode','deviceName.mode','macAddress.mode','sslEnabled','portScanProtection.enabled','launchArgs.mode']
      .forEach((path) => setSegment(path, readPath(current, path)));
    fillVersions(runtimeInfo, current);
    setValue('proxy-protocol', current.proxy?.protocol); setValue('proxy-host', current.proxy?.host); setValue('proxy-port', current.proxy?.port);
    setValue('proxy-username', current.proxy?.username); setValue('proxy-password', current.proxy?.password); setValue('proxy-api-url', current.proxy?.apiUrl);
    setValue('browser-cookies', current.cookies || '[]'); setValue('homepage-url', current.homepage?.url);
    setValue('browser-user-agent', current.ua?.value); setValue('sec-ch-ua-brands', JSON.stringify(current.secChUa?.brands || [], null, 2));
    setChecked('language-by-ip', current.language?.mode === 'ip'); setValue('browser-locale', current.language?.value);
    setChecked('timezone-by-ip', current.timezone?.mode === 'ip'); setValue('browser-timezone', current.timezone?.value);
    setChecked('geolocation-by-ip', current.geolocation?.mode === 'ip'); setValue('geo-longitude', current.geolocation?.longitude); setValue('geo-latitude', current.geolocation?.latitude); setValue('geo-accuracy', current.geolocation?.accuracy);
    setValue('resolution-width', current.resolution?.width); setValue('resolution-height', current.resolution?.height);
    setValue('browser-webgl-vendor', current.webglMetadata?.vendor); setValue('browser-webgl-renderer', current.webglMetadata?.renderer);
    setValue('browser-cpu', current.cpu); setValue('browser-memory', current.memory); setValue('device-name', current.deviceName?.value); setValue('mac-address', current.macAddress?.value);
    setChecked('do-not-track', current.doNotTrack); setValue('port-scan-allow-list', (current.portScanProtection?.allowList || []).join(',')); setChecked('hardware-acceleration', current.hardwareAcceleration);
    setValue('launch-args', current.launchArgs?.value); syncConditionalFields();
  }

  function collectForm() {
    let brands = []; try { brands = JSON.parse(value('sec-ch-ua-brands', '[]')); } catch (_) { brands = []; }
    const setting = {
      ...current, os: getSegment('os', 'win11'), browserVersion: value('browser-version'), kernelVersion: value('kernel-version', 'auto'),
      proxy: { mode: getSegment('proxy.mode','default'), protocol: value('proxy-protocol','http'), host: value('proxy-host'), port: value('proxy-port'), username: value('proxy-username'), password: value('proxy-password'), apiUrl: value('proxy-api-url') },
      cookies: value('browser-cookies','[]'), homepage: { mode: getSegment('homepage.mode','default'), url: value('homepage-url') },
      ua: { mode: getSegment('ua.mode','default'), value: value('browser-user-agent') }, secChUa: { mode: getSegment('secChUa.mode','default'), brands },
      language: { mode: checked('language-by-ip') ? 'ip' : 'custom', value: value('browser-locale') }, timezone: { mode: checked('timezone-by-ip') ? 'ip' : 'custom', value: value('browser-timezone') },
      webrtc: { mode: getSegment('webrtc.mode','replace') }, geolocation: { permission: getSegment('geolocation.permission','ask'), mode: checked('geolocation-by-ip') ? 'ip' : 'custom', longitude: number('geo-longitude'), latitude: number('geo-latitude'), accuracy: number('geo-accuracy',100) },
      resolution: { mode: getSegment('resolution.mode','follow'), width: number('resolution-width',1366), height: number('resolution-height',768) },
      fonts: { mode: getSegment('fonts.mode','system'), seed: current.fonts?.seed }, canvas: { mode: getSegment('canvas.mode','noise'), seed: current.canvas?.seed },
      webglImage: { mode: getSegment('webglImage.mode','noise'), seed: current.webglImage?.seed }, webglMetadata: { mode: getSegment('webglMetadata.mode','custom'), vendor: value('browser-webgl-vendor'), renderer: value('browser-webgl-renderer') },
      webgpu: { mode: getSegment('webgpu.mode','webgl') }, audioContext: { mode: getSegment('audioContext.mode','noise'), seed: current.audioContext?.seed }, clientRects: { mode: getSegment('clientRects.mode','noise'), seed: current.clientRects?.seed }, speechVoices: { mode: getSegment('speechVoices.mode','noise'), seed: current.speechVoices?.seed },
      cpu: number('browser-cpu',8), memory: number('browser-memory',8), deviceName: { mode: getSegment('deviceName.mode','default'), value: value('device-name') }, macAddress: { mode: getSegment('macAddress.mode','default'), value: value('mac-address') },
      doNotTrack: checked('do-not-track'), sslEnabled: getSegment('sslEnabled') === 'true', portScanProtection: { enabled: getSegment('portScanProtection.enabled') === 'true', allowList: value('port-scan-allow-list').split(/[\s,;]+/).filter(Boolean) }, hardwareAcceleration: checked('hardware-acceleration'), launchArgs: { mode: getSegment('launchArgs.mode','default'), value: value('launch-args') },
    };
    return setting;
  }

  function validateSettings(setting) {
    let cookies;
    try { cookies = JSON.parse(String(setting.cookies || '[]')); } catch (_) { throw new Error('Cookie 必须是有效的 JSON 数组'); }
    if (!Array.isArray(cookies)) throw new Error('Cookie 顶层必须是数组');
    if (setting.secChUa?.mode === 'custom') {
      try { if (!Array.isArray(JSON.parse(value('sec-ch-ua-brands', '[]')))) throw new Error(); } catch (_) { throw new Error('Sec-CH-UA 必须是有效的 JSON 数组'); }
    }
    if (setting.proxy?.mode === 'custom' && (!setting.proxy.host || !Number(setting.proxy.port))) throw new Error('自定义代理需要填写主机和端口');
    if (setting.ua?.mode === 'custom' && !String(setting.ua.value || '').trim()) throw new Error('自定义 User Agent 不能为空');
    if (setting.homepage?.mode === 'custom') {
      try { const parsed = new URL(setting.homepage.url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); } catch (_) { throw new Error('启动主页必须是有效的 HTTP/HTTPS 地址'); }
    }
    if (setting.macAddress?.mode === 'custom' && !/^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$/i.test(setting.macAddress.value || '')) throw new Error('MAC 地址格式不正确');
  }

  function randomIdentity() {
    const os = randomItem(['win10','win11']); const version = randomItem([145,146,147,148,149,150]);
    setSegment('os', os); setValue('browser-version', version); setSegment('ua.mode','custom');
    setSegment('secChUa.mode','custom'); setSegment('webglMetadata.mode','custom'); setSegment('deviceName.mode','custom'); setSegment('macAddress.mode','custom');
    setValue('browser-user-agent', `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`);
    setValue('sec-ch-ua-brands', JSON.stringify([{brand:'Chromium',version:String(version)},{brand:'Google Chrome',version:String(version)},{brand:'Not_A Brand',version:'24'}], null, 2));
    const gpu = randomItem([['Google Inc. (Intel)','ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],['Google Inc. (NVIDIA)','ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)'],['Google Inc. (AMD)','ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)']]);
    setValue('browser-webgl-vendor',gpu[0]); setValue('browser-webgl-renderer',gpu[1]); setValue('browser-cpu',randomItem([4,6,8,12,16])); setValue('browser-memory',randomItem([4,8,16,32]));
    ['fonts','canvas','webglImage','audioContext','clientRects','speechVoices'].forEach((key) => { current[key] ||= {}; current[key].seed = randomSeed(); });
    setValue('device-name', `DESKTOP-${Math.random().toString(36).slice(2,9).toUpperCase()}`); setValue('mac-address', Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('-').toUpperCase());
    setStatus('已生成一组匹配的系统、UA、硬件与噪声种子。');
  }

  async function loadSettings(force = false) {
    if (loaded && !force) return; setStatus('正在读取本地参数…');
    try { await refreshBrowserHistory({ silent: true }); const response = await window.electronAPI.invoke('get-ai-free-browser-settings', selectedHistoryId ? { historyId: selectedHistoryId } : {}); if (!response?.ok) throw new Error(response?.error || '读取参数失败'); fillForm(response.settings,response.runtimeInfo); loaded = true; setStatus('参数已从本机载入'); } catch (error) { setStatus(error?.message || String(error),'error'); }
  }

  async function saveSettings(event) {
    event?.preventDefault?.();
    // 表单内包含羊毛资源等非配置按钮，仅“保存参数”按钮可触发保存
    if(event?.submitter&&event.submitter.id!=='save-ai-free-settings')return;
    const button=el('save-ai-free-settings'); if(button)button.disabled=true; setStatus('正在保存并应用…');
    try { const targetHistoryId=editingDefaultSettings?'':selectedHistoryId;const settings=collectForm();validateSettings(settings);const response=await window.electronAPI.invoke('set-ai-free-browser-settings',{settings,historyId:targetHistoryId,applyToActive:checked('apply-settings-to-active'),restartChromium:checked('restart-chromium-settings')}); if(!response?.ok)throw new Error(response?.error||'保存失败'); fillForm(response.settings,response.runtimeInfo); await refreshBrowserHistory({keepSelection:true,keepEmptySelection:!targetHistoryId,silent:true}); const result=response.activeResult; setStatus(result?.restarted?'已保存并重启 Chromium 环境。':result?.restartRequired?'已保存独立参数；部分内核项需重启后生效。':result?.applied?'已保存并应用到该浏览器。':targetHistoryId?'已保存该浏览器的独立参数。':'已保存为默认环境配置。','success'); } catch(error){setStatus(error?.message||String(error),'error');} finally{if(button)button.disabled=false;}
  }

  async function resetSettings(){try{const targetHistoryId=editingDefaultSettings?'':selectedHistoryId;const response=await window.electronAPI.invoke('reset-ai-free-browser-settings',{historyId:targetHistoryId,applyToActive:checked('apply-settings-to-active'),restartChromium:checked('restart-chromium-settings')});if(response?.ok){fillForm(response.settings,response.runtimeInfo);await refreshBrowserHistory({keepSelection:true,keepEmptySelection:!targetHistoryId,silent:true});setStatus(targetHistoryId?'该浏览器已恢复默认配置。':'已恢复默认配置。','success');}else throw new Error(response?.error||'恢复默认失败');}catch(error){setStatus(error?.message||String(error),'error');}}
  async function testProxy(){setStatus('正在检测代理…');const response=await window.electronAPI.invoke('test-ai-free-proxy',{proxy:collectForm().proxy});setStatus(response?.ok?`代理可用：${response.ip||'连接成功'}（${response.elapsedMs||0}ms）`:response?.error||'代理不可用',response?.ok?'success':'error');}
  async function extractProxy(){const response=await window.electronAPI.invoke('extract-ai-free-proxy',{apiUrl:value('proxy-api-url')});if(response?.ok){setValue('proxy-protocol',response.proxy.protocol);setValue('proxy-host',response.proxy.host);setValue('proxy-port',response.proxy.port);setValue('proxy-username',response.proxy.username);setValue('proxy-password',response.proxy.password);setStatus('已从 API 提取代理。','success');}else setStatus(response?.error||'提取代理失败','error');}

  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.segmented').forEach((group)=>group.addEventListener('click',(event)=>{const button=event.target.closest('button[data-value]');if(button)setSegment(group.dataset.field,button.dataset.value);}));
    ['language-by-ip','timezone-by-ip','geolocation-by-ip'].forEach((id)=>el(id)?.addEventListener('change',syncConditionalFields));
    el('ai-free-settings-form')?.addEventListener('submit',saveSettings); el('randomize-ai-free-settings')?.addEventListener('click',randomIdentity); el('randomize-user-agent')?.addEventListener('click',randomIdentity); el('reset-ai-free-settings')?.addEventListener('click',()=>void resetSettings());
    el('test-ai-free-proxy')?.addEventListener('click',()=>void testProxy()); el('extract-ai-free-proxy')?.addEventListener('click',()=>void extractProxy());
    el('refresh-browser-history')?.addEventListener('click',()=>void refreshBrowserHistory({keepSelection:true}));
    el('open-default-browser-settings')?.addEventListener('click',()=>void openDefaultBrowserSettings());
    document.querySelectorAll('[data-browser-settings-close]').forEach((element)=>element.addEventListener('click',closeBrowserSettingsDialog));
    document.querySelectorAll('[data-random-target]').forEach((button)=>button.addEventListener('click',()=>{if(button.dataset.randomTarget==='device-name')setValue('device-name',`DESKTOP-${Math.random().toString(36).slice(2,9).toUpperCase()}`);else setValue('mac-address',Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('-').toUpperCase());}));
    document.querySelector('[data-tab="ai-free-settings-panel"]')?.addEventListener('click',()=>void loadSettings());
    window.electronAPI?.on?.('update-tabs', scheduleBrowserHistoryRefresh);
    window.electronAPI?.on?.('browser-history-changed', scheduleBrowserHistoryRefresh);
    window.electronAPI?.on?.('account-list-updated', scheduleBrowserHistoryRefresh);
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#browser-history-context-menu')) hideBrowserHistoryContextMenu();
    });
    window.addEventListener('blur', hideBrowserHistoryContextMenu);
    window.addEventListener('resize', hideBrowserHistoryContextMenu);
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape'){hideBrowserHistoryContextMenu();if(!el('browser-settings-dialog')?.hidden)closeBrowserSettingsDialog();}});
  });
}());
