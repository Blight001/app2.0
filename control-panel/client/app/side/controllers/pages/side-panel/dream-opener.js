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
        if (!key) throw new Error('请先输入卡密');

        if (!window.electron || typeof window.electron.openDreamPage !== 'function') {
          throw new Error('Electron 桥接未就绪（缺少 openDreamPage），请在 preload/main 中实现后再试');
        }

        console.log('[前端] 用户点击"一键启动 即梦AI"按钮');
        console.log('[前端] 发送请求参数 - 卡密:', key.substring(0, 8) + '***', '设备ID:', deviceId);

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

// 监听/绑定：attachOpenOpenCutPage的具体业务逻辑。
  function attachOpenOpenCutPage() {
    const btn = getEl('open-opencut-page-btn');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
      const task = withBusyButton(e.currentTarget, async () => {
        if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
          throw new Error('Electron 桥接未就绪，请在 preload/main 中实现后再试');
        }

        console.log('[前端] 用户点击"视频剪辑"按钮');
        const result = await window.electronAPI.invoke('open-opencut-page');
        if (!result || result.ok !== true) {
// 处理：msg的具体业务逻辑。
          const msg = (result && (result.message || result.error)) || '打开失败';
          console.error('[前端] 打开 OpenCut 失败:', msg);
          throw new Error(msg);
        }

        console.log('[前端] OpenCut 打开成功，标签页ID:', result.tabId);
      }, {
        loadingText: '打开中...',
      }).catch(() => {});

      if (task && typeof task.catch === 'function') {
        task.catch(() => {});
      }
    }, false);
  }

// 监听/绑定：attachOpenAiCanvasProPage的具体业务逻辑。
  function attachOpenAiCanvasProPage() {
    const btn = getEl('open-ai-canvas-pro-page-btn');
    if (!btn) return;
    const originalText = btn.textContent;
    let aiCanvasProProgressListener = null;
    let aiCanvasProBusy = false;

    const confirmAiCanvasProDownload = async () => {
      if (!window.MessageModal || typeof window.MessageModal.showConfirmDialog !== 'function') {
        throw new Error('内置确认弹窗不可用，请稍后再试');
      }

      return await new Promise((resolve) => {
        window.MessageModal.showConfirmDialog(
          '未检测到 AI-CanvasPro 拓展，是否现在下载并安装到 extensions_app 目录？',
          () => resolve(true),
          () => resolve(false),
          'warning',
        );
      });
    };

    const updateProgressText = (payload = {}) => {
      if (!aiCanvasProBusy) return;
      const phase = String(payload.phase || '').trim().toLowerCase();
      const percent = Number(payload.percent);
      const rounded = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null;

      if (phase === 'downloading' || phase === 'preparing') {
        btn.textContent = rounded === null ? '下载中...' : `下载中 ${rounded}%`;
        return;
      }

      if (phase === 'extracting' || phase === 'installing') {
        btn.textContent = rounded === null ? '安装中...' : `安装中 ${rounded}%`;
        return;
      }

      if (phase === 'completed') {
        btn.textContent = '安装完成';
      }
    };

    const bindProgressListener = () => {
      if (!window.electronAPI || typeof window.electronAPI.on !== 'function') return;
      if (aiCanvasProProgressListener) return;
      aiCanvasProProgressListener = window.electronAPI.on('ai-canvas-pro-install-progress', updateProgressText);
    };

    const unbindProgressListener = () => {
      if (window.electronAPI && typeof window.electronAPI.off === 'function' && aiCanvasProProgressListener) {
        window.electronAPI.off('ai-canvas-pro-install-progress', aiCanvasProProgressListener);
      }
      aiCanvasProProgressListener = null;
    };

    btn.addEventListener('click', async () => {
      if (aiCanvasProBusy) return;
      aiCanvasProBusy = true;
      btn.dataset.aiCanvasProBusy = '1';
      btn.textContent = '检查中...';
      bindProgressListener();

      try {
        if (!window.electron || typeof window.electron.openAiCanvasProPage !== 'function') {
          throw new Error('Electron 桥接未就绪，请在 preload/main 中实现后再试');
        }
        if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
          throw new Error('Electron IPC 未就绪，请在 preload/main 中实现后再试');
        }

        console.log('[前端] 用户点击"无限画布"按钮');
        const installedResp = await window.electronAPI.invoke('is-ai-canvas-pro-installed');
        if (!installedResp || installedResp.ok !== true) {
          throw new Error((installedResp && installedResp.message) || '无法检查 AI-CanvasPro 拓展是否已安装');
        }

        if (!installedResp.installed) {
          const shouldDownload = await confirmAiCanvasProDownload();
          if (!shouldDownload) {
            console.log('[前端] 用户取消了 AI-CanvasPro 下载');
            return;
          }
        }

        btn.textContent = installedResp.installed ? '打开中...' : '准备下载...';
        const result = await window.electron.openAiCanvasProPage();
        if (!result || result.ok !== true) {
// 处理：msg的具体业务逻辑。
          const msg = (result && (result.message || result.error)) || '打开失败';
          console.error('[前端] 打开无限画布失败:', msg);
          throw new Error(msg);
        }

        console.log('[前端] 无限画布打开成功，标签页ID:', result.tabId);
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (window.MessageModal) {
          window.MessageModal.showErrorMessage('操作失败：' + msg);
        } else {
          console.error(msg);
        }
      } finally {
        aiCanvasProBusy = false;
        delete btn.dataset.aiCanvasProBusy;
        unbindProgressListener();
        btn.textContent = originalText;
      }
    }, false);
  }

// 监听/绑定：attachOpenToonflowPage的具体业务逻辑。
  function attachOpenToonflowPage() {
    const btn = getEl('open-toonflow-page-btn');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
      const task = withBusyButton(e.currentTarget, async () => {
        if (!window.electron || typeof window.electron.openToonflowPage !== 'function') {
          throw new Error('Electron 桥接未就绪（缺少 openToonflowPage），请在 preload/main 中实现后再试');
        }

        console.log('[前端] 用户点击"自动分镜"按钮');
        const result = await window.electron.openToonflowPage();
        if (!result || result.ok !== true) {
// 处理：msg的具体业务逻辑。
          const msg = (result && (result.message || result.error)) || '打开失败';
          console.error('[前端] 打开 Toonflow 失败:', msg);
          throw new Error(msg);
        }

        console.log('[前端] Toonflow 打开成功，标签页ID:', result.tabId);
      }, {
        loadingText: '打开中...',
      }).catch(() => {});

      if (task && typeof task.catch === 'function') {
        task.catch(() => {});
      }
    }, false);
  }

  // 由于本脚本在 body 尾部引入，DOM 已可用；这里直接绑定，另加一层兜底
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachOpenDreamPage);
    document.addEventListener('DOMContentLoaded', attachOpenOpenCutPage);
    document.addEventListener('DOMContentLoaded', attachOpenAiCanvasProPage);
    document.addEventListener('DOMContentLoaded', attachOpenToonflowPage);
  } else {
    attachOpenDreamPage();
    attachOpenOpenCutPage();
    attachOpenAiCanvasProPage();
    attachOpenToonflowPage();
  }
})();
