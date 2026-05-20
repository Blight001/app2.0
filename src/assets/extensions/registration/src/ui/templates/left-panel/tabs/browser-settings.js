module.exports = function renderBrowserSettingsTab() {
  return `<!-- 浏览器设置 Tab -->
                        <div id="tab-browser-settings" class="tab-content" role="tabpanel" style="display:none;">
                            <div class="browser-settings-section registration-browser-settings-section" id="registration-browser-settings-section">
                                <div class="panel-header browser-settings-header" style="margin-top:15px;">
                                    <div>
                                        <h3>浏览器设置</h3>
                                        <p class="panel-subtitle">统一管理注册、测试、海卡绑定和代理相关的浏览器参数。</p>
                                    </div>
                                </div>
                                <div class="settings-content browser-settings-content">
                                    <div class="setting-item">
                                        <div class="setting-title-row">
                                            <label for="browser-type">默认浏览器</label>
                                        </div>
                                        <div class="browser-type-group">
                                            <select id="browser-type">
                                                <!-- 选项将通过JavaScript动态填充 -->
                                            </select>
                                        </div>
                                        <div class="setting-help">默认使用内置浏览器，同时保留 Edge 和 Chrome 供手动切换。</div>
                                    </div>
                                    <div class="setting-item">
                                        <label for="browser-source">浏览器来源</label>
                                        <select id="browser-source">
                                            <option value="local-browser">注册器内置浏览器</option>
                                            <option value="client-browser">客户端软件浏览器</option>
                                        </select>
                                        <div class="setting-help">用于区分浏览器由注册器本地启动，还是由客户端软件统一接管。</div>
                                    </div>
                                    <div class="setting-item">
                                        <div class="setting-row">
                                            <label for="headless-mode" class="setting-switch-label">后台运行</label>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="headless-mode" checked>
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="setting-help">关闭后更接近真实浏览器；做真实性测试时建议关闭。</div>
                                    </div>
                                    <div class="setting-item">
                                        <div class="setting-row">
                                            <label for="registration-save-local-cookie" class="setting-switch-label">是否保存本地Cookie</label>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="registration-save-local-cookie">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="setting-help">默认关闭。关闭后不会写入本地 cookies 目录，但仍会保留浏览器内 Cookie 供后续自动上传使用。</div>
                                    </div>
                                    <div class="setting-item">
                                        <label for="browser-region">代理地区预设</label>
                                        <select id="browser-region">
                                            <option value="">自动/系统</option>
                                            <option value="cn">中国大陆</option>
                                            <option value="hk">中国香港</option>
                                            <option value="tw">中国台湾</option>
                                            <option value="jp">日本</option>
                                            <option value="kr">韩国</option>
                                            <option value="sg">新加坡</option>
                                            <option value="us">美国</option>
                                            <option value="gb">英国</option>
                                            <option value="de">德国</option>
                                            <option value="fr">法国</option>
                                            <option value="ca">加拿大</option>
                                            <option value="au">澳大利亚</option>
                                        </select>
                                        <div class="setting-help">选择代理出口地区后会自动填充语言和时区；DNS 仍取决于代理/系统配置。</div>
                                    </div>
                                    <div class="setting-item">
                                        <label for="browser-locale">浏览器语言</label>
                                        <input type="text" id="browser-locale" placeholder="ja-JP / zh-CN" autocomplete="off" spellcheck="false">
                                        <div class="setting-help">留空时自动跟随系统；建议与代理出口地区保持一致。</div>
                                    </div>
                                    <div class="setting-item">
                                        <label for="browser-timezone-id">浏览器时区</label>
                                        <input type="text" id="browser-timezone-id" placeholder="Asia/Tokyo" autocomplete="off" spellcheck="false">
                                        <div class="setting-help">留空时自动跟随系统；例如 Asia/Tokyo、Asia/Shanghai。</div>
                                    </div>
                                    <div class="setting-item">
                                        <div class="setting-row">
                                            <label for="browser-dynamic-fingerprint" class="setting-switch-label">基础环境随机化</label>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="browser-dynamic-fingerprint" checked>
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="setting-help">自动调整窗口尺寸、语言、时区等常规环境参数。</div>
                                    </div>
                                    <div class="setting-item">
                                        <div class="setting-row">
                                            <label for="browser-block-images-videos" class="setting-switch-label">拦截图片/视频</label>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="browser-block-images-videos" checked>
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="setting-help">开启后会主动拦截图片和视频/媒体请求，减少流量消耗；如页面需要验证码图片可临时关闭。</div>
                                    </div>
                                    <div class="setting-item">
                                        <div class="setting-row">
                                            <label for="browser-remove-watermark-plugin" class="setting-switch-label">启用去水印插件</label>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="browser-remove-watermark-plugin" checked>
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="setting-help">开启后内置浏览器会自动加载去水印扩展；关闭后则只保留浏览器本体功能。</div>
                                    </div>
                                    <div class="setting-item" id="sync-control-wrapper">
                                        <div class="setting-row">
                                            <label for="sync-execution" class="setting-switch-label">同步进行</label>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="sync-execution" checked>
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="setting-help">开启后会按流程顺序同步执行步骤。</div>
                                    </div>
                                    <div class="setting-item">
                                        <label for="proxy-recovery-attempts">自动恢复次数:</label>
                                        <input type="number" id="proxy-recovery-attempts" min="1" max="20" value="3">
                                    </div>

                                </div>
                            </div>
                        </div>`;
};
