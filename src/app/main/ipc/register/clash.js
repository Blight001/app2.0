
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const {
  CLASH_MINI_DIR_NAME,
  copyDirectoryRecursive,
  extractDirectClashConfigContent,
  getClashMiniRuntimeRoot,
  getClashMiniStatus,
  importDirectClashRuntimeConfig,
  prepareClashMiniRuntimeDirAsync,
  resolveClashMiniCoreDir,
  setRuntimeLicenseCache,
  startClashMiniProcess,
  stopClashMiniProcess,
  invokeClashMiniControl,
} = require('./clash-mini-core');
const { httpGetUniversal } = require('../../lib/http');
const { getServerBase } = require('../../config');
const {
  getClashMiniProxyGroupOptions,
  switchClashMiniProxyNode,
  testClashMiniLowestLatency,
} = require('./clash-mini-actions');
const { createProxyTrafficMonitor } = require('./proxy-traffic-monitor');

function registerClashIPC(ctx) {
  const ipc = ctx.ipc.scope('register/clash');
  const { httpClient, ui, licenseCache, computeDeviceId } = ctx;
  try {
    if (typeof setRuntimeLicenseCache === 'function') {
      setRuntimeLicenseCache(licenseCache);
    }
  } catch (_) {}

  const readCredentials = () => (
    licenseCache && typeof licenseCache.getCredentials === 'function'
      ? licenseCache.getCredentials()
      : {}
  );
  const restoreDirectBrowserProxyAfterFailedStart = async () => {
    const status = getClashMiniStatus();
    if (status?.running === true || typeof ui?.applyClashMiniBrowserProxy !== 'function') return null;
    return Promise.resolve(ui.applyClashMiniBrowserProxy(false)).catch(() => null);
  };
  const trafficMonitor = createProxyTrafficMonitor({
    httpClient,
    ui,
    readCredentials,
    readTotals: async () => invokeClashMiniControl(getClashMiniRuntimeRoot(), 'get', '/connections', { timeoutMs: 5000 }),
    onExhausted: async (quota) => {
      ui?.sendToSide?.('proxy-traffic-exhausted', quota || {});
      await stopClashMiniProcess(ui);
    },
    onUnavailable: async (error) => {
      const message = `Mihomo 控制端口不可用：${error?.message || error || '连接失败'}`;
      await stopClashMiniProcess(ui);
      ui?.sendToSide?.('clash-mini-runtime-failed', { message });
    },
  });

  ipc.handle('start-clash-mini', async (_event, options = {}) => {
    try {
      const authorization = await trafficMonitor.authorize();
      if (!authorization?.ok) {
        await restoreDirectBrowserProxyAfterFailedStart();
        return authorization || { ok: false, error: '流量额度校验失败' };
      }
      const result = await startClashMiniProcess(ui, options || {});
      if (result?.ok) {
        trafficMonitor.start();
      } else {
        await restoreDirectBrowserProxyAfterFailedStart();
      }
      return { ...result, quota: authorization.quota || null };
    } catch (error) {
      await restoreDirectBrowserProxyAfterFailedStart();
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipc.handle('test-min-latency', async (_event, options = {}) => {
    try {
      return await testClashMiniLowestLatency(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipc.handle('get-clash-mini-proxy-options', async (_event, options = {}) => {
    try {
      return await getClashMiniProxyGroupOptions(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error), running: false, names: [], current: '' };
    }
  });

  ipc.handle('switch-clash-mini-proxy', async (_event, options = {}) => {
    try {
      return await switchClashMiniProxyNode(ui, options || {});
    } catch (error) {
      return { ok: false, error: error?.message || String(error), running: false };
    }
  });

  ipc.handle('get-clash-mini-status', async () => {
    try {
      return getClashMiniStatus();
    } catch (error) {
      return { ok: false, error: error?.message || String(error), running: false };
    }
  });

  ipc.handle('stop-clash-mini', async () => {
    try {
      await trafficMonitor.stop();
      return await stopClashMiniProcess(ui);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipc.handle('get-proxy-traffic-quota', async () => {
    try {
      const credentials = readCredentials();
      const key = String(credentials?.key || '').trim();
      const deviceId = String(await computeDeviceId() || '').trim();
      if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
      return await httpClient.getProxyTrafficQuota(key, deviceId);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipc.handle('redeem-proxy-traffic-gift-code', async (_event, input = {}) => {
    try {
      const credentials = readCredentials();
      const key = String(credentials?.key || '').trim();
      const deviceId = String(await computeDeviceId() || '').trim();
      const code = String(input.code || '').trim();
      if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
      if (!code) return { ok: false, message: '请输入流量礼品码' };
      const result = await httpClient.redeemProxyTrafficGiftCode(key, deviceId, code);
      if (result?.quota) ui?.sendToSide?.('proxy-traffic-quota', result.quota);
      return result;
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });

  ipc.handle('ensure-clash-config-dir', async () => {
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

  ipc.handle('get-clash-config', async (_event, { key, deviceId }) => {
    try {
      console.log('[IPC] 获取Clash配置...');
      const result = await httpClient.getClientConfig(key, deviceId);
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

  ipc.handle('stop-clash-service', async () => {
    console.log('[IPC] 关闭Clash服务，手动停止');
    return stopClashMiniProcess(ui);
  });

  ipc.handle('save-clash-config', async (_event, payload = {}) => {
    try {
      const runtimePrep = await prepareClashMiniRuntimeDirAsync();
      if (!runtimePrep.ok) {
        console.error('[IPC] Clash Mini 运行目录准备失败:', runtimePrep.error || 'unknown');
        return { ok: false, error: runtimePrep.error || '未找到 Clash Mini core 目录' };
      }
      const coreDir = runtimePrep.runtimeDir;

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

      if (Array.isArray(imported.purgeResult?.failed) && imported.purgeResult.failed.length > 0) {
        console.warn('[IPC] Clash 旧运行配置清理未完全成功:', imported.purgeResult.failed.join(', '));
      }
      const generatedContentLength = String(imported.generatedContent || '').length;
      console.log(
        `[IPC] Clash 配置导入完成: source=${imported.source || 'unknown'}, length=${generatedContentLength}, path=${imported.runtimeConfigPath}`,
      );
      return {
        ok: true,
        configPath: imported.runtimeConfigPath,
        runtimeConfigPath: imported.runtimeConfigPath,
        source: imported.source,
        directImport: true,
        refreshed: imported.refreshed === true,
        generatedContentLength,
      };
    } catch (error) {
      console.error('[IPC] 直接导入 Clash Mini 配置失败:', error);
      return { ok: false, error: error.message || String(error) };
    }
  });
}

module.exports = { registerClashIPC };
