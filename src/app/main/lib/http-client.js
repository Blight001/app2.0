// 客户端与服务器之间仅使用 HTTP 通信。
const { NETWORK_DIAG_CONFIG, getServerBase, setRuntimeServerBase } = require('../config');
const { postJson, postEventStream, getJson } = require('./http');
const { executeHttpRequest } = require('./http-client/transport-request');
const { isServerBaseAllowedForMode } = require('../utils/server-mode');

// HTTP 客户端：负责把客户端请求通过 HTTP 发送到服务器。
class HttpClient {
    constructor(options = {}) {
        // 兼容旧调用：既支持直接传入 mainWindow，也支持 options 对象。
        const hasMainWindow =
            typeof options === 'object'
            && options !== null
            && Object.prototype.hasOwnProperty.call(options, 'mainWindow');
        const mainWindow = hasMainWindow ? options.mainWindow : options;

        // 主窗口引用（供上层使用）
        this.mainWindow = mainWindow;
        // 传输模式恒为 http（保留字段以兼容读取方）
        this.transportMode = 'http';
        // 运行时服务器地址（从响应中同步，优先于配置文件）
        this.runtimeServerBase = '';
    }

    _normalizeRuntimeServerBase(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        try {
            const url = new URL(text.includes('://') ? text : `http://${text}`);
            const pathname = String(url.pathname || '').replace(/\/+$/, '');
            const normalized = `${url.protocol}//${url.host}${pathname === '/' ? '' : pathname}`.replace(/\/+$/, '');
            return isServerBaseAllowedForMode(normalized) ? normalized : '';
        } catch (_) {
            const normalized = text.replace(/\/+$/, '');
            return isServerBaseAllowedForMode(normalized) ? normalized : '';
        }
    }

    _extractRuntimeServerBase(source) {
        if (!source || typeof source !== 'object') {
            return '';
        }

        const candidates = [
            source.serverBase,
            source.server_base,
            source.address_HTTP,
            source.addressHttp,
            source.address_http,
            source.client_address,
            source.clientAddress,
            source.address,
            source.result?.serverBase,
            source.result?.server_base,
            source.result?.address_HTTP,
            source.result?.addressHttp,
            source.result?.address_http,
            source.result?.client_address,
            source.result?.clientAddress,
            source.result?.address,
            source.data?.serverBase,
            source.data?.server_base,
            source.data?.address_HTTP,
            source.data?.addressHttp,
            source.data?.address_http,
            source.data?.client_address,
            source.data?.clientAddress,
            source.data?.address,
            source.payload?.serverBase,
            source.payload?.server_base,
            source.payload?.address_HTTP,
            source.payload?.addressHttp,
            source.payload?.address_http,
            source.payload?.client_address,
            source.payload?.clientAddress,
            source.payload?.address,
        ];

        for (const candidate of candidates) {
            const normalized = this._normalizeRuntimeServerBase(candidate);
            if (normalized) {
                return normalized;
            }
        }
        return '';
    }

    _syncRuntimeServerBase(source) {
        const nextBase = this._extractRuntimeServerBase(source);
        if (!nextBase) {
            return '';
        }

        this.runtimeServerBase = nextBase;
        try {
            if (typeof setRuntimeServerBase === 'function') {
                setRuntimeServerBase(nextBase);
            }
        } catch (_) {}
        return nextBase;
    }

    _getPreferredHttpBase() {
        return this.runtimeServerBase || getServerBase() || '';
    }

    _getClientGatewayFallbackBases() {
        const preferred = this._getPreferredHttpBase();
        if (!preferred) return [];
        try {
            const parsed = new URL(preferred);
            const candidates = [];
            const push = (value) => {
                const normalized = String(value || '').replace(/\/+$/, '');
                if (normalized && normalized !== preferred.replace(/\/+$/, '') && !candidates.includes(normalized)) {
                    candidates.push(normalized);
                }
            };

            // 59000 是统一控制入口；未登录状态下的公开客户端能力由同主机 58111 提供。
            parsed.port = '58111';
            push(parsed.toString());

            // 若控制入口带有自身路径，再尝试客户端网关根地址。
            if (parsed.pathname && parsed.pathname !== '/') {
                parsed.pathname = '/';
                parsed.search = '';
                parsed.hash = '';
                push(parsed.toString());
            }
            return candidates;
        } catch (_) {
            return [];
        }
    }

