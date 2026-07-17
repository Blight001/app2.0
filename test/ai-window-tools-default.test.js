const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('软件端 AI 默认自带独立的浏览器窗口控制工具（列出/打开/新建/重命名/关闭）', () => {
  const toolsSource = read('src/app/main/services/ai-browser-window-tools.js');

  assert.match(toolsSource, /SOFTWARE_WINDOW_TOOL_PREFIX = 'software_window_'/);
  for (const suffix of ['list', 'open', 'create', 'rename', 'close']) {
    assert.match(
      toolsSource,
      new RegExp(`\\$\\{SOFTWARE_WINDOW_TOOL_PREFIX\\}${suffix}`),
      `缺少默认窗口工具 software_window_${suffix}`,
    );
  }
  // 新建窗口沿用 VIP 数量限制，创建失败要回滚记录。
  assert.match(toolsSource, /FREE_BROWSER_WINDOW_LIMIT/);
  assert.match(toolsSource, /filter\(\(item\) => item\.id !== id\)/);
  // 打开/重命名复用 settings.js 的同一套记录逻辑，避免两套实现漂移。
  assert.match(toolsSource, /openBrowserHistoryRecord\(ui, record\.id\)/);
  assert.match(toolsSource, /renameBrowserHistoryRecord\(ui, record\.id, newName\)/);
});

test('AI 控制对话默认注入窗口工具，本地工具优先于插件桥派发', () => {
  const lifecycle = read('src/app/main/services/app-lifecycle.js');

  assert.match(lifecycle, /require\('\.\/ai-browser-window-tools'\)/);
  // 工具目录 = 默认窗口工具 + 插件工具（重名时以窗口工具为准）。
  assert.match(lifecycle, /const tools = \[\.\.\.\(windowTools\?\.tools \|\| \[\]\), \.\.\.connectionToolDefs\]/);
  // 窗口工具本地执行，不经过浏览器插件桥。
  assert.match(lifecycle, /windowTools\?\.has\(toolName\)/);
  assert.match(lifecycle, /windowTools\.execute\(toolName, args\)/);
  // 只有当调用了插件工具而未选择插件连接时才失败；纯窗口操作无需插件。
  assert.match(lifecycle, /needsPluginConnection && \(!connections\.length \|\| !bridge\?\.dispatch\)/);
  // 标题生成等 disableTools 调用不注入窗口工具。
  assert.match(lifecycle, /disableTools \? null : getAiBrowserWindowTools\(\)/);
});

test('bootstrap 向 app-lifecycle 提供窗口操作桥 browserWindowUi', () => {
  const bootstrap = read('src/app/main/bootstrap.js');
  assert.match(bootstrap, /browserWindowUi: \{/);
  for (const bridgeFn of ['addTab', 'switchTab', 'closeTab', 'renameTab', 'getActiveTabId']) {
    assert.match(
      bootstrap,
      new RegExp(`browserWindowUi: \\{[\\s\\S]*?${bridgeFn}`),
      `browserWindowUi 缺少 ${bridgeFn}`,
    );
  }
});

test('settings.js 打开/重命名记录逻辑抽为共享函数且 IPC 处理器委托调用', () => {
  const settings = read('src/app/main/ipc/register/settings.js');

  assert.match(settings, /async function openBrowserHistoryRecord\(ui, historyIdInput\)/);
  assert.match(settings, /function renameBrowserHistoryRecord\(ui, historyIdInput, requestedName\)/);
  assert.match(settings, /return await openBrowserHistoryRecord\(ui, payload\?\.historyId\)/);
  assert.match(settings, /return renameBrowserHistoryRecord\(ui, payload\?\.historyId, payload\?\.name\)/);
  for (const exported of [
    'openBrowserHistoryRecord',
    'renameBrowserHistoryRecord',
    'readBrowserHistorySafe',
    'writeBrowserHistorySafe',
    'syncOpenTabsToBrowserHistory',
    'serializeBrowserHistory',
    'createBrowserHistoryId',
  ]) {
    assert.match(
      settings,
      new RegExp(`module\\.exports = \\{[\\s\\S]*?${exported},`),
      `settings.js 未导出 ${exported}`,
    );
  }
});
