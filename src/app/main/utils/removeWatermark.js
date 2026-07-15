const { Menu, BrowserWindow, globalShortcut, clipboard } = require('electron');
const { extFromUrl } = require('./download');

// 全局快捷键管理器
const shortcutManager = {
  // 当前注册的快捷键列表
  registeredShortcuts: new Set(),

  // 注册快捷键
  register(wc, dependencies = {}) {
    if (!wc || wc.isDestroyed()) return;

    const { refreshPage } = dependencies;

    // 避免重复注册
    this.unregister();

    try {
      // F5 - 刷新页面
      if (refreshPage) {
        globalShortcut.register('F5', () => {
          try {
            refreshPage();
          } catch (e) {
            console.warn('[Shortcut] F5 refresh failed:', e?.message || e);
          }
        });
        this.registeredShortcuts.add('F5');
      }

      // Ctrl+R - 刷新页面（备用）
      if (refreshPage) {
        globalShortcut.register('CommandOrControl+R', () => {
          try {
            refreshPage();
          } catch (e) {
            console.warn('[Shortcut] Ctrl+R refresh failed:', e?.message || e);
          }
        });
        this.registeredShortcuts.add('CommandOrControl+R');
      }

      // 编辑快捷键 - 通过DOM事件处理，不使用全局快捷键
      // 因为全局注册Ctrl+C/X/V会干扰正常的编辑行为

      // 可选：在开发环境下输出日志
      // process.env.NODE_ENV === 'development' && console.debug('[Shortcut] 已注册全局快捷键');
    } catch (e) {
      console.warn('[Shortcut] 注册快捷键失败:', e?.message || e);
    }
  },

  // 注销所有快捷键
  unregister() {
    try {
      for (const shortcut of this.registeredShortcuts) {
        globalShortcut.unregister(shortcut);
      }
      this.registeredShortcuts.clear();
      // 可选：在开发环境下输出日志
      // process.env.NODE_ENV === 'development' && console.debug('[Shortcut] 已注销全局快捷键');
    } catch (e) {
      console.warn('[Shortcut] 注销快捷键失败:', e?.message || e);
    }
  }
};

// 清除页面的注入记录，允许重新注入（用于页面刷新等场景）
function clearInjectionRecord() {}

// 右键菜单功能 - 使用传统原生菜单
function attachContextMenu(wc, dependencies = {}) {
  const { addTab, downloadOrSaveMedia, tabs, activeTabId, refreshPage } = dependencies;

  try {
    if (!wc || wc.isDestroyed()) return;

    // 当webContents获得焦点时注册快捷键
    wc.on('focus', () => {
      shortcutManager.register(wc, dependencies);
    });

    // 当webContents失去焦点时注销快捷键
    wc.on('blur', () => {
      shortcutManager.unregister();
    });

    // 当webContents销毁时清理快捷键
    wc.on('destroyed', () => {
      shortcutManager.unregister();
    });

    // 监听右键菜单事件 - 使用最传统的原生菜单
    wc.on('context-menu', (event, params) => {
      // 直接使用原生菜单，简单可靠
        fallbackToNativeMenu(wc, params, dependencies);
    });
  } catch (_) {}
}



