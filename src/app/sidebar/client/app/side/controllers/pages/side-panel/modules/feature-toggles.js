class ExtensionPluginSwitchController {
  constructor() {
    this.extensionList = safeGetEl('extension-plugin-list');
    this.importButton = safeGetEl('import-extension-plugin');
    this.state = { developerModeEnabled: true, vipRequired: true, plugins: [] };
    this.importInProgress = false;
  }

  showError(message) {
    window.MessageModal?.showErrorMessage?.(message || '操作失败');
  }

  showSuccess(message) {
    window.MessageModal?.showSuccessMessage?.(message || '操作成功');
  }

  normalizeState(state = {}, vipRequired = this.state.vipRequired) {
    return {
      developerModeEnabled: true,
      vipRequired: vipRequired === true,
      plugins: Array.isArray(state.plugins) ? state.plugins : [],
    };
  }

  syncImportAccess() {
    if (!this.importButton) return;
    const locked = this.state.vipRequired === true || window.isSidebarVipActive?.() !== true;
    this.importButton.disabled = this.importInProgress;
    this.importButton.classList.toggle('is-vip-locked', locked);
    this.importButton.setAttribute('aria-label', locked ? '开通 VIP 后导入自定义插件' : '导入自定义插件');
    const label = this.importButton.querySelector('.extension-plugin-import-label');
    if (label) label.textContent = locked ? 'VIP 导入插件' : '导入自定义插件';
  }

  renderList() {
    if (!this.extensionList) return;
    if (!this.state.plugins.length) {
      this.extensionList.innerHTML = '<div class="extension-plugin-empty">暂无可注入的浏览器插件</div>';
      return;
    }
    this.extensionList.innerHTML = this.state.plugins.map(renderExtensionPluginRow).join('');
  }

  async loadState() {
    if (!this.extensionList) return;
    try {
      const result = await window.aiFree.extensions.getState();
      if (!result?.ok) throw new Error(result?.message || result?.error || '插件管理器不可用');
      this.state = this.normalizeState(result.state, result.vipRequired === true);
    } catch (error) {
      console.warn('[侧边栏] 获取插件列表失败:', error);
      this.state = { developerModeEnabled: true, plugins: [] };
      this.extensionList.innerHTML = '<div class="extension-plugin-empty">插件管理器不可用</div>';
      return;
    }
    this.renderList();
    this.syncImportAccess();
  }

  async setEnabled(id, enabled, inputEl) {
    if (!id) return;
    if (inputEl) inputEl.disabled = true;
    try {
      const response = await window.aiFree.extensions.setEnabled({ id, enabled });
      if (!response?.ok) throw new Error(response?.message || response?.error || '更新插件开关失败');
      this.state = this.normalizeState(response.state);
      this.renderList();
      this.showRefreshResult(enabled, response.browserRefresh);
    } catch (error) {
      await this.loadState();
      this.showError(error?.message || String(error));
    }
  }

  showRefreshResult(enabled, refresh) {
    if (refresh && refresh.ok === false) {
      const failed = Array.isArray(refresh.failures) ? refresh.failures.length : 0;
      this.showError(`插件已${enabled ? '启用' : '禁用'}，但有 ${failed || '部分'} 个浏览器刷新失败，请手动刷新或重启该环境`);
      return;
    }
    const total = Number(refresh?.total || 0);
    const chromium = Number(refresh?.chromiumRestarted || 0);
    const chromiumText = chromium > 0 ? `（含 ${chromium} 个 Chromium 环境重启）` : '';
    const suffix = total > 0 ? `，已刷新 ${total} 个浏览器${chromiumText}` : '，新打开的浏览器将使用此状态';
    this.showSuccess(`${enabled ? '插件已启用' : '插件已禁用'}${suffix}`);
  }

  async remove(id, button) {
    if (!id) return;
    if (button) button.disabled = true;
    try {
      const response = await window.aiFree.extensions.removePlugin({ id });
      if (!response?.ok) throw new Error(response?.message || response?.error || '移除插件失败');
      this.state = this.normalizeState(response.state);
      this.renderList();
      this.showSuccess('自定义插件已移除');
    } catch (error) {
      if (button) button.disabled = false;
      this.showError(error?.message || String(error));
    }
  }

  confirmRemove(id, button) {
    const run = () => void this.remove(id, button);
    if (window.MessageModal?.showConfirmDialog) {
      window.MessageModal.showConfirmDialog('确认移除这个自定义插件吗？插件文件不会被删除。', run, null, 'warning');
      return;
    }
    if (window.confirm?.('确认移除这个自定义插件吗？插件文件不会被删除。')) run();
  }

  async importExtension() {
    if (!this.importButton || this.importInProgress) return;
    if (!this.hasImportAccess()) {
      window.openVipAccountCenter?.();
      return;
    }
    this.setImportBusy(true);
    try {
      const response = await window.aiFree.extensions.importPlugin();
      this.handleImportResponse(response);
    } catch (error) {
      this.showError(error?.message || String(error));
    } finally {
      this.setImportBusy(false);
    }
  }

  hasImportAccess() {
    return this.state.vipRequired !== true && window.isSidebarVipActive?.() === true;
  }

  handleImportResponse(response) {
    if (response?.canceled) return;
    if (response?.vipRequired) {
      window.openVipAccountCenter?.();
      return;
    }
    this.acceptImportedExtension(response);
  }

  acceptImportedExtension(response) {
    if (!response?.ok) throw new Error(response?.message || response?.error || '导入插件失败');
    this.state = this.normalizeState(response.state);
    this.renderList();
    if (response.browserRefresh?.ok === false) {
      this.showError('插件已导入，但部分浏览器刷新失败，请手动重启对应环境');
      return;
    }
    this.showSuccess(`已导入并启用“${response.plugin?.name || '自定义插件'}”`);
  }

  setImportBusy(busy) {
    this.importInProgress = busy;
    if (busy && this.importButton) {
      this.importButton.disabled = true;
      const label = this.importButton.querySelector('.extension-plugin-import-label');
      if (label) label.textContent = '导入中…';
    } else {
      this.syncImportAccess();
    }
  }

  bindListEvents() {
    if (!this.extensionList) return;
    this.extensionList.addEventListener('change', (event) => {
      const target = event.target;
      if (!target?.classList?.contains('extension-plugin-enabled-switch')) return;
      const id = target.closest('.extension-plugin-row')?.dataset?.extensionId || '';
      void this.setEnabled(id, Boolean(target.checked), target);
    });
    this.extensionList.addEventListener('click', (event) => {
      const button = event.target?.closest?.('.extension-plugin-remove');
      if (!button) return;
      const id = button.closest('.extension-plugin-row')?.dataset?.extensionId || '';
      this.confirmRemove(id, button);
    });
  }

  bindExternalEvents() {
    this.importButton?.addEventListener('click', () => void this.importExtension());
    try {
      window.aiFree?.extensions.onStateChanged?.((nextState) => {
        this.state = this.normalizeState(nextState);
        this.renderList();
      });
    } catch (_) {}
    try {
      window.aiFree?.account.onSessionUpdated?.(() => { void this.loadState(); });
    } catch (_) {}
  }

  async initialize() {
    this.bindListEvents();
    this.bindExternalEvents();
    await this.loadState();
  }
}

