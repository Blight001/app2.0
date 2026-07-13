const crypto = require('crypto');
const {
  readJsonFileSafe,
  readStoreConfigFile,
  writeStoreConfigFile,
} = require('../utils/json-store');

const STORE_FIELD = 'extensionManager';
const BUILTIN_TRANSLATE_ID = 'builtin-transform';
const BUILTIN_REMOVE_WATERMARK_ID = 'builtin-remove-watermark';
const WEB_PANEL_MARGIN = 16;
const POPUP_DEFAULT_SIZE = { width: 360, height: 300 };
const OPTIONS_DEFAULT_SIZE = { width: 560, height: 620 };
const COMPAT_CACHE_DIR_NAME = 'extension-runtime-compat';
// Chromium reserves extension files/directories beginning with "_". Keep the
// software-generated shim name ordinary so the original plugin remains untouched.
const COMPAT_SHIM_FILE = 'electron-extension-compat.js';
const COMPAT_SHIM_MARKER = '__AI_FREE_ELECTRON_EXTENSION_COMPAT__';
const COMPAT_CACHE_SCHEMA = 5;
const ELECTRON_UNRECOGNIZED_EXTENSION_PERMISSIONS = new Set([
  'notifications',
  'contextMenus',
  'debugger',
  'cookies',
  'downloads',
  'webNavigation',
]);
const EXTENSION_REFRESH_INTERVAL_MS = 10000;
const EXTENSION_REFRESH_DEBOUNCE_MS = 300;

function sanitizeManifestPermissionsForElectron(sourceManifest) {
  const manifest = sourceManifest && typeof sourceManifest === 'object'
    ? { ...sourceManifest }
    : {};
  const removedPermissions = [];

  for (const field of ['permissions', 'optional_permissions']) {
    if (!Array.isArray(manifest[field])) continue;
    manifest[field] = manifest[field].filter((permission) => {
      const normalized = String(permission || '').trim();
      if (!ELECTRON_UNRECOGNIZED_EXTENSION_PERMISSIONS.has(normalized)) {
        return true;
      }
      removedPermissions.push(normalized);
      return false;
    });
  }

  return {
    manifest,
    removedPermissions: Array.from(new Set(removedPermissions)),
  };
}

