(() => {
  const RECENT_LIMIT = 5;
  let visible = true;
  let refreshPromise = null;

  function element(id) {
    return document.getElementById(id);
  }

  function recentItems(history) {
    return (Array.isArray(history) ? history : [])
      .filter((item) => item?.id && item?.kind !== 'tutorial')
      .sort((left, right) => Number(right.lastOpenedAt || 0) - Number(left.lastOpenedAt || 0))
      .slice(0, RECENT_LIMIT);
  }

  function openedTime(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  async function openRecent(item, button) {
    if (!item?.id || button.disabled) return;
    button.disabled = true;
    try {
      const result = await window.aiFree?.browser?.openHistory?.({ historyId: item.id });
      if (!result?.ok) throw new Error(result?.error || '浏览器窗口打开失败');
    } catch (error) {
      element('shell-home-status').textContent = error?.message || String(error);
      button.disabled = false;
    }
  }

  function recentButton(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-home-recent-item';
    button.title = `打开浏览器窗口：${item.name || '未命名浏览器'}`;
    const name = document.createElement('span');
    name.className = 'shell-home-recent-name';
    name.textContent = item.name || '未命名浏览器';
    const time = document.createElement('span');
    time.className = 'shell-home-recent-time';
    time.textContent = item.isOpen ? '已打开' : openedTime(item.lastOpenedAt);
    button.append(name, time);
    button.addEventListener('click', () => void openRecent(item, button));
    return button;
  }

  function render(history) {
    const list = element('shell-home-recent-list');
    const status = element('shell-home-status');
    if (!list || !status) return;
    const items = recentItems(history);
    list.replaceChildren(...items.map(recentButton));
    status.textContent = items.length ? '' : '暂无最近打开的浏览器窗口';
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const getHistory = window.aiFree?.browser?.getHistory;
    if (!getHistory) return undefined;
    refreshPromise = getHistory()
      .then((result) => {
        if (!result?.ok) throw new Error(result?.error || '浏览器记录读取失败');
        render(result.history);
      })
      .catch((error) => { element('shell-home-status').textContent = error?.message || String(error); })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function setVisible(tabs = []) {
    const home = element('browser-empty-state');
    if (!home) return;
    const activeTab = Array.isArray(tabs) ? tabs.find((tab) => tab?.isActive) : null;
    const status = String(activeTab?.runtimeStatus || '').trim().toLowerCase();
    visible = status !== 'ready' && status !== 'hidden';
    home.hidden = !visible;
    window.aiFree?.ui?.setBrowserSettingsPageVisible?.(visible);
    if (visible) void refresh();
  }

  function bind() {
    window.aiFree?.ui?.setBrowserSettingsPageVisible?.(true);
    element('shell-home-create-browser')?.addEventListener('click', () => {
      void window.AppShellBrowserActions?.createIndependentBrowser?.();
    });
    element('shell-home-refresh')?.addEventListener('click', () => void refresh());
    window.aiFree?.browser?.onHistoryChanged?.(() => { if (visible) void refresh(); });
    void refresh();
  }

  window.AppShellHome = Object.freeze({ bind, refresh, setVisible });
})();
