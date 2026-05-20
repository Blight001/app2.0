/**
 * 渲染层 wiring 模块
 *
 * 这里承载事件绑定、IPC 监听、测试流程和初始化编排，
 * 让 renderer-core.js 只保留共享状态和核心工具。
 */
const createTaskProgressHandlers = require('./task-progress/handlers');
const createRendererWiringIpc = require('./renderer-wiring-ipc');
const createRendererWiringEvents = require('./renderer-wiring-events');

module.exports = function createRendererWiring(deps) {
    const state = deps;
    const {
        elements,
        cardManager,
        cookieManager,
        cookieTester,
        clashManager,
        utils,
        browserRegion,
        logger,
        ipcRenderer,
        loadCookies,
        saveCookieUserConfig,
        loadCookieUserConfig,
        loadTcpServerConfig,
        saveTcpServerConfig,
        loadAiAssistantConfig,
        saveRegistrationControls,
        loadRegistrationControls,
        saveRegistrationUploadControls,
        loadRegistrationUploadControls,
        updateRegistrationUploadStatus,
        updateBrowserSettings,
        detectBrowserForSelect,
        setRunMode,
        DEFAULT_REGISTRATION_RUN_MODE,
        loadHaikaBindAccountControls,
        saveHaikaBindAccountControls,
        updateHaikaBindAccountControls,
        startHaikaBinding,
        stopHaikaBinding,
        startRegistration,
        stopRegistration,
        parseCookieAccountInfo,
        hideCookieAccountContextMenu,
        hideCookieBatchContextMenu,
        showCookieAccountContextMenu,
        showCookieBatchContextMenu,
        updateCookieSelectionButton,
        redeemTrialBinding,
        openHaikaCategoryModal,
        refreshTrialSmsCode,
        loadHaikaCategories,
        getSelectedHaikaCategory,
        createHaikaCategory,
        setSelectedHaikaCategory,
        syncHaikaImportTargetCategory,
        loadHaikaKeys,
        showHaikaSuggestions,
        clearHaikaSuggestions,
        confirmHaikaImport,
        closeHaikaCategoryModal,
        loadHaikaTrialState,
        clearTrialInfo,
        setTrialStatus,
        setupConsole,
        uploadRegisteredCookie
    } = deps;

    function getActiveClashRegionKey() {
        if (!browserRegion || typeof browserRegion.inferBrowserRegionKeyFromNodeName !== 'function') {
            return '';
        }
        if (!clashManager || typeof clashManager.getClashState !== 'function') {
            return '';
        }

        const clashState = clashManager.getClashState() || {};
        if (clashState.tunMode !== true && clashState.systemProxy !== true) {
            return '';
        }

        return browserRegion.inferBrowserRegionKeyFromNodeName(clashState.currentNode || '') || '';
    }

    function getActiveClashBrowserSettingsPatch() {
        if (!clashManager || typeof clashManager.getClashState !== 'function') {
            return {};
        }

        const clashState = clashManager.getClashState() || {};
        if (clashState.tunMode !== true && clashState.systemProxy !== true) {
            return {};
        }

        const currentNode = String(clashState.currentNode || '').trim();
        if (!currentNode) {
            return {};
        }

        return {
            currentNode,
            current_node: currentNode,
            clashCurrentNode: currentNode
        };
    }

    function formatTcpEndpointLabel(endpoint = null) {
        if (!endpoint || typeof endpoint !== 'object') {
            return '';
        }

        const host = String(endpoint.host || '').trim();
        const port = Number.parseInt(endpoint.port, 10);
        if (host && Number.isFinite(port) && port > 0) {
            return `${host}:${port}`;
        }

        const url = String(endpoint.url || '').trim();
        if (!url) {
            return '';
        }

        try {
            const parsed = new URL(url.includes('://') ? url : `http://${url}`);
            const parsedHost = parsed.hostname || '';
            const parsedPort = Number.parseInt(parsed.port, 10);
            return parsedHost && Number.isFinite(parsedPort) && parsedPort > 0
                ? `${parsedHost}:${parsedPort}`
                : parsedHost || url;
        } catch (_) {
            return url;
        }
    }

    function getTcpConnectionConsoleElement() {
        return elements.tcpConnectionConsoleOutput || null;
    }

    function clearTcpConnectionConsole() {
        const consoleElement = getTcpConnectionConsoleElement();
        if (consoleElement) {
            consoleElement.innerHTML = '';
        }
        state.lastTcpConnectionConsoleSignature = '';
    }

    function buildTcpConnectionConsoleSignature() {
        const connectionStatus = state.registrationTcpConnectionStatus || {};
        const endpointLabel = formatTcpEndpointLabel(state.registrationTcpEndpoint);
        const failedTopics = Array.isArray(connectionStatus?.subscribeResult?.failedTopics)
            ? connectionStatus.subscribeResult.failedTopics
            : [];

        return [
            state.registrationTcpEnabled === true ? 'enabled' : 'disabled',
            connectionStatus.connected === true ? 'connected' : 'disconnected',
            state.registrationTcpControlLocked === true ? 'locked' : 'unlocked',
            state.registrationTcpReconnectEnabled !== false ? 'reconnect-on' : 'reconnect-off',
            endpointLabel || '',
            connectionStatus.lastConnectError || '',
            connectionStatus.statusCode || 0,
            failedTopics.map((item) => `${item.topic || ''}:${item.error || ''}`).join('|')
        ].join('||');
    }

    function logTcpConnectionConsoleState() {
        const signature = buildTcpConnectionConsoleSignature();
        if (signature === state.lastTcpConnectionConsoleSignature) {
            return;
        }

        state.lastTcpConnectionConsoleSignature = signature;

        const connectionStatus = state.registrationTcpConnectionStatus || {};
        const endpointLabel = formatTcpEndpointLabel(state.registrationTcpEndpoint) || '未配置';
        const reconnectText = state.registrationTcpReconnectEnabled !== false ? '开启' : '关闭';
        const lockText = state.registrationTcpControlLocked === true ? '服务器锁定' : '本地可编辑';
        const statusText = state.registrationTcpEnabled === true
            ? (connectionStatus.connected === true
                ? '已连接'
                : `未连接${connectionStatus.lastConnectError ? `（${connectionStatus.lastConnectError}）` : ''}`)
            : '未启用';

        const consoleLevel = connectionStatus.connected === true
            ? 'info'
            : (connectionStatus.lastConnectError ? 'warning' : 'info');
        appendTcpConnectionConsoleLine(
            consoleLevel,
            '状态',
            `${statusText}，地址: ${endpointLabel}，自动重连: ${reconnectText}，控制: ${lockText}`
        );
    }

    function appendTcpConnectionConsoleLine(level, title, message, detail = '') {
        const consoleElement = getTcpConnectionConsoleElement();
        if (!consoleElement) {
            return;
        }

        const line = document.createElement('div');
        const normalizedLevel = ['debug', 'info', 'warning', 'error', 'critical'].includes(level)
            ? level
            : 'info';
        line.className = `console-line console-line--${normalizedLevel}`;

        const header = document.createElement('div');
        header.className = 'console-line__header';

        const meta = document.createElement('span');
        meta.className = 'console-line__meta';
        meta.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        const badge = document.createElement('span');
        badge.className = 'console-line__badge';
        badge.textContent = String(title || 'TCP').trim() || 'TCP';

        header.appendChild(meta);
        header.appendChild(badge);

        const body = document.createElement('div');
        body.className = 'console-line__body';
        body.textContent = String(message || '').trim() || '无内容';

        line.appendChild(header);
        line.appendChild(body);

        if (detail) {
            const detailNode = document.createElement('div');
            detailNode.className = 'console-line__detail';
            detailNode.textContent = String(detail);
            line.appendChild(detailNode);
        }

        consoleElement.appendChild(line);
        while (consoleElement.children.length > 200) {
            consoleElement.removeChild(consoleElement.firstElementChild);
        }
        consoleElement.scrollTop = consoleElement.scrollHeight;
    }

    function setStatusText(element, enabled, text, fallbackClass = 'mqtt-status-neutral') {
        if (!element) {
            return;
        }

        element.textContent = text;
        element.classList.remove('mqtt-status-success', 'mqtt-status-error', 'mqtt-status-neutral');
        element.classList.add(enabled === true ? 'mqtt-status-success' : enabled === false ? 'mqtt-status-error' : fallbackClass);
    }

    async function refreshTcpConnectionRuntimeState() {
        try {
            const result = await ipcRenderer.invoke('get-app-runtime-info');
            if (!result || result.success !== true) {
                return false;
            }

            state.registrationTcpEnabled = result.registrationTcpEnabled === true;
            state.registrationTcpControlLocked = result.registrationTcpControlLocked === true;
            state.registrationTcpControlState = result.registrationTcpControlState || {};
            state.registrationTcpEndpoint = result.registrationTcpEndpoint || null;
            state.registrationTcpReconnectEnabled = result.registrationTcpReconnectEnabled !== false;
            state.registrationTcpConnectionStatus = result.registrationTcpConnectionStatus || null;
            state.licenseUsageLocked = result.licenseUsageSnapshot?.unlimited === true
                ? false
                : result.licenseUsageLocked === true;
            state.licenseUsageSnapshot = result.licenseUsageSnapshot || null;
            if (cardManager && typeof cardManager.setRegistrationCardAccessMode === 'function') {
                cardManager.setRegistrationCardAccessMode(result.licenseUsageSnapshot?.unlimited === true ? 'all' : 'restricted');
            }
            updateTcpConnectionPanelState();
            updateLicenseUsageStatusText();
            applyTcpManagedUiLockdown();
            return true;
        } catch (error) {
            logger.warning(`刷新TCP状态失败: ${error.message}`);
            appendTcpConnectionConsoleLine('error', '刷新失败', `刷新TCP状态失败: ${error.message}`);
            return false;
        }
    }

    function updateTcpConnectionPanelState() {
        const endpointLabel = formatTcpEndpointLabel(state.registrationTcpEndpoint);
        const connectionStatus = state.registrationTcpConnectionStatus || {};
        const subscribeResult = connectionStatus.subscribeResult || {};
        const enabled = state.registrationTcpEnabled === true;
        const connected = connectionStatus.connected === true;
        const subscribedOk = enabled && connected && subscribeResult.success !== false && (Array.isArray(subscribeResult.failedTopics) ? subscribeResult.failedTopics.length === 0 : true);
        const reconnectEnabled = state.registrationTcpReconnectEnabled !== false;
        const locked = state.registrationTcpControlLocked === true;

        setStatusText(
            elements.mqttConnectionEnabled,
            enabled,
            enabled ? '已启用' : '未启用'
        );
        setStatusText(
            elements.mqttConnectionConnected,
            connected,
            connected ? '已连接' : (connectionStatus.lastConnectError ? `失败: ${connectionStatus.lastConnectError}` : '未连接')
        );
        setStatusText(
            elements.mqttConnectionSubscribed,
            subscribedOk,
            subscribedOk
                ? '已连通'
                : ((subscribeResult.failedTopics || []).length > 0
                    ? `失败: ${(subscribeResult.failedTopics || []).map(item => item.topic).join(', ')}`
                    : '未连通')
        );
        setStatusText(
            elements.mqttConnectionReconnect,
            reconnectEnabled,
            reconnectEnabled ? '开启' : '关闭'
        );
        setStatusText(
            elements.mqttConnectionLocked,
            !locked,
            locked ? '服务器锁定' : '本地可编辑'
        );

        if (elements.mqttConnectionEndpoint) {
            elements.mqttConnectionEndpoint.textContent = endpointLabel || '未配置';
            elements.mqttConnectionEndpoint.classList.remove('mqtt-status-success', 'mqtt-status-error', 'mqtt-status-neutral');
            elements.mqttConnectionEndpoint.classList.add(endpointLabel ? 'mqtt-status-success' : 'mqtt-status-neutral');
        }

        logTcpConnectionConsoleState();
    }

    function applyTcpManagedUiLockdown() {
        if (typeof document === 'undefined') {
            return;
        }

        const locked = state.registrationTcpControlLocked === true || state.licenseUsageLocked === true;
        if (document.body) {
            document.body.classList.toggle('tcp-managed-mode', state.registrationTcpControlLocked === true);
            document.body.classList.toggle('license-usage-locked', state.licenseUsageLocked === true);
        }

        const selector = '.content-area button, .content-area input, .content-area select, .content-area textarea';
        document.querySelectorAll(selector).forEach((element) => {
            if (!element || typeof element.disabled === 'undefined') {
                return;
            }

            if (element.classList.contains('tab-header') || element.classList.contains('right-tab-header')) {
                return;
            }

            if (element.id === 'exit-app-btn') {
                return;
            }

            if (element.id === 'start-btn' || element.id === 'stop-btn') {
                return;
            }

            if (element.classList.contains('run-mode-btn')) {
                return;
            }

            if (element.closest && element.closest('#registration-browser-settings-section')) {
                return;
            }

            element.disabled = locked;
        });
    }

    function updateLicenseUsageStatusText() {
        if (!elements.statusLabel) {
            return;
        }

        const snapshot = state.licenseUsageSnapshot || {};
        const summaryText = String(snapshot.summaryText || '').trim();
        const remainingText = String(snapshot.remainingText || '').trim();
        const titleUsageText = snapshot.unlimited === true
            ? '剩余次数：无限次'
            : remainingText
                ? `剩余次数：${remainingText}${/^\d+(?:\.\d+)?$/.test(remainingText) ? ' 次' : ''}`
                : summaryText
                    ? `剩余次数：${summaryText}`
                    : '剩余次数：未获取';
        const buttonUsageText = snapshot.unlimited === true
            ? '无限次'
            : remainingText
                ? `${remainingText}${/^\d+(?:\.\d+)?$/.test(remainingText) ? ' 次' : ''}`
                : summaryText || '未获取';

        if (elements.licenseUsageLabel) {
            elements.licenseUsageLabel.textContent = titleUsageText;
        }

        if (state.licenseUsageLocked === true) {
            elements.statusLabel.textContent = '次数锁定';
            updateRegistrationStartButtonText(buttonUsageText);
            return;
        }

        const currentText = String(elements.statusLabel.textContent || '').trim();
        if (currentText === '次数锁定' || currentText.startsWith('次数锁定:')) {
            elements.statusLabel.textContent = '就绪';
        }

        updateRegistrationStartButtonText(buttonUsageText);
    }

    function updateRegistrationStartButtonText(usageText = '') {
        if (!elements.startBtn) {
            return;
        }

        const fallbackText = '开始注册';
        const normalizedUsageText = String(usageText || '').trim();
        if (!normalizedUsageText || normalizedUsageText === '未获取') {
            elements.startBtn.textContent = fallbackText;
            return;
        }

        if (/^剩余/.test(normalizedUsageText) || /无限次$/.test(normalizedUsageText)) {
            elements.startBtn.textContent = `${fallbackText}（${normalizedUsageText}）`;
            return;
        }

        elements.startBtn.textContent = `${fallbackText}（剩余 ${normalizedUsageText}）`;
    }

    function ensureTcpManagedUiObserver() {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
            return;
        }

        if (state.registrationTcpControlLocked !== true) {
            if (state.tcpManagedUiObserver) {
                try {
                    state.tcpManagedUiObserver.disconnect();
                } catch (_) {}
                state.tcpManagedUiObserver = null;
            }
            return;
        }

        if (state.tcpManagedUiObserver) {
            return;
        }

        const target = document.querySelector('.content-area') || document.body;
        if (!target) {
            return;
        }

        state.tcpManagedUiObserver = new MutationObserver(() => {
            applyTcpManagedUiLockdown();
        });
        state.tcpManagedUiObserver.observe(target, {
            childList: true,
            subtree: true
        });
    }

    function applyBrowserRegionPreset({ allowClashInference = false } = {}) {
        if (!browserRegion || typeof browserRegion.getBrowserRegionPreset !== 'function') {
            return false;
        }

        let regionValue = elements.browserRegion ? String(elements.browserRegion.value || '').trim() : '';
        const inferredRegion = !regionValue && allowClashInference ? getActiveClashRegionKey() : '';
        if (inferredRegion && elements.browserRegion) {
            elements.browserRegion.value = inferredRegion;
            regionValue = inferredRegion;
        }

        const preset = browserRegion.getBrowserRegionPreset(regionValue);
        if (!preset) {
            const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale
                || (typeof navigator !== 'undefined' ? navigator.language : '')
                || 'en-US';
            const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            let changed = false;

            if (elements.browserLocale) {
                const normalizedLocale = String(systemLocale || '').trim().replace('_', '-');
                if (elements.browserLocale.value !== normalizedLocale) {
                    elements.browserLocale.value = normalizedLocale;
                    changed = true;
                }
            }
            if (elements.browserTimezoneId) {
                const normalizedTimezone = String(systemTimezone || '').trim();
                if (elements.browserTimezoneId.value !== normalizedTimezone) {
                    elements.browserTimezoneId.value = normalizedTimezone;
                    changed = true;
                }
            }
            return changed;
        }

        let changed = false;
        if (inferredRegion && elements.browserRegion && elements.browserRegion.value !== inferredRegion) {
            elements.browserRegion.value = inferredRegion;
            changed = true;
        }
        if (elements.browserLocale && preset.locale) {
            if (elements.browserLocale.value !== preset.locale) {
                elements.browserLocale.value = preset.locale;
                changed = true;
            }
        }
        if (elements.browserTimezoneId && preset.timezoneId) {
            if (elements.browserTimezoneId.value !== preset.timezoneId) {
                elements.browserTimezoneId.value = preset.timezoneId;
                changed = true;
            }
        }

        return changed;
    }

    async function initializeAppRuntimeMode() {
        try {
            const result = await ipcRenderer.invoke('get-app-runtime-info');
            if (!result || result.success !== true) {
                return;
            }

            const runtime = {
                startupMode: String(result.startupMode || '').trim() || 'local',
                registrationMode: String(result.registrationMode || '').trim() || 'standalone',
                registrationEmbedded: result.registrationEmbedded === true || result.webControlEmbedded === true,
                registrationHostApp: String(result.registrationHostApp || result.webControlHostApp || '').trim(),
                webControlEnabled: result.webControlEnabled === true,
                webControlHeadless: result.webControlHeadless === true,
                webControlEmbedded: result.webControlEmbedded === true,
                webControlHostApp: String(result.webControlHostApp || '').trim(),
                webControlUrl: String(result.webControlUrl || '').trim()
            };

            state.registrationRuntime = runtime;
            state.registrationMode = runtime.registrationMode;
            state.registrationEmbedded = runtime.registrationEmbedded === true;
            state.registrationHostApp = runtime.registrationHostApp;
            state.webControlUrl = runtime.webControlUrl;
            state.tcpManagedMode = false;
            state.registrationTcpEnabled = result.registrationTcpEnabled === true;
            state.registrationTcpControlLocked = result.registrationTcpControlLocked === true;
            state.registrationTcpControlState = result.registrationTcpControlState || {};
            state.registrationTcpEndpoint = result.registrationTcpEndpoint || null;
            state.registrationTcpReconnectEnabled = result.registrationTcpReconnectEnabled !== false;
            state.registrationTcpConnectionStatus = result.registrationTcpConnectionStatus || null;
            state.licenseUsageLocked = result.licenseUsageSnapshot?.unlimited === true
                ? false
                : result.licenseUsageLocked === true;
            state.licenseUsageSnapshot = result.licenseUsageSnapshot || null;
            if (cardManager && typeof cardManager.setRegistrationCardAccessMode === 'function') {
                cardManager.setRegistrationCardAccessMode(result.licenseUsageSnapshot?.unlimited === true ? 'all' : 'restricted');
            }
            cardManager.setCardControlMode('local');

            if (document.documentElement) {
                document.documentElement.dataset.registrationMode = runtime.registrationMode;
                document.documentElement.dataset.registrationEmbedded = runtime.registrationEmbedded ? 'true' : 'false';
                document.documentElement.dataset.registrationHostApp = runtime.registrationHostApp || '';
            }
            if (document.body) {
                document.body.dataset.registrationMode = runtime.registrationMode;
                document.body.dataset.registrationEmbedded = runtime.registrationEmbedded ? 'true' : 'false';
                document.body.classList.toggle('registration-embedded', runtime.registrationEmbedded === true);
                document.body.classList.toggle('registration-standalone', runtime.registrationEmbedded !== true);
            }

            if (elements.exitAppBtn) {
                if (runtime.registrationEmbedded) {
                    elements.exitAppBtn.textContent = '关闭标签';
                    elements.exitAppBtn.title = '嵌入模式下由宿主接管关闭';
                    elements.exitAppBtn.setAttribute('aria-label', '关闭当前标签页');
                } else {
                    elements.exitAppBtn.textContent = '退出';
                    elements.exitAppBtn.title = '退出应用';
                    elements.exitAppBtn.setAttribute('aria-label', '退出应用');
                }
            }

            if (elements.themeToggleBtn) {
                elements.themeToggleBtn.title = runtime.registrationEmbedded
                    ? '切换深色浅色模式'
                    : '切换到深色模式';
            }

            if (result.registrationTcpControlLocked) {
                logger.info('TCP 连接已启用，当前由服务器控制状态锁定');
            } else if (result.registrationTcpEnabled) {
                logger.info('TCP 连接已启用，本地功能保持可用');
            }

            updateTcpConnectionPanelState();
            updateLicenseUsageStatusText();

            if (elements.openCookieFolderBtn) {
                elements.openCookieFolderBtn.disabled = false;
                elements.openCookieFolderBtn.title = '打开Cookie文件夹';
            }

            applyTcpManagedUiLockdown();
            ensureTcpManagedUiObserver();
        } catch (error) {
            logger.warning(`读取应用运行模式失败: ${error.message}`);
        }
    }

    async function syncRegistrationCardStateFromServer(cardMode = 'register') {
        const mode = cardMode === 'test' || cardMode === 'haikaBind' ? cardMode : 'register';

        if (!state.registrationTcpEnabled) {
            return false;
        }

        try {
            const result = await ipcRenderer.invoke('get-registration-ui-state', {
                card_type: mode,
                log_limit: 200
            });

            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取注册卡片状态失败');
            }

            const snapshot = result || {};
            const cards = Array.isArray(snapshot.cards) ? snapshot.cards : null;
            const currentCardName = String(
                snapshot.current_card_name
                || snapshot.currentCardName
                || snapshot.currentCard
                || ''
            ).trim();
            const loadEvent = mode === 'test'
                ? 'test-cards-loaded'
                : mode === 'haikaBind'
                    ? 'haika-bind-cards-loaded'
                    : 'cards-loaded';

            if (mode === 'test') {
                cardManager.setCurrentTestCard(currentCardName || null);
                state.currentTestCard = currentCardName || null;
            } else if (mode === 'haikaBind') {
                cardManager.setCurrentHaikaBindCard(currentCardName || null);
                state.currentHaikaBindCard = currentCardName || null;
            } else {
                cardManager.setCurrentCard(currentCardName || null);
                state.currentCard = currentCardName || null;
            }

            if (Array.isArray(cards)) {
                window.dispatchEvent(new CustomEvent(loadEvent, { detail: cards }));
            }

            if (mode === 'register') {
                if (elements.startBtn) {
                    elements.startBtn.disabled = !currentCardName;
                }
                if (elements.statusLabel) {
                    elements.statusLabel.textContent = currentCardName ? `已选择卡片: ${currentCardName}` : '未选择卡片';
                }
                await loadCookies();
            }

            logger.info(
                `已同步${mode === 'register' ? '注册' : mode === 'test' ? '测试' : '海卡绑定'}状态${Array.isArray(cards) ? `: ${cards.length} 个卡片` : ''}${currentCardName ? `，当前卡片: ${currentCardName}` : ''}`
            );
            return true;
        } catch (error) {
            logger.warning(`同步${mode === 'register' ? '注册' : mode === 'test' ? '测试' : '海卡绑定'}卡片失败: ${error.message}`);
            return false;
        }
    }

    async function handleTcpSettingsSave() {
        if (!elements.tcpSettingsSaveBtn) {
            return;
        }

        const saveButton = elements.tcpSettingsSaveBtn;
        const originalText = saveButton.textContent;
        saveButton.disabled = true;
        saveButton.textContent = '保存中...';

        try {
            const result = await saveTcpServerConfig();
            if (result && result.success) {
                await loadTcpServerConfig();
                await refreshTcpConnectionRuntimeState();

                const savedAddress = result.tcpServerUrl || elements.tcpServerUrl?.value || '未配置';
                if (result.tcpRestartError) {
                    logger.warning(`TCP服务器地址已保存，但重新连接失败: ${result.tcpRestartError}`);
                    utils.showMessage(`TCP服务器地址已保存，但重新连接失败: ${result.tcpRestartError}`, 'warning', elements);
                } else {
                    const message = `TCP配置已保存地址${savedAddress}`;
                    logger.info(message);
                    utils.showMessage(message, 'success', elements);
                }
                return;
            }

            const error = result?.error || '保存失败';
            utils.showMessage(`保存TCP服务器地址失败: ${error}`, 'error', elements);
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = originalText;
        }
    }

    async function openProxyQuickSite(url, button, label) {
        if (!button) {
            return;
        }

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '打开中...';

        try {
            const result = await ipcRenderer.invoke('open-fingerprint-url', {
                url,
                browserType: elements.browserType ? String(elements.browserType.value || '').trim() : 'electron'
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '打开失败');
            }

            const targetLabel = label || result.url || url;
            if (result.warning) {
                logger.warning(`已在指纹浏览器中打开 ${targetLabel}，但页面加载失败: ${result.warning}`);
                utils.showMessage(`已打开 ${targetLabel}，但页面加载失败: ${result.warning}`, 'warning', elements);
            } else {
                logger.info(`已在指纹浏览器中打开 ${targetLabel}`);
                utils.showMessage(`已在指纹浏览器中打开 ${targetLabel}`, 'success', elements);
            }
        } catch (error) {
            logger.error(`打开 ${label || url} 失败: ${error.message}`);
            utils.showMessage(`打开 ${label || url} 失败: ${error.message}`, 'error', elements);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    const DRAWER_LAYOUT_STORAGE_KEY = 'ui-panel-drawer-state';

    function normalizeDrawerState(rawState) {
        return {
            leftCollapsed: rawState && rawState.leftCollapsed === true,
            rightCollapsed: rawState && rawState.rightCollapsed === true
        };
    }

    function loadDrawerState() {
        try {
            const raw = localStorage.getItem(DRAWER_LAYOUT_STORAGE_KEY);
            if (!raw) {
                return { leftCollapsed: false, rightCollapsed: false };
            }
            return normalizeDrawerState(JSON.parse(raw));
        } catch (_) {
            return { leftCollapsed: false, rightCollapsed: false };
        }
    }

    function saveDrawerState(drawerState) {
        try {
            localStorage.setItem(DRAWER_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeDrawerState(drawerState)));
        } catch (_) {
            // 忽略本地存储不可用的情况
        }
    }

    function setDrawerBubbleState(button, visible, label) {
        if (!button) {
            return;
        }

        const isVisible = visible === true;
        button.hidden = !isVisible;
        button.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    function applyDrawerLayout(drawerState, persist = true) {
        const normalized = normalizeDrawerState(drawerState);
        const mainContainer = elements.mainContainer;
        const leftPanel = elements.leftPanel;
        const rightPanel = elements.rightPanel;

        if (mainContainer) {
            mainContainer.classList.toggle('drawer-left-collapsed', normalized.leftCollapsed);
            mainContainer.classList.toggle('drawer-right-collapsed', normalized.rightCollapsed);
        }

        if (leftPanel) {
            leftPanel.setAttribute('aria-hidden', normalized.leftCollapsed ? 'true' : 'false');
            leftPanel.inert = normalized.leftCollapsed;
        }

        if (rightPanel) {
            rightPanel.setAttribute('aria-hidden', normalized.rightCollapsed ? 'true' : 'false');
            rightPanel.inert = normalized.rightCollapsed;
        }

        setDrawerBubbleState(
            elements.leftDrawerBubble,
            normalized.leftCollapsed,
            '展开左侧面板'
        );
        setDrawerBubbleState(
            elements.rightDrawerBubble,
            normalized.rightCollapsed,
            '展开右侧面板'
        );

        if (persist) {
            saveDrawerState(normalized);
        }
    }

    function toggleLeftDrawer() {
        const current = loadDrawerState();
        applyDrawerLayout({
            leftCollapsed: !current.leftCollapsed,
            rightCollapsed: current.rightCollapsed
        });
    }

    function toggleRightDrawer() {
        const current = loadDrawerState();
        applyDrawerLayout({
            leftCollapsed: current.leftCollapsed,
            rightCollapsed: !current.rightCollapsed
        });
    }

    function activateMiddleTab(targetTab) {
        const buttons = elements.middleTabButtons;
        const contents = elements.middleTabContents;

        if (!buttons || !contents) {
            return;
        }

        buttons.forEach((button) => {
            const isActive = button.dataset.tab === targetTab;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        contents.forEach((content) => {
            const isActive = content.id === targetTab;
            content.classList.toggle('active', isActive);
            content.style.display = isActive ? '' : 'none';
        });
    }
    const taskProgress = createTaskProgressHandlers({
        elements,
        state,
        utils,
        logger,
        activateMiddleTab,
        addTaskProgress: deps.addTaskProgress,
        appendTaskHistory: deps.appendTaskHistory,
        clearTaskHistory: deps.clearTaskHistory,
        openTaskHistoryDialog: deps.openTaskHistoryDialog,
        updateTaskProgress: deps.updateTaskProgress,
        finishTaskProgress: deps.finishTaskProgress,
        setTaskHistoryCollapsed: deps.setTaskHistoryCollapsed,
        toggleTaskHistory: deps.toggleTaskHistory
    });
    const wiringIpc = createRendererWiringIpc({
        ...deps,
        taskProgress
    });
    const wiringEvents = createRendererWiringEvents({
        ...deps,
        activateUploadMode: utils.activateUploadMode,
        taskProgress,
        getActiveClashBrowserSettingsPatch,
        applyBrowserRegionPreset,
        handleTcpSettingsSave,
        clearTcpConnectionConsole,
        loadDrawerState,
        applyDrawerLayout,
        toggleLeftDrawer,
        toggleRightDrawer,
        activateMiddleTab,
        openProxyQuickSite,
        initializeAppRuntimeMode,
        syncRegistrationCardStateFromServer,
        updateTcpConnectionPanelState,
        refreshClashStatus: (elementsArg, showError, updateProfileSelect, loadNodes, log) =>
            clashManager.refreshClashStatus(elementsArg, showError, updateProfileSelect, loadNodes, log)
    });
    const {
        setupIPCHandlers,
        handlePointsCookieTest
    } = wiringIpc;
    const { setupEventListeners } = wiringEvents;

    // 这里沿用显式依赖注入，尽量让搬迁过来的逻辑保持原样，减少二次改动面
    // ==================== 设置事件监听器 ====================
// ==================== 全局函数（用于HTML中的onclick） ====================
window.deleteCookie = async function(email) {
    await cookieManager.deleteCookie(email, loadCookies, (msg, type) => utils.showMessage(msg, type, elements));
};

window.testCookieGlobal = async function(email, testWithCardName, originalCardName) {
    // 强制使用当前选中的测试卡片
    const currentTestCard = cardManager.getCurrentTestCard();
    await cookieTester.testCookie(email, currentTestCard, originalCardName, (msg, type) => utils.showMessage(msg, type, elements));
};

// 挂载积分测试函数到全局
window.handlePointsCookieTest = handlePointsCookieTest;

window.selectClashNodeGlobal = function(nodeName) {
    clashManager.selectClashNode(nodeName, elements);
};

// ==================== 初始化应用 ====================
    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof state.getStoredTheme === 'function' && typeof state.applyTheme === 'function') {
            state.applyTheme(state.getStoredTheme());
        }

        if (typeof utils.activateUploadMode === 'function') {
            utils.activateUploadMode('tcp');
        }

        if (elements.themeToggleBtn && typeof state.toggleTheme === 'function') {
            elements.themeToggleBtn.addEventListener('click', () => {
                state.toggleTheme();
            });
        }

        await initializeAppRuntimeMode();
        setupEventListeners();
        setupIPCHandlers();
        setupConsole();

        const initialRegisterCards = await cardManager.loadCards({ forceReload: true });
        if (Array.isArray(initialRegisterCards)) {
            cardManager.renderCardList(initialRegisterCards, elements, (cardName) => {
                cardManager.setCurrentCard(cardName);
                state.currentCard = cardName;
                loadCookies();
            }, 'register');
        }

        loadCookies();
        applyTcpManagedUiLockdown();
        ensureTcpManagedUiObserver();

        if (state.registrationTcpEnabled) {
            void syncRegistrationCardStateFromServer('register');
        }
        
        // 页面加载后自动检测浏览器
        await utils.autoDetectBrowsers(elements, logger, utils.updateBrowserOptions, updateBrowserSettings, utils.addDefaultBrowserOptions);

        if (elements.emailHost) {
            elements.emailHost.addEventListener('blur', saveCookieUserConfig);
        }
        if (elements.emailPort) {
            elements.emailPort.addEventListener('blur', saveCookieUserConfig);
        }

        if (elements.proxyRecoveryAttempts) {
            elements.proxyRecoveryAttempts.addEventListener('change', saveRegistrationControls);
            elements.proxyRecoveryAttempts.addEventListener('blur', saveRegistrationControls);
        }
        if (elements.registrationTimedCount) {
            elements.registrationTimedCount.addEventListener('change', saveRegistrationControls);
            elements.registrationTimedCount.addEventListener('blur', saveRegistrationControls);
        }
        if (elements.registrationTimedCycleCount) {
            elements.registrationTimedCycleCount.addEventListener('change', saveRegistrationControls);
            elements.registrationTimedCycleCount.addEventListener('blur', saveRegistrationControls);
        }
        if (elements.registrationTimedStartMode) {
            elements.registrationTimedStartMode.addEventListener('change', saveRegistrationControls);
        }
        if (elements.registrationTimedDelaySeconds) {
            elements.registrationTimedDelaySeconds.addEventListener('change', saveRegistrationControls);
            elements.registrationTimedDelaySeconds.addEventListener('blur', saveRegistrationControls);
        }
        if (elements.concurrentCount) {
            elements.concurrentCount.addEventListener('change', saveRegistrationControls);
            elements.concurrentCount.addEventListener('blur', saveRegistrationControls);
        }
        if (elements.syncExecution) {
            elements.syncExecution.addEventListener('change', saveRegistrationControls);
        }
        if (elements.registrationAutoUpload) {
            elements.registrationAutoUpload.addEventListener('change', () => {
                saveRegistrationUploadControls();
                updateRegistrationUploadStatus(
                    elements.registrationAutoUpload.checked ? '自动上传已开启' : '自动上传已关闭',
                    elements.registrationAutoUpload.checked ? 'info' : 'warning'
                );
            });
        }
        if (elements.registrationSaveLocalCookie) {
            elements.registrationSaveLocalCookie.addEventListener('change', saveRegistrationControls);
        }

        // 加载Cookie测试配置
        cookieTester.loadCookieTestConfig(elements);

    // 加载后端配置 (resource/config.json)
    await loadCookieUserConfig();
    await loadTcpServerConfig();
    await loadAiAssistantConfig();
    await loadRegistrationControls();
    loadRegistrationUploadControls().catch(error => {
        logger.warning(`加载注册上传配置失败: ${error.message}`);
    });
    loadHaikaBindAccountControls();
    loadHaikaCategories();

    if (elements.trialResponseJson) {
        elements.trialResponseJson.textContent = '暂无结果';
    }
    if (elements.trialCacheTip) {
        elements.trialCacheTip.textContent = '仅用于接口测试';
    }
    clearTrialInfo();
    setTrialStatus('等待操作', 'neutral');
    loadHaikaTrialState();

    // 初始化 Clash 节点切换功能
    clashManager.initClashManager(() => 
        clashManager.refreshClashStatus(elements, clashManager.showClashError, clashManager.updateClashProfileSelect, clashManager.loadClashProfileNodes, logger),
        elements,
        logger
    );

});

};


