const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const http = require('http');
const https = require('https');

const HaikaManager = require('../haika/haika-manager');
const HaikaStateStore = require('../haika/haika-state-store');
const registerLoginIpcHandlers = require('../ipc/login-ipc');
const registerWebLoginHandlers = require('../ipc/login-web-ipc');
const {
    extractLicenseExpiryText,
    extractLicenseUsageInfo,
    parseLicenseExpiryTimestamp
} = require('../infra/license-utils');
const {
    clearChunkedTimeout,
    createChunkedTimeout
} = require('../infra/timeout-utils');

function isDevModeEnabled() {
    const argv = Array.isArray(process.argv) ? process.argv : [];
    return process.env.DEV_MODE === '1' ||
        process.env.DEV_MODE === 'true' ||
        argv.includes('--dev-mode');
}

function openDetachedDevTools(targetWindow) {
    if (!targetWindow || (typeof targetWindow.isDestroyed === 'function' && targetWindow.isDestroyed())) {
        return;
    }

    const wc = targetWindow.webContents;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
        return;
    }

    if (typeof wc.isDevToolsOpened === 'function' && wc.isDevToolsOpened()) {
        try {
            if (wc.devToolsWebContents && typeof wc.devToolsWebContents.focus === 'function') {
                wc.devToolsWebContents.focus();
            }
        } catch (_) {}
        return;
    }

    wc.openDevTools({ mode: 'detach' });
}

