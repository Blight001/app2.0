// background/10_browser_tools.js — 三类浏览器 MCP 工具的后台封装：
//   · 导航与搜索：browser_tab（list/switch/replace/navigate/close/back/forward）
//   · 页面观察：  browser_observe
//   · 页面交互：  browser_action（click/double_click/right_click/scroll/type/press_key）/
//                browser_wait
// 点击由内容脚本解析目标，再经软件主进程和 Chromium Runtime Bridge 注入内核；
// 输入/按键仍是内容脚本合成事件。真正的扫描/定位逻辑在
// content/observe.js 的 window.__hsObserve 里（含同源 iframe / Shadow DOM / 媒体识别），
// 这里只是薄封装 + 旧标签页补注入。

// ── content/observe.js 调用封装（含旧标签页补注入兜底）───────────────────────
async function callObserveMethod(tabId, method, callArgs) {
    const invoke = () => chrome.scripting.executeScript({
        target: { tabId },
        args: [method, callArgs],
        func: (methodName, methodArgs) => {
            if (!window.__hsObserve || typeof window.__hsObserve[methodName] !== 'function') {
                return { __hsObserveMissing: true };
            }
            return window.__hsObserve[methodName].apply(window.__hsObserve, methodArgs);
        }
    });

    let results = await invoke();
    let value = Array.isArray(results) && results[0] ? results[0].result : undefined;

    if (value && value.__hsObserveMissing === true) {
        // 扩展安装/刷新之前就打开的标签页不会自动获得 manifest 声明的内容脚本，这里补注入一次再重试。
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content/observe.js'] }).catch(() => {});
        results = await invoke();
        value = Array.isArray(results) && results[0] ? results[0].result : undefined;
    }

    if (value && value.__hsObserveMissing === true) {
        throw new Error('页面观察/交互脚本不可用（可能是浏览器内部页面、扩展页面或受限页面）');
    }

    return value;
}

// 每次浏览器工具开始执行前，先把目标浏览器窗口切到前台，并让页面内的可视鼠标
// 从视口边缘进入、自动移动一小段。该动效只用于增强操作真实性，注入失败不能影响
// observe/action/wait 等真正的控制命令。
async function prepareBrowserControl(tabId, options = {}) {
    const id = Number(tabId || 0);
    if (!Number.isFinite(id) || id <= 0) return;

    await focusTab(id, options).catch(() => {});

    const invoke = () => chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
            if (!window.__hsFx || typeof window.__hsFx.hoverBrowser !== 'function') {
                return { __hsFxMissing: true };
            }
            return window.__hsFx.hoverBrowser();
        }
    });

    try {
        let results = await invoke();
        let value = Array.isArray(results) && results[0] ? results[0].result : undefined;
        if (value && value.__hsFxMissing === true) {
            await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/fx.js'] });
            results = await invoke();
            value = Array.isArray(results) && results[0] ? results[0].result : undefined;
        }
        return value;
    } catch (_error) {
        return undefined;
    }
}

// ── 导航与搜索：browser_tab ───────────────────────────────────────────────
function tabSummary(tab) {
    return { id: tab.id, url: tab.url, title: tab.title, active: !!tab.active, windowId: tab.windowId };
}

