// 账号管理 IPC 处理器
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const accountStorage = require('../lib/account-storage');
const { updateAccountRecycleTimer } = require('../utils/accountCleanup');
const { getCoreDir, getStorePath } = require('../config');
const {
  resolveDreamTargetUrl: resolveConfiguredDreamTargetUrl,
} = require('../utils/account-records');
const { normalizeBrowserStorageEntries } = require('../utils/browser-storage');
const { cleanupAccountProfile } = require('../services/account-profile-cleanup');

// 监听/绑定：registerAccountIPC的具体业务逻辑。
function registerAccountIPC(ctx) {
  const ipc = ctx.ipc.scope('account_remember');
  const {
    httpClient,
    auth,
    ui,
    dialog,
    DREAM_TARGET_URL,
    getDreamTargetUrl,
    getCurrentPlatformLabel,
    computeDeviceId,
    licenseCache,
  } = ctx;

  const resolveDreamTargetUrl = () => resolveConfiguredDreamTargetUrl(getDreamTargetUrl, DREAM_TARGET_URL);

// 获取/读取/解析：readGlobalCredentialsFromStore的具体业务逻辑。
  function readGlobalCredentialsFromStore() {
    try {
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : { key: '' };
      return {
        key: snapshot.key || '',
      };
    } catch (e) {
      console.warn('[IPC] 读取全局凭证失败:', e?.message || e);
      return { key: '' };
    }
  }

// 获取/读取/解析：resolveDeviceId的具体业务逻辑。
  async function resolveDeviceId(preferredDeviceId = '') {
    const candidate = String(preferredDeviceId || '').trim();
    if (candidate) return candidate;
    try {
      if (typeof computeDeviceId === 'function') {
        const resolved = await computeDeviceId();
        const text = String(resolved || '').trim();
        if (text) return text;
      }
    } catch (e) {
      console.warn('[IPC] 计算设备号失败:', e?.message || e);
    }
    return '';
  }

// 格式化/规范化：normalizeImportedCookieEntry的具体业务逻辑。
  function normalizeImportedCookieEntry(entry, defaultUrl) {
    if (!entry) return null;
    if (typeof entry === 'string') {
      const trimmed = String(entry).trim();
      if (!trimmed) return null;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return null;
      entry = { name: trimmed.slice(0, idx).trim(), value: trimmed.slice(idx + 1).trim() };
    }
    if (typeof entry !== 'object') return null;

    const name = entry.name ?? entry.Name ?? entry.key ?? entry.Key;
    if (!name) return null;

    const cookie = { ...entry, name: String(name), value: String(entry.value ?? entry.Value ?? entry.val ?? entry.Val ?? '') };
    cookie.path = String(entry.path ?? entry.Path ?? '/');

    const domain = entry.domain ?? entry.Domain;
    if (domain) cookie.domain = String(domain);

    const url = entry.url ?? entry.URL;
    if (url) {
      cookie.url = String(url);
    } else if (!cookie.url) {
      if (cookie.domain) {
        cookie.url = `https://${String(cookie.domain).replace(/^\./, '')}/`;
      } else if (defaultUrl) {
        cookie.url = defaultUrl;
      }
    }

    const expiration = entry.expirationDate ?? entry.expires ?? entry.Expires ?? entry.expiresAt ?? entry.expiry;
    if (expiration !== undefined && expiration !== null && expiration !== '') {
      const num = Number(expiration);
      if (Number.isFinite(num)) cookie.expirationDate = num;
    }

    const sameSiteRaw = String(entry.sameSite ?? entry.samesite ?? '').trim().toLowerCase();
    const sameSite = sameSiteRaw === 'none' ? 'no_restriction' : sameSiteRaw;
    if (['no_restriction', 'lax', 'strict'].includes(sameSite)) {
      cookie.sameSite = sameSite;
    }

// 处理：isTruthyFlag的具体业务逻辑。
    const isTruthyFlag = (value) => value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
    cookie.secure = isTruthyFlag(entry.secure) || isTruthyFlag(entry.Secure) || isTruthyFlag(entry.isSecure) || isTruthyFlag(entry.is_secure);
    cookie.httpOnly = isTruthyFlag(entry.httpOnly) || isTruthyFlag(entry.httponly) || isTruthyFlag(entry.HttpOnly) || isTruthyFlag(entry.http_only);

    return cookie;
  }

// 获取/读取/解析：parseImportedAccountContent的具体业务逻辑。
  function parseImportedAccountContent(content, defaultUrl) {
    const text = String(content || '').replace(/^\uFEFF/, '').trim();
    if (!text) return { cookies: [], browserStorage: [] };

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return {
          cookies: parsed.map((item) => normalizeImportedCookieEntry(item, defaultUrl)).filter(Boolean),
          browserStorage: [],
        };
      }
      if (parsed && typeof parsed === 'object') {
        const cookiesSource = Array.isArray(parsed.cookies)
          ? parsed.cookies
          : (parsed.data && Array.isArray(parsed.data.cookies) ? parsed.data.cookies : null);
        const browserStorageSource = Array.isArray(parsed.browserStorage)
          ? parsed.browserStorage
          : (parsed.data && Array.isArray(parsed.data.browserStorage) ? parsed.data.browserStorage : null);

        if (cookiesSource || browserStorageSource) {
          return {
            cookies: Array.isArray(cookiesSource)
              ? cookiesSource.map((item) => normalizeImportedCookieEntry(item, defaultUrl)).filter(Boolean)
              : [],
            browserStorage: Array.isArray(browserStorageSource)
              ? normalizeBrowserStorageEntries(browserStorageSource)
              : [],
          };
        }

        if (Array.isArray(parsed.cookies)) {
          return {
            cookies: parsed.cookies.map((item) => normalizeImportedCookieEntry(item, defaultUrl)).filter(Boolean),
            browserStorage: [],
          };
        }
        if (parsed.data && Array.isArray(parsed.data.cookies)) {
          return {
            cookies: parsed.data.cookies.map((item) => normalizeImportedCookieEntry(item, defaultUrl)).filter(Boolean),
            browserStorage: [],
          };
        }
        if (Array.isArray(parsed.data)) {
          return {
            cookies: parsed.data.map((item) => normalizeImportedCookieEntry(item, defaultUrl)).filter(Boolean),
            browserStorage: [],
          };
        }
        if (Array.isArray(parsed.cookie)) {
          return {
            cookies: parsed.cookie.map((item) => normalizeImportedCookieEntry(item, defaultUrl)).filter(Boolean),
            browserStorage: [],
          };
        }
        return {
          cookies: Object.entries(parsed).map(([name, value]) => normalizeImportedCookieEntry({ name, value }, defaultUrl)).filter(Boolean),
          browserStorage: [],
        };
      }
    } catch (_) {}

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const netscapeCookies = [];

    for (let line of lines) {
      let httpOnly = false;
      if (line.startsWith('#HttpOnly_')) {
        httpOnly = true;
        line = line.slice('#HttpOnly_'.length);
      }
      if (!line || line.startsWith('#')) continue;

      const columns = line.split(/\t+/);
      if (columns.length >= 7) {
        const [domain, includeSubdomains, cookiePath, secureFlag, expires, name, ...valueParts] = columns;
        const cookie = normalizeImportedCookieEntry({
          domain,
          path: cookiePath,
          secure: /^TRUE$/i.test(String(secureFlag)),
          expirationDate: expires,
          name,
          value: valueParts.join('\t'),
          httpOnly,
        }, defaultUrl);
        if (cookie) netscapeCookies.push(cookie);
      }
    }

    if (netscapeCookies.length) return { cookies: netscapeCookies, browserStorage: [] };

    const headerCookies = [];
    for (const token of text.split(/;\s*/)) {
      const idx = token.indexOf('=');
      if (idx <= 0) continue;
      const name = token.slice(0, idx).trim();
      if (!name) continue;
      const normalizedName = name.toLowerCase();
      if (['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'].includes(normalizedName)) continue;
      const value = token.slice(idx + 1).trim();
      const cookie = normalizeImportedCookieEntry({ name, value }, defaultUrl);
      if (cookie) headerCookies.push(cookie);
    }

    return { cookies: headerCookies, browserStorage: [] };
  }

