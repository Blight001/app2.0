const {
  buildManagedTabPartitionName,
  normalizePersistPartitionName,
} = require('./tab-common');
const { removeDirectoryWithRetries: removeDirWithRetries } = require('../utils/fs-cleanup');

// 创建/初始化：createBrowserPartitionCleaner的具体业务逻辑。
function createBrowserPartitionCleaner(deps = {}) {
  const {
    app,
    fs,
    path,
    BrowserWindow,
    electronSession,
    getTabs = () => new Map(),
    getMainWindow = () => null,
    getSideView = () => null,
    getLicenseWindow = () => null,
    getActiveTabId = () => null,
    getExtPopupWin = () => null,
    logger = console,
  } = deps;

// 处理：isManagedTabPartitionName的具体业务逻辑。
  function isManagedTabPartitionName(partitionName) {
    return String(partitionName || '').trim().startsWith('tab-');
  }

// 处理：isEphemeralManagedTabPartitionName的具体业务逻辑。
  function isEphemeralManagedTabPartitionName(partitionName) {
    const normalized = String(partitionName || '').trim();
    return /^tab-\d+$/.test(normalized);
  }

// 处理：isPersistentManagedTabPartitionName的具体业务逻辑。
  function isPersistentManagedTabPartitionName(partitionName) {
    return isManagedTabPartitionName(partitionName) && !isEphemeralManagedTabPartitionName(partitionName);
  }

// 处理：isPersistentSharedPartitionName的具体业务逻辑。
  function isPersistentSharedPartitionName(partitionName) {
    const normalized = String(partitionName || '').trim();
    return false;
  }

// 校验/保护：hasLiveBrowserUsersForSession的具体业务逻辑。
  function hasLiveBrowserUsersForSession(session, partitionName, excludedTabId = null) {
    const normalizedPartitionName = normalizePersistPartitionName(partitionName);
    if (!session || !normalizedPartitionName) {
      return false;
    }

    const tabs = getTabs();
    for (const [tabId, tab] of tabs.entries()) {
      if (excludedTabId && tabId === excludedTabId) continue;
      if (normalizePersistPartitionName(tab?.partition) !== normalizedPartitionName) continue;
      return true;
    }

    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
          continue;
        }
        if (win.webContents.session === session) {
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

// 移除/删除：removeDirectoryWithRetries的具体业务逻辑。
  async function removeDirectoryWithRetries(dirPath, label = '目录') {
    return removeDirWithRetries(fs, dirPath, {
      logger,
      failureMessage: `[缓存清理] 删除${label}失败:`,
    });
  }

// 获取/读取/解析：getBrowserPartitionsRootDir的具体业务逻辑。
  function getBrowserPartitionsRootDir() {
    return path.join(app.getPath('userData'), 'Partitions');
  }

// 停止/关闭/清理：cleanupBrowserSessionData的具体业务逻辑。
  async function cleanupBrowserSessionData({ partition, session, excludedTabId = null, source = '浏览器', force = false } = {}) {
    const partitionName = normalizePersistPartitionName(partition);
    if (!session) {
      return { ok: false, skipped: true };
    }

    const isManagedPartition = !!partitionName && isManagedTabPartitionName(partitionName);

    if (isManagedPartition && !force && !source?.includes('退出') && hasLiveBrowserUsersForSession(session, partitionName, excludedTabId)) {
      logger.log?.(`[缓存清理] ${source} 分区仍在使用，跳过:`, partitionName);
      return { ok: true, skipped: true, reason: 'in-use' };
    }

    try {
      await session.clearCache();
      logger.log?.(`[缓存清理] 已清理会话缓存: ${partitionName || 'default-session'}`);
    } catch (error) {
      logger.warn?.('[缓存清理] 清理会话缓存失败:', partitionName || 'default-session', error?.message || error);
    }

    if (!isManagedPartition) {
      return { ok: true, removed: false, skipped: false };
    }

    // 账号标签页的分区需要保留，便于下次启动直接复用 cookie / storage。
    return { ok: true, removed: false, skipped: true, reason: 'persistent-tab-partition' };
  }

// 停止/关闭/清理：purgeBrowserSessionData的具体业务逻辑。
  async function purgeBrowserSessionData({ partition, session, source = '账号删除' } = {}) {
    const partitionName = normalizePersistPartitionName(partition);
    if (!partitionName) {
      return { ok: false, skipped: true, reason: 'missing-partition' };
    }

    try {
      if (session && typeof session.clearStorageData === 'function') {
        await session.clearStorageData();
      }
    } catch (error) {
      logger.warn?.('[缓存清理] 清理会话存储失败:', partitionName, error?.message || error);
    }

    try {
      if (session && typeof session.clearCache === 'function') {
        await session.clearCache();
      }
    } catch (error) {
      logger.warn?.('[缓存清理] 清理会话缓存失败:', partitionName, error?.message || error);
    }

    const partitionDir = path.join(getBrowserPartitionsRootDir(), partitionName);
    const removed = await removeDirectoryWithRetries(partitionDir, `Partitions/${partitionName}`);
    logger.log?.(`[缓存清理] ${source} 已删除分区数据:`, partitionName, removed);
    return { ok: true, removed, partition: partitionName };
  }

// 处理：collectBrowserSessionCleanupTargets的具体业务逻辑。
  function collectBrowserSessionCleanupTargets() {
    const targets = [];
    const seenSessions = new Set();

// 处理：pushTarget的具体业务逻辑。
    const pushTarget = (session, partition, source) => {
      if (!session || seenSessions.has(session)) {
        return;
      }
      seenSessions.add(session);
      targets.push({ session, partition, source });
    };

    const tabs = getTabs();

    pushTarget(getSideView()?.webContents?.session, undefined, '侧边栏');
    pushTarget(getMainWindow()?.webContents?.session, undefined, '主窗口');
    pushTarget(getLicenseWindow()?.webContents?.session, undefined, '验证窗口');
    pushTarget(getExtPopupWin()?.webContents?.session, tabs.get(getActiveTabId())?.partition, '扩展弹窗');
    pushTarget(electronSession?.defaultSession, undefined, '默认会话');

    return targets;
  }

// 停止/关闭/清理：cleanupAllBrowserSessionData的具体业务逻辑。
  async function cleanupAllBrowserSessionData({ source = '退出', force = false } = {}) {
    const targets = collectBrowserSessionCleanupTargets();
    if (targets.length === 0) {
      return { ok: true, cleanedCount: 0, skipped: true };
    }

    let cleanedCount = 0;
    for (const target of targets) {
      try {
        const result = await cleanupBrowserSessionData({
          ...target,
          source,
          excludedTabId: null,
          force,
        });
        if (result?.ok) {
          cleanedCount += 1;
        }
      } catch (error) {
        logger.warn?.('[缓存清理] 退出时清理会话失败:', target?.source || '未知会话', error?.message || error);
      }
    }

    return { ok: true, cleanedCount, targetCount: targets.length };
  }

// 停止/关闭/清理：cleanupBrowserPartitionsRootDir的具体业务逻辑。
  async function cleanupBrowserPartitionsRootDir() {
    const partitionsRootDir = getBrowserPartitionsRootDir();
    if (!fs.existsSync(partitionsRootDir)) {
      return {
        ok: true,
        removed: false,
        cleanedCount: 0,
        partitionsRootDir,
      };
    }

    let cleanedCount = 0;
    let failedCount = 0;
    let keptPersistentCount = 0;
    try {
      const entries = await fs.promises.readdir(partitionsRootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (isPersistentSharedPartitionName(entry.name) || isPersistentManagedTabPartitionName(entry.name)) {
          logger.log?.('[退出] 跳过持久分区清理:', entry.name);
          keptPersistentCount += 1;
          continue;
        }
        const entryPath = path.join(partitionsRootDir, entry.name);
        try {
          const removed = await removeDirectoryWithRetries(entryPath, `Partitions/${entry.name}`);
          if (removed) {
            cleanedCount += 1;
          } else {
            failedCount += 1;
          }
        } catch (error) {
          failedCount += 1;
          logger.warn?.('[退出] 逐个清理 Partitions 子项失败:', entryPath, error?.message || error);
        }
      }
    } catch (error) {
      logger.warn?.('[退出] 枚举 Partitions 子项失败:', error?.message || error);
    }

    return {
      ok: true,
      removed: false,
      cleanedCount,
      failedCount,
      keptPersistentCount,
      partitionsRootDir,
    };
  }

  return {
    normalizePersistPartitionName,
    isManagedTabPartitionName,
    isEphemeralManagedTabPartitionName,
    isPersistentManagedTabPartitionName,
    buildManagedTabPartitionName,
    isPersistentSharedPartitionName,
    hasLiveBrowserUsersForSession,
    removeDirectoryWithRetries,
    getBrowserPartitionsRootDir,
    cleanupBrowserSessionData,
    purgeBrowserSessionData,
    collectBrowserSessionCleanupTargets,
    cleanupAllBrowserSessionData,
    cleanupBrowserPartitionsRootDir,
  };
}

module.exports = {
  createBrowserPartitionCleaner,
};
