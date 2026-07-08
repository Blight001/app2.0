const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app, dialog, BrowserWindow } = require('electron');

// ---- 下载相关全局变量 ----
const downloadPrefs = { file: null };
let lastDownloadDir = null;

// 下载处理：每个 session 只注册一次 will-download
const downloadedSessions = new WeakSet();
const pendingDownloadPaths = new Map(); // url -> absolute save path
const downloadWindowStates = new WeakMap();

// ---- 工具函数 ----
// 下载目录记忆：默认用上次选择的目录，但每次仍弹出对话框
function initDownloadPrefs() {
  try {
    downloadPrefs.file = path.join(app.getPath('userData'), 'download_prefs');
    try {
      const s = fs.readFileSync(downloadPrefs.file, 'utf8');
      const j = JSON.parse(s);
      lastDownloadDir = (j && typeof j.lastDownloadDir === 'string' && j.lastDownloadDir) || null;
    } catch (_) {
      try {
        const legacy = `${downloadPrefs.file}.json`;
        const s = fs.readFileSync(legacy, 'utf8');
        const j = JSON.parse(s);
        lastDownloadDir = (j && typeof j.lastDownloadDir === 'string' && j.lastDownloadDir) || null;
        fs.writeFileSync(downloadPrefs.file, JSON.stringify({ lastDownloadDir }, null, 2));
        try { fs.unlinkSync(legacy); } catch (_) {}
      } catch (_) {}
    }
  } catch (_) {}
}

// 设置/更新/持久化：persistLastDir的具体业务逻辑。
function persistLastDir(dir) {
  try {
    if (!dir) return;
    lastDownloadDir = dir;
    if (!downloadPrefs.file) downloadPrefs.file = path.join(app.getPath('userData'), 'download_prefs');
    fs.writeFileSync(downloadPrefs.file, JSON.stringify({ lastDownloadDir }, null, 2));
  } catch (_) {}
}

// 获取/读取/解析：getDefaultSavePath的具体业务逻辑。
function getDefaultSavePath(fileName) {
  try {
// 处理：base的具体业务逻辑。
    const base = (lastDownloadDir && typeof lastDownloadDir === 'string') ? lastDownloadDir : app.getPath('downloads');
    return path.join(base, fileName || 'download');
  } catch (_) {
    return fileName || 'download';
  }
}

// ---- 文件名/类型 辅助 ----
function safeFilename(name) {
  try {
    const INVALID = /[\\/:*?"<>|]/g; // Windows 非法字符
    let n = String(name || '').trim().replace(INVALID, '_');
    if (!n) n = 'download';
    // 去除尾部空格/点
    n = n.replace(/[\s.]+$/g, '');
    if (!n) n = 'download';
    // 控制长度
    if (n.length > 180) n = n.slice(0, 180);
    return n;
  } catch (_) { return 'download'; }
}

// 校验/保护：hasExt的具体业务逻辑。
function hasExt(name) {
  const b = path.basename(String(name||''));
  return /\.[A-Za-z0-9]{2,6}$/.test(b);
}

// 处理：mimeToExt的具体业务逻辑。
function mimeToExt(mime) {
  const m = String(mime||'').toLowerCase();
  const map = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/aac': 'aac',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/x-bmp': 'bmp',
    'image/bmp;': 'bmp',
    'image/svg+xml': 'svg',
    'image/tiff': 'tiff',
    'image/x-tiff': 'tiff',
    // 通用图片类型
    'image/': 'png', // 默认回退到png
  };
  // 精确匹配
  if (map[m]) return map[m];
  // 前缀匹配（用于处理变体类型）
  for (const [key, value] of Object.entries(map)) {
    if (m.startsWith(key)) return value;
  }
  return '';
}

// 处理：isVideoMime的具体业务逻辑。
function isVideoMime(mime) {
  const m = String(mime||'').toLowerCase();
  return m.startsWith('video/');
}

// 处理：extFromUrl的具体业务逻辑。
function extFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const b = p.split('/').pop() || '';
    const m = b.match(/\.([A-Za-z0-9]{2,6})$/);
    return m ? m[1].toLowerCase() : '';
  } catch (_) { return ''; }
}