function renderExtensionPluginRow(plugin) {
  const id = escapeHtml(plugin.id || '');
  const name = escapeHtml(plugin.name || '未命名插件');
  const hint = escapeHtml(plugin.hint || plugin.description || plugin.rawName || '');
  const version = plugin.version ? ` v${escapeHtml(plugin.version)}` : '';
  const icon = renderExtensionPluginIcon(plugin);
  const disabledClass = plugin.enabled === true ? '' : ' is-disabled';
  const missingClass = plugin.missing === true ? ' is-missing' : '';
  const checked = plugin.enabled === true ? 'checked' : '';
  const disabled = plugin.missing === true ? 'disabled' : '';
  const removeButton = renderExtensionRemoveButton(plugin);
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
        <input type="checkbox" class="extension-plugin-enabled-switch" ${checked} ${disabled} />
        <span class="plugin-switch-slider"></span>
      </label>
      ${removeButton}
    </div>
  `;
}

function renderExtensionPluginIcon(plugin) {
  if (plugin.iconDataUrl) {
    return `<img class="extension-plugin-icon-img" src="${escapeHtml(plugin.iconDataUrl)}" alt="">`;
  }
  const initial = (plugin.name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return `<span class="extension-plugin-icon-fallback">${escapeHtml(initial)}</span>`;
}

function renderExtensionRemoveButton(plugin) {
  return plugin.builtin === true
    ? ''
    : '<button type="button" class="extension-plugin-remove" title="移除自定义插件" aria-label="移除自定义插件">×</button>';
}

async function initPluginSwitches() {
  await new ExtensionPluginSwitchController().initialize();
}
