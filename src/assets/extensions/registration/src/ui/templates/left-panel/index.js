const renderRegisterCardsTab = require('./tabs/cards');
const renderAccountTestTab = require('./tabs/account-test');
const renderTrialBindTab = require('./tabs/trial-bind');
const renderBrowserSettingsTab = require('./tabs/browser-settings');

module.exports = function renderLeftPanel() {
  return `<!-- 左侧面板（参考 Python main_window 布局：Tab 风格） -->
            <div class="left-panel">
                <div class="left-tabs">
                    <div class="tab-chooser-row">
                        <div class="tab-headers" role="tablist">
                            <button class="tab-header active" data-tab="tab-cards" role="tab">注册卡片</button>
                            <button class="tab-header" data-tab="tab-account-test" role="tab">账号测试</button>
                            <button class="tab-header" data-tab="tab-trial-bind" role="tab">海卡兑换</button>
                            <button class="tab-header" data-tab="tab-browser-settings" role="tab">浏览器设置</button>
                        </div>
                    </div>

                    <div class="tab-contents">
                        ${renderRegisterCardsTab()}
                        ${renderAccountTestTab()}
                        ${renderTrialBindTab()}
                        ${renderBrowserSettingsTab()}
                    </div>
                </div>
            </div>`;
};
