// AI-FREE 本机桥接状态与设置；插件不再提供独立账号登录。
{
    const $ = (id) => document.getElementById(id);
    const statusDot = $('agent-status-dot');
    const statusLabel = $('agent-status-label');
    const accountName = $('agent-account-name');
    const accountAva = $('agent-account-ava');
    const modal = $('agent-modal');
    const chip = $('agent-account-chip');
    const bridgeInput = $('agent-server-url');
    const connectBtn = $('agent-connect-btn');
    const disconnectBtn = $('agent-disconnect-btn');
    const mouseFxInput = $('agent-mousefx');
    const nameInput = $('agent-name');
    const saveOptionsBtn = $('agent-save-options');
    const optionsFeedback = $('agent-options-feedback');
    const connectionFeedback = $('agent-login-feedback');
    const connStatus = $('agent-conn-status');
    const aiStatus = $('agent-ai-status');

    const send = (message) => chrome.runtime.sendMessage(message);

    function feedback(node, text, ok = true) {
        if (!node) return;
        node.textContent = text || '';
        node.className = `agent-feedback ${text ? (ok ? 'is-ok' : 'is-err') : ''}`.trim();
    }

    function applyStatus(state = {}) {
        const status = String(state.status || 'disconnected');
        const labels = {
            disconnected: '未连接',
            connecting: '连接中',
            connected: '已连接',
            enrolled: '已接入软件',
            error: '连接错误'
        };
        const classes = {
            disconnected: 'is-red',
            connecting: 'is-yellow',
            connected: 'is-yellow',
            enrolled: 'is-green',
            error: 'is-red'
        };
        if (statusDot) statusDot.className = `agent-status-dot ${classes[status] || 'is-red'}`;
        if (statusLabel) statusLabel.textContent = labels[status] || status;
        if (connStatus) connStatus.textContent = state.lastErrorReason && status === 'error'
            ? `${labels[status]}：${state.lastErrorReason}`
            : (labels[status] || status);
        if (aiStatus) aiStatus.textContent = status === 'enrolled' ? '可在软件内选择' : '等待连接';
    }

    function applySettings(settings = {}) {
        if (bridgeInput) bridgeInput.value = settings.localBridgeUrl || 'http://127.0.0.1:18765';
        if (mouseFxInput) mouseFxInput.checked = settings.mouseFx !== false;
        if (nameInput) nameInput.value = settings.agentName || 'AI自动化浏览器';
        if (accountName) accountName.textContent = settings.agentName || 'AI-FREE';
        if (accountAva) accountAva.textContent = 'AI';
    }

    async function refresh() {
        try {
            const result = await send({ type: 'agent:get-state' });
            if (!result?.ok) return;
            applyStatus(result);
            applySettings(result.settings || {});
        } catch (_error) {}
    }

    chip?.addEventListener('click', () => modal?.classList.remove('is-hidden'));
    $('agent-modal-close')?.addEventListener('click', () => modal?.classList.add('is-hidden'));
    modal?.addEventListener('click', (event) => {
        if (event.target === modal) modal.classList.add('is-hidden');
    });

    connectBtn?.addEventListener('click', async () => {
        feedback(connectionFeedback, '正在连接…');
        try {
            const result = await send({ type: 'agent:save-settings', payload: { localBridgeUrl: bridgeInput?.value?.trim() || 'http://127.0.0.1:18765' } });
            feedback(connectionFeedback, result?.ok ? '已发起连接' : (result?.error || '连接失败'), !!result?.ok);
            await refresh();
        } catch (error) {
            feedback(connectionFeedback, error?.message || '连接失败', false);
        }
    });

    disconnectBtn?.addEventListener('click', async () => {
        await send({ type: 'agent:disconnect' }).catch(() => {});
        feedback(connectionFeedback, '已断开');
        await refresh();
    });

    saveOptionsBtn?.addEventListener('click', async () => {
        try {
            const result = await send({
                type: 'agent:save-settings',
                payload: {
                    localBridgeUrl: bridgeInput?.value?.trim() || 'http://127.0.0.1:18765',
                    agentName: nameInput?.value?.trim() || 'AI自动化浏览器',
                    mouseFx: mouseFxInput?.checked !== false
                }
            });
            feedback(optionsFeedback, result?.ok ? '已保存并重新连接' : (result?.error || '保存失败'), !!result?.ok);
            await refresh();
        } catch (error) {
            feedback(optionsFeedback, error?.message || '保存失败', false);
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'agent:status') applyStatus(message);
    });

    refresh();
}
