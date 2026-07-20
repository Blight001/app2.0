async function executePageAction(tabId, action) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/card-page-action.js']
    });
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [action],
        func: (payload) => globalThis.__aiFreeExecuteCardPageAction(payload)
    });
    const result = Array.isArray(results) ? results[0] : null;
    return result && result.result ? result.result : result;
}
