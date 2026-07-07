(function initControlPanel() {
  const config = window.CONTROL_PANEL_CONFIG || {};
  const root = document.documentElement;
  const body = document.body;
  const previewMode = new URLSearchParams(window.location.search || '').get('preview') === '1';
  const remoteUrlInput = document.getElementById('remote-url-input');
  const previewFrame = document.getElementById('remote-preview-frame');
  const loadBtn = document.getElementById('load-remote-url-btn');
  const reloadBtn = document.getElementById('remote-reload-btn');
  const statusEl = document.getElementById('preview-status');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeStorageKey = 'ai-free.control-panel.theme';
  const storageKey = 'ai-free.control-panel.remoteUrl';
  const query = new URLSearchParams(window.location.search || '');

  if (body) {
    body.classList.toggle('preview-mode', previewMode);
  }
  const previewCard = document.querySelector('.preview-card');
  if (previewCard && !previewMode) {
    previewCard.style.display = 'none';
  }

  function normalizeUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const parsed = new URL(text);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol === 'http:' || protocol === 'https:') {
        return parsed.href;
      }
    } catch (_) {}
    return '';
  }

  function setStatus(message) {
    if (statusEl) {
      statusEl.textContent = message || '未加载';
    }
  }

  function getSavedTheme() {
    try {
      const value = localStorage.getItem(themeStorageKey);
      return value === 'light' ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    const isLight = nextTheme === 'light';

    if (root) {
      root.classList.toggle('theme-light', isLight);
      root.dataset.theme = nextTheme;
    }

    if (themeToggleBtn) {
      themeToggleBtn.title = isLight ? '切换到深色模式' : '切换到白色模式';
      themeToggleBtn.setAttribute('aria-label', isLight ? '切换到深色模式' : '切换到白色模式');
      themeToggleBtn.setAttribute('aria-pressed', String(isLight));
    }

    try {
      localStorage.setItem(themeStorageKey, nextTheme);
    } catch (_) {}
  }

  function toggleTheme() {
    const currentTheme = root && root.classList.contains('theme-light') ? 'light' : getSavedTheme();
    applyTheme(currentTheme === 'light' ? 'dark' : 'light');
  }

  function getSavedUrl() {
    try {
      return String(localStorage.getItem(storageKey) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function saveUrl(url) {
    try {
      localStorage.setItem(storageKey, url);
    } catch (_) {}
  }

  function resolveInitialUrl() {
    const fromQuery = normalizeUrl(query.get('url') || query.get('remoteUrl'));
    if (fromQuery) return fromQuery;

    const saved = normalizeUrl(getSavedUrl());
    if (saved) return saved;

    return normalizeUrl(config.remoteUrl || '');
  }

  function loadPreview(url, { persist = true } = {}) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setStatus('请输入有效的 http(s) 地址');
      return false;
    }

    if (remoteUrlInput) {
      remoteUrlInput.value = normalized;
    }
    if (previewFrame) {
      previewFrame.src = normalized;
    }
    if (persist) {
      saveUrl(normalized);
    }
    setStatus(`正在预览: ${normalized}`);
    return true;
  }

  function refreshPreview() {
    const current = normalizeUrl(remoteUrlInput && remoteUrlInput.value ? remoteUrlInput.value : '');
    if (!current) {
      setStatus('请输入有效的 http(s) 地址');
      return;
    }
    if (previewFrame) {
      previewFrame.src = current;
    }
    setStatus(`正在刷新: ${current}`);
  }

  function bindEvents() {
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', toggleTheme);
    }

    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        loadPreview(remoteUrlInput ? remoteUrlInput.value : '');
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', refreshPreview);
    }

    if (remoteUrlInput) {
      remoteUrlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          loadPreview(remoteUrlInput.value);
        }
      });
    }
  }

  applyTheme(getSavedTheme());
  bindEvents();
  // 仅在显式预览模式（?preview=1）下才加载预览 iframe。
  // 作为内嵌侧边栏时预览卡片是隐藏的，若仍自动加载 remoteUrl 会无谓地去连端口并刷错误日志。
  if (previewMode) {
    const initialUrl = resolveInitialUrl();
    if (initialUrl) {
      loadPreview(initialUrl, { persist: false });
    } else {
      setStatus('在上方输入框填入你的控制网址');
    }
  }
})();