// 获取/读取/解析：parseImportedCookieContent的具体业务逻辑。
  function parseImportedCookieContent(content, defaultUrl) {
    return parseImportedAccountContent(content, defaultUrl).cookies;
  }

// 处理：inferImportedTargetUrl的具体业务逻辑。
  function inferImportedTargetUrl(imported, defaultUrl) {
    const browserStorageEntries = Array.isArray(imported?.browserStorage) ? imported.browserStorage : [];
    for (const entry of browserStorageEntries) {
      const url = String(entry?.url || '').trim();
      if (url) return url;
      const origin = String(entry?.origin || '').trim();
      if (origin) return origin;
    }

    const cookies = Array.isArray(imported?.cookies) ? imported.cookies : [];
    for (const cookie of cookies) {
      const url = String(cookie?.url || '').trim();
      if (url) return url;
      const domain = String(cookie?.domain || '').trim().replace(/^\./, '');
      if (domain) return `https://${domain}/`;
    }

    return String(defaultUrl || '').trim();
  }

// 处理：isPlaceholderTargetUrl的具体业务逻辑。
  function isPlaceholderTargetUrl(rawUrl) {
    const text = String(rawUrl || '').trim();
    if (!text) return true;
    const lower = text.toLowerCase();
    if (lower === 'about:blank') return true;
    try {
      const parsed = new URL(text);
      const host = String(parsed.hostname || '').toLowerCase();
      if (!host) return false;
      if (host === 'google.com' || host === 'www.google.com' || host.endsWith('.google.com')) return true;
      if (host === 'google.cn' || host === 'www.google.cn' || host.endsWith('.google.cn')) return true;
    } catch (_) {}
    return false;
  }

