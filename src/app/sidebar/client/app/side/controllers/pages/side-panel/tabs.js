// 侧栏页签切换（渲染进程 DOM-only）
// 将原 side.html 中的内联脚本抽离

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab-button');
  const panels = document.querySelectorAll('.panel');
  let woolPlatformRefreshInFlight = null;

  if (!tabs.length || !panels.length) return;

  const refreshWoolPlatformsFromServer = async () => {
    if (woolPlatformRefreshInFlight) return woolPlatformRefreshInFlight;
    woolPlatformRefreshInFlight = (async () => {
      try {
        const response = await window.electronAPI?.invoke?.('refresh-wool-platforms');
        if (response?.ok && typeof renderWoolPlatformButtons === 'function') {
          renderWoolPlatformButtons(
            Array.isArray(response.woolPlatforms) ? response.woolPlatforms : [],
          );
        } else if (response?.authenticated !== false && response?.message) {
          console.warn('[侧边栏] 刷新羊毛平台失败:', response.message);
        }
        return response;
      } catch (error) {
        console.warn('[侧边栏] 刷新羊毛平台失败:', error?.message || error);
        return null;
      } finally {
        woolPlatformRefreshInFlight = null;
      }
    })();
    return woolPlatformRefreshInFlight;
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 伪禁用状态只阻止单击切页，双击逻辑仍然可用
      if (tab.getAttribute('aria-disabled') === 'true') {
        return;
      }

      const previousPanelId = document.querySelector('.tab-button.active')?.getAttribute('data-tab') || '';

      // 取消所有激活态
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      // 激活当前
      tab.classList.add('active');
      const panelId = tab.getAttribute('data-tab');
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.add('active');

      if (previousPanelId === 'ai-control-panel' && panelId === 'ai-free-settings-panel') {
        void refreshWoolPlatformsFromServer();
      }
    });
  });

});