async function focusTab(tabId, options = {}) {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (options.focusWindow !== false && tab.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    const refreshed = await chrome.tabs.get(tabId);
    await rememberAutomationTargetTab(refreshed.id);
    return { ...refreshed, active: true };
}

function tabIdArg(args = {}) {
    const raw = args.tab_id ?? args.tabId ?? args.id;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
}

async function resolveTargetTabForAction(args = {}) {
    const target = await resolveAutomationTargetTab(args);
    if (!target) throw new Error('未找到可操作的真实网页标签页');
    return target;
}

async function toolBrowserTabList() {
    const tabs = await chrome.tabs.query({});
    const targetTab = await resolveAutomationTargetTab().catch(() => null);
    const targetId = Number(targetTab?.id || 0) || 0;
    const normalizedTabs = tabs.map((tab) => ({
        ...tab,
        active: targetId > 0 ? Number(tab.id) === targetId : !!tab.active
    }));
    const activeTab = normalizedTabs.find((t) => t.active) || null;
    return {
        success: true,
        action: 'list',
        count: tabs.length,
        activeTabId: activeTab ? activeTab.id : null,
        activeTab: activeTab ? tabSummary(activeTab) : null,
        tabs: normalizedTabs.map(tabSummary)
    };
}

async function toolBrowserTabSwitch(args = {}) {
    const tabId = tabIdArg(args);
    if (!Number.isFinite(tabId) || tabId <= 0) throw new Error('switch 需要提供 tab_id');
    const refreshed = await focusTab(tabId);
    return { success: true, action: 'switch', ...tabSummary(refreshed) };
}

// 导航成功回执附 cardStep：与 browser_action 的 cardStep 回执一致，探索路径可直接固化进卡片 steps。
function navigateCardStep(href) {
    let host = '';
    try { host = new URL(href).hostname; } catch (_error) {}
    return { name: `打开 ${host || '网址'}`, type: 'navigate', url: href };
}

async function toolBrowserTabReplace(args = {}) {
    const href = normalizeTargetUrl(args.url);
    if (!href) throw new Error('replace 需要提供 url');
    let tab;
    try {
        tab = await resolveTargetTabForAction(args);
    } catch (_error) {
        const created = await chrome.tabs.create({ url: href, active: true });
        await waitForTabComplete(created.id, 20000).catch(() => {});
        const refreshed = await chrome.tabs.get(created.id);
        return { success: true, action: 'replace', ...tabSummary(refreshed), cardStep: navigateCardStep(href), note: '未找到可用的目标标签页，已在新标签页打开。' };
    }
    const currentUrl = normalizeTargetUrl(String(tab.url || '').trim());
    if (currentUrl === href) {
        await focusTab(tab.id).catch(() => {});
        await chrome.tabs.reload(tab.id);
        await waitForTabComplete(tab.id, 20000).catch(() => {});
        const refreshed = await chrome.tabs.get(tab.id);
        return { success: true, action: 'replace', ...tabSummary(refreshed), cardStep: navigateCardStep(href), note: '已在目标网页，已刷新页面' };
    }
    await chrome.tabs.update(tab.id, { url: href, active: true });
    await focusTab(tab.id);
    await waitForTabComplete(tab.id, 20000).catch(() => {});
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: 'replace', ...tabSummary(refreshed), cardStep: navigateCardStep(href) };
}

async function toolBrowserTabNavigate(args = {}) {
    const href = normalizeTargetUrl(args.url);
    if (!href) throw new Error('navigate 需要提供 url');
    const tab = await chrome.tabs.create({ url: href, active: true });
    await focusTab(tab.id);
    await waitForTabComplete(tab.id, 20000).catch(() => {});
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: 'navigate', ...tabSummary(refreshed), cardStep: navigateCardStep(href) };
}

async function toolBrowserTabClose(args = {}) {
    const requested = tabIdArg(args);
    let tabId = requested;
    if (!Number.isFinite(tabId) || tabId <= 0) {
        const active = await getActiveTab();
        if (!active) throw new Error('未找到可关闭的标签页');
        tabId = active.id;
    }
    const closing = await chrome.tabs.get(tabId);
    await chrome.tabs.remove(tabId);
    return { success: true, action: 'close', ...tabSummary(closing) };
}

async function toolBrowserTabBack(args = {}) {
    const tab = await resolveTargetTabForAction(args);
    await focusTab(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.back() });
    await sleep(250);
    await waitForTabComplete(tab.id, 15000).catch(() => {});
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: 'back', ...tabSummary(refreshed) };
}

async function toolBrowserTabForward(args = {}) {
    const tab = await resolveTargetTabForAction(args);
    await focusTab(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.forward() });
    await sleep(250);
    await waitForTabComplete(tab.id, 15000).catch(() => {});
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: 'forward', ...tabSummary(refreshed) };
}

