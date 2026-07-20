async function saveCookieStepResult(tabId, account, password) {
    const snapshot = await collectTabCookieSnapshot(tabId);
    const fileName = buildCaptureFileName(account, password);
    const savePayload = {
        account: String(account || '').trim(),
        password: String(password || '').trim(),
        pageUrl: snapshot.pageUrl,
        pageTitle: snapshot.pageTitle,
        cookies: snapshot.cookies,
        browserStorage: snapshot.browserStorage,
        capturedAt: new Date().toISOString(),
        source: 'card-run-save-cookies-step'
    };

    const jsonText = JSON.stringify(savePayload);
    const downloadUrl = `data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`;
    await chrome.downloads.download({
        url: downloadUrl,
        filename: `automation_capture/${fileName}`,
        saveAs: false,
        conflictAction: 'overwrite'
    });

    return {
        fileName,
        cookieCount: snapshot.cookies.length,
        browserStorageCount: snapshot.browserStorage.length,
        pageUrl: savePayload.pageUrl,
        pageTitle: savePayload.pageTitle
    };
}

async function uploadCapturedState(serverUrl, savePayload, cardKey) {
    const upload = { attempted: false, success: false, status: 0, error: '' };
    if (!serverUrl) return upload;
    upload.attempted = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const body = cardKey ? { ...savePayload, cardKey } : savePayload;
        const response = await fetch(serverUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: controller.signal
        });
        upload.status = response.status;
        upload.success = response.ok;
        if (!response.ok) upload.error = `HTTP ${response.status}`;
    } catch (error) {
        upload.error = error && error.message ? error.message : '上传失败';
    } finally {
        clearTimeout(timeout);
    }
    return upload;
}

function buildCurrentTabBrowserStorage(tab, pageSnapshot) {
    const localStorage = pageSnapshot.localStorage && typeof pageSnapshot.localStorage === 'object' ? pageSnapshot.localStorage : {};
    const sessionStorage = pageSnapshot.sessionStorage && typeof pageSnapshot.sessionStorage === 'object' ? pageSnapshot.sessionStorage : {};
    if (Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0) return [];
    return [{
        url: pageSnapshot.url || tab.url || '', origin: pageSnapshot.origin || '', localStorage, sessionStorage
    }];
}

async function downloadCapturedState(fileName, savePayload) {
    const jsonText = JSON.stringify(savePayload);
    const downloadUrl = `data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`;
    await chrome.downloads.download({
        url: downloadUrl, filename: `cookie_capture/${fileName}`, saveAs: false, conflictAction: 'overwrite'
    });
}

function buildCaptureResult(payload, fileName, cookies, browserStorage, savePayload, upload) {
    const base = {
        success: true, fileName, cookieCount: cookies.length, browserStorageCount: browserStorage.length,
        pageUrl: savePayload.pageUrl, upload
    };
    if (!(payload.saveToServer || payload.save_to_server)) return base;
    return { ...base, cookies, browserStorage, data: savePayload, save_to_server: true };
}

function getCapturePayloadAlias(payload, camelName, snakeName) {
    return payload[camelName] !== undefined && payload[camelName] !== null ? payload[camelName] : payload[snakeName];
}

async function getCapturableTab(payload) {
    const tab = await resolveAutomationTargetTab(payload);
    if (!tab || !Number.isFinite(Number(tab.id || 0))) throw new Error('未找到可抓取的当前标签页');
    return tab;
}

async function captureCurrentTab(payload = {}) {
    const tab = await getCapturableTab(payload);

    const pageSnapshot = await readPageSnapshot(Number(tab.id));
    if (!pageSnapshot) {
        throw new Error('当前页面无法读取存储信息');
    }

    const cookies = await readCookies(tab.url || pageSnapshot.url || '');
    const browserStorage = buildCurrentTabBrowserStorage(tab, pageSnapshot);

    const minimized = minimizeCapturedState({ cookies, browserStorage });
    const slimCookies = minimized.cookies;
    const slimBrowserStorage = minimized.browserStorage;

    if (slimCookies.length === 0 && slimBrowserStorage.length === 0) {
        throw new Error('当前页面没有可保存的登录凭证（Cookie 或浏览器存储）');
    }

    const account = String(payload.account || '').trim();
    const password = String(payload.password || '').trim();
    const fileName = buildFileName(account, password);
    const savePayload = {
        account,
        password,
        pageUrl: tab.url || pageSnapshot.url || '',
        pageTitle: tab.title || pageSnapshot.title || '',
        cookies: slimCookies,
        browserStorage: slimBrowserStorage,
        capturedAt: new Date().toISOString()
    };

    await downloadCapturedState(fileName, savePayload);

    const serverUrl = String(getCapturePayloadAlias(payload, 'serverUrl', 'server_url') || '').trim();
    const cardKey = String(getCapturePayloadAlias(payload, 'cardKey', 'card_key') || '').trim();
    const upload = await uploadCapturedState(serverUrl, savePayload, cardKey);

    return buildCaptureResult(payload, fileName, cookies, browserStorage, savePayload, upload);
}
