const LOCKED_MESSAGE = '此插件仅允许在 AI-FREE 软件内置浏览器中使用';

try {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: `AI自动化插件 — ${LOCKED_MESSAGE}` });
} catch (_error) {}

chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
    sendResponse({
        ok: false,
        locked: true,
        error: LOCKED_MESSAGE
    });
    return false;
});
