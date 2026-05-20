function mergeRuntimeConfig(baseConfig = {}, runtimeConfig = {}) {
    const merged = {
        ...(baseConfig && typeof baseConfig === 'object' ? baseConfig : {}),
        ...(runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {})
    };

    const baseBrowserSettings = baseConfig && typeof baseConfig.browserSettings === 'object'
        ? { ...baseConfig.browserSettings }
        : {};
    const runtimeBrowserSettings = runtimeConfig && typeof runtimeConfig.browserSettings === 'object'
        ? runtimeConfig.browserSettings
        : {};

    merged.browserSettings = {
        ...baseBrowserSettings,
        ...runtimeBrowserSettings
    };
    delete merged.browserSettings.browserType;
    delete merged.browserSettings.browserSource;
    delete merged.browserSettings.browser_region;
    delete merged.browserSettings.browserLocale;
    delete merged.browserSettings.browserTimezoneId;
    delete merged.browserSettings.headlessMode;
    delete merged.browserSettings.dynamicFingerprint;
    delete merged.browserSettings.blockImagesVideos;
    delete merged.browserSettings.syncExecution;
    delete merged.browserSettings.maxProxyRecoveryAttempts;
    delete merged.browserSettings.registrationAutoUpload;
    delete merged.browserSettings.saveLocalCookie;
    delete merged.browserSettings.skipCookieSave;
    delete merged.browserSettings.skip_cookie_save;
    delete merged.browserSettings.concurrentCount;
    delete merged.browserSettings.runMode;
    delete merged.browserSettings.timedRegistrationCount;
    delete merged.browserSettings.timedRegistrationCycleCount;
    delete merged.browserSettings.timedRegistrationStartMode;
    delete merged.browserSettings.timedRegistrationDelaySeconds;
    delete merged.browser_settings;

    return merged;
}

module.exports = function registerRuntimeConfigHandlers({ app, ipcMain }) {
    ipcMain.handle('get-registration-runtime-config', async () => {
        try {
            const cookieConfig = typeof app.readCookieUserConfigFromDisk === 'function'
                ? await app.readCookieUserConfigFromDisk()
                : {};
            const runtimeConfig = typeof app.readRegistrationRuntimeConfigFromDisk === 'function'
                ? await app.readRegistrationRuntimeConfigFromDisk()
                : {};

            return {
                success: true,
                config: mergeRuntimeConfig(cookieConfig, runtimeConfig)
            };
        } catch (error) {
            app.logger.error(`获取运行配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-registration-runtime-config', async (_event, config) => {
        try {
            const normalizedConfig = config && typeof config === 'object' ? { ...config } : {};
            const saveResult = typeof app.saveRegistrationRuntimeConfigToDisk === 'function'
                ? await app.saveRegistrationRuntimeConfigToDisk(normalizedConfig)
                : { success: false, error: '运行配置保存接口不可用' };

            if (saveResult.success === false) {
                return saveResult;
            }

            if (normalizedConfig.browserSettings && typeof app.saveBrowserSettingsToConfig === 'function') {
                const browserSaveResult = await app.saveBrowserSettingsToConfig(normalizedConfig.browserSettings, {
                    source: 'save-registration-runtime-config'
                });

                if (browserSaveResult && browserSaveResult.success === false) {
                    return {
                        success: false,
                        error: browserSaveResult.error || '保存浏览器设置失败'
                    };
                }
            }

            return {
                success: true,
                configPath: saveResult.configPath || ''
            };
        } catch (error) {
            app.logger.error(`保存运行配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
