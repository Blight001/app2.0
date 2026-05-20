const LicenseControllerUtils = window.RendererControllerUtils || {};
const safeGet = LicenseControllerUtils.getEl || ((id) => document.getElementById(id));
const withBusyButton = LicenseControllerUtils.withBusyButton || ((btn, fn) => {
  if (!btn || btn.dataset.busy === '1') return null;
  const originalText = btn.textContent;
  const loadingText = btn.dataset.loadingText || originalText;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = loadingText;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      btn.dataset.busy = '0';
      btn.disabled = false;
      btn.textContent = originalText;
    });
});
const escapeHtml = LicenseControllerUtils.escapeHtml || ((value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;'));

// 设置/更新/持久化：setStatus的具体业务逻辑。
function setStatus(text, type) {
  const el = safeGet('license-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('error', 'success');
  if (type) el.classList.add(type);
}

let cachedRecords = [];
let suggestHideTimer = null;
let pendingDeleteRecord = null;

// 格式化/规范化：normalizeKey的具体业务逻辑。
function normalizeKey(value) {
  return String(value || '').trim();
}

// 处理：maskKeyForDisplay的具体业务逻辑。
function maskKeyForDisplay(value) {
  const key = normalizeKey(value);
  if (!key) return '';
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// 格式化/规范化：normalizePlatformName的具体业务逻辑。
function normalizePlatformName(value) {
  return String(value || '').trim();
}

// 格式化/规范化：formatRecordTime的具体业务逻辑。
function formatRecordTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 处理：fillKey的具体业务逻辑。
function fillKey(value) {
  const keyEl = safeGet('license-key');
  if (!keyEl) return;
  keyEl.value = normalizeKey(value);
  keyEl.focus();
  keyEl.setSelectionRange(keyEl.value.length, keyEl.value.length);
}

// 设置/更新/持久化：applyFilter的具体业务逻辑。
function applyFilter(records) {
  return Array.isArray(records) ? records : [];
}

// 获取/读取/解析：loadRecords的具体业务逻辑。
async function loadRecords() {
  try {
    const resp = await window.electronAPI.invoke('license-get-records');
    cachedRecords = (resp && resp.ok && Array.isArray(resp.records)) ? resp.records : [];
  } catch (_) {
    cachedRecords = [];
  }
  return cachedRecords;
}

// 渲染/刷新：renderSuggest的具体业务逻辑。
function renderSuggest(records) {
  const panel = safeGet('license-suggest');
  if (!panel) return;

  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    panel.innerHTML = '<div class="suggest-empty">暂无历史卡密记录</div>';
    panel.classList.remove('hidden');
    return;
  }

  panel.innerHTML = list.slice(0, 10).map((item) => {
    const key = maskKeyForDisplay(item.keyValue || item.key || item.keyMasked || '');
    const rawKey = normalizeKey(item.keyValue || item.key || key);
    const recordId = normalizeKey(item.id || '');
    const platformName = normalizePlatformName(item.platformName || item.platform || item.currentPlatformName || '');
    const platformLabel = platformName || '未知平台';
    const recordTime = formatRecordTime(item.updatedAt || item.savedAt || item.createdAt || '');
    return `
      <div class="suggest-item" role="button" tabindex="0" data-key="${escapeHtml(rawKey)}" data-id="${escapeHtml(recordId)}">
        <div class="suggest-item-main">
          <div class="suggest-line">
            <span class="suggest-key">${escapeHtml(key || '--')}</span>
            <span class="suggest-sep">·</span><span class="suggest-platform">${escapeHtml(platformLabel)}</span>
          </div>
          ${recordTime ? `<div class="suggest-time">${escapeHtml(recordTime)}</div>` : ''}
        </div>
        <button type="button" class="suggest-delete" data-action="delete" aria-label="删除这条卡密记录">删除</button>
      </div>
    `;
  }).join('');

  panel.classList.remove('hidden');
}

// 启动/打开/显示：showSuggestForInput的具体业务逻辑。
async function showSuggestForInput() {
  await loadRecords();
  renderSuggest(cachedRecords);
}

// 停止/关闭/清理：hideSuggest的具体业务逻辑。
function hideSuggest() {
  const panel = safeGet('license-suggest');
  if (panel) panel.classList.add('hidden');
}

// 获取/读取/解析：getDeleteModal的具体业务逻辑。
function getDeleteModal() {
  return {
    root: safeGet('license-delete-modal'),
    text: safeGet('delete-modal-text'),
    cancel: safeGet('delete-modal-cancel'),
    confirm: safeGet('delete-modal-confirm'),
  };
}

// 停止/关闭/清理：closeDeleteModal的具体业务逻辑。
function closeDeleteModal() {
  const modal = getDeleteModal();
  if (!modal.root) return;
  modal.root.classList.add('hidden');
  modal.root.setAttribute('aria-hidden', 'true');
  pendingDeleteRecord = null;
}

// 启动/打开/显示：openDeleteModal的具体业务逻辑。
function openDeleteModal(record) {
  const modal = getDeleteModal();
  if (!modal.root || !modal.text) return;

  pendingDeleteRecord = {
    keyValue: normalizeKey(record?.keyValue || record?.key || ''),
    id: normalizeKey(record?.id || ''),
  };

  const label = pendingDeleteRecord.keyValue || '这条卡密记录';
  modal.text.textContent = `确定删除这条卡密记录吗？\n${label}`;
  modal.root.classList.remove('hidden');
  modal.root.setAttribute('aria-hidden', 'false');
  modal.confirm?.focus();
}

// 渲染/刷新：refreshSuggest的具体业务逻辑。
async function refreshSuggest() {
  await loadRecords();
  renderSuggest(applyFilter(cachedRecords));
}

// 移除/删除：deleteRecord的具体业务逻辑。
async function deleteRecord(record) {
  const keyValue = normalizeKey(record?.keyValue || record?.key || '');
  const id = normalizeKey(record?.id || '');
  if (!keyValue && !id) return;

  try {
    const resp = await window.electronAPI.invoke('license-delete-record', { keyValue, id });
    if (!resp || !resp.ok) {
      setStatus((resp && (resp.error || resp.message)) || '删除失败，请重试', 'error');
      return;
    }

    setStatus('卡密记录已删除', 'success');
    await refreshSuggest();
  } catch (e) {
    setStatus(e?.message || String(e), 'error');
  }
}

// 创建/初始化：initLicensePage的具体业务逻辑。
async function initLicensePage() {
  try {
    const saved = await window.electronAPI.invoke('license-get-saved-key');
    const keyEl = safeGet('license-key');
    if (keyEl && saved) keyEl.value = saved;
  } catch (_) {}
}

// 处理/分发：handleSubmit的具体业务逻辑。
async function handleSubmit() {
  const btn = safeGet('license-submit');
  const keyEl = safeGet('license-key');
  if (!keyEl || !btn) return;

  const key = normalizeKey(keyEl.value);
  if (!key) {
    setStatus('请输入卡密', 'error');
    return;
  }

  await withBusyButton(btn, async () => {
    setStatus('正在搜索卡密状态，请稍候...');

    try {
      const resp = await window.electronAPI.invoke('license-validate-and-init', { key });
      if (resp && resp.ok) {
        setStatus('卡密有效，正在进入软件并打开插件网页...', 'success');
        await loadRecords();
        hideSuggest();
        return;
      }
// 处理：msg的具体业务逻辑。
      const msg = (resp && (resp.message || resp.error)) || '卡密搜索失败，请重试';
      setStatus(msg, 'error');
      await loadRecords();
    } catch (e) {
      setStatus(e?.message || String(e), 'error');
      await loadRecords();
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await initLicensePage();
  await loadRecords();

  if (window.electronAPI && typeof window.electronAPI.on === 'function') {
    window.electronAPI.on('license-records-updated', async () => {
      await refreshSuggest();
    });
  }

  const keyEl = safeGet('license-key');
  const suggest = safeGet('license-suggest');
  const deleteModal = getDeleteModal();

  if (keyEl) {
    keyEl.addEventListener('focus', () => {
      clearTimeout(suggestHideTimer);
      showSuggestForInput();
    });

    keyEl.addEventListener('input', () => {
      clearTimeout(suggestHideTimer);
      renderSuggest(applyFilter(cachedRecords));
    });

    keyEl.addEventListener('blur', () => {
      suggestHideTimer = setTimeout(hideSuggest, 180);
    });

    keyEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        hideSuggest();
      }
    });
  }

  if (deleteModal.root) {
    deleteModal.root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const action = target?.dataset?.action || target?.closest?.('[data-action]')?.dataset?.action;
      if (action === 'close') {
        closeDeleteModal();
      }
    });
  }

  deleteModal.cancel?.addEventListener('click', () => {
    closeDeleteModal();
  });

  deleteModal.confirm?.addEventListener('click', async () => {
    if (!pendingDeleteRecord) {
      closeDeleteModal();
      return;
    }
    const record = pendingDeleteRecord;
    closeDeleteModal();
    await deleteRecord(record);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDeleteModal();
    }
  });

  if (suggest) {
    suggest.addEventListener('mousedown', (e) => {
      const deleteBtn = e.target.closest('.suggest-delete');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const item = deleteBtn.closest('.suggest-item');
        if (!item) return;
        openDeleteModal({
          keyValue: item.dataset.key || '',
          id: item.dataset.id || ''
        });
        return;
      }

      const item = e.target.closest('.suggest-item');
      if (!item) return;
      e.preventDefault();
      fillKey(item.dataset.key || '');
      setStatus('已选择历史卡密');
      hideSuggest();
    });

    suggest.addEventListener('keydown', (e) => {
      const item = e.target.closest('.suggest-item');
      if (!item) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fillKey(item.dataset.key || '');
        setStatus('已选择历史卡密');
        hideSuggest();
      }
    });
  }

  const btn = safeGet('license-submit');
  if (btn) {
    btn.addEventListener('click', handleSubmit);
  }

});
