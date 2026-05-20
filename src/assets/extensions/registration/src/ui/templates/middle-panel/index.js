const renderConsoleTab = require('./tabs/console');
const renderProgressTab = require('./tabs/progress');
const renderAiTab = require('./tabs/ai');

module.exports = function renderMiddlePanel() {
  return `<!-- 中间面板 -->
            <div class="middle-panel">
                <div class="middle-tabs">
                    <div class="tab-chooser-row middle-tab-chooser">
                        <div class="middle-tab-headers" role="tablist" aria-label="中间栏切换">
                            <button class="middle-tab-header active" data-tab="middle-tab-console" role="tab" aria-selected="true">控制台输出</button>
                            <button class="middle-tab-header" data-tab="middle-tab-progress" role="tab" aria-selected="false">任务进度</button>
                            <button class="middle-tab-header" data-tab="middle-tab-ai" role="tab" aria-selected="false">AI 管理</button>
                        </div>
                    </div>

                    <div class="middle-tab-contents">
                        ${renderConsoleTab()}
                        ${renderProgressTab()}
                        ${renderAiTab()}
                    </div>
                </div>
            </div>`;
};
