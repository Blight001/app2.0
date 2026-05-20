const { BrowserWindow } = require('electron');
const path = require('path');
const RegistrationThread = require('../registration-thread');
const StepSynchronizer = require('../infra/step-synchronizer');
const { loadRegistrationCardsForMode } = require('../registration/registration-ui-state');
const { IPC_CHANNELS } = require('../ipc/channels');

function openCardDebugActionsWindow(appContext) {
    const existingWindow = appContext.cardDebugActionsWindow;
    if (existingWindow && !existingWindow.isDestroyed()) {
        existingWindow.show();
        existingWindow.focus();
        return;
    }

    const ownerWindow = appContext.mainWindow && !appContext.mainWindow.isDestroyed()
        ? appContext.mainWindow
        : undefined;
    const debugWindow = new BrowserWindow({
        width: 460,
        height: 230,
        minWidth: 360,
        minHeight: 190,
        title: '卡片调试',
        parent: ownerWindow,
        modal: false,
        show: false,
        resizable: false,
        minimizable: true,
        maximizable: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webviewTag: false,
            preload: path.join(appContext.projectRoot, 'src/preload/card-debug-actions-preload.js')
        }
    });

    appContext.cardDebugActionsWindow = debugWindow;
    debugWindow.removeMenu();
    debugWindow.loadFile(path.join(appContext.projectRoot, 'src/ui/card-debug-actions.html'));
    debugWindow.once('ready-to-show', () => {
        debugWindow.show();
    });
    debugWindow.on('closed', () => {
        if (appContext.cardDebugActionsWindow === debugWindow) {
            appContext.cardDebugActionsWindow = null;
        }
    });
}

function cloneRegistrationCardConfig(cardConfig = null) {
    if (!cardConfig || typeof cardConfig !== 'object') {
        return null;
    }

    return JSON.parse(JSON.stringify(cardConfig));
}

function toPositiveInteger(value, fallback = 1, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(minimum, Math.min(maximum, parsed));
}

function summarizeRegistrationDefaultExecutionPlan(plan = {}) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const browserSettings = source.browser_settings || source.browserSettings || {};
    const browserSource = String(
        browserSettings.browser_source
        || browserSettings.browserSource
        || 'local-browser'
    ).trim() === 'client-browser' ? 'client-browser' : 'local-browser';

    return {
        enabled: source.enabled === true,
        auto_start_registration: source.auto_start_registration === true || source.autoStartRegistration === true,
        server_card_name: String(source.server_card_name || source.serverCardName || '').trim(),
        control_locked: source.control_locked === true || source.controlLocked === true,
        browser_settings: {
            browser_type: String(browserSettings.browser_type || browserSettings.browserType || '').trim(),
            browser_source: browserSource,
            headless: browserSettings.headless !== false,
            dynamic_fingerprint: browserSettings.dynamic_fingerprint !== false,
            block_images_videos: browserSettings.block_images_videos !== false,
            sync_execution: browserSettings.sync_execution !== false,
            max_proxy_recovery_attempts: toPositiveInteger(browserSettings.max_proxy_recovery_attempts, 3, 1, 20),
            registration_auto_upload: browserSettings.registration_auto_upload !== false,
            save_local_cookie: browserSettings.save_local_cookie === true,
            concurrent_count: toPositiveInteger(browserSettings.concurrent_count, 1, 1, 99),
            run_mode: toPositiveInteger(browserSettings.run_mode, 0, 0, 2),
            timed_registration_count: toPositiveInteger(browserSettings.timed_registration_count, 1, 1, 99999),
            timed_registration_cycle_count: toPositiveInteger(browserSettings.timed_registration_cycle_count, 1, 1, 99999),
            timed_registration_start_mode: String(browserSettings.timed_registration_start_mode || '').trim() === 'delayed' ? 'delayed' : 'immediate',
            timed_registration_delay_seconds: toPositiveInteger(browserSettings.timed_registration_delay_seconds, 0, 0, 3600)
        }
    };
}

function normalizeHaikaExpiryDateValue(expiryDate = '') {
    if (expiryDate === null || expiryDate === undefined) {
        return '';
    }

    const raw = String(expiryDate).trim();
    if (!raw) {
        return '';
    }

    const digits = raw.replace(/\D/g, '');
    if (digits.length === 4) {
        return digits;
    }

    const parts = raw.split(/\D+/).filter(Boolean);
    if (parts.length >= 2) {
        const first = parts[0];
        const second = parts[1];

        if (first.length === 4 && second.length <= 2) {
            return `${second.padStart(2, '0')}${first.slice(-2)}`;
        }

        if (first.length <= 2 && second.length === 4) {
            return `${first.padStart(2, '0')}${second.slice(-2)}`;
        }
    }

    return raw;
}

