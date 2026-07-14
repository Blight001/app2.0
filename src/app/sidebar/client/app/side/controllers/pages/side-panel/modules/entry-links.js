// 同步/连接：bindTutorialLink的具体业务逻辑。
function bindTutorialLink() {
  const tutorialLink = safeGetEl('tutorial-link');
  if (!tutorialLink) return;

// 获取/读取/解析：resolveTutorialUrl的具体业务逻辑。
  async function resolveTutorialUrl() {
    try {
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        const latestUrl = await window.electronAPI.invoke('get-tutorial-url');
        if (typeof latestUrl === 'string' && latestUrl.trim()) {
          if (typeof setTutorialLinkHref === 'function') {
            setTutorialLinkHref(latestUrl);
          }
          return String(latestUrl).trim();
        }
      }
    } catch (error) {
      console.error('[侧边栏] 获取教程链接失败:', error);
    }

    return String(tutorialLink.dataset.tutorialUrl || tutorialLink.getAttribute('href') || '').trim();
  }

  tutorialLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const currentHref = await resolveTutorialUrl();

    if (currentHref) {
      window.electronAPI.send('open-tutorial', currentHref);
      return;
    }

    if (window.MessageModal && typeof window.MessageModal.showInfoMessage === 'function') {
      window.MessageModal.showInfoMessage('教程链接尚未同步，请稍后再试');
    }
  });
}

// 同步/连接：bindSecondaryEntryButtons的具体业务逻辑。
function bindSecondaryEntryButtons() {
  const startBananaBtn = safeGetEl('start-banana-btn');
  if (startBananaBtn) {
    startBananaBtn.addEventListener('click', () => {
      window.MessageModal.showInfoMessage('「一键启动 BananaAI」 功能已经上线，如需请联系客服开通账号权限！');
    });
  }

}
