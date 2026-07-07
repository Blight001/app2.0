const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { BrowserWindow, shell, app: electronApp } = require('electron');
const extractZip = require('extract-zip');
const tar = require('tar');

// 格式化/规范化：normalizeVersion的具体业务逻辑。
function normalizeVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  if (!text) return { parts: [0], preRelease: '' };

  const [mainPart, preRelease = ''] = text.split('-', 2);
  const parts = mainPart
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));

  while (parts.length > 1 && parts[parts.length - 1] === 0) {
    parts.pop();
  }

  return { parts, preRelease };
}

// 比较/匹配：compareVersions的具体业务逻辑。
function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const maxLen = Math.max(a.parts.length, b.parts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const av = a.parts[i] || 0;
    const bv = b.parts[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  if (a.preRelease && !b.preRelease) return -1;
  if (!a.preRelease && b.preRelease) return 1;
  if (a.preRelease && b.preRelease && a.preRelease !== b.preRelease) {
    return a.preRelease > b.preRelease ? 1 : -1;
  }

  return 0;
}

// 处理：firstNonEmpty的具体业务逻辑。
function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

// 更新消息里有些字段只是“回执”或“状态通知”，不是可执行的更新包信息。
// 这里把它们单独列出来，避免后面的人把它们误当成真正的更新指令。
const UPDATE_RELATED_MESSAGE_TYPES = new Set([
  'app_update',
  'update',
  'software_update',
  'upgrade',
  'success',
]);

// 处理：isUpdateRelatedMessageType的具体业务逻辑。
function isUpdateRelatedMessageType(messageType = '') {
  const type = String(messageType || '').trim().toLowerCase();
  return UPDATE_RELATED_MESSAGE_TYPES.has(type);
}

// 统一构造更新通知载荷，避免主进程和渲染层各自拼字段导致语义不一致。
function createUpdateUiPayload(normalized = {}, {
  currentVersion = '',
  phase = '',
} = {}) {
  const targetVersion = String(normalized.version || '').trim();
  const content = normalized.content || `发现新版本 v${targetVersion}`;
  return {
    ...normalized,
    currentVersion: String(currentVersion || '').trim(),
    targetVersion,
    version: targetVersion,
    title: normalized.title || '发现新版本',
    content,
    message: content,
    force: normalized.force === true,
    phase,
  };
}

// 某些服务端消息只是更新结果回执，没有 version/downloadUrl。
// 这类消息不应该进入真正的更新流程。
function shouldIgnoreUpdateReceipt(normalized = {}, messageType = '') {
  return !normalized.version && isUpdateRelatedMessageType(messageType);
}

// 获取/读取/解析：getUrlPathExtension的具体业务逻辑。
function getUrlPathExtension(urlString = '') {
  try {
    const urlObj = new URL(String(urlString || '').trim());
    return path.extname(urlObj.pathname || '').toLowerCase();
  } catch (_) {
    return '';
  }
}

// 处理：looksLikeWebPageUrl的具体业务逻辑。
function looksLikeWebPageUrl(urlString = '') {
  const ext = getUrlPathExtension(urlString);
  return ![
    '.zip',
    '.tar',
    '.tgz',
    '.gz',
    '.exe',
    '.msi',
    '.dmg',
    '.pkg',
    '.7z',
    '.rar',
    '.bat',
    '.cmd',
    '.ps1',
  ].includes(ext);
}

// 获取/读取/解析：getSuggestedFileNameFromUrl的具体业务逻辑。
function getSuggestedFileNameFromUrl(urlString = '', fallback = '') {
  try {
    const urlObj = new URL(String(urlString || '').trim());
    const name = decodeURIComponent(path.basename(urlObj.pathname || ''));
    return name || fallback;
  } catch (_) {
    return fallback;
  }
}

// 处理：toDebugString的具体业务逻辑。
function toDebugString(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    try {
      return String(value);
    } catch (err) {
      return `[Unserializable: ${err?.message || 'unknown'}]`;
    }
  }
}

// 启动/打开/显示：openDownloadPageAndAutoClick的具体业务逻辑。
async function openDownloadPageAndAutoClick({
  url,
  saveDir,
  logger = console,
  onProgress = () => {},
  showWindow = false,
  allowAutoClickOnAnyPage = false,
}) {
  const downloadUrl = String(url || '').trim();
  if (!downloadUrl) {
    throw new Error('下载页地址为空');
  }

  const targetDir = String(saveDir || '').trim();
  if (!targetDir) {
    throw new Error('未指定下载目录');
  }

  safeMkdir(targetDir);

  logger.warn?.('[更新] 准备打开下载页', {
    downloadUrl,
    saveDir: targetDir,
    showWindow,
  });

  const pageWindow = new BrowserWindow({
    show: !!showWindow,
    autoHideMenuBar: true,
    width: 1280,
    height: 900,
    icon: (() => {
      const candidate = process.resourcesPath ? path.join(process.resourcesPath, 'resource', 'seedance2.0.ico') : '';
      return candidate && fs.existsSync(candidate) ? candidate : undefined;
    })(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false,
    },
  });

  if (showWindow) {
    try { pageWindow.show(); } catch (_) {}
    try { pageWindow.focus(); } catch (_) {}
    try { pageWindow.moveTop(); } catch (_) {}
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let clickTimer = null;
    let timeoutTimer = null;
    let clickSent = false;
    let downloadStarted = false;
    let postClickTimeoutExtended = false;

// 设置/更新/持久化：setPageWindowProgress的具体业务逻辑。
    const setPageWindowProgress = (percent, statusText = '') => {
      try {
        if (pageWindow.isDestroyed()) return;
        if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
          pageWindow.setProgressBar(Math.min(Math.max(percent / 100, 0), 1));
        } else {
          pageWindow.setProgressBar(-1);
        }
        const suffix = statusText ? ` · ${statusText}` : '';
        if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
          pageWindow.setTitle(`AI-FREE - 更新页 ${Math.max(0, Math.min(100, Math.round(percent)))}%${suffix}`);
        } else {
          pageWindow.setTitle('AI-FREE - 更新页');
        }
      } catch (_) {}
    };

