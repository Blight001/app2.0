// 源扩展始终保持锁定。AI-FREE 启动受管 Chromium 时会复制扩展，并只在
// 运行副本中写入本次软件进程的临时凭据。这样直接把本目录加载到普通
// Chrome，或复制安装包中的扩展，都不会获得自动化/MCP 能力。
importScripts('background/00_environment.js');

if (globalThis.AI_FREE_BROWSER_ENVIRONMENT?.protectedRuntime === true
    && globalThis.AI_FREE_BROWSER_ENVIRONMENT?.appBrowserToken) {
    importScripts(
        'background/00_core.js',
        'background/01_state.js',
        'background/01_state_capture.js',
        'background/01_state_storage.js',
        'background/02_sidebar_page.js',
        'background/02_sidebar_actions.js',
        'background/02_sidebar_wait.js',
        'background/03_formatting.js',
        'background/04_cache.js',
        'background/06_automation_run.js',
        'background/06_run_context.js',
        'background/06_run_step_handlers.js',
        'background/06_run_action_handlers.js',
        'background/06_run_loop.js',
        'background/06_run_capture.js',
        'background/06_run_lifecycle.js',
        'background/07_events.js',
        'background/08_agent_settings.js',
        'background/10_browser_tools.js',
        'background/09_agent_socket.js',
        'background/09_agent_protocol.js',
        'background/09_agent_transport.js',
        'background/09_agent_tasks.js',
        'background/09_agent_runtime.js'
    );
} else {
    importScripts('background/00_locked.js');
}
