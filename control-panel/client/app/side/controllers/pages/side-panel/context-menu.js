// 针对 key-input 的左/右键弹出粘贴菜单逻辑（渲染进程 DOM-only）

document.addEventListener('DOMContentLoaded', () => {
  const keyInput = document.getElementById('key-input');
  const menu = document.getElementById('key-paste-menu');
  const pasteBtn = document.getElementById('key-paste-btn');

  if (!keyInput || !menu || !pasteBtn) return;

// 停止/关闭/清理：hideMenu的具体业务逻辑。
  const hideMenu = () => {
    menu.style.display = 'none';
    menu.setAttribute('aria-hidden', 'true');
  };

// 启动/打开/显示：showMenuAt的具体业务逻辑。
  const showMenuAt = (x, y) => {
    // 视口边界保护
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuWidth = 120;
    const menuHeight = 40;
    let left = Math.min(Math.max(8, x), vw - menuWidth - 8);
    let top = Math.min(Math.max(8, y), vh - menuHeight - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.display = 'block';
    menu.setAttribute('aria-hidden', 'false');
  };

  // 右键自定义菜单
  keyInput.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenuAt(e.clientX, e.clientY);
  });

  // 左键点击时在输入框下方显示
  keyInput.addEventListener('click', () => {
    const rect = keyInput.getBoundingClientRect();
    showMenuAt(rect.left, rect.bottom + 4);
  });

  // 粘贴动作
  pasteBtn.addEventListener('click', async () => {
    try {
      let text = '';
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
      if (!text) {
        text = window.prompt('请输入要粘贴的内容：') || '';
      }
      if (typeof text === 'string') {
        keyInput.value = text;
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (err) {
      console.error('读取剪贴板失败:', err);
      const text = window.prompt('无法直接读取剪贴板，请手动粘贴：', '');
      if (text != null) {
        keyInput.value = text;
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally {
      hideMenu();
      keyInput.focus();
    }
  });

  // 点击其他区域、窗口变化等时隐藏
  document.addEventListener('click', (e) => {
    if (e.target !== menu && !menu.contains(e.target) && e.target !== keyInput) {
      hideMenu();
    }
  });
  window.addEventListener('resize', hideMenu);
  window.addEventListener('blur', hideMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
});