    async _executeHttpRequest({
        path,
        method = 'POST',
        data,
        timeoutMs = NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT,
    }) {
        return executeHttpRequest({
            getServerBase: () => this._getPreferredHttpBase(),
            getJson,
            postJson,
            path,
            method,
            data,
            timeoutMs,
        });
    }

    // 统一的 HTTP 请求入口：执行请求、同步服务器地址、并附带 transportMode。
    async _request({
        actionLabel,
        path,
        method = 'POST',
        data,
        timeoutMs = NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT,
    }) {
        const result = await this._executeHttpRequest({ path, method, data, timeoutMs })
            .catch((error) => {
                console.warn(`[HTTP] ${actionLabel || path} 请求失败:`, error?.message || error);
                return {
                    ok: false,
                    status: 0,
                    error: error?.message || String(error),
                };
            });
        this._syncRuntimeServerBase(result);
        if (result && typeof result === 'object') {
            return { ...result, transportMode: 'http' };
        }
        return result;
    }

    /**
     * 网络连接诊断（HTTP 版本）
     * @returns {Promise<Object>} 诊断结果
     */
    async diagnoseConnection() {
        const results = {
            httpConnection: false,
            httpConnectionTime: 0,
            httpError: null,
            transportMode: 'http',
            recommendations: [],
        };

        const base = this._getPreferredHttpBase();
        if (!base) {
            results.httpError = 'HTTP服务器地址未配置';
            results.recommendations.push('尚未获取到服务器地址，请先完成卡密验证');
            return results;
        }

        try {
            const startTime = Date.now();
            // 使用公开、轻量的公告接口作为 HTTP 连通性探针。
            const resp = await this._executeHttpRequest({
                path: '/api/user_announcement',
                method: 'GET',
                timeoutMs: NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT,
            });
            results.httpConnectionTime = Date.now() - startTime;
            results.httpConnection = !!(resp && (resp.ok || resp.status));
            if (!results.httpConnection) {
                results.httpError = resp?.error || 'HTTP请求未返回有效响应';
            }
        } catch (error) {
            results.httpError = error?.message || String(error);
            results.recommendations.push('HTTP连接失败，请检查网络或服务器地址');
        }

        if (results.httpConnectionTime > 3000) {
            results.recommendations.push('HTTP连接耗时较长，建议检查网络质量');
        }

        return results;
    }

    /**
     * 验证卡密
     */
    async validateKey(key, deviceId) {
        return this._request({
            actionLabel: 'validateKey',
            path: '/api/validate_key',
            method: 'POST',
            data: { key, device_id: deviceId },
        });
    }

    /**
     * 获取Cookie
     */
    async fetchCookie(key, platform, deviceId) {
        return this._request({
            actionLabel: 'fetchCookie',
            path: '/api/fetch_cookie',
            method: 'POST',
            data: { key, platform, device_id: deviceId },
        });
    }

    /**
     * 自助解绑设备
     */
    async unbindDevice(key, deviceId) {
        return this._request({
            actionLabel: 'unbindDevice',
            path: '/api/unbind_device',
            method: 'POST',
            data: { key, device_id: deviceId, deviceId },
        });
    }

    /**
     * 获取客户端配置
     * @param {string} key - 卡密
     * @param {string} deviceId - 设备号
     */
    async getClientConfig(key, deviceId) {
        const qs = new URLSearchParams({
            key: String(key || ''),
            device_id: String(deviceId || ''),
        }).toString();
        const requestTimeoutMs = Math.max(NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT * 4, 20000);

        const attempts = [
            {
                label: 'HTTP GET query',
                method: 'GET',
                path: `/api/client/config${qs ? `?${qs}` : ''}`,
            },
            {
                label: 'HTTP POST body',
                method: 'POST',
                path: '/api/client/config',
                data: { key, device_id: deviceId },
            },
        ];

        let lastError = null;
        for (const attempt of attempts) {
            try {
                console.log(`[HTTP] getClientConfig 尝试${attempt.label}: ${attempt.path}`);
                const result = await this._executeHttpRequest({
                    path: attempt.path,
                    method: attempt.method,
                    data: attempt.data,
                    timeoutMs: requestTimeoutMs,
                });
                this._syncRuntimeServerBase(result);
                if (result && result.ok === true) {
                    return { ...result, transportMode: 'http' };
                }
                lastError = new Error(result?.message || result?.error || '获取客户端配置失败');
                // 非 ok 但已拿到响应对象时，仍返回该对象供上层判断。
                if (attempt === attempts[attempts.length - 1] && result && typeof result === 'object') {
                    return { ...result, transportMode: 'http' };
                }
            } catch (error) {
                lastError = error;
                console.warn(`[HTTP] getClientConfig ${attempt.label}失败:`, error?.message || error);
            }
        }

        return {
            ok: false,
            status: 0,
            error: lastError?.message || 'HTTP获取客户端配置失败',
            transportMode: 'http',
        };
    }

