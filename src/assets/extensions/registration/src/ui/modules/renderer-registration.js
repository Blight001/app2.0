/**
 * 渲染层注册/运行控制模块。
 *
 * 负责运行模式、注册控制、自动上传以及设备与上传配置读取。
 */
const { IPC_CHANNELS } = require('../../core/ipc/channels');

module.exports = function createRendererRegistration(deps) {
    const state = deps;
    const {
        elements,
        logger,
        ipcRenderer,
        cardManager,
        utils,
        browserRegion,
        DEFAULT_REGISTRATION_RUN_MODE,
        updateBrowserSettings
    } = deps;

    const DEFAULT_MIN_COOKIE_SIZE_BYTES = 8192;
    let customTestAccountBrowserOpen = false;
    let customTestAccountBusy = false;

    function normalizeBrowserLocaleValue(value) {
        return String(value || '').trim().replace('_', '-');
    }

    function normalizeBrowserTimezoneValue(value) {
        return String(value || '').trim();
    }

    function normalizeBrowserRegionValue(value) {
        if (browserRegion && typeof browserRegion.normalizeBrowserRegionKey === 'function') {
            return browserRegion.normalizeBrowserRegionKey(value);
        }
        return String(value || '').trim().toLowerCase();
    }

    function getBrowserRegionLabel(regionValue) {
        const normalized = normalizeBrowserRegionValue(regionValue);
        if (!normalized) {
            return '自动/系统';
        }

        if (browserRegion && typeof browserRegion.getBrowserRegionPreset === 'function') {
            const preset = browserRegion.getBrowserRegionPreset(normalized);
            if (preset && preset.label) {
                return preset.label;
            }
        }

        return normalized;
    }

    function getDefaultBrowserLocale() {
        const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale
            || (typeof navigator !== 'undefined' ? navigator.language : '')
            || 'en-US';
        return normalizeBrowserLocaleValue(systemLocale);
    }

    function getDefaultBrowserTimezoneId() {
        return normalizeBrowserTimezoneValue(
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        );
    }

    function parseSavedBooleanValue(value, fallback = false) {
        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        const text = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(text)) {
            return true;
        }
        if (['0', 'false', 'no', 'off'].includes(text)) {
            return false;
        }
        return fallback;
    }

    async function readSavedRegistrationConfig() {
        try {
            const runtimeResult = await ipcRenderer.invoke('get-registration-runtime-config');
            if (runtimeResult && runtimeResult.success === true && runtimeResult.config && typeof runtimeResult.config === 'object') {
                return runtimeResult.config;
            }
        } catch (_) {}

        try {
            const result = await ipcRenderer.invoke('get-cookie-user-config');
            if (result && result.success === true && result.config && typeof result.config === 'object') {
                return result.config;
            }
        } catch (_) {}

        return {};
    }

    function parseSavedNumberValue(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }

        const lowerBound = Number.isFinite(min) ? min : parsed;
        const upperBound = Number.isFinite(max) ? max : parsed;
        return Math.max(lowerBound, Math.min(upperBound, parsed));
    }

    function getConfigValue(config = {}, keys = [], fallback = undefined) {
        const source = config && typeof config === 'object' ? config : {};
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null && source[key] !== '') {
                return source[key];
            }
        }
        return fallback;
    }

    function getSavedBrowserSettings(config = {}) {
        const browserSettings = getConfigValue(config, ['browserSettings', 'browser_settings'], {});
        return browserSettings && typeof browserSettings === 'object' ? browserSettings : {};
    }

    function normalizeBrowserDisplayModeValue(value, fallback = 'window') {
        if (value === true) {
            return 'embedded';
        }

        if (value === false) {
            return 'window';
        }

        const normalized = String(value || '').trim().toLowerCase();
        if (['1', 'true', 'yes', 'on', 'embedded', 'panel', 'middle', 'inline'].includes(normalized)) {
            return 'embedded';
        }

        if (['0', 'false', 'no', 'off', 'window', 'separate', 'popup', 'standalone', 'external'].includes(normalized)) {
            return 'window';
        }

        return fallback === 'embedded' ? 'embedded' : 'window';
    }

    function normalizeBrowserSourceValue(value, fallback = 'local-browser') {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'client-browser' || normalized === 'client' || normalized === 'host-browser') {
            return 'client-browser';
        }
        if (normalized === 'local-browser' || normalized === 'local' || normalized === 'builtin-browser' || normalized === 'builtin') {
            return 'local-browser';
        }
        return fallback === 'client-browser' ? 'client-browser' : 'local-browser';
    }

    function getBrowserDisplayModeValue() {
        return elements.browserDisplayMode && elements.browserDisplayMode.checked ? 'embedded' : 'window';
    }

    function getBrowserSourceValue() {
        return elements.browserSource ? normalizeBrowserSourceValue(elements.browserSource.value, 'local-browser') : 'local-browser';
    }

    function buildBrowserSettingsForSave() {
        const activeBrowserRegionPreset = elements.browserRegion && browserRegion && typeof browserRegion.getBrowserRegionPreset === 'function'
            ? browserRegion.getBrowserRegionPreset(normalizeBrowserRegionValue(elements.browserRegion.value))
            : null;

        const browserSettings = {
            browser_type: elements.browserType ? String(elements.browserType.value || '').trim() : '',
            browser_source: getBrowserSourceValue(),
            browser_display_mode: getBrowserDisplayModeValue(),
            region: elements.browserRegion ? normalizeBrowserRegionValue(elements.browserRegion.value) : '',
            headless: elements.headlessMode ? elements.headlessMode.checked === true : true,
            locale: elements.browserLocale ? normalizeBrowserLocaleValue(elements.browserLocale.value) : '',
            timezone_id: elements.browserTimezoneId ? normalizeBrowserTimezoneValue(elements.browserTimezoneId.value) : '',
            dynamic_fingerprint: elements.browserDynamicFingerprint ? elements.browserDynamicFingerprint.checked === true : true,
            block_images_videos: elements.browserBlockImagesVideos ? elements.browserBlockImagesVideos.checked === true : false,
            sync_execution: elements.syncExecution ? elements.syncExecution.checked === true : true,
            max_proxy_recovery_attempts: getRegistrationRecoveryAttempts(),
            registration_auto_upload: elements.registrationAutoUpload ? elements.registrationAutoUpload.checked === true : true,
            save_local_cookie: elements.registrationSaveLocalCookie ? elements.registrationSaveLocalCookie.checked === true : false,
            concurrent_count: elements.concurrentCount ? Math.max(1, Math.min(10, parseInt(elements.concurrentCount.value, 10) || 1)) : 1,
            run_mode: getSelectedRunMode(),
            timed_registration_count: getTimedRegistrationCount(),
            timed_registration_cycle_count: getTimedRegistrationCycleCount(),
            timed_registration_start_mode: getTimedRegistrationStartMode(),
            timed_registration_delay_seconds: getTimedRegistrationDelaySeconds()
        };

        if (activeBrowserRegionPreset && activeBrowserRegionPreset.locale && !browserSettings.locale) {
            browserSettings.locale = activeBrowserRegionPreset.locale;
        }
        if (activeBrowserRegionPreset && activeBrowserRegionPreset.timezoneId && !browserSettings.timezone_id) {
            browserSettings.timezone_id = activeBrowserRegionPreset.timezoneId;
        }

        return browserSettings;
    }

    function buildRegistrationStartConfig(savedConfig = {}) {
        const savedBrowserSettings = getSavedBrowserSettings(savedConfig);
        const savedSaveLocalCookie = getConfigValue(
            savedBrowserSettings,
            ['save_local_cookie', 'saveLocalCookie'],
            getConfigValue(savedConfig, ['registration_save_local_cookie', 'registrationSaveLocalCookie', 'save_local_cookie', 'saveLocalCookie'], false)
        );
        const savedRunMode = parseSavedNumberValue(
            getConfigValue(savedBrowserSettings, ['run_mode', 'runMode'], getConfigValue(savedConfig, ['registration_run_mode', 'registrationRunMode'], getSelectedRunMode())),
            DEFAULT_REGISTRATION_RUN_MODE,
            0,
            2
        );
        const savedConcurrentCount = parseSavedNumberValue(
            getConfigValue(savedBrowserSettings, ['concurrent_count', 'concurrentCount'], getConfigValue(savedConfig, ['concurrent_count', 'concurrentCount'], elements.concurrentCount ? elements.concurrentCount.value : 1)),
            1,
            1,
            10
        );
        const savedSyncExecution = getConfigValue(savedBrowserSettings, ['sync_execution', 'syncExecution'], getConfigValue(savedConfig, ['sync_execution', 'syncEnabled'], elements.syncExecution ? elements.syncExecution.checked : true));
        const savedMaxProxyRecoveryAttempts = parseSavedNumberValue(
            getConfigValue(savedBrowserSettings, ['max_proxy_recovery_attempts', 'maxProxyRecoveryAttempts'], getConfigValue(savedConfig, ['max_proxy_recovery_attempts', 'maxProxyRecoveryAttempts'], elements.proxyRecoveryAttempts ? elements.proxyRecoveryAttempts.value : 3)),
            3,
            1,
            20
        );
        const savedTimedRegistrationCount = parseSavedNumberValue(
            getConfigValue(savedBrowserSettings, ['timed_registration_count', 'timedRegistrationCount'], getConfigValue(savedConfig, ['timed_registration_count', 'timedRegistrationCount'], elements.registrationTimedCount ? elements.registrationTimedCount.value : 1)),
            1,
            1,
            9999
        );
        const savedTimedRegistrationCycleCount = parseSavedNumberValue(
            getConfigValue(savedBrowserSettings, ['timed_registration_cycle_count', 'timedRegistrationCycleCount'], getConfigValue(savedConfig, ['timed_registration_cycle_count', 'timedRegistrationCycleCount'], elements.registrationTimedCycleCount ? elements.registrationTimedCycleCount.value : 1)),
            1,
            1,
            9999
        );
        const savedTimedRegistrationStartMode = String(
            getConfigValue(savedBrowserSettings, ['timed_registration_start_mode', 'timedRegistrationStartMode'], getConfigValue(savedConfig, ['timed_registration_start_mode', 'timedRegistrationStartMode'], getTimedRegistrationStartMode()))
        ).trim() === 'delayed' ? 'delayed' : 'immediate';
        const savedTimedRegistrationDelaySeconds = parseSavedNumberValue(
            getConfigValue(savedBrowserSettings, ['timed_registration_delay_seconds', 'timedRegistrationDelaySeconds'], getConfigValue(savedConfig, ['timed_registration_delay_seconds', 'timedRegistrationDelaySeconds'], elements.registrationTimedDelaySeconds ? elements.registrationTimedDelaySeconds.value : 0)),
            0,
            0,
            3600
        );

        const browserSettings = {
            ...buildBrowserSettingsForSave(),
            browser_type: getConfigValue(savedBrowserSettings, ['browser_type', 'browserType'], elements.browserType ? elements.browserType.value : ''),
            headless: getConfigValue(savedBrowserSettings, ['headless', 'headlessMode'], getConfigValue(savedConfig, ['registration_headless_mode', 'registrationHeadlessMode'], elements.headlessMode ? elements.headlessMode.checked : true)) === true
                || parseSavedBooleanValue(getConfigValue(savedBrowserSettings, ['headless', 'headlessMode'], getConfigValue(savedConfig, ['registration_headless_mode', 'registrationHeadlessMode'], elements.headlessMode ? elements.headlessMode.checked : true)), true),
            sync_execution: savedSyncExecution === true || parseSavedBooleanValue(savedSyncExecution, true),
            max_proxy_recovery_attempts: savedMaxProxyRecoveryAttempts,
            concurrent_count: savedConcurrentCount,
            run_mode: savedRunMode,
            timed_registration_count: savedTimedRegistrationCount,
            timed_registration_cycle_count: savedTimedRegistrationCycleCount,
            timed_registration_start_mode: savedTimedRegistrationStartMode,
            timed_registration_delay_seconds: savedTimedRegistrationDelaySeconds,
            save_local_cookie: parseSavedBooleanValue(savedSaveLocalCookie, false)
        };

        browserSettings.browserType = browserSettings.browser_type;
        browserSettings.headlessMode = browserSettings.headless;
        browserSettings.syncExecution = browserSettings.sync_execution;
        browserSettings.maxProxyRecoveryAttempts = browserSettings.max_proxy_recovery_attempts;
        browserSettings.saveLocalCookie = browserSettings.save_local_cookie === true;
        browserSettings.skipCookieSave = browserSettings.saveLocalCookie === false;
        browserSettings.skip_cookie_save = browserSettings.skipCookieSave;
        browserSettings.concurrentCount = browserSettings.concurrent_count;
        browserSettings.runMode = browserSettings.run_mode;
        browserSettings.timedRegistrationCount = browserSettings.timed_registration_count;
        browserSettings.timedRegistrationCycleCount = browserSettings.timed_registration_cycle_count;
        browserSettings.timedRegistrationStartMode = browserSettings.timed_registration_start_mode;
        browserSettings.timedRegistrationDelaySeconds = browserSettings.timed_registration_delay_seconds;

        return {
            runMode: savedRunMode,
            concurrentCount: savedConcurrentCount,
            syncEnabled: savedSyncExecution === true || parseSavedBooleanValue(savedSyncExecution, true),
            maxProxyRecoveryAttempts: savedMaxProxyRecoveryAttempts,
            timedRegistrationCount: savedTimedRegistrationCount,
            timedRegistrationCycleCount: savedTimedRegistrationCycleCount,
            timedRegistrationStartMode: savedTimedRegistrationStartMode,
            timedRegistrationDelayMs: Math.max(0, Math.round(savedTimedRegistrationDelaySeconds * 1000)),
            browserSettings,
            saveLocalCookie: browserSettings.saveLocalCookie,
            skipCookieSave: browserSettings.skipCookieSave
        };
    }

        function getSelectedRunMode() {
            const activeButton = document.querySelector('.run-mode-btn.active');
            if (activeButton) {
                const activeMode = parseInt(activeButton.dataset.runMode, 10);
                if (Number.isFinite(activeMode)) {
                    return activeMode;
                }
            }

            const savedMode = parseInt(localStorage.getItem('registration-run-mode'), 10);
            if (Number.isFinite(savedMode) && (savedMode === 0 || savedMode === 1 || savedMode === 2)) {
                return savedMode;
            }

            return DEFAULT_REGISTRATION_RUN_MODE;
        }

        function setRunMode(mode, persist = true) {
            const normalizedMode = mode === 2 ? 2 : (mode === 1 ? 1 : 0);

            if (elements.runModeButtons && typeof elements.runModeButtons.forEach === 'function') {
                elements.runModeButtons.forEach(button => {
                    const buttonMode = parseInt(button.dataset.runMode, 10);
                    const isActive = buttonMode === normalizedMode;
                    button.classList.toggle('active', isActive);
                    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });
            }

            if (persist) {
                localStorage.setItem('registration-run-mode', String(normalizedMode));
            }

            updateTimedRegistrationControlState(normalizedMode);
            return normalizedMode;
        }

        function getRegistrationRecoveryAttempts() {
            const rawValue = elements.proxyRecoveryAttempts ? elements.proxyRecoveryAttempts.value : '';
            const parsed = parseInt(rawValue, 10);
            if (Number.isFinite(parsed)) {
                return Math.max(1, Math.min(20, parsed));
            }
            return 3;
        }

        function getTimedRegistrationCount() {
            const rawValue = elements.registrationTimedCount ? elements.registrationTimedCount.value : '';
            const parsed = parseInt(rawValue, 10);
            if (Number.isFinite(parsed)) {
                return Math.max(1, Math.min(9999, parsed));
            }
            return 1;
        }

        function getTimedRegistrationCycleCount() {
            const rawValue = elements.registrationTimedCycleCount ? elements.registrationTimedCycleCount.value : '';
            const parsed = parseInt(rawValue, 10);
            if (Number.isFinite(parsed)) {
                return Math.max(1, Math.min(9999, parsed));
            }
            return 1;
        }

        function getTimedRegistrationStartMode() {
            const rawValue = elements.registrationTimedStartMode ? String(elements.registrationTimedStartMode.value || '').trim() : '';
            return rawValue === 'delayed' ? 'delayed' : 'immediate';
        }

        function getTimedRegistrationDelaySeconds() {
            const rawValue = elements.registrationTimedDelaySeconds ? elements.registrationTimedDelaySeconds.value : '';
            const parsed = parseFloat(rawValue);
            if (Number.isFinite(parsed)) {
                return Math.max(0, Math.min(3600, parsed));
            }
            return 0;
        }

        function getTimedRegistrationDelayMs() {
            return Math.max(0, Math.round(getTimedRegistrationDelaySeconds() * 1000));
        }

        function updateTimedRegistrationControlState(mode = getSelectedRunMode()) {
            const isTimedMode = mode === 2;

            if (elements.registrationTimedSettings) {
                elements.registrationTimedSettings.classList.toggle('is-disabled', !isTimedMode);
                elements.registrationTimedSettings.setAttribute('aria-disabled', isTimedMode ? 'false' : 'true');
                elements.registrationTimedSettings.hidden = !isTimedMode;
                elements.registrationTimedSettings.setAttribute('aria-hidden', isTimedMode ? 'false' : 'true');
            }

            if (elements.registrationTimedCount) {
                elements.registrationTimedCount.disabled = !isTimedMode;
            }

            if (elements.registrationTimedCycleCount) {
                elements.registrationTimedCycleCount.disabled = !isTimedMode;
            }

            if (elements.registrationTimedStartMode) {
                elements.registrationTimedStartMode.disabled = !isTimedMode;
            }

            if (elements.registrationTimedDelaySeconds) {
                elements.registrationTimedDelaySeconds.disabled = !isTimedMode;
            }
        }

        async function loadRegistrationControls() {
            const savedConfig = await readSavedRegistrationConfig();
            const savedBrowserSettings = getSavedBrowserSettings(savedConfig);

            if (elements.proxyRecoveryAttempts) {
                const savedRecoveryAttempts = parseSavedNumberValue(
                    getConfigValue(savedConfig, ['max_proxy_recovery_attempts', 'maxProxyRecoveryAttempts'], localStorage.getItem('registration-max-proxy-recovery-attempts')),
                    3,
                    1,
                    20
                );
                elements.proxyRecoveryAttempts.value = String(savedRecoveryAttempts);
            }

            if (elements.registrationTimedCount) {
                const savedTimedCount = parseSavedNumberValue(
                    getConfigValue(savedConfig, ['timed_registration_count', 'timedRegistrationCount'], localStorage.getItem('registration-timed-count')),
                    1,
                    1,
                    9999
                );
                elements.registrationTimedCount.value = String(savedTimedCount);
            }

            if (elements.registrationTimedCycleCount) {
                const savedTimedCycleCount = parseSavedNumberValue(
                    getConfigValue(savedConfig, ['timed_registration_cycle_count', 'timedRegistrationCycleCount'], localStorage.getItem('registration-timed-cycle-count')),
                    1,
                    1,
                    9999
                );
                elements.registrationTimedCycleCount.value = String(savedTimedCycleCount);
            }

            if (elements.registrationTimedStartMode) {
                const savedTimedStartMode = String(
                    getConfigValue(savedConfig, ['timed_registration_start_mode', 'timedRegistrationStartMode'], localStorage.getItem('registration-timed-start-mode'))
                ).trim();
                elements.registrationTimedStartMode.value = savedTimedStartMode === 'delayed' ? 'delayed' : 'immediate';
            }

            if (elements.registrationTimedDelaySeconds) {
                const savedTimedDelaySeconds = parseSavedNumberValue(
                    getConfigValue(savedConfig, ['timed_registration_delay_seconds', 'timedRegistrationDelaySeconds'], localStorage.getItem('registration-timed-delay-seconds')),
                    0,
                    0,
                    3600
                );
                elements.registrationTimedDelaySeconds.value = String(savedTimedDelaySeconds);
            }

            if (elements.concurrentCount) {
                const savedConcurrentCount = parseSavedNumberValue(
                    getConfigValue(savedBrowserSettings, ['concurrent_count', 'concurrentCount'], getConfigValue(savedConfig, ['concurrent_count', 'concurrentCount'], localStorage.getItem('registration-concurrent-count'))),
                    1,
                    1,
                    10
                );
                elements.concurrentCount.value = String(savedConcurrentCount);
            }

            if (elements.syncExecution) {
                const savedSyncExecution = getConfigValue(savedBrowserSettings, ['sync_execution', 'syncExecution'], getConfigValue(savedConfig, ['sync_execution', 'syncEnabled'], localStorage.getItem('registration-sync-execution')));
                elements.syncExecution.checked = savedSyncExecution === undefined
                    ? true
                    : parseSavedBooleanValue(savedSyncExecution, true);
            }

            if (elements.browserDynamicFingerprint) {
                const savedDynamicFingerprint = getConfigValue(savedBrowserSettings, ['dynamic_fingerprint', 'dynamicFingerprint'], undefined);
                elements.browserDynamicFingerprint.checked = savedDynamicFingerprint !== undefined
                    ? parseSavedBooleanValue(savedDynamicFingerprint, true)
                    : localStorage.getItem('registration-dynamic-fingerprint') !== 'false';
            }
            if (elements.browserDisplayMode) {
                const savedBrowserDisplayMode = normalizeBrowserDisplayModeValue(
                    getConfigValue(savedBrowserSettings, ['browser_display_mode', 'browserDisplayMode'], localStorage.getItem('registration-browser-display-mode')),
                    'window'
                );
                elements.browserDisplayMode.checked = savedBrowserDisplayMode === 'embedded';
            }
            if (elements.browserSource) {
                const savedBrowserSource = normalizeBrowserSourceValue(
                    getConfigValue(savedBrowserSettings, ['browser_source', 'browserSource'], localStorage.getItem('registration-browser-source')),
                    'local-browser'
                );
                elements.browserSource.value = savedBrowserSource;
            }
            if (elements.browserType) {
                const savedBrowserType = String(
                    getConfigValue(savedBrowserSettings, ['browser_type', 'browserType'], localStorage.getItem('registration-browser-type'))
                    || ''
                ).trim();
                if (['electron', 'edge', 'chrome'].includes(savedBrowserType)) {
                    const hasSavedOption = Array.from(elements.browserType.options || []).some(option => option.value === savedBrowserType);
                    if (hasSavedOption) {
                        elements.browserType.value = savedBrowserType;
                    }
                } else {
                    elements.browserType.value = 'electron';
                }
            }
            if (elements.browserRegion) {
                const savedBrowserRegion = normalizeBrowserRegionValue(
                    getConfigValue(savedBrowserSettings, ['region', 'browser_region', 'browserRegion'], localStorage.getItem('registration-browser-region'))
                );
                if (savedBrowserRegion) {
                    const hasSavedOption = Array.from(elements.browserRegion.options || []).some(option => option.value === savedBrowserRegion);
                    if (hasSavedOption) {
                        elements.browserRegion.value = savedBrowserRegion;
                    } else {
                        const option = document.createElement('option');
                        option.value = savedBrowserRegion;
                        option.textContent = `${getBrowserRegionLabel(savedBrowserRegion)}（已保存）`;
                        elements.browserRegion.appendChild(option);
                        elements.browserRegion.value = savedBrowserRegion;
                    }
                } else {
                    elements.browserRegion.value = '';
                }
            }
            if (elements.headlessMode) {
                const savedHeadlessMode = getConfigValue(savedBrowserSettings, ['headless', 'headlessMode'], getConfigValue(savedConfig, ['registration_headless_mode', 'registrationHeadlessMode'], undefined));
                elements.headlessMode.checked = savedHeadlessMode !== undefined
                    ? parseSavedBooleanValue(savedHeadlessMode, true)
                    : (localStorage.getItem('registration-headless-mode') === null
                        ? true
                        : localStorage.getItem('registration-headless-mode') === 'true');
            }
            if (elements.browserLocale) {
                const savedBrowserLocale = String(
                    getConfigValue(savedBrowserSettings, ['locale', 'browser_locale', 'browserLocale'], localStorage.getItem('registration-browser-locale'))
                    || ''
                ).trim();
                elements.browserLocale.value = savedBrowserLocale
                    ? normalizeBrowserLocaleValue(savedBrowserLocale)
                    : getDefaultBrowserLocale();
            }
            if (elements.browserTimezoneId) {
                const savedBrowserTimezoneId = String(
                    getConfigValue(savedBrowserSettings, ['timezone_id', 'timezoneId', 'browser_timezone_id'], localStorage.getItem('registration-browser-timezone-id'))
                    || ''
                ).trim();
                elements.browserTimezoneId.value = savedBrowserTimezoneId
                    ? normalizeBrowserTimezoneValue(savedBrowserTimezoneId)
                    : getDefaultBrowserTimezoneId();
            }
            if (elements.browserRegion && browserRegion && typeof browserRegion.getBrowserRegionPreset === 'function') {
                const currentBrowserRegion = normalizeBrowserRegionValue(elements.browserRegion.value);
                const browserRegionPreset = browserRegion.getBrowserRegionPreset(currentBrowserRegion);
                if (browserRegionPreset) {
                    const hasExplicitLocale = !!getConfigValue(savedBrowserSettings, ['locale', 'browser_locale', 'browserLocale'], '');
                    const hasExplicitTimezone = !!getConfigValue(savedBrowserSettings, ['timezone_id', 'timezoneId', 'browser_timezone_id'], '');
                    if (elements.browserLocale && browserRegionPreset.locale && !hasExplicitLocale) {
                        elements.browserLocale.value = browserRegionPreset.locale;
                    }
                    if (elements.browserTimezoneId && browserRegionPreset.timezoneId && !hasExplicitTimezone) {
                        elements.browserTimezoneId.value = browserRegionPreset.timezoneId;
                    }
                }
            }
            if (elements.browserBlockImagesVideos) {
                const savedBlockImagesVideos = getConfigValue(savedBrowserSettings, ['block_images_videos', 'blockImagesVideos'], undefined);
                elements.browserBlockImagesVideos.checked = savedBlockImagesVideos !== undefined
                    ? parseSavedBooleanValue(savedBlockImagesVideos, false)
                    : (localStorage.getItem('registration-block-images-videos') === null
                        ? true
                        : localStorage.getItem('registration-block-images-videos') !== 'false');
            }
            if (elements.browserRemoveWatermarkPlugin) {
                const savedRemoveWatermarkPlugin = getConfigValue(
                    savedBrowserSettings,
                    ['remove_watermark_plugin', 'removeWatermarkPlugin'],
                    undefined
                );
                elements.browserRemoveWatermarkPlugin.checked = savedRemoveWatermarkPlugin !== undefined
                    ? parseSavedBooleanValue(savedRemoveWatermarkPlugin, true)
                    : (localStorage.getItem('registration-remove-watermark-plugin') === null
                        ? true
                        : localStorage.getItem('registration-remove-watermark-plugin') !== 'false');
            }

            if (elements.registrationAutoUpload) {
                const savedAutoUpload = getConfigValue(savedBrowserSettings, ['registration_auto_upload', 'registrationAutoUpload'], getConfigValue(savedConfig, ['registration_auto_upload', 'registrationAutoUpload'], localStorage.getItem('registration-auto-upload')));
                elements.registrationAutoUpload.checked = savedAutoUpload === undefined
                    ? true
                    : parseSavedBooleanValue(savedAutoUpload, true);
            }

            if (elements.registrationSaveLocalCookie) {
                const savedSaveLocalCookie = getConfigValue(
                    savedBrowserSettings,
                    ['save_local_cookie', 'saveLocalCookie'],
                    getConfigValue(savedConfig, ['registration_save_local_cookie', 'registrationSaveLocalCookie', 'save_local_cookie', 'saveLocalCookie'], localStorage.getItem('registration-save-local-cookie'))
                );
                elements.registrationSaveLocalCookie.checked = savedSaveLocalCookie === undefined
                    ? false
                    : parseSavedBooleanValue(savedSaveLocalCookie, false);
            }

            const savedRunMode = parseSavedNumberValue(
                getConfigValue(savedBrowserSettings, ['run_mode', 'runMode'], getConfigValue(savedConfig, ['registration_run_mode', 'registrationRunMode', 'run_mode', 'runMode'], localStorage.getItem('registration-run-mode'))),
                DEFAULT_REGISTRATION_RUN_MODE,
                0,
                2
            );
            setRunMode(
                Number.isFinite(savedRunMode) && (savedRunMode === 0 || savedRunMode === 1 || savedRunMode === 2)
                    ? savedRunMode
                    : DEFAULT_REGISTRATION_RUN_MODE,
                false
            );

            if (typeof updateBrowserSettings === 'function') {
                await updateBrowserSettings();
            }
        }

        async function saveRegistrationControls() {
            if (elements.proxyRecoveryAttempts) {
                const normalizedRecoveryAttempts = getRegistrationRecoveryAttempts();
                elements.proxyRecoveryAttempts.value = String(normalizedRecoveryAttempts);
                localStorage.setItem('registration-max-proxy-recovery-attempts', String(normalizedRecoveryAttempts));
            }
            if (elements.registrationTimedCount) {
                const normalizedTimedCount = getTimedRegistrationCount();
                elements.registrationTimedCount.value = String(normalizedTimedCount);
                localStorage.setItem('registration-timed-count', String(normalizedTimedCount));
            }
            if (elements.registrationTimedCycleCount) {
                const normalizedTimedCycleCount = getTimedRegistrationCycleCount();
                elements.registrationTimedCycleCount.value = String(normalizedTimedCycleCount);
                localStorage.setItem('registration-timed-cycle-count', String(normalizedTimedCycleCount));
            }
            if (elements.registrationTimedStartMode) {
                const normalizedTimedStartMode = getTimedRegistrationStartMode();
                elements.registrationTimedStartMode.value = normalizedTimedStartMode;
                localStorage.setItem('registration-timed-start-mode', normalizedTimedStartMode);
            }
            if (elements.registrationTimedDelaySeconds) {
                const normalizedTimedDelaySeconds = getTimedRegistrationDelaySeconds();
                elements.registrationTimedDelaySeconds.value = String(normalizedTimedDelaySeconds);
                localStorage.setItem('registration-timed-delay-seconds', String(normalizedTimedDelaySeconds));
            }
            if (elements.concurrentCount) {
                const normalizedConcurrentCount = Math.max(1, Math.min(10, parseInt(elements.concurrentCount.value, 10) || 1));
                elements.concurrentCount.value = String(normalizedConcurrentCount);
                localStorage.setItem('registration-concurrent-count', String(normalizedConcurrentCount));
            }
            if (elements.syncExecution) {
                localStorage.setItem('registration-sync-execution', elements.syncExecution.checked ? 'true' : 'false');
            }
            if (elements.browserDynamicFingerprint) {
                localStorage.setItem(
                    'registration-dynamic-fingerprint',
                    elements.browserDynamicFingerprint.checked ? 'true' : 'false'
                );
            }
            if (elements.browserDisplayMode) {
                localStorage.setItem(
                    'registration-browser-display-mode',
                    getBrowserDisplayModeValue()
                );
            }
            if (elements.browserSource) {
                localStorage.setItem(
                    'registration-browser-source',
                    getBrowserSourceValue()
                );
            }
            if (elements.browserType) {
                localStorage.setItem('registration-browser-type', elements.browserType.value || '');
            }
            let activeBrowserRegionPreset = null;
            if (elements.browserRegion) {
                const normalizedBrowserRegion = normalizeBrowserRegionValue(elements.browserRegion.value);
                elements.browserRegion.value = normalizedBrowserRegion;
                localStorage.setItem('registration-browser-region', normalizedBrowserRegion);
                if (normalizedBrowserRegion && browserRegion && typeof browserRegion.getBrowserRegionPreset === 'function') {
                    activeBrowserRegionPreset = browserRegion.getBrowserRegionPreset(normalizedBrowserRegion);
                }
            }
            if (elements.headlessMode) {
                localStorage.setItem(
                    'registration-headless-mode',
                    elements.headlessMode.checked ? 'true' : 'false'
                );
            }
            if (elements.browserLocale) {
                if (activeBrowserRegionPreset && activeBrowserRegionPreset.locale) {
                    elements.browserLocale.value = activeBrowserRegionPreset.locale;
                }
                const normalizedLocale = normalizeBrowserLocaleValue(elements.browserLocale.value);
                elements.browserLocale.value = normalizedLocale;
                localStorage.setItem('registration-browser-locale', normalizedLocale);
            }
            if (elements.browserTimezoneId) {
                if (activeBrowserRegionPreset && activeBrowserRegionPreset.timezoneId) {
                    elements.browserTimezoneId.value = activeBrowserRegionPreset.timezoneId;
                }
                const normalizedTimezoneId = normalizeBrowserTimezoneValue(elements.browserTimezoneId.value);
                elements.browserTimezoneId.value = normalizedTimezoneId;
                localStorage.setItem('registration-browser-timezone-id', normalizedTimezoneId);
            }
            if (elements.browserBlockImagesVideos) {
                localStorage.setItem(
                    'registration-block-images-videos',
                    elements.browserBlockImagesVideos.checked ? 'true' : 'false'
                );
            }
            if (elements.browserRemoveWatermarkPlugin) {
                localStorage.setItem(
                    'registration-remove-watermark-plugin',
                    elements.browserRemoveWatermarkPlugin.checked ? 'true' : 'false'
                );
            }
            if (elements.registrationSaveLocalCookie) {
                localStorage.setItem(
                    'registration-save-local-cookie',
                    elements.registrationSaveLocalCookie.checked ? 'true' : 'false'
                );
            }

            const normalizedRunMode = getSelectedRunMode();
            localStorage.setItem('registration-run-mode', String(normalizedRunMode));

            const browserSettings = buildBrowserSettingsForSave();
            const runtimeConfig = {
                browserSettings,
                registration_headless_mode: elements.headlessMode ? elements.headlessMode.checked === true : true,
                registration_run_mode: normalizedRunMode,
                registration_timed_count: getTimedRegistrationCount(),
                registration_timed_cycle_count: getTimedRegistrationCycleCount(),
                registration_timed_start_mode: getTimedRegistrationStartMode(),
                registration_timed_delay_seconds: getTimedRegistrationDelaySeconds(),
                concurrent_count: elements.concurrentCount ? Math.max(1, Math.min(10, parseInt(elements.concurrentCount.value, 10) || 1)) : 1,
                sync_execution: elements.syncExecution ? elements.syncExecution.checked === true : true,
                max_proxy_recovery_attempts: getRegistrationRecoveryAttempts(),
                registration_auto_upload: elements.registrationAutoUpload ? elements.registrationAutoUpload.checked === true : true,
                registration_save_local_cookie: elements.registrationSaveLocalCookie ? elements.registrationSaveLocalCookie.checked === true : false,
                save_local_cookie: elements.registrationSaveLocalCookie ? elements.registrationSaveLocalCookie.checked === true : false,
                browser_source: getBrowserSourceValue()
            };

            updateTimedRegistrationControlState();

            try {
                return await ipcRenderer.invoke('save-registration-runtime-config', runtimeConfig);
            } catch (error) {
                logger.warning(`保存运行配置失败: ${error.message}`);
                return { success: false, error: error.message };
            }
        }

        function updateRegistrationUploadStatus(text, type = '') {
            const message = text || '等待配置';
            const prefix = '[自动上传]';
            if (type === 'error') {
                logger.error(`${prefix} ${message}`);
            } else if (type === 'warning') {
                logger.warning(`${prefix} ${message}`);
            } else {
                logger.info(`${prefix} ${message}`);
            }
        }

        async function saveRegistrationUploadControls() {
            if (elements.registrationAutoUpload) {
                localStorage.setItem('registration-auto-upload', elements.registrationAutoUpload.checked ? 'true' : 'false');
            }
            if (elements.registrationSaveLocalCookie) {
                localStorage.setItem('registration-save-local-cookie', elements.registrationSaveLocalCookie.checked ? 'true' : 'false');
            }

            const browserSettings = buildBrowserSettingsForSave();
            const runtimeConfig = {
                browserSettings,
                registration_headless_mode: elements.headlessMode ? elements.headlessMode.checked === true : true,
                registration_run_mode: getSelectedRunMode(),
                registration_timed_count: getTimedRegistrationCount(),
                registration_timed_cycle_count: getTimedRegistrationCycleCount(),
                registration_timed_start_mode: getTimedRegistrationStartMode(),
                registration_timed_delay_seconds: getTimedRegistrationDelaySeconds(),
                concurrent_count: elements.concurrentCount ? Math.max(1, Math.min(10, parseInt(elements.concurrentCount.value, 10) || 1)) : 1,
                sync_execution: elements.syncExecution ? elements.syncExecution.checked === true : true,
                max_proxy_recovery_attempts: getRegistrationRecoveryAttempts(),
                registration_auto_upload: elements.registrationAutoUpload ? elements.registrationAutoUpload.checked === true : true,
                registration_save_local_cookie: elements.registrationSaveLocalCookie ? elements.registrationSaveLocalCookie.checked === true : false,
                save_local_cookie: elements.registrationSaveLocalCookie ? elements.registrationSaveLocalCookie.checked === true : false
            };

            try {
                return await ipcRenderer.invoke('save-registration-runtime-config', runtimeConfig);
            } catch (error) {
                logger.warning(`保存运行配置失败: ${error.message}`);
                return { success: false, error: error.message };
            }
        }

        async function loadRegistrationUploadControls() {
            try {
                const result = await ipcRenderer.invoke('get-cookie-user-config');
                if (!result || !result.success || !result.config || typeof result.config !== 'object') {
                    return;
                }
                const config = result.config;
                if (elements.registrationAutoUpload) {
                    const savedAutoUpload = getConfigValue(config, ['registration_auto_upload', 'registrationAutoUpload'], localStorage.getItem('registration-auto-upload'));
                    elements.registrationAutoUpload.checked = savedAutoUpload === undefined
                        ? true
                        : parseSavedBooleanValue(savedAutoUpload, true);
                }
                if (typeof utils.activateUploadMode === 'function') {
                    utils.activateUploadMode('tcp');
                }
            } catch (error) {
                logger.warning(`加载上传配置失败: ${error.message}`);
            }
        }

        function resolveCookieUploadMinSizeBytes(card = null) {
            const candidates = [
                card?.min_cookie_size_bytes,
                card?.minCookieSizeBytes,
                card?.min_cookie_size,
                card?.minCookieSize
            ];

            for (const candidate of candidates) {
                if (candidate === undefined || candidate === null || candidate === '') {
                    continue;
                }

                const parsed = parseInt(candidate, 10);
                if (Number.isFinite(parsed) && parsed >= 0) {
                    return parsed;
                }
            }

            return DEFAULT_MIN_COOKIE_SIZE_BYTES;
        }

        function calculateCookieUploadPayloadBytes(cookies) {
            if (!Array.isArray(cookies)) {
                return 0;
            }

            try {
                const serialized = JSON.stringify(cookies, null, 2);
                if (typeof TextEncoder !== 'undefined') {
                    return new TextEncoder().encode(serialized).length;
                }
                if (typeof Buffer !== 'undefined') {
                    return Buffer.byteLength(serialized, 'utf8');
                }
                return serialized.length;
            } catch (_error) {
                return 0;
            }
        }

        function validateCookieUploadSize(cookies, minCookieSizeBytes) {
            const payloadBytes = calculateCookieUploadPayloadBytes(cookies);
            const normalizedMinBytes = Number(minCookieSizeBytes);

            if (!Number.isFinite(normalizedMinBytes) || normalizedMinBytes <= 0) {
                return {
                    allowed: true,
                    payloadBytes,
                    minBytes: 0
                };
            }

            return {
                allowed: payloadBytes >= normalizedMinBytes,
                payloadBytes,
                minBytes: normalizedMinBytes
            };
        }

        async function getRegistrationUploadDeviceId() {
            if (state.cachedUploadDeviceId) {
                return state.cachedUploadDeviceId;
            }

            try {
                const result = await ipcRenderer.invoke('get-device-id');
                state.cachedUploadDeviceId = typeof result === 'string' ? result.trim() : '';
                return state.cachedUploadDeviceId;
            } catch (error) {
                logger.error(`获取设备ID失败: ${error.message}`);
                return '';
            }
        }

        async function getRegistrationUploadConfig(cardName = '') {
            const resolvedCardName = (cardName || cardManager.getCurrentCard() || '').trim();
            if (!resolvedCardName) {
                logger.warning('自动上传已跳过：未选择注册卡片');
                return null;
            }

            try {
                const result = await ipcRenderer.invoke('get-card', resolvedCardName);
                if (!result || !result.success || !result.card) {
                    logger.warning(`自动上传已跳过：无法获取卡片「${resolvedCardName}」配置`);
                    return null;
                }

                const card = result.card || {};
                const minCookieSizeBytes = resolveCookieUploadMinSizeBytes(card);
                const cardUpload = card.upload && typeof card.upload === 'object' ? card.upload : {};
                const targetScoreConfig = typeof cardManager.resolveUploadTargetScoreConfig === 'function'
                    ? cardManager.resolveUploadTargetScoreConfig(card)
                    : { scope: 'all', types: [] };
                const serverUrl = String(
                    card.upload_server_url ||
                    card.uploadServerUrl ||
                    cardUpload.server_url ||
                    cardUpload.serverUrl ||
                    ''
                ).trim();
                const cardKey = String(
                    card.upload_card_key ||
                    card.uploadCardKey ||
                    card.card_key ||
                    cardUpload.card_key ||
                    cardUpload.cardKey ||
                    ''
                ).trim();

                if (serverUrl && cardKey) {
                    return {
                        cardName: resolvedCardName,
                        serverUrl,
                        cardKey,
                        minCookieSizeBytes,
                        targetScoreScope: targetScoreConfig.scope || 'all',
                        targetScoreTypes: Array.isArray(targetScoreConfig.types) ? targetScoreConfig.types : [],
                        source: 'card'
                    };
                }

                const legacyServerUrl = (localStorage.getItem('registration-upload-server-url') || '').trim();
                const legacyCardKey = (localStorage.getItem('registration-upload-card-key') || '').trim();
                if (legacyServerUrl && legacyCardKey) {
                    logger.warning(`自动上传使用旧的全局配置: ${resolvedCardName}`);
                    return {
                        cardName: resolvedCardName,
                        serverUrl: legacyServerUrl,
                        cardKey: legacyCardKey,
                        minCookieSizeBytes,
                        targetScoreScope: targetScoreConfig.scope || 'all',
                        targetScoreTypes: Array.isArray(targetScoreConfig.types) ? targetScoreConfig.types : [],
                        source: 'legacy'
                    };
                }

                logger.warning(`自动上传已跳过：卡片「${resolvedCardName}」未配置服务器地址或卡密`);
                return null;
            } catch (error) {
                logger.error(`获取卡片上传配置失败: ${error.message}`);
                return null;
            }
        }

        function getInlineRegistrationUploadConfig(result = {}) {
            const inlineConfig = result && typeof result.cardUploadConfig === 'object' ? result.cardUploadConfig : null;
            if (!inlineConfig) {
                return null;
            }

            const serverUrl = String(inlineConfig.serverUrl || '').trim();
            const cardKey = String(inlineConfig.cardKey || '').trim();
            if (!serverUrl || !cardKey) {
                return null;
            }

            return {
                cardName: String(inlineConfig.cardName || result.cardName || '').trim(),
                serverUrl,
                cardKey,
                minCookieSizeBytes: Number(inlineConfig.minCookieSizeBytes) || DEFAULT_MIN_COOKIE_SIZE_BYTES,
                targetScoreScope: inlineConfig.targetScoreScope || 'all',
                targetScoreTypes: Array.isArray(inlineConfig.targetScoreTypes) ? inlineConfig.targetScoreTypes : [],
                source: 'result-inline'
            };
        }

        async function uploadRegisteredCookie(result, taskId = '') {
            if (!result || !result.success) {
                return false;
            }

            const cookieStorageDisabled = result.cookiePersistenceDisabled === true ||
                String(result.cookieStorageMode || '').toLowerCase() === 'disabled';

            if (!result.cookiesSaved && !cookieStorageDisabled) {
                const payloadBytes = Number(result.cookiePayloadBytes);
                const minBytes = Number(result.minCookieSizeBytes);
                const sizeDetails = [];
                if (Number.isFinite(payloadBytes) && payloadBytes > 0) {
                    sizeDetails.push(`当前 ${payloadBytes} 字节`);
                }
                if (Number.isFinite(minBytes) && minBytes > 0) {
                    sizeDetails.push(`要求 ${minBytes} 字节`);
                }
                const detailText = sizeDetails.length ? `（${sizeDetails.join('，')}）` : '';
                updateRegistrationUploadStatus(`Cookie 未保存成功，已跳过上传${detailText}`, 'warning');
                logger.warning(`自动上传已跳过：Cookie 未保存成功${detailText}`);
                return false;
            }

            if (cookieStorageDisabled && !result.cookiesSaved) {
                logger.info('本地 Cookie 未写入磁盘，继续使用浏览器中的 Cookie 执行自动上传');
            }

            const autoUploadEnabled = elements.registrationAutoUpload ? elements.registrationAutoUpload.checked : true;
            if (!autoUploadEnabled) {
                updateRegistrationUploadStatus('自动上传已关闭', 'warning');
                return false;
            }

            const uploadConfig = getInlineRegistrationUploadConfig(result)
                || await getRegistrationUploadConfig(result.cardName || '');
            if (!uploadConfig) {
                updateRegistrationUploadStatus('未找到可用的上传配置，已跳过上传', 'warning');
                return false;
            }
            const { serverUrl, cardKey, cardName, targetScoreScope, targetScoreTypes } = uploadConfig;

            const deviceId = await getRegistrationUploadDeviceId();
            if (!deviceId) {
                updateRegistrationUploadStatus('获取设备ID失败，已跳过上传', 'error');
                logger.warning('自动上传已跳过：获取设备ID失败');
                return false;
            }

            const cookies = Array.isArray(result.cookies) ? result.cookies : [];
            if (cookies.length === 0) {
                updateRegistrationUploadStatus('没有可上传的 Cookie', 'warning');
                logger.warning(`自动上传已跳过：任务 ${taskId || 'unknown'} 没有可上传的 Cookie`);
                return false;
            }

            const sizeCheck = validateCookieUploadSize(cookies, result.minCookieSizeBytes ?? uploadConfig.minCookieSizeBytes ?? DEFAULT_MIN_COOKIE_SIZE_BYTES);
            if (!sizeCheck.allowed) {
                const sizeText = `（当前 ${sizeCheck.payloadBytes} 字节，要求 ${sizeCheck.minBytes} 字节）`;
                updateRegistrationUploadStatus(`Cookie 大小不足，已跳过上传${sizeText}`, 'warning');
                logger.warning(`自动上传已跳过：Cookie 大小不足${sizeText}`);
                return false;
            }

            updateRegistrationUploadStatus('正在上传 Cookie 到服务器...', '');

            try {
                const uploadPayload = {
                    key: cardKey,
                    device_id: deviceId,
                    account: result.email || result.account || '',
                    password: result.password || '',
                    cookies,
                    score: Number(result.points || 0),
                    today_used: 2,
                    today_score: null,
                    last_used_at: '',
                    note: `注册器自动上传${taskId ? `(${taskId})` : ''}`,
                    card_name: cardName,
                    target_score_scope: targetScoreScope || 'all',
                    target_score_types: Array.isArray(targetScoreTypes) ? targetScoreTypes : [],
                    target_score_type: Array.isArray(targetScoreTypes) && targetScoreTypes.length > 0 ? targetScoreTypes[0] : ''
                };

                const uploadResult = await ipcRenderer.invoke('cookie-upload-ai-cookie', serverUrl, uploadPayload);
                if (uploadResult && uploadResult.success) {
                    updateRegistrationUploadStatus('Cookie 已上传到服务器', 'success');
                    logger.info(`自动上传成功: ${result.email || '未知账号'} (${cardName}) -> ${serverUrl}`);
                    return true;
                }

                const errorText = uploadResult?.error || '上传失败';
                updateRegistrationUploadStatus(`上传失败: ${errorText}`, 'error');
                logger.error(`自动上传失败: ${errorText}`);
                return false;
            } catch (error) {
                updateRegistrationUploadStatus(`上传异常: ${error.message}`, 'error');
                logger.error(`自动上传异常: ${error.message}`);
                return false;
            }
        }

        async function startRegistration() {
            if (state.registrationTcpControlLocked) {
                utils.showMessage('服务器已禁止本地控制，不能由本地手动启动', 'info', elements);
                return;
            }

            const selectedCardName = String(state.currentCard || cardManager.getCurrentCard() || '').trim();
            if (selectedCardName && selectedCardName !== state.currentCard) {
                state.currentCard = selectedCardName;
            }

            if (!selectedCardName) {
                utils.showMessage('请先选择一个注册卡片', 'error', elements);
                return;
            }

            const controlSaveResult = await saveRegistrationControls();
            const uploadSaveResult = await saveRegistrationUploadControls();

            if (controlSaveResult && controlSaveResult.success === false) {
                logger.warning(`开始前保存运行配置失败: ${controlSaveResult.error || '未知错误'}`);
            }
            if (uploadSaveResult && uploadSaveResult.success === false) {
                logger.warning(`开始前保存上传配置失败: ${uploadSaveResult.error || '未知错误'}`);
            }

            const latestConfig = await readSavedRegistrationConfig();
            const runtimeConfig = buildRegistrationStartConfig(latestConfig);
            const timedRegistrationCount = runtimeConfig.timedRegistrationCount;
            const timedRegistrationCycleCount = runtimeConfig.timedRegistrationCycleCount;
            const timedRegistrationDelaySeconds = Math.max(0, Math.floor(runtimeConfig.timedRegistrationDelayMs / 1000));
            const timedRegistrationStartMode = runtimeConfig.timedRegistrationStartMode;
            const timedStartModeText = timedRegistrationStartMode === 'delayed' ? '延时开始' : '立即执行';
            const config = {
                ...runtimeConfig,
                timedRegistrationDelayMs: runtimeConfig.timedRegistrationDelayMs,
                browserSettings: runtimeConfig.browserSettings,
                browser_settings: runtimeConfig.browserSettings
            };

            try {
                elements.startBtn.disabled = true;
                elements.stopBtn.disabled = false;
                elements.statusLabel.textContent = config.runMode === 2
                    ? `定时注册进行中... (单次数量: ${timedRegistrationCount}, 循环次数: ${timedRegistrationCycleCount}, 并发: ${config.concurrentCount}, 间隔: ${timedRegistrationDelaySeconds}s, 开始: ${timedStartModeText})`
                    : config.runMode === 1
                        ? `循环注册进行中... (并发: ${config.concurrentCount})`
                        : `注册进行中... (并发: ${config.concurrentCount})`;

                const result = await ipcRenderer.invoke('start-registration', config);

                if (config.runMode === 0) {
                    elements.startBtn.disabled = false;
                }

                if (!result.success) {
                    utils.showMessage(`开始注册失败: ${result.error}`, 'error', elements);
                    elements.startBtn.disabled = false;
                    elements.stopBtn.disabled = true;
                }
            } catch (error) {
                utils.showMessage(`开始注册异常: ${error.message}`, 'error', elements);
                elements.startBtn.disabled = false;
                elements.stopBtn.disabled = true;
            }
        }

        async function stopRegistration() {
            if (state.registrationTcpControlLocked) {
                utils.showMessage('服务器已禁止本地控制，不能由本地手动停止', 'info', elements);
                return;
            }

            try {
                const result = await ipcRenderer.invoke('stop-registration');
                if (result.success) {
                    utils.logToConsole('注册已停止', 'info');
                } else {
                    utils.showMessage(`停止注册失败: ${result.error}`, 'error', elements);
                }
            } catch (error) {
                utils.showMessage(`停止注册异常: ${error.message}`, 'error', elements);
            }
        }

        function updateCustomTestAccountButtons() {
            if (elements.customTestAccountBtn) {
                elements.customTestAccountBtn.disabled = customTestAccountBusy;
                elements.customTestAccountBtn.textContent = customTestAccountBrowserOpen ? '获取Cookie' : '自定义测试账号';
            }
            if (elements.stopCustomTestAccountBtn) {
                elements.stopCustomTestAccountBtn.disabled = customTestAccountBusy || !customTestAccountBrowserOpen;
            }
        }

        async function handleCustomTestAccountAction(onSaved = null) {
            if (customTestAccountBusy) {
                return;
            }

            customTestAccountBusy = true;
            updateCustomTestAccountButtons();

            try {
                if (!customTestAccountBrowserOpen) {
                    const selectedCardName = String(state.currentCard || cardManager.getCurrentCard() || '').trim();
                    if (!selectedCardName) {
                        utils.showMessage('请先选择一个注册卡片', 'warning', elements);
                        return;
                    }

                    const browserSettings = {
                        ...buildBrowserSettingsForSave(),
                        headless: false,
                        headlessMode: false
                    };
                    const result = await ipcRenderer.invoke(IPC_CHANNELS.customTestAccountStart, {
                        cardName: selectedCardName,
                        browserType: browserSettings.browser_type || browserSettings.browserType || '',
                        browserSettings
                    });

                    if (!result || result.success !== true) {
                        utils.showMessage(`打开自定义测试账号失败: ${result?.error || '未知错误'}`, 'error', elements);
                        return;
                    }

                    customTestAccountBrowserOpen = true;
                    logger.info(`自定义测试账号浏览器已打开: ${result.url || ''}`);
                    utils.showMessage('浏览器已打开，请手动登录账号后点击“获取Cookie”', 'info', elements);
                    return;
                }

                const result = await ipcRenderer.invoke(IPC_CHANNELS.customTestAccountCapture);
                if (!result || result.success !== true) {
                    const errorText = String(result?.error || '');
                    if (/未打开|已关闭|不存在/.test(errorText)) {
                        customTestAccountBrowserOpen = false;
                    }
                    utils.showMessage(`获取Cookie失败: ${result?.error || '未知错误'}`, 'error', elements);
                    return;
                }

                customTestAccountBrowserOpen = false;
                logger.info(`自定义测试账号Cookie已保存: ${result.cardName}/${result.fileName}，数量: ${result.cookieCount}`);
                utils.showMessage(`Cookie已保存到${result.cardName}: ${result.fileName}`, 'success', elements);
                if (typeof onSaved === 'function') {
                    await onSaved();
                }
            } catch (error) {
                utils.showMessage(`自定义测试账号异常: ${error.message}`, 'error', elements);
            } finally {
                customTestAccountBusy = false;
                updateCustomTestAccountButtons();
            }
        }

        async function stopCustomTestAccount() {
            if (customTestAccountBusy) {
                return;
            }

            customTestAccountBusy = true;
            updateCustomTestAccountButtons();
            try {
                const result = await ipcRenderer.invoke(IPC_CHANNELS.customTestAccountStop);
                if (!result || result.success !== true) {
                    utils.showMessage(`停止自定义测试失败: ${result?.error || '未知错误'}`, 'error', elements);
                    return;
                }

                customTestAccountBrowserOpen = false;
                logger.info('自定义测试账号已停止');
                utils.showMessage('自定义测试已停止', 'info', elements);
            } catch (error) {
                utils.showMessage(`停止自定义测试异常: ${error.message}`, 'error', elements);
            } finally {
                customTestAccountBusy = false;
                updateCustomTestAccountButtons();
            }
        }

        return {
            DEFAULT_MIN_COOKIE_SIZE_BYTES,
            getSelectedRunMode,
            setRunMode,
            getRegistrationRecoveryAttempts,
            getTimedRegistrationCount,
            getTimedRegistrationCycleCount,
            getTimedRegistrationStartMode,
            getTimedRegistrationDelaySeconds,
            getTimedRegistrationDelayMs,
            updateTimedRegistrationControlState,
            loadRegistrationControls,
            saveRegistrationControls,
            updateRegistrationUploadStatus,
            saveRegistrationUploadControls,
            loadRegistrationUploadControls,
            resolveCookieUploadMinSizeBytes,
            calculateCookieUploadPayloadBytes,
            validateCookieUploadSize,
            getRegistrationUploadDeviceId,
            getRegistrationUploadConfig,
            uploadRegisteredCookie,
            startRegistration,
            stopRegistration,
            handleCustomTestAccountAction,
            stopCustomTestAccount,
            updateCustomTestAccountButtons
        };
};