// 从图片数据头部检测真实格式
function detectImageFormatFromData(buffer) {
  try {
    if (!buffer || buffer.length < 4) return '';

    // 检查PNG (89 50 4E 47)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'png';
    }

    // 检查JPEG/JPG (FF D8 FF)
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'jpg';
    }

    // 检查GIF (47 49 46)
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'gif';
    }

    // 检查BMP (42 4D)
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      return 'bmp';
    }

    // 检查WebP (52 49 46 46 ... 57 45 42 50)
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'webp';
    }

    // 检查SVG (3C 73 76 67 或 3C 3F 78 6D)
    if ((buffer[0] === 0x3C && buffer[1] === 0x73 && buffer[2] === 0x76 && buffer[3] === 0x67) ||
        (buffer[0] === 0x3C && buffer[1] === 0x3F && buffer[2] === 0x78 && buffer[3] === 0x6D)) {
      return 'svg';
    }

    // 检查TIFF (49 49 2A 00 或 4D 4D 00 2A)
    if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
        (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) {
      return 'tiff';
    }

    return '';
  } catch (_) {
    return '';
  }
}

// 处理：withExt的具体业务逻辑。
function withExt(name, ext) {
  const n = safeFilename(name);
  if (!ext) return n;
  if (hasExt(n)) return n; // 已有人为输入扩展名则尊重
  return `${n}.${ext}`;
}

// 规范化扩展名：将通用/错误的扩展名映射为合理值（例如 .image -> png）
function normalizeExt(ext) {
  try {
    if (!ext) return '';
    let e = String(ext || '').toLowerCase();
    e = e.replace(/^\./, '');
    if (!e) return '';
    if (e === 'image') return 'png'; // 某些右键保存会出现 .image，直接当 png 处理
    if (e === 'jpeg') return 'jpg';
    // 防止把长 mime 前缀误当作扩展名
    if (e.startsWith('image/')) return 'png';
    return e;
  } catch (_) { return ext; }
}

// 处理：dialogFiltersByExt的具体业务逻辑。
function dialogFiltersByExt(ext) {
  if (!ext) return [ { name: '所有文件', extensions: ['*'] } ];
  const typeMap = {
    mp4: 'MP4 视频', webm: 'WebM 视频', ogv: 'Ogg 视频', mov: 'QuickTime 视频', mkv: 'Matroska 视频',
    mp3: 'MP3 音频', ogg: 'Ogg 音频', wav: 'WAV 音频', aac: 'AAC 音频',
    jpg: 'JPEG 图片', jpeg: 'JPEG 图片', png: 'PNG 图片', webp: 'WebP 图片', gif: 'GIF 图片',
    bmp: 'BMP 图片', svg: 'SVG 图片', tiff: 'TIFF 图片',
  };
  const name = typeMap[ext] || `${ext.toUpperCase()} 文件`;
  return [ { name, extensions: [ext] }, { name: '所有文件', extensions: ['*'] } ];
}

// 获取/读取/解析：resolveDownloadWindow的具体业务逻辑。
function resolveDownloadWindow(wc) {
  try {
    const win = BrowserWindow.fromWebContents(wc);
    if (!win || win.isDestroyed()) return null;
    return win;
  } catch (_) {
    return null;
  }
}

// 设置/更新/持久化：setDownloadWindowProgress的具体业务逻辑。
function setDownloadWindowProgress(wc, percent, statusText = '') {
  const win = resolveDownloadWindow(wc);
  if (!win) return;

  try {
    let state = downloadWindowStates.get(win);
    if (!state) {
      state = { originalTitle: '' };
      downloadWindowStates.set(win, state);
    }

    if (!state.originalTitle) {
      state.originalTitle = typeof win.getTitle === 'function' ? (win.getTitle() || '') : '';
    }

    if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
      const clamped = Math.max(0, Math.min(1, percent / 100));
      try { win.setProgressBar(clamped); } catch (_) {}
      const titlePrefix = '下载中';
      const suffix = statusText ? ` · ${statusText}` : '';
      try { win.setTitle(`${state.originalTitle || 'AI-FREE'} - ${titlePrefix} ${Math.max(0, Math.min(100, Math.round(percent)))}%${suffix}`); } catch (_) {}
    } else {
      try { win.setProgressBar(-1); } catch (_) {}
      if (state.originalTitle) {
        try { win.setTitle(state.originalTitle); } catch (_) {}
      }
    }
  } catch (_) {}
}

