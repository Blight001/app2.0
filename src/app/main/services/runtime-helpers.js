// 创建/初始化：createRuntimeHelpers的具体业务逻辑。
function createRuntimeHelpers(deps = {}) {
  const {
    app,
    fs,
    path,
    logger = console,
    getHardwareFingerprint,
    getTranslateExtDirCandidates,
  } = deps;

// 获取/读取/解析：resolveTranslateExtCandidates的具体业务逻辑。
  function resolveTranslateExtCandidates() {
    const candidates = [];

    // 打包后优先找解包资源目录，避免指向 app.asar 内部导致 loadExtension 失败。
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', 'extensions', 'transform'));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'extensions', 'transform'));
      candidates.push(path.join(process.resourcesPath, 'src', 'assets', 'extensions', 'transform'));
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'src', 'assets', 'extensions', 'transform'));
    }

    if (app && typeof app.getAppPath === 'function') {
      const appPath = app.getAppPath();
      candidates.push(path.join(appPath, 'src', 'assets', 'extensions', 'transform'));
      candidates.push(path.join(appPath, 'assets', 'extensions', 'transform'));
    }

    candidates.push(path.join(__dirname, '../../../assets/extensions/transform'));

    const seen = new Set();
    return candidates.filter((candidate) => {
      const normalized = path.normalize(candidate);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

// 获取/读取/解析：getTranslateExtDir的具体业务逻辑。
  function getTranslateExtDir() {
    const candidates = typeof getTranslateExtDirCandidates === 'function'
      ? getTranslateExtDirCandidates()
      : resolveTranslateExtCandidates();
    for (const dir of candidates) {
      try {
        if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
      } catch (_) {}
    }
    logger.warn?.('[TranslateExt] 未找到可加载的扩展目录，候选路径如下:', candidates);
    return candidates[0] || path.join(__dirname, '../../../assets/extensions/transform');
  }

// 获取/读取/解析：loadTranslateExtension的具体业务逻辑。
  async function loadTranslateExtension(session, label = '') {
    const extDir = getTranslateExtDir();
    if (!session || !session.extensions || !session.extensions.loadExtension) {
      return;
    }

    try {
      const ext = await session.extensions.loadExtension(extDir, { allowFileAccess: true });
      try { session.__translateExtId = ext && ext.id; } catch (_) {}
      logger.log?.('[TranslateExt] 扩展已加载', label ? `(${label})` : '', ext && ext.name, ext && ext.id);
    } catch (error) {
      const msg = error && (error.message || String(error));
      if (msg && /already loaded|exists/i.test(msg)) {
        try {
          const all = session.getAllExtensions ? session.getAllExtensions() : null;
          const list = all ? Object.values(all) : [];
          if (list && list.length > 0) {
            const ext = list[0];
            try { session.__translateExtId = ext && ext.id; } catch (_) {}
            logger.log?.('[TranslateExt] 会话中已存在扩展', label ? `(${label})` : '', ext && ext.name, ext && ext.id);
            return;
          }
        } catch (e2) {
          logger.warn?.('[TranslateExt] 读取已加载扩展失败:', e2?.message || e2);
        }
      }
      logger.warn?.('[TranslateExt] 扩展加载失败', label ? `(${label})` : '', msg);
    }
  }

// 处理：computeDeviceId的具体业务逻辑。
  async function computeDeviceId() {
    try {
      const fingerprint = await getHardwareFingerprint();
      return fingerprint.slice(0, 20).toUpperCase();
    } catch (e) {
      logger.error?.('获取设备号失败:', e);
      return '获取失败';
    }
  }

  return {
    getTranslateExtDir,
    loadTranslateExtension,
    computeDeviceId,
  };
}

module.exports = {
  createRuntimeHelpers,
};
