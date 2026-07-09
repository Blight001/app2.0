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
const POPUP_DEFAULT_SIZE = { width: 360, height: 420 };
const OPTIONS_DEFAULT_SIZE = { width: 560, height: 620 };

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
    } catch (_) {}
  }

  async function initialize() {
    const stored = readStoredState();
    const storedPlugins = stored.plugins
      .map(normalizeStoredPlugin)
      .filter((plugin) => plugin && plugin.id);
    const storedById = new Map(storedPlugins.map((plugin) => [plugin.id, plugin]));
    const storedByPath = new Map(storedPlugins.map((plugin) => [normalizeAbsolutePath(plugin.path), plugin]));
    const bundledPlugins = [];
    const seenIds = new Set();

    for (const dir of collectBundledExtensionDirs()) {
      try {
        const id = getBundledExtensionId(dir);
        const existing = storedById.get(id) || storedByPath.get(normalizeAbsolutePath(dir)) || {};
        const record = buildPluginRecord(dir, existing, getBundledExtensionOverrides(dir, existing));
        if (seenIds.has(record.id)) continue;
        seenIds.add(record.id);
        bundledPlugins.push(record);
      } catch (error) {
        logger.warn?.('[Extensions] 初始化目录插件失败:', dir, error?.message || error);
      }
    }

    state = {
      developerModeEnabled: true,
      plugins: bundledPlugins,
    };
    persistState();
    syncLegacyTranslateSetting();
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
      const extension = await session.extensions.loadExtension(plugin.path, { allowFileAccess: true });
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
    const minHeight = Math.min(pageType === 'options' ? 300 : 180, maxContentHeight);

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
          const bodyRect = body ? body.getBoundingClientRect() : { width: 0, height: 0 };
          const width = Math.ceil(Math.max(
            doc ? doc.scrollWidth : 0,
            doc ? doc.offsetWidth : 0,
            body ? body.scrollWidth : 0,
            body ? body.offsetWidth : 0,
            bodyRect.width || 0
          ));
          const height = Math.ceil(Math.max(
            doc ? doc.scrollHeight : 0,
            doc ? doc.offsetHeight : 0,
            body ? body.scrollHeight : 0,
            body ? body.offsetHeight : 0,
            bodyRect.height || 0
          ));
          return { width, height };
        })()
      `, true);
      return normalizePanelContentSize(measured || {}, pageType);
    } catch (error) {
      logger.warn?.('[Extensions] 测量插件浮窗尺寸失败:', error?.message || error);
      return normalizePanelContentSize({}, pageType);
    }
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
      const measuredSize = await measureWebPanelContent(view, pageType);
      if (webPanel?.view === view) {
        webPanel.contentWidth = measuredSize.width;
        webPanel.contentHeight = measuredSize.height;
      }
      syncWebPanelBounds();
      if (pageType === 'popup') {
        try {
          view.webContents.once('blur', () => {
            if (webPanel?.view === view) {
              closeWebPanel({ notify: true });
            }
          });
          view.webContents.focus();
        } catch (_) {}
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
    loadEnabledIntoSession,
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
};
