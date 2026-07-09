// 创建/初始化：initPluginSwitches的具体业务逻辑。
async function initPluginSwitches() {
  const extensionList = safeGetEl('extension-plugin-list');
  const extensionPanel = safeGetEl('extension-sidebar-panel');
  const extensionPanelTitle = safeGetEl('extension-sidebar-panel-title');
  const extensionPanelSubtitle = safeGetEl('extension-sidebar-panel-subtitle');
  const extensionPanelStatus = safeGetEl('extension-sidebar-panel-status');
  const extensionPanelCloseBtn = safeGetEl('extension-sidebar-panel-close');

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

  const getPanelSubtitle = (pageType) => (pageType === 'options' ? '插件设置' : '插件弹窗');

  const applyExtensionPanelDimensions = (dimensions = {}) => {
    if (!extensionPanel || !dimensions || typeof dimensions !== 'object') return;
    const width = Math.round(Number(dimensions.width || 0));
    const height = Math.round(Number(dimensions.height || 0));
    if (Number.isFinite(width) && width > 0) {
      extensionPanel.style.setProperty('--extension-sidebar-panel-width', `${width}px`);
    }
    if (Number.isFinite(height) && height > 0) {
      extensionPanel.style.setProperty('--extension-sidebar-panel-height', `${height}px`);
    }
  };

  const showExtensionPanel = (plugin, pageType = 'popup', status = '正在加载...', dimensions = null) => {
    if (!extensionPanel) return;
    const title = pageType === 'options'
      ? `${plugin?.name || '插件'} 设置`
      : (plugin?.name || '插件');
    if (extensionPanelTitle) extensionPanelTitle.textContent = title;
    if (extensionPanelSubtitle) extensionPanelSubtitle.textContent = getPanelSubtitle(pageType);
    if (extensionPanelStatus) extensionPanelStatus.textContent = status;
    if (dimensions) applyExtensionPanelDimensions(dimensions);
    extensionPanel.hidden = false;
    extensionPanel.dataset.extensionId = plugin?.id || '';
    extensionPanel.dataset.pageType = pageType;
  };

  const hideExtensionPanel = () => {
    if (!extensionPanel) return;
    extensionPanel.hidden = true;
    extensionPanel.dataset.extensionId = '';
    extensionPanel.dataset.pageType = '';
    extensionPanel.style.removeProperty('--extension-sidebar-panel-width');
    extensionPanel.style.removeProperty('--extension-sidebar-panel-height');
    if (extensionPanelStatus) extensionPanelStatus.textContent = '正在加载...';
  };

  const closeExtensionPanel = async () => {
    hideExtensionPanel();
    try {
      await window.electronAPI?.invoke?.('close-extension-sidebar-panel');
    } catch (_) {}
  };

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
      const removable = plugin.builtin !== true;
      const popupTitle = plugin.enabled === true
        ? '打开插件弹窗'
        : '插件已禁用';

      return `
        <div class="extension-plugin-row${disabledClass}${missingClass}" data-extension-id="${id}">
          <button class="extension-plugin-main" type="button" title="${popupTitle}">
            <span class="extension-plugin-icon">${icon}</span>
            <span class="extension-plugin-meta">
              <span class="extension-plugin-name">${name}${version}</span>
              ${hint ? `<span class="extension-plugin-hint">${hint}</span>` : ''}
            </span>
          </button>
          <div class="extension-plugin-actions">
            ${plugin.hasOptions ? '<button class="extension-plugin-action-btn extension-plugin-options-btn" type="button">设置</button>' : ''}
            ${removable ? '<button class="extension-plugin-action-btn extension-plugin-remove-btn" type="button">删除</button>' : ''}
            <label class="plugin-switch extension-plugin-enable" title="启用/禁用插件">
              <input type="checkbox" class="extension-plugin-enabled-switch" ${plugin.enabled === true ? 'checked' : ''} ${plugin.missing === true ? 'disabled' : ''} />
              <span class="plugin-switch-slider"></span>
            </label>
          </div>
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
      showSuccess(enabled ? '插件已启用' : '插件已禁用');
    } catch (e) {
      await loadExtensionState();
      showError(e?.message || String(e));
    }
  };

  const removeExtension = async (id) => {
    if (!id) return;
    try {
      const resp = await window.electronAPI.invoke('remove-extension-plugin', { id });
      if (!resp?.ok) {
        throw new Error(resp?.message || resp?.error || '删除插件失败');
      }
      extensionState = normalizeExtensionState(resp.state);
      renderExtensionList();
      showSuccess('插件已删除');
    } catch (e) {
      showError(e?.message || String(e));
    }
  };

  const openExtensionPopup = async (id) => {
    if (!id) return;
    const plugin = extensionState.plugins.find((item) => item.id === id);
    if (plugin && plugin.enabled !== true) {
      showError('请先打开插件开关');
      return;
    }
    showExtensionPanel(plugin, 'popup');
    try {
      const resp = await window.electronAPI.invoke('open-extension-popup-by-id', { id });
      if (!resp?.ok) {
        throw new Error(resp?.message || resp?.error || '打开插件弹窗失败');
      }
      if (extensionPanelStatus) extensionPanelStatus.textContent = '';
    } catch (e) {
      hideExtensionPanel();
      showError(e?.message || String(e));
    }
  };

  const openExtensionOptions = async (id) => {
    if (!id) return;
    const plugin = extensionState.plugins.find((item) => item.id === id);
    if (plugin && plugin.enabled !== true) {
      showError('请先打开插件开关');
      return;
    }
    showExtensionPanel(plugin, 'options');
    try {
      const resp = await window.electronAPI.invoke('open-extension-options-by-id', { id });
      if (!resp?.ok) {
        throw new Error(resp?.message || resp?.error || '打开插件设置失败');
      }
      if (extensionPanelStatus) extensionPanelStatus.textContent = '';
    } catch (e) {
      hideExtensionPanel();
      showError(e?.message || String(e));
    }
  };

  if (extensionPanelCloseBtn) {
    extensionPanelCloseBtn.addEventListener('click', () => {
      closeExtensionPanel();
    });
  }

  if (extensionList) {
    extensionList.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.classList?.contains('extension-plugin-enabled-switch')) return;
      const row = target.closest('.extension-plugin-row');
      setExtensionEnabled(row?.dataset?.extensionId || '', !!target.checked, target);
    });
    extensionList.addEventListener('click', (event) => {
      const target = event.target;
      const row = target?.closest?.('.extension-plugin-row');
      const id = row?.dataset?.extensionId || '';
      if (!row || !id) return;
      if (target.closest('.extension-plugin-enabled-switch') || target.closest('.extension-plugin-enable')) return;
      if (target.closest('.extension-plugin-remove-btn')) {
        removeExtension(id);
        return;
      }
      if (target.closest('.extension-plugin-options-btn')) {
        openExtensionOptions(id);
        return;
      }
      if (target.closest('.extension-plugin-main')) {
        openExtensionPopup(id);
      }
    });
  }

  try {
    window.electronAPI?.on?.('extension-sidebar-panel-opened', (payload = {}) => {
      const plugin = extensionState.plugins.find((item) => item.id === payload.id) || { id: payload.id, name: payload.name };
      showExtensionPanel(plugin, payload.pageType || 'popup', payload.status || '', payload.dimensions || null);
      if (extensionPanelTitle && payload.title) extensionPanelTitle.textContent = payload.title;
    });
    window.electronAPI?.on?.('extension-sidebar-panel-closed', () => {
      hideExtensionPanel();
    });
    window.electronAPI?.on?.('extension-manager-state', (nextState) => {
      extensionState = normalizeExtensionState(nextState);
      renderExtensionList();
    });
  } catch (_) {}

  await loadExtensionState();
}