// 停止/关闭/清理：clearDownloadWindowProgress的具体业务逻辑。
function clearDownloadWindowProgress(wc) {
  setDownloadWindowProgress(wc, -1);
}

// 下载处理：每个 session 只注册一次 will-download
function attachDownloadHandler(session) {
  try {
    if (!session || downloadedSessions.has(session)) return;
    session.on('will-download', async (event, item, webContents) => {
      try {
        if (item && typeof item.on === 'function') {
          item.on('updated', () => {
            try {
              const receivedBytes = typeof item.getReceivedBytes === 'function' ? item.getReceivedBytes() : 0;
              const totalBytes = typeof item.getTotalBytes === 'function' ? item.getTotalBytes() : 0;
              const percent = totalBytes > 0 ? Math.min(99.5, (receivedBytes / totalBytes) * 100) : null;
              setDownloadWindowProgress(webContents, percent, '正在下载');
            } catch (_) {}
          });
          item.once('done', (_doneEvent, state) => {
            try {
              clearDownloadWindowProgress(webContents);
            } catch (_) {}
            if (state === 'completed') {
              return;
            }
          });
        }

        // 如果在触发下载前已经弹窗并记录了保存路径，则直接使用，避免再次弹窗
        let urls = [];
        try {
// 处理：mainUrl的具体业务逻辑。
          const mainUrl = (typeof item.getURL === 'function') ? item.getURL() : '';
          if (mainUrl) urls.push(mainUrl);
// 处理：chain的具体业务逻辑。
          const chain = (typeof item.getURLChain === 'function') ? item.getURLChain() : [];
          if (Array.isArray(chain)) urls = urls.concat(chain);
        } catch (_) {}
        let presetPath = null;
        for (const u of urls) {
          if (pendingDownloadPaths.has(u)) {
            presetPath = pendingDownloadPaths.get(u);
            break;
          }
        }
        if (presetPath) {
          try { item.setSavePath(presetPath); } catch (_) {}
          // 清理所有相关 key，防止残留
          try { for (const u of urls) pendingDownloadPaths.delete(u); } catch (_) {}
          return;
        }

        // 未预设路径的情况：基于 MIME/URL 推断扩展名与过滤器
        const mainUrl = (typeof item.getURL === 'function') ? item.getURL() : '';
// 处理：mime的具体业务逻辑。
        const mime = (typeof item.getMimeType === 'function') ? (item.getMimeType() || '') : '';
// 处理：fileNameRaw的具体业务逻辑。
        const fileNameRaw = (typeof item.getFilename === 'function') ? (item.getFilename() || 'download') : 'download';
        let extGuess = mimeToExt(mime) || extFromUrl(mainUrl) || extFromUrl(fileNameRaw);
        extGuess = normalizeExt(extGuess);

        // 如果仍然无法确定扩展名且是图片类型，尝试从文件名中推断
        if (!extGuess && mime && mime.startsWith('image/')) {
          // 检查文件名是否包含常见图片扩展名
          const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff'];
          const lowerFileName = fileNameRaw.toLowerCase();
          for (const ext of imageExts) {
            if (lowerFileName.includes('.' + ext)) {
              extGuess = ext;
              break;
            }
          }
          // 如果还是无法确定，默认使用png
          if (!extGuess) {
            extGuess = 'png';
          }
        }
        extGuess = normalizeExt(extGuess);

        // 如果是视频文件，使用随机文件名
        const fileName = isVideoMime(mime) ? withExt(crypto.randomBytes(8).toString('hex'), extGuess) : withExt(fileNameRaw, extGuess);
        const filters = dialogFiltersByExt(extGuess);
        const savePath = await dialog.showSaveDialog({ title: '保存文件', defaultPath: getDefaultSavePath(fileName), filters });
        if (savePath.canceled) {
          item.cancel();
          return;
        }
        item.setSavePath(savePath.filePath);
        try { persistLastDir(path.dirname(savePath.filePath)); } catch (_) {}
      } catch (e) {
        try { item.cancel(); } catch(_) {}
      }
    });
    downloadedSessions.add(session);
  } catch (_) {}
}

