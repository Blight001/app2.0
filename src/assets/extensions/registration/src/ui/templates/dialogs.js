module.exports = function renderDialogs() {
  return `<!-- 卡片编辑对话框 -->
        <div id="card-dialog" class="dialog-overlay" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="dialog-title">添加注册卡片</h3>
                    <button id="close-dialog-btn" class="close-btn">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="card-dialog-layout">
                        <!-- 左侧：基本信息 -->
                        <div class="card-left-panel">
                            <form id="card-form">
                                <div class="form-group">
                                    <label for="card-name">卡片名称:</label>
                                    <input type="text" id="card-name" required>
                                </div>
                                <div class="form-group">
                                    <label for="card-website">网站地址:</label>
                                    <input type="text" id="card-website" placeholder="注册网站的URL地址">
                                </div>
                                <div class="form-group">
                                    <label for="card-description">描述:</label>
                                    <textarea id="card-description" rows="3"></textarea>
                                </div>
                                <div class="form-group">
                                    <label for="card-email">邮箱:</label>
                                    <input type="text" id="card-email" placeholder="可以使用 {random} 生成随机邮箱">
                                </div>
                                <div class="form-group" style="display: none;">
                                    <label for="card-password">密码:</label>
                                    <input type="text" id="card-password" placeholder="可以使用 {random} 生成随机密码">
                                </div>
                                <div class="form-group" style="display: none;">
                                    <label for="card-points">默认积分:</label>
                                    <input type="number" id="card-points" value="0">
                                </div>
                                <div class="form-group" id="card-min-cookie-size-group">
                                    <label for="card-min-cookie-size">最小Cookie大小(字节):</label>
                                    <input type="number" id="card-min-cookie-size" value="8192" min="0" placeholder="低于该值视为异常，不保存Cookie">
                                    <div class="setting-help">仅注册卡片生效。保存前会按 Cookie JSON 的字节数校验，默认 8192 字节（8KB），\`0\` 表示不启用。</div>
                                </div>

                                <!-- Random 配置 -->
                                <div class="form-group">
                                    <label>随机字符串配置:</label>
                                    <div class="random-config">
                                        <div class="random-section">
                                            <h4>邮箱随机配置</h4>
                                            <div class="form-row">
                                                <div class="form-group-inline">
                                                    <label for="email-random-length">长度:</label>
                                                    <input type="number" id="email-random-length" value="8" min="1" max="50">
                                                </div>
                                                <div class="form-group-inline">
                                                    <label for="email-random-type">类型:</label>
                                                    <select id="email-random-type">
                                                        <option value="lowercase">小写字母</option>
                                                        <option value="uppercase">大写字母</option>
                                                        <option value="letters">大小写字母</option>
                                                        <option value="numbers">数字</option>
                                                        <option value="mixed">字母+数字</option>
                                                        <option value="custom">自定义</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="form-group">
                                                <label for="email-random-charset">自定义字符集:</label>
                                                <input type="text" id="email-random-charset" placeholder="输入自定义字符集">
                                            </div>
                                        </div>

                                        <div class="random-section">
                                            <h4>密码随机配置</h4>
                                            <div class="form-row">
                                                <div class="form-group-inline">
                                                    <label for="password-random-length">长度:</label>
                                                    <input type="number" id="password-random-length" value="12" min="1" max="50">
                                                </div>
                                                <div class="form-group-inline">
                                                    <label for="password-random-type">类型:</label>
                                                    <select id="password-random-type">
                                                        <option value="lowercase">小写字母</option>
                                                        <option value="uppercase">大写字母</option>
                                                        <option value="letters">大小写字母</option>
                                                        <option value="numbers">数字</option>
                                                        <option value="mixed" selected>字母+数字</option>
                                                        <option value="lowercase_uppercase_numbers">小写+大写+数字</option>
                                                        <option value="lowercase_uppercase_special">小写+大写+特殊字符</option>
                                                        <option value="lowercase_numbers_special">小写+数字+特殊字符</option>
                                                        <option value="uppercase_numbers_special">大写+数字+特殊字符</option>
                                                        <option value="strong">四类全包含</option>
                                                        <option value="custom">自定义</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="form-group">
                                                <label for="password-random-charset">自定义字符集:</label>
                                                <input type="text" id="password-random-charset" placeholder="输入自定义字符集">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>

                        <!-- 右侧：注册步骤 -->
                        <div class="card-right-panel">
                            <div class="form-group steps-form-group">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                    <label for="card-popups" style="margin-bottom:0;">弹窗规则配置 (JSON格式):</label>
                                    <button id="popups-tutorial-btn" class="btn btn-secondary btn-small" style="padding: 2px 8px; font-size: 12px;">教程</button>
                                </div>
                                <textarea id="card-popups" rows="8" placeholder='请输入弹窗规则的JSON配置，例如：
[
  {
    "name": "关闭广告",
    "selector": ".close-btn"
  }
]'></textarea>
                            </div>
                            <div class="form-group steps-form-group">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                    <label for="card-steps" style="margin-bottom:0;">注册步骤 (JSON格式，可选):</label>
                                    <button id="steps-tutorial-btn" class="btn btn-secondary btn-small" style="padding: 2px 8px; font-size: 12px;">教程</button>
                                </div>
                                <textarea id="card-steps" rows="15" placeholder='请输入注册步骤的JSON配置，可留空，例如：
[
  {
    "type": "navigate",
    "name": "访问网站",
    "url": "https://example.com"
  }
]'></textarea>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="dialog-footer">
                    <label class="debug-mode-toggle" title="逐步执行时给浏览器留出观察时间">
                        <input type="checkbox" id="card-debug-step-pause" checked>
                        <span>逐步暂停</span>
                    </label>
                    <button id="debug-card-btn" class="btn btn-warning">调试运行</button>
                    <button id="save-card-btn" class="btn btn-primary">保存</button>
                    <button id="cancel-card-btn" class="btn btn-secondary">取消</button>
                </div>
            </div>
        </div>

        <!-- 消息对话框 -->
        <div id="message-dialog" class="dialog-overlay message-dialog" style="display: none;">
            <div class="message-content">
                <p id="message-text"></p>
            </div>
        </div>

        <!-- 确认对话框 -->
        <div id="confirm-dialog" class="dialog-overlay confirm-dialog" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="confirm-title">请确认</h3>
                    <button id="confirm-close-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div id="confirm-text" class="confirm-text"></div>
                </div>
                <div class="dialog-footer">
                    <button id="confirm-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                    <button id="confirm-ok-btn" class="btn btn-danger" type="button">确认</button>
                </div>
            </div>
        </div>

        <!-- 历史任务弹窗 -->
        <div id="task-history-dialog" class="dialog-overlay task-history-dialog" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3>全部历史记录</h3>
                    <button id="task-history-dialog-close-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="task-history-dialog-note">点击任意记录可展开查看成功说明、失败原因和相关任务信息。</div>
                    <div id="task-history-dialog-list" class="task-history-dialog-list">
                        <!-- 全部历史任务记录将在这里生成 -->
                    </div>
                </div>
                <div class="dialog-footer">
                    <button id="task-history-dialog-close-btn-2" class="btn btn-secondary" type="button">关闭</button>
                </div>
            </div>
        </div>

        <!-- 教程弹窗 -->
        <div id="tutorial-dialog" class="dialog-overlay" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="tutorial-title">配置教程</h3>
                    <button id="close-tutorial-btn" class="close-btn">&times;</button>
                </div>
                <div class="dialog-body">
                    <div id="tutorial-content" style="white-space: pre-wrap; font-family: monospace; background: var(--surface-2); color: var(--text); padding: 15px; border-radius: 4px; max-height: 60vh; overflow-y: auto;"></div>
                </div>
                <div class="dialog-footer">
                    <button id="tutorial-ok-btn" class="btn btn-primary">关闭</button>
                </div>
            </div>
        </div>

        <div id="outlook-email-import-dialog" class="dialog-overlay" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3>导入 Outlook 邮箱</h3>
                    <button id="outlook-email-import-close-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="setting-item">
                        <label for="outlook-email-import-text">导入内容</label>
                        <textarea id="outlook-email-import-text" rows="10" placeholder="邮箱----密码----获取链接
qdcr5297@outlook.com----eman4814----http://query.paopaodw.com/t?v=BgUGAFBTS0QhCxMVHwsJCksXCAhtBB4WGlNcQk4"></textarea>
                        <div class="setting-help">每行一条，格式为 邮箱----密码----获取链接。重复邮箱会自动覆盖为最新一条。</div>
                    </div>
                </div>
                <div class="dialog-footer">
                    <button id="outlook-email-import-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                    <button id="outlook-email-import-confirm-btn" class="btn btn-primary" type="button">导入</button>
                </div>
            </div>
        </div>

        <!-- AI 配置弹窗 -->
        <div id="ai-assistant-config-dialog" class="dialog-overlay ai-assistant-config-dialog" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="ai-assistant-config-title">AI 配置</h3>
                    <button id="close-ai-assistant-config-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="ai-assistant-config-dialog-note">
                        <div class="panel-subtitle">API Key 只保存在本机用户目录。当前功能预设会一并保存，浏览器 MCP 会读取这里的设置。</div>
                    </div>
                    <div class="ai-assistant-config-dialog-grid">
                        <div class="form-group">
                            <label for="ai-assistant-config-base-url">接口地址</label>
                            <input type="text" id="ai-assistant-config-base-url" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="form-group">
                            <label for="ai-assistant-config-model">模型</label>
                            <input type="text" id="ai-assistant-config-model" placeholder="deepseek-chat" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="form-group ai-assistant-config-dialog-key">
                            <label for="ai-assistant-config-api-key">API Key</label>
                            <input type="password" id="ai-assistant-config-api-key" placeholder="留空则继续使用已保存的密钥" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="form-group ai-assistant-config-dialog-profiles">
                            <label>功能预设</label>
                            <div id="ai-assistant-config-active-profiles" class="ai-assistant-config-profile-list" role="group" aria-label="功能预设多选">
                                <label class="ai-assistant-config-profile-option">
                                    <input type="checkbox" value="general" checked>
                                    <span>
                                        <strong>通用对话</strong>
                                        <small>仅启用基础问答，不附加本地页面能力。</small>
                                    </span>
                                </label>
                                <label class="ai-assistant-config-profile-option">
                                    <input type="checkbox" value="browser-mcp">
                                    <span>
                                        <strong>浏览器 MCP</strong>
                                        <small>启用浏览器页面快照与页面操作相关能力。</small>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="ai-assistant-config-dialog-note" id="ai-assistant-config-profile-note">可多选，至少选择一个功能预设。</div>
                </div>
                <div class="dialog-footer">
                    <button id="ai-assistant-config-reload-btn" class="btn btn-secondary" type="button">重载当前配置</button>
                    <button id="ai-assistant-config-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                    <button id="ai-assistant-config-save-btn" class="btn btn-primary" type="button">保存配置</button>
                </div>
            </div>
        </div>
    </div>`;
};
