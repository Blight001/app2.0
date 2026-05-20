const DEFAULT_MIN_COOKIE_SIZE_BYTES = 8192;

const calculateCookiePayloadBytes = (payload) => {
    try {
        if (payload === undefined || payload === null) {
            return 0;
        }

        return Buffer.byteLength(JSON.stringify(payload, null, 2), 'utf8');
    } catch (_error) {
        return 0;
    }
};

const normalizeNavigationUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
        return raw;
    }

    if (/^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(raw) || /(?:\.[a-zA-Z]{2,})(?::\d+)?(?:\/|$)/.test(raw)) {
        return `https://${raw}`;
    }

    return raw;
};

const normalizeRegistrationSteps = (cardConfig = {}, logger = null) => {
    const steps = Array.isArray(cardConfig.steps) ? [...cardConfig.steps] : [];
    const website = normalizeNavigationUrl(cardConfig.website);

    if (!website) {
        return steps;
    }

    const firstMeaningfulStep = steps.find(step => step && typeof step === 'object');
    const firstStepType = String(firstMeaningfulStep?.type || '').trim().toLowerCase();
    if (firstStepType === 'navigate') {
        return steps;
    }

    if (logger && typeof logger.info === 'function') {
        logger.info(`检测到卡片网站地址，自动在步骤前补充“访问网站”: ${website}`);
    }

    return [
        {
            type: 'navigate',
            name: '访问网站',
            url: website
        },
        ...steps
    ];
};

const resolveMinCookieSizeBytes = (cardConfig) => {
    const candidates = [
        cardConfig?.min_cookie_size_bytes,
        cardConfig?.minCookieSizeBytes,
        cardConfig?.min_cookie_size,
        cardConfig?.minCookieSize
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') {
            continue;
        }

        const explicitSize = parseInt(candidate, 10);
        if (Number.isFinite(explicitSize) && explicitSize >= 0) {
            return explicitSize;
        }
    }

    return DEFAULT_MIN_COOKIE_SIZE_BYTES;
};

