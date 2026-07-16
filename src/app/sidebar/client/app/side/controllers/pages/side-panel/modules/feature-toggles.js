// 创建/初始化：initPluginSwitches的具体业务逻辑。
async function initPluginSwitches() {
  const extensionList = safeGetEl('extension-plugin-list');
  const importButton = safeGetEl('import-extension-plugin');

  let extensionState = {
    developerModeEnabled: true,
    vipRequired: true,
    plugins: [],
  };
  let importInProgress = false;

  const showError = (message) => {
    window.MessageModal?.showErrorMessage?.(message || '操作失败');
  };

  const showSuccess = (message) => {
    window.MessageModal?.showSuccessMessage?.(message || '操作成功');
  };

  const normalizeExtensionState = (state = {}, vipRequired = extensionState.vipRequired) => ({
    developerModeEnabled: true,
    vipRequired: vipRequired === true,
    plugins: Array.isArray(state.plugins) ? state.plugins : [],
  });

  const syncImportAccess = () => {
    if (!importButton) return;
    const locked = extensionState.vipRequired === true || window.isSidebarVipActive?.() !== true;
    // VIP 锁只改变提示和点击后的去向，不能让入口失去点击能力。
    // 只有已经进入真实导入流程时才临时禁用，避免重复弹出目录选择框。
    importButton.disabled = importInProgress;
    importButton.classList.toggle('is-vip-locked', locked);
    importButton.setAttribute('aria-label', locked ? '开通 VIP 后导入自定义插件' : '导入自定义插件');
    const label = importButton.querySelector('.extension-plugin-import-label');
    if (label) label.textContent = locked ? 'VIP 导入插件' : '导入自定义插件';
  };

  const renderExtensionList = () => {
    if (!extensionList) return;

    const plugins = extensionState.plugins;
    if (!plugins.length) {
      extensionList.innerHTML = '<div class="extension-plugin-empty">暂无可注入的浏览器插件</div>';
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
          ${plugin.builtin === true ? '' : '<button type="button" class="extension-plugin-remove" title="移除自定义插件" aria-label="移除自定义插件">×</button>'}
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
      extensionState = normalizeExtensionState(result.state, result.vipRequired === true);
    } catch (e) {
      console.warn('[侧边栏] 获取插件列表失败:', e);
      extensionState = { developerModeEnabled: true, plugins: [] };
      extensionList.innerHTML = '<div class="extension-plugin-empty">插件管理器不可用</div>';
      return;
    }
    renderExtensionList();
    syncImportAccess();
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

  const removeExtension = async (id, button) => {
    if (!id) return;
    if (button) button.disabled = true;
    try {
      const resp = await window.electronAPI.invoke('remove-extension-plugin', { id });
      if (!resp?.ok) throw new Error(resp?.message || resp?.error || '移除插件失败');
      extensionState = normalizeExtensionState(resp.state);
      renderExtensionList();
      showSuccess('自定义插件已移除');
    } catch (e) {
      if (button) button.disabled = false;
      showError(e?.message || String(e));
    }
  };

  const confirmRemoveExtension = (id, button) => {
    const run = () => void removeExtension(id, button);
    if (window.MessageModal?.showConfirmDialog) {
      window.MessageModal.showConfirmDialog('确认移除这个自定义插件吗？插件文件不会被删除。', run, null, 'warning');
    } else if (window.confirm?.('确认移除这个自定义插件吗？插件文件不会被删除。')) {
      run();
    }
  };

  const importExtension = async () => {
    if (!importButton || importInProgress) return;
    if (extensionState.vipRequired === true || window.isSidebarVipActive?.() !== true) {
      window.openVipAccountCenter?.();
      return;
    }
    importInProgress = true;
    importButton.disabled = true;
    const importLabel = importButton.querySelector('.extension-plugin-import-label');
    if (importLabel) importLabel.textContent = '导入中…';
    try {
      const resp = await window.electronAPI.invoke('import-extension-plugin');
      if (resp?.canceled) return;
      if (resp?.vipRequired) {
        window.openVipAccountCenter?.();
        return;
      }
      if (!resp?.ok) throw new Error(resp?.message || resp?.error || '导入插件失败');
      extensionState = normalizeExtensionState(resp.state);
      renderExtensionList();
      const refresh = resp.browserRefresh;
      if (refresh?.ok === false) {
        showError('插件已导入，但部分浏览器刷新失败，请手动重启对应环境');
      } else {
        showSuccess(`已导入并启用“${resp.plugin?.name || '自定义插件'}”`);
      }
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      importInProgress = false;
      syncImportAccess();
    }
  };

  if (extensionList) {
    extensionList.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.classList?.contains('extension-plugin-enabled-switch')) return;
      const row = target.closest('.extension-plugin-row');
      setExtensionEnabled(row?.dataset?.extensionId || '', !!target.checked, target);
    });
    extensionList.addEventListener('click', (event) => {
      const button = event.target?.closest?.('.extension-plugin-remove');
      if (!button) return;
      const row = button.closest('.extension-plugin-row');
      confirmRemoveExtension(row?.dataset?.extensionId || '', button);
    });
  }

  importButton?.addEventListener('click', importExtension);

  try {
    window.electronAPI?.on?.('extension-manager-state', (nextState) => {
      extensionState = normalizeExtensionState(nextState);
      renderExtensionList();
    });
  } catch (_) {}

  try {
    window.electronAPI?.on?.('account-session-updated', () => {
      void loadExtensionState();
    });
  } catch (_) {}

  await loadExtensionState();
}