// 处理：cleanupAccountBrowserArtifacts的具体业务逻辑。
  async function cleanupAccountBrowserArtifacts(accountId) {
    return cleanupAccountProfile(accountId, {
      browserRuntimeManager: ui?.browserRuntimeManager,
      getTabs: ui?.getTabs,
      closeTab: ui?.closeTab,
      fs,
      getStorePath,
      sendToSide: ui?.sendToSide,
      logger: console,
    });
  }

  function buildAccountCleanupOptions() {
    return {
      sendToSide: ui && typeof ui.sendToSide === 'function' ? ui.sendToSide : null,
      cleanupAccountArtifacts: cleanupAccountBrowserArtifacts,
    };
  }

  async function injectAccountSessionIntoProfile(account, cookies, browserStorage, targetUrl) {
    const accountId = String(account?.id || '').trim();
    const resolvedTargetUrl = String(targetUrl || account?.currentUrl || resolveDreamTargetUrl() || '').trim();
    if (!accountId || !resolvedTargetUrl) throw new Error('缺少账号 Profile 或目标地址');
    if (!ui?.addTab || !ui?.browserRuntimeManager?.importSession) {
      throw new Error('Chromium 会话注入能力不可用');
    }

    const browserName = String(
      account.currentPlatform
      || account.platform
      || account.accountName
      || account.account
      || accountId
    ).trim();
    const tabId = await ui.addTab(resolvedTargetUrl, {
      accountId,
      fixedTitle: browserName,
      tabTitle: browserName,
      deferChromiumNavigation: true,
    });
    if (!tabId) throw new Error('创建账号 Chromium Profile 失败');

    await ui.browserRuntimeManager.importSession(tabId, {
      cookies: Array.isArray(cookies) ? cookies : [],
      browserStorage: Array.isArray(browserStorage) ? browserStorage : [],
      targetUrl: resolvedTargetUrl,
      navigateAfterImport: true,
    });
    await ui.browserRuntimeManager.reload(tabId, 'chromium');
    accountStorage.updateLastUsedTime(accountId);
    return tabId;
  }

// 获取/读取/解析：getCurrentServerPlatformLabel的具体业务逻辑。
  function getCurrentServerPlatformLabel() {
    try {
      if (typeof getCurrentPlatformLabel === 'function') {
        const label = String(getCurrentPlatformLabel() || '').trim();
        if (label) return label;
      }
    } catch (_) {}

    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const label = String(runtimeConfig.platformName || '').trim();
      if (label) return label;
      const allowed = Array.isArray(runtimeConfig.allowedPlatforms) ? runtimeConfig.allowedPlatforms : [];
      if (allowed.length > 0) {
        const firstLabel = String(allowed[0] || '').trim();
        if (firstLabel) return firstLabel;
      }
    } catch (_) {}

    return '未知平台';
  }