const BROWSER_TAB_ACTIONS = ['list', 'switch', 'replace', 'navigate', 'close', 'back', 'forward'];

function normalizeBrowserTabAction(args = {}) {
    const action = String(args.action || '').trim();
    if (action === 'open' || action === 'activate') return action === 'open' ? 'navigate' : 'switch';
    if (action === 'navigate' && (args.replace_current === true || args.current_tab === true || args.same_tab === true)) {
        return 'replace';
    }
    return action;
}

async function toolBrowserTab(args = {}) {
    const action = normalizeBrowserTabAction(args);
    const handlers = {
        list: () => toolBrowserTabList(),
        switch: () => toolBrowserTabSwitch(args),
        replace: () => toolBrowserTabReplace(args),
        navigate: () => toolBrowserTabNavigate(args),
        close: () => toolBrowserTabClose(args),
        back: () => toolBrowserTabBack(args),
        forward: () => toolBrowserTabForward(args)
    };
    const handler = handlers[action];
    if (!handler) {
        throw new Error(`browser_tab: 未知 action「${action || '(空)'}」，可选 ${BROWSER_TAB_ACTIONS.join(' / ')}`);
    }
    const result = await handler();

    let hoverTabId = action === 'list' ? Number(result?.activeTabId || 0) : Number(result?.id || 0);
    if (action === 'close') {
        const fallback = await resolveAutomationTargetTab().catch(() => null);
        hoverTabId = Number(fallback?.id || 0);
    }
    await prepareBrowserControl(hoverTabId);
    return result;
}

// ── 页面观察：browser_observe ─────────────────────────────────────────────
async function toolBrowserObserve(args = {}) {
    const tab = await resolveAutomationTargetTab(args);
    if (!tab) throw new Error('未找到可观察的真实网页标签页');
    await prepareBrowserControl(tab.id);
    return callObserveMethod(tab.id, 'scan', [args]);
}

// ── 页面交互：browser_action ──────────────────────────────────────────────
const BROWSER_ACTION_KINDS = ['click', 'double_click', 'right_click', 'scroll', 'type', 'press_key'];

async function dispatchChromiumClick(tabId, args, variant) {
    const prepared = await callObserveMethod(tabId, 'resolveClick', [args, variant]);
    if (!prepared?.success || !prepared.input) return prepared;
    const response = await requestSoftwareRuntimeInput(prepared.input);
    if (response?.result?.dispatched !== true) {
        throw new Error('Chromium Runtime 未确认鼠标事件已派发');
    }
    const { input: _input, ...result } = prepared;
    return {
        ...result,
        inputMode: 'chromium-runtime',
        dispatched: true
    };
}

async function toolBrowserAction(args = {}) {
    const tab = await resolveAutomationTargetTab(args);
    if (!tab) throw new Error('未找到可操作的真实网页标签页');
    const action = String(args.action || '').trim();
    const isMouseClick = ['click', 'double_click', 'right_click'].includes(action);
    await prepareBrowserControl(tab.id, { focusWindow: !isMouseClick });
    switch (action) {
        case 'click':        return dispatchChromiumClick(tab.id, args, 'left');
        case 'double_click': return dispatchChromiumClick(tab.id, args, 'double');
        case 'right_click':  return dispatchChromiumClick(tab.id, args, 'right');
        case 'scroll':       return callObserveMethod(tab.id, 'scroll', [args]);
        case 'type':         return callObserveMethod(tab.id, 'type', [args]);
        case 'press_key':    return callObserveMethod(tab.id, 'pressKey', [args]);
        default:
            throw new Error(`browser_action: 未知 action「${action || '(空)'}」，可选 ${BROWSER_ACTION_KINDS.join(' / ')}`);
    }
}

// ── 页面交互：browser_wait ────────────────────────────────────────────────
async function toolBrowserWait(args = {}) {
    const tab = await resolveAutomationTargetTab(args);
    if (!tab) throw new Error('未找到可等待的真实网页标签页');
    await prepareBrowserControl(tab.id);
    return callObserveMethod(tab.id, 'wait', [args]);
}