// 停止/关闭/清理：cleanup的具体业务逻辑。
    const cleanup = () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      try {
        if (!pageWindow.isDestroyed()) {
          pageWindow.close();
        }
      } catch (_) {}
    };

// 设置/更新/持久化：settle的具体业务逻辑。
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

// 处理：fail的具体业务逻辑。
    const fail = (error) => {
      settle(reject, error);
    };

// 处理：complete的具体业务逻辑。
    const complete = (value) => {
      settle(resolve, value);
    };

// 处理：armTimeout的具体业务逻辑。
    const armTimeout = (delayMs = 45000) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      timeoutTimer = setTimeout(() => {
        if (settled || pageWindow.isDestroyed()) return;
        if (downloadStarted) {
          return;
        }
        if (clickSent && !postClickTimeoutExtended) {
          postClickTimeoutExtended = true;
          logger.warn?.('[更新] 已点击但未接收到下载事件，延长等待', {
            delayMs,
            url: pageWindow.webContents.getURL(),
          });
          armTimeout(180000);
          return;
        }
        fail(new Error('自动点击下载按钮超时'));
      }, delayMs);
    };

// 处理：clickDownloadButton的具体业务逻辑。
    const clickDownloadButton = async () => {
      if (pageWindow.isDestroyed()) return false;
      if (clickSent) return true;
      try {
        logger.warn?.('[更新] 开始尝试自动点击下载按钮');
        const targetInfo = await pageWindow.webContents.executeJavaScript(`(async () => {
// 处理：wait的具体业务逻辑。
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 处理：textMatches的具体业务逻辑。
          const textMatches = (value) => {
            const text = String(value || '').replace(/\\s+/g, '');
            return text === '下载' || text.toLowerCase() === 'download';
          };
// 处理：textContainsDownload的具体业务逻辑。
          const textContainsDownload = (value) => {
            const text = String(value || '').replace(/\\s+/g, '');
            return text.includes('下载') || text.toLowerCase().includes('download');
          };
// 处理：isInteractive的具体业务逻辑。
          const isInteractive = (el) => !!el && (
            el.tagName === 'BUTTON'
            || el.tagName === 'A'
            || el.tagName === 'INPUT'
            || el.getAttribute?.('role') === 'button'
          );
// 获取/读取/解析：getText的具体业务逻辑。
          const getText = (el) => String(el?.innerText || el?.textContent || el?.value || '').replace(/\\s+/g, ' ').trim();
// 处理：scoreTarget的具体业务逻辑。
          const scoreTarget = (el) => {
            const text = getText(el);
            if (!text) return -Infinity;
            if (!textMatches(text) && !textContainsDownload(text)) return -Infinity;
            const normalized = text.replace(/\\s+/g, '');
            const exact = normalized === '下载' || normalized.toLowerCase() === 'download';
            let score = 0;
            if (exact) score += 1000;
            if (isInteractive(el)) score += 200;
            if (String(el.tagName || '').toUpperCase() === 'BUTTON') score += 120;
            if (String(el.className || '').includes('btn-box')) score += 100;
            if (String(el.className || '').includes('el-button')) score += 60;
            score -= Math.min(text.length, 300);
            return score;
          };
// 获取/读取/解析：findInRoot的具体业务逻辑。
          const findInRoot = (root) => {
            const selectors = [
              'button',
              'a',
              '[role="button"]',
              'input[type="button"]',
              'input[type="submit"]',
              'span',
              'div',
            ];
            const nodes = Array.from(root.querySelectorAll(selectors.join(',')));
            const candidates = [];
            for (const node of nodes) {
              const score = scoreTarget(node);
              if (score === -Infinity) continue;
              const candidate = isInteractive(node)
                ? node
                : node.closest?.('button,a,[role="button"],input[type="button"],input[type="submit"],label') || node;
              candidates.push({ candidate, score });
            }
            candidates.sort((left, right) => right.score - left.score);
            if (candidates.length > 0) {
              return candidates[0].candidate;
            }
            const allElements = Array.from(root.querySelectorAll('*'));
            for (const node of allElements) {
              const shadowRoot = node.shadowRoot;
              if (shadowRoot) {
                const found = findInRoot(shadowRoot);
                if (found) return found;
              }
            }
            return null;
          };
// 处理：pickTarget的具体业务逻辑。
          const pickTarget = () => {
            const roots = [document];
            for (const frame of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (frame.contentDocument) roots.push(frame.contentDocument);
              } catch (_) {}
            }
            for (const root of roots) {
              const target = findInRoot(root);
              if (target) return target;
            }
            return null;
          };
// 获取/读取/解析：getClickable的具体业务逻辑。
          const getClickable = () => {
            const target = pickTarget();
            if (!target) return null;
            const clickable = target.closest?.('button,a,[role="button"],input[type="button"],input[type="submit"]') || target;
            try { clickable.scrollIntoView?.({ block: 'center', inline: 'center' }); } catch (_) {}
            const rect = clickable.getBoundingClientRect?.();
            if (!rect) return null;
            const visible = rect.width > 0 && rect.height > 0;
            if (!visible) return null;
              return {
                tagName: String(clickable.tagName || '').toLowerCase(),
                text: String(clickable.innerText || clickable.textContent || clickable.value || '').trim(),
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                html: clickable.outerHTML || '',
                className: String(clickable.className || ''),
              };
            };
          for (let i = 0; i < 60; i += 1) {
            const target = getClickable();
            if (target) {
              return target;
            }
            await wait(250);
          }
          return false;
        })()`, true);
        if (!targetInfo || targetInfo === false) {
          return false;
        }
        if (typeof targetInfo.x !== 'number' || typeof targetInfo.y !== 'number') {
          logger.warn?.('[更新] 自动点击目标缺少坐标', toDebugString(targetInfo));
          return false;
        }

        logger.warn?.('[更新] 自动点击目标命中', toDebugString({
          tagName: targetInfo.tagName,
          text: targetInfo.text,
          x: targetInfo.x,
          y: targetInfo.y,
          width: targetInfo.width,
          height: targetInfo.height,
        }));

        try { pageWindow.webContents.focus(); } catch (_) {}
        try {
          clickSent = true;
          pageWindow.webContents.sendInputEvent({ type: 'mouseMove', x: targetInfo.x, y: targetInfo.y, button: 'left' });
          pageWindow.webContents.sendInputEvent({ type: 'mouseDown', x: targetInfo.x, y: targetInfo.y, button: 'left', clickCount: 1 });
          pageWindow.webContents.sendInputEvent({ type: 'mouseUp', x: targetInfo.x, y: targetInfo.y, button: 'left', clickCount: 1 });
        } catch (error) {
          clickSent = false;
          logger.warn?.('[更新] 真实鼠标点击发送失败:', error?.message || error);
          return false;
        }

        return true;
      } catch (error) {
        logger.warn?.('[更新] 页面点击脚本执行失败:', error?.message || error);
        return false;
      }
    };

