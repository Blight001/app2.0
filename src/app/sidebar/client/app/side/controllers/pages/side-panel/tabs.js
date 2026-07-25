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
        } else if (response?.authenticated === false && typeof renderWoolPlatformButtons === 'function') {
          renderWoolPlatformButtons([]);
        } else if (response?.message) {
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
    const panelId = tab.getAttribute('data-tab');
    const panel = document.getElementById(panelId);
    if (!panel) return false;
    tabs.forEach((item) => item.classList.remove('active'));
    panels.forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    // 每次进入（包括重复点击）浏览器配置栏目都向服务器重新取一次用户的平台权限，
    // 不依赖进入前所在栏目，避免管理端授权变化后仍显示旧缓存。
    if (panelId === 'ai-free-settings-panel') {
      void refreshWoolPlatformsFromServer();
    }
    return true;
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab)));
  if (document.getElementById('ai-free-settings-panel')?.classList.contains('active')) {
    void refreshWoolPlatformsFromServer();
  }
  window.activateSidebarPanel = (panelId) => activateTab(
    document.querySelector(`.tab-button[data-tab="${String(panelId || '')}"]`),
  );
});