module.exports = {
    async start() {
        try {
            await this._run();
        } catch (error) {
            this.logger.error(`任务 ${this.taskId} 执行失败: ${error.message}`);
            this.emit('error', error.message);
        }
    },

    async _run() {
        try {
            const headless = this.browserSettings.headless || false;

            const filteredSettings = { ...this.browserSettings };
            delete filteredSettings.browser_type;
            delete filteredSettings.headless;

            this.logger.info(`开始创建${this.browserType}浏览器实例`);
            this.browserId = await this.browserManager.createBrowser(
                this.browserType,
                headless,
                filteredSettings
            );
            this.logger.info(`浏览器实例创建完成，ID: ${this.browserId}`);
            await this._bindBrowserLifecycle();

            this.currentStep = `创建${this.browserType}浏览器实例`;
            this.emit('progress', 10, `创建${this.browserType}浏览器实例`);

            if (!this.running) {
                this.emit('finished', {
                    success: false,
                    error: this.stopReason || '任务已停止',
                    cancelled: true,
                    browserClosed: this.browserClosed === true
                });
                return;
            }

            await this._ensureBrowserAvailable('浏览器初始化');
            this.logger.info('浏览器实例验证通过，page对象可用');

            let tempEmailWarmupPromise = null;
            if (typeof this._shouldPrewarmTempEmail === 'function' && this._shouldPrewarmTempEmail()) {
                this.logger.info('检测到临时邮箱模式，开始预热临时邮箱页面');
                tempEmailWarmupPromise = this._prewarmTempEmailBrowser({
                    timeout: 30,
                    pageLoadTimeoutMs: 20000,
                    gotoTimeoutMs: 20000,
                    closePopupTimeoutMs: 3000,
                    closePopupPollIntervalMs: 250,
                    closePopupQuietRounds: 2
                }).catch((error) => {
                    this.logger.warning(`临时邮箱预热失败: ${error.message}`);
                    return null;
                });
            }

            if (Array.isArray(this.initialCookies) && this.initialCookies.length > 0) {
                const injected = await this.browserManager.setCookies(this.browserId, this.initialCookies);
                if (!injected) {
                    this.logger.warning('Cookie注入失败，继续执行后续步骤');
                }
            } else {
                this.logger.info('未提供初始Cookie，跳过注入');
            }

            if (tempEmailWarmupPromise) {
                await tempEmailWarmupPromise;
            }

            const result = await this._executeRegistrationSteps();

            if (result.success && this.browserId) {
                await this._ensureBrowserAvailable('保存Cookie前检查');
                this.logger.info('开始保存注册成功的Cookie数据');
                const cookieStorageEnabled = typeof this.cookieManager?.isPersistenceEnabled === 'function'
                    ? this.cookieManager.isPersistenceEnabled()
                    : true;
                const saveLocalCookie = this.skipCookieSave !== true;
                const shouldSaveLocalCookie = cookieStorageEnabled && saveLocalCookie;

                try {
                    const browserState = typeof this.browserManager.getBrowserState === 'function'
                        ? await this.browserManager.getBrowserState(this.browserId)
                        : { cookies: await this.browserManager.getCookies(this.browserId), browserStorage: [] };
                    const cookies = Array.isArray(browserState.cookies) ? browserState.cookies : [];
                    const browserStorage = Array.isArray(browserState.browserStorage) ? browserState.browserStorage : [];
                    const cookiePayload = {
                        cookies,
                        browserStorage
                    };
                    this.logger.info(`获取到 ${cookies ? cookies.length : 0} 个Cookie`);
                    const cardName = this.cardConfig.name || '未命名卡片';
                    const minCookieSizeBytes = resolveMinCookieSizeBytes(this.cardConfig);
                    const cookiePayloadBytes = calculateCookiePayloadBytes(cookiePayload);
                    result.cookies = cookies;
                    result.browserStorage = browserStorage;
                    result.cookieStorageMode = shouldSaveLocalCookie ? 'desktop' : 'disabled';
                    result.cookiePersistenceDisabled = !shouldSaveLocalCookie;

                    if (minCookieSizeBytes > 0 && cookiePayloadBytes < minCookieSizeBytes) {
                        this.logger.info(`准备保存Cookie - 邮箱: ${result.email}, 卡片: ${cardName}, 积分: ${result.points}`);
                        this.logger.info(`Cookie大小检查 - 当前: ${cookiePayloadBytes} 字节, 最小要求: ${minCookieSizeBytes} 字节`);
                        result.success = false;
                        result.error = `Cookie大小异常: 当前 ${cookiePayloadBytes} 字节，小于卡片要求的最小值 ${minCookieSizeBytes} 字节`;
                        result.cookieValidationFailed = true;
                        result.cookiePayloadBytes = cookiePayloadBytes;
                        result.minCookieSizeBytes = minCookieSizeBytes;
                        result.cookiesSaved = false;
                        this.logger.error(`❌ Cookie大小校验失败 - 邮箱: ${result.email}, 卡片: ${cardName}, 当前: ${cookiePayloadBytes}, 最小要求: ${minCookieSizeBytes}`);
                    } else if ((cookies && cookies.length > 0) || browserStorage.length > 0) {
                        this.logger.info(`准备保存Cookie - 邮箱: ${result.email}, 卡片: ${cardName}, 积分: ${result.points}`);
                        this.logger.info(`Cookie大小检查 - 当前: ${cookiePayloadBytes} 字节, 最小要求: ${minCookieSizeBytes} 字节`);
                        result.cookiePayloadBytes = cookiePayloadBytes;
                        result.minCookieSizeBytes = minCookieSizeBytes;
                        if (!shouldSaveLocalCookie) {
                            result.cookiesSaved = false;
                            this.logger.info(`Cookie本地存储已关闭，已跳过保存 - 邮箱: ${result.email}, 卡片: ${cardName}, 积分: ${result.points}`);
                        } else {
                            const saveResult = await this.cookieManager.saveCookie(
                                result.email,
                                result.password,
                                result.points,
                                cookiePayload,
                                cardName,
                            );

                            if (saveResult) {
                                this.logger.info(`✅ Cookie保存成功 - 邮箱: ${result.email}, 积分: ${result.points}, Cookie数量: ${cookies.length}, 浏览器存储: ${browserStorage.length}`);
                                result.cookiesSaved = true;
                            } else {
                                this.logger.error(`❌ Cookie保存失败 - 邮箱: ${result.email}`);
                            }
                        }
                    } else {
                        this.logger.warning(`⚠️ 未获取到Cookie或浏览器存储数据，跳过保存 - 邮箱: ${result.email}`);
                    }
                } catch (cookieError) {
                    this.logger.error(`Cookie保存过程中出现异常: ${cookieError.message}`);
                }
            } else if (result.success && this.skipCookieSave) {
                this.logger.info('已跳过Cookie保存步骤');
            }

            this.emit('finished', result);
        } catch (error) {
            const normalizedError = this._normalizeRuntimeError(error, '任务执行');
            if ((!this.running && this.stopReason) || this.browserClosed === true) {
                this.emit('finished', {
                    success: false,
                    error: normalizedError.message,
                    cancelled: true,
                    browserClosed: this.browserClosed === true
                });
            } else {
                this.emit('error', normalizedError.message);
            }
        } finally {
            this._finalizing = true;
            this._cleanupBrowserLifecycle();

            if (this.synchronizer) {
                this.synchronizer.notifyThreadFinished(this.taskId);
            }

            if (this.browserId && !this.keepBrowserOpen) {
                try {
                    await this.browserManager.closeBrowser(this.browserId);
                } catch (error) {
                    this.logger.error(`关闭浏览器失败: ${error.message}`);
                }
            } else if (this.browserId && this.keepBrowserOpen) {
                this.logger.info(`调试模式保留浏览器打开: ${this.browserId}`);
            }

            try {
                await this._cleanupTempEmailSession();
            } catch (error) {
                this.logger.warning(`关闭临时邮箱窗口失败: ${error.message}`);
            }
        }
    },

    async _executeRegistrationSteps() {
        const result = {
            success: false,
            email: '',
            password: '',
            points: 0,
            warnings: [],
            debugMode: this.debugMode === true
        };

        const steps = normalizeRegistrationSteps(this.cardConfig, this.logger);
        const totalSteps = steps.length;
        const debugMode = this.debugMode === true;
        const jumpCounters = new Map();

        const pauseForDebug = async (reason = 'success', stepName = '') => {
            if (!debugMode) {
                return;
            }

            const pauseMs = reason === 'error' ? this.debugErrorPauseMs : this.debugStepPauseMs;
            if (!pauseMs || pauseMs <= 0) {
                return;
            }

            const pauseLabel = reason === 'error' ? '异常后暂停' : '步骤后暂停';
            this.logger.info(`调试模式：${stepName ? `${stepName} ` : ''}${pauseLabel} ${pauseMs}ms，您可以在浏览器里继续处理元素`);
            await this._sleepInterruptibly(pauseMs, `${stepName || '调试模式'}${pauseLabel}`);
        };
        const resolveJumpStepIndex = (directive, currentIndex) => {
            if (!directive || typeof directive !== 'object') {
                return -1;
            }

            const targetStepIndex = parseInt(directive.targetStepIndex ?? directive.target_index, 10);
            if (Number.isFinite(targetStepIndex) && targetStepIndex >= 0 && targetStepIndex < steps.length) {
                return targetStepIndex;
            }

            const targetStepName = typeof directive.targetStepName === 'string'
                ? directive.targetStepName.trim()
                : (typeof directive.target_step_name === 'string' ? directive.target_step_name.trim() : '');
            if (!targetStepName) {
                return -1;
            }

            for (let index = currentIndex - 1; index >= 0; index--) {
                const candidateName = typeof steps[index]?.name === 'string' ? steps[index].name.trim() : '';
                if (candidateName === targetStepName) {
                    return index;
                }
            }

            return steps.findIndex(candidate => {
                const candidateName = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
                return candidateName === targetStepName;
            });
        };

        for (let i = 0; i < steps.length; i++) {
            if (!this.running) {
                break;
            }

            let browser;
            try {
                browser = await this._ensureBrowserAvailable(`步骤 ${i + 1} 前检查`);
            } catch (error) {
                result.error = this._normalizeRuntimeError(error, `步骤 ${i + 1} 前检查`).message;
                return result;
            }

            const step = steps[i];
            const stepName = typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : `步骤${i + 1}`;
            this.currentStep = stepName;

            const progress = 20 + (i / totalSteps) * 70;
            const nextStep = steps[i + 1] || null;

            if (this.synchronizer) {
                try {
                    this.logger.info(`[同步] 任务 ${this.taskId} 等待其它线程到达步骤 ${i + 1} (${stepName})...`);
                    this.emit('progress', Math.round(progress), `[同步] 等待其他浏览器...`);
                    await this.synchronizer.waitForStep(i, stepName, this.taskId, () => this.running !== false);
                    browser = await this._ensureBrowserAvailable(`步骤 ${stepName} 同步后检查`);
                    this.logger.info(`[同步] 步骤 ${i + 1} 同步完成，开始执行`);
                } catch (syncError) {
                    result.error = this._normalizeRuntimeError(syncError, `步骤 ${stepName} 同步等待`).message;
                    return result;
                }
            }

            this.emit('progress', Math.round(progress), `执行步骤: ${stepName}`);

            try {
                if (typeof step !== 'object' || step === null) {
                    const message = `步骤 ${i + 1} 配置错误：期望对象类型，但收到 ${typeof step}: ${step}`;
                    if (debugMode) {
                        result.warnings.push(message);
                        this.logger.warning(`调试模式：${message}，将继续执行后续步骤`);
                        await pauseForDebug('error', stepName);
                        continue;
                    }
                    result.error = message;
                    return result;
                }

                const success = await this._executeStep(browser, step, this.browserId, nextStep);
                if (success && typeof success === 'object' && success.action === 'jump_to_step') {
                    const targetIndex = resolveJumpStepIndex(success, i);
                    if (targetIndex < 0 || targetIndex >= steps.length) {
                        throw new Error(`步骤 ${stepName} 请求跳转失败：未找到目标步骤 ${success.targetStepName || success.target_step_name || success.targetStepIndex || success.target_index}`);
                    }

                    const jumpKey = `${i}->${targetIndex}`;
                    const usedCount = (jumpCounters.get(jumpKey) || 0) + 1;
                    jumpCounters.set(jumpKey, usedCount);
                    const maxJumpRetries = Number.isFinite(parseInt(success.maxJumpRetries, 10))
                        ? Math.max(1, parseInt(success.maxJumpRetries, 10))
                        : 3;

                    if (usedCount > maxJumpRetries) {
                        throw new Error(`${success.reason || `步骤 ${stepName} 需要回跳`}，但已超过最大回跳次数 ${maxJumpRetries}`);
                    }

                    const targetStepName = typeof steps[targetIndex]?.name === 'string' && steps[targetIndex].name.trim()
                        ? steps[targetIndex].name.trim()
                        : `步骤${targetIndex + 1}`;
                    this.logger.warning(`${success.reason || `步骤 ${stepName} 请求回跳`}，第 ${usedCount}/${maxJumpRetries} 次回跳到 ${targetStepName}`);
                    i = targetIndex - 1;
                    continue;
                }

                if (success === false || success === null || success === undefined) {
                    const message = (!this.running && this.stopReason)
                        ? this.stopReason
                        : `步骤 ${step.name || `步骤${i + 1}`} 执行失败`;
                    if (debugMode) {
                        result.warnings.push(message);
                        this.logger.warning(`调试模式：${message}，将继续执行后续步骤`);
                        await pauseForDebug('error', stepName);
                        continue;
                    }
                    result.error = message;
                    return result;
                }

                if (debugMode) {
                    await pauseForDebug('success', stepName);
                }
            } catch (error) {
                const normalizedError = this._normalizeRuntimeError(error, `步骤 ${stepName}`);
                this.logger.error(`execute_registration_steps异常时step状态: 类型=${typeof step}, 值=${JSON.stringify(step)}`);
                this.logger.error(`异常信息: ${normalizedError.message}`);
                let failedStepName;
                try {
                    failedStepName = (typeof step === 'object' && step !== null) ? (step.name || `步骤${i + 1}`) : `步骤${i + 1}`;
                } catch (_e) {
                    failedStepName = `步骤${i + 1}`;
                }
                if (debugMode) {
                    const warning = `步骤 ${failedStepName} 错误: ${normalizedError.message}`;
                    result.warnings.push(warning);
                    this.logger.warning(`调试模式：${warning}，将继续执行后续步骤`);
                    await pauseForDebug('error', failedStepName);
                    continue;
                }
                result.error = `步骤 ${failedStepName} 错误: ${normalizedError.message}`;
                return result;
            }
        }

        if (!this.running) {
            result.error = this.stopReason || '任务被用户停止';
            this.logger.info(`任务 ${this.taskId} 已停止，未完成注册: ${result.error}`);
            return result;
        }

        this.currentStep = '获取注册结果';
        result.success = true;

        this.logger.info('注册完成 - 凭据状态:');
        this.logger.info(`  credentials.email: "${this.credentials.email}"`);
        this.logger.info(`  credentials.password: "${this.credentials.password}"`);
        this.logger.info(`  generatedEmail: "${this.generatedEmail}"`);
        this.logger.info(`  cardConfig.email: "${this.cardConfig.email}"`);
        this.logger.info(`  cardConfig.password: "${this.cardConfig.password}"`);
        this.logger.info(`  _credits: ${this._credits}`);

        const email = this.credentials.email || this.generatedEmail || this.cardConfig.email || '';
        result.email = email.startsWith('@') ? email.substring(1) : email;
        result.password = this.credentials.password || this.cardConfig.password || '';

        if (!result.email) {
            result.email = `temp_${Date.now()}@example.com`;
            this.logger.warning(`未找到邮箱，使用备用邮箱: ${result.email}`);
        }

        if (!result.password) {
            result.password = `temp_pass_${Date.now()}`;
            this.logger.warning(`未找到密码，使用临时密码: ${result.password}`);
        }

        result.points = this._credits ?? this.cardConfig.points ?? 0;

        this.logger.info(`最终注册结果 - 邮箱: ${result.email}, 密码: ${result.password}, 积分: ${result.points}`);
        if (debugMode && result.warnings.length > 0) {
            this.logger.info(`调试模式完成，累计 ${result.warnings.length} 个告警`);
        }
        this.emit('progress', 90, '获取注册结果');
        return result;
    }
};