// 处理：downloadHandler的具体业务逻辑。
    const downloadHandler = (_event, item) => {
      try {
        downloadStarted = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        const suggestedName = String(
          (typeof item.getFilename === 'function' && item.getFilename())
          || item.suggestedFilename
          || getSuggestedFileNameFromUrl(downloadUrl, `update-${Date.now()}.zip`)
          || `update-${Date.now()}.zip`
        ).trim();
        const savePath = path.join(targetDir, suggestedName);

        logger.warn?.('[更新] 接收到下载任务', toDebugString({
          suggestedName,
          savePath,
        }));

        item.setSavePath(savePath);

        item.on('updated', () => {
          try {
            const receivedBytes = item.getReceivedBytes();
            const totalBytes = item.getTotalBytes();
            const percent = totalBytes > 0 ? Math.min(99.5, (receivedBytes / totalBytes) * 100) : null;
            onProgress({
              phase: 'downloading',
              receivedBytes,
              totalBytes: totalBytes > 0 ? totalBytes : null,
              percent,
            });
            setPageWindowProgress(percent, '正在下载');
          } catch (_) {}
        });

        item.once('done', (_doneEvent, state) => {
          if (state === 'completed') {
            complete({ savePath, suggestedName });
            return;
          }
          fail(new Error(`页面下载失败: ${state}`));
        });
      } catch (error) {
        fail(error);
      }
    };

    pageWindow.webContents.session.once('will-download', downloadHandler);

    pageWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
      const targetUrl = String(nextUrl || '').trim();
      logger.warn?.('[更新] 下载页尝试打开新窗口', { targetUrl });
      if (targetUrl) {
        pageWindow.loadURL(targetUrl).catch(() => {});
      }
      return { action: 'deny' };
    });

    pageWindow.webContents.on('did-finish-load', async () => {
      try {
        const currentUrl = String(pageWindow.webContents.getURL() || '');
        logger.warn?.('[更新] 下载页已加载', {
          url: currentUrl,
          showWindow,
        });
        if (!allowAutoClickOnAnyPage && !/\/view\//i.test(currentUrl)) {
          logger.warn?.('[更新] 当前不是最终下载页，跳过自动点击', { url: currentUrl });
          return;
        }
        if (clickSent) {
          logger.warn?.('[更新] 已发送过一次点击，跳过重复自动点击');
          return;
        }
        if (clickTimer) {
          logger.warn?.('[更新] 已存在待执行的点击任务，跳过重复排队');
          return;
        }
        if (showWindow) {
          pageWindow.showInactive?.();
        }
        const clickDelay = showWindow ? 1500 : 0;
        clickTimer = setTimeout(async () => {
          try {
            const clicked = await clickDownloadButton();
            if (!clicked) {
              logger.warn?.('[更新] 未找到中文“下载”按钮，等待页面继续渲染');
            }
          } catch (error) {
            logger.warn?.('[更新] 自动点击下载按钮失败:', error?.message || error);
          }
        }, clickDelay);
      } catch (error) {
        logger.warn?.('[更新] 自动点击下载按钮失败:', error?.message || error);
      }
    });

    pageWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3 || String(errorDescription || '').includes('ERR_ABORTED')) {
        logger.warn?.('[更新] 下载页发生重定向中断，继续等待最终页面', {
          errorCode,
          errorDescription,
          validatedURL,
        });
        return;
      }
      fail(new Error(`打开下载页失败: ${errorDescription || errorCode || validatedURL || 'unknown'}`));
    });

    pageWindow.webContents.on('render-process-gone', (_event, details) => {
      fail(new Error(`下载页进程异常退出: ${details?.reason || 'unknown'}`));
    });

    pageWindow.loadURL(downloadUrl).catch((error) => {
      const message = error?.message || String(error);
      if (message.includes('ERR_ABORTED') || String(error?.code || '').includes('ERR_ABORTED')) {
        logger.warn?.('[更新] 下载页 loadURL 发生重定向中断，继续等待最终页面', {
          downloadUrl,
          error: message,
        });
        return;
      }
      logger.warn?.('[更新] 下载页 loadURL 失败', {
        downloadUrl,
        error: message,
      });
      fail(error);
    });

    armTimeout(45000);
  });
}