module.exports = {
    isDevModeEnabled,

    setupLoginIpcHandlers() {
        if (this.loginIpcHandlersRegistered) {
            return;
        }

        registerLoginIpcHandlers({
            app: this,
            ipcMain
        });
        this.loginIpcHandlersRegistered = true;
    },

    setupWebLoginRpcHandlers() {
        if (this.webLoginRpcHandlersRegistered) {
            return;
        }

        registerWebLoginHandlers({
            app: this,
            ipcMain: this.rpcRegistry
        });
        this.webLoginRpcHandlersRegistered = true;
    },

    async createLoginWindow() {
        this.loginWindow = new BrowserWindow({
            width: 480,
            height: 520,
            resizable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            icon: path.join(this.projectRoot, 'src/ui/assets/icon.ico'),
            title: '卡密验证 - AI账号注册器 2.0'
        });

        this.setupLoginIpcHandlers();
        this.setupRpcHandlers();
        this.setupWebLoginRpcHandlers();
        this.loginWindow.loadFile(path.join(this.projectRoot, 'src/ui/login.html'));
        this.loginWindow.setAlwaysOnTop(true);

        if (this.webControlConfig?.enabled) {
            if (!this.webControlServer || !this.webControlServer.isRunning()) {
                await this.startWebControlServer();
            }
        }

        if (process.argv.includes('--dev') || process.argv.includes('--dev-mode') || this.devMode) {
            openDetachedDevTools(this.loginWindow);
        }

        this.loginWindow.on('closed', () => {
            this.loginWindow = null;
            if (!this.isValidated) {
                app.quit();
            }
        });

    },

    async showMainWindow() {
        if (this.mainUiStartupPromise) {
            return await this.mainUiStartupPromise;
        }

        this.mainUiStartupPromise = (async () => {
        this.setupIpcHandlers();
        this.setupRpcHandlers();
        this.setupWebLoginRpcHandlers();
        await this.ensureHaikaManager();
        await this.ensureHaikaStateStore();

        try {
            if (!this.startupUserConfigApplied) {
                await this.loadAndApplyUserConfig();
                this.startupUserConfigApplied = true;
            }
        } catch (configError) {
            this.logger.warning(`加载初始运行配置失败: ${configError.message}`);
        }

        try {
            await this.startRegistrationTcpConnectionMonitor({ immediate: true });
        } catch (tcpError) {
            this.logger.warning(`启动TCP连接监控失败: ${tcpError.message}`);
        }

        this.cookieManager.setLogger(this.logger);
        this.cardManager.setLogger(this.logger);
        await this.migrateCookieFormats();
        const webControlResult = await this.startWebControlServer();
        this.bindEmailClientUiEvents();

        if (this.webControlConfig?.headless) {
            this.mainWindow = this.headlessUiWindow;
            this.logger.mainWindow = this.mainWindow;
            if (this.browserManager && typeof this.browserManager.setMainWindow === 'function') {
                this.browserManager.setMainWindow(this.mainWindow);
            }
            this.cookieTester.setMainWindow(this.mainWindow);
            Menu.setApplicationMenu(null);

            try {
                if (this.emailClient.setLogger) this.emailClient.setLogger(this.logger);
                this.logger.info(`尝试自动连接邮箱: ${this.emailClient.serverHost}:${this.emailClient.serverPort}`);
                void this.emailClient.connect().catch((error) => {
                    this.logger.error(`自动连接邮箱失败: ${error.message}`);
                    this.emitUiEvent('email-log', { level: 'error', message: `❌ 自动连接邮箱失败: ${error.message}` });
                    this.emitUiEvent('email-disconnected');
                });
            } catch (error) {
                this.logger.error(`自动连接邮箱失败: ${error.message}`);
                this.emitUiEvent('email-log', { level: 'error', message: `❌ 自动连接邮箱失败: ${error.message}` });
                this.emitUiEvent('email-disconnected');
            }
            return;
        }

        this.createWindow();
        this.setupMenu();
        })();

        try {
            return await this.mainUiStartupPromise;
        } finally {
            this.mainUiStartupPromise = null;
        }
    },

    async ensureHaikaManager() {
        if (!this.haikaManager) {
            this.haikaManager = new HaikaManager({ logger: this.logger });
        } else {
            this.haikaManager.setLogger(this.logger);
        }

        await this.haikaManager.initialize();
        return this.haikaManager;
    },

    async ensureHaikaStateStore() {
        if (!this.haikaStateStore) {
            this.haikaStateStore = new HaikaStateStore({ logger: this.logger });
        } else if (typeof this.haikaStateStore.setLogger === 'function') {
            this.haikaStateStore.setLogger(this.logger);
        }

        return this.haikaStateStore;
    },

    async loadHaikaLatestState(options = {}) {
        const store = await this.ensureHaikaStateStore();
        return await store.buildSnapshot(options);
    },

    async saveHaikaLatestExchange(record = {}) {
        const store = await this.ensureHaikaStateStore();
        return await store.updateLatestExchange(record);
    },

    async saveHaikaLatestSmsRecord(record = {}) {
        const store = await this.ensureHaikaStateStore();
        return await store.updateLatestSmsRecord(record);
    },

    async getLatestHaikaSmsRecord(smsApiUrl) {
        const store = await this.ensureHaikaStateStore();
        return await store.getLatestSmsRecord(smsApiUrl);
    },

    async fetchHaikaSmsCode(smsApiUrl) {
        const targetUrl = new URL(smsApiUrl);
        const transport = targetUrl.protocol === 'https:' ? https : http;
        const stateStore = await this.ensureHaikaStateStore();
        let previousRecord = null;
        try {
            previousRecord = await stateStore.getLatestSmsRecord(smsApiUrl);
        } catch (recordError) {
            this.logger.warning(`读取上次海卡验证码记录失败: ${recordError.message}`);
        }

        return new Promise((resolve) => {
            const options = {
                protocol: targetUrl.protocol,
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: `${targetUrl.pathname}${targetUrl.search}`,
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': 'AI-Account-Register-2.0'
                }
            };

            const req = transport.request(options, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', async () => {
                    try {
                        const rawText = (data || '').trim();
                        let parsed = null;
                        const noCodeHint = /暂无验证码|no|none|null|nil|empty|未获取到验证码/i.test(rawText);

                        try {
                            parsed = rawText ? JSON.parse(rawText) : null;
                        } catch (error) {
                            parsed = null;
                        }

                        const codeCandidates = [];

                        const pushCandidate = (value) => {
                            if (value === null || value === undefined) return;
                            const text = String(value).trim();
                            if (!text) return;
                            if (/^(暂无验证码|no|none|null|nil|empty|未获取到验证码)$/i.test(text)) {
                                return;
                            }
                            codeCandidates.push(text);
                        };

                        pushCandidate(parsed?.code);
                        pushCandidate(parsed?.sms_code);
                        pushCandidate(parsed?.verification_code);
                        pushCandidate(parsed?.data?.code);
                        pushCandidate(parsed?.data?.sms_code);
                        pushCandidate(parsed?.data?.verification_code);

                        if (rawText.includes('|')) {
                            const pipeSegments = rawText.split('|').map(segment => segment.trim()).filter(Boolean);
                            if (pipeSegments.length >= 3) {
                                pushCandidate(pipeSegments[1]);
                            } else if (pipeSegments.length === 2) {
                                pushCandidate(pipeSegments[0]);
                                pushCandidate(pipeSegments[1]);
                            }
                        }

                        if (!noCodeHint) {
                            pushCandidate(rawText.match(/(?:验证码|verification[_\s-]*code|sms[_\s-]*code|code)[^\d]{0,20}(\d{4,8})/i)?.[1]);
                            pushCandidate(rawText.match(/\b\d{4,8}\b/)?.[0]);
                        }

                        const code = codeCandidates.length > 0 ? String(codeCandidates[0]) : '';
                        const isEmptyNotice = noCodeHint && !code;
                        const isDuplicate = !!(code && previousRecord && String(previousRecord.code || '').trim() === code);

                        if (code) {
                            try {
                                await stateStore.updateLatestSmsRecord({
                                    smsApiUrl,
                                    code,
                                    previousCode: previousRecord?.code || '',
                                    duplicate: isDuplicate,
                                    raw: parsed || rawText,
                                    statusCode: res.statusCode
                                });
                            } catch (saveError) {
                                this.logger.warning(`保存海卡验证码记录失败: ${saveError.message}`);
                            }
                        }

                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({
                                success: true,
                                code,
                                hasCode: !!code,
                                duplicate: isDuplicate,
                                previousCode: previousRecord?.code || '',
                                emptyNotice: isEmptyNotice,
                                raw: parsed || rawText,
                                statusCode: res.statusCode
                            });
                            return;
                        }

                        resolve({
                            success: false,
                            error: parsed?.message || parsed?.error || rawText || `请求失败 (${res.statusCode})`,
                            code,
                            hasCode: !!code,
                            duplicate: isDuplicate,
                            previousCode: previousRecord?.code || '',
                            emptyNotice: isEmptyNotice,
                            raw: parsed || rawText,
                            statusCode: res.statusCode
                        });
                    } catch (error) {
                        resolve({
                            success: false,
                            error: error.message || '验证码响应处理失败'
                        });
                    }
                });
            });

            req.on('error', (error) => {
                resolve({ success: false, error: error.message });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: '验证码接口请求超时' });
            });

            req.end();
        });
    },

    getConfigPath() {
        const isDev = !(app && typeof app.isPackaged === 'boolean' ? app.isPackaged : false);
        const resourceConfigPath = path.join('resource', 'config.json');
        const legacyConfigName = 'cookie_user_config.json';

        if (isDev) {
            return {
                installed: null,
                dev: path.join(process.cwd(), resourceConfigPath),
                legacyInstalled: null,
                legacyDev: path.join(process.cwd(), legacyConfigName),
                bundled: path.join(process.cwd(), resourceConfigPath)
            };
        } else {
            return {
                installed: path.join(app.getPath('userData'), resourceConfigPath),
                dev: null,
                legacyInstalled: path.join(path.dirname(process.resourcesPath), legacyConfigName),
                legacyDev: null,
                bundled: path.join(process.resourcesPath, resourceConfigPath)
            };
        }
    },

    getRuntimeConfigPath() {
        const isDev = !(app && typeof app.isPackaged === 'boolean' ? app.isPackaged : false);
        const bundledPath = path.join(isDev ? process.cwd() : process.resourcesPath, 'resource', 'config.json');
        const installedPath = isDev
            ? null
            : path.join(app.getPath('userData'), 'resource', 'config.json');

        return {
            installed: installedPath,
            dev: isDev ? bundledPath : null,
            bundled: isDev ? bundledPath : path.join(process.resourcesPath, 'resource', 'config.json')
        };
    },

    async ensureConfigPathReady() {
        const paths = this.getConfigPath();
        const targetPath = paths.dev || paths.installed;
        const legacyPath = paths.legacyDev || paths.legacyInstalled;
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        if (!(await fs.pathExists(targetPath)) && legacyPath && await fs.pathExists(legacyPath)) {
            await fs.move(legacyPath, targetPath, { overwrite: false });
            this.logger?.info?.(`已迁移后端配置到 resource 目录: ${legacyPath} -> ${targetPath}`);
        } else if (!(await fs.pathExists(targetPath)) && bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
            try {
                await fs.copy(bundledPath, targetPath);
                this.logger?.info?.(`已初始化后端配置: ${bundledPath} -> ${targetPath}`);
            } catch (copyError) {
                this.logger?.warning?.(`初始化后端配置失败: ${copyError.message}`);
            }
        }

        return paths;
    },

    async ensureRuntimeConfigPathReady() {
        const paths = this.getRuntimeConfigPath();
        const targetPath = paths.installed || paths.dev;
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        if (!(await fs.pathExists(targetPath)) && bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
            try {
                await fs.copy(bundledPath, targetPath);
                this.logger?.info?.(`已初始化运行配置: ${bundledPath} -> ${targetPath}`);
            } catch (copyError) {
                this.logger?.warning?.(`初始化运行配置失败: ${copyError.message}`);
            }
        }

        return paths;
    },

    async readRegistrationRuntimeConfigFromDisk() {
        try {
            const paths = await this.ensureRuntimeConfigPathReady();
            const preferredPath = paths.installed || paths.dev;
            const fallbackPath = paths.bundled && paths.bundled !== preferredPath ? paths.bundled : null;

            if (preferredPath && await fs.pathExists(preferredPath)) {
                return await fs.readJson(preferredPath);
            }

            if (fallbackPath && await fs.pathExists(fallbackPath)) {
                return await fs.readJson(fallbackPath);
            }

            return {};
        } catch (error) {
            this.logger?.warning?.(`读取运行配置失败: ${error.message}`);
            return {};
        }
    },

    async saveRegistrationRuntimeConfigToDisk(config = {}) {
        const paths = await this.ensureRuntimeConfigPathReady();
        const targetPath = paths.installed || paths.dev;
        if (!targetPath) {
            return { success: false, error: '运行配置路径不可用' };
        }

        const normalizedConfig = config && typeof config === 'object' ? { ...config } : {};
        let existingConfig = {};
        if (await fs.pathExists(targetPath)) {
            try {
                existingConfig = await fs.readJson(targetPath);
            } catch (_) {
                existingConfig = {};
            }
        }

        const existingBrowserSettings = existingConfig.browserSettings && typeof existingConfig.browserSettings === 'object'
            ? { ...existingConfig.browserSettings }
            : {};
        const runtimeBrowserSettings = normalizedConfig.browserSettings && typeof normalizedConfig.browserSettings === 'object'
            ? { ...normalizedConfig.browserSettings }
            : {};
        const mergedConfig = {
            ...existingConfig,
            ...normalizedConfig
        };

        mergedConfig.browserSettings = {
            ...existingBrowserSettings,
            ...runtimeBrowserSettings
        };
        delete mergedConfig.browserSettings.browserType;
        delete mergedConfig.browserSettings.browser_region;
        delete mergedConfig.browserSettings.browserLocale;
        delete mergedConfig.browserSettings.browserTimezoneId;
        delete mergedConfig.browserSettings.headlessMode;
        delete mergedConfig.browserSettings.dynamicFingerprint;
        delete mergedConfig.browserSettings.blockImagesVideos;
        delete mergedConfig.browserSettings.syncExecution;
        delete mergedConfig.browserSettings.maxProxyRecoveryAttempts;
        delete mergedConfig.browserSettings.registrationAutoUpload;
        delete mergedConfig.browserSettings.saveLocalCookie;
        delete mergedConfig.browserSettings.skipCookieSave;
        delete mergedConfig.browserSettings.skip_cookie_save;
        delete mergedConfig.browserSettings.concurrentCount;
        delete mergedConfig.browserSettings.runMode;
        delete mergedConfig.browserSettings.timedRegistrationCount;
        delete mergedConfig.browserSettings.timedRegistrationCycleCount;
        delete mergedConfig.browserSettings.timedRegistrationStartMode;
        delete mergedConfig.browserSettings.timedRegistrationDelaySeconds;
        delete mergedConfig.browser_settings;

        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeJson(targetPath, mergedConfig, { spaces: 4 });

        return {
            success: true,
            config: mergedConfig,
            configPath: targetPath
        };
    },

    getLicenseCachePath() {
        return path.join(app.getPath('userData'), 'license-cache.json');
    },

    async readSavedCardKey() {
        try {
            const cachePath = this.getLicenseCachePath();
            if (!(await fs.pathExists(cachePath))) {
                return '';
            }

            const cache = await fs.readJson(cachePath);
            const expireAtTimestamp = Number.isFinite(Number(cache.expireAtTimestamp))
                ? Number(cache.expireAtTimestamp)
                : parseLicenseExpiryTimestamp(cache.expireAt || '');
            if (expireAtTimestamp > 0 && expireAtTimestamp <= Date.now()) {
                this.logger?.warning?.(`卡密缓存已到期，但保留本地记录: ${typeof cache.expireAt === 'string' ? cache.expireAt : expireAtTimestamp}`);
            }
            return typeof cache.cardKey === 'string' ? cache.cardKey : '';
        } catch (error) {
            this.logger?.warning?.(`读取卡密缓存失败: ${error.message}`);
            return '';
        }
    },

    async saveCardKeyToCache(cardKey, metadata = {}) {
        const cachePath = this.getLicenseCachePath();
        const expireAtText = typeof metadata?.expireAt === 'string'
            ? metadata.expireAt.trim()
            : extractLicenseExpiryText(metadata?.result || metadata?.validationResult || metadata || {});
        const expireAtTimestamp = Number.isFinite(Number(metadata?.expireAtTimestamp))
            ? Number(metadata.expireAtTimestamp)
            : parseLicenseExpiryTimestamp(expireAtText);
        await fs.ensureDir(path.dirname(cachePath));
        await fs.writeJson(cachePath, {
            cardKey: cardKey || '',
            expireAt: expireAtText,
            expireAtTimestamp,
            savedAt: new Date().toISOString()
        }, { spaces: 2 });
    },

    async scheduleLicenseExpiryReturn(expireAtValue, options = {}) {
        const expireAtText = typeof expireAtValue === 'string' && expireAtValue.trim()
            ? expireAtValue.trim()
            : extractLicenseExpiryText(expireAtValue || options?.result || {});
        const expireAtTimestamp = parseLicenseExpiryTimestamp(expireAtText);
        const usageInfo = extractLicenseUsageInfo(options?.result || expireAtValue || {});

        this.currentCardExpireAt = expireAtText;
        this.currentCardExpireAtTimestamp = expireAtTimestamp;
        this.currentCardUsageSnapshot = usageInfo;
        this.licenseUsageLocked = usageInfo.locked === true;
        this.currentCardValidationSnapshot = {
            key: typeof options?.key === 'string' ? options.key.trim() : '',
            expireAt: expireAtText,
            expireAtTimestamp,
            usageInfo,
            source: typeof options?.source === 'string' ? options.source : 'validation',
            updatedAt: new Date().toISOString()
        };

        clearChunkedTimeout(this.licenseExpiryTimer);
        this.licenseExpiryTimer = null;

        if (!expireAtTimestamp) {
            if (expireAtText) {
                this.logger?.warning?.(`卡密验证成功但未能解析到有效日期: ${expireAtText}`);
            }
            this.logger?.info?.(`卡密有效时间: ${expireAtText || '未提供'}`);
            if (usageInfo.summaryText) {
                this.logger?.info?.(`卡密次数信息: ${usageInfo.summaryText}${usageInfo.locked ? '（软件已锁定）' : ''}`);
            } else if (usageInfo.unlimited) {
                this.logger?.info?.('卡密次数信息: 无限次数');
            } else {
                this.logger?.info?.('卡密次数信息: 未提供');
            }
            this.logger?.info?.('卡密定时器: 未设置');
            return { success: true, scheduled: false, expireAt: expireAtText, expireAtTimestamp: 0, usageInfo };
        }

        const delayMs = expireAtTimestamp - Date.now();
        if (delayMs <= 0) {
            this.logger?.warning?.(`卡密已到期，准备返回登录页: ${expireAtText}`);
            this.logger?.info?.(`卡密有效时间: ${expireAtText}`);
            if (usageInfo.summaryText) {
                this.logger?.info?.(`卡密次数信息: ${usageInfo.summaryText}${usageInfo.locked ? '（软件已锁定）' : ''}`);
            } else if (usageInfo.unlimited) {
                this.logger?.info?.('卡密次数信息: 无限次数');
            } else {
                this.logger?.info?.('卡密次数信息: 未提供');
            }
            this.logger?.info?.('卡密定时器: 未设置');
            setImmediate(() => {
                void this.returnToLoginFromLicenseExpiry('expired');
            });
            return { success: true, scheduled: false, expired: true, expireAt: expireAtText, expireAtTimestamp, usageInfo };
        }

        this.licenseExpiryTimer = createChunkedTimeout(delayMs, () => {
            this.licenseExpiryTimer = null;
            void this.returnToLoginFromLicenseExpiry('timer');
        });

        this.logger?.info?.(`卡密有效时间: ${expireAtText}`);
        if (usageInfo.summaryText) {
            this.logger?.info?.(`卡密次数信息: ${usageInfo.summaryText}${usageInfo.locked ? '（软件已锁定）' : ''}`);
        } else if (usageInfo.unlimited) {
            this.logger?.info?.('卡密次数信息: 无限次数');
        } else {
            this.logger?.info?.('卡密次数信息: 未提供');
        }
        this.logger?.info?.(`卡密定时器: 已设置（${Math.max(0, Math.round(delayMs / 1000))} 秒后执行）`);
        return {
            success: true,
            scheduled: true,
            expireAt: expireAtText,
            expireAtTimestamp,
            delayMs,
            usageInfo
        };
    },

    async returnToLoginFromLicenseExpiry(reason = 'timer') {
        if (this.__licenseExpiryReturnInProgress) {
            return { success: true, skipped: true };
        }

        this.__licenseExpiryReturnInProgress = true;
        try {
            clearChunkedTimeout(this.licenseExpiryTimer);
            this.licenseExpiryTimer = null;

            this.logger?.warning?.(`卡密到期，自动返回登录页 (${reason})`);
            this.currentCardExpireAt = '';
            this.currentCardExpireAtTimestamp = 0;
            this.currentCardUsageSnapshot = null;
            this.licenseUsageLocked = false;
            this.currentCardValidationSnapshot = null;
            this.isValidated = false;

            try {
                await this.stopRegistration?.({ closeBrowsers: true, reason: 'license_expired' });
            } catch (stopError) {
                this.logger?.warning?.(`到期后停止注册流程失败: ${stopError.message}`);
            }

            if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
                this.desktopWindow.close();
            }

            const loginWindow = this.loginWindow && !this.loginWindow.isDestroyed()
                ? this.loginWindow
                : null;

            if (!loginWindow) {
                await this.createLoginWindow();
            } else if (typeof loginWindow.show === 'function') {
                loginWindow.show();
                if (typeof loginWindow.focus === 'function') {
                    loginWindow.focus();
                }
            }

            return { success: true };
        } catch (error) {
            this.logger?.error?.(`卡密到期返回登录页失败: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            this.__licenseExpiryReturnInProgress = false;
        }
    },

    async clearSavedCardKey() {
        try {
            const cachePath = this.getLicenseCachePath();
            if (await fs.pathExists(cachePath)) {
                await fs.remove(cachePath);
            }
            this.currentCardExpireAt = '';
            this.currentCardExpireAtTimestamp = 0;
            this.currentCardUsageSnapshot = null;
            this.licenseUsageLocked = false;
            this.currentCardValidationSnapshot = null;
            return { success: true };
        } catch (error) {
            this.logger?.warning?.(`清除卡密缓存失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    initApp() {
        app.whenReady().then(async () => {
            try {
                await this.loadAndApplyUserConfig();
                this.startupUserConfigApplied = true;
            } catch (configError) {
                this.logger.warning(`启动时加载运行配置失败: ${configError.message}`);
            }

            try {
                await this.refreshHardwareInfo?.();
            } catch (hardwareError) {
                this.logger.warning(`启动时刷新硬件信息失败: ${hardwareError.message}`);
            }

            await this.logDeviceIdOnStartup?.();

            try {
                await this.startRegistrationTcpConnectionMonitor({ immediate: true });
            } catch (tcpError) {
                this.logger.warning(`启动TCP连接监控失败: ${tcpError.message}`);
            }

            if (this.devMode) {
                this.isValidated = true;
                this.logger.info('开发模式已启用，已跳过卡密验证');
                await this.showMainWindow();
                return;
            }

            if (this.isTcpManagedMode()) {
                this.isValidated = true;
                this.logger.info('TCP 启动模式已启用，已跳过卡密验证');
                if (this.webControlConfig?.enabled) {
                    this.setupWebLoginRpcHandlers();
                    this.setupRpcHandlers();
                    this.cookieManager.setLogger(this.logger);
                    this.cardManager.setLogger(this.logger);
                    this.bindEmailClientUiEvents();

                    try {
                        if (!this.startupUserConfigApplied) {
                            await this.loadAndApplyUserConfig?.();
                            this.startupUserConfigApplied = true;
                        }
                    } catch (configError) {
                        this.logger.warning(`登录前加载运行配置失败: ${configError.message}`);
                    }

                    await this.startWebControlServer();
                    return;
                }

                await this.showMainWindow();
                return;
            }

            if (this.webControlConfig?.enabled) {
                this.setupWebLoginRpcHandlers();
                this.setupRpcHandlers();
                this.cookieManager.setLogger(this.logger);
                this.cardManager.setLogger(this.logger);
                this.bindEmailClientUiEvents();

                try {
                    if (!this.startupUserConfigApplied) {
                        await this.loadAndApplyUserConfig?.();
                        this.startupUserConfigApplied = true;
                    }
                } catch (configError) {
                    this.logger.warning(`登录前加载运行配置失败: ${configError.message}`);
                }

                const webControlResult = await this.startWebControlServer();
                const loginUrl = `${webControlResult?.url || this.webControlServer?.getUrl?.() || ''}/login`;

                return;
            }

            await this.createLoginWindow();
        });

        app.on('window-all-closed', () => {
            if (this.__cleanupAndExitInProgress || this.__exitRequested) {
                return;
            }
            if (this.webControlConfig?.headless && this.isValidated) {
                return;
            }
            if (process.platform !== 'darwin') {
                this.cleanupAndExit();
            }
        });

        app.on('activate', async () => {
            if (BrowserWindow.getAllWindows().length !== 0) {
                return;
            }

            if (this.isValidated) {
                if (!this.webControlConfig?.headless) {
                    this.createWindow();
                }
                return;
            }

            if (!this.loginWindow) {
                if (this.webControlConfig?.enabled) {
                    return;
                }
                await this.createLoginWindow();
            }
        });
    },

    createWindow() {
        this.desktopWindow = new BrowserWindow({
            width: 1600,
            height: 900,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            icon: path.join(this.projectRoot, 'src/ui/assets/icon.ico'),
            title: 'AI账号注册器 2.0'
        });

        this.mainWindow = this.desktopWindow;
        this.uiChannelManager.attachElectronWindow(this.desktopWindow);
        this.logger.mainWindow = this.mainWindow;
        if (this.browserManager && typeof this.browserManager.setMainWindow === 'function') {
            this.browserManager.setMainWindow(this.mainWindow);
        }
        this.cookieTester.setMainWindow(this.mainWindow);

        this.desktopWindow.loadFile(path.join(this.projectRoot, 'src/ui/index.html'));

        if (process.argv.includes('--dev') || process.argv.includes('--dev-mode') || this.devMode) {
            openDetachedDevTools(this.desktopWindow);
        }

        this.desktopWindow.webContents.once('did-finish-load', async () => {
            try {
                if (this.emailClient.setLogger) this.emailClient.setLogger(this.logger);

                this.logger.info(`尝试自动连接邮箱: ${this.emailClient.serverHost}:${this.emailClient.serverPort}`);
                void this.emailClient.connect().catch((err) => {
                    this.logger.error(`自动连接邮箱失败: ${err.message}`);
                    this.emitUiEvent('email-log', { level: 'error', message: `❌ 自动连接邮箱失败: ${err.message}` });
                    this.emitUiEvent('email-disconnected');
                });
            } catch (err) {
                this.logger.error(`自动连接邮箱失败: ${err.message}`);
                this.emitUiEvent('email-log', { level: 'error', message: `❌ 自动连接邮箱失败: ${err.message}` });
                this.emitUiEvent('email-disconnected');
            }
        });

        this.desktopWindow.on('closed', () => {
            this.desktopWindow = null;
            this.mainWindow = this.webControlConfig?.enabled ? this.headlessUiWindow : null;
            this.logger.mainWindow = this.mainWindow;
            if (this.browserManager && typeof this.browserManager.setMainWindow === 'function') {
                this.browserManager.setMainWindow(this.mainWindow);
            }
            this.cookieTester.setMainWindow(this.mainWindow);
        });
    },

    bindEmailClientUiEvents() {
        if (this.emailUiEventsBound) {
            return;
        }

        this.emailUiEventsBound = true;

        try {
            this.emailClient.on('code_received', (email, code) => {
                this.emitUiEvent('email-code', { email, code });
            });

            this.emailClient.on('error', (msg) => {
                this.emitUiEvent('email-log', { level: 'error', message: String(msg) });
            });

            this.emailClient.on('connected', () => {
                this.emitUiEvent('email-connected', { host: this.emailClient.serverHost, port: this.emailClient.serverPort });
            });

            this.emailClient.on('disconnected', () => {
                this.emitUiEvent('email-disconnected');
            });

            this.emailClient.on('reconnect', (info) => {
                const msRemaining = info && info.nextRetryAt ? Math.max(0, info.nextRetryAt - Date.now()) : null;
                this.emitUiEvent('email-reconnect', { attempt: info.attempt, nextRetryAt: info.nextRetryAt, msRemaining });
                this.emitUiEvent('email-log', { level: 'info', message: `邮箱将在 ${msRemaining !== null ? Math.round(msRemaining / 1000) + 's' : '未知'} 后尝试重连（第 ${info.attempt} 次）` });
            });

            this.emailClient.on('raw-message', (message) => {
                this.emitUiEvent('email-raw-message', message);
            });
        } catch (e) {
        }
    },

    async migrateCookieFormats() {
        if (this.cookieMigrationDone) {
            return;
        }

        try {
            await this.cookieManager.migrateCookieFormats();
            this.cookieMigrationDone = true;
        } catch (error) {
            this.logger.error(`Cookie格式迁移失败: ${error.message}`);
        }
    },

    setupMenu() {
        const template = [
            {
                label: '文件',
                submenu: [
                    {
                        label: '退出',
                        accelerator: 'CmdOrCtrl+Q',
                        click: () => {
                            this.cleanupAndExit();
                        }
                    }
                ]
            },
            {
                label: '查看',
                submenu: [
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            },
            {
                label: '帮助',
                submenu: [
                    {
                        label: '关于',
                        click: () => {
                            const aboutMessage = 'AI账号注册器 2.0\n自动注册AI账号的工具软件\n版本: 2.0.0\n基于 Electron 构建';
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                this.mainWindow.webContents.send('app-toast', {
                                    message: aboutMessage,
                                    type: 'info'
                                });
                            } else {
                                this.logger.info(aboutMessage);
                            }
                        }
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    },

};
