'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('window-close-behavior');
  const status = document.getElementById('window-close-behavior-status');
  if (!select) return;

  const setStatus = (message, state = '') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };

  const loadPreference = async () => {
    try {
      const result = await window.aiFree?.ui?.getWindowCloseBehavior?.();
      if (!result?.ok) throw new Error(result?.error?.message || '读取设置失败');
      select.value = result.data?.behavior || 'ask';
      setStatus('');
    } catch (error) {
      select.value = 'ask';
      setStatus(error?.message || '读取设置失败', 'error');
    }
  };

  select.addEventListener('change', async () => {
    const behavior = select.value;
    select.disabled = true;
    setStatus('保存中…');
    try {
      const result = await window.aiFree?.ui?.setWindowCloseBehavior?.({ behavior });
      if (!result?.ok) throw new Error(result?.error?.message || '保存设置失败');
      setStatus('已保存', 'success');
    } catch (error) {
      setStatus(error?.message || '保存设置失败', 'error');
      await loadPreference();
    } finally {
      select.disabled = false;
    }
  });

  void loadPreference();
});