// 获取/读取/解析：extractUpdatePayload的具体业务逻辑。
function extractUpdatePayload(messageData = {}) {
  const sources = [
    messageData,
    messageData.data,
    messageData.payload,
    messageData.announcement,
    messageData.update,
  ].filter((value) => value && typeof value === 'object');

// 处理：pick的具体业务逻辑。
  const pick = (keys) => {
    for (const source of sources) {
      for (const key of keys) {
        const value = source?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value;
        }
      }
    }
    return '';
  };

  return {
    type: firstNonEmpty(pick(['type']), pick(['message_type', 'messageType'])),
    messageType: firstNonEmpty(pick(['message_type', 'messageType'])),
    version: firstNonEmpty(
      pick(['latest_version', 'latestVersion']),
      pick(['version']),
      pick(['new_version', 'newVersion']),
      pick(['target_version', 'targetVersion']),
      pick(['app_version', 'appVersion']),
      pick(['update_version', 'updateVersion']),
    ),
    downloadUrl: firstNonEmpty(
      pick(['download_url', 'downloadUrl']),
      pick(['package_url', 'packageUrl']),
      pick(['url']),
      pick(['link']),
      pick(['file_url', 'fileUrl']),
      pick(['update_link', 'updateLink']),
    ),
    openUrl: firstNonEmpty(
      pick(['open_url', 'openUrl']),
      pick(['subscription_url', 'subscriptionUrl']),
      pick(['landing_url', 'landingUrl']),
      pick(['page_url', 'pageUrl']),
      pick(['download_page_url', 'downloadPageUrl']),
      pick(['redirect_url', 'redirectUrl']),
    ),
    content: firstNonEmpty(
      pick(['announcement']),
      pick(['content']),
      pick(['message']),
      pick(['description']),
      pick(['detail']),
      pick(['notes']),
      pick(['update_message', 'updateMessage']),
      pick(['update_content', 'updateContent']),
    ),
    title: firstNonEmpty(
      pick(['title']),
      pick(['announcement_title', 'announcementTitle']),
      pick(['update_title', 'updateTitle']),
    ),
    fileName: firstNonEmpty(
      pick(['file_name', 'fileName']),
      pick(['archive_name', 'archiveName']),
      pick(['package_name', 'packageName']),
    ),
    packageType: firstNonEmpty(
      pick(['package_type', 'packageType']),
      pick(['file_type', 'fileType']),
    ).toLowerCase(),
    entryFile: firstNonEmpty(
      pick(['entry_file', 'entryFile']),
      pick(['launch_file', 'launchFile']),
      pick(['run_file', 'runFile']),
      pick(['start_file', 'startFile']),
    ),
    launchMode: firstNonEmpty(
      pick(['launch_mode', 'launchMode']),
      pick(['open_mode', 'openMode']),
      pick(['download_mode', 'downloadMode']),
    ).toLowerCase(),
    openInBrowser: pick(['open_in_browser', 'openInBrowser']) === true,
    force: pick(['force', 'mandatory', 'required']) === true,
    raw: messageData,
  };
}

// 处理：isUpdateNotice的具体业务逻辑。
function isUpdateNotice(messageData = {}) {
  const normalized = extractUpdatePayload(messageData);
  const type = String(normalized.type || '').toLowerCase();
  const messageType = String(normalized.messageType || '').toLowerCase();
  return (
    type === 'app_update'
    || type === 'update'
    || type === 'software_update'
    || type === 'upgrade'
    || messageType === 'update'
    || messageType === 'app_update'
    || messageType === 'software_update'
    || messageType === 'upgrade'
    || Boolean(normalized.version && (normalized.downloadUrl || normalized.openUrl))
  );
}

// 处理：safeMkdir的具体业务逻辑。
function safeMkdir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// 停止/关闭/清理：clearDirectory的具体业务逻辑。
function clearDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    if (fs.rmSync) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    }
    fs.rmdirSync(dirPath, { recursive: true });
  } catch (_) {}
}

// 停止/关闭/清理：cleanupUpdateStorageRoot的具体业务逻辑。
function cleanupUpdateStorageRoot(dirPath = null, logger = console) {
  const targets = [];
  const pushTarget = (value) => {
    const target = String(value || '').trim();
    if (target && !targets.includes(target)) {
      targets.push(target);
    }
  };

  if (dirPath) {
    pushTarget(dirPath);
  } else {
    pushTarget(getUpdateStorageRoot());
    pushTarget(getLegacyUpdateStorageRoot());
  }

  if (targets.length === 0) {
    throw new Error('更新缓存目录为空');
  }

  const results = [];
  for (const target of targets) {
    try {
      if (!fs.existsSync(target)) {
        results.push({ target, ok: true, removed: false });
        continue;
      }

      if (fs.rmSync) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.rmdirSync(target, { recursive: true });
      }

      logger.warn?.('[更新] 已清理更新缓存目录', toDebugString({ target }));
      results.push({ target, ok: true, removed: true });
    } catch (error) {
      logger.warn?.('[更新] 清理更新缓存目录失败:', error?.message || error);
      results.push({ target, ok: false, removed: false, message: error?.message || String(error) });
    }
  }

  return {
    ok: results.every((item) => item.ok !== false),
    results,
  };
}

