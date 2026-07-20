try {
    const layout = new URL(window.location.href).searchParams.get('layout') === 'sidebar' ? 'sidebar' : 'popup';
    document.documentElement.dataset.layout = layout;
} catch (_error) {
    document.documentElement.dataset.layout = 'popup';
}

await import('./shared.js');
await import('./cookie-credentials.js');

async function loadClassicScript(relativePath) {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(relativePath, import.meta.url).href;
        script.async = false;
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', () => reject(new Error(`无法加载工作台模块: ${relativePath}`)), { once: true });
        document.head.appendChild(script);
    });
}

for (const workbenchModule of [
    './automation-workbench.js',
    './automation-workbench-progress.js',
    './automation-workbench-flow-layout.js',
    './automation-workbench-flow-canvas.js',
    './automation-workbench-flow-events.js',
    './automation-workbench-selector.js',
    './automation-workbench-step-editor.js',
    './automation-workbench-storage.js',
    './automation-workbench-cache.js',
]) {
    await loadClassicScript(workbenchModule);
}
await import('./automation-flow.js');
await import('./bindings.js');
await import('./bindings-card-data.js');
await import('./bindings-cache.js');
await import('./bindings-editor.js');
await import('./bindings-flow.js');
await import('./agent-account.js');
