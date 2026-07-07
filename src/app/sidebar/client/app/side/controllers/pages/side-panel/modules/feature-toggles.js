// 创建/初始化：initPluginSwitches的具体业务逻辑。
async function initPluginSwitches() {
  const removeWmSwitch = safeGetEl('remove-watermark-switch');
  const translateSwitch = safeGetEl('translate-ext-switch');
  if (!removeWmSwitch || !translateSwitch) return;

  let lastSettings = {
    removeWatermarkEnabled: false,
    translateExtEnabled: false,
  };

// 设置/更新/持久化：applyUi的具体业务逻辑。
  const applyUi = (settings = {}) => {
    lastSettings = {
      removeWatermarkEnabled: settings.removeWatermarkEnabled === true,
      translateExtEnabled: settings.translateExtEnabled === true,
    };
    removeWmSwitch.checked = lastSettings.removeWatermarkEnabled;
    translateSwitch.checked = lastSettings.translateExtEnabled;
    translateSwitch.disabled = false;
    translateSwitch.title = '';
  };

  try {
    const result = await window.electronAPI.invoke('get-plugin-settings');
    if (result?.ok && result.settings) {
      applyUi(result.settings);
    } else {
      applyUi();
    }
  } catch (e) {
    console.warn('[侧边栏] 获取插件开关失败:', e);
    applyUi();
  }

// 设置/更新/持久化：save的具体业务逻辑。
  const save = async () => {
    const payload = {
      removeWatermarkEnabled: !!removeWmSwitch.checked,
      translateExtEnabled: !!translateSwitch.checked,
    };
    try {
      const resp = await window.electronAPI.invoke('set-plugin-settings', payload);
      if (!resp?.ok) {
        applyUi(lastSettings);
        window.MessageModal.showErrorMessage('保存插件开关失败: ' + (resp?.error || '未知错误'));
        return;
      }
      applyUi(resp.settings || payload);
      window.MessageModal.showSuccessMessage('插件开关已保存，新的设置会影响后续打开的页面');
    } catch (e) {
      applyUi(lastSettings);
      window.MessageModal.showErrorMessage('保存插件开关失败: ' + (e?.message || String(e)));
    }
  };

  removeWmSwitch.addEventListener('change', save);
  translateSwitch.addEventListener('change', save);
}