// 处理：isArchiveFile的具体业务逻辑。
function isArchiveFile(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.tgz') || lower.endsWith('.tar.gz');
}

// 处理：isExecutableCandidate的具体业务逻辑。
function isExecutableCandidate(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}

// 获取/读取/解析：findLaunchTarget的具体业务逻辑。
async function findLaunchTarget(dirPath, entryFile = '') {
  const normalizedEntry = String(entryFile || '').trim();
  if (normalizedEntry) {
    const directPath = path.isAbsolute(normalizedEntry)
      ? normalizedEntry
      : path.join(dirPath, normalizedEntry);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return directPath;
    }
  }

// 处理：walk的具体业务逻辑。
  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const nested = walk(fullPath);
        if (nested) return nested;
        continue;
      }
      if (isExecutableCandidate(fullPath)) {
        return fullPath;
      }
    }
    return '';
  };

  const directExe = walk(dirPath);
  if (directExe) return directExe;

  const files = fs.readdirSync(dirPath, { withFileTypes: true }).filter((entry) => entry.isFile());
  if (files.length === 1) {
    return path.join(dirPath, files[0].name);
  }

  return '';
}

// 处理：downloadFile的具体业务逻辑。
function downloadFile(urlString, destination, progressCallback, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const maxRedirects = 5;
    const handler = urlString.startsWith('https:') ? https : http;
    const request = handler.get(urlString, {
      headers: { Accept: '*/*' },
      rejectUnauthorized: false,
    }, (response) => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        if (redirectCount >= maxRedirects) {
          reject(new Error('下载链接重定向次数过多'));
          return;
        }
        const nextUrl = new URL(response.headers.location, urlString).toString();
        response.resume();
        resolve(downloadFile(nextUrl, destination, progressCallback, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`下载失败，HTTP 状态码 ${statusCode}`));
        response.resume();
        return;
      }

      safeMkdir(path.dirname(destination));
      const total = Number(response.headers['content-length'] || 0);
      let received = 0;
      const writer = fs.createWriteStream(destination);

      response.on('data', (chunk) => {
        received += chunk.length;
        if (typeof progressCallback === 'function') {
          progressCallback({
            phase: 'downloading',
            receivedBytes: received,
            totalBytes: Number.isFinite(total) && total > 0 ? total : null,
            percent: Number.isFinite(total) && total > 0 ? Math.min(99.5, (received / total) * 100) : null,
          });
        }
      });

      response.on('error', (error) => {
        try { writer.destroy(); } catch (_) {}
        reject(error);
      });

      writer.on('error', reject);
      writer.on('finish', () => resolve({
        destination,
        totalBytes: Number.isFinite(total) && total > 0 ? total : null,
      }));
      response.pipe(writer);
    });

    request.setTimeout(30000, () => {
      try { request.destroy(new Error('下载超时')); } catch (_) {}
    });
    request.on('error', reject);
  });
}

// 获取/读取/解析：extractDownloadedPackage的具体业务逻辑。
async function extractDownloadedPackage(sourceFile, targetDir, logger = console) {
  const lower = String(sourceFile || '').toLowerCase();
  safeMkdir(targetDir);
  logger.warn?.('[更新] 开始解压文件', toDebugString({
    sourceFile,
    targetDir,
    lower,
  }));

  if (lower.endsWith('.zip')) {
    await extractZip(sourceFile, { dir: targetDir });
    logger.warn?.('[更新] ZIP 解压完成', toDebugString({ sourceFile, targetDir }));
    return;
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await tar.x({ file: sourceFile, cwd: targetDir, gzip: true });
    logger.warn?.('[更新] TAR.GZ/TGZ 解压完成', toDebugString({ sourceFile, targetDir }));
    return;
  }

  if (lower.endsWith('.tar')) {
    await tar.x({ file: sourceFile, cwd: targetDir });
    logger.warn?.('[更新] TAR 解压完成', toDebugString({ sourceFile, targetDir }));
  }

  logger.warn?.('[更新] 解压函数结束', toDebugString({ sourceFile, targetDir }));
}

// 停止/关闭/清理：cleanupDownloadedArchive的具体业务逻辑。
function cleanupDownloadedArchive(filePath, logger = console) {
  const target = String(filePath || '').trim();
  if (!target || !isArchiveFile(target)) {
    return { ok: true, removed: false, target };
  }

  try {
    if (!fs.existsSync(target)) {
      return { ok: true, removed: false, target };
    }

    fs.unlinkSync(target);
    logger.warn?.('[更新] 已删除压缩包文件', toDebugString({ target }));
    return { ok: true, removed: true, target };
  } catch (error) {
    logger.warn?.('[更新] 删除压缩包文件失败:', error?.message || error);
    return { ok: false, removed: false, target, message: error?.message || String(error) };
  }
}