    /**
     * 获取代理状态和流量信息
     */
    async getProxyStatus() {
        return this._request({
            actionLabel: 'getProxyStatus',
            path: '/api/get_proxy_status',
            method: 'GET',
        });
    }

    async getPacConfig(key, deviceId) {
        return this._request({
            actionLabel: 'getPacConfig',
            path: '/api/get_pac_config',
            method: 'POST',
            data: { key, device_id: deviceId },
        });
    }

    async controlProxy(key, deviceId, action) {
        return this._request({
            actionLabel: 'controlProxy',
            path: '/api/control_proxy',
            method: 'POST',
            data: { key, device_id: deviceId, action },
        });
    }

    async getAIControlModels(key, deviceId) {
        const primary = await this._request({
            actionLabel: 'getAIControlModels',
            path: '/api/ai-control/models',
            method: 'POST',
            data: { key, device_id: deviceId },
        });
        if (primary?.ok) return primary;

        let lastResult = primary;
        for (const base of this._getClientGatewayFallbackBases()) {
            console.log(`[HTTP] getAIControlModels 回退客户端网关: ${base}`);
            const result = await executeHttpRequest({
                getServerBase: () => base,
                getJson,
                postJson,
                path: '/api/ai-control/models',
                method: 'POST',
                data: { key, device_id: deviceId },
                timeoutMs: NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT,
            }).catch((error) => ({
                ok: false,
                status: 0,
                error: error?.message || String(error),
            }));
            lastResult = result;
            if (result?.ok) {
                return { ...result, transportMode: 'http' };
            }
        }
        return lastResult && typeof lastResult === 'object'
            ? { ...lastResult, transportMode: 'http' }
            : primary;
    }

    async redeemAIControlGiftCode(key, deviceId, code) {
        return this._request({
            actionLabel: 'redeemAIControlGiftCode',
            path: '/api/ai-control/gift-codes/redeem',
            method: 'POST',
            data: { key, device_id: deviceId, code },
        });
    }

    async redeemWoolGiftCode(key, deviceId, code) {
        return this._request({
            actionLabel: 'redeemWoolGiftCode',
            path: '/api/wool-gift-codes/redeem',
            method: 'POST',
            data: { key, device_id: deviceId, code },
        });
    }

    async getProxyTrafficQuota(key, deviceId) {
        return this._request({
            actionLabel: 'getProxyTrafficQuota',
            path: '/api/proxy/client/quota',
            method: 'POST',
            data: { key, device_id: deviceId },
        });
    }

    async createProxyTrafficSession(key, deviceId) {
        return this._request({
            actionLabel: 'createProxyTrafficSession',
            path: '/api/proxy/client/session',
            method: 'POST',
            data: { key, device_id: deviceId },
        });
    }

    async reportProxyTraffic(data) {
        return this._request({
            actionLabel: 'reportProxyTraffic',
            path: '/api/proxy/client/usage',
            method: 'POST',
            data,
            timeoutMs: 15000,
        });
    }

    async redeemProxyTrafficGiftCode(key, deviceId, code) {
        return this._request({
            actionLabel: 'redeemProxyTrafficGiftCode',
            path: '/api/proxy/gift-codes/redeem',
            method: 'POST',
            data: { key, device_id: deviceId, code },
        });
    }

    async sendAIControlMessage(key, deviceId, modelId, messages, options = {}) {
        return this._request({
            actionLabel: 'sendAIControlMessage',
            path: '/api/ai-control/chat',
            method: 'POST',
            data: {
                key,
                device_id: deviceId,
                model_id: modelId,
                messages,
                tools: Array.isArray(options.tools) ? options.tools : [],
                run_id: String(options.runId || ''),
            },
            timeoutMs: 120000,
        });
    }

