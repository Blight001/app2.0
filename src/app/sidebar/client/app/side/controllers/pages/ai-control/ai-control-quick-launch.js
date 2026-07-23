  let disposeQuickLaunchHistory = null;

  function quickLaunchItems(history) {
    return (Array.isArray(history) ? history : [])
      .filter((item) => String(item?.id || '').trim())
      .sort((left, right) => Number(right.lastOpenedAt || 0) - Number(left.lastOpenedAt || 0))
      .slice(0, 5);
  }

  function quickLaunchMeta(item) {
    const openedAt = formatRelativeTime(item.lastOpenedAt);
    const status = item.isActive ? '当前浏览器' : (item.isOpen ? '已打开' : '最近打开');
    return [status, openedAt].filter(Boolean).join(' · ');
  }

  async function openQuickLaunchHistory(item, button) {
    const openHistory = window.aiFree?.browser?.openHistory;
    if (!openHistory || !item?.id || button?.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const result = await openHistory({ historyId: item.id });
      if (!result?.ok) throw new Error(result?.error || '浏览器启动失败');
      await refreshQuickLaunchHistory();
    } catch (error) {
      setStatus(error?.message || String(error), 'warning');
    } finally {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
    }
  }

  function createQuickLaunchButton(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-chat-recent-item ai-chat-quick-launch-item';
    button.title = `打开浏览器：${item.name || '未命名浏览器'}`;

    const icon = document.createElement('span');
    icon.className = 'ai-chat-quick-launch-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↗';
    const content = document.createElement('span');
    content.className = 'ai-chat-quick-launch-content';
    const title = document.createElement('span');
    title.className = 'ai-chat-recent-title';
    title.textContent = item.name || '未命名浏览器';
    const meta = document.createElement('span');
    meta.className = 'ai-chat-recent-meta';
    meta.textContent = quickLaunchMeta(item);
    content.append(title, meta);
    button.append(icon, content);
    button.addEventListener('click', () => openQuickLaunchHistory(item, button));
    return button;
  }

  function renderQuickLaunch() {
    const welcome = el('ai-chat-messages')?.querySelector('.ai-chat-welcome');
    if (!welcome) return;
    welcome.querySelector('.ai-chat-quick-launch')?.remove();
    const items = quickLaunchItems(state.quickLaunchHistory);
    if (!items.length) return;

    const section = document.createElement('section');
    section.className = 'ai-chat-quick-launch';
    section.setAttribute('aria-label', '快速启动');
    const heading = document.createElement('span');
    heading.className = 'ai-chat-recent-heading';
    heading.textContent = '快速启动';
    const list = document.createElement('div');
    list.className = 'ai-chat-recent-list ai-chat-quick-launch-list';
    items.forEach((item) => list.appendChild(createQuickLaunchButton(item)));
    section.append(heading, list);
    welcome.appendChild(section);
  }

  async function refreshQuickLaunchHistory() {
    const getHistory = window.aiFree?.browser?.getHistory;
    if (!getHistory) return;
    try {
      const result = await getHistory();
      if (!result?.ok) throw new Error(result?.error || '读取浏览器记录失败');
      state.quickLaunchHistory = quickLaunchItems(result.history);
      renderQuickLaunch();
    } catch (error) {
      console.warn('[AI 控制] 读取快速启动记录失败:', error?.message || error);
    }
  }

  function bindQuickLaunchHistory() {
    if (disposeQuickLaunchHistory) return;
    const subscribe = window.aiFree?.browser?.onHistoryChanged;
    if (subscribe) disposeQuickLaunchHistory = subscribe(() => void refreshQuickLaunchHistory());
  }

  function unbindQuickLaunchHistory() {
    disposeQuickLaunchHistory?.();
    disposeQuickLaunchHistory = null;
  }