// 处理：copyDirectoryContents的具体业务逻辑。
function copyDirectoryContents(sourceDir, targetDir) {
  safeMkdir(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (entry.isSymbolicLink && entry.isSymbolicLink()) {
      try {
        const linkTarget = fs.readlinkSync(sourcePath);
        fs.symlinkSync(linkTarget, targetPath);
      } catch (_) {
        fs.copyFileSync(sourcePath, targetPath);
      }
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

// 获取/读取/解析：getUpdateStorageRoot的具体业务逻辑。
function getUpdateStorageRoot(pathDep = path, appDep = electronApp) {
  try {
    const baseDir = appDep && typeof appDep.getPath === 'function'
      ? appDep.getPath('userData')
      : pathDep.resolve(process.cwd(), '.user-data');
    return pathDep.resolve(baseDir, 'ai-free-update');
  } catch (_) {
    return pathDep.resolve(process.cwd(), '.user-data', 'ai-free-update');
  }
}

// 获取/读取/解析：getLegacyUpdateStorageRoot的具体业务逻辑。
function getLegacyUpdateStorageRoot(pathDep = path) {
  return pathDep.resolve(process.cwd(), 'src', 'assets', 'ai-free-update');
}

// 启动/打开/显示：launchExecutable的具体业务逻辑。
async function launchExecutable(launchTarget, logger = console) {
  const target = String(launchTarget || '').trim();
  if (!target) {
    throw new Error('启动目标为空');
  }

  const ext = path.extname(target).toLowerCase();
  const cwd = path.dirname(target);
  const isWindows = process.platform === 'win32';
  const useSystemShell = isWindows && ext === '.exe';
  const command = ext === '.bat' || ext === '.cmd'
    ? 'cmd.exe'
    : ext === '.ps1'
      ? 'powershell.exe'
      : target;
  const args = ext === '.bat' || ext === '.cmd'
    ? ['/d', '/s', '/c', 'start', '""', target]
    : ext === '.ps1'
      ? ['-ExecutionPolicy', 'Bypass', '-File', target]
      : [];

  logger.warn?.('[更新] 准备启动文件', toDebugString({
    target,
    cwd,
    command,
    args,
    launchStrategy: useSystemShell ? 'shell.openPath' : 'spawn',
  }));

  if (useSystemShell) {
    const openPathError = await shell.openPath(target);
    if (!openPathError) {
      logger.warn?.('[更新] 系统 shell 已启动文件', toDebugString({
        target,
        cwd,
      }));
      return { pid: null, target, method: 'shell.openPath' };
    }

    logger.warn?.('[更新] 系统 shell 启动失败，回退到 spawn', toDebugString({
      target,
      error: openPathError,
    }));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      logger.warn?.('[更新] 启动进程已创建', toDebugString({
        pid: child.pid ?? null,
        target,
        command,
        args,
      }));
      try { child.unref(); } catch (_) {}
      resolve({ pid: child.pid ?? null, target, method: 'spawn' });
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      logger.error?.('[更新] 启动进程创建失败:', error?.message || error);
      reject(error);
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      logger.warn?.('[更新] 启动进程未及时回调 spawn，继续按已启动处理', toDebugString({
        target,
        pid: child.pid ?? null,
        command,
        args,
      }));
      try { child.unref(); } catch (_) {}
      resolve({ pid: child.pid ?? null, target, method: 'spawn-timeout' });
    }, 2000);
  });
}

// 创建/初始化：createAppUpdater的具体业务逻辑。
function createAppUpdater(deps = {}) {
  const {
    app,
    fs: fsDep = fs,
    path: pathDep = path,
    logger = console,
    getMainWindow = () => null,
    sendToSide = () => {},
    appName = 'AI-FREE',
    isDevMode = false,
  } = deps;

  let updateInProgress = false;

// 设置/更新/持久化：setWindowProgress的具体业务逻辑。
  function setWindowProgress(percent, statusText = '') {
    try {
      const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
        mainWindow.setProgressBar(Math.min(Math.max(percent / 100, 0), 1));
      } else {
        mainWindow.setProgressBar(-1);
      }
      const suffix = statusText ? ` · ${statusText}` : '';
      if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
        mainWindow.setTitle(`${appName} - 更新中 ${Math.max(0, Math.min(100, Math.round(percent)))}%${suffix}`);
      } else {
        mainWindow.setTitle(appName);
      }
    } catch (error) {
      logger.warn?.('[更新] 更新窗口进度失败:', error?.message || error);
    }
  }

// 处理：emitUpdateEvent的具体业务逻辑。
  function emitUpdateEvent(channel, payload) {
    try {
      sendToSide(channel, payload);
    } catch (error) {
      logger.warn?.('[更新] 通知侧边栏失败:', error?.message || error);
    }
  }

