// 统一清理账号的独立 Chromium Profile 和关联浏览器历史。

function removeAccountBrowserHistory(accountId, deps = {}) {
  const { fs, getStorePath, logger = console } = deps;
  try {
    const storePath = typeof getStorePath === 'function' ? getStorePath() : '';
    if (!storePath || !fs?.existsSync?.(storePath)) return true;
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
    const history = Array.isArray(store.browserHistory) ? store.browserHistory : [];
    const nextHistory = history.filter((record) => (
      String(record?.accountId || '').trim() !== accountId
    ));
    if (nextHistory.length === history.length) return true;
    fs.writeFileSync(storePath, JSON.stringify({ ...store, browserHistory: nextHistory }, null, 2), 'utf8');
    return true;
  } catch (error) {
    logger.warn?.('[AccountProfileCleanup] 删除关联浏览器历史失败:', accountId, error?.message || error);
    return false;
  }
}

const cleanupInFlight = new Map();

function cleanupAccountProfile(accountId, deps = {}) {
  const normalizedAccountId = String(accountId || '').trim();
  if (!normalizedAccountId) return Promise.resolve({ ok: false, error: '缺少账号ID' });
  if (cleanupInFlight.has(normalizedAccountId)) return cleanupInFlight.get(normalizedAccountId);

  const operation = runAccountProfileCleanup(normalizedAccountId, deps)
    .finally(() => cleanupInFlight.delete(normalizedAccountId));
  cleanupInFlight.set(normalizedAccountId, operation);
  return operation;
}

async function runAccountProfileCleanup(normalizedAccountId, deps = {}) {

  const {
    browserRuntimeManager,
    getTabs = () => new Map(),
    closeTab,
    logger = console,
    sendToSide,
  } = deps;

  try {
    const tabs = typeof getTabs === 'function' ? getTabs() : new Map();
    const matchedTabs = Array.from(tabs?.values?.() || []).filter((tab) => (
      String(tab?.accountId || '').trim() === normalizedAccountId
    ));

    for (const tab of matchedTabs) {
      if (typeof closeTab === 'function' && tab?.id) {
        await closeTab(tab.id);
      }
    }

    const state = browserRuntimeManager?.getState?.(normalizedAccountId);
    if (state && !['stopped', 'crashed'].includes(String(state.status || '').toLowerCase())) {
      await browserRuntimeManager.stop(normalizedAccountId, 'chromium', { timeoutMs: 5000 });
    }

    if (browserRuntimeManager?.deleteProfile) {
      browserRuntimeManager.deleteProfile(normalizedAccountId);
    } else {
      return { ok: false, error: 'Chromium Profile 管理器不可用' };
    }

    if (!removeAccountBrowserHistory(normalizedAccountId, deps)) {
      return { ok: false, error: '浏览器历史清理失败' };
    }

    try { sendToSide?.('browser-history-changed'); } catch (_) {}
    logger.log?.('[AccountProfileCleanup] 已删除账号 Chromium Profile:', normalizedAccountId);
    return { ok: true, accountId: normalizedAccountId };
  } catch (error) {
    logger.warn?.('[AccountProfileCleanup] 删除账号 Chromium Profile 失败:', normalizedAccountId, error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

module.exports = {
  cleanupAccountProfile,
  removeAccountBrowserHistory,
};
