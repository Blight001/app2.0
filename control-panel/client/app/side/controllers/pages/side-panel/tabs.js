// 侧栏页签切换（渲染进程 DOM-only）
// 将原 side.html 中的内联脚本抽离

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab-button');
  const panels = document.querySelectorAll('.panel');

  if (!tabs.length || !panels.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 伪禁用状态只阻止单击切页，双击逻辑仍然可用
      if (tab.getAttribute('aria-disabled') === 'true') {
        return;
      }

      // 取消所有激活态
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      // 激活当前
      tab.classList.add('active');
      const panelId = tab.getAttribute('data-tab');
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.add('active');
    });
  });

});