module.exports = {
    async loadCards() {
        try {
            const cards = await loadRegistrationCardsForMode(this, 'register');
            if (this.mainWindow) {
                this.mainWindow.webContents.send('cards-loaded', cards);
            }
            this.logger.debug?.(`注册卡片已同步: ${cards.length} 个`);
            return cards;
        } catch (error) {
            this.logger.error(`加载卡片失败: ${error.message}`);
            return [];
        }
    },

    _getRegistrationModeLabel(runMode = this.runMode) {
        if (runMode === 2) {
            return '定时注册';
        }
        if (runMode === 1) {
            return '循环运行';
        }
        return '单次运行';
    },

    _getTimedRegistrationTaskLabel() {
        return '定时注册任务';
    },

    _getTimedRegistrationBatchLabel() {
        return '定时注册批次';
    },

    _resolveRegistrationStartConfig(config = {}) {
        const input = config && typeof config === 'object' ? config : {};
        const runtimePlan = cloneRegistrationCardConfig(this.registrationDefaultExecutionPlan) || {};
        const planBrowserSettings = cloneRegistrationCardConfig(runtimePlan.browser_settings || runtimePlan.browserSettings) || {};
        const inputBrowserSettings = cloneRegistrationCardConfig(input.browserSettings || input.browser_settings) || {};
        const browserSettings = {
            ...planBrowserSettings,
            ...inputBrowserSettings
        };
        const resolveSaveLocalCookie = (...values) => {
            for (const value of values) {
                if (value === undefined || value === null || value === '') {
                    continue;
                }
                if (typeof value === 'boolean') {
                    return value;
                }
                const normalized = String(value).trim().toLowerCase();
                if (['1', 'true', 'yes', 'on'].includes(normalized)) {
                    return true;
                }
                if (['0', 'false', 'no', 'off'].includes(normalized)) {
                    return false;
                }
            }
            return false;
        };

        const browserType = String(
            planBrowserSettings.browser_type
            || planBrowserSettings.browserType
            || runtimePlan.browser_type
            || runtimePlan.browserType
            || input.browserType
            || input.browser_type
            || inputBrowserSettings.browser_type
            || inputBrowserSettings.browserType
            || this.currentBrowserType
            || ''
        ).trim();
        if (browserType) {
            browserSettings.browser_type = browserType;
            browserSettings.browserType = browserType;
        }

        const runMode = Number.isFinite(Number(input.runMode))
            ? Number(input.runMode)
            : Number.isFinite(Number(runtimePlan.runMode))
                ? Number(runtimePlan.runMode)
                : Number.isFinite(Number(browserSettings.run_mode))
                    ? Number(browserSettings.run_mode)
                    : 0;
        const concurrentCount = toPositiveInteger(
            Number.isFinite(Number(input.concurrentCount))
                ? input.concurrentCount
                : Number.isFinite(Number(runtimePlan.concurrentCount))
                    ? runtimePlan.concurrentCount
                    : browserSettings.concurrent_count,
            1,
            1,
            99
        );
        const syncEnabled = typeof runtimePlan.syncEnabled === 'boolean'
            ? (typeof input.syncEnabled === 'boolean' ? input.syncEnabled : runtimePlan.syncEnabled)
            : typeof input.syncEnabled === 'boolean'
                ? input.syncEnabled
                : browserSettings.sync_execution !== false;
        const saveLocalCookie = resolveSaveLocalCookie(
            input.saveLocalCookie,
            input.save_local_cookie,
            input.skipCookieSave === true ? false : undefined,
            runtimePlan.saveLocalCookie,
            runtimePlan.save_local_cookie,
            browserSettings.save_local_cookie,
            browserSettings.saveLocalCookie,
            browserSettings.skip_cookie_save === true ? false : undefined
        );
        const maxProxyRecoveryAttempts = toPositiveInteger(
            Number.isFinite(Number(input.maxProxyRecoveryAttempts))
                ? input.maxProxyRecoveryAttempts
                : Number.isFinite(Number(runtimePlan.maxProxyRecoveryAttempts))
                    ? runtimePlan.maxProxyRecoveryAttempts
                    : browserSettings.max_proxy_recovery_attempts,
            3,
            1,
            20
        );
        const timedRegistrationCount = toPositiveInteger(
            Number.isFinite(Number(input.timedRegistrationCount))
                ? input.timedRegistrationCount
                : Number.isFinite(Number(runtimePlan.timedRegistrationCount))
                    ? runtimePlan.timedRegistrationCount
                    : browserSettings.timed_registration_count,
            1,
            1,
            99999
        );
        const timedRegistrationCycleCount = toPositiveInteger(
            Number.isFinite(Number(input.timedRegistrationCycleCount))
                ? input.timedRegistrationCycleCount
                : Number.isFinite(Number(runtimePlan.timedRegistrationCycleCount))
                    ? runtimePlan.timedRegistrationCycleCount
                    : browserSettings.timed_registration_cycle_count,
            1,
            1,
            99999
        );
        const timedRegistrationStartMode = String(
            input.timedRegistrationStartMode
            || runtimePlan.timedRegistrationStartMode
            || browserSettings.timed_registration_start_mode
            || 'immediate'
        ).trim() === 'delayed' ? 'delayed' : 'immediate';
        const timedRegistrationDelayMs = Number.isFinite(Number(input.timedRegistrationDelayMs))
            ? Number(input.timedRegistrationDelayMs)
            : Number.isFinite(Number(runtimePlan.timedRegistrationDelayMs))
                ? Number(runtimePlan.timedRegistrationDelayMs)
                : Number.isFinite(Number(browserSettings.timed_registration_delay_seconds))
                    ? Number(browserSettings.timed_registration_delay_seconds) * 1000
                    : 0;
        const serverCardName = String(
            runtimePlan.server_card_name
            || runtimePlan.serverCardName
            || input.server_card_name
            || input.serverCardName
            || ''
        ).trim();

        browserSettings.run_mode = runMode;
        browserSettings.concurrent_count = concurrentCount;
        browserSettings.sync_execution = syncEnabled;
        browserSettings.max_proxy_recovery_attempts = maxProxyRecoveryAttempts;
        browserSettings.timed_registration_count = timedRegistrationCount;
        browserSettings.timed_registration_cycle_count = timedRegistrationCycleCount;
        browserSettings.timed_registration_start_mode = timedRegistrationStartMode;
        browserSettings.timed_registration_delay_seconds = Math.max(0, Math.floor(timedRegistrationDelayMs / 1000));
        browserSettings.save_local_cookie = saveLocalCookie;
        browserSettings.saveLocalCookie = saveLocalCookie;
        browserSettings.skip_cookie_save = !saveLocalCookie;
        browserSettings.skipCookieSave = !saveLocalCookie;

        return {
            ...runtimePlan,
            ...input,
            browserType,
            browserSettings,
            browser_settings: browserSettings,
            runMode,
            concurrentCount,
            syncEnabled,
            maxProxyRecoveryAttempts,
            timedRegistrationCount,
            timedRegistrationCycleCount,
            timedRegistrationStartMode,
            timedRegistrationDelayMs,
            saveLocalCookie,
            skipCookieSave: !saveLocalCookie,
            server_card_name: serverCardName,
            serverCardName
        };
    },

    _getTimedRegistrationPlanTotals(state = this.timedRegistrationState) {
        const batchSize = Math.max(1, parseInt(state?.totalCount, 10) || 1);
        const cycleLimit = Math.max(1, parseInt(state?.cycleLimit, 10) || 1);
        return {
            batchSize,
            cycleLimit,
            totalPlannedCount: batchSize * cycleLimit
        };
    },

    _getTimedRegistrationCycleLabel(state = this.timedRegistrationState, cycleIndex = null) {
        const { cycleLimit } = this._getTimedRegistrationPlanTotals(state);
        const normalizedCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(cycleIndex, 10) || parseInt(state?.currentCycleIndex, 10) || 1,
                cycleLimit
            )
        );

        return `第 ${normalizedCycleIndex}/${cycleLimit} 轮`;
    },

    _getTimedRegistrationProgressTaskId(state = this.timedRegistrationState) {
        if (!state || !state.sessionId) {
            return null;
        }

        return `timed-registration-${state.sessionId}`;
    },

    _formatTimedRegistrationDuration(durationMs = 0) {
        const totalSeconds = Math.max(0, Math.ceil(Number(durationMs) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts = [];
        if (hours > 0) {
            parts.push(`${hours}小时`);
        }
        if (minutes > 0 || hours > 0) {
            parts.push(`${minutes}分`);
        }
        parts.push(`${seconds}秒`);
        return parts.join('');
    },

    _getNextTimedRegistrationLaunchAt(state = this.timedRegistrationState) {
        if (!state || !state.pendingTimers || state.pendingTimers.size === 0) {
            return null;
        }

        let nextLaunchAt = null;
        for (const launchAt of state.pendingTimers.values()) {
            const normalizedLaunchAt = Number(launchAt);
            if (!Number.isFinite(normalizedLaunchAt)) {
                continue;
            }

            if (nextLaunchAt === null || normalizedLaunchAt < nextLaunchAt) {
                nextLaunchAt = normalizedLaunchAt;
            }
        }

        return nextLaunchAt;
    },

    _buildTimedRegistrationProgressPayload(state = this.timedRegistrationState, options = {}) {
        if (!state) {
            return null;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const completedCount = Math.max(0, Math.min(parseInt(state.completedCount, 10) || 0, totalPlannedCount));
        const startedCount = Math.max(0, Math.min(parseInt(state.startedCount, 10) || 0, totalPlannedCount));
        const cycleCompletedCount = Math.max(0, Math.min(parseInt(state.cycleCompletedCount, 10) || 0, batchSize));
        const cycleStartedCount = Math.max(0, Math.min(parseInt(state.cycleStartedCount, 10) || 0, batchSize));
        const startingCount = Math.max(0, parseInt(state.startingCount, 10) || 0);
        const waitingCount = Math.max(0, Number.isFinite(options.waitingCount) ? options.waitingCount : (this.runningTasks.size + startingCount));
        const remainingCount = Math.max(0, batchSize - cycleStartedCount - startingCount);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );
        const completedCyclesBeforeCurrent = Math.max(0, Math.min(parseInt(state.completedCycleCount, 10) || 0, Math.max(0, cycleLimit - 1)));
        const taskId = options.taskId || this._getTimedRegistrationProgressTaskId(state);
        const taskLabel = options.taskLabel || this._getTimedRegistrationBatchLabel();
        const taskNumber = options.taskNumber !== undefined ? String(options.taskNumber) : this._getTimedRegistrationCycleLabel(state, currentCycleIndex);
        const progress = batchSize > 0 ? Math.round((cycleCompletedCount / batchSize) * 100) : 100;
        const nextLaunchAt = options.nextLaunchAt !== undefined
            ? options.nextLaunchAt
            : this._getNextTimedRegistrationLaunchAt(state);
        const normalizedNextLaunchAt = Number.isFinite(Number(nextLaunchAt)) ? Number(nextLaunchAt) : null;
        const nextLaunchInMs = normalizedNextLaunchAt !== null
            ? Math.max(0, normalizedNextLaunchAt - Date.now())
            : null;
        const sessionCompletedCount = Math.max(0, Math.min(completedCount, totalPlannedCount));
        const sessionStartedCount = Math.max(0, Math.min(startedCount, totalPlannedCount));
        const sessionRemainingCount = Math.max(0, totalPlannedCount - sessionStartedCount);
        const sessionProgress = totalPlannedCount > 0
            ? Math.round((sessionCompletedCount / totalPlannedCount) * 100)
            : 100;

        let statusText = options.statusText;
        if (!statusText) {
            if (waitingCount > 0 && remainingCount <= 0) {
                statusText = '等待当前任务结束';
            } else if (options.completed || (sessionCompletedCount >= totalPlannedCount && currentCycleIndex >= cycleLimit && cycleCompletedCount >= batchSize)) {
                statusText = '已完成';
            } else if (nextLaunchInMs !== null && remainingCount <= 0) {
                statusText = '等待下一轮';
            } else if (nextLaunchInMs !== null && remainingCount > 0 && cycleCompletedCount === 0 && cycleStartedCount === 0 && sessionCompletedCount === 0 && completedCyclesBeforeCurrent === 0) {
                statusText = '等待开始';
            } else if (remainingCount > 0 && nextLaunchInMs !== null) {
                statusText = '等待下一次执行';
            } else if (remainingCount > 0) {
                statusText = startedCount > completedCount ? '执行中' : '等待任务启动';
            } else {
                statusText = '执行中';
            }
        }

        let message = options.message;
        if (!message) {
            const messageParts = [];
            if (options.completed || (sessionCompletedCount >= totalPlannedCount && currentCycleIndex >= cycleLimit && cycleCompletedCount >= batchSize)) {
                messageParts.push(`定时注册完成，共完成 ${sessionCompletedCount}/${totalPlannedCount}`);
            } else if (nextLaunchInMs !== null && cycleCompletedCount === 0 && cycleStartedCount === 0 && completedCount === 0 && completedCyclesBeforeCurrent === 0) {
                messageParts.push(`准备开始定时注册，首轮将在 ${this._formatTimedRegistrationDuration(nextLaunchInMs)} 后开始`);
                messageParts.push(`共 ${cycleLimit} 轮，每轮 ${batchSize} 个`);
            } else if (nextLaunchInMs !== null && remainingCount <= 0) {
                messageParts.push(`${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成`);
                messageParts.push(`下一轮还有 ${this._formatTimedRegistrationDuration(nextLaunchInMs)}`);
                messageParts.push(`累计已完成 ${sessionCompletedCount}/${totalPlannedCount}`);
            } else {
                messageParts.push(`${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}进行中`);
                messageParts.push(`本轮已完成 ${cycleCompletedCount}/${batchSize}`);
                if (remainingCount > 0) {
                    messageParts.push(`本轮剩余 ${remainingCount} 个`);
                }
                messageParts.push(`累计已完成 ${sessionCompletedCount}/${totalPlannedCount}`);
                if (sessionRemainingCount > 0) {
                    messageParts.push(`还剩 ${sessionRemainingCount} 个注册计划`);
                }
            }
            message = messageParts.join('，');
        }

        return {
            mode: 'timed',
            taskType: 'timed-registration-summary',
            sessionId: state.sessionId,
            taskId,
            taskLabel,
            taskNumber,
            progress,
            statusText,
            message,
            totalCount: batchSize,
            startedCount: cycleStartedCount,
            startingCount,
            completedCount: cycleCompletedCount,
            waitingCount,
            remainingCount,
            cycleLimit,
            currentCycleIndex,
            completedCycleCount: completedCyclesBeforeCurrent,
            sessionStartedCount,
            sessionCompletedCount,
            sessionRemainingCount,
            totalPlannedCount,
            cycleProgress: progress,
            sessionProgress,
            delayMs: state.delayMs,
            startMode: state.startMode,
            nextLaunchAt: normalizedNextLaunchAt,
            nextLaunchInMs,
            completed: !!options.completed,
            stage: options.stage || (
                waitingCount > 0 && remainingCount <= 0
                    ? 'finishing'
                    : options.completed || (sessionCompletedCount >= totalPlannedCount && currentCycleIndex >= cycleLimit && cycleCompletedCount >= batchSize)
                        ? 'completed'
                    : nextLaunchInMs !== null && remainingCount > 0
                        ? 'waiting'
                        : 'running'
            )
        };
    },

    _emitTimedRegistrationProgress(state = this.timedRegistrationState, options = {}) {
        if (!state || !this.mainWindow) {
            return null;
        }

        const payload = this._buildTimedRegistrationProgressPayload(state, options);
        if (!payload) {
            return null;
        }

        this._emitRegistrationCycleStatus(payload.message, payload);
        return payload;
    },

    _clearTimedRegistrationCountdownReporter(state = this.timedRegistrationState) {
        if (!state) {
            return;
        }

        if (state.reportTimer) {
            clearInterval(state.reportTimer);
            state.reportTimer = null;
        }

        state.nextLaunchAt = null;
    },

    _syncTimedRegistrationCountdownReporter(state = this.timedRegistrationState) {
        if (!state) {
            return;
        }

        const nextLaunchAt = this._getNextTimedRegistrationLaunchAt(state);
        state.nextLaunchAt = nextLaunchAt;

        if (!state.active || state.stopRequested || nextLaunchAt === null) {
            this._clearTimedRegistrationCountdownReporter(state);
            return;
        }

        if (state.reportTimer) {
            return;
        }

        state.reportTimer = setInterval(() => {
            const currentState = this.timedRegistrationState;
            if (!currentState || currentState !== state || currentState.sessionId !== this.timedRegistrationSessionId) {
                this._clearTimedRegistrationCountdownReporter(state);
                return;
            }

            if (!currentState.active || currentState.stopRequested) {
                this._clearTimedRegistrationCountdownReporter(state);
                return;
            }

            const currentNextLaunchAt = this._getNextTimedRegistrationLaunchAt(currentState);
            currentState.nextLaunchAt = currentNextLaunchAt;
            if (currentNextLaunchAt === null) {
                this._clearTimedRegistrationCountdownReporter(currentState);
                return;
            }

            const {
                batchSize,
                cycleLimit,
                totalPlannedCount
            } = this._getTimedRegistrationPlanTotals(currentState);
            const currentCycleIndex = Math.max(
                1,
                Math.min(
                    parseInt(currentState.currentCycleIndex, 10) || (parseInt(currentState.completedCycleCount, 10) || 0) + 1,
                    cycleLimit
                )
            );
            const isInitialWaiting = currentState.completedCount === 0 && currentState.cycleCompletedCount === 0 && currentCycleIndex === 1;
            const countdownLabel = isInitialWaiting ? '首轮' : '下一轮';
            const cycleLabel = this._getTimedRegistrationCycleLabel(currentState, currentCycleIndex);
            const payload = this._buildTimedRegistrationProgressPayload(currentState, {
                nextLaunchAt: currentNextLaunchAt,
                statusText: '等待下一次执行',
                message: isInitialWaiting
                    ? `定时注册倒计时：${countdownLabel}还有 ${this._formatTimedRegistrationDuration(currentNextLaunchAt - Date.now())}，本轮已完成 ${Math.max(0, currentState.cycleCompletedCount || 0)}/${batchSize}，累计已完成 ${Math.max(0, currentState.completedCount || 0)}/${totalPlannedCount}`
                    : `定时注册倒计时：${countdownLabel}还有 ${this._formatTimedRegistrationDuration(currentNextLaunchAt - Date.now())}，${cycleLabel}已完成，本轮已完成 ${Math.max(0, currentState.cycleCompletedCount || 0)}/${batchSize}，累计已完成 ${Math.max(0, currentState.completedCount || 0)}/${totalPlannedCount}`,
                stage: 'waiting'
            });

            if (!payload) {
                return;
            }

            this.logger.info(payload.message);
            this._emitRegistrationCycleStatus(payload.message, payload);
        }, 1000);
    },

    _clearTimedRegistrationTimers() {
        const state = this.timedRegistrationState;
        if (!state) {
            return;
        }

        if (state.pendingTimers && state.pendingTimers.size > 0) {
            for (const timerId of state.pendingTimers.keys()) {
                clearTimeout(timerId);
            }
            state.pendingTimers.clear();
        }

        this._clearTimedRegistrationCountdownReporter(state);
    },

    _isTimedRegistrationSessionActive() {
        const state = this.timedRegistrationState;
        return !!(state && state.active && !state.stopRequested);
    },

    _emitRegistrationCycleStatus(text, extra = {}) {
        if (this.mainWindow && text) {
            this.mainWindow.webContents.send('registration-cycle-status', {
                text,
                ...extra
            });
        }
    },

    _createTimedRegistrationState(config = {}) {
        const totalCount = Math.max(1, parseInt(config.timedRegistrationCount, 10) || 1);
        const cycleLimit = Math.max(1, parseInt(config.timedRegistrationCycleCount, 10) || 1);
        const delayMs = Math.max(0, parseInt(config.timedRegistrationDelayMs, 10) || 0);
        const startMode = config.timedRegistrationStartMode === 'delayed' ? 'delayed' : 'immediate';
        const state = {
            active: true,
            stopRequested: false,
            sessionId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            totalCount,
            cycleLimit,
            delayMs,
            startMode,
            currentCycleIndex: 1,
            completedCycleCount: 0,
            startedCount: 0,
            completedCount: 0,
            cycleStartedCount: 0,
            cycleCompletedCount: 0,
            startingCount: 0,
            pendingTimers: new Map(),
            reportTimer: null,
            nextLaunchAt: null
        };

        this.timedRegistrationState = state;
        this.timedRegistrationSessionId = state.sessionId;
        this.isTimedRunning = true;
        return state;
    },

    _finalizeTimedRegistrationSession(reason = '定时注册已完成') {
        const state = this.timedRegistrationState;
        if (!state) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );
        const finalPayload = this._buildTimedRegistrationProgressPayload(state, {
            completed: true,
            stage: 'completed',
            statusText: '已完成',
            message: `${reason}，第 ${currentCycleIndex}/${cycleLimit} 轮已完成，共完成 ${Math.max(0, state.completedCount || 0)}/${totalPlannedCount}（单轮 ${batchSize} 个，最多 ${cycleLimit} 轮）`
        });

        state.active = false;
        state.stopRequested = false;
        this._clearTimedRegistrationTimers();
        this.timedRegistrationState = null;
        this.timedRegistrationSessionId = null;
        this.isTimedRunning = false;

        if (finalPayload) {
            this._emitRegistrationCycleStatus(finalPayload.message, finalPayload);
        } else {
            this._emitRegistrationCycleStatus(reason, {
                mode: 'timed',
                completed: true
            });
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('all-tasks-finished');
        }

        return true;
    },

    async _launchTimedRegistrationCycle(state = this.timedRegistrationState, options = {}) {
        if (this.registrationStopRequested || !state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const normalizedCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(options.cycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );

        state.currentCycleIndex = normalizedCycleIndex;
        state.cycleStartedCount = 0;
        state.cycleCompletedCount = 0;
        state.startingCount = 0;
        this._clearTimedRegistrationCountdownReporter(state);

        const cycleLabel = this._getTimedRegistrationCycleLabel(state, normalizedCycleIndex);
        const initialMessage = options.message || `${cycleLabel}开始，本轮 ${batchSize} 个，累计计划 ${totalPlannedCount} 个`;

        this._emitTimedRegistrationProgress(state, {
            statusText: options.statusText || '执行中',
            message: initialMessage,
            stage: options.stage || 'running',
            taskNumber: cycleLabel
        });

        const initialLaunchCount = Math.min(this.concurrentCount, batchSize);
        for (let i = 0; i < initialLaunchCount; i++) {
            if (this.registrationStopRequested || !state.active || state.stopRequested || this.timedRegistrationState !== state) {
                break;
            }

            const launched = await this._launchTimedRegistrationTask(options.trigger || 'timed-cycle');
            if (!launched) {
                break;
            }
        }

        return true;
    },

    _scheduleTimedRegistrationCycleStart(state = this.timedRegistrationState, launchCycleIndex = 1, delayMs = 0, options = {}) {
        if (!state || !state.active || state.stopRequested || this.registrationStopRequested) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const normalizedLaunchCycleIndex = Math.max(
            1,
            Math.min(parseInt(launchCycleIndex, 10) || 1, cycleLimit)
        );
        const normalizedDelayMs = Math.max(0, parseInt(delayMs, 10) || 0);
        const displayCycleIndex = Math.max(
            0,
            Math.min(
                parseInt(options.displayCycleIndex, 10) || (normalizedLaunchCycleIndex > 1 ? normalizedLaunchCycleIndex - 1 : 0),
                cycleLimit
            )
        );

        if (state.pendingTimers && state.pendingTimers.size > 0) {
            for (const pendingTimerId of state.pendingTimers.keys()) {
                clearTimeout(pendingTimerId);
            }
            state.pendingTimers.clear();
        }

        const launchCycle = async (timerId = null) => {
            if (timerId && state.pendingTimers) {
                state.pendingTimers.delete(timerId);
            }

            if (this.timedRegistrationState !== state || state.sessionId !== this.timedRegistrationSessionId) {
                this._clearTimedRegistrationCountdownReporter(state);
                return false;
            }

            if (!state.active || state.stopRequested || this.registrationStopRequested) {
                this._clearTimedRegistrationCountdownReporter(state);
                return false;
            }

            state.completedCycleCount = Math.max(0, Math.min(normalizedLaunchCycleIndex - 1, Math.max(0, cycleLimit - 1)));
            return this._launchTimedRegistrationCycle(state, {
                cycleIndex: normalizedLaunchCycleIndex,
                trigger: options.trigger || (normalizedLaunchCycleIndex === 1 ? 'timed-start' : 'timed-delay')
            });
        };

        if (normalizedDelayMs === 0) {
            return launchCycle();
        }

        const nextLaunchAt = Date.now() + normalizedDelayMs;
        const timerId = setTimeout(() => {
            launchCycle(timerId).catch(error => {
                this.logger.error(`启动定时注册轮次失败: ${error.message}`);
            });
        }, normalizedDelayMs);

        if (!state.pendingTimers) {
            state.pendingTimers = new Map();
        }
        state.pendingTimers.set(timerId, nextLaunchAt);
        state.nextLaunchAt = nextLaunchAt;

        const isInitialStart = displayCycleIndex <= 0 && normalizedLaunchCycleIndex === 1 && state.completedCount === 0 && state.cycleCompletedCount === 0 && state.completedCycleCount === 0;
        const cycleLabel = displayCycleIndex > 0
            ? this._getTimedRegistrationCycleLabel(state, displayCycleIndex)
            : '首轮';
        const message = options.message || (
            isInitialStart
                ? `准备开始定时注册批次，共 ${cycleLimit} 轮，每轮 ${batchSize} 个，首轮将在 ${this._formatTimedRegistrationDuration(normalizedDelayMs)} 后开始`
                : `${cycleLabel}已完成，下一轮将在 ${this._formatTimedRegistrationDuration(normalizedDelayMs)} 后开始，累计计划 ${totalPlannedCount} 个`
        );

        this._emitTimedRegistrationProgress(state, {
            statusText: options.statusText || (isInitialStart ? '等待开始' : '等待下一轮'),
            message,
            stage: 'waiting',
            taskNumber: isInitialStart ? this._getTimedRegistrationCycleLabel(state, 1) : cycleLabel,
            nextLaunchAt
        });

        this._syncTimedRegistrationCountdownReporter(state);
        return true;
    },

    async _launchTimedRegistrationTask(trigger = 'timed-delay') {
        const state = this.timedRegistrationState;
        if (this.registrationStopRequested || !state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            batchSize,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);

        if (state.cycleStartedCount + state.startingCount >= batchSize) {
            return false;
        }

        if (this.runningTasks.size + state.startingCount >= this.concurrentCount) {
            return false;
        }

        state.startingCount += 1;

        try {
            const startResult = await this.startSingleRegistrationTask({
                taskLabel: this._getTimedRegistrationTaskLabel()
            });

            if (state.stopRequested || !state.active || this.timedRegistrationState !== state) {
                if (startResult && startResult.taskId && this.runningTasks.has(startResult.taskId)) {
                    const launchedTask = this.runningTasks.get(startResult.taskId);
                    if (launchedTask && typeof launchedTask.stop === 'function') {
                        launchedTask.stop('定时注册已停止');
                    }
                }
                return false;
            }

            if (!startResult || startResult.success !== true) {
                const errorText = startResult && startResult.error ? startResult.error : '未知错误';
                this.logger.error(`定时注册启动下一次任务失败: ${errorText}`);
                return false;
            }

            state.startedCount += 1;
            state.cycleStartedCount += 1;
            const remainingToLaunch = Math.max(0, batchSize - state.cycleStartedCount - state.startingCount);
            const currentCycleIndex = Math.max(
                1,
                Math.min(
                    parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                    Math.max(1, parseInt(state.cycleLimit, 10) || 1)
                )
            );
            const statusText = remainingToLaunch > 0
                ? `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}进行中... 已启动 ${state.cycleStartedCount}/${batchSize} 个，剩余 ${remainingToLaunch} 个`
                : `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已启动最后一个，本轮共 ${batchSize} 个`;

            this._emitTimedRegistrationProgress(state, {
                statusText: '执行中',
                message: statusText,
                trigger
            });

            this.logger.info(statusText);
            return true;
        } catch (error) {
            this.logger.error(`定时注册启动下一次任务异常: ${error.message}`);
            return false;
        } finally {
            state.startingCount = Math.max(0, state.startingCount - 1);
        }
    },

    _scheduleTimedRegistrationContinuation(taskId, result = {}) {
        const state = this.timedRegistrationState;
        if (!state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            cycleLimit
        } = this._getTimedRegistrationPlanTotals(state);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );

        if (currentCycleIndex >= cycleLimit) {
            if (this.runningTasks.size === 0 && state.startingCount === 0) {
                this._finalizeTimedRegistrationSession('定时注册已完成');
            }
            return false;
        }

        const delayMs = Math.max(0, state.delayMs || 0);
        const nextCycleIndex = currentCycleIndex + 1;
        const schedulePayload = this._buildTimedRegistrationProgressPayload(state, {
            statusText: delayMs > 0 ? '等待下一轮' : '执行中',
            message: delayMs > 0
                ? `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成，下一轮将在 ${this._formatTimedRegistrationDuration(delayMs)} 后开始`
                : `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成，立即开始下一轮`,
            stage: delayMs > 0 ? 'waiting' : 'running'
        });

        if (schedulePayload) {
            this.logger.info(schedulePayload.message);
            this._emitRegistrationCycleStatus(schedulePayload.message, schedulePayload);
        }

        return this._scheduleTimedRegistrationCycleStart(state, nextCycleIndex, delayMs, {
            displayCycleIndex: currentCycleIndex,
            trigger: 'timed-delay',
            statusText: delayMs > 0 ? '等待下一轮' : '执行中',
            message: schedulePayload ? schedulePayload.message : undefined
        });
    },

    async _handleTimedRegistrationTaskCompletion(taskId, result = {}, options = {}) {
        const state = this.timedRegistrationState;
        if (!state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );

        state.completedCount = Math.min(totalPlannedCount, (state.completedCount || 0) + 1);
        state.cycleCompletedCount = Math.min(batchSize, (state.cycleCompletedCount || 0) + 1);

        const remainingToLaunch = Math.max(0, batchSize - state.cycleStartedCount - state.startingCount);
        if (remainingToLaunch > 0 && !this.registrationStopRequested) {
            await this._launchTimedRegistrationTask(options.trigger || 'timed-cycle');
        }

        const waitingCount = this.runningTasks.size + state.startingCount;
        if (state.cycleCompletedCount >= batchSize) {
            if (waitingCount <= 0) {
                if (currentCycleIndex >= cycleLimit) {
                    this._finalizeTimedRegistrationSession('定时注册已完成');
                    return true;
                }

                return this._scheduleTimedRegistrationContinuation(taskId, result);
            }

            this._emitTimedRegistrationProgress(state, {
                waitingCount,
                statusText: '等待当前任务结束',
                message: `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成，等待 ${waitingCount} 个任务结束`,
                stage: 'finishing'
            });
            return true;
        }

        this._emitTimedRegistrationProgress(state, {
            waitingCount,
            statusText: waitingCount > 0 ? '执行中' : '等待任务启动',
            message: `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}进行中，已完成 ${state.cycleCompletedCount}/${batchSize}，累计已完成 ${state.completedCount}/${totalPlannedCount}`,
            stage: 'running'
        });
        return true;
    },

    async startRegistration(config) {
        try {
            config = this._resolveRegistrationStartConfig(config);
            this.logger.info?.(`注册器默认执行方案已参与启动: ${JSON.stringify(summarizeRegistrationDefaultExecutionPlan(this.registrationDefaultExecutionPlan || {}))}`);
            this.logger.info?.(`注册启动最终配置: ${JSON.stringify({
                runMode: config.runMode,
                concurrentCount: config.concurrentCount,
                syncEnabled: config.syncEnabled,
                maxProxyRecoveryAttempts: config.maxProxyRecoveryAttempts,
                timedRegistrationCount: config.timedRegistrationCount,
                timedRegistrationCycleCount: config.timedRegistrationCycleCount,
                timedRegistrationStartMode: config.timedRegistrationStartMode,
                timedRegistrationDelayMs: config.timedRegistrationDelayMs,
                server_card_name: String(config?.server_card_name || config?.serverCardName || '').trim(),
                browserSettings: summarizeRegistrationDefaultExecutionPlan({
                    browser_settings: config.browserSettings || config.browser_settings || {}
                }).browser_settings
            })}`);
            const runtimeDefaultCardName = String(config?.server_card_name || config?.serverCardName || '').trim();
            let directCardConfig = cloneRegistrationCardConfig(config?.cardData);
            if (!directCardConfig && !this.currentCard && runtimeDefaultCardName) {
                directCardConfig = cloneRegistrationCardConfig(await this.cardManager.getCard(runtimeDefaultCardName));
            }
            if (!directCardConfig && !this.currentCard) {
                return { success: false, error: '请先选择一个注册卡片' };
            }

            this.activeRegistrationCardConfig = directCardConfig;
            if (this.activeRegistrationCardConfig && !this.activeRegistrationCardConfig.name && config?.cardName) {
                this.activeRegistrationCardConfig.name = String(config.cardName || '').trim();
            }
            this.activeRegistrationCardName = String(
                this.activeRegistrationCardConfig?.name
                || config?.cardName
                || this.currentCard?.name
                || this.currentCardName
                || this.currentCard
                || ''
            ).trim();

            this.browserSettings = cloneRegistrationCardConfig(config.browserSettings || config.browser_settings) || {};
            if (this.browserSettings && typeof this.browserSettings === 'object') {
                this.currentBrowserType = String(
                    this.browserSettings.browser_type
                    || this.browserSettings.browserType
                    || this.currentBrowserType
                    || ''
                ).trim() || this.currentBrowserType;
            }

            this.lastRegistrationConfig = {
                ...(config || {}),
                cardData: this.activeRegistrationCardConfig ? cloneRegistrationCardConfig(this.activeRegistrationCardConfig) : undefined,
                cardName: this.activeRegistrationCardName
            };
            this.registrationStopRequested = false;
            this.runMode = Number.isFinite(Number(config.runMode)) ? Number(config.runMode) : 0;
            this.concurrentCount = toPositiveInteger(config.concurrentCount, 1, 1, 99);
            this.syncEnabled = config.syncEnabled === true;
            this.maxProxyRecoveryAttempts = toPositiveInteger(config.maxProxyRecoveryAttempts, 3, 1, 20);
            this.isLoopRunning = (this.runMode === 1);
            this.isTimedRunning = (this.runMode === 2);
            this.proxyRecoveryState = {
                active: false,
                attempts: 0
            };
            this._clearTimedRegistrationTimers();
            this.timedRegistrationState = null;
            this.timedRegistrationSessionId = null;

            if (this.isTimedRunning) {
                this._createTimedRegistrationState(config);
            }

            const modeLabel = this._getRegistrationModeLabel(this.runMode);
            const timedSummary = this.isTimedRunning && this.timedRegistrationState
                ? `, 单次数量: ${this.timedRegistrationState.totalCount}, 最大循环: ${this.timedRegistrationState.cycleLimit}, 间隔: ${this._formatTimedRegistrationDuration(this.timedRegistrationState.delayMs)}, 开始方式: ${this.timedRegistrationState.startMode === 'delayed' ? '延时开始' : '立即执行'}`
                : '';
            this.logger.info(`开始注册 - 模式: ${modeLabel}, 并发数: ${this.concurrentCount}, 同步: ${this.syncEnabled}, 自动恢复上限: ${this.maxProxyRecoveryAttempts}${timedSummary}`);

            if (this.syncEnabled && this.concurrentCount > 1) {
                this.stepSynchronizer = new StepSynchronizer(this.concurrentCount, this.logger);
            } else {
                this.stepSynchronizer = null;
            }

            if (this.isTimedRunning && this.timedRegistrationState) {
                const timedState = this.timedRegistrationState;
                const initialDelayMs = timedState.startMode === 'delayed' ? timedState.delayMs : 0;
                if (timedState.startMode === 'delayed' && initialDelayMs > 0) {
                    this._scheduleTimedRegistrationCycleStart(timedState, 1, initialDelayMs, {
                        displayCycleIndex: 0,
                        statusText: '等待开始'
                    });
                } else {
                    await this._launchTimedRegistrationCycle(timedState, {
                        cycleIndex: 1,
                        trigger: 'timed-start',
                        statusText: '执行中'
                    });
                }
            } else {
                const initialLaunchCount = Math.max(1, this.concurrentCount);
                this.logger.info(`启动初始注册任务: ${initialLaunchCount} 个`);

                for (let i = 0; i < initialLaunchCount; i++) {
                    if (this.registrationStopRequested) {
                        break;
                    }

                    const startResult = await this.startSingleRegistrationTask({
                        trigger: 'manual-start',
                        taskType: 'registration'
                    });

                    if (!startResult || startResult.success === false) {
                        throw new Error(startResult?.error || '启动注册任务失败');
                    }
                }
            }

            return { success: true };
        } catch (error) {
            if (this.timedRegistrationState) {
                this._clearTimedRegistrationTimers();
                this.timedRegistrationState.active = false;
                this.timedRegistrationState.stopRequested = true;
                this.timedRegistrationState = null;
                this.timedRegistrationSessionId = null;
                this.isTimedRunning = false;
            }
            this.logger.error(`开始注册失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async startSingleRegistrationTask(overrides = {}) {
        const taskType = overrides.taskType || 'registration';
        if (taskType === 'registration' && (this.registrationStopRequested || (this.timedRegistrationState && this.timedRegistrationState.stopRequested))) {
            return { success: false, error: '注册已停止' };
        }

        const taskId = overrides.taskId || `${taskType}_${Date.now()}_${this.runningTasks.size}`;
        const cardConfig = cloneRegistrationCardConfig(overrides.cardConfig)
            || cloneRegistrationCardConfig(this.activeRegistrationCardConfig)
            || await this.cardManager.getCard(this.currentCard);
        if (!cardConfig) {
            throw new Error(`无法获取卡片配置: ${this.activeRegistrationCardName || this.currentCard || '未命名卡片'}`);
        }

        const effectiveCardName = String(
            overrides.cardName
            || cardConfig?.name
            || this.activeRegistrationCardName
            || this.currentCard
            || ''
        ).trim();
        if (!cardConfig.name && effectiveCardName) {
            cardConfig.name = effectiveCardName;
        }

        if (taskType === 'registration' && (this.registrationStopRequested || (this.timedRegistrationState && this.timedRegistrationState.stopRequested))) {
            return { success: false, error: '注册已停止' };
        }

        const browserType = overrides.browserType || this.currentBrowserType;
        const browserSettings = overrides.browserSettings || this.browserSettings;
        if (taskType === 'registration' && browserSettings && typeof browserSettings === 'object' && browserSettings.headless === undefined) {
            browserSettings.headless = String(browserType || '').trim().toLowerCase() === 'electron' ? false : true;
        }
        const task = new RegistrationThread(taskId, cardConfig, {
            app: this,
            browserManager: this.browserManager,
            cookieManager: this.cookieManager,
            logger: this.logger,
            emailClient: this.emailClient,
            browserType,
            browserSettings,
            clashManager: this.clashManager,
            synchronizer: this.stepSynchronizer,
            cardKeyPrefix: this.getCardKeyPrefix ? this.getCardKeyPrefix() : '',
            contextVariables: overrides.contextVariables || {},
            initialCookies: Array.isArray(overrides.initialCookies) ? overrides.initialCookies : [],
            skipCookieSave: overrides.skipCookieSave || false,
            debugMode: overrides.debugMode || false,
            keepBrowserOpen: overrides.keepBrowserOpen || false,
            debugStepPauseMs: overrides.debugStepPauseMs,
            debugErrorPauseMs: overrides.debugErrorPauseMs
        });

        task.on('progress', (progress, message) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-progress', { taskId, progress, message });
            }
        });

        task.on('finished', async (result) => {
            const cardUploadConfig = (() => {
                const upload = cardConfig && typeof cardConfig.upload === 'object' ? cardConfig.upload : {};
                return {
                    cardName: effectiveCardName || cardConfig?.name || '',
                    serverUrl: cardConfig?.upload_server_url || cardConfig?.uploadServerUrl || upload.server_url || upload.serverUrl || '',
                    cardKey: cardConfig?.upload_card_key || cardConfig?.uploadCardKey || cardConfig?.card_key || upload.card_key || upload.cardKey || '',
                    minCookieSizeBytes: cardConfig?.min_cookie_size_bytes ?? cardConfig?.minCookieSizeBytes ?? cardConfig?.min_cookie_size ?? cardConfig?.minCookieSize ?? 8192,
                    targetScoreScope: cardConfig?.upload_target_score_scope || cardConfig?.uploadTargetScoreScope || upload.target_score_scope || upload.targetScoreScope || 'all',
                    targetScoreTypes: cardConfig?.upload_target_score_types || cardConfig?.uploadTargetScoreTypes || upload.target_score_types || upload.targetScoreTypes || []
                };
            })();
            const enrichedResult = (result && typeof result === 'object')
                ? {
                    ...result,
                    cardName: result.cardName || effectiveCardName || this.currentCard || '',
                    cardUploadConfig
                }
                : result;
            if (typeof overrides.onFinished === 'function') {
                await overrides.onFinished(taskId, enrichedResult);
                return;
            }
            await this.onRegistrationFinished(taskId, enrichedResult);
        });

        task.on('error', (error) => {
            if (typeof overrides.onError === 'function') {
                overrides.onError(taskId, error);
                return;
            }
            this.onRegistrationError(taskId, error);
        });

        task.on('browser-created', (browserId) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('browser-created', { taskId, browserId, taskType });
            }
        });

        this.runningTasks.set(taskId, task);
        task.start();

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-started', {
                taskId,
                taskNumber: this.runningTasks.size,
                taskType,
                taskLabel: overrides.taskLabel || (effectiveCardName || (taskType === 'debug' ? '调试任务' : '注册任务'))
            });
        }

        this.logger.info(`开始${taskType === 'debug' ? '调试' : '注册'}任务: ${taskId}`);
        await this.updateStats();
        return { success: true, taskId };
    },

    async startCardDebugTask(config = {}) {
        try {
            if (this.runningTasks.size > 0) {
                return { success: false, error: '当前已有任务在运行，请先停止后再调试' };
            }

            const cardData = config.cardData;
            if (!cardData || typeof cardData !== 'object') {
                return { success: false, error: '调试数据无效' };
            }

            if (!Array.isArray(cardData.steps) || cardData.steps.length === 0) {
                return { success: false, error: '调试步骤为空，请先配置至少一个步骤' };
            }

            const browserType = config.browserType || this.currentBrowserType;
            const baseBrowserSettings = (config.browserSettings || config.browser_settings) && typeof (config.browserSettings || config.browser_settings) === 'object'
                ? { ...(config.browserSettings || config.browser_settings) }
                : { ...this.browserSettings };

            baseBrowserSettings.headless = false;
            const pauseEachStep = config.pauseEachStep !== false;

            const startResult = await this.startSingleRegistrationTask({
                taskType: 'debug',
                taskLabel: '卡片调试',
                cardConfig: cardData,
                browserType,
                browserSettings: baseBrowserSettings,
                skipCookieSave: true,
                debugMode: true,
                keepBrowserOpen: true,
                debugStepPauseMs: pauseEachStep ? 3000 : 0,
                debugErrorPauseMs: 10000,
                onFinished: async (taskId, result) => {
                    if (this.runningTasks.has(taskId)) {
                        this.runningTasks.delete(taskId);
                    }

                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('task-finished', { taskId });
                        this.mainWindow.webContents.send('card-debug-finished', { taskId, result });
                    }

                    const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
                    this.logger.info(
                        `卡片调试任务 ${taskId} 完成${warningCount > 0 ? `，包含 ${warningCount} 个告警` : ''}`
                    );
                    await this.updateStats();
                },
                onError: (taskId, error) => {
                    if (this.runningTasks.has(taskId)) {
                        this.runningTasks.delete(taskId);
                    }

                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('task-finished', { taskId });
                        this.mainWindow.webContents.send('card-debug-error', { taskId, error });
                    }

                    this.logger.error(`卡片调试任务 ${taskId} 失败: ${error}`);
                    this.updateStats();
                }
            });

            if (startResult && startResult.success) {
                openCardDebugActionsWindow(this);
            }

            return startResult;
        } catch (error) {
            this.logger.error(`启动卡片调试失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async handleCardDebugAction(payload = {}) {
        const action = String(payload.action || '').trim();
        if (action !== 'get-random-email') {
            return { success: false, error: '不支持的调试动作' };
        }

        const debugEntry = Array.from(this.runningTasks.entries())
            .find(([taskId, task]) => String(taskId || '').startsWith('debug_') || task?.debugMode === true);
        if (!debugEntry) {
            return { success: false, error: '当前没有正在运行的卡片调试任务' };
        }

        const [taskId, task] = debugEntry;
        const email = String(task.generatedEmail || task.credentials?.email || task.cardConfig?.email || '').trim();
        if (!email) {
            return { success: false, error: '当前调试任务还没有生成随机邮箱' };
        }

        const result = {
            success: true,
            taskId,
            email,
            account: String(task.generatedAccount || '').trim()
        };
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(IPC_CHANNELS.cardDebugRandomEmail, result);
        }
        this.logger.info(`调试动作获取随机邮箱: ${email}`);
        return result;
    },

    async startHaikaBindingTask(config = {}) {
        try {
            if (this.haikaBindingState && (
                this.haikaBindingState.active ||
                this.haikaBindingState.runningCount > 0 ||
                this.haikaBindingState.queue.length > 0
            )) {
                return { success: false, error: '海卡绑定任务正在运行中' };
            }

            const cardName = config.cardName || this.currentHaikaBindCard;
            if (!cardName) {
                return { success: false, error: '请先选择一个海卡绑定卡片' };
            }

            const cardConfig = await this.cardManager.getHaikaBindCard(cardName);
            if (!cardConfig) {
                return { success: false, error: `无法获取海卡绑定卡片配置: ${cardName}` };
            }
            this.currentHaikaBindCard = cardName;

            const initialSmsCode = String(
                config.smsCode
                || config.sms_code
                || config.bindingContent?.smsCode
                || config.bindingContent?.sms_code
                || ''
            ).trim();
            const bindingContent = {
                ...(config.bindingContent || {}),
                ...(config.contextVariables || {})
            };
            bindingContent.sms_code = initialSmsCode || String(bindingContent.sms_code || bindingContent.smsCode || '').trim();
            bindingContent.smsCode = bindingContent.sms_code;
            const browserSettings = {
                ...(this.browserSettings && typeof this.browserSettings === 'object' ? this.browserSettings : {}),
                ...((config.browserSettings || config.browser_settings) && typeof (config.browserSettings || config.browser_settings) === 'object'
                    ? (config.browserSettings || config.browser_settings)
                    : {})
            };
            const browserType = String(
                config.browserType
                || browserSettings.browser_type
                || browserSettings.browserType
                || this.currentBrowserType
                || 'electron'
            ).trim() || 'electron';
            browserSettings.browser_type = browserType;
            browserSettings.browserType = browserType;
            browserSettings.headless = config.headless !== undefined
                ? config.headless
                : (browserSettings.headless !== undefined ? browserSettings.headless : false);

            const allCookies = await this.cookieManager.listCookies();
            let accountFolder = config.accountFolder || 'all';
            let accountFilter = config.accountFilter || 'all';
            let selectedAccounts = [];
            let concurrentCount = Math.max(1, parseInt(config.concurrentCount, 10) || 1);

            if (config.singleAccount) {
                const singleAccount = this.normalizeHaikaBindingAccount(config.singleAccount);
                if (!singleAccount) {
                    return { success: false, error: '单独绑卡账号信息无效' };
                }

                selectedAccounts = [singleAccount];
                accountFolder = singleAccount.card_name || accountFolder;
                accountFilter = `single:${singleAccount.aid || singleAccount.email || singleAccount.fileName || 'account'}`;
                concurrentCount = 1;
            } else {
                selectedAccounts = this.filterHaikaBindingAccounts(allCookies, accountFolder, accountFilter);
            }

            const batchId = `haika_bind_batch_${Date.now()}`;
            this.haikaBindingState = {
                active: true,
                stopRequested: false,
                batchId,
                cardName,
                cardConfig,
                bindingContent,
                browserType,
                browserSettings,
                accountFolder,
                accountFilter,
                concurrentCount,
                queue: [...selectedAccounts],
                runningCount: 0,
                total: selectedAccounts.length,
                completedCount: 0,
                successCount: 0,
                failCount: 0,
                nextTaskIndex: 0
            };

            if (this.mainWindow) {
                this.mainWindow.webContents.send('haika-binding-batch-started', {
                    batchId,
                    total: selectedAccounts.length,
                    concurrentCount,
                    cardName,
                    accountFolder,
                    accountFilter,
                    progress: 0,
                    message: '准备开始海卡绑定'
                });
            }

            if (selectedAccounts.length === 0) {
                this.logger.info(`海卡绑定没有找到符合条件的账号: 文件夹=${accountFolder}, 筛选=${accountFilter}`);
                await this.finishHaikaBindingBatch();
                return {
                    success: true,
                    batchId,
                    total: 0,
                    started: 0,
                    message: '未找到符合条件的账号'
                };
            }

            this.logger.info(`开始海卡绑定${config.singleAccount ? '单独任务' : '批量任务'} - 卡片: ${cardName}, 账号数: ${selectedAccounts.length}, 并发数: ${concurrentCount}, 文件夹: ${accountFolder}, 筛选: ${accountFilter}`);

            const startCount = Math.min(concurrentCount, selectedAccounts.length);
            for (let i = 0; i < startCount; i++) {
                await this.startNextHaikaBindingTask();
            }

            await this.updateStats();
            return {
                success: true,
                batchId,
                total: selectedAccounts.length,
                started: startCount,
                message: `海卡绑定批量任务已启动，共 ${selectedAccounts.length} 个账号`
            };
        } catch (error) {
            this.logger.error(`开始海卡绑定失败: ${error.message}`);
            if (this.haikaBindingState && this.haikaBindingState.runningCount === 0 && this.haikaBindingState.queue.length === 0) {
                try {
                    await this.finishHaikaBindingBatch();
                } catch (cleanupError) {
                    this.logger.warning(`清理海卡绑定状态失败: ${cleanupError.message}`);
                }
            }
            return { success: false, error: error.message };
        }
    },

    filterHaikaBindingAccounts(allCookies, accountFolder = 'all', accountFilter = 'all') {
        let targetCookies = Array.isArray(allCookies) ? [...allCookies] : [];

        if (accountFolder && accountFolder !== 'all') {
            targetCookies = targetCookies.filter(cookie => cookie.card_name === accountFolder);
        }

        if (accountFilter && accountFilter !== 'all') {
            if (accountFilter === 'points_unknown') {
                targetCookies = targetCookies.filter(cookie =>
                    cookie.points === null ||
                    cookie.points === undefined ||
                    cookie.points === 'null' ||
                    cookie.points === '' ||
                    isNaN(parseInt(cookie.points, 10))
                );
            } else if (accountFilter.startsWith('points_')) {
                const pointsValue = parseInt(accountFilter.replace('points_', ''), 10);
                if (!isNaN(pointsValue)) {
                    targetCookies = targetCookies.filter(cookie => {
                        if (cookie.points === null ||
                            cookie.points === undefined ||
                            cookie.points === 'null' ||
                            cookie.points === '' ||
                            isNaN(parseInt(cookie.points, 10))) {
                            return false;
                        }
                        return parseInt(cookie.points, 10) === pointsValue;
                    });
                }
            }
        }

        return targetCookies;
    },

    normalizeHaikaBindingAccount(accountInfo = {}) {
        if (!accountInfo || typeof accountInfo !== 'object') {
            return null;
        }

        const fileName = accountInfo.fileName || accountInfo.name || accountInfo.cookieFileName || '';
        if (!fileName) {
            return null;
        }

        const cardName = accountInfo.card_name || accountInfo.cardName || accountInfo.folder || '';

        return {
            ...accountInfo,
            aid: accountInfo.aid || accountInfo.id || '',
            email: accountInfo.email || accountInfo.account || '',
            account: accountInfo.account || accountInfo.email || accountInfo.aid || '',
            points: accountInfo.points,
            card_name: cardName,
            sourceCardName: accountInfo.sourceCardName || accountInfo.card_name || accountInfo.cardName || accountInfo.folder || cardName,
            sourceFilePath: accountInfo.sourceFilePath || accountInfo.filePath || '',
            fileName,
            name: accountInfo.name || fileName
        };
    },

    normalizeHaikaExpiryDate(expiryDate = '') {
        return normalizeHaikaExpiryDateValue(expiryDate);
    },

    extractHaikaBindingResponse(result = {}) {
        const response = result?.result || result?.response || result?.data || result || null;
        if (!response || typeof response !== 'object') {
            return null;
        }

        if (response.card && response.content) {
            return response;
        }

        if (response.result && response.result.card && response.result.content) {
            return response.result;
        }

        if (response.data && response.data.card && response.data.content) {
            return response.data;
        }

        return null;
    },

    async exchangeNextHaikaBindingCard(currentContext = {}, options = {}) {
        const previousLock = this._haikaBindingKeySwitchLock || Promise.resolve();
        let releaseLock = null;
        this._haikaBindingKeySwitchLock = new Promise(resolve => {
            releaseLock = resolve;
        });

        await previousLock.catch(() => {});

        try {
            const context = currentContext && typeof currentContext === 'object' ? currentContext : {};
            const normalizeText = (value) => String(value || '').trim();
            const requestedCategoryName = normalizeText(
                options.categoryName
                || context.haika_category
                || context.haikaCategory
                || '默认分类'
            ) || '默认分类';
            const stateBindingContent = this.haikaBindingState?.bindingContent && typeof this.haikaBindingState.bindingContent === 'object'
                ? this.haikaBindingState.bindingContent
                : null;
            const stateCategoryName = normalizeText(
                stateBindingContent?.haika_category
                || stateBindingContent?.haikaCategory
            );
            const categoryName = stateCategoryName || requestedCategoryName;
            let currentKey = normalizeText(
                options.currentKey
                || context.haika_key
                || context.haikaKey
            );
            let configuredIndex = parseInt(
                options.currentIndex
                ?? context.haika_key_index
                ?? context.haikaKeyIndex,
                10
            );

            if (stateBindingContent && (!stateCategoryName || stateCategoryName === categoryName)) {
                const globalKey = normalizeText(stateBindingContent.haika_key || stateBindingContent.haikaKey);
                const globalIndex = parseInt(
                    stateBindingContent.haika_key_index
                    ?? stateBindingContent.haikaKeyIndex,
                    10
                );

                if (globalKey) {
                    currentKey = globalKey;
                }
                if (Number.isFinite(globalIndex) && globalIndex > 0) {
                    configuredIndex = globalIndex;
                }
            }

            if (!currentKey) {
                try {
                    const latestState = typeof this.loadHaikaLatestState === 'function'
                        ? await this.loadHaikaLatestState({})
                        : null;
                    currentKey = normalizeText(latestState?.latestExchange?.key);
                } catch (_error) {}
            }

            if (!currentKey) {
                return { success: false, error: '缺少当前海卡卡密，无法切换到下一张' };
            }

            const haikaManager = await this.ensureHaikaManager();
            const keys = await haikaManager.loadCategoryKeys(categoryName);
            if (!Array.isArray(keys) || keys.length === 0) {
                return { success: false, error: `海卡分类 ${categoryName} 下没有可用卡密` };
            }

            let currentIndex = keys.findIndex(item => normalizeText(item?.key) === currentKey);
            if (currentIndex < 0 && Number.isFinite(configuredIndex) && configuredIndex > 0) {
                currentIndex = configuredIndex - 1;
            }

            if (currentIndex < 0) {
                return { success: false, error: `未在分类 ${categoryName} 中找到当前海卡卡密，无法切换下一张` };
            }

            const nextEntry = keys[currentIndex + 1];
            if (!nextEntry || !normalizeText(nextEntry.key)) {
                return { success: false, error: `海卡分类 ${categoryName} 已经没有下一张卡密可用` };
            }

            this.logger.info(`海卡绑定准备切换到下一张卡密: 分类=${categoryName}, 序号=${nextEntry.index}`);
            const exchangeResult = await this.licenseManager.exchangeHaikaKey(nextEntry.key);
            if (!exchangeResult || !exchangeResult.success) {
                return {
                    success: false,
                    error: exchangeResult?.error || `兑换下一张海卡失败: 序号 ${nextEntry.index}`
                };
            }

            if (typeof this.saveHaikaLatestExchange === 'function') {
                await this.saveHaikaLatestExchange({
                    key: nextEntry.key,
                    response: exchangeResult,
                    savedAt: new Date().toISOString(),
                    source: 'haika-binding-next-key'
                });
            }

            const binding = this.extractHaikaBindingResponse(exchangeResult);
            if (!binding || !binding.content || typeof binding.content !== 'object') {
                return { success: false, error: `海卡兑换成功，但未返回可用的绑定信息: 序号 ${nextEntry.index}` };
            }

            if (this.haikaBindingState && this.haikaBindingState.bindingContent) {
                this.haikaBindingState.bindingContent = {
                    ...this.haikaBindingState.bindingContent,
                    ...binding.content,
                    haika_key: nextEntry.key,
                    haikaKey: nextEntry.key,
                    haika_key_index: nextEntry.index,
                    haikaKeyIndex: nextEntry.index,
                    haika_category: categoryName,
                    haikaCategory: categoryName
                };
            }

            return {
                success: true,
                key: nextEntry.key,
                index: nextEntry.index,
                categoryName,
                binding,
                bindingContent: binding.content
            };
        } finally {
            if (typeof releaseLock === 'function') {
                releaseLock();
            }
        }
    },

    buildHaikaBindingContext(bindingContent = {}, accountInfo = {}, smsCode = '') {
        const mergedAccount = {
            ...accountInfo,
            email: accountInfo.email || accountInfo.account || '',
            password: accountInfo.password || '',
            account: accountInfo.email || accountInfo.account || accountInfo.aid || '',
            account_type: accountInfo.card_name || '',
            account_folder: accountInfo.card_name || '',
            points: accountInfo.points,
            aid: accountInfo.aid || '',
            file_name: accountInfo.fileName || '',
            created_at: accountInfo.createdAt || ''
        };

        return {
            ...bindingContent,
            ...mergedAccount,
            card_number: bindingContent.card_number || '',
            expiry_date: normalizeHaikaExpiryDateValue(bindingContent.expiry_date || ''),
            cvv: bindingContent.cvv || '',
            name: bindingContent.name || '',
            phone: bindingContent.phone || '',
            address: bindingContent.address || '',
            sms_code: smsCode || bindingContent.sms_code || bindingContent.smsCode || '',
            smsCode: smsCode || bindingContent.smsCode || bindingContent.sms_code || '',
            haika_key: bindingContent.haika_key || bindingContent.haikaKey || '',
            haikaKey: bindingContent.haikaKey || bindingContent.haika_key || '',
            haika_key_index: bindingContent.haika_key_index || bindingContent.haikaKeyIndex || '',
            haikaKeyIndex: bindingContent.haikaKeyIndex || bindingContent.haika_key_index || '',
            haika_category: bindingContent.haika_category || bindingContent.haikaCategory || '',
            haikaCategory: bindingContent.haikaCategory || bindingContent.haika_category || '',
            email: mergedAccount.email || bindingContent.email || '',
            password: mergedAccount.password || bindingContent.password || '',
            account: mergedAccount.account || bindingContent.account || ''
        };
    },

    async startNextHaikaBindingTask() {
        const state = this.haikaBindingState;
        if (!state || !state.active || state.stopRequested) {
            return false;
        }

        if (state.runningCount >= state.concurrentCount) {
            return true;
        }

        const accountInfo = state.queue.shift();
        if (!accountInfo) {
            return false;
        }

        const taskIndex = state.nextTaskIndex++;
        const taskId = `haika_bind_${Date.now()}_${taskIndex}`;
        const contextVariables = this.buildHaikaBindingContext(
            state.bindingContent,
            accountInfo,
            state.bindingContent?.sms_code || state.bindingContent?.smsCode || ''
        );
        const initialCookies = await this.cookieManager.getCookieDataByFile(
            accountInfo.sourceCardName || accountInfo.card_name,
            accountInfo.fileName,
            accountInfo.sourceFilePath
        );
        if (initialCookies.length > 0) {
            this.logger.info(`准备注入海卡绑定Cookie: ${(accountInfo.sourceCardName || accountInfo.card_name)}/${accountInfo.fileName} (${initialCookies.length} 条)`);
        } else {
            this.logger.warning(`未找到可注入的Cookie: ${(accountInfo.sourceCardName || accountInfo.card_name)}/${accountInfo.fileName}`);
        }

        const task = new RegistrationThread(taskId, state.cardConfig, {
            app: this,
            browserManager: this.browserManager,
            cookieManager: this.cookieManager,
            logger: this.logger,
            emailClient: this.emailClient,
            browserType: state.browserType,
            browserSettings: state.browserSettings,
            clashManager: this.clashManager,
            skipCookieSave: true,
            contextVariables,
            initialCookies,
            applyCardKeyPrefix: false
        });

        task.credentials.email = accountInfo.email || accountInfo.account || task.credentials.email || '';
        task.credentials.password = accountInfo.password || task.credentials.password || '';
        task.generatedAccount = accountInfo.email || accountInfo.account || accountInfo.aid || '';

        task.on('progress', (progress, message) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-progress', { taskId, progress, message, taskType: 'haika-binding' });
            }
        });

        task.on('finished', async (result) => {
            await this.onHaikaBindingFinished(taskId, result, accountInfo);
        });

        task.on('error', (error) => {
            this.onHaikaBindingError(taskId, error, accountInfo);
        });

        task.on('browser-created', (browserId) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('browser-created', { taskId, browserId, taskType: 'haika-binding' });
            }
        });

        state.runningCount += 1;
        this.runningTasks.set(taskId, task);

        try {
            task.start();
        } catch (error) {
            this.logger.error(`启动海卡绑定任务失败: ${error.message}`);
            this.onHaikaBindingError(taskId, error, accountInfo);
            return false;
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-started', {
                taskId,
                taskNumber: `${Math.max(1, state.completedCount + state.runningCount)}/${state.total}`,
                taskType: 'haika-binding',
                batchId: state.batchId,
                parentTaskId: state.batchId,
                parentTaskLabel: '海卡绑定批次',
                taskLabel: accountInfo.email || accountInfo.account || accountInfo.aid || '海卡绑定任务'
            });
        }

        this.logger.info(`开始海卡绑定任务: ${taskId} (卡片: ${state.cardName}, 账号: ${accountInfo.email || accountInfo.account || accountInfo.aid || '未知'})`);
        return true;
    },

    async finishHaikaBindingBatch() {
        const state = this.haikaBindingState;
        if (!state) {
            this.haikaBindingState = null;
            return;
        }

        if (state.runningCount > 0 || state.queue.length > 0) {
            return;
        }

        state.active = false;

        const summary = {
            batchId: state.batchId,
            cardName: state.cardName,
            total: state.total,
            successCount: state.successCount,
            failCount: state.failCount,
            stopped: !!state.stopRequested
        };

        this.logger.info(`海卡绑定批量完成 - 总计: ${summary.total}, 成功: ${summary.successCount}, 失败: ${summary.failCount}`);

        if (this.mainWindow) {
            this.mainWindow.webContents.send('haika-binding-batch-finished', summary);
        }

        this.haikaBindingState = null;
        await this.updateStats();
    },

    emitHaikaBindingProgress() {
        const state = this.haikaBindingState;
        if (!state || !this.mainWindow) {
            return;
        }

        const total = state.total || 0;
        const completed = Math.min(state.completedCount || 0, total);
        const progress = total > 0 ? Math.round((completed / total) * 100) : 100;
        const message = total > 0
            ? `已完成 ${completed}/${total} 个账号 (成功: ${state.successCount}, 失败: ${state.failCount})`
            : '未找到符合条件的账号';

        this.mainWindow.webContents.send('haika-binding-batch-progress', {
            batchId: state.batchId,
            progress,
            message,
            total,
            completed,
            successCount: state.successCount,
            failCount: state.failCount,
            runningCount: state.runningCount
        });
    },

    async stopHaikaBinding() {
        const state = this.haikaBindingState;
        if (!state) {
            return { success: false, error: '当前没有正在运行的海卡绑定任务' };
        }

        state.stopRequested = true;
        state.active = false;
        state.queue = [];

        const closePromises = [];
        for (const [taskId, task] of this.runningTasks) {
            if (taskId && String(taskId).startsWith('haika_bind_')) {
                try {
                    task.stop('海卡绑定任务已停止');
                    if (task.browserId) {
                        closePromises.push(
                            this.browserManager.closeBrowser(task.browserId).catch(error => {
                                this.logger.warning(`关闭海卡绑定浏览器失败: ${taskId} - ${error.message}`);
                            })
                        );
                    }
                } catch (error) {
                    this.logger.warning(`停止海卡绑定任务失败: ${taskId} - ${error.message}`);
                }
            }
        }

        if (closePromises.length > 0) {
            await Promise.allSettled(closePromises);
        }

        this.logger.info('海卡绑定停止请求已发送');
        this.emitHaikaBindingProgress();
        if (state.runningCount === 0 && state.queue.length === 0) {
            await this.finishHaikaBindingBatch();
        }
        return { success: true };
    },

    getErrorText(error) {
        if (!error) {
            return '';
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error instanceof Error) {
            return error.message || error.toString();
        }
        if (typeof error.message === 'string') {
            return error.message;
        }
        try {
            return JSON.stringify(error);
        } catch (jsonError) {
            return String(error);
        }
    },

    isProxyRelatedError(error) {
        const text = this.getErrorText(error).toLowerCase();
        if (!text) {
            return false;
        }

        const patterns = [
            /net::err_/i,
            /net::err_proxy_connection_failed/i,
            /net::err_tunnel_connection_failed/i,
            /net::err_timed_out/i,
            /err_connection/i,
            /econnreset/i,
            /econnrefused/i,
            /etimedout/i,
            /ehostunreach/i,
            /enetunreach/i,
            /eai_again/i,
            /socket hang up/i,
            /socket closed/i,
            /connection reset/i,
            /fetch failed/i,
            /proxy/i,
            /browser has been closed/i,
            /target closed/i,
            /page crashed/i,
            /网络错误/i,
            /连接超时/i,
            /无法连接/i,
            /代理.*失败/i
        ];

        return patterns.some(pattern => pattern.test(text));
    },

    async stopRunningTasksForRecovery() {
        for (const [taskId, task] of this.runningTasks) {
            try {
                task.stop('代理恢复前停止任务');
                this.logger.info(`代理恢复前停止任务: ${taskId}`);
            } catch (error) {
                this.logger.warning(`停止任务 ${taskId} 失败: ${error.message}`);
            }
        }

        this.runningTasks.clear();

        if (this.stepSynchronizer && typeof this.stepSynchronizer.reset === 'function') {
            try {
                this.stepSynchronizer.reset();
            } catch (error) {
                this.logger.debug(`重置同步器失败: ${error.message}`);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            const browserCount = this.browserManager.getBrowserCount();
            if (browserCount > 0) {
                this.logger.warning(`代理恢复前仍有 ${browserCount} 个浏览器实例未关闭，执行强制清理`);
                await this.browserManager.closeAll();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            this.logger.warning(`代理恢复前清理浏览器失败: ${error.message}`);
        }
    },

    async getNextProxyNodeForRecovery() {
        this.clashManager.setLogger(this.logger);

        const status = await this.clashManager.getStatus();
        if (!status.success) {
            throw new Error(`获取Clash状态失败: ${status.error}`);
        }

        const profileUid = status.data.currentUid;
        if (!profileUid) {
            throw new Error('未找到当前订阅UID，无法切换节点');
        }

        const nodesResult = await this.clashManager.getProfileNodes(profileUid);
        if (!nodesResult.success) {
            throw new Error(`获取订阅节点失败: ${nodesResult.error}`);
        }

        const nodes = Array.isArray(nodesResult.nodes)
            ? [...new Set(nodesResult.nodes)].filter(name => name && !['DIRECT', 'REJECT', 'GLOBAL'].includes(name))
            : [];

        if (nodes.length < 2) {
            throw new Error('可用节点少于2个，无法自动切换');
        }

        const currentNode = status.data.currentNode || '';
        let nextIndex = nodes.indexOf(currentNode);

        if (nextIndex === -1) {
            nextIndex = 0;
        } else {
            nextIndex = (nextIndex + 1) % nodes.length;
        }

        if (nodes[nextIndex] === currentNode && nodes.length > 1) {
            nextIndex = (nextIndex + 1) % nodes.length;
        }

        return {
            profileUid,
            profileName: status.data.currentProfileName || '',
            currentNode,
            nextNode: nodes[nextIndex],
            nodes
        };
    },

    async recoverFromProxyError(taskId, error) {
        const errorText = this.getErrorText(error);

        if (!this.isLoopRunning && !this.isTimedRunning) {
            return false;
        }

        if (!this.isProxyRelatedError(errorText)) {
            return false;
        }

        if (this.proxyRecoveryState.active) {
            this.logger.warning(`任务 ${taskId} 命中代理错误，但恢复流程已在进行中`);
            return true;
        }

        if (this.proxyRecoveryState.attempts >= this.maxProxyRecoveryAttempts) {
            this.logger.error(`代理自动恢复已达到最大次数 ${this.maxProxyRecoveryAttempts}，停止自动切换`);
            this.isLoopRunning = false;
            this.isTimedRunning = false;
            if (this.timedRegistrationState) {
                this._clearTimedRegistrationTimers();
                this.timedRegistrationState.active = false;
                this.timedRegistrationState.stopRequested = true;
            }
            return false;
        }

        this.proxyRecoveryState.active = true;
        this.proxyRecoveryState.attempts += 1;

        try {
            this.logger.warning(`检测到疑似代理错误: ${errorText}`);
            this.logger.info(`开始第 ${this.proxyRecoveryState.attempts}/${this.maxProxyRecoveryAttempts} 次代理节点切换恢复`);

            await this.stopRunningTasksForRecovery();

            this.clashManager.setLogger(this.logger);
            const proxyEnabled = await this.clashManager.setSystemProxy(true, this.browserSettings || {});
            if (proxyEnabled) {
                this.logger.info('系统代理已开启，继续切换下一个节点');
            } else {
                this.logger.warning('系统代理开启失败，仍继续尝试切换下一个节点');
            }

            const target = await this.getNextProxyNodeForRecovery();
            this.logger.info(`准备切换节点: ${target.profileName || target.profileUid} - ${target.currentNode || '未知'} -> ${target.nextNode}`);

            const switchResult = await this.clashManager.switchNode(target.profileUid, target.nextNode);
            if (!switchResult.success) {
                throw new Error(switchResult.error || '切换节点失败');
            }

            this.logger.info(`代理节点切换成功: ${switchResult.data.profileName} -> ${switchResult.data.newNode}`);
            await new Promise(resolve => setTimeout(resolve, this.proxyRecoveryCooldownMs));

            if (this.isLoopRunning) {
                this.logger.info('代理恢复完成，重新启动注册循环');

                if (this.syncEnabled && this.concurrentCount > 1) {
                    this.stepSynchronizer = new StepSynchronizer(this.concurrentCount, this.logger);
                } else {
                    this.stepSynchronizer = null;
                }

                for (let i = 0; i < this.concurrentCount; i++) {
                    await this.startSingleRegistrationTask();
                }
            } else if (this.isTimedRunning && this.timedRegistrationState) {
                this.logger.info('代理恢复完成，定时注册将按原有延时策略继续');
            }

            return true;
        } catch (recoverError) {
            this.logger.error(`代理自动切换恢复失败: ${recoverError.message}`);
            this.isLoopRunning = false;
            this.isTimedRunning = false;
            if (this.timedRegistrationState) {
                this._clearTimedRegistrationTimers();
                this.timedRegistrationState.active = false;
                this.timedRegistrationState.stopRequested = true;
            }
            return false;
        } finally {
            this.proxyRecoveryState.active = false;
        }
    },

    async onRegistrationFinished(taskId, result) {
        const browserClosed = result?.browserClosed === true
            || /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(this.getErrorText(result?.error || ''));
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (this.registrationStopRequested) {
            await this.updateStats();
            return;
        }

        if (result.success) {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-finished', {
                    taskId,
                    taskLabel: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || '注册任务',
                    taskType: 'registration'
                });
            }
            this.logger.info(`任务 ${taskId} 成功完成`);
            if (typeof this.notifyRegistrationTcpSuccess === 'function') {
                try {
                    const tcpResult = await this.notifyRegistrationTcpSuccess({
                        taskId,
                        email: result.email,
                        points: result.points,
                        cardName: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || '',
                        cookiesSaved: result.cookiesSaved === true
                    });
                    if (tcpResult && tcpResult.ok === false) {
                        this.logger.warning(`注册成功通知未发送: ${tcpResult.message || '未知原因'}`);
                    }
                } catch (error) {
                    this.logger.warning(`注册成功通知发送失败: ${error.message}`);
                }
            }
            if (this.mainWindow) {
                this.mainWindow.webContents.send('registration-result', {
                    taskId,
                    result
                });
            }
            if (this.mainWindow && !this.isLoopRunning) {
                this.mainWindow.webContents.send('registration-success', {
                    email: result.email,
                    points: result.points,
                    result
                });
            }

            if (result.cookiesSaved && this.mainWindow) {
                this.logger.info('检测到Cookie保存成功，发送刷新消息');
                this.mainWindow.webContents.send('cookies-refreshed', { success: true });
            }
        } else {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-error', {
                    taskId,
                    error: result.error || result.message || '注册任务失败',
                    taskLabel: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || '注册任务',
                    taskType: 'registration',
                    statusKey: 'error'
                });
            }
            this.logger.error(`任务 ${taskId} 失败: ${result.error}`);
            let proxyRecovered = false;
            if (browserClosed) {
                this.logger.warning(`任务 ${taskId} 因浏览器关闭而结束，不再继续当前流程`);
                if (this.isLoopRunning || this._isTimedRegistrationSessionActive()) {
                    proxyRecovered = await this.recoverFromProxyError(taskId, result.error || result.message || '浏览器关闭');
                }

                if (!this._isTimedRegistrationSessionActive()) {
                    if (!proxyRecovered) {
                        this.isLoopRunning = false;
                        if (this.mainWindow && !this.isLoopRunning) {
                            this.mainWindow.webContents.send('registration-error', { error: result.error });
                            if (this.runningTasks.size === 0) {
                                this.mainWindow.webContents.send('all-tasks-finished');
                            }
                        }
                    }
                    await this.updateStats();
                    return;
                }

                if (!proxyRecovered && this.mainWindow && !this.isLoopRunning) {
                    this.mainWindow.webContents.send('registration-error', { error: result.error });
                }
            } else {
                proxyRecovered = await this.recoverFromProxyError(taskId, result.error);
                if (proxyRecovered) {
                    if (this.isLoopRunning) {
                        await this.updateStats();
                        return;
                    }
                } else if (this.mainWindow && !this.isLoopRunning) {
                    this.mainWindow.webContents.send('registration-error', { error: result.error });
                }
            }

        }

        if (this.proxyRecoveryState.active) {
            await this.updateStats();
            return;
        }

        if (this._isTimedRegistrationSessionActive()) {
            await this._handleTimedRegistrationTaskCompletion(taskId, result, {
                trigger: 'timed-complete'
            });
            await this.updateStats();
            return;
        }

        if (this.isLoopRunning) {
            if (this.syncEnabled && this.concurrentCount > 1) {
                if (this.runningTasks.size === 0) {
                    this.logger.info('所有同步任务已完成，开始下一轮循环');
                    this.stepSynchronizer = new StepSynchronizer(this.concurrentCount, this.logger);

                    for (let i = 0; i < this.concurrentCount; i++) {
                        await this.startSingleRegistrationTask();
                    }
                }
            } else {
                if (this.runningTasks.size < this.concurrentCount) {
                    await this.startSingleRegistrationTask();
                }
            }
        } else if (this.runningTasks.size === 0) {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('all-tasks-finished');
            }
            this.isLoopRunning = false;
        }

        await this.updateStats();
    },

    async onHaikaBindingFinished(taskId, result, accountInfo = null) {
        const state = this.haikaBindingState;
        const browserClosed = result?.browserClosed === true
            || /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(this.getErrorText(result?.error || ''));
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-finished', { taskId });
        }

        if (result && result.success) {
            this.logger.info(`海卡绑定任务 ${taskId} 成功完成`);
            if (state) {
                state.successCount += 1;
                state.completedCount += 1;
            }

            const resolvedEmail = (accountInfo && (accountInfo.email || accountInfo.account || accountInfo.aid))
                || result.email
                || '';
            const resolvedCardName = (accountInfo && (accountInfo.card_name || accountInfo.cardName))
                || state?.cardName
                || '';
            const previousCreditsValue = Number.parseInt(accountInfo?.points, 10);
            const hasPreviousCredits = Number.isFinite(previousCreditsValue);
            const previousCredits = hasPreviousCredits ? previousCreditsValue : Number.parseInt(result.points, 10);
            const newCreditsValue = Number.parseInt(result?.points, 10);

            if (resolvedEmail && resolvedCardName && Number.isFinite(newCreditsValue)) {
                try {
                    let updateSuccess = false;
                    if (accountInfo?.sourceFilePath && typeof this.cookieManager.updateCookiePointsBySource === 'function') {
                        updateSuccess = await this.cookieManager.updateCookiePointsBySource(
                            accountInfo.sourceCardName || resolvedCardName,
                            accountInfo.sourceFilePath,
                            newCreditsValue
                        );
                    } else if (accountInfo?.fileName && typeof this.cookieManager.updateCookiePointsByFile === 'function') {
                        updateSuccess = await this.cookieManager.updateCookiePointsByFile(
                            resolvedCardName,
                            accountInfo.fileName,
                            newCreditsValue
                        );
                    }

                    if (!updateSuccess && typeof this.cookieManager.updateCookiePoints === 'function') {
                        updateSuccess = await this.cookieManager.updateCookiePoints(
                            resolvedEmail,
                            resolvedCardName,
                            newCreditsValue
                        );
                    }

                    if (!updateSuccess && typeof this.cookieManager.updateLatestCookiePoints === 'function') {
                        updateSuccess = await this.cookieManager.updateLatestCookiePoints(
                            resolvedCardName,
                            newCreditsValue
                        );
                    }

                    if (updateSuccess) {
                        if (accountInfo) {
                            accountInfo.points = newCreditsValue;
                        }

                        const change = Number.isFinite(previousCredits) ? (newCreditsValue - previousCredits) : 0;
                        const changeText = change > 0
                            ? `(+${change})`
                            : change < 0
                                ? `(${change})`
                                : '(无变化)';

                        this.logger.info(`海卡绑定积分已同步回写: ${resolvedEmail} (${previousCredits ?? 'unknown'} -> ${newCreditsValue})`);

                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('cookie-credits-changed', {
                                email: resolvedEmail,
                                cardName: resolvedCardName,
                                oldCredits: Number.isFinite(previousCredits) ? previousCredits : newCreditsValue,
                                newCredits: newCreditsValue,
                                change,
                                changeText,
                                aid: accountInfo?.aid || null
                            });
                            this.mainWindow.webContents.send('cookies-refreshed', {
                                success: true,
                                source: 'haika-binding',
                                email: resolvedEmail,
                                cardName: resolvedCardName,
                                newCredits: newCreditsValue
                            });
                        }
                    } else {
                        this.logger.warning(`海卡绑定积分回写失败: ${resolvedEmail} (${resolvedCardName})`);
                    }
                } catch (syncError) {
                    this.logger.warning(`海卡绑定积分回写异常: ${syncError.message}`);
                }
            } else {
                this.logger.warning(`海卡绑定成功但缺少回写积分所需信息: email=${resolvedEmail || 'unknown'}, card=${resolvedCardName || 'unknown'}, points=${result?.points ?? 'unknown'}`);
            }

            if (this.mainWindow && !(state && state.stopRequested)) {
                this.mainWindow.webContents.send('haika-binding-success', {
                    taskId,
                    result
                });
            }
        } else {
            const errorText = result?.error || result?.message || '海卡绑定失败';
            this.logger.error(`海卡绑定任务 ${taskId} 失败: ${errorText}`);
            if (state) {
                state.failCount += 1;
                state.completedCount += 1;
                if (browserClosed) {
                    state.active = false;
                    state.stopRequested = true;
                    state.queue = [];
                    this.logger.warning('检测到浏览器关闭，海卡绑定批次已停止继续派发任务');
                }
            }
            if (this.mainWindow && !(state && state.stopRequested)) {
                this.mainWindow.webContents.send('haika-binding-error', {
                    taskId,
                    error: errorText
                });
            }
        }

        if (state) {
            state.runningCount = Math.max(0, state.runningCount - 1);
            this.emitHaikaBindingProgress();
            if (state.active && !state.stopRequested) {
                await this.startNextHaikaBindingTask();
            }
            if (state.runningCount === 0 && state.queue.length === 0) {
                await this.finishHaikaBindingBatch();
                return;
            }
        }

        await this.updateStats();
    },

    onRegistrationError(taskId, error) {
        this.logger.error(`任务 ${taskId} 错误: ${error}`);
        const errorText = this.getErrorText(error);
        const browserClosed = /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(errorText);
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-error', { taskId, error: errorText });
        }

        if (this.registrationStopRequested) {
            this.updateStats().catch(updateError => {
                this.logger.error(`更新统计失败: ${updateError.message}`);
            });
            return;
        }

        if (this.proxyRecoveryState.active) {
            return;
        }

        if (browserClosed) {
            this.logger.warning(`任务 ${taskId} 因浏览器关闭而终止，不再继续当前流程`);
            if (!this._isTimedRegistrationSessionActive()) {
                this.isLoopRunning = false;
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('registration-error', { error: errorText });
                    if (this.runningTasks.size === 0) {
                        this.mainWindow.webContents.send('all-tasks-finished');
                    }
                }
                this.updateStats().catch(updateError => {
                    this.logger.error(`更新统计失败: ${updateError.message}`);
                });
                return;
            }
        }

        this.recoverFromProxyError(taskId, error).then(async (recovered) => {
            if (!recovered && this.mainWindow && !this.isLoopRunning) {
                this.mainWindow.webContents.send('registration-error', { error });
            }

            if (this._isTimedRegistrationSessionActive()) {
                await this._handleTimedRegistrationTaskCompletion(taskId, { success: false, error: errorText }, {
                    trigger: 'timed-error'
                });
                await this.updateStats();
                return;
            }
            await this.updateStats();
        }).catch(async (recoverError) => {
            this.logger.error(`处理任务 ${taskId} 失败时发生异常: ${recoverError.message}`);
            if (this.mainWindow && !this.isLoopRunning) {
                this.mainWindow.webContents.send('registration-error', { error });
            }

            if (this._isTimedRegistrationSessionActive()) {
                await this._handleTimedRegistrationTaskCompletion(taskId, { success: false, error: errorText }, {
                    trigger: 'timed-error'
                });
                await this.updateStats();
                return;
            }
            await this.updateStats();
        });
    },

    onHaikaBindingError(taskId, error) {
        const state = this.haikaBindingState;
        const errorText = this.getErrorText(error);
        const browserClosed = /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(errorText);
        this.logger.error(`海卡绑定任务 ${taskId} 错误: ${errorText}`);

        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (state) {
            state.failCount += 1;
            state.completedCount += 1;
            state.runningCount = Math.max(0, state.runningCount - 1);
            if (browserClosed) {
                state.active = false;
                state.stopRequested = true;
                state.queue = [];
                this.logger.warning('检测到浏览器关闭，海卡绑定批次已停止继续派发任务');
            }
            this.emitHaikaBindingProgress();
        }

        if (this.mainWindow && !(state && state.stopRequested)) {
            this.mainWindow.webContents.send('task-error', {
                taskId,
                error: errorText,
                parentTaskId: state?.batchId || '',
                parentTaskLabel: '海卡绑定批次'
            });
            this.mainWindow.webContents.send('haika-binding-error', {
                taskId,
                error: errorText
            });
        }

        if (state && state.active && !state.stopRequested) {
            this.startNextHaikaBindingTask()
                .then(() => {
                    return this.updateStats();
                })
                .catch(updateError => {
                    this.logger.error(`推进海卡绑定队列失败: ${updateError.message}`);
                });
        }

        if (state && state.runningCount === 0 && state.queue.length === 0) {
            this.finishHaikaBindingBatch()
                .catch(finishError => {
                    this.logger.error(`结束海卡绑定批次失败: ${finishError.message}`);
                });
            return;
        }

        this.updateStats().catch(updateError => {
            this.logger.error(`更新海卡绑定统计失败: ${updateError.message}`);
        });
    },

    async stopRegistration(options = {}) {
        const {
            closeBrowsers = true
        } = options;

        this.registrationStopRequested = true;
        this.isLoopRunning = false;
        this.isTimedRunning = false;
        this.proxyRecoveryState.active = false;
        this.proxyRecoveryState.attempts = 0;
        if (this.timedRegistrationState) {
            this.timedRegistrationState.active = false;
            this.timedRegistrationState.stopRequested = true;
        }
        this._clearTimedRegistrationTimers();
        this.timedRegistrationState = null;
        this.timedRegistrationSessionId = null;
        this.activeRegistrationCardConfig = null;
        this.activeRegistrationCardName = '';
        if (this.haikaBindingState) {
            this.haikaBindingState.active = false;
            this.haikaBindingState.stopRequested = true;
            this.haikaBindingState.queue = [];
        }

        for (const [taskId, task] of this.runningTasks) {
            task.stop('注册任务已停止');
            this.logger.info(`停止注册任务: ${taskId}`);
        }

        this.runningTasks.clear();

        if (this.mainWindow) {
            this.mainWindow.webContents.send('all-tasks-stopped');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        if (!closeBrowsers) {
            this.logger.info('任务已停止，浏览器清理交由外层流程处理');
            return { success: true };
        }

        const browserCount = this.browserManager.getBrowserCount();
        if (browserCount > 0) {
            this.logger.warning(`停止注册后仍有 ${browserCount} 个浏览器实例未关闭`);
            await this.browserManager.closeAll();
            await new Promise(resolve => setTimeout(resolve, 2000));
            const finalCount = this.browserManager.getBrowserCount();
            if (finalCount === 0) {
                this.logger.info('最终清理：所有浏览器实例已关闭');
            } else {
                this.logger.error(`最终清理失败：仍有 ${finalCount} 个浏览器实例`);
            }
        } else {
            this.logger.info('所有浏览器实例已正确关闭');
        }

        return { success: true };
    },

    async updateStats() {
        try {
            const taskCount = this.runningTasks.size;
            const cookies = await this.cookieManager.listCookies();

            if (this.mainWindow) {
                this.mainWindow.webContents.send('stats-updated', {
                    taskCount,
                    cookieCount: cookies.length
                });
            }
        } catch (error) {
            this.logger.error(`更新统计失败: ${error.message}`);
        }
    },

    async cleanupAndExit() {
        if (this.__cleanupAndExitInProgress) {
            return;
        }
        this.__cleanupAndExitInProgress = true;
        this.logger.info('应用程序关闭事件开始');

        const forceExitTimer = setTimeout(() => {
            this.logger.error('应用程序关闭超时，强制退出');
            const { app: electronApp } = require('electron');
            if (electronApp && typeof electronApp.exit === 'function') {
                electronApp.exit(0);
            } else if (typeof process !== 'undefined') {
                process.exit(0);
            }
        }, 15000);

        const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
            let timer = null;
            try {
                return await Promise.race([
                    Promise.resolve(promise),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
                    })
                ]);
            } finally {
                if (timer) {
                    clearTimeout(timer);
                }
            }
        };

        try {
            if (typeof this.stopRegistrationTcpConnectionMonitor === 'function') {
                this.stopRegistrationTcpConnectionMonitor();
            }
            await withTimeout(this.stopRegistration({ closeBrowsers: false }), 10000, '停止注册流程超时');

            this.logger.info('开始关闭所有浏览器实例');
            await withTimeout(this.browserManager.closeAll(), 10000, '关闭浏览器实例超时');

            await new Promise(resolve => setTimeout(resolve, 1000));
            const finalCount = this.browserManager.getBrowserCount();
            if (finalCount > 0) {
                this.logger.error(`应用程序关闭时仍有 ${finalCount} 个浏览器实例未关闭`);
            } else {
                this.logger.info('所有浏览器实例已正确关闭');
            }

            if (this.webControlServer && typeof this.webControlServer.stop === 'function') {
                this.logger.info('开始关闭网页控制台服务');
                await withTimeout(this.webControlServer.stop(), 10000, '关闭网页控制台服务超时');
                this.logger.info('网页控制台服务已关闭');
            }

            this.logger.info('后台清理工作完成');
        } catch (error) {
            this.logger.error(`后台清理过程中发生错误: ${error.message}`);
        } finally {
            clearTimeout(forceExitTimer);

            const { app: electronApp } = require('electron');
            if (electronApp && typeof electronApp.exit === 'function') {
                electronApp.exit(0);
            } else if (electronApp && typeof electronApp.quit === 'function') {
                electronApp.quit();
            } else if (typeof process !== 'undefined') {
                process.exit(0);
            }
        }
    }
};
