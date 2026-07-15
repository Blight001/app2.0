// AI-FREE 连接状态与可见选项；连接地址由后台自动管理。
{
    const $ = (id) => document.getElementById(id);
    const statusDot = $('agent-status-dot');
    const statusLabel = $('agent-status-label');
    const accountName = $('agent-account-name');
    const modal = $('agent-modal');
    const chip = $('agent-account-chip');
    const mouseFxInput = $('agent-mousefx');
    const nameInput = $('agent-name');
    const saveOptionsBtn = $('agent-save-options');
    const optionsFeedback = $('agent-options-feedback');
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
        if (statusDot) statusDot.className = `agent-status-dot ${status === 'enrolled' ? 'is-green' : 'is-red'}`;
        if (statusLabel) statusLabel.textContent = labels[status] || status;
        if (connStatus) connStatus.textContent = state.lastErrorReason && status === 'error'
            ? `${labels[status]}：${state.lastErrorReason}`
            : (labels[status] || status);
        if (aiStatus) aiStatus.textContent = status === 'enrolled' ? '可在软件内选择' : '等待连接';
    }

    function applySettings(settings = {}) {
        if (mouseFxInput) mouseFxInput.checked = settings.mouseFx !== false;
        if (nameInput) nameInput.value = settings.agentName || 'AI自动化浏览器';
        if (accountName) accountName.textContent = settings.agentName || 'AI自动化浏览器';
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

    saveOptionsBtn?.addEventListener('click', async () => {
        try {
            const result = await send({
                type: 'agent:save-settings',
                payload: {
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