    async streamAIControlMessage(key, deviceId, modelId, messages, options = {}, onEvent) {
        const base = this._getPreferredHttpBase();
        if (!base) return { ok: false, message: 'HTTP服务器地址未配置' };
        const url = `${base.replace(/\/+$/, '')}/api/ai-control/chat/stream`;
        try {
            return await postEventStream(url, {
                key,
                device_id: deviceId,
                model_id: modelId,
                messages,
                tools: Array.isArray(options.tools) ? options.tools : [],
                run_id: String(options.runId || ''),
            }, onEvent, 240000);
        } catch (error) {
            console.warn('[HTTP] streamAIControlMessage 请求失败:', error?.message || error);
            return { ok: false, message: error?.message || String(error) };
        }
    }

    /**
     * 关闭连接（HTTP 模式下无持久连接，保留为兼容 no-op）
     */
    close() {}
}

// 创建全局 HTTP 客户端实例
let globalHttpClient = null;

// Update the shared HTTP client options.
function updateGlobalHttpClientOptions(opts = {}) {
    if (!globalHttpClient || !opts || typeof opts !== 'object') {
        return;
    }
    if (Object.prototype.hasOwnProperty.call(opts, 'mainWindow')) {
        globalHttpClient.mainWindow = opts.mainWindow;
    }
}

// Return the shared HTTP client instance.
function ensureGlobalHttpClient(options = {}) {
    const opts = (options && typeof options === 'object') ? options : { mainWindow: options };
    if (!globalHttpClient) {
        globalHttpClient = new HttpClient(opts);
    }
    updateGlobalHttpClientOptions(opts);
    return globalHttpClient;
}

// Create or reuse the shared HTTP client.
function createHttpClient(options = {}) {
    return ensureGlobalHttpClient(options);
}

// 格式化/规范化：normalizeValidationRuntimeConfig的具体业务逻辑。
function normalizeValidationRuntimeConfig(source = {}) {
    const input = source && typeof source === 'object'
        ? {
            ...(source.result && typeof source.result === 'object' ? source.result : {}),
            ...source,
        }
        : {};

    const allowedPlatformsRaw = input.allowedPlatforms ?? input.allowed_platforms ?? [];
    const allowedPlatforms = Array.isArray(allowedPlatformsRaw)
        ? allowedPlatformsRaw.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const platformName = String(
        input.platformName
        ?? input.platform_name
        ?? allowedPlatforms[0]
        ?? ''
    ).trim();
    const resolvedAllowedPlatforms = allowedPlatforms.length > 0
        ? allowedPlatforms
        : (platformName ? [platformName] : []);
    const woolPlatformsRaw = input.woolPlatforms ?? input.wool_platforms ?? [];
    const woolPlatforms = Array.isArray(woolPlatformsRaw)
        ? woolPlatformsRaw.map((item) => ({
            name: String(item?.name ?? item?.platform ?? item?.platform_name ?? '').trim(),
            platform: String(item?.platform ?? item?.name ?? item?.platform_name ?? '').trim(),
            targetUrl: String(item?.targetUrl ?? item?.target_url ?? '').trim(),
            quota: item?.quota && typeof item.quota === 'object' ? { ...item.quota } : null,
        })).filter((item) => item.name && item.targetUrl)
        : [];

    const serverBase = [
        input.address_HTTP,
        input.addressHttp,
        input.address_http,
        input.client_address,
        input.clientAddress,
        input.serverBase,
        input.server_base,
        input.address,
    ].map((value) => String(value || '').trim()).find(Boolean) || '';

    return {
        platformName,
        platform_name: platformName,
        allowedPlatforms: resolvedAllowedPlatforms,
        allowed_platforms: resolvedAllowedPlatforms,
        woolPlatforms,
        wool_platforms: woolPlatforms,
        targetUrl: String(input.targetUrl ?? input.target_url ?? '').trim(),
        tutorialUrl: String(input.tutorialUrl ?? input.tutorial_url ?? '').trim(),
        serverBase,
        server_base: serverBase,
        address_HTTP: serverBase,
        addressHttp: serverBase,
    };
}

module.exports = {
    createHttpClient,
    normalizeValidationRuntimeConfig,
};