// 启动/打开/显示：startAppUpdate的具体业务逻辑。
  async function startAppUpdate(payload = {}) {
    if (updateInProgress) {
      return { ok: false, message: '更新正在进行中' };
    }

    logger.warn?.('[更新] startAppUpdate 被调用');
    const normalized = extractUpdatePayload(payload);
    logger.warn?.('[更新] startAppUpdate 收到原始载荷', toDebugString({
      type: payload?.type,
      message_type: payload?.message_type,
      messageType: payload?.messageType,
      version: payload?.version || payload?.latest_version || payload?.latestVersion || payload?.update_version || payload?.updateVersion,
      downloadUrl: payload?.downloadUrl || payload?.download_url || payload?.update_link || payload?.updateLink,
      openUrl: payload?.openUrl || payload?.open_url || payload?.subscription_url || payload?.subscriptionUrl,
      keys: Object.keys(payload || {}),
    }));
    logger.warn?.('[更新] startAppUpdate 归一化结果', toDebugString({
      type: normalized.type,
      messageType: normalized.messageType,
      version: normalized.version,
      downloadUrl: normalized.downloadUrl,
      openUrl: normalized.openUrl,
      launchMode: normalized.launchMode,
      openInBrowser: normalized.openInBrowser,
      entryFile: normalized.entryFile,
      fileName: normalized.fileName,
    }));
    if (!normalized.version || (!normalized.downloadUrl && !normalized.openUrl)) {
      return { ok: false, message: '更新信息不完整，缺少版本号或下载地址' };
    }

    // startAppUpdate 只负责“开始下载/解压/启动”。
    // 它不决定是否展示通知，通知由 handleServerUpdateCommand 和前端事件单独处理。
    const version = String(normalized.version).trim();
    const downloadUrl = String(normalized.downloadUrl).trim();
    const browserUrl = String(normalized.openUrl || downloadUrl).trim();
    const launchMode = String(normalized.launchMode || '').toLowerCase();
    const browserTargetLooksLikePage = Boolean(browserUrl && looksLikeWebPageUrl(browserUrl));
    const shouldAutoClickDownloadPage = Boolean(
      browserTargetLooksLikePage
      && (
        normalized.openInBrowser
        || launchMode === 'browser'
        || launchMode === 'open'
        || launchMode === 'open_link'
        || launchMode === 'open-url'
        || launchMode === 'external'
        || (!normalized.entryFile && !normalized.fileName)
      )
    );
    logger.warn?.('[更新] 模式判断', toDebugString({
      version,
      downloadUrl,
      browserUrl,
      browserTargetLooksLikePage,
      shouldAutoClickDownloadPage,
      launchMode,
      isDevMode,
    }));

    updateInProgress = true;

    // 告诉前端：用户已经确认下载，右侧公告区可以开始显示进度了。
    emitUpdateEvent('app-update-activated', createUpdateUiPayload(normalized, {
      currentVersion: String(app.getVersion() || '').trim(),
      phase: 'activated',
    }));

    if (shouldAutoClickDownloadPage) {
      try {
        logger.warn?.('[更新] 进入网页自动点击下载模式', {
          version,
          browserUrl,
          showWindow: isDevMode,
        });

        const pageDownloadDir = getUpdateStorageRoot(pathDep);

        const downloadResult = await openDownloadPageAndAutoClick({
          url: browserUrl,
          saveDir: pageDownloadDir,
          logger,
          showWindow: isDevMode,
          onProgress: (progress) => {
            emitUpdateEvent('app-update-progress', {
              ...progress,
              version,
              message: progress.phase === 'downloading'
                ? '正在从网页下载更新包...'
                : '正在打开下载页并点击下载...',
            });
            if (typeof progress.percent === 'number') {
              setWindowProgress(progress.percent, progress.phase === 'downloading' ? '正在下载' : '正在打开下载页');
            }
          },
        });

        const downloadPath = String(downloadResult?.savePath || '').trim();
        if (!downloadPath || !fsDep.existsSync(downloadPath)) {
          throw new Error('网页下载未生成文件');
        }
        const pageDownloadStat = fsDep.statSync(downloadPath);
        logger.warn?.('[更新] 网页下载文件就绪', toDebugString({
          downloadPath,
          size: pageDownloadStat?.size ?? null,
          ext: pathDep.extname(downloadPath),
        }));

        emitUpdateEvent('app-update-progress', {
          phase: 'extracting',
          version,
          message: '网页下载完成，正在解压...',
          percent: 99,
        });
        setWindowProgress(99, '正在解压');

        const extractDir = pathDep.join(pageDownloadDir, 'extracted');
        clearDirectory(extractDir);
        safeMkdir(extractDir);
        logger.warn?.('[更新] 准备进入解压阶段', toDebugString({
          downloadPath,
          extractDir,
          isArchiveFile: isArchiveFile(downloadPath),
        }));

        if (isArchiveFile(downloadPath)) {
          await extractDownloadedPackage(downloadPath, extractDir, logger);
        } else {
          safeMkdir(extractDir);
          fsDep.copyFileSync(downloadPath, pathDep.join(extractDir, pathDep.basename(downloadPath)));
          logger.warn?.('[更新] 非压缩包，已复制到解压目录', toDebugString({
            downloadPath,
            extractDir,
          }));
        }
        logger.warn?.('[更新] 解压阶段结束，准备查找启动文件', toDebugString({
          extractDir,
        }));

        const launchTarget = await findLaunchTarget(
          extractDir,
          normalized.entryFile,
        );
        logger.warn?.('[更新] 查找启动文件完成', toDebugString({
          extractDir,
          launchTarget,
        }));

        if (!launchTarget || !fsDep.existsSync(launchTarget)) {
          throw new Error('更新包中未找到可执行文件');
        }

        cleanupDownloadedArchive(downloadPath, logger);
        global._pendingUpdateInstallTarget = launchTarget;
        global._pendingUpdateInstallVersion = version;
        emitUpdateEvent('app-update-complete', {
          ok: true,
          version,
          launchTarget,
          message: '更新包已下载完成，请关闭当前软件后继续安装',
          installOnExit: true,
        });

        setWindowProgress(-1, '');

        return {
          ok: true,
          version,
          downloadPath,
          launchTarget,
          mode: 'auto-click-page',
        };
      } catch (error) {
        emitUpdateEvent('app-update-error', {
          ok: false,
          version,
          message: error?.message || String(error),
        });
        logger.error?.('[更新] 页面自动下载失败:', error?.message || error);
        return {
          ok: false,
          message: error?.message || String(error),
        };
      } finally {
        updateInProgress = false;
      }
    }

    logger.warn?.('[更新] 进入直链下载模式', {
      version,
      downloadUrl,
      openUrl: normalized.openUrl || '',
    });

    let archiveName = normalized.fileName;
    if (!archiveName) {
      archiveName = getSuggestedFileNameFromUrl(downloadUrl, `update-${version}.zip`);
    }

    const workRoot = getUpdateStorageRoot(pathDep);
    const workDir = workRoot;
    const downloadPath = pathDep.join(workDir, archiveName || `update-${version}.zip`);
    const extractDir = pathDep.join(workDir, 'extracted');

    try {
      safeMkdir(workDir);
      clearDirectory(extractDir);

      emitUpdateEvent('app-update-progress', {
        phase: 'preparing',
        version,
        message: '准备下载更新...',
        percent: 0,
      });
      setWindowProgress(0, '准备下载');

      await downloadFile(downloadUrl, downloadPath, (progress) => {
        emitUpdateEvent('app-update-progress', {
          ...progress,
          version,
          message: '正在下载更新...',
        });
        if (typeof progress.percent === 'number') {
          setWindowProgress(progress.percent, '正在下载');
        }
      });

      const downloadStat = fsDep.statSync(downloadPath);
      logger.warn?.('[更新] 直链下载文件就绪', toDebugString({
        downloadPath,
        size: downloadStat?.size ?? null,
        ext: pathDep.extname(downloadPath),
      }));

      emitUpdateEvent('app-update-progress', {
        phase: 'extracting',
        version,
        message: '下载完成，正在解压...',
        percent: 99,
      });
      setWindowProgress(99, '正在解压');

      if (isArchiveFile(downloadPath)) {
        logger.warn?.('[更新] 准备解压直链下载文件', toDebugString({
          downloadPath,
          extractDir,
        }));
        await extractDownloadedPackage(downloadPath, extractDir, logger);
      } else {
        safeMkdir(extractDir);
        fsDep.copyFileSync(downloadPath, pathDep.join(extractDir, pathDep.basename(downloadPath)));
        logger.warn?.('[更新] 直链非压缩包，已复制到解压目录', toDebugString({
          downloadPath,
          extractDir,
        }));
      }
      logger.warn?.('[更新] 直链解压阶段结束，准备查找启动文件', toDebugString({
        extractDir,
      }));

      const launchTarget = await findLaunchTarget(
        extractDir,
        normalized.entryFile,
      );
      logger.warn?.('[更新] 直链查找启动文件完成', toDebugString({
        extractDir,
        launchTarget,
      }));

      if (!launchTarget || !fsDep.existsSync(launchTarget)) {
        throw new Error('更新包中未找到可执行文件');
      }

      cleanupDownloadedArchive(downloadPath, logger);
      global._pendingUpdateInstallTarget = launchTarget;
      global._pendingUpdateInstallVersion = version;
      emitUpdateEvent('app-update-complete', {
        ok: true,
        version,
        launchTarget,
        message: '更新包已下载完成，请关闭当前软件后继续安装',
        installOnExit: true,
      });

      setWindowProgress(-1, '');

      return {
        ok: true,
        version,
        downloadPath,
        launchTarget,
      };
    } catch (error) {
      setWindowProgress(-1, '');
      emitUpdateEvent('app-update-error', {
        ok: false,
        version,
        message: error?.message || String(error),
      });
      logger.error?.('[更新] 更新失败:', error?.message || error);
      updateInProgress = false;
      return {
        ok: false,
        message: error?.message || String(error),
      };
    } finally {
      updateInProgress = false;
    }
  }

