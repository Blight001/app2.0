async function injectCardEditorSidebar(tabId, width = 820, options = {}) {
    const sidebarUrl = chrome.runtime.getURL('popup.html?layout=sidebar');
    const forceClose = !!options.forceClose;
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [sidebarUrl, width, forceClose],
        func: async (iframeUrl, panelWidth, forceClose) => {
            const rootId = '__automation_card_sidebar_root__';
            const existing = document.getElementById(rootId);
            if (existing || forceClose) {
                if (existing) existing.remove();
                return { success: true, closed: true };
            }

            const host = document.createElement('div');
            host.id = rootId;
            host.style.position = 'fixed';
            host.style.top = '0';
            host.style.right = '0';
            host.style.width = `${Math.max(520, Number(panelWidth) || 820)}px`;
            host.style.height = '100vh';
            host.style.zIndex = '2147483647';
            host.style.pointerEvents = 'none';

            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>
                :host{all:initial}.panel{position:absolute;inset:0;display:flex;flex-direction:column;background:rgba(243,246,252,.98);border-left:1px solid rgba(148,163,184,.34);pointer-events:auto}.frame{width:100%;height:100vh;border:0;display:block;background:transparent}.resize{position:absolute;left:-6px;top:0;width:10px;height:100%;cursor:ew-resize;background:linear-gradient(90deg,transparent,rgba(148,163,184,.08),transparent)}
            </style><div class="panel"><div class="resize" title="拖动调整宽度"></div><iframe class="frame" src="${iframeUrl}" allow="clipboard-read; clipboard-write"></iframe></div>`;

            const resizeHandle = shadow.querySelector('.resize');
            let startX = 0;
            let startWidth = 0;

            const notifySidebarState = async (payloadState = {}) => {
                try {
                    await chrome.runtime.sendMessage({
                        type: 'card-sidebar-state-update',
                        payload: {
                            open: payloadState.open === true,
                            width: Math.max(520, Number(payloadState.width || host.getBoundingClientRect().width) || 820)
                        }
                    });
                } catch (_error) {
                }
            };

            const closePanel = () => {
                void notifySidebarState({ open: false, width: host.getBoundingClientRect().width });
                host.remove();
            };

            // Allow the inner iframe (sidebar editor) to request close
            window.addEventListener('message', (ev) => {
                if (ev && ev.data && ev.data.type === 'close-card-sidebar') {
                    closePanel();
                }
            });

            resizeHandle?.addEventListener('mousedown', (event) => {
                event.preventDefault();
                startX = event.clientX;
                startWidth = host.getBoundingClientRect().width;
                const onMove = (moveEvent) => {
                    const delta = startX - moveEvent.clientX;
                    const nextWidth = Math.max(520, Math.min(window.innerWidth - 280, startWidth + delta));
                    host.style.width = `${nextWidth}px`;
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    void notifySidebarState({ open: true, width: host.getBoundingClientRect().width });
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });

            document.body.appendChild(host);
            void notifySidebarState({ open: true, width: host.getBoundingClientRect().width });
            return { success: true, opened: true, width: host.getBoundingClientRect().width };
        }
    });

    const result = Array.isArray(results) ? results[0] : null;
    return result && result.result ? result.result : result;
}

async function openCardEditorSidebar(payload = {}) {
    const tab = await getActiveTab();
    if (!tab || !Number.isFinite(Number(tab.id || 0))) {
        throw new Error('未找到可用的当前标签页');
    }

    const tabId = Number(tab.id);
    const width = Math.max(520, Number(payload.width || 820));
    const forceClose = !!payload.forceClose;
    const result = await injectCardEditorSidebar(tabId, width, { forceClose });
    if (result?.opened === true) {
        await saveCardSidebarState({ tabId, width, open: true });
    } else if (result?.closed === true) {
        await saveCardSidebarState({ tabId, width, open: false });
    }
    return result;
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 0);

    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    if (currentTab && currentTab.status === 'complete') {
        return currentTab;
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            reject(new Error('页面加载超时'));
        }, Math.max(1000, deadline - Date.now()));

        const onUpdated = (updatedTabId, changeInfo, tab) => {
            if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
                return;
            }

            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve(tab);
        };

        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}