// 处理：promptImportedPlatformDecision的具体业务逻辑。
  async function promptImportedPlatformDecision(platformLabel, targetUrl) {
    const safePlatformLabel = String(platformLabel || '').trim() || '未知平台';
    const safeTargetUrl = String(targetUrl || '').trim() || '';
    const requestId = `cookie-import-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    return await new Promise((resolve) => {
      let settled = false;
// 处理：finish的具体业务逻辑。
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          ipcMain.removeListener('cookie-import-confirm-response', onResponse);
        } catch (_) {}
        clearTimeout(timer);
        resolve(result);
      };

// 监听/绑定：onResponse的具体业务逻辑。
      const onResponse = (_event, payload = {}) => {
        if (String(payload?.requestId || '') !== requestId) return;
        finish({
          confirmed: payload.confirmed === true,
          cancelled: payload.cancelled === true,
          decidedUnknown: payload.decidedUnknown !== false,
        });
      };

      const timer = setTimeout(() => {
        finish({
          confirmed: false,
          cancelled: true,
          decidedUnknown: true,
          timedOut: true,
        });
      }, 30000);

      ipcMain.on('cookie-import-confirm-response', onResponse);

      try {
        if (ui && typeof ui.sendToSide === 'function') {
          ui.sendToSide('cookie-import-confirm-request', {
            requestId,
            platformLabel: safePlatformLabel,
            targetUrl: safeTargetUrl,
          });
          return;
        }
      } catch (error) {
        console.warn('[IPC] 发送导入确认请求失败:', error?.message || error);
      }

      finish({
        confirmed: false,
        cancelled: true,
        decidedUnknown: true,
        error: '确认弹窗不可用',
      });
    });
  }

  // ---- IPC: 账号管理 ----
  // 保存用户凭证（兼容性接口，已重定向到新的 store/content 操作）
  ipc.handle('save-global-credentials', async (_event, { key, deviceId }) => {
    try {
      if (!key) {
        return { ok: false, error: '卡密不能为空' };
      }

      if (licenseCache && typeof licenseCache.setCredentials === 'function') {
        licenseCache.setCredentials({ key, deviceId });
      }
      console.log('[IPC] 用户凭证保存成功（运行时缓存）');
      return { ok: true };
    } catch (e) {
      console.error('[IPC] 保存用户凭证失败（兼容模式）:', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // 获取用户凭证（兼容性接口，已重定向到新的 store/content 操作）
  ipc.handle('get-global-credentials', async () => {
    try {
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : { key: '', deviceId: '' };
      const deviceId = await resolveDeviceId(snapshot.deviceId || '');
      return {
        ok: true,
        credentials: {
          key: snapshot.key || '',
          deviceId,
        }
      };
    } catch (e) {
      console.error('[IPC] 获取用户凭证失败（兼容模式）:', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // 获取 cookies（不打开页面）
  ipc.handle('fetch-cookies', async (_event, { key, deviceId }) => {
    try {
      const resolvedDeviceId = await resolveDeviceId(deviceId);
      if (!key || !resolvedDeviceId) {
        return { ok: false, error: '缺少卡密或设备号' };
      }

      // 检查网络客户端是否可用（HTTP 通信，无持久连接）
      if (!httpClient) {
        return {
          ok: false,
          degraded: true,
          error: '网络客户端不可用，无法获取账号信息，请重启应用'
        };
      }

      const fetchResult = await auth.fetchCookieFromServerForDream(key, resolvedDeviceId, { consumeUsage: false });
      const cookies = fetchResult.cookies;
      return {
        ok: true,
        cookies,
        serverRecycleTime: fetchResult.serverRecycleTime,
        serverRecycleTimeTs: fetchResult.serverRecycleTimeTs,
        serverRecycleTimeIso: fetchResult.serverRecycleTimeIso,
        server_recycle_time: fetchResult.serverRecycleTime,
        current_account_type: fetchResult.currentAccountType,
        current_account_type_label: fetchResult.currentAccountTypeLabel,
        currentAccountType: fetchResult.currentAccountType,
        currentAccountTypeLabel: fetchResult.currentAccountTypeLabel,
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // 保存账号
  ipc.handle('save-account', async (_event, { cookies, accountName }) => {
    try {
      // 检查用户凭证是否存在
      const snapshot = licenseCache && typeof licenseCache.getSnapshot === 'function'
        ? licenseCache.getSnapshot()
        : { key: '', deviceId: '' };
      const resolvedDeviceId = await resolveDeviceId(snapshot.deviceId || '');
      const globalCredentials = {
        key: snapshot.key || '',
        deviceId: resolvedDeviceId,
      };
      if (!globalCredentials || !globalCredentials.key || !globalCredentials.deviceId) {
        return { ok: false, error: '请先设置卡密' };
      }

      // 必须从服务器获取 cookies 才能保存账号
      let finalCookies = cookies;
      let finalBrowserStorage = null;
      let fetchAccountTypeInfo = {};
      let fetchRecycleTimeInfo = {};
      let accountPlatform = '';
      if (!finalCookies || !Array.isArray(finalCookies) || finalCookies.length === 0) {
        try {
          console.log('[save-account] 从服务器获取 cookies...');
          const fetchResult = await auth.fetchCookieFromServerForDream(globalCredentials.key, globalCredentials.deviceId);
          finalCookies = fetchResult.cookies;
          finalBrowserStorage = Array.isArray(fetchResult.browserStorage) ? fetchResult.browserStorage : null;
          fetchAccountTypeInfo = {
            currentAccountType: fetchResult.currentAccountType,
            currentAccountTypeLabel: fetchResult.currentAccountTypeLabel,
            current_account_type: fetchResult.currentAccountType,
            current_account_type_label: fetchResult.currentAccountTypeLabel,
          };
          fetchRecycleTimeInfo = {
            serverRecycleTime: fetchResult.serverRecycleTime,
            serverRecycleTimeTs: fetchResult.serverRecycleTimeTs,
            serverRecycleTimeIso: fetchResult.serverRecycleTimeIso,
            server_recycle_time: fetchResult.serverRecycleTime,
            ai_account_expiry_time: fetchResult.serverRecycleTime,
            aiAccountExpiryTime: fetchResult.serverRecycleTime,
          };
          accountPlatform = fetchResult.platform || '';
        } catch (e) {
          // 如果获取失败，不保存账号
          console.error('[save-account] 获取 cookies 失败，不保存账号:', e?.message || String(e));
          return { ok: false, error: e?.message || '无法获取账号信息，账号保存失败' };
        }
      }

      // 确保 cookies 不为空
      if (!finalCookies || !Array.isArray(finalCookies) || finalCookies.length === 0) {
        return { ok: false, error: '账号信息为空，无法保存账号' };
      }

      console.log('[save-account] 保存账号，cookies类型:', Array.isArray(finalCookies) ? `数组长度${finalCookies.length}` : typeof finalCookies);
      const result = accountStorage.addAccount({
        cookies: finalCookies,
        browserStorage: Array.isArray(finalBrowserStorage) ? finalBrowserStorage : undefined,
        accountName,
        platform: accountPlatform || '',
        currentUrl: resolveDreamTargetUrl(),
        ...fetchAccountTypeInfo,
        ...fetchRecycleTimeInfo,
      });
      if (result.ok) {
        try {
          await injectAccountSessionIntoProfile(
            result.account,
            finalCookies,
            finalBrowserStorage,
            result.account.currentUrl || resolveDreamTargetUrl(),
          );
          console.log('[save-account] 账号 Profile 创建并注入成功:', result.account.id);
          updateAccountRecycleTimer(accountStorage, result.account, buildAccountCleanupOptions());
        } catch (injectError) {
          const cleanupResult = await cleanupAccountBrowserArtifacts(result.account.id);
          if (cleanupResult?.ok) accountStorage.deleteAccount(result.account.id);
          return { ok: false, error: injectError?.message || '账号会话注入失败' };
        }
      } else {
        console.error('[save-account] 账号保存失败:', result.error);
      }
      return result;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // 导入 Cookie 文件并保存账号
  ipc.handle('import-cookie-file', async () => {
    try {
      const credentials = readGlobalCredentialsFromStore();
      const deviceId = await resolveDeviceId('');
      const defaultUrl = resolveDreamTargetUrl();
      const currentPlatformLabel = getCurrentServerPlatformLabel();

      if (!dialog || typeof dialog.showOpenDialog !== 'function') {
        return { ok: false, error: '当前环境不支持文件选择' };
      }

      const selection = await dialog.showOpenDialog({
        title: '导入账号',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Cookie 文件', extensions: ['json', 'txt', 'cookie', 'cookies', 'log'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });

      if (selection.canceled || !Array.isArray(selection.filePaths) || !selection.filePaths[0]) {
        return { ok: false, cancelled: true, error: '已取消导入' };
      }

      const serverTargetUrl = String(resolveDreamTargetUrl() || '').trim() || defaultUrl;
      const firstImportedTargetUrl = inferImportedTargetUrl(parseImportedAccountContent(fs.readFileSync(selection.filePaths[0], 'utf8'), defaultUrl), defaultUrl);
      const decision = await promptImportedPlatformDecision(currentPlatformLabel, serverTargetUrl);
      if (decision.cancelled) {
        return { ok: false, cancelled: true, error: '已取消导入' };
      }
      const selectedPlatformLabel = decision.confirmed ? currentPlatformLabel : '未知平台';
      const selectedCurrentUrl = decision.confirmed ? serverTargetUrl : '';
      const selectedPlatform = decision.confirmed ? currentPlatformLabel : '未知平台';

      const filePaths = Array.from(new Set(selection.filePaths || []));
      const results = [];
      const failures = [];

      for (const filePath of filePaths) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const imported = parseImportedAccountContent(content, defaultUrl);
          const cookies = Array.isArray(imported.cookies) ? imported.cookies : [];
          const browserStorage = Array.isArray(imported.browserStorage) ? imported.browserStorage : [];
          if (!cookies.length && !browserStorage.length) {
            failures.push({ filePath, error: '未识别到可导入的 Cookie 或 browserStorage 格式' });
            continue;
          }

          const baseName = path.basename(filePath, path.extname(filePath)) || `导入账号${Date.now()}`;
          const result = accountStorage.addAccount({
            cookies,
            browserStorage,
            accountName: baseName,
            key: credentials.key || '',
            deviceId,
            storageType: 'custom',
            storageGroup: baseName,
            storageGroupLabel: '绑定账号分组',
            cleanupProtected: true,
            currentAccountType: 'one_time',
            currentAccountTypeLabel: '绑定账号',
            platform: selectedPlatform,
            currentPlatform: selectedPlatformLabel,
            currentUrl: selectedCurrentUrl || serverTargetUrl || firstImportedTargetUrl || defaultUrl,
          });

          if (!result.ok) {
            failures.push({ filePath, error: result.error || '导入失败' });
            continue;
          }

          try {
            await injectAccountSessionIntoProfile(
              result.account,
              cookies,
              browserStorage,
              result.account.currentUrl || selectedCurrentUrl || serverTargetUrl || firstImportedTargetUrl || defaultUrl,
            );
          } catch (injectError) {
            const cleanupResult = await cleanupAccountBrowserArtifacts(result.account.id);
            if (cleanupResult?.ok) accountStorage.deleteAccount(result.account.id);
            failures.push({ filePath, error: injectError?.message || 'Cookie 注入 Chromium 失败' });
            continue;
          }

          updateAccountRecycleTimer(accountStorage, result.account, buildAccountCleanupOptions());

          results.push({
            filePath,
            account: result.account,
            importedCount: cookies.length,
            importedBrowserStorageCount: browserStorage.length,
          });
        } catch (e) {
          failures.push({ filePath, error: e?.message || String(e) });
        }
      }

      if (!results.length) {
        return {
          ok: false,
          error: failures[0]?.error || '没有成功导入任何 Cookie'
        };
      }

      try { ui.sendToSide('account-list-updated', {}); } catch (_) {}

      const importedFiles = results.length;
      const importedCookies = results.reduce((sum, item) => sum + Number(item.importedCount || 0), 0);
      const importedBrowserStorage = results.reduce((sum, item) => sum + Number(item.importedBrowserStorageCount || 0), 0);
      const failedFiles = failures.length;
      const message = failedFiles > 0
        ? `已导入 ${importedFiles} 个文件，${importedCookies} 条 Cookie，${importedBrowserStorage} 组浏览器存储，失败 ${failedFiles} 个文件`
        : `已批量导入 ${importedFiles} 个文件，${importedCookies} 条 Cookie，${importedBrowserStorage} 组浏览器存储`;

      return {
        ok: true,
        results,
        failures,
        importedFiles,
        importedCookies,
        failedFiles,
        message,
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // 获取所有账号列表
  ipc.handle('get-all-accounts', async () => {
    try {
      const accounts = accountStorage.getAllAccounts();
      return { ok: true, accounts };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipc.handle('delete-accounts', async (_event, { accountIds }) => {
    try {
      const ids = Array.from(new Set((Array.isArray(accountIds) ? accountIds : []).map((id) => String(id || '').trim()).filter(Boolean)));
      if (!ids.length) {
        return { ok: false, error: '缺少账号ID' };
      }

      const failed = [];
      let removedCount = 0;
      for (const accountId of ids) {
        const cleanupResult = await cleanupAccountBrowserArtifacts(accountId);
        if (!cleanupResult || cleanupResult.ok !== true) {
          failed.push({ accountId, error: cleanupResult?.error || '清理浏览器记录失败' });
          continue;
        }

        const result = accountStorage.deleteAccount(accountId);
        if (result && result.ok) {
          removedCount += 1;
        } else {
          failed.push({ accountId, error: result?.error || '删除失败' });
        }
      }

      try { ui.sendToSide('account-list-updated', {}); } catch (_) {}

      if (failed.length > 0) {
        return {
          ok: false,
          error: failed.length === 1 ? `删除失败：${failed[0].accountId}` : `有 ${failed.length} 个账号删除失败`,
          removedCount,
          failed,
        };
      }

      return {
        ok: true,
        removedCount,
        message: removedCount === 1 ? '账号已删除' : `已删除 ${removedCount} 个账号`,
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // 账号历史只负责打开账号已经绑定的专属浏览器 Profile。服务器拉取、账号
  // 迁移和 Cookie 注入只允许发生在 open-dream-page 的新账号流程中。
  ipc.handle('switch-account', async (_event, { accountId }) => {
    try {
      const normalizedAccountId = String(accountId || '').trim();
      if (!normalizedAccountId) {
        return { ok: false, error: '缺少账号ID' };
      }
      const accountResult = accountStorage.getAccount(normalizedAccountId);
      if (!accountResult.ok || !accountResult.account) {
        return { ok: false, error: '账号不存在' };
      }
      const profile = ui?.browserRuntimeManager?.store?.readProfile?.(normalizedAccountId) || null;
      if (!profile?.createdAt) {
        return { ok: false, error: '账号浏览器环境不存在，请重新获取或导入账号' };
      }
      const account = accountResult.account;
      const serverTargetUrl = String(resolveDreamTargetUrl() || '').trim();
      const savedTargetUrl = String(account.currentUrl || '').trim();
      const targetUrl = (!isPlaceholderTargetUrl(savedTargetUrl)
        ? savedTargetUrl
        : serverTargetUrl) || 'about:blank';
      if (!ui || typeof ui.addTab !== 'function') {
        throw new Error('打开账号失败：标签页能力不可用');
      }
      const browserName = String(
        account.currentPlatform
        || account.platform
        || account.accountName
        || account.displayName
        || getCurrentServerPlatformLabel()
        || normalizedAccountId
      ).trim();
      const tabId = await ui.addTab(targetUrl, {
        accountId: normalizedAccountId,
        fixedTitle: browserName,
        tabTitle: browserName,
        restoreLastSession: true,
      });
      if (!tabId) throw new Error('账号对应的浏览器打开失败');

      accountStorage.updateLastUsedTime(normalizedAccountId);
      try { ui.sendToSide('account-list-updated', {}); } catch (_) {}
      console.log('[switch-account] 已打开账号专属 Chromium Profile:', {
        accountId: normalizedAccountId,
        tabId,
        restored: true,
      });
      return { ok: true, tabId, accountId: normalizedAccountId };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

module.exports = { registerAccountIPC };
