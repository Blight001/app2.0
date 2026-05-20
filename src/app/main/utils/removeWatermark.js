const fs = require('fs');
const path = require('path');
const { Menu, BrowserWindow, globalShortcut, clipboard } = require('electron');

// Chrome 扩展：去水印插件目录
const EXT_DIR = path.join(__dirname, '../../../assets/extensions/remove_watermark');
const EXT_CORE_PATH = path.join(EXT_DIR, 'EDzMc92pfi.js');
const EXT_PAGE_CORE_PATH = path.join(EXT_DIR, 'page-core.js');

// 去水印总开关（支持运行时更新）
let removeWatermarkEnabled = false;

// 去水印核心脚本缓存，避免每个标签页重复同步读盘
let removeWmCoreCode = null;
let removeWmCoreLoadPromise = null;
let removeWmPageCoreCode = null;
let removeWmPageCoreLoadPromise = null;

// 在模块加载时预加载核心脚本
(async function preloadCoreScript() {
  if (!removeWatermarkEnabled) {
    console.log('[RemoveWM] 去水印功能已关闭，跳过核心脚本预加载');
    return;
  }
  try {
    console.log('[RemoveWM] 开始预加载核心脚本...');
    await ensureRemoveWmCoreLoaded();
    console.log('[RemoveWM] 核心脚本预加载完成');
  } catch (e) {
    console.warn('[RemoveWM] 预加载核心脚本失败:', e?.message || e);
  }
})();

// 已注入页面的跟踪，避免重复注入和日志输出
const injectedPages = new WeakSet();

// 配置选项
const CONFIG = {
  // 是否启用延迟注入（只在需要时注入）
  lazyInjection: true,
  // 延迟注入的触发条件（毫秒）
  lazyInjectionDelay: 1000
};

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
function clearInjectionRecord(wc) {
  injectedPages.delete(wc);
}

// 延迟注入去水印核心脚本（在页面加载后延迟执行）
function scheduleLazyInjection(wc) {
  if (!CONFIG.lazyInjection) {
    // 如果不启用延迟注入，直接注入
    injectRemoveWatermarkCore(wc);
    return;
  }

  // 延迟注入，避免影响页面初始加载性能
  setTimeout(() => {
    if (!wc || wc.isDestroyed()) return;
    injectRemoveWatermarkCore(wc);
  }, CONFIG.lazyInjectionDelay);
}

// 校验/保护：ensureRemoveWmCoreLoaded的具体业务逻辑。
async function ensureRemoveWmCoreLoaded() {
  if (!removeWatermarkEnabled) return '';
  if (removeWmCoreCode && typeof removeWmCoreCode === 'string') return removeWmCoreCode;
  if (!removeWmCoreLoadPromise) {
    removeWmCoreLoadPromise = fs.promises.readFile(EXT_CORE_PATH, 'utf8')
      .then(code => {
        removeWmCoreCode = code || '';
        return removeWmCoreCode;
      })
      .catch(e => {
        console.warn('[RemoveWM] 读取核心脚本失败:', e?.message || e);
        return '';
      });
  }
  return removeWmCoreLoadPromise;
}

// 校验/保护：ensureRemoveWmPageCoreLoaded的具体业务逻辑。
async function ensureRemoveWmPageCoreLoaded() {
  if (!removeWatermarkEnabled) return '';
  if (removeWmPageCoreCode && typeof removeWmPageCoreCode === 'string') return removeWmPageCoreCode;
  if (!removeWmPageCoreLoadPromise) {
    removeWmPageCoreLoadPromise = fs.promises.readFile(EXT_PAGE_CORE_PATH, 'utf8')
      .then((code) => {
        removeWmPageCoreCode = code || '';
        return removeWmPageCoreCode;
      })
      .catch((e) => {
        console.warn('[RemoveWM] 读取页面处理脚本失败:', e?.message || e);
        return '';
      });
  }
  return removeWmPageCoreLoadPromise;
}

// 强制注入去水印核心脚本（绕过 MV3 service_worker 依赖）
async function injectRemoveWatermarkCore(wc) {
  if (!removeWatermarkEnabled) return;
  try {
    if (!wc || wc.isDestroyed()) return;

    // 检查是否已经注入过，避免重复注入
    if (injectedPages.has(wc)) return;
    injectedPages.add(wc);

    const [coreCode, pageCoreCode] = await Promise.all([
      ensureRemoveWmCoreLoaded(),
      ensureRemoveWmPageCoreLoaded(),
    ]);

    if (!coreCode && !pageCoreCode) return;

    const combinedScript = `
      (function() {
        try {
          localStorage.setItem('__SP_COPY__', JSON.stringify({ origin: true, expire: null }));
          localStorage.setItem('__SP_CONTEXT_MENU_TYPE__', JSON.stringify({ origin: true, expire: null }));
          localStorage.setItem('__SP_KEYBOARD_TYPE__', JSON.stringify({ origin: true, expire: null }));

          ${coreCode || ''}
          ${pageCoreCode || ''}

// 处理：send的具体业务逻辑。
          const send = (type) => window.dispatchEvent(new CustomEvent('lah2AqVqxG', { detail: JSON.stringify({ type, payload: 'START' }) }));
          send('__COPY_TYPE__CI__');
          send('__KEYBOARD_TYPE__CI__');
          send('__CONTEXT_MENU_TYPE__CI__');

          return true;
        } catch (e) {
          console.warn('[RemoveWM] 注入执行失败:', e?.message || e);
          return false;
        }
      })();
    `;

    await wc.executeJavaScript(combinedScript, true);
    console.log('[RemoveWM] 已注入去水印脚本');
  } catch (e) {
    console.warn('[RemoveWM] 注入失败:', e?.message || e);
  }
}

// 强制去水印（当前激活页）：注入插件核心 + 页面处理脚本
async function forceRemoveWatermark(wc, immediate = false) {
  if (!removeWatermarkEnabled) return false;
  try {
    if (!wc || wc.isDestroyed()) return false;

    // 如果需要立即注入，则直接注入；否则使用延迟注入
    if (immediate) {
      await injectRemoveWatermarkCore(wc);
    } else {
      scheduleLazyInjection(wc);
    }
    return true;
  } catch (e) {
    console.warn('[RemoveWM] 强制去水印失败:', e?.message || e);
    return false;
  }
}

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
        click: () => { try { addTab && addTab(linkURL, { partition: tabs && activeTabId && tabs.get(activeTabId)?.partition }); } catch (_) {} }
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


// 辅助函数：从 URL 提取扩展名
function extFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const b = p.split('/').pop() || '';
    const m = b.match(/\.([A-Za-z0-9]{2,6})$/);
    return m ? m[1].toLowerCase() : '';
  } catch (_) { return ''; }
}

module.exports = {
  get removeWatermarkEnabled() {
    return removeWatermarkEnabled;
  },
  setRemoveWatermarkEnabled: (enabled) => {
    removeWatermarkEnabled = !!enabled;
    if (removeWatermarkEnabled) {
      ensureRemoveWmCoreLoaded().catch(() => {});
    }
  },
  EXT_DIR,
  EXT_CORE_PATH,
  EXT_PAGE_CORE_PATH,
  ensureRemoveWmCoreLoaded,
  ensureRemoveWmPageCoreLoaded,
  injectRemoveWatermarkCore,
  forceRemoveWatermark,
  attachContextMenu,
  clearInjectionRecord,
  scheduleLazyInjection,
  CONFIG,
  shortcutManager
};