// 回退到原生菜单
function fallbackToNativeMenu(wc, params, dependencies) {
  const { addTab, downloadOrSaveMedia, tabs, activeTabId, refreshPage } = dependencies;

  try {
    const template = [];
    const editFlags = params.editFlags || {};
    const isEditable = params.isEditable || false;
    const hasSelection = !!(params.selectionText && params.selectionText.trim());
    const linkURL = params.linkURL && params.linkURL.startsWith('http') ? params.linkURL : '';
    const srcURL = params.srcURL && params.srcURL.startsWith('http') ? params.srcURL : '';
    const mediaType = params.mediaType || '';

    // 链接相关操作
    if (linkURL) {
      template.push({
        label: '🔗 在新标签页打开链接',
        accelerator: 'CmdOrCtrl+Click',
        click: () => { try { addTab && addTab(linkURL); } catch (_) {} }
      });
      template.push({ type: 'separator' });
    }

    // 媒体相关操作
    if (mediaType === 'image') {
      template.push({
        label: '📋 复制图片',
        click: async () => {
          try {
            if (wc && !wc.isDestroyed()) {
              wc.copyImageAt(params.x, params.y);
            }
          } catch (_) {
            try {
              if (wc && !wc.isDestroyed()) {
                const ok = await wc.executeJavaScript(`(function(){
                  try {
                    const el = document.elementFromPoint(${params.x}, ${params.y});
                    const img = el && (el.closest && el.closest('img')) || (el && el.tagName && el.tagName.toLowerCase()==='img' && el);
                    if (!img) return false;
                    const c = document.createElement('canvas');
                    const w = img.naturalWidth || img.width || 0;
                    const h = img.naturalHeight || img.height || 0;
                    if (!w || !h) return false;
                    c.width = w; c.height = h;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    return c.toDataURL('image/png') || '';
                  } catch(e){ return false; }
                })()`, true);
                if (ok && typeof ok === 'string' && ok.startsWith('data:image/')) {
                  const { nativeImage } = require('electron');
                  const img = nativeImage.createFromDataURL(ok);
                  if (!img.isEmpty()) clipboard.writeImage(img);
                }
              }
            } catch(_) {}
          }
        }
      });
      template.push({
        label: '💾 保存图片...',
        accelerator: 'CmdOrCtrl+S',
        click: async () => {
          try {
            let u = srcURL;
            if (!u) {
              u = await wc.executeJavaScript(`(function(){ try { const el = document.elementFromPoint(${params.x}, ${params.y}); const m = el && (el.closest && el.closest('img, picture')) || (el && el.tagName && el.tagName.toLowerCase()==='img' && el); if (!m) return ''; const s = (m.currentSrc || m.src || (m.querySelector && (m.querySelector('source') && m.querySelector('source').src)) || ''); return s || ''; } catch(e){ return ''; } })()`, true);
            }
            if (u && downloadOrSaveMedia) await downloadOrSaveMedia(wc, u);
          } catch(_){ }
        }
      });
      template.push({ type: 'separator' });
    } else if (mediaType === 'video' || mediaType === 'audio') {
      const mediaLabel = mediaType === 'video' ? '🎬 下载视频...' : '🎵 下载音频...';
      template.push({
        label: mediaLabel,
        accelerator: 'CmdOrCtrl+S',
        click: async () => {
          try {
            let info = null;
            info = await wc.executeJavaScript(`(function(){
              try {
                const el = document.elementFromPoint(${params.x}, ${params.y});
                const m = el && (el.closest && el.closest('${mediaType}')) || (el && el.tagName && el.tagName.toLowerCase()==='${mediaType}' && el);
                if (!m) return { src: '', type: '' };
                const src = m.currentSrc || m.src || (m.querySelector && (m.querySelector('source') && m.querySelector('source').src)) || '';
                let type = '';
                try {
                  const sources = m.querySelectorAll ? Array.from(m.querySelectorAll('source')) : [];
                  for (const s of sources) { if (!src || s.src === src) { type = s.type || ''; break; } }
                } catch(_) {}
                return { src: src || '', type: type || '' };
              } catch(e){ return { src: '', type: ''}; }
            })()`, true);
// 处理：finalUrl的具体业务逻辑。
            const finalUrl = (info && info.src) ? info.src : (srcURL || '');
            if (!finalUrl || !downloadOrSaveMedia) return;
            const extH = extFromUrl(finalUrl) || (mediaType === 'video' ? 'mp4' : '');
            await downloadOrSaveMedia(wc, finalUrl, { mimeHint: (info && info.type) || '', extHint: extH });
          } catch(_){ }
        }
      });
      template.push({ type: 'separator' });
    } else if (srcURL) {
      template.push({
        label: '💾 保存资源...',
        accelerator: 'CmdOrCtrl+S',
        click: async () => { try { downloadOrSaveMedia && await downloadOrSaveMedia(wc, srcURL); } catch(_){} }
      });
      template.push({ type: 'separator' });
    }

    // 页面操作
    template.push({
      label: '🔄 刷新页面',
      accelerator: 'F5',
      click: () => { try { refreshPage && refreshPage(); } catch (_) {} }
    });
    template.push({ type: 'separator' });

    // 编辑操作
    if (isEditable) {
      if (editFlags.canUndo) template.push({
        role: 'undo',
        label: '撤销',
        accelerator: 'CmdOrCtrl+Z'
      });
      if (editFlags.canRedo) template.push({
        role: 'redo',
        label: '重做',
        accelerator: 'CmdOrCtrl+Y'
      });
      if (template.length && template[template.length - 1]?.type !== 'separator') template.push({ type: 'separator' });
      if (editFlags.canCut) template.push({
        role: 'cut',
        label: '剪切',
        accelerator: 'CmdOrCtrl+X'
      });
      if (editFlags.canCopy) template.push({
        role: 'copy',
        label: '复制',
        accelerator: 'CmdOrCtrl+C'
      });
      if (editFlags.canPaste) template.push({
        role: 'paste',
        label: '粘贴',
        accelerator: 'CmdOrCtrl+V'
      });
    } else {
      if (hasSelection && editFlags.canCopy) {
        template.push({
          role: 'copy',
          label: '复制',
          accelerator: 'CmdOrCtrl+C'
        });
      }
    }

    const menu = Menu.buildFromTemplate(template);
    if (menu) menu.popup({ window: BrowserWindow.fromWebContents(wc) });
  } catch (e) {
    console.warn('回退到原生菜单失败:', e?.message || e);
  }
}

module.exports = {
  attachContextMenu,
  clearInjectionRecord,
  shortcutManager
};
