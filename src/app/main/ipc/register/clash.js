const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const {
  CLASH_MINI_DIR_NAME,
  copyDirectoryRecursive,
  detectNetworkMagicStatus,
  extractDirectClashConfigContent,
  getClashMiniRuntimeRoot,
  getClashMiniStatus,
  importDirectClashRuntimeConfig,
  prepareClashMiniRuntimeDir,
  resolveClashMiniCoreDir,
  startClashMiniProcess,
  stopClashMiniProcess,
} = require('./clash-mini-core');
const { httpGetUniversal } = require('../../lib/http');
const { getServerBase } = require('../../config');
const {
  getClashMiniProxyGroupOptions,
  switchClashMiniProxyNode,
  testClashMiniLowestLatency,
} = require('./clash-mini-actions');

// 监听/绑定：registerClashIPC的具体业务逻辑。
function registerClashIPC(ctx) {
  const { tcp, ui, licenseCache } = ctx;
  try {
    if (typeof setRuntimeLicenseCache === 'function') {
      setRuntimeLicenseCache(licenseCache);
    }
  } catch (_) {}

  ipcMain.handle('start-clash-mini', async (_event, options = {}) => {
    try {
      return await startClashMiniProcess(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('test-min-latency', async (_event, options = {}) => {
    try {
      return await testClashMiniLowestLatency(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('get-clash-mini-proxy-options', async (_event, options = {}) => {
    try {
      return await getClashMiniProxyGroupOptions(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error), running: false, names: [], current: '' };
    }
  });

  ipcMain.handle('switch-clash-mini-proxy', async (_event, options = {}) => {
    try {
      return await switchClashMiniProxyNode(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error), running: false };
    }
  });

  ipcMain.handle('get-clash-mini-status', async () => {
    try {
      return getClashMiniStatus();
    } catch (error) {
      return { ok: false, error: error?.message || String(error), running: false };
    }
  });

  ipcMain.handle('stop-clash-mini', async () => {
    try {
      return await stopClashMiniProcess(ui);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('ensure-clash-config-dir', async () => {
    try {
      console.log('[IPC] 检查 Clash Mini 配置目录是否存在...');

      const runtimeRoot = getClashMiniRuntimeRoot();
      const appDataPath = path.dirname(runtimeRoot);
      const clashConfigDir = runtimeRoot;
      const clashConfigDirOld = path.join(appDataPath, `${CLASH_MINI_DIR_NAME}-old`);

      console.log('[IPC] Clash Mini 配置目录路径:', clashConfigDir);

      const clashSourceDir = resolveClashMiniCoreDir();
      console.log('[IPC] Clash Mini 配置源目录路径:', clashSourceDir);
      if (!clashSourceDir || !fs.existsSync(clashSourceDir)) {
        console.error('[IPC] Clash Mini 配置源目录不存在:', clashSourceDir);
        return { ok: false, error: `源目录不存在: ${clashSourceDir}` };
      }

      const configDirExists = fs.existsSync(clashConfigDir);
      if (path.resolve(clashConfigDir) === path.resolve(clashSourceDir)) {
        fs.mkdirSync(clashConfigDir, { recursive: true });
        console.log('[IPC] Clash Mini 运行目录已直接指向源码 core，跳过复制');
        return { ok: true, exists: configDirExists, needRestore: false, path: clashConfigDir, copied: false, direct: true };
      }

      if (configDirExists) {
        console.log('[IPC] Clash Mini 配置目录已存在，进行备份替换...');
        fs.mkdirSync(clashConfigDirOld, { recursive: true });
        copyDirectoryRecursive(clashConfigDir, clashConfigDirOld, { overwrite: true });
        console.log('[IPC] 已备份当前配置到old目录');
      }

      fs.mkdirSync(clashConfigDir, { recursive: true });
      copyDirectoryRecursive(clashSourceDir, clashConfigDir, { overwrite: true });

      console.log('[IPC] Clash Mini 配置目录复制完成:', clashConfigDir);
      return { ok: true, exists: configDirExists, needRestore: configDirExists, path: clashConfigDir, copied: true };
    } catch (error) {
      console.error('[IPC] 确保 Clash Mini 配置目录存在失败:', error);
      return { ok: false, error: error.message || String(error) };
    }
  });

  ipcMain.handle('get-clash-config', async (_event, { key, deviceId }) => {
    try {
      console.log('[IPC] 获取Clash配置...');
      const result = await tcp.getClientConfig(key, deviceId);
// 格式化/规范化：normalizeYamlContent的具体业务逻辑。
      const normalizeYamlContent = (value) => {
        if (!value) return '';
        if (typeof value === 'string') {
          return value.replace(/^\uFEFF/, '').trim();
        }
        if (typeof value === 'object') {
          try {
            return YAML.stringify(value).replace(/^\uFEFF/, '').trim();
          } catch (_) {
            return '';
          }
        }
        return '';
      };

      const profilesYamlContent = normalizeYamlContent(result?.profiles_yaml_content);
      const yamlContent =
        normalizeYamlContent(result?.yaml_content)
        || normalizeYamlContent(result?.content)
        || normalizeYamlContent(result?.configContent);
      const redYamlContent = normalizeYamlContent(result?.red_yaml_content);

      let directConfigContent =
        profilesYamlContent
        || yamlContent
        || redYamlContent
        || extractDirectClashConfigContent(result);
      let source = 'empty';
      if (profilesYamlContent) {
        source = 'profiles-yaml';
      } else if (yamlContent) {
        source = 'yaml-content';
      } else if (redYamlContent) {
        source = 'red-yaml';
      } else if (directConfigContent) {
        source = 'extracted';
      }
// 处理：previewText的具体业务逻辑。
      const previewText = (value, maxLen = 220) => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
      };
// 处理：decodeBase64Preview的具体业务逻辑。
      const decodeBase64Preview = (value, maxLen = 220) => {
        const raw = String(value || '').replace(/\s+/g, '').trim();
        if (!raw || raw.length < 32 || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(raw)) {
          return '';
        }
        try {
          const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
          if (!decoded || /[\uFFFD]/.test(decoded)) return '';
          return decoded.length > maxLen ? `${decoded.slice(0, maxLen)}...` : decoded;
        } catch (_) {
          return '';
        }
      };

      console.log('[IPC] Clash配置摘要:', JSON.stringify({
        ok: !!result?.ok,
        accountType: result?.account_type || result?.accountType || '',
        accountTypeLabel: result?.account_type_label || result?.accountTypeLabel || '',
        expire_at: result?.expire_at || '',
        days_left: result?.days_left,
        proxySubscriptionUrl: String(result?.proxy_subscription_url || result?.proxySubscriptionUrl || '').trim(),
        contentLength: String(directConfigContent || '').length,
        source,
        preview: previewText(directConfigContent),
        decodedPreview: decodeBase64Preview(directConfigContent),
      }, null, 2));

      return {
        ok: !!result?.ok,
        content: directConfigContent,
        contentSource: source,
        contentLength: String(directConfigContent || '').length,
        proxySubscriptionUrl: result?.proxy_subscription_url || '',
        profilesYamlContent,
        redYamlContent,
        accountType: result?.account_type || result?.accountType || '',
        accountTypeLabel: result?.account_type_label || result?.accountTypeLabel || '',
        expire_at: result?.expire_at || '',
        days_left: result?.days_left,
      };
    } catch (error) {
      console.error('[IPC] 获取Clash配置失败:', error);
      return { ok: false, error: error.message || String(error) };
    }
  });

  ipcMain.handle('check-clash-client', async () => {
    try {
      console.log('[IPC] 开始检测 Clash 客户端状态（检测是否已有正在运行的 Clash）...');
      const status = await detectNetworkMagicStatus();
      console.log('[IPC] 本地 Clash 进程:', Array.isArray(status.matchedProcesses) && status.matchedProcesses.length > 0 ? status.matchedProcesses.join(', ') : '无');
      console.log(`[IPC] Clash 客户端检测结果: ${status.runningClashClient ? '检测到运行中的 Clash 客户端' : '未检测到运行中的 Clash 客户端'}`);
      return status.runningClashClient === true;
    } catch (error) {
      console.error('[IPC] 检测 Clash 客户端进程失败:', error);
      return false;
    }
  });

  ipcMain.handle('stop-clash-service', async () => {
    console.log('[IPC] 关闭Clash服务，手动停止');
    return stopClashMiniProcess(ui);
  });

  ipcMain.handle('save-clash-config', async (_event, payload = {}) => {
    try {
      console.log('[IPC] 开始导入 Clash Mini 默认配置...');

      const runtimePrep = prepareClashMiniRuntimeDir();
      if (!runtimePrep.ok) {
        console.error('[IPC] Clash Mini 运行目录准备失败:', runtimePrep.error || 'unknown');
        return { ok: false, error: runtimePrep.error || '未找到 Clash Mini core 目录' };
      }
      const coreDir = runtimePrep.runtimeDir;
      console.log('[IPC] Clash Mini 运行目录已准备:', coreDir);

      const {
        clashConfig,
        configContent,
        profiles,
        subscriptionUrl,
        yamlContent,
        yaml_content,
        content,
      } = payload || {};

      const sourcePayload = clashConfig || configContent || profiles || yamlContent || yaml_content || content;

// 获取/读取/解析：resolveSubscriptionUrl的具体业务逻辑。
      const resolveSubscriptionUrl = (value) => {
        const raw = String(value || '').trim();
        if (!raw) {
          return '';
        }

        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
          return raw;
        }

        const base = String(getServerBase() || '').trim();
        if (!base) {
          return raw;
        }

        try {
          return new URL(raw, base.endsWith('/') ? base : `${base}/`).toString();
        } catch (_) {
          return raw;
        }
      };

// 获取/读取/解析：fetchSubscriptionContent的具体业务逻辑。
      const fetchSubscriptionContent = async (url) => {
        const targetUrl = resolveSubscriptionUrl(url);
        if (!targetUrl) {
          return '';
        }

        console.log('[IPC] 直接配置导入失败，开始尝试订阅链接:', targetUrl);
        const resp = await httpGetUniversal(targetUrl, 15000);
        if (!resp || resp.ok !== true) {
          throw new Error(`订阅链接请求失败: ${resp?.status || 'unknown'}`);
        }

        const extracted = extractDirectClashConfigContent(resp.body) || extractDirectClashConfigContent(resp.raw);
        return String(extracted || resp.raw || '').trim();
      };

      let imported = null;
      if (sourcePayload) {
        imported = importDirectClashRuntimeConfig(coreDir, sourcePayload, 'server-config');
      }

      if (!imported || !imported.ok) {
        if (imported && !imported.ok) {
          console.error('[IPC] 导入 Clash 运行配置失败，原始内容如下:');
          console.error(imported.rawContent || sourcePayload || '');
        }

        if (subscriptionUrl) {
          try {
            const subscriptionContent = await fetchSubscriptionContent(subscriptionUrl);
            if (subscriptionContent) {
              imported = importDirectClashRuntimeConfig(coreDir, subscriptionContent, 'subscription-url');
            } else {
              imported = { ok: false, error: '订阅链接返回空内容', rawContent: '' };
            }
          } catch (fetchError) {
            console.error('[IPC] 获取订阅链接内容失败:', fetchError?.message || fetchError);
            imported = {
              ok: false,
              error: fetchError?.message || String(fetchError),
              rawContent: sourcePayload || '',
            };
          }
        } else if (!sourcePayload) {
          return { ok: false, error: '缺少可导入的 Clash 配置内容' };
        }
      }

      if (!imported || !imported.ok) {
        return imported || { ok: false, error: '导入 Clash 配置失败' };
      }

      if (imported.purgeResult) {
        console.log('[IPC] Clash 运行配置已硬刷新:', JSON.stringify(imported.purgeResult, null, 2));
      }
      if (imported.generatedPreview) {
        console.log('[IPC] Clash 运行配置内容预览:', imported.generatedPreview);
      }
      if (imported.generatedContent) {
        console.log('[IPC] Clash 运行配置内容长度:', String(imported.generatedContent).length);
      }
      console.log('[IPC] 已直接导入 Clash 运行配置:', imported.runtimeConfigPath);
      return {
        ok: true,
        configPath: imported.runtimeConfigPath,
        runtimeConfigPath: imported.runtimeConfigPath,
        source: imported.source,
        directImport: true,
        refreshed: imported.refreshed === true,
        generatedPreview: imported.generatedPreview || '',
        generatedContentLength: String(imported.generatedContent || '').length,
      };
    } catch (error) {
      console.error('[IPC] 直接导入 Clash Mini 配置失败:', error);
      return { ok: false, error: error.message || String(error) };
    }
  });
}

module.exports = { registerClashIPC };