function createExtensionManager(deps = {}) {
  const {
    app,
    fs,
    path,
    BrowserView,
    logger = console,
    getStorePath,
    getTranslateExtDir,
    getTabs = () => new Map(),
    getActiveTabId = () => null,
    getActiveWC = () => null,
    getMainWindow = () => null,
    applyPluginSettings = null,
    sendToSide = null,
  } = deps;

  let state = {
    developerModeEnabled: true,
    plugins: [],
  };

  const sessionExtensionIds = new WeakMap();
  const knownSessions = new Set();
  let webPanel = null;
  let realtimeStarted = false;
  let refreshTimer = null;
  let refreshDebounceTimer = null;
  let refreshInFlight = null;
  let refreshQueued = false;
  let watcherRootsKey = '';
  let extensionWatchers = [];

  function normalizeAbsolutePath(value) {
    try {
      const raw = String(value || '').trim();
      return raw ? path.resolve(raw) : '';
    } catch (_) {
      return '';
    }
  }

  function hashId(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
  }

  function readJsonFile(filePath) {
    return readJsonFileSafe(filePath, {
      fs,
      fallback: null,
      logger,
      logPrefix: 'Extensions',
    });
  }

  function readStoreSafe() {
    return readStoreConfigFile(getStorePath, { fs });
  }

  function writeStoreSafe(nextStore) {
    return writeStoreConfigFile(getStorePath, nextStore, {
      fs,
      path,
      logger,
      logPrefix: 'Extensions',
      writeErrorMessage: '保存插件配置失败:',
    });
  }

  function persistState() {
    const current = readStoreSafe();
    return writeStoreSafe({
      ...(current && typeof current === 'object' ? current : {}),
      [STORE_FIELD]: {
        developerModeEnabled: true,
        plugins: state.plugins.map((plugin) => ({
          id: plugin.id,
          path: plugin.path,
          name: plugin.name,
          rawName: plugin.rawName,
          description: plugin.description,
          version: plugin.version,
          manifestVersion: plugin.manifestVersion,
          enabled: plugin.enabled === true,
          builtin: plugin.builtin === true,
          iconPath: plugin.iconPath,
          iconRelativePath: plugin.iconRelativePath,
          popupPath: plugin.popupPath,
          optionsPath: plugin.optionsPath,
          hint: plugin.hint,
          importedAt: plugin.importedAt,
          updatedAt: plugin.updatedAt,
        })),
      },
    });
  }

  function readStoredState() {
    const store = readStoreSafe();
    const manager = store && typeof store[STORE_FIELD] === 'object' ? store[STORE_FIELD] : {};
    return {
      developerModeEnabled: true,
      plugins: Array.isArray(manager.plugins) ? manager.plugins : [],
    };
  }

  function toSafeFileName(value) {
    return String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'extension';
  }

  function isPathInside(parentDir, childPath) {
    try {
      const parent = path.resolve(parentDir);
      const child = path.resolve(childPath);
      const relative = path.relative(parent, child);
      return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    } catch (_) {
      return false;
    }
  }

  function resolveCompatCacheRoot() {
    try {
      if (app && typeof app.getPath === 'function') {
        return path.join(app.getPath('userData'), COMPAT_CACHE_DIR_NAME);
      }
    } catch (_) {}
    return path.join(process.cwd(), '.extension-runtime-compat');
  }

  function copyDirectoryRecursive(sourceDir, targetDir) {
    if (typeof fs.cpSync === 'function') {
      fs.cpSync(sourceDir, targetDir, {
        recursive: true,
        force: true,
        dereference: false,
        errorOnExist: false,
      });
      return;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        copyDirectoryRecursive(sourcePath, targetPath);
      } else if (entry.isSymbolicLink()) {
        const link = fs.readlinkSync(sourcePath);
        fs.symlinkSync(link, targetPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  function listExtensionTextFiles(rootDir, options = {}) {
    const maxFiles = Number(options.maxFiles) || 500;
    const maxBytes = Number(options.maxBytes) || 8 * 1024 * 1024;
    const textExts = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.json']);
    const skippedDirs = new Set(['.git', 'node_modules', '.cache']);
    const files = [];
    let latestMtimeMs = 0;

    function walk(dir) {
      if (files.length >= maxFiles) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        if (skippedDirs.has(entry.name)) continue;
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!textExts.has(ext)) continue;
        try {
          const stat = fs.statSync(entryPath);
          latestMtimeMs = Math.max(latestMtimeMs, Number(stat.mtimeMs) || 0);
          if (stat.size > maxBytes) continue;
          files.push(entryPath);
        } catch (_) {}
      }
    }

    walk(rootDir);
    return { files, latestMtimeMs, fileCount: files.length };
  }

  function scanExtensionCompatNeeds(rootDir) {
    const scan = listExtensionTextFiles(rootDir);
    const requiredApiRoots = new Set();

    for (const filePath of scan.files) {
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        for (const match of text.matchAll(/\b(?:chrome|browser)\.(windows|tabs|cookies|downloads|alarms|action|storage)\b/g)) {
          requiredApiRoots.add(match[1]);
        }
      } catch (_) {}
    }

    return {
      ...scan,
      requiredApiRoots: Array.from(requiredApiRoots).sort(),
      needsCompatShim: requiredApiRoots.size > 0,
    };
  }

  function buildElectronExtensionCompatShim() {
    return `/* ${COMPAT_SHIM_MARKER} */
(() => {
  const installedKey = '__aiFreeElectronExtensionCompatInstalled';
  if (globalThis[installedKey]) return;
  try {
    Object.defineProperty(globalThis, installedKey, { value: true, configurable: true });
  } catch (_) {
    globalThis[installedKey] = true;
  }

  const chromeApi = globalThis.chrome || globalThis.browser;
  if (!chromeApi) return;

  const tabsApi = chromeApi.tabs || null;
  const runtimeApi = chromeApi.runtime || null;
  const nativeTabsQuery = tabsApi && typeof tabsApi.query === 'function' ? tabsApi.query.bind(tabsApi) : null;
  const nativeTabsUpdate = tabsApi && typeof tabsApi.update === 'function' ? tabsApi.update.bind(tabsApi) : null;
  const WINDOW_ID_NONE = -1;
  const WINDOW_ID_CURRENT = -2;

  const isThenable = (value) => value && typeof value.then === 'function';
  const makeEvent = () => {
    const listeners = new Set();
    return {
      addListener(listener) { if (typeof listener === 'function') listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
      hasListener(listener) { return listeners.has(listener); },
      hasListeners() { return listeners.size > 0; },
      dispatch(...args) {
        for (const listener of Array.from(listeners)) {
          try { listener(...args); } catch (_) {}
        }
      },
    };
  };

  function callChrome(api, method, args) {
    if (!api || typeof api[method] !== 'function') {
      return Promise.reject(new Error('chrome.' + method + ' is unavailable'));
    }

    try {
      const result = api[method](...(args || []));
      if (isThenable(result)) return result;
      if (result !== undefined) return Promise.resolve(result);
    } catch (_) {
      // Retry with callback form below.
    }

    return new Promise((resolve, reject) => {
      try {
        api[method](...(args || []), (value) => {
          const lastError = runtimeApi && runtimeApi.lastError;
          if (lastError && lastError.message) {
            reject(new Error(lastError.message));
          } else {
            resolve(value);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function withCallback(promise, callback) {
    if (typeof callback === 'function') {
      promise.then(
        (value) => callback(value),
        () => callback(undefined),
      );
      return undefined;
    }
    return promise;
  }

  function callNative(method, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const callback = (value) => {
        if (settled) return;
        settled = true;
        const lastError = runtimeApi && runtimeApi.lastError;
        lastError && lastError.message ? reject(new Error(lastError.message)) : resolve(value);
      };
      try {
        const result = method(...args, callback);
        if (isThenable(result)) {
          result.then(callback, reject);
        } else if (result !== undefined && !settled) {
          settled = true;
          resolve(result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  // Normalize Chrome query/update options to Electron's documented subset.
  // This also makes active/currentWindow calls deterministic for a session
  // backed by one app BrowserView.
  if (tabsApi && nativeTabsQuery) {
    tabsApi.query = (queryInfo, callback) => {
      const source = queryInfo && typeof queryInfo === 'object' ? queryInfo : {};
      const supported = {};
      for (const key of ['url', 'title', 'audible', 'active', 'muted']) {
        if (source[key] !== undefined) supported[key] = source[key];
      }
      const promise = callNative(nativeTabsQuery, [supported]).then((tabs) => {
        const list = Array.isArray(tabs) ? tabs : [];
        return list.map((tab, index) => ({
          ...tab,
          active: source.active === false ? !!tab.active : (index === 0 || !!tab.active),
          windowId: Number.isFinite(Number(tab && tab.windowId)) ? Number(tab.windowId) : 1,
        }));
      });
      return withCallback(promise, callback);
    };
  }

  if (tabsApi && nativeTabsUpdate) {
    tabsApi.update = (tabId, updateProperties, callback) => {
      if (typeof updateProperties === 'function') {
        callback = updateProperties;
        updateProperties = tabId;
        tabId = undefined;
      }
      const source = updateProperties && typeof updateProperties === 'object' ? updateProperties : {};
      const supported = {};
      if (source.url !== undefined) supported.url = source.url;
      if (source.muted !== undefined) supported.muted = source.muted;
      const args = tabId === undefined ? [supported] : [tabId, supported];
      const promise = Object.keys(supported).length
        ? callNative(nativeTabsUpdate, args)
        : (tabId === undefined ? queryTabs({ active: true }).then((tabs) => tabs[0]) : getTab(tabId));
      return withCallback(promise, callback);
    };
  }

  function tabWindowId(tab) {
    const id = Number(tab && tab.windowId);
    return Number.isFinite(id) ? id : 1;
  }

  async function queryTabs(queryInfo) {
    if (!tabsApi || typeof tabsApi.query !== 'function') return [];
    try {
      const tabs = await callChrome(tabsApi, 'query', [queryInfo || {}]);
      return Array.isArray(tabs) ? tabs : [];
    } catch (_) {
      return [];
    }
  }

  async function getTab(tabId) {
    if (!tabsApi || typeof tabsApi.get !== 'function') return null;
    try {
      return await callChrome(tabsApi, 'get', [tabId]);
    } catch (_) {
      return null;
    }
  }

  async function collectWindows(queryInfo) {
    const info = queryInfo && typeof queryInfo === 'object' ? queryInfo : {};
    const allTabs = await queryTabs({});
    const activeLastFocused = await queryTabs({ active: true, lastFocusedWindow: true });
    const activeAny = allTabs.filter((tab) => tab && tab.active);
    const focusedWindowId = tabWindowId(activeLastFocused[0] || activeAny[0] || allTabs[0]);
    const byId = new Map();

    for (const tab of allTabs) {
      const id = tabWindowId(tab);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          focused: id === focusedWindowId,
          incognito: !!tab.incognito,
          type: 'normal',
          state: 'normal',
          alwaysOnTop: false,
          tabs: [],
        });
      }
      byId.get(id).tabs.push(tab);
    }

    if (byId.size === 0) {
      byId.set(focusedWindowId || 1, {
        id: focusedWindowId || 1,
        focused: true,
        incognito: false,
        type: 'normal',
        state: 'normal',
        alwaysOnTop: false,
        tabs: [],
      });
    }

    let windows = Array.from(byId.values()).map((win) => ({
      ...win,
      tabs: win.tabs.slice().sort((a, b) => Number(a.index || 0) - Number(b.index || 0)),
    }));

    if (Array.isArray(info.windowTypes) && info.windowTypes.length) {
      const allowed = new Set(info.windowTypes.map((type) => String(type || '')));
      windows = windows.filter((win) => allowed.has(win.type));
    }

    if (info.populate !== true) {
      windows = windows.map(({ tabs, ...win }) => win);
    }

    return windows;
  }

  async function getWindow(windowId, queryInfo) {
    let id = Number(windowId);
    const windows = await collectWindows({ ...(queryInfo || {}), populate: !!(queryInfo && queryInfo.populate) });
    if (id === WINDOW_ID_CURRENT || !Number.isFinite(id)) {
      return windows.find((win) => win.focused) || windows[0] || null;
    }
    return windows.find((win) => Number(win.id) === id) || null;
  }

  const windowsApi = chromeApi.windows || {};
  if (!chromeApi.windows) {
    try {
      Object.defineProperty(chromeApi, 'windows', {
        value: windowsApi,
        configurable: true,
        enumerable: true,
      });
    } catch (_) {
      chromeApi.windows = windowsApi;
    }
  }

  windowsApi.WINDOW_ID_NONE = windowsApi.WINDOW_ID_NONE ?? WINDOW_ID_NONE;
  windowsApi.WINDOW_ID_CURRENT = windowsApi.WINDOW_ID_CURRENT ?? WINDOW_ID_CURRENT;
  windowsApi.onCreated = windowsApi.onCreated || makeEvent();
  windowsApi.onRemoved = windowsApi.onRemoved || makeEvent();
  windowsApi.onFocusChanged = windowsApi.onFocusChanged || makeEvent();

  if (typeof windowsApi.getAll !== 'function') {
    windowsApi.getAll = (queryInfo, callback) => withCallback(collectWindows(queryInfo), callback);
  }

  if (typeof windowsApi.get !== 'function') {
    windowsApi.get = (windowId, queryInfo, callback) => {
      if (typeof queryInfo === 'function') {
        callback = queryInfo;
        queryInfo = {};
      }
      return withCallback(getWindow(windowId, queryInfo || {}), callback);
    };
  }

  if (typeof windowsApi.getCurrent !== 'function') {
    windowsApi.getCurrent = (queryInfo, callback) => {
      if (typeof queryInfo === 'function') {
        callback = queryInfo;
        queryInfo = {};
      }
      return withCallback(getWindow(WINDOW_ID_CURRENT, queryInfo || {}), callback);
    };
  }

  if (typeof windowsApi.getLastFocused !== 'function') {
    windowsApi.getLastFocused = (queryInfo, callback) => {
      if (typeof queryInfo === 'function') {
        callback = queryInfo;
        queryInfo = {};
      }
      return withCallback(getWindow(WINDOW_ID_CURRENT, queryInfo || {}), callback);
    };
  }

  if (typeof windowsApi.update !== 'function') {
    windowsApi.update = (windowId, updateInfo, callback) => {
      const promise = (async () => {
        const win = await getWindow(windowId, { populate: true });
        if (updateInfo && updateInfo.focused === true && tabsApi && typeof tabsApi.update === 'function') {
          const activeTab = (win && win.tabs || []).find((tab) => tab && tab.active) || (win && win.tabs || [])[0];
          if (activeTab && activeTab.id !== undefined) {
            try { await callChrome(tabsApi, 'update', [activeTab.id, { active: true }]); } catch (_) {}
          }
        }
        const next = await getWindow(windowId, {});
        return next || (win ? (({ tabs, ...rest }) => rest)(win) : null);
      })();
      return withCallback(promise, callback);
    };
  }

  if (typeof windowsApi.create !== 'function') {
    windowsApi.create = (createData, callback) => {
      const promise = (async () => {
        if (!tabsApi || typeof tabsApi.create !== 'function') {
          throw new Error('chrome.tabs.create is unavailable');
        }
        const data = createData && typeof createData === 'object' ? createData : {};
        const url = Array.isArray(data.url) ? data.url[0] : data.url;
        const tab = await callChrome(tabsApi, 'create', [{
          url: url || undefined,
          active: data.focused !== false,
        }]);
        return await getWindow(tabWindowId(tab), { populate: true });
      })();
      return withCallback(promise, callback);
    };
  }

  if (typeof windowsApi.remove !== 'function') {
    windowsApi.remove = (windowId, callback) => {
      const promise = (async () => {
        if (!tabsApi || typeof tabsApi.remove !== 'function') return undefined;
        const win = await getWindow(windowId, { populate: true });
        const ids = (win && win.tabs || [])
          .map((tab) => tab && tab.id)
          .filter((id) => id !== undefined && id !== null);
        if (ids.length) {
          try { await callChrome(tabsApi, 'remove', [ids]); } catch (_) {}
        }
        return undefined;
      })();
      return withCallback(promise, callback);
    };
  }

  // Electron intentionally implements only a subset of chrome.tabs.  Complete
  // the common API surface in one place so extensions do not need Electron
  // branches scattered through their business code.  A BrowserView session has
  // one app-managed tab, therefore create/remove degrade to replacing/blanking
  // that view while preserving Chrome-compatible return values.
  if (tabsApi) {
    tabsApi.onCreated = tabsApi.onCreated || makeEvent();
    tabsApi.onRemoved = tabsApi.onRemoved || makeEvent();
    tabsApi.onUpdated = tabsApi.onUpdated || makeEvent();
    tabsApi.onActivated = tabsApi.onActivated || makeEvent();

    if (typeof tabsApi.get !== 'function') {
      tabsApi.get = (tabId, callback) => {
        const promise = queryTabs({}).then((tabs) => {
          const found = tabs.find((tab) => Number(tab && tab.id) === Number(tabId));
          if (!found) throw new Error('No tab with id: ' + tabId);
          return found;
        });
        return withCallback(promise, callback);
      };
    }

    if (typeof tabsApi.create !== 'function') {
      tabsApi.create = (createProperties, callback) => {
        const promise = (async () => {
          const data = createProperties && typeof createProperties === 'object' ? createProperties : {};
          const before = await queryTabs({});
          const current = before.find((tab) => {
            const tabUrl = String(tab && tab.url || '').toLowerCase();
            return tabUrl.startsWith('http://') || tabUrl.startsWith('https://');
          })
            || (await queryTabs({ active: true }))[0]
            || before[0];
          if (!current) throw new Error('No Electron tab is available');
          const url = String(data.url || 'about:blank');
          const knownIds = new Set(before.map((tab) => Number(tab && tab.id)));

          // The app's BrowserView setWindowOpenHandler turns this into a real
          // managed tab. Poll chrome.tabs so the extension receives its ID.
          if (chromeApi.scripting && typeof chromeApi.scripting.executeScript === 'function') {
            try {
              await chromeApi.scripting.executeScript({
                target: { tabId: current.id },
                args: [url],
                func: (targetUrl) => { window.open(targetUrl, '_blank', 'noopener'); },
              });
              for (let attempt = 0; attempt < 30; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                const after = await queryTabs({});
                const created = after.find((tab) => !knownIds.has(Number(tab && tab.id)))
                  || after.find((tab) => String(tab && tab.url || '') === url && Number(tab.id) !== Number(current.id));
                if (created) return { ...created, active: data.active !== false };
              }
            } catch (_) {}
          }

          // Last-resort behavior for pages that block window.open: navigation
          // still succeeds in the current real page instead of targeting the
          // extension's offscreen document.
          if (typeof tabsApi.update === 'function') {
            await callChrome(tabsApi, 'update', [current.id, { url }]);
          }
          return await getTab(current.id) || { ...current, url, active: true };
        })();
        return withCallback(promise, callback);
      };
    }

    if (typeof tabsApi.remove !== 'function') {
      tabsApi.remove = (tabIds, callback) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const promise = Promise.all(ids.map(async (id) => {
          if (typeof tabsApi.update === 'function') {
            await callChrome(tabsApi, 'update', [id, { url: 'about:blank' }]);
          }
        })).then(() => undefined);
        return withCallback(promise, callback);
      };
    }
  }

  // MV3 storage.session is absent in Electron. Local storage has the same
  // asynchronous contract and is a durable, deterministic fallback.
  if (chromeApi.storage && !chromeApi.storage.session && chromeApi.storage.local) {
    try { chromeApi.storage.session = chromeApi.storage.local; } catch (_) {}
  }

  // Badge APIs are cosmetic; missing methods must never break an automation
  // socket or MCP result path.
  const actionApi = chromeApi.action || {};
  if (!chromeApi.action) {
    try { chromeApi.action = actionApi; } catch (_) {}
  }
  for (const method of ['setBadgeText', 'setBadgeBackgroundColor', 'setTitle', 'setIcon']) {
    if (typeof actionApi[method] !== 'function') actionApi[method] = () => Promise.resolve();
  }

  // Keep MV3 keepalive code operational. Timers are scoped to the extension
  // worker; recreating an alarm with the same name replaces the previous one.
  const alarmsApi = chromeApi.alarms || {};
  const alarmTimers = new Map();
  if (!chromeApi.alarms) {
    try { chromeApi.alarms = alarmsApi; } catch (_) {}
  }
  alarmsApi.onAlarm = alarmsApi.onAlarm || makeEvent();
  if (typeof alarmsApi.create !== 'function') {
    alarmsApi.create = (name, info) => {
      if (typeof name !== 'string') { info = name; name = ''; }
      const alarmName = String(name || '');
      const data = info && typeof info === 'object' ? info : {};
      const old = alarmTimers.get(alarmName);
      if (old) clearTimeout(old);
      const delay = Math.max(1, Number(data.delayInMinutes || data.periodInMinutes || 1)) * 60000;
      const tick = () => {
        alarmsApi.onAlarm.dispatch({ name: alarmName, scheduledTime: Date.now(), periodInMinutes: data.periodInMinutes });
        if (data.periodInMinutes) alarmTimers.set(alarmName, setTimeout(tick, delay));
        else alarmTimers.delete(alarmName);
      };
      alarmTimers.set(alarmName, setTimeout(tick, delay));
      return Promise.resolve();
    };
  }
  if (typeof alarmsApi.clear !== 'function') {
    alarmsApi.clear = (name, callback) => {
      const timer = alarmTimers.get(String(name || ''));
      if (timer) clearTimeout(timer);
      const removed = alarmTimers.delete(String(name || ''));
      return withCallback(Promise.resolve(removed), callback);
    };
  }

  // Downloads are implemented through the active page. This preserves the
  // app's Session 'will-download' handling and works for data/blob/http URLs.
  const downloadsApi = chromeApi.downloads || {};
  let nextDownloadId = 1;
  if (!chromeApi.downloads) {
    try { chromeApi.downloads = downloadsApi; } catch (_) {}
  }
  if (typeof downloadsApi.download !== 'function') {
    downloadsApi.download = (options, callback) => {
      const promise = (async () => {
        const data = options && typeof options === 'object' ? options : {};
        if (!data.url) throw new Error('downloads.download requires url');
        const tab = (await queryTabs({ active: true }))[0] || (await queryTabs({}))[0];
        if (!tab || !chromeApi.scripting || typeof chromeApi.scripting.executeScript !== 'function') {
          throw new Error('No page is available for the Electron download');
        }
        await chromeApi.scripting.executeScript({
          target: { tabId: tab.id },
          args: [data.url, data.filename || ''],
          func: (url, filename) => {
            const anchor = document.createElement('a');
            anchor.href = url;
            if (filename) anchor.download = filename;
            anchor.style.display = 'none';
            document.documentElement.appendChild(anchor);
            anchor.click();
            anchor.remove();
          },
        });
        return nextDownloadId++;
      })();
      return withCallback(promise, callback);
    };
  }
})();
`;
  }

  function prependShimToScript(scriptPath, shimText) {
    try {
      if (!scriptPath || !fs.existsSync(scriptPath)) return false;
      const current = fs.readFileSync(scriptPath, 'utf8');
      if (current.includes(COMPAT_SHIM_MARKER)) return false;
      fs.writeFileSync(scriptPath, `${shimText}\n${current}`, 'utf8');
      return true;
    } catch (error) {
      logger.warn?.('[Extensions] 注入扩展后台兼容脚本失败:', scriptPath, error?.message || error);
      return false;
    }
  }

  function injectShimIntoHtml(htmlPath, rootDir) {
    try {
      if (!htmlPath || !fs.existsSync(htmlPath)) return false;
      const current = fs.readFileSync(htmlPath, 'utf8');
      if (current.includes(COMPAT_SHIM_FILE)) return false;
      let relativeShimPath = COMPAT_SHIM_FILE;
      if (rootDir) {
        relativeShimPath = path
          .relative(path.dirname(htmlPath), path.join(rootDir, COMPAT_SHIM_FILE))
          .replace(/\\/g, '/');
        if (!relativeShimPath.startsWith('.')) {
          relativeShimPath = `./${relativeShimPath}`;
        }
      }
      const tag = `<script src="${relativeShimPath}"></script>`;
      let next = '';
      if (/<\/head>/i.test(current)) {
        next = current.replace(/<\/head>/i, `${tag}\n</head>`);
      } else if (/<script\b/i.test(current)) {
        next = current.replace(/<script\b/i, `${tag}\n<script`);
      } else {
        next = `${tag}\n${current}`;
      }
      fs.writeFileSync(htmlPath, next, 'utf8');
      return true;
    } catch (error) {
      logger.warn?.('[Extensions] 注入扩展页面兼容脚本失败:', htmlPath, error?.message || error);
      return false;
    }
  }

  function patchCompatExtensionDirectory(compatDir) {
    const manifestPath = path.join(compatDir, 'manifest.json');
    const sourceManifest = readJsonFile(manifestPath);
    if (!sourceManifest || typeof sourceManifest !== 'object') {
      throw new Error('运行时插件副本缺少有效 manifest.json');
    }
    const sanitized = sanitizeManifestPermissionsForElectron(sourceManifest);
    const manifest = sanitized.manifest;
    let manifestChanged = sanitized.removedPermissions.length > 0;

    const shimText = buildElectronExtensionCompatShim();
    fs.writeFileSync(path.join(compatDir, COMPAT_SHIM_FILE), shimText, 'utf8');

    const background = manifest.background && typeof manifest.background === 'object'
      ? manifest.background
      : null;

    if (background?.service_worker) {
      const workerPath = path.join(compatDir, String(background.service_worker).replace(/^\/+/, ''));
      prependShimToScript(workerPath, shimText);
    } else if (Array.isArray(background?.scripts)) {
      const scripts = background.scripts.map((item) => String(item || '').trim()).filter(Boolean);
      if (!scripts.includes(COMPAT_SHIM_FILE)) {
        background.scripts = [COMPAT_SHIM_FILE, ...scripts];
        manifestChanged = true;
      }
    } else if (background?.page) {
      injectShimIntoHtml(path.join(compatDir, String(background.page).replace(/^\/+/, '')), compatDir);
    }

    const htmlFiles = listExtensionTextFiles(compatDir, { maxFiles: 800, maxBytes: 1024 * 1024 })
      .files
      .filter((filePath) => ['.html', '.htm'].includes(path.extname(filePath).toLowerCase()));
    htmlFiles.forEach((filePath) => injectShimIntoHtml(filePath, compatDir));

    if (manifestChanged) {
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    if (sanitized.removedPermissions.length) {
      logger.log?.(
        '[Extensions] Electron 兼容层已处理不识别的权限声明:',
        sanitized.removedPermissions.join(', '),
      );
    }
  }

  function prepareCompatExtensionPath(plugin) {
    const sourcePath = normalizeAbsolutePath(plugin?.path);
    if (!sourcePath) return '';

    const scan = scanExtensionCompatNeeds(sourcePath);
    if (!scan.needsCompatShim) {
      return sourcePath;
    }

    const cacheRoot = resolveCompatCacheRoot();
    const cacheName = `${toSafeFileName(plugin?.id || path.basename(sourcePath))}-${hashId(sourcePath)}`;
    const compatDir = path.join(cacheRoot, cacheName);
    const signature = hashId([
      sourcePath,
      plugin?.version || '',
      scan.latestMtimeMs,
      scan.fileCount,
      scan.requiredApiRoots.join(','),
      COMPAT_SHIM_MARKER,
      COMPAT_SHIM_FILE,
      COMPAT_CACHE_SCHEMA,
    ].join('|'));
    const signaturePath = path.join(compatDir, '.compat-signature');

    try {
      if (
        fs.existsSync(path.join(compatDir, 'manifest.json'))
        && fs.existsSync(signaturePath)
        && fs.readFileSync(signaturePath, 'utf8') === signature
      ) {
        return compatDir;
      }
    } catch (_) {}

    try {
      fs.mkdirSync(cacheRoot, { recursive: true });
      if (fs.existsSync(compatDir)) {
        if (!isPathInside(cacheRoot, compatDir)) {
          throw new Error('兼容缓存目录校验失败');
        }
        fs.rmSync(compatDir, { recursive: true, force: true });
      }
      copyDirectoryRecursive(sourcePath, compatDir);
      patchCompatExtensionDirectory(compatDir);
      fs.writeFileSync(signaturePath, signature, 'utf8');
      logger.log?.('[Extensions] 已为插件创建 Electron 兼容副本:', plugin?.name || plugin?.id || sourcePath);
      return compatDir;
    } catch (error) {
      logger.warn?.('[Extensions] 创建插件兼容副本失败，回退原目录:', plugin?.name || plugin?.id || sourcePath, error?.message || error);
      return sourcePath;
    }
  }

  function resolveBundledExtensionRoots() {
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', 'extensions'));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'extensions'));
      candidates.push(path.join(process.resourcesPath, 'src', 'assets', 'extensions'));
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'src', 'assets', 'extensions'));
    }
    if (app && typeof app.getAppPath === 'function') {
      const appPath = app.getAppPath();
      candidates.push(path.join(appPath, 'src', 'assets', 'extensions'));
      candidates.push(path.join(appPath, 'assets', 'extensions'));
    }
    candidates.push(path.join(__dirname, '../../../assets/extensions'));

    const roots = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const normalized = normalizeAbsolutePath(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      try {
        if (fs.existsSync(normalized)) {
          roots.push(normalized);
        }
      } catch (_) {}
    }
    return roots;
  }

  function collectBundledExtensionDirs() {
    const dirsByName = new Map();

    const addDir = (dir) => {
      const normalized = normalizeAbsolutePath(dir);
      if (!normalized) return;
      try {
        if (!fs.existsSync(path.join(normalized, 'manifest.json'))) return;
        const key = path.basename(normalized).toLowerCase();
        if (!dirsByName.has(key)) {
          dirsByName.set(key, normalized);
        }
      } catch (_) {}
    };

    addDir(resolveBuiltinTranslateDir());

    for (const root of resolveBundledExtensionRoots()) {
      addDir(root);
      try {
        const children = fs.readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(root, entry.name));
        children.forEach(addDir);
      } catch (error) {
        logger.warn?.('[Extensions] 扫描内置插件目录失败:', root, error?.message || error);
      }
    }

    return Array.from(dirsByName.values())
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  function getBundledExtensionId(dir) {
    const dirName = path.basename(String(dir || '')).trim();
    const normalizedName = dirName.toLowerCase();
    if (normalizedName === 'transform') return BUILTIN_TRANSLATE_ID;
    if (normalizedName === 'remove_watermark') return BUILTIN_REMOVE_WATERMARK_ID;

    const safeName = normalizedName
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `asset-${safeName || hashId(dirName || dir)}`;
  }

  function getBundledExtensionOverrides(dir, existing = {}) {
    const dirName = path.basename(String(dir || '')).trim().toLowerCase();
    const overrides = {
      id: getBundledExtensionId(dir),
      builtin: true,
      enabled: existing.enabled !== false,
    };

    if (dirName === 'transform') {
      overrides.name = existing.name || '翻译插件';
      overrides.hint = existing.hint || '点击网页右侧粉色按钮翻译';
    } else if (dirName === 'remove_watermark') {
      overrides.name = existing.name || '去水印插件';
      overrides.hint = existing.hint || '右键视频图片直接下载';
    }

    return overrides;
  }

  function resolveMessages(dir, locale) {
    const filePath = path.join(dir, '_locales', locale, 'messages.json');
    const json = readJsonFile(filePath);
    return json && typeof json === 'object' ? json : null;
  }

  function resolveManifestText(dir, manifest, value) {
    const text = String(value || '').trim();
    const match = text.match(/^__MSG_([^_]+(?:_[^_]+)*)__$/);
    if (!match) return text;

    const messageKey = match[1];
    const locales = [
      'zh_CN',
      'zh',
      String(manifest?.default_locale || '').trim(),
      'en',
    ].filter(Boolean);
    const seen = new Set();
    for (const locale of locales) {
      if (seen.has(locale)) continue;
      seen.add(locale);
      const messages = resolveMessages(dir, locale);
      const message = messages?.[messageKey]?.message;
      if (message) return String(message);
    }
    return messageKey;
  }

  function readManifest(dir) {
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = readJsonFile(manifestPath);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('所选目录没有有效的 manifest.json');
    }
    if (!manifest.manifest_version) {
      throw new Error('manifest.json 缺少 manifest_version');
    }
    return manifest;
  }

  function normalizeIconCandidate(iconValue) {
    if (!iconValue) return '';
    if (typeof iconValue === 'string') return iconValue;
    if (typeof iconValue === 'object') {
      const entries = Object.entries(iconValue)
        .map(([size, iconPath]) => ({ size: Number(size), iconPath: String(iconPath || '') }))
        .filter((entry) => entry.iconPath)
        .sort((a, b) => b.size - a.size);
      return entries[0]?.iconPath || '';
    }
    return '';
  }

  function resolveIconPath(dir, manifest) {
    const actionIcon = normalizeIconCandidate(
      manifest?.action?.default_icon
      || manifest?.browser_action?.default_icon
      || manifest?.page_action?.default_icon,
    );
    const manifestIcon = normalizeIconCandidate(manifest?.icons);
    const relativePath = String(actionIcon || manifestIcon || '').replace(/^\/+/, '');
    if (!relativePath) {
      return { iconPath: '', iconRelativePath: '' };
    }
    const iconPath = path.join(dir, relativePath);
    return {
      iconPath: fs.existsSync(iconPath) ? iconPath : '',
      iconRelativePath: relativePath,
    };
  }

  function resolvePopupPath(manifest) {
    return String(
      manifest?.action?.default_popup
      || manifest?.browser_action?.default_popup
      || manifest?.page_action?.default_popup
      || '',
    ).replace(/^\/+/, '').trim();
  }

  function resolveOptionsPath(manifest) {
    return String(
      manifest?.options_page
      || manifest?.options_ui?.page
      || '',
    ).replace(/^\/+/, '').trim();
  }

  function getPluginRuntimeSignature(dir, manifest = {}) {
    try {
      const scan = listExtensionTextFiles(dir, { maxFiles: 1200, maxBytes: 4 * 1024 * 1024 });
      let manifestMtimeMs = 0;
      try {
        manifestMtimeMs = Number(fs.statSync(path.join(dir, 'manifest.json')).mtimeMs) || 0;
      } catch (_) {}
      return hashId([
        normalizeAbsolutePath(dir),
        manifest?.manifest_version || '',
        manifest?.version || '',
        manifestMtimeMs,
        scan.latestMtimeMs,
        scan.fileCount,
      ].join('|'));
    } catch (_) {
      return hashId([normalizeAbsolutePath(dir), manifest?.version || '', 'signature-fallback'].join('|'));
    }
  }

  function buildPluginRecord(dir, existing = {}, overrides = {}) {
    const absPath = normalizeAbsolutePath(dir);
    const manifest = readManifest(absPath);
    const rawName = resolveManifestText(absPath, manifest, manifest.name) || path.basename(absPath);
    const description = resolveManifestText(absPath, manifest, manifest.description) || '';
    const icon = resolveIconPath(absPath, manifest);
    const id = String(overrides.id || existing.id || `local-${hashId(absPath)}`).trim();
    const now = new Date().toISOString();

    return {
      id,
      path: absPath,
      name: String(overrides.name || existing.name || rawName || path.basename(absPath)).trim(),
      rawName,
      description,
      version: String(manifest.version || ''),
      manifestVersion: Number(manifest.manifest_version) || null,
      enabled: overrides.enabled !== undefined
        ? overrides.enabled === true
        : existing.enabled === true,
      builtin: overrides.builtin !== undefined
        ? overrides.builtin === true
        : existing.builtin === true,
      iconPath: icon.iconPath,
      iconRelativePath: icon.iconRelativePath,
      popupPath: resolvePopupPath(manifest),
      optionsPath: resolveOptionsPath(manifest),
      hint: String(overrides.hint || existing.hint || '').trim(),
      importedAt: existing.importedAt || now,
      updatedAt: now,
      runtimeSignature: getPluginRuntimeSignature(absPath, manifest),
    };
  }

  function normalizeStoredPlugin(plugin) {
    try {
      const absPath = normalizeAbsolutePath(plugin?.path);
      if (!absPath || !fs.existsSync(path.join(absPath, 'manifest.json'))) {
        return {
          ...(plugin || {}),
          path: absPath,
          missing: true,
          enabled: false,
        };
      }
      return buildPluginRecord(absPath, plugin || {});
    } catch (error) {
      logger.warn?.('[Extensions] 插件记录解析失败:', plugin?.path, error?.message || error);
      return {
        ...(plugin || {}),
        missing: true,
        enabled: false,
      };
    }
  }

  function resolveBuiltinTranslateDir() {
    try {
      if (typeof getTranslateExtDir === 'function') {
        const dir = getTranslateExtDir();
        if (dir && fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
      }
    } catch (_) {}
    return '';
  }

  function syncLegacyTranslateSetting() {
    const translatePlugin = state.plugins.find((plugin) => plugin.id === BUILTIN_TRANSLATE_ID);
    if (typeof applyPluginSettings === 'function') {
      try {
        applyPluginSettings({ translateExtEnabled: translatePlugin?.enabled === true });
      } catch (error) {
        logger.warn?.('[Extensions] 同步翻译插件开关失败:', error?.message || error);
      }
    }
  }

  function emitStateChanged() {
    try {
      const publicState = getPublicState();
      if (typeof sendToSide === 'function') {
        sendToSide('extension-manager-state', publicState);
      }
      const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed?.()) {
        mainWindow.webContents.send('extension-manager-state', publicState);
      }
    } catch (_) {}
  }

  function getPluginMaps(plugins = []) {
    const byId = new Map();
    const byPath = new Map();
    for (const plugin of plugins) {
      if (!plugin || !plugin.id) continue;
      byId.set(plugin.id, plugin);
      const normalizedPath = normalizeAbsolutePath(plugin.path);
      if (normalizedPath) byPath.set(normalizedPath, plugin);
    }
    return { byId, byPath };
  }

  function buildBundledPluginRecords() {
    const stored = readStoredState();
    const storedPlugins = stored.plugins
      .map(normalizeStoredPlugin)
      .filter((plugin) => plugin && plugin.id);
    const storedMaps = getPluginMaps(storedPlugins);
    const currentMaps = getPluginMaps(state.plugins);
    const bundledPlugins = [];
    const seenIds = new Set();

    for (const dir of collectBundledExtensionDirs()) {
      try {
        const id = getBundledExtensionId(dir);
        const normalizedDir = normalizeAbsolutePath(dir);
        const existing = currentMaps.byId.get(id)
          || currentMaps.byPath.get(normalizedDir)
          || storedMaps.byId.get(id)
          || storedMaps.byPath.get(normalizedDir)
          || {};
        const record = buildPluginRecord(dir, existing, getBundledExtensionOverrides(dir, existing));
        if (seenIds.has(record.id)) continue;
        seenIds.add(record.id);
        bundledPlugins.push(record);
      } catch (error) {
        logger.warn?.('[Extensions] 扫描目录插件失败:', dir, error?.message || error);
      }
    }

    return bundledPlugins;
  }

  function didPublicPluginChange(prev, next) {
    if (!prev || !next) return true;
    const fields = [
      'id',
      'path',
      'name',
      'rawName',
      'description',
      'version',
      'manifestVersion',
      'enabled',
      'builtin',
      'iconPath',
      'iconRelativePath',
      'popupPath',
      'optionsPath',
      'hint',
      'missing',
    ];
    return fields.some((field) => prev[field] !== next[field]);
  }

  function shouldReloadPlugin(prev, next) {
    if (!next || next.enabled !== true) return false;
    if (!prev) return true;
    return normalizeAbsolutePath(prev.path) !== normalizeAbsolutePath(next.path)
      || prev.runtimeSignature !== next.runtimeSignature;
  }

  async function applyBundledPluginRecords(nextPlugins, options = {}) {
    const previousPlugins = Array.isArray(state.plugins) ? state.plugins : [];
    const previousById = new Map(previousPlugins.map((plugin) => [plugin.id, plugin]));
    const nextById = new Map(nextPlugins.map((plugin) => [plugin.id, plugin]));
    const removedPlugins = previousPlugins.filter((plugin) => plugin?.id && !nextById.has(plugin.id));
    const reloadPairs = [];
    let stateChanged = previousPlugins.length !== nextPlugins.length || removedPlugins.length > 0;

    for (const plugin of nextPlugins) {
      const previous = previousById.get(plugin.id) || null;
      if (didPublicPluginChange(previous, plugin)) {
        stateChanged = true;
      }
      if (shouldReloadPlugin(previous, plugin)) {
        reloadPairs.push({ previous, plugin });
      }
    }

    state = {
      developerModeEnabled: true,
      plugins: nextPlugins,
    };

    if (stateChanged || reloadPairs.length > 0 || options.persist === true) {
      persistState();
    }
    syncLegacyTranslateSetting();
    if (options.emit !== false && (stateChanged || options.emit === true)) {
      emitStateChanged();
    }

    if (options.load !== false) {
      for (const plugin of removedPlugins) {
        if (plugin.enabled === true) {
          await unloadPluginFromAllSessions(plugin);
        }
      }
      for (const pair of reloadPairs) {
        if (pair.previous && pair.previous.enabled === true) {
          await unloadPluginFromAllSessions(pair.previous);
        }
        await loadPluginIntoAllCurrentSessions(pair.plugin);
      }
    }

    return {
      stateChanged,
      removed: removedPlugins.length,
      reloaded: reloadPairs.length,
    };
  }

  async function refreshBundledExtensions(options = {}) {
    const nextPlugins = buildBundledPluginRecords();
    const result = await applyBundledPluginRecords(nextPlugins, options);
    if ((result.stateChanged || result.removed || result.reloaded) && options.reason) {
      logger.log?.(
        '[Extensions] 已刷新内置插件目录:',
        options.reason,
        `插件 ${nextPlugins.length} 个`,
        `重载 ${result.reloaded} 个`,
      );
    }
    return result;
  }

  async function initialize(options = {}) {
    await refreshBundledExtensions({ persist: true, load: false, emit: false });
    startRealtimePluginLoading();
    if (options.emit === true) {
      emitStateChanged();
    }
    return getPublicState();
  }

  function getIconDataUrl(plugin) {
    try {
      if (!plugin?.iconPath || !fs.existsSync(plugin.iconPath)) return '';
      const ext = path.extname(plugin.iconPath).toLowerCase();
      const mime = ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
      const data = fs.readFileSync(plugin.iconPath);
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (_) {
      return '';
    }
  }

  function toPublicPlugin(plugin) {
    return {
      id: plugin.id,
      name: plugin.name || plugin.rawName || '未命名插件',
      rawName: plugin.rawName || '',
      description: plugin.description || '',
      version: plugin.version || '',
      enabled: plugin.enabled === true,
      builtin: plugin.builtin === true,
      missing: plugin.missing === true,
      hasPopup: !!plugin.popupPath,
      hasOptions: !!plugin.optionsPath,
      hint: plugin.hint || '',
      path: plugin.path || '',
      iconDataUrl: getIconDataUrl(plugin),
    };
  }

  function getPublicState() {
    return {
      developerModeEnabled: true,
      plugins: state.plugins.map(toPublicPlugin),
    };
  }

  // Chromium Fork cannot use Electron's session.extensions API. It must receive
  // unpacked extension directories before the browser process starts so that
  // document_start content scripts are registered before the first navigation.
  function getEnabledExtensionPaths() {
    const seen = new Set();
    const paths = [];
    for (const plugin of state.plugins) {
      if (plugin?.enabled !== true || plugin?.missing === true) continue;
      const pluginPath = normalizeAbsolutePath(plugin.path);
      if (!pluginPath || seen.has(pluginPath)) continue;
      try {
        if (!fs.existsSync(path.join(pluginPath, 'manifest.json'))) continue;
      } catch (_) {
        continue;
      }
      seen.add(pluginPath);
      paths.push(pluginPath);
    }
    return paths;
  }

  function getPluginById(pluginId) {
    const id = String(pluginId || '').trim();
    return state.plugins.find((plugin) => plugin.id === id) || null;
  }

  function rememberSession(session) {
    if (!session) return null;
    knownSessions.add(session);
    let map = sessionExtensionIds.get(session);
    if (!map) {
      map = new Map();
      sessionExtensionIds.set(session, map);
    }
    return map;
  }

  function getLoadedExtensions(session) {
    try {
      const all = session?.extensions?.getAllExtensions
        ? session.extensions.getAllExtensions()
        : null;
      if (Array.isArray(all)) return all;
      if (all && typeof all === 'object') return Object.values(all);
    } catch (_) {}
    return [];
  }

  function findLoadedExtension(session, plugin) {
    const list = getLoadedExtensions(session);
    const normalizedPath = normalizeAbsolutePath(plugin.path);
    return list.find((extension) => {
      const extensionPath = normalizeAbsolutePath(extension?.path || '');
      if (extensionPath && normalizedPath && extensionPath === normalizedPath) return true;
      if (extension?.id && rememberSession(session)?.get(plugin.id) === extension.id) return true;
      const manifestName = extension?.manifest?.name || '';
      return plugin.rawName && (extension?.name === plugin.rawName || manifestName === plugin.rawName);
    }) || null;
  }

  async function loadPluginIntoSession(plugin, session, label = '') {
    if (!plugin || plugin.enabled !== true || plugin.missing === true) return null;
    if (!session || !session.extensions || typeof session.extensions.loadExtension !== 'function') {
      return null;
    }

    const map = rememberSession(session);
    const existingId = map.get(plugin.id);
    if (existingId) {
      const existing = findLoadedExtension(session, plugin);
      if (existing && existing.id === existingId) return existing;
    }

    const loaded = findLoadedExtension(session, plugin);
    if (loaded?.id) {
      map.set(plugin.id, loaded.id);
      return loaded;
    }

    try {
      const loadPath = prepareCompatExtensionPath(plugin) || plugin.path;
      const extension = await session.extensions.loadExtension(loadPath, { allowFileAccess: true });
      if (extension?.id) {
        map.set(plugin.id, extension.id);
      }
      logger.log?.('[Extensions] 插件已加载', label ? `(${label})` : '', plugin.name, extension?.id || '');
      return extension || null;
    } catch (error) {
      const msg = error?.message || String(error);
      if (/already loaded|exists/i.test(msg)) {
        const fallback = findLoadedExtension(session, plugin);
        if (fallback?.id) {
          map.set(plugin.id, fallback.id);
          return fallback;
        }
      }
      logger.warn?.('[Extensions] 插件加载失败', label ? `(${label})` : '', plugin.name, msg);
      return null;
    }
  }

  async function loadEnabledIntoSession(session, label = '') {
    if (!session) return { ok: false, loaded: 0 };
    rememberSession(session);
    let loaded = 0;
    for (const plugin of state.plugins) {
      if (plugin.enabled !== true) continue;
      const extension = await loadPluginIntoSession(plugin, session, label);
      if (extension) loaded += 1;
    }
    return { ok: true, loaded };
  }

  function collectSessions() {
    const sessions = new Set(knownSessions);
    try {
      const tabs = typeof getTabs === 'function' ? getTabs() : null;
      if (tabs && typeof tabs.values === 'function') {
        for (const tab of tabs.values()) {
          const session = tab?.view?.webContents?.session;
          if (session) sessions.add(session);
        }
      }
    } catch (_) {}
    return Array.from(sessions).filter(Boolean);
  }

  async function unloadPluginFromSession(plugin, session) {
    if (!plugin || !session) return false;
    const map = rememberSession(session);
    let extensionId = map.get(plugin.id);
    if (!extensionId) {
      const loaded = findLoadedExtension(session, plugin);
      extensionId = loaded?.id || '';
    }
    if (!extensionId) return false;

    try {
      if (session.extensions && typeof session.extensions.removeExtension === 'function') {
        await Promise.resolve(session.extensions.removeExtension(extensionId));
      } else if (typeof session.removeExtension === 'function') {
        await Promise.resolve(session.removeExtension(extensionId));
      } else {
        return false;
      }
      map.delete(plugin.id);
      logger.log?.('[Extensions] 插件已卸载:', plugin.name, extensionId);
      return true;
    } catch (error) {
      logger.warn?.('[Extensions] 插件卸载失败:', plugin.name, error?.message || error);
      return false;
    }
  }

  async function unloadPluginFromAllSessions(plugin) {
    const sessions = collectSessions();
    await Promise.all(sessions.map((session) => unloadPluginFromSession(plugin, session)));
  }

  async function loadPluginIntoAllCurrentSessions(plugin) {
    const sessions = collectSessions();
    await Promise.all(sessions.map((session) => loadPluginIntoSession(plugin, session, '现有标签')));
  }

  async function ensureEnabledPluginsLoadedInCurrentSessions(label = '巡检') {
    const sessions = collectSessions();
    if (!sessions.length) return { ok: true, sessions: 0, loaded: 0 };
    let loaded = 0;
    await Promise.all(sessions.map(async (session) => {
      const result = await loadEnabledIntoSession(session, label);
      loaded += Number(result?.loaded || 0);
    }));
    return { ok: true, sessions: sessions.length, loaded };
  }

  function closeExtensionWatchers() {
    for (const watcher of extensionWatchers) {
      try { watcher.close(); } catch (_) {}
    }
    extensionWatchers = [];
    watcherRootsKey = '';
  }

  function shouldWatchEvent(filename) {
    const name = String(filename || '');
    if (!name) return true;
    const lower = name.toLowerCase();
    if (lower.endsWith('manifest.json')) return true;
    const ext = path.extname(lower);
    return !ext || ['.js', '.mjs', '.cjs', '.html', '.htm', '.json'].includes(ext);
  }

  function setupExtensionWatchers() {
    const roots = resolveBundledExtensionRoots();
    const rootsKey = roots.join('|');
    if (rootsKey === watcherRootsKey) return;
    closeExtensionWatchers();
    watcherRootsKey = rootsKey;

    for (const root of roots) {
      try {
        const watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
          if (!shouldWatchEvent(filename)) return;
          scheduleRealtimeRefresh(`目录变化 ${path.basename(root)}`);
        });
        extensionWatchers.push(watcher);
      } catch (error) {
        try {
          const watcher = fs.watch(root, (_eventType, filename) => {
            if (!shouldWatchEvent(filename)) return;
            scheduleRealtimeRefresh(`目录变化 ${path.basename(root)}`);
          });
          extensionWatchers.push(watcher);
        } catch (fallbackError) {
          logger.warn?.('[Extensions] 监听插件目录失败:', root, fallbackError?.message || error?.message || fallbackError);
        }
      }
    }
  }

  function scheduleRealtimeRefresh(reason = '目录变化') {
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
    }
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null;
      void runRealtimeRefresh(reason);
    }, EXTENSION_REFRESH_DEBOUNCE_MS);
    if (typeof refreshDebounceTimer.unref === 'function') {
      refreshDebounceTimer.unref();
    }
  }

  async function runRealtimeRefresh(reason = '定时巡检') {
    if (refreshInFlight) {
      refreshQueued = true;
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      setupExtensionWatchers();
      await refreshBundledExtensions({ reason });
      await ensureEnabledPluginsLoadedInCurrentSessions(reason);
    })();

    try {
      return await refreshInFlight;
    } catch (error) {
      logger.warn?.('[Extensions] 实时刷新插件失败:', error?.message || error);
      return null;
    } finally {
      refreshInFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleRealtimeRefresh('队列刷新');
      }
    }
  }

  function stopRealtimePluginLoading() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = null;
    }
    closeExtensionWatchers();
    realtimeStarted = false;
  }

  function startRealtimePluginLoading() {
    if (realtimeStarted) return;
    realtimeStarted = true;
    setupExtensionWatchers();
    refreshTimer = setInterval(() => {
      void runRealtimeRefresh('定时巡检');
    }, EXTENSION_REFRESH_INTERVAL_MS);
    if (typeof refreshTimer.unref === 'function') {
      refreshTimer.unref();
    }
    try {
      if (app && typeof app.once === 'function') {
        app.once('before-quit', stopRealtimePluginLoading);
      }
    } catch (_) {}
  }

  function clampNumber(value, min, max) {
    const num = Number(value);
    const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
    const safeMax = Number.isFinite(Number(max)) ? Number(max) : safeMin;
    if (!Number.isFinite(num)) return safeMin;
    return Math.min(Math.max(Math.round(num), safeMin), safeMax);
  }

  function getActiveWebPanelSizeLimits() {
    const tabs = typeof getTabs === 'function' ? getTabs() : null;
    const activeTab = tabs?.get?.(typeof getActiveTabId === 'function' ? getActiveTabId() : null);
    const activeView = activeTab?.view || null;
    const webBounds = activeView && typeof activeView.getBounds === 'function'
      ? activeView.getBounds()
      : null;
    if (!webBounds || !webBounds.width || !webBounds.height) return null;

    const maxContentWidth = Math.max(0, Math.floor(webBounds.width - WEB_PANEL_MARGIN * 2));
    const maxContentHeight = Math.max(0, Math.floor(webBounds.height - WEB_PANEL_MARGIN * 2));
    if (maxContentWidth < 80 || maxContentHeight < 80) return null;

    return {
      webBounds,
      maxContentWidth,
      maxContentHeight,
    };
  }

  function getDefaultPanelContentSize(pageType) {
    return pageType === 'options' ? OPTIONS_DEFAULT_SIZE : POPUP_DEFAULT_SIZE;
  }

  function normalizePanelContentSize(rawSize = {}, pageType = 'popup') {
    const limits = getActiveWebPanelSizeLimits();
    const defaults = getDefaultPanelContentSize(pageType);
    const maxContentWidth = limits?.maxContentWidth || defaults.width;
    const maxContentHeight = limits?.maxContentHeight || defaults.height;
    const minWidth = Math.min(pageType === 'options' ? 320 : 240, maxContentWidth);
    const minHeight = Math.min(pageType === 'options' ? 300 : 80, maxContentHeight);

    return {
      width: clampNumber(rawSize.width || defaults.width, minWidth, maxContentWidth),
      height: clampNumber(rawSize.height || defaults.height, minHeight, maxContentHeight),
    };
  }

  function getWebPanelBounds() {
    const limits = getActiveWebPanelSizeLimits();
    if (!limits) return null;

    const contentSize = normalizePanelContentSize({
      width: webPanel?.contentWidth,
      height: webPanel?.contentHeight,
    }, webPanel?.pageType || 'popup');

    return {
      x: Math.floor(limits.webBounds.x + limits.webBounds.width - WEB_PANEL_MARGIN - contentSize.width),
      y: Math.floor(limits.webBounds.y + WEB_PANEL_MARGIN),
      width: contentSize.width,
      height: contentSize.height,
    };
  }

  function syncWebPanelBounds() {
    if (!webPanel?.view) return false;
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!mainWindow || mainWindow.isDestroyed?.()) return false;

    const bounds = getWebPanelBounds();
    if (!bounds) return false;

    try {
      webPanel.view.setBounds(bounds);
      mainWindow.setTopBrowserView(webPanel.view);
      return true;
    } catch (error) {
      logger.warn?.('[Extensions] 同步网页插件浮窗位置失败:', error?.message || error);
      return false;
    }
  }

  function closeWebPanel(options = {}) {
    const notify = options.notify !== false;
    const panel = webPanel;
    webPanel = null;
    if (panel?.view) {
      try {
        const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (mainWindow && !mainWindow.isDestroyed?.()) {
          mainWindow.removeBrowserView(panel.view);
        }
      } catch (_) {}
      try {
        if (panel.view.webContents && !panel.view.webContents.isDestroyed()) {
          panel.view.webContents.destroy();
        }
      } catch (_) {}
    }
    if (notify && typeof sendToSide === 'function') {
      try { sendToSide('extension-web-panel-closed', {}); } catch (_) {}
    }
    return { ok: true, state: getPublicState() };
  }

  function createWebPanelView(partition) {
    if (!BrowserView) {
      throw new Error('当前环境无法创建插件浮窗');
    }
    return new BrowserView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
  }

  async function measureWebPanelContent(view, pageType = 'popup') {
    try {
      if (!view?.webContents || view.webContents.isDestroyed?.()) {
        return normalizePanelContentSize({}, pageType);
      }

      const measured = await view.webContents.executeJavaScript(`
        (() => {
          const doc = document.documentElement;
          const body = document.body;
          const bodyStyle = body ? getComputedStyle(body) : null;
          const marginRight = parseFloat(bodyStyle?.marginRight || '0') || 0;
          const marginBottom = parseFloat(bodyStyle?.marginBottom || '0') || 0;
          const roots = body
            ? Array.from(body.children).filter((element) => {
                if (!element || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) return false;
                const style = getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden';
              })
            : [];

          let contentRight = 0;
          let contentBottom = 0;
          for (const root of roots) {
            const rect = root.getBoundingClientRect();
            contentRight = Math.max(contentRight, rect.right, rect.left + root.scrollWidth);
            contentBottom = Math.max(contentBottom, rect.bottom, rect.top + root.scrollHeight);
          }

          // documentElement.scrollHeight is always at least the current BrowserView
          // height, so using it prevents a short popup from ever shrinking. Measure
          // the actual body roots instead and retain the old values only as fallback.
          const width = Math.ceil(contentRight > 0
            ? contentRight + marginRight
            : Math.max(body?.scrollWidth || 0, doc?.scrollWidth || 0));
          const height = Math.ceil(contentBottom > 0
            ? contentBottom + marginBottom
            : Math.max(body?.scrollHeight || 0, doc?.scrollHeight || 0));
          return { width, height };
        })()
      `, true);
      return normalizePanelContentSize(measured || {}, pageType);
    } catch (error) {
      logger.warn?.('[Extensions] 测量插件浮窗尺寸失败:', error?.message || error);
      return normalizePanelContentSize({}, pageType);
    }
  }

  async function resizeWebPanelToContent(view, pageType = 'popup') {
    const measuredSize = await measureWebPanelContent(view, pageType);
    if (webPanel?.view !== view) return false;
    webPanel.contentWidth = measuredSize.width;
    webPanel.contentHeight = measuredSize.height;
    return syncWebPanelBounds();
  }

  async function setPluginEnabled(pluginId, enabled) {
    const plugin = getPluginById(pluginId);
    if (!plugin) {
      return { ok: false, message: '插件不存在', state: getPublicState() };
    }
    if (plugin.missing === true && enabled === true) {
      return { ok: false, message: '插件目录不存在，请重新导入', state: getPublicState() };
    }

    plugin.enabled = enabled === true;
    plugin.updatedAt = new Date().toISOString();
    persistState();

    if (!plugin.enabled && webPanel?.pluginId === plugin.id) {
      closeWebPanel({ notify: true });
    }

    if (plugin.enabled) {
      await loadPluginIntoAllCurrentSessions(plugin);
    } else {
      await unloadPluginFromAllSessions(plugin);
    }

    syncLegacyTranslateSetting();
    emitStateChanged();
    return { ok: true, plugin: toPublicPlugin(plugin), state: getPublicState() };
  }

  async function removePlugin(pluginId) {
    const plugin = getPluginById(pluginId);
    if (!plugin) return { ok: false, message: '插件不存在', state: getPublicState() };
    if (plugin.builtin === true) {
      return { ok: false, message: '内置插件不能删除，可以关闭开关禁用', state: getPublicState() };
    }
    if (webPanel?.pluginId === plugin.id) {
      closeWebPanel({ notify: true });
    }
    await unloadPluginFromAllSessions(plugin);
    state.plugins = state.plugins.filter((item) => item.id !== plugin.id);
    persistState();
    emitStateChanged();
    return { ok: true, state: getPublicState() };
  }

  function getPluginExtensionId(session, pluginId) {
    const plugin = getPluginById(pluginId);
    if (!session || !plugin) return '';
    const map = rememberSession(session);
    const knownId = map.get(plugin.id);
    if (knownId) return knownId;
    const loaded = findLoadedExtension(session, plugin);
    if (loaded?.id) {
      map.set(plugin.id, loaded.id);
      return loaded.id;
    }
    return '';
  }

  async function openExtensionPage(pluginId, pageType = 'popup') {
    const plugin = getPluginById(pluginId || BUILTIN_TRANSLATE_ID);
    if (!plugin) return { ok: false, message: '插件不存在' };
    if (plugin.enabled !== true) return { ok: false, message: '插件已禁用，请先打开开关' };

    const pagePath = pageType === 'options' ? plugin.optionsPath : plugin.popupPath;
    if (!pagePath) {
      return { ok: false, message: pageType === 'options' ? '该插件没有设置页' : '该插件没有弹窗页' };
    }

    const wc = typeof getActiveWC === 'function' ? getActiveWC() : null;
    if (!wc || wc.isDestroyed?.()) {
      return { ok: false, message: '当前没有可用的网页标签' };
    }

    await loadPluginIntoSession(plugin, wc.session, '打开弹窗');
    const extensionId = getPluginExtensionId(wc.session, plugin.id);
    if (!extensionId) {
      return { ok: false, message: '插件尚未加载到当前网页' };
    }

    const tabs = typeof getTabs === 'function' ? getTabs() : new Map();
    const activeTab = tabs?.get?.(typeof getActiveTabId === 'function' ? getActiveTabId() : null);
    const partition = activeTab?.partition || undefined;
    const url = `chrome-extension://${extensionId}/${pagePath}`;
    const title = pageType === 'options' ? `${plugin.name} 设置` : plugin.name;
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      return { ok: false, message: '主窗口不可用' };
    }

    if (webPanel?.pluginId === plugin.id && webPanel?.pageType === pageType) {
      closeWebPanel({ notify: true });
      return { ok: true, closed: true };
    }

    closeWebPanel({ notify: false });

    const view = createWebPanelView(partition);
    const defaultSize = normalizePanelContentSize({}, pageType);
    webPanel = {
      view,
      pluginId: plugin.id,
      name: plugin.name,
      pageType,
      partition,
      title,
      contentWidth: defaultSize.width,
      contentHeight: defaultSize.height,
    };
    mainWindow.addBrowserView(view);
    syncWebPanelBounds();

    try {
      await loadPluginIntoSession(plugin, view.webContents.session, '网页浮窗');
      await view.webContents.loadURL(url);
      await resizeWebPanelToContent(view, pageType);
      // A number of extension popups render data asynchronously after did-finish-load.
      // Recheck shortly afterwards so loading placeholders do not determine the final size.
      if (pageType === 'popup') {
        for (const delay of [120, 400]) {
          setTimeout(() => {
            if (webPanel?.view === view && !view.webContents.isDestroyed?.()) {
              void resizeWebPanelToContent(view, pageType);
            }
          }, delay);
        }
      }
      if (pageType === 'popup') {
        // 不再监听 blur 自动关闭浮窗：blur 会在打开系统文件选择对话框、
        // 切换到其它应用等场景下触发，导致浮窗在文件导入等操作中途被误关。
        // 浮窗改为仅通过再次点击插件、关闭按钮或 close-extension-web-panel 关闭。
        try { view.webContents.focus(); } catch (_) {}
      }
      return { ok: true };
    } catch (error) {
      closeWebPanel({ notify: true });
      logger.warn?.('[Extensions] 加载网页插件浮窗失败:', plugin.name, error?.message || error);
      return { ok: false, message: error?.message || String(error) };
    }
  }

  function isPluginEnabled(pluginId) {
    return getPluginById(pluginId)?.enabled === true;
  }

  return {
    BUILTIN_TRANSLATE_ID,
    BUILTIN_REMOVE_WATERMARK_ID,
    initialize,
    getPublicState,
    getEnabledExtensionPaths,
    loadEnabledIntoSession,
    ensureEnabledPluginsLoadedInCurrentSessions,
    setPluginEnabled,
    removePlugin,
    openExtensionPopup: (pluginId) => openExtensionPage(pluginId, 'popup'),
    openExtensionOptions: (pluginId) => openExtensionPage(pluginId, 'options'),
    closeWebPanel,
    syncWebPanelBounds,
    isPluginEnabled,
  };
}

module.exports = {
  createExtensionManager,
  COMPAT_SHIM_FILE,
  sanitizeManifestPermissionsForElectron,
};
