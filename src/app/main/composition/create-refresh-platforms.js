// 平台/羊毛/目标地址/教程地址运行时刷新（阶段 2D-3，自 bootstrap.js 原样迁出）。
// 依赖 tabManager 的 syncTutorialTabUrl 晚绑定，经 getSyncTutorialTabUrl 访问。
'use strict';

function createRefreshAllowedPlatformsAndNotify({
  licenseCache,
  appRuntime,
  sendToSide,
  setDreamTargetUrl,
  getSyncTutorialTabUrl,
  updateLicenseRecordPlatform,
  normalizeValidationRuntimeConfig,
}) {
  let platformRefreshInFlight = false;

  return async function refreshAllowedPlatformsAndNotify() {
    if (platformRefreshInFlight) return;
    platformRefreshInFlight = true;
    try {
      const runtimeConfig = licenseCache && typeof licenseCache.getRuntimeConfig === 'function'
        ? licenseCache.getRuntimeConfig()
        : {};
      const normalized = normalizeValidationRuntimeConfig(runtimeConfig);
      const allowedPlatforms = Array.isArray(normalized.allowedPlatforms) ? normalized.allowedPlatforms : [];
      const woolPlatforms = Array.isArray(normalized.woolPlatforms) ? normalized.woolPlatforms : [];
      const platformName = String(normalized.platformName || allowedPlatforms[0] || '').trim();
      const targetUrl = String(normalized.targetUrl || '').trim();
      const tutorialUrl = String(normalized.tutorialUrl || '').trim();
      if (!platformName && allowedPlatforms.length === 0 && !targetUrl && !tutorialUrl) {
        return;
      }
      appRuntime.setLatestAllowedPlatforms(allowedPlatforms);
      try {
        if (licenseCache && typeof licenseCache.setRuntimeConfig === 'function') {
          licenseCache.setRuntimeConfig({
            allowedPlatforms,
            woolPlatforms,
            platformName,
          });
        }
      } catch (e) {
        console.warn('[启动] 保存平台列表失败:', e?.message || e);
      }
      if (targetUrl) {
        try {
          setDreamTargetUrl(targetUrl);
          sendToSide('target-url-updated', { targetUrl });
        } catch (e) {
          console.warn('[启动] 同步目标地址失败:', e?.message || e);
        }
      }
      if (tutorialUrl) {
        try {
          sendToSide('tutorial-url-updated', { tutorialUrl });
          const syncTutorialTabUrl = getSyncTutorialTabUrl();
          if (typeof syncTutorialTabUrl === 'function') {
            await syncTutorialTabUrl(tutorialUrl);
          }
        } catch (e) {
          console.warn('[启动] 同步教程地址失败:', e?.message || e);
        }
      }
      sendToSide('platform-name-updated', { platformName, allowedPlatforms, woolPlatforms });
      sendToSide('wool-platforms-updated', { woolPlatforms });
      try {
        const currentKey = String(licenseCache?.getCredentials?.().key || '').trim();
        if (currentKey && typeof updateLicenseRecordPlatform === 'function') {
          const recordUpdate = updateLicenseRecordPlatform({
            keyValue: currentKey,
            platformName,
          });
          if (recordUpdate) {
            const licenseWindow = appRuntime.getLicenseWindow();
            if (licenseWindow && !licenseWindow.isDestroyed()) {
              licenseWindow.webContents.send('license-records-updated', {
                keyValue: currentKey,
                platformName,
              });
            }
          }
        }
      } catch (e) {
        console.warn('[启动] 回填卡密平台失败:', e?.message || e);
      }
      console.log('[启动] 平台名称已刷新并通知侧边栏:', platformName);
    } catch (e) {
      console.warn('[启动] 刷新平台名称失败:', e?.message || e);
    } finally {
      platformRefreshInFlight = false;
    }
  };
}

module.exports = { createRefreshAllowedPlatformsAndNotify };