// 处理：downloadOrSaveMedia的具体业务逻辑。
async function downloadOrSaveMedia(wc, url, suggestedNameOrOptions) {
  try {
    if (!wc || wc.isDestroyed() || !url) return;
// 处理：opts的具体业务逻辑。
    const opts = (suggestedNameOrOptions && typeof suggestedNameOrOptions === 'object' && !Array.isArray(suggestedNameOrOptions))
      ? suggestedNameOrOptions
      : { suggestedName: suggestedNameOrOptions };
    const suggestedName = opts.suggestedName || '';
    const extHint = opts.extHint || '';
    const mimeHint = opts.mimeHint || '';

    attachDownloadHandler(wc.session);
    if (/^https?:/i.test(url)) {
      // 预先弹出保存对话框（记忆上次目录），will-download 中不再弹窗
      const extUrl = extFromUrl(url);
      let ext = extHint || extUrl || mimeToExt(mimeHint);
      ext = normalizeExt(ext);
      // 使用随机字符串作为文件名
      const randomName = crypto.randomBytes(8).toString('hex');
      const defaultName = withExt(randomName, ext);
      const filters = dialogFiltersByExt(ext);
      const save = await dialog.showSaveDialog({ title: '保存文件', defaultPath: getDefaultSavePath(defaultName), filters });
      if (save.canceled) {
        clearDownloadWindowProgress(wc);
        return;
      }
      try { persistLastDir(path.dirname(save.filePath)); } catch (_) {}
      // 记录预设保存路径，触发下载
      pendingDownloadPaths.set(url, save.filePath);
      setDownloadWindowProgress(wc, 0, '正在准备下载');
      wc.downloadURL(url);
      return;
    }
    // 处理 blob:/data:/file: 等不可直接下载的 URL
    setDownloadWindowProgress(wc, 0, '正在读取媒体');
    const res = await wc.executeJavaScript(`(async () => {
      try {
        const u = ${JSON.stringify(url)};
        const r = await fetch(u);
        const b = await r.blob();
        const ab = await b.arrayBuffer();
        const arr = Array.from(new Uint8Array(ab));
        const mime = b.type || '';
        return { ok: true, data: arr, mime };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()`, true);
    if (!res || !res.ok) throw new Error(res?.error || 'fetch 失败');
    const buf = Buffer.from(res.data);

    // 确定正确的扩展名
    let ext = extHint || mimeToExt(res.mime) || mimeToExt(mimeHint);
    ext = normalizeExt(ext);

    // 如果仍然无法确定扩展名，尝试从图片数据中检测
    if (!ext && buf.length > 0) {
      ext = detectImageFormatFromData(buf);
    }

    // 如果仍然无法确定，默认使用png
    if (!ext) {
      ext = 'png';
    }

    // 使用随机字符串作为文件名
    const randomName = crypto.randomBytes(8).toString('hex');
    const defaultName = withExt(randomName, ext);
    const filters = dialogFiltersByExt(ext);
    const save = await dialog.showSaveDialog({ title: '保存媒体', defaultPath: getDefaultSavePath(defaultName), filters });
    if (save.canceled) {
      clearDownloadWindowProgress(wc);
      return;
    }
    fs.writeFileSync(save.filePath, buf);
    try { persistLastDir(path.dirname(save.filePath)); } catch (_) {}
    clearDownloadWindowProgress(wc);
  } catch (e) {
    console.warn('保存媒体失败:', e?.message || e);
    clearDownloadWindowProgress(wc);
  }
}

module.exports = {
  initDownloadPrefs,
  extFromUrl,
  downloadOrSaveMedia,
};
