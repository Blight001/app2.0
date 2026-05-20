const { IPC_CHANNELS } = require('../../core/ipc/channels');

module.exports = function createRendererWiringIpc(deps) {
    const state = deps;
    const {
        elements,
        cardManager,
        cookieManager,
        cookieTester,
        clashManager,
        utils,
        logger,
        ipcRenderer,
        loadCookies,
        uploadRegisteredCookie,
        updateTaskCount,
        taskProgress,
        stopRegistration,
        isHaikaBindingTask,
        tempEmail
    } = deps;

    function resetHaikaBindStartButton() {
        state.currentHaikaBindBatchId = null;
        state.currentHaikaBindBatchActive = false;
        state.currentHaikaBindBatchTotal = 0;
        if (elements.haikaBindStartBtn) {
            elements.haikaBindStartBtn.disabled = false;
            elements.haikaBindStartBtn.textContent = '开始绑定';
        }
        if (elements.haikaBindStopBtn) {
            elements.haikaBindStopBtn.disabled = true;
            elements.haikaBindStopBtn.textContent = '停止绑定';
        }
    }

    function clearTimedRegistrationProgress(removeRow = true) {
        if (removeRow && state.currentTimedRegistrationTaskId && taskProgress && typeof taskProgress.removeTaskProgress === 'function') {
            taskProgress.removeTaskProgress(state.currentTimedRegistrationTaskId);
        }
        state.currentTimedRegistrationTaskId = null;
    }

    function renderTimedRegistrationProgress(payload = {}) {
        const taskId = payload.taskId || state.currentTimedRegistrationTaskId;
        if (!taskId || !taskProgress) {
            return;
        }

        const progressValue = Number.isFinite(Number(payload.progress))
            ? Math.max(0, Math.min(100, Number(payload.progress)))
            : 0;
        const completedCount = Number.isFinite(Number(payload.completedCount)) ? Number(payload.completedCount) : 0;
        const totalCount = Number.isFinite(Number(payload.totalCount)) ? Number(payload.totalCount) : 0;
        const taskLabel = payload.taskLabel || '定时注册批次';
        const taskNumber = payload.taskNumber !== undefined
            ? String(payload.taskNumber)
            : (totalCount > 0 ? `${completedCount}/${totalCount}` : '');
        const message = payload.message || payload.text || '';
        const statusText = payload.statusText || (payload.completed ? '已完成' : '进行中');
        const stopButtonText = payload.completed ? '已完成' : '⏹ 停止定时';
        const stopDisabled = !!payload.completed;

        if (state.currentTimedRegistrationTaskId && state.currentTimedRegistrationTaskId !== taskId) {
            taskProgress.removeTaskProgress(state.currentTimedRegistrationTaskId);
        }

        if (!state.taskProgressBars.has(taskId)) {
            taskProgress.addTaskProgress(
                taskId,
                taskNumber,
                taskLabel,
                stopRegistration,
                stopButtonText,
                {
                    className: 'task-progress--timed',
                    taskType: payload.taskType || 'timed-registration-summary',
                    statusText,
                    progress: progressValue,
                    message,
                    stopDisabled
                }
            );
        }

        taskProgress.updateTaskProgress(taskId, progressValue, message, {
            taskLabel,
            taskNumber,
            statusText,
            stopButtonText,
            stopDisabled
        });

        state.currentTimedRegistrationTaskId = taskId;
    }

    function setupIPCHandlers() {
        let _emailReconnectInterval = null;

        ipcRenderer.on('cards-loaded', (_event, cards) => {
            cardManager.renderCardList(cards, elements, (cardName) => {
                cardManager.setCurrentCard(cardName);
                state.currentCard = cardName;
                loadCookies();
            }, 'register');
        });

        ipcRenderer.on('task-progress', (_event, { taskId, progress, message, taskLabel, taskNumber, taskType, parentTaskId, parentTaskLabel, isGroupParent }) => {
            taskProgress.handleTaskProgress(taskId, progress, message, {
                taskLabel,
                taskNumber,
                taskType,
                parentTaskId,
                parentTaskLabel,
                isGroupParent
            });
        });

        ipcRenderer.on('task-started', (_event, { taskId, taskNumber, taskLabel, taskType, parentTaskId, parentTaskLabel, isGroupParent }) => {
            taskProgress.handleTaskStarted(taskId, taskNumber, taskLabel, {
                taskType,
                parentTaskId,
                parentTaskLabel,
                isGroupParent,
                statusText: '进行中',
                statusKey: 'running'
            });
        });

        ipcRenderer.on('card-debug-finished', (_event, payload) => {
            const warningCount = Array.isArray(payload?.result?.warnings) ? payload.result.warnings.length : 0;
            const message = warningCount > 0
                ? `调试完成，浏览器保持打开，存在 ${warningCount} 个告警`
                : '调试完成，浏览器保持打开';
            utils.showMessage(message, warningCount > 0 ? 'warning' : 'success', elements);
            logger.info(message);
        });

        ipcRenderer.on('card-debug-error', (_event, payload) => {
            const error = payload?.error || '未知错误';
            utils.showMessage(`调试失败: ${error}`, 'error', elements);
            logger.error(`调试失败: ${error}`);
        });

        ipcRenderer.on(IPC_CHANNELS.cardDebugRandomEmail, (_event, payload = {}) => {
            const email = String(payload.email || '').trim();
            if (!email) {
                return;
            }
            if (elements.cardEmail) {
                elements.cardEmail.value = email;
                elements.cardEmail.dispatchEvent(new Event('input', { bubbles: true }));
            }
            utils.showMessage(`随机邮箱已回填: ${email}`, 'success', elements);
            logger.info(`随机邮箱已回填到卡片邮箱文本框: ${email}`);
        });

        ipcRenderer.on('task-finished', (_event, { taskId, taskLabel, taskNumber, taskType, message, statusKey, parentTaskId, parentTaskLabel, isGroupParent }) => {
            taskProgress.handleTaskFinished(taskId, '', false, {
                taskLabel,
                taskNumber,
                taskType,
                message,
                statusKey,
                parentTaskId,
                parentTaskLabel,
                isGroupParent,
            });
        });

        ipcRenderer.on('task-error', (_event, { taskId, error, taskLabel, taskNumber, taskType, parentTaskId, parentTaskLabel, isGroupParent }) => {
            taskProgress.handleTaskFinished(taskId, error, true, {
                taskLabel,
                taskNumber,
                taskType,
                parentTaskId,
                parentTaskLabel,
                isGroupParent
            });
        });

        ipcRenderer.on('browser-created', (_event, { taskId, browserId }) => {
            utils.logToConsole(`任务 ${taskId} 浏览器 ${browserId} 创建完成`, 'info');
        });

        ipcRenderer.on('all-tasks-stopped', () => {
            elements.startBtn.disabled = false;
            elements.stopBtn.disabled = true;
            elements.statusLabel.textContent = '就绪';
            state.runningTasks.clear();
            clearTimedRegistrationProgress(true);

            for (const [taskId, progressElement] of state.taskProgressBars) {
                if (progressElement && progressElement.parentNode) {
                    progressElement.remove();
                }
            }
            state.taskProgressBars.clear();
            updateTaskCount();
        });

        ipcRenderer.on('all-tasks-finished', () => {
            elements.startBtn.disabled = false;
            elements.stopBtn.disabled = true;
            elements.statusLabel.textContent = '就绪';
            state.runningTasks.clear();
            updateTaskCount();
        });

        ipcRenderer.on('registration-success', (_event, { email, points }) => {
            utils.showMessage(`注册成功!\n邮箱: ${email}\n积分: ${points}`, 'success', elements);
        });

        ipcRenderer.on('registration-result', async (_event, payload) => {
            const taskId = payload?.taskId || '';
            const result = payload?.result || payload;
            if (!result || !result.success) {
                return;
            }

            await uploadRegisteredCookie(result, taskId);
        });

        ipcRenderer.on('registration-error', (_event, { error }) => {
            utils.showMessage(`注册失败: ${error}`, 'error', elements);
        });

        ipcRenderer.on('registration-cycle-status', (_event, payload) => {
            if (!payload) {
                return;
            }

            if (elements.statusLabel && typeof payload.text === 'string' && payload.text) {
                elements.statusLabel.textContent = payload.text;
            }

            if (payload.mode === 'timed') {
                taskProgress.focusTaskProgressTab();
                if (payload.completed) {
                    taskProgress.handleTimedRegistrationCompleted(payload);
                }
            }
        });

        ipcRenderer.on('haika-binding-success', (_event, { taskId, result }) => {
            if (isHaikaBindingTask(taskId)) {
                return;
            }
            const message = result?.message || '海卡绑定完成';
            utils.showMessage(message, 'success', elements);
            logger.info(`海卡绑定成功: ${message}`);
        });

        ipcRenderer.on('haika-binding-error', (_event, { taskId, error }) => {
            if (isHaikaBindingTask(taskId)) {
                return;
            }
            utils.showMessage(`海卡绑定失败: ${error}`, 'error', elements);
            logger.error(`海卡绑定失败: ${error}`);
        });

        ipcRenderer.on('haika-binding-batch-started', (_event, payload) => {
            taskProgress.focusTaskProgressTab();
            state.currentHaikaBindBatchId = payload?.batchId || state.currentHaikaBindBatchId;
            state.currentHaikaBindBatchActive = true;
            state.currentHaikaBindBatchTotal = payload?.total || state.currentHaikaBindBatchTotal || 0;
            if (state.currentHaikaBindBatchId) {
                taskProgress.handleTaskStarted(
                    state.currentHaikaBindBatchId,
                    state.currentHaikaBindBatchTotal > 0 ? `0/${state.currentHaikaBindBatchTotal}` : '',
                    '海卡绑定批次',
                    {
                        taskType: 'haika-binding-batch',
                        enableChildren: true,
                        statusText: '准备开始',
                        statusKey: 'running',
                        showStopButton: true,
                        parentTaskLabel: '海卡绑定批次'
                    }
                );
            }
            if (elements.haikaBindStartBtn) {
                elements.haikaBindStartBtn.disabled = true;
                elements.haikaBindStartBtn.textContent = state.currentHaikaBindBatchTotal > 1
                    ? `绑定中(0/${state.currentHaikaBindBatchTotal})`
                    : '绑定中...';
            }
            if (elements.haikaBindStopBtn) {
                elements.haikaBindStopBtn.disabled = false;
                elements.haikaBindStopBtn.textContent = '停止绑定';
            }
        });

        ipcRenderer.on('haika-binding-batch-progress', (_event, payload) => {
            taskProgress.focusTaskProgressTab();
            if (!payload?.batchId) {
                return;
            }

            state.currentHaikaBindBatchId = payload.batchId;
            state.currentHaikaBindBatchActive = true;
            state.currentHaikaBindBatchTotal = payload.total || state.currentHaikaBindBatchTotal || 0;
            taskProgress.handleTaskProgress(payload.batchId, payload.progress || 0, payload.message || '', {
                taskLabel: '海卡绑定批次',
                taskNumber: payload.total > 0 ? `${payload.completed || 0}/${payload.total}` : '',
                taskType: 'haika-binding-batch',
                isGroupParent: true,
                enableChildren: true,
                parentTaskLabel: '海卡绑定批次'
            });

            if (elements.haikaBindStartBtn && state.currentHaikaBindBatchTotal > 0) {
                elements.haikaBindStartBtn.textContent = `绑定中(${payload.completed || 0}/${state.currentHaikaBindBatchTotal})`;
            }
        });

        ipcRenderer.on('haika-binding-batch-finished', (_event, payload) => {
            taskProgress.handleHaikaBindingBatchFinished(payload);
            const batchTaskId = payload?.batchId || state.currentHaikaBindBatchId;
            if (batchTaskId) {
                const stopped = payload?.stopped === true;
                const hasFailures = (payload.failCount || 0) > 0;
                const statusText = stopped
                    ? '已停止'
                    : hasFailures
                        ? '部分完成'
                        : '已完成';
                const message = stopped
                    ? `海卡绑定已停止: 总计 ${payload.total || 0}, 成功 ${payload.successCount || 0}, 失败 ${payload.failCount || 0}`
                    : `海卡绑定批量完成: 总计 ${payload.total || 0}, 成功 ${payload.successCount || 0}, 失败 ${payload.failCount || 0}`;
                taskProgress.handleTaskFinished(batchTaskId, '', false, {
                    taskLabel: '海卡绑定批次',
                    taskNumber: payload.total > 0 ? `${(payload.successCount || 0) + (payload.failCount || 0)}/${payload.total}` : '',
                    taskType: 'haika-binding-batch',
                    message,
                    statusText,
                    statusKey: stopped || hasFailures ? 'warning' : 'success',
                    parentTaskLabel: '海卡绑定批次',
                    isGroupParent: true
                });
            }
        });

        ipcRenderer.on('app-toast', (_event, { message, type }) => {
            utils.showMessage(message, type || 'info', elements);
        });

        ipcRenderer.on('stats-updated', (_event, { taskCount, cookieCount }) => {
            elements.taskCount.textContent = `任务: ${taskCount}`;
            elements.cookieCount.textContent = `Cookie: ${cookieCount}`;
        });

        ipcRenderer.on('main-log', (_event, { level, message }) => {
            logger[level.toLowerCase()](message);
        });

        ipcRenderer.on('cookie-credits-changed', async (_event, { email, cardName, oldCredits, newCredits, change, changeText }) => {
            let icon = '';
            let color = 'info';

            if (change > 0) {
                icon = '📈';
                color = 'success';
            } else if (change < 0) {
                icon = '📉';
                color = 'warning';
            } else {
                icon = '➡️';
                color = 'info';
            }

            utils.showMessage(`${icon} ${email} 积分变化: ${oldCredits} → ${newCredits} ${changeText}`, color, elements);
            logger.info(`${email} (${cardName}) 积分变化: ${oldCredits} → ${newCredits} ${changeText}`);

            await loadCookies();
        });

        ipcRenderer.on('cookies-refreshed', async () => {
            logger.info('Cookie数据已更新，刷新列表显示');
            await loadCookies();
        });

        ipcRenderer.on('cookie-testing-stopped', () => {
            logger.info('收到Cookie测试停止信号');
            cookieTester.finishCookieTesting(elements);
        });

        ipcRenderer.on('email-log', (_event, { level, message }) => {
            let color;
            if (level === 'error') {
                color = '#dc3545';
            } else if (level === 'warning') {
                color = '#ffc107';
            } else if (message.includes('连接已建立') || message.includes('自动连接邮箱成功')) {
                color = '#198754';
            }
            utils.appendEmailLog(`[${level}] ${message}`, color);
        });

        ipcRenderer.on('email-code', (_event, { email, code }) => {
            utils.appendEmailLog(`收到验证码: ${email} -> ${code}`, '#ffc107');
        });

        ipcRenderer.on('email-connected', (_event, { host, port }) => {
            utils.appendEmailLog(`自动连接邮箱成功: ${host}:${port}`, '#198754');

            if (_emailReconnectInterval) {
                clearInterval(_emailReconnectInterval);
                _emailReconnectInterval = null;
            }

            const connectBtn = document.getElementById('email-connect-btn');
            const disconnectBtn = document.getElementById('email-disconnect-btn');
            if (connectBtn) connectBtn.disabled = true;
            if (disconnectBtn) disconnectBtn.disabled = false;
            utils.updateEmailStatus(`已连接: ${host}:${port}`, 'connected');
        });

        ipcRenderer.on('email-disconnected', () => {
            if (window.__emailManualDisconnect) {
                window.__emailManualDisconnect = false;
                return;
            }

            utils.appendEmailLog('邮箱连接已中断，正在自动恢复...', '#adb5bd');
            logger.warning('邮箱客户端连接中断，正在自动恢复');

            if (_emailReconnectInterval) {
                clearInterval(_emailReconnectInterval);
                _emailReconnectInterval = null;
            }

            const connectBtn = document.getElementById('email-connect-btn');
            const disconnectBtn = document.getElementById('email-disconnect-btn');
            if (connectBtn) connectBtn.disabled = true;
            if (disconnectBtn) disconnectBtn.disabled = false;
            utils.updateEmailStatus('自动恢复中', 'connecting');
        });

        ipcRenderer.on('email-raw-message', (_event, message) => {
            let color = '#6c757d';
            if (message.type === 'verification_code' || message.code) {
                color = '#ffc107';
            } else if (message.status === 'success') {
                color = '#198754';
            } else if (message.status === 'error') {
                if (message.message && message.message.includes('No code found')) {
                    color = '#adb5bd';
                } else {
                    color = '#dc3545';
                }
            }
            utils.appendEmailLog(`RAW: ${JSON.stringify(message)}`, color);
        });

        ipcRenderer.on('email-reconnect', (_event, { attempt, msRemaining }) => {
            const statusEl = document.getElementById('email-status');
            if (!statusEl) return;

            const connectBtn = document.getElementById('email-connect-btn');
            const disconnectBtn = document.getElementById('email-disconnect-btn');
            if (connectBtn) connectBtn.disabled = true;
            if (disconnectBtn) disconnectBtn.disabled = false;

            if (_emailReconnectInterval) {
                clearInterval(_emailReconnectInterval);
                _emailReconnectInterval = null;
            }
            let remaining = msRemaining;
            const updateText = () => {
                if (remaining === null) {
                    statusEl.textContent = `重连: 第${attempt}次，准备中`;
                } else {
                    const secs = Math.ceil(remaining / 1000);
                    statusEl.textContent = `重连: 第${attempt}次，${secs}s 后重试`;
                    remaining -= 1000;
                }
                statusEl.classList.remove('status-connected', 'status-disconnected');
                statusEl.classList.add('status-connecting');
            };
            updateText();
            if (remaining !== null) {
                _emailReconnectInterval = setInterval(() => {
                    if (remaining <= 0) {
                        clearInterval(_emailReconnectInterval);
                        _emailReconnectInterval = null;
                        utils.updateEmailStatus('连接中...', 'connecting');
                    } else {
                        updateText();
                    }
                }, 1000);
            }
        });

        ipcRenderer.on('temp-email-log', (_event, { level, message }) => {
            let color = '#6c757d';
            if (level === 'error') {
                color = '#dc3545';
            } else if (level === 'warning') {
                color = '#ffc107';
            } else if (level === 'success') {
                color = '#198754';
            } else if (level === 'info') {
                color = '#0d6efd';
            }

            if (tempEmail && typeof tempEmail.appendTempEmailLog === 'function') {
                tempEmail.appendTempEmailLog(message, color);
            }
        });

        ipcRenderer.on('temp-email-state', (_event, payload = {}) => {
            if (tempEmail && typeof tempEmail.applyState === 'function') {
                tempEmail.applyState(payload);
            }
        });

    }

    async function handlePointsCookieTest(event) {
        event.stopPropagation();

        const button = event.currentTarget;
        const pointsValue = button.dataset.points;
        const cardName = button.dataset.card;
        const testWithCardName = cardManager.getCurrentCard();

        if (!testWithCardName) {
            utils.showMessage('请先选择一个卡片进行测试', 'warning', elements);
            return;
        }

        const cardsResult = await ipcRenderer.invoke('load-cards');
        if (cardsResult.success) {
            const cardExists = cardsResult.cards.some(card => card.name === testWithCardName);
            if (!cardExists) {
                utils.showMessage('请先选择一个有效的卡片进行测试', 'warning', elements);
                return;
            }
        }

        const taskKey = `${cardName}-${pointsValue}`;
        if (state.activeTestTasks.has(taskKey)) {
            utils.showMessage('该积分测试正在进行中，请等待完成', 'warning', elements);
            return;
        }

        const isUnknownPoints = pointsValue === 'unknown' || pointsValue === undefined;
        const taskId = `points-test-${isUnknownPoints ? 'unknown' : pointsValue}-${Date.now()}`;

        try {
            state.activeTestTasks.set(taskKey, { taskId, button });
            button.disabled = true;
            button.innerHTML = '<span class="test-icon">⏳</span>';

            const pointsDisplay = isUnknownPoints ? '未知' : pointsValue;
            const cardDisplay = testWithCardName || cardName;
            logger.info(`开始测试积分 ${pointsDisplay} 的Cookie${cardDisplay !== 'overview' ? ` (${cardDisplay})` : ''}...`);

            taskProgress.addTaskProgress(taskId, 0);

            const result = await ipcRenderer.invoke('test-cookies-by-points', cardName, pointsValue, taskId, testWithCardName);

            if (result.success) {
                const displayCard = testWithCardName || cardName;
                const messageTitle = `积分 ${pointsDisplay} Cookie测试完成${displayCard !== 'overview' ? ` (${displayCard})` : ''}`;
                utils.showMessage(`${messageTitle}\n总计: ${result.total}\n成功: ${result.successCount}\n失败: ${result.failCount}`,
                    result.failCount === 0 ? 'success' : 'warning', elements);
                logger.info(`${messageTitle} - 总计: ${result.total}, 成功: ${result.successCount}, 失败: ${result.failCount}`);
            } else {
                const displayCard = testWithCardName || cardName;
                utils.showMessage(`积分 ${pointsDisplay} Cookie测试失败${displayCard !== 'overview' ? ` (${displayCard})` : ''}: ${result.error}`, 'error', elements);
            }
        } catch (error) {
            const displayCard = testWithCardName || cardName;
            logger.error(`积分 ${isUnknownPoints ? '未知' : pointsValue} Cookie测试异常${displayCard !== 'overview' ? ` (${displayCard})` : ''}: ${error.message}`);
            utils.showMessage(`积分 ${isUnknownPoints ? '未知' : pointsValue} Cookie测试异常${displayCard !== 'overview' ? ` (${displayCard})` : ''}: ${error.message}`, 'error', elements);
        } finally {
            taskProgress.removeTaskProgress(taskId);
            state.activeTestTasks.delete(taskKey);
            button.disabled = false;
            button.innerHTML = '<span class="test-icon">🔍</span>';
        }
    }

    return {
        setupIPCHandlers,
        handlePointsCookieTest
    };
};
