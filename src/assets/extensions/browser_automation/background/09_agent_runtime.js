// 模块加载即尝试恢复连接（SW 被唤醒时）。
void ensureAgentOffscreen();
void restoreAndConnectAgent();

// 升级后的旧 Profile 可能仍只在 chrome.storage.local 中保存卡片。后台一唤醒
// 就主动迁移，不要求用户先打开插件弹窗；软件桥接启动较慢时做有限重试。
void (async function migrateLegacyCardCacheOnStartup() {
    for (const delay of [0, 1000, 3000]) {
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        const state = await loadCardCacheState().catch(() => null);
        if (state?.persisted === true) return;
    }
})();
