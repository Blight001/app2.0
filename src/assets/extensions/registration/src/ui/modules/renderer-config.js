const { DEFAULT_EMAIL_HOST, DEFAULT_EMAIL_PORT } = require('../../core/email/email-defaults');
const {
    normalizeBooleanValue,
    normalizeTcpServerUrl
} = require('../../core/infra/config-utils');

/**
 * 运行配置相关的渲染功能。
 *
 * 这里主要负责 `resource/config.json` 的加载与保存。
 * 当前界面暴露邮箱连接参数和 TCP 服务器地址，但会保留配置文件中的其他字段。
 */

module.exports = function createRendererConfig(deps) {
    const { elements, ipcRenderer, logger } = deps;

    function getStoredTcpServerUrl(config = {}) {
        const source = config && typeof config === 'object' ? config : {};
        return String(
            source.tcp_server_url ||
            source.tcpServerUrl ||
            source.server_url ||
            source.serverUrl ||
            source.registration_server_url ||
            source.registrationServerUrl ||
            source.mqtt_server_url ||
            source.mqttServerUrl ||
            ''
        ).trim();
    }

    function getStoredTcpAutoReconnectEnabled(config = {}) {
        const source = config && typeof config === 'object' ? config : {};
        return normalizeBooleanValue(
            source.tcp_auto_reconnect_enabled ??
            source.tcpAutoReconnectEnabled ??
            source.registration_tcp_auto_reconnect_enabled ??
            source.registrationTcpAutoReconnectEnabled,
            true
        );
    }

    async function readCurrentConfig() {
        const result = await ipcRenderer.invoke('get-cookie-user-config');
        if (!result.success) {
            throw new Error(result.error || '读取运行配置失败');
        }

        return result.config && typeof result.config === 'object' ? result.config : {};
    }

    async function loadCookieUserConfig() {
        try {
            const config = await readCurrentConfig();

            if (elements.emailHost) {
                elements.emailHost.value = typeof config.email_host === 'string' && config.email_host.trim()
                    ? config.email_host
                    : DEFAULT_EMAIL_HOST;
            }
            if (elements.emailPort) {
                elements.emailPort.value = config.email_port !== undefined && config.email_port !== null
                    ? String(config.email_port)
                    : String(DEFAULT_EMAIL_PORT);
            }
        } catch (error) {
            logger.error(`加载运行配置失败: ${error.message}`);
        }
    }

    async function saveCookieUserConfig() {
        try {
            const config = await readCurrentConfig();
            const fieldMappings = [
                ['server_url', elements.cookieServerUrl],
                ['passphrase', elements.cookiePassphrase],
                ['auth_token', elements.cookieToken],
                ['aid', elements.cookieAid],
                ['score', elements.cookieScore],
                ['email_host', elements.emailHost],
                ['email_port', elements.emailPort]
            ];

            fieldMappings.forEach(([fieldName, element]) => {
                if (!element) {
                    return;
                }

                config[fieldName] = element.value;
            });

            const result = await ipcRenderer.invoke('save-cookie-user-config', config);
            if (result.success) {
                logger.info('运行配置已保存');
            } else {
                logger.error(`保存运行配置失败: ${result.error}`);
            }

            return result;
        } catch (error) {
            logger.error(`保存运行配置异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async function loadTcpServerConfig() {
        try {
            const result = await ipcRenderer.invoke('get-registration-tcp-config');
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取TCP配置失败');
            }
            if (elements.tcpServerUrl) {
                const tcpServerUrl = getStoredTcpServerUrl(result);
                elements.tcpServerUrl.value = normalizeTcpServerUrl(tcpServerUrl);
            }
            if (elements.tcpAutoReconnectEnabled) {
                const tcpAutoReconnectEnabled = getStoredTcpAutoReconnectEnabled(result);
                elements.tcpAutoReconnectEnabled.checked = tcpAutoReconnectEnabled !== false;
            }
        } catch (error) {
            logger.error(`加载TCP服务器配置失败: ${error.message}`);
        }
    }

    async function saveTcpServerConfig() {
        try {
            const rawTcpServerUrl = elements.tcpServerUrl ? elements.tcpServerUrl.value : '';
            const tcpServerUrl = normalizeTcpServerUrl(rawTcpServerUrl);
            const tcpAutoReconnectEnabled = elements.tcpAutoReconnectEnabled
                ? elements.tcpAutoReconnectEnabled.checked === true
                : true;

            const result = await ipcRenderer.invoke('save-registration-tcp-config', {
                tcp_server_url: tcpServerUrl,
                tcp_auto_reconnect_enabled: tcpAutoReconnectEnabled
            });
            if (result.success) {
                if (elements.tcpServerUrl) {
                    elements.tcpServerUrl.value = normalizeTcpServerUrl(getStoredTcpServerUrl(result) || tcpServerUrl);
                }
                if (elements.tcpAutoReconnectEnabled) {
                    elements.tcpAutoReconnectEnabled.checked = getStoredTcpAutoReconnectEnabled(result) !== false;
                }
            } else {
                logger.error(`保存TCP服务器地址失败: ${result.error}`);
            }

            return result;
        } catch (error) {
            logger.error(`保存TCP服务器地址异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    return {
        loadCookieUserConfig,
        saveCookieUserConfig,
        loadTcpServerConfig,
        saveTcpServerConfig
    };
};
