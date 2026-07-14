// 负责“打开即梦网页”按钮的事件绑定与调用主进程逻辑
// 环境：Electron 渲染进程（需在 preload 暴露 window.electron.openDreamPage）

(() => {
  const DreamOpenerUtils = window.RendererControllerUtils || {};
  const getEl = DreamOpenerUtils.getEl || ((id) => document.getElementById(id));
  const withBusyButton = DreamOpenerUtils.withBusyButton || ((btn, fn, options = {}) => {
    if (!btn || btn.dataset.busy === '1') return null;
    const companions = Array.isArray(options.companions) ? options.companions.filter(Boolean) : [];
    const originalText = btn.textContent;
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = options.loadingText || btn.dataset.loadingText || '处理中...';
    companions.forEach((el) => {
      el.dataset.prevDisabled = el.disabled ? '1' : '0';
      el.disabled = true;
    });
    return Promise.resolve()
      .then(fn)
      .catch((err) => {
// 处理：msg的具体业务逻辑。
        const msg = (err && err.message) ? err.message : String(err);
        if (window.MessageModal) {
          window.MessageModal.showErrorMessage('操作失败：' + msg);
        } else {
          console.error(msg);
        }
        throw err;
      })
      .finally(() => {
        btn.dataset.busy = '0';
        btn.disabled = false;
        btn.textContent = originalText;
        companions.forEach((el) => {
          const prev = el.dataset.prevDisabled === '1';
          el.disabled = prev;
          delete el.dataset.prevDisabled;
        });
      });
  });

// 监听/绑定：attachOpenDreamPage的具体业务逻辑。
  function attachOpenDreamPage() {
    const btn = getEl('open-dream-page-btn');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
      const task = withBusyButton(e.currentTarget, async () => {
// 处理：key的具体业务逻辑。
        const key = (getEl('key-input')?.value || '').trim();
// 处理：deviceId的具体业务逻辑。
        const deviceId = (getEl('device-id')?.value || '').trim();
        if (!key) throw new Error('请先登录账号');

        if (!window.electron || typeof window.electron.openDreamPage !== 'function') {
          throw new Error('Electron 桥接未就绪（缺少 openDreamPage），请在 preload/main 中实现后再试');
        }

        console.log('[前端] 用户点击"一键启动 即梦AI"按钮');
        console.log('[前端] 发送账号授权请求，设备ID:', deviceId);

        const result = await window.electron.openDreamPage({ key, deviceId });
        if (!result || result.ok !== true) {
// 处理：msg的具体业务逻辑。
          const msg = (result && (result.message || result.error)) || '打开失败';
          console.error('[前端] 打开网页失败:', msg);
          throw new Error(msg);
        }

        console.log('[前端] 网页打开请求成功，标签页ID:', result.tabId);

        window.dispatchEvent(new CustomEvent('account-history-panel-open-request'));

        // 打开成功后，延迟刷新账号列表（等待账号保存完成）
        // 通过自定义事件通知 side-panel.js 刷新列表
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('account-list-should-refresh'));
        }, 2000);
      }, {
        companions: [
          document.getElementById('validate-key-btn'),
          document.getElementById('VPN-switch'),
        ],
        onError: (err) => {
// 处理：msg的具体业务逻辑。
          const msg = (err && err.message) ? err.message : String(err);
          if (window.MessageModal) {
            window.MessageModal.showErrorMessage('操作失败：' + msg);
          } else {
            console.error(msg);
          }
        },
      }).catch(() => {});
      if (task && typeof task.catch === 'function') {
        task.catch(() => {});
      }
    }, false);
  }

  // 由于本脚本在 body 尾部引入，DOM 已可用；这里直接绑定，另加一层兜底
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachOpenDreamPage);
  } else {
    attachOpenDreamPage();
  }
})();
