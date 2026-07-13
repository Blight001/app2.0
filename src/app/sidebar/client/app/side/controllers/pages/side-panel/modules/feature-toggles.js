// 创建/初始化：initPluginSwitches的具体业务逻辑。
async function initPluginSwitches() {
  const extensionList = safeGetEl('extension-plugin-list');

  let extensionState = {
    developerModeEnabled: true,
    plugins: [],
  };

  const showError = (message) => {
    window.MessageModal?.showErrorMessage?.(message || '操作失败');
  };

  const showSuccess = (message) => {
    window.MessageModal?.showSuccessMessage?.(message || '操作成功');
  };

  const normalizeExtensionState = (state = {}) => ({
    developerModeEnabled: true,
    plugins: Array.isArray(state.plugins) ? state.plugins : [],
  });

  const renderExtensionList = () => {
    if (!extensionList) return;

    const plugins = extensionState.plugins;
    if (!plugins.length) {
      extensionList.innerHTML = '<div class="extension-plugin-empty">暂无插件</div>';
      return;
    }

    extensionList.innerHTML = plugins.map((plugin) => {
      const id = escapeHtml(plugin.id || '');
      const name = escapeHtml(plugin.name || '未命名插件');
      const hint = escapeHtml(plugin.hint || plugin.description || plugin.rawName || '');
      const version = plugin.version ? ` v${escapeHtml(plugin.version)}` : '';
      const icon = plugin.iconDataUrl
        ? `<img class="extension-plugin-icon-img" src="${escapeHtml(plugin.iconDataUrl)}" alt="">`
        : `<span class="extension-plugin-icon-fallback">${escapeHtml((plugin.name || '?').trim().slice(0, 1).toUpperCase() || '?')}</span>`;
      const disabledClass = plugin.enabled === true ? '' : ' is-disabled';
      const missingClass = plugin.missing === true ? ' is-missing' : '';

      return `
        <div class="extension-plugin-row${disabledClass}${missingClass}" data-extension-id="${id}">
          <div class="extension-plugin-info">
            <span class="extension-plugin-icon">${icon}</span>
            <span class="extension-plugin-meta">
              <span class="extension-plugin-name">${name}${version}</span>
              ${hint ? `<span class="extension-plugin-hint">${hint}</span>` : ''}
            </span>
          </div>
          <label class="plugin-switch extension-plugin-enable" title="启用/禁用插件">
            <input type="checkbox" class="extension-plugin-enabled-switch" ${plugin.enabled === true ? 'checked' : ''} ${plugin.missing === true ? 'disabled' : ''} />
            <span class="plugin-switch-slider"></span>
          </label>
        </div>
      `;
    }).join('');
  };

  const loadExtensionState = async () => {
    if (!extensionList) return;
    try {
      const result = await window.electronAPI.invoke('get-extension-manager-state');
      if (!result?.ok) {
        throw new Error(result?.message || result?.error || '插件管理器不可用');
      }
      extensionState = normalizeExtensionState(result.state);
    } catch (e) {
      console.warn('[侧边栏] 获取插件列表失败:', e);
      extensionState = { developerModeEnabled: true, plugins: [] };
      extensionList.innerHTML = '<div class="extension-plugin-empty">插件管理器不可用</div>';
      return;
    }
    renderExtensionList();
  };

  const setExtensionEnabled = async (id, enabled, inputEl) => {
    if (!id) return;
    if (inputEl) inputEl.disabled = true;
    try {
      const resp = await window.electronAPI.invoke('set-extension-enabled', { id, enabled });
      if (!resp?.ok) {
        throw new Error(resp?.message || resp?.error || '更新插件开关失败');
      }
      extensionState = normalizeExtensionState(resp.state);
      renderExtensionList();
      const refresh = resp.browserRefresh;
      if (refresh && refresh.ok === false) {
        const failed = Array.isArray(refresh.failures) ? refresh.failures.length : 0;
        showError(`插件已${enabled ? '启用' : '禁用'}，但有 ${failed || '部分'} 个浏览器刷新失败，请手动刷新或重启该环境`);
        return;
      }
      const refreshed = Number(refresh?.total || 0);
      const chromium = Number(refresh?.chromiumRestarted || 0);
      const suffix = refreshed > 0
        ? `，已刷新 ${refreshed} 个浏览器${chromium > 0 ? `（含 ${chromium} 个 Chromium 环境重启）` : ''}`
        : '，新打开的浏览器将使用此状态';
      showSuccess(`${enabled ? '插件已启用' : '插件已禁用'}${suffix}`);
    } catch (e) {
      await loadExtensionState();
      showError(e?.message || String(e));
    }
  };

  if (extensionList) {
    extensionList.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.classList?.contains('extension-plugin-enabled-switch')) return;
      const row = target.closest('.extension-plugin-row');
      setExtensionEnabled(row?.dataset?.extensionId || '', !!target.checked, target);
    });
  }

  try {
    window.electronAPI?.on?.('extension-manager-state', (nextState) => {
      extensionState = normalizeExtensionState(nextState);
      renderExtensionList();
    });
  } catch (_) {}

  await loadExtensionState();
}
