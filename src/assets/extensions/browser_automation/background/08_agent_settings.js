// AI-FREE 本机桥接设置。插件不维护独立账号、密码或远端登录令牌。
const AGENT_SETTINGS_KEY = 'agent-settings';

const AGENT_SETTINGS_DEFAULT = {
    localBridgeUrl: 'http://127.0.0.1:18765',
    agentName: 'AI自动化浏览器',
    agentGroup: '',
    deviceId: '',
    offlineMode: false,
    mouseFx: true
};

function trimUrl(value) {
    return String(value || '').replace(/\/+$/, '');
}

async function getAgentSettings() {
    const stored = await chrome.storage.local.get(AGENT_SETTINGS_KEY);
    const value = stored && stored[AGENT_SETTINGS_KEY];
    return { ...AGENT_SETTINGS_DEFAULT, ...(value && typeof value === 'object' ? value : {}) };
}

async function saveAgentSettings(partial) {
    const current = await getAgentSettings();
    const next = { ...current, ...(partial && typeof partial === 'object' ? partial : {}) };
    next.localBridgeUrl = trimUrl(next.localBridgeUrl || AGENT_SETTINGS_DEFAULT.localBridgeUrl);
    await chrome.storage.local.set({ [AGENT_SETTINGS_KEY]: next });
    return next;
}