// 处理/分发：handleServerUpdateCommand的具体业务逻辑。
  async function handleServerUpdateCommand(messageData = {}) {
    const normalized = extractUpdatePayload(messageData);
    const type = String(normalized.type || '').toLowerCase();
    const messageType = String(normalized.messageType || '').toLowerCase();
    logger.warn?.('[更新] handleServerUpdateCommand 收到消息', toDebugString({
      rawType: messageData?.type,
      rawMessageType: messageData?.message_type || messageData?.messageType,
      normalizedType: type,
      normalizedMessageType: messageType,
      normalizedVersion: normalized.version,
      normalizedDownloadUrl: normalized.downloadUrl,
      normalizedOpenUrl: normalized.openUrl,
      keys: Object.keys(messageData || {}),
    }));
// 处理：isUpdateType的具体业务逻辑。
    const isUpdateType = (
      type === 'app_update'
      || type === 'update'
      || type === 'software_update'
      || type === 'upgrade'
      || messageType === 'update'
      || messageType === 'app_update'
      || messageType === 'software_update'
      || messageType === 'upgrade'
      || Boolean(normalized.version && normalized.downloadUrl)
      || Boolean(normalized.version && (normalized.raw?.update_link || normalized.raw?.updateLink))
    );

    if (!isUpdateType) return false;

    if (shouldIgnoreUpdateReceipt(normalized, messageType)) {
      logger.warn?.('[更新] 忽略更新回执消息', toDebugString({
        type,
        messageType,
        keys: Object.keys(messageData || {}),
      }));
      return false;
    }

    const currentVersion = String(app.getVersion() || '').trim();
    const targetVersion = String(normalized.version || '').trim();

    if ((!normalized.downloadUrl && !normalized.openUrl) || !targetVersion) {
      return true;
    }

    if (compareVersions(currentVersion, targetVersion) >= 0) {
      emitUpdateEvent('app-update-skip', {
        ok: true,
        currentVersion,
        targetVersion,
        message: '当前已是最新版本',
      });
      return false;
    }

    // 这里只发“提醒”，不直接启动下载。
    // 下载动作必须由用户在前端确认后触发，避免更新过程打扰正常使用。
    emitUpdateEvent('app-update-notice', createUpdateUiPayload(normalized, {
      currentVersion,
      phase: 'notice',
    }));
    return false;
  }

  return {
    compareVersions,
    extractUpdatePayload,
    handleServerUpdateCommand,
    cleanupUpdateStorageRoot,
    cleanupDownloadedArchive,
    startAppUpdate,
  };
}

module.exports = {
  createAppUpdater,
  compareVersions,
  extractUpdatePayload,
  launchExecutable,
};
