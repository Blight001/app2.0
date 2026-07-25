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
        const response = await window.aiFree?.content.refreshWoolPlatforms?.();
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

  const activateTab = (tab) => {
    if (!tab || tab.getAttribute('aria-disabled') === 'true') return false;
    const previousPanelId = document.querySelector('.tab-button.active')?.getAttribute('data-tab') || '';
    const panelId = tab.getAttribute('data-tab');
    const panel = document.getElementById(panelId);
    if (!panel) return false;
    tabs.forEach((item) => item.classList.remove('active'));
    panels.forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    if (previousPanelId === 'ai-control-panel' && panelId === 'ai-free-settings-panel') {
      void refreshWoolPlatformsFromServer();
    }
    return true;
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab)));
  window.activateSidebarPanel = (panelId) => activateTab(
    document.querySelector(`.tab-button[data-tab="${String(panelId || '')}"]`),
  );
});

