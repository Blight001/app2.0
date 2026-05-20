const net = require('net');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { getTcpConfig, isHttpCompatModeEnabled, NETWORK_DIAG_CONFIG, getCoreDir, getStorePath, getServerBase, setRuntimeServerBase } = require('../config');
const { postJson, getJson } = require('./http');
const { MESSAGE_TYPES } = require('./tcp-client/protocol');
const { executeHttpRequest, executeWithFallback } = require('./tcp-client/transport-request');
const {
    getRealProxyStatus: dispatchGetRealProxyStatus,
    handleAccountCookiePush: dispatchAccountCookiePush,
    handleCompleteMessage: dispatchCompleteMessage,
    handleGetProxyStatusRequest: dispatchProxyStatusRequest,
    handleIncomingData: dispatchIncomingData,
    handleServerMessage: dispatchServerMessage,
    processBuffer: dispatchProcessBuffer,
} = require('./tcp-client/message-dispatcher');
const {
    VALIDATE_KEY_REQ: MSG_TYPE_VALIDATE_KEY_REQ,
    VALIDATE_KEY_RESP: MSG_TYPE_VALIDATE_KEY_RESP,
    FETCH_COOKIE_REQ: MSG_TYPE_FETCH_COOKIE_REQ,
    FETCH_COOKIE_RESP: MSG_TYPE_FETCH_COOKIE_RESP,
    HEARTBEAT: MSG_TYPE_HEARTBEAT,
    HEARTBEAT_RESP: MSG_TYPE_HEARTBEAT_RESP,
    SERVER_MESSAGE: MSG_TYPE_SERVER_MESSAGE,
    CLIENT_CONFIG_REQ: MSG_TYPE_CLIENT_CONFIG_REQ,
    CLIENT_CONFIG_RESP: MSG_TYPE_CLIENT_CONFIG_RESP,
    GET_PAC_CONFIG_REQ: MSG_TYPE_GET_PAC_CONFIG_REQ,
    GET_PAC_CONFIG_RESP: MSG_TYPE_GET_PAC_CONFIG_RESP,
    GET_PROXY_STATUS_REQ: MSG_TYPE_GET_PROXY_STATUS_REQ,
    GET_PROXY_STATUS_RESP: MSG_TYPE_GET_PROXY_STATUS_RESP,
    CONTROL_PROXY_REQ: MSG_TYPE_CONTROL_PROXY_REQ,
    CONTROL_PROXY_RESP: MSG_TYPE_CONTROL_PROXY_RESP,
    REPORT_SCORE_REQ: MSG_TYPE_REPORT_SCORE_REQ,
    UNBIND_DEVICE_REQ: MSG_TYPE_UNBIND_DEVICE_REQ,
    UNBIND_DEVICE_RESP: MSG_TYPE_UNBIND_DEVICE_RESP,
    GET_AI_REFRESH_TIME_REQ: MSG_TYPE_GET_AI_REFRESH_TIME_REQ,
    GET_AI_REFRESH_TIME_RESP: MSG_TYPE_GET_AI_REFRESH_TIME_RESP,
    AUTH_HELLO_REQ: MSG_TYPE_AUTH_HELLO_REQ,
    AUTH_HELLO_RESP: MSG_TYPE_AUTH_HELLO_RESP,
} = MESSAGE_TYPES;

const AUTH_SHARED_SECRET = String(process.env.TCP_SHARED_SECRET || '哈基米').trim() || '哈基米';
const AUTH_TIME_WINDOW_MS = Math.max(1000, Number(process.env.TCP_AUTH_WINDOW_MS) || 30000);
const AUTH_TIME_SKEW_WINDOWS = Math.max(0, Number(process.env.TCP_AUTH_TIME_SKEW_WINDOWS) || 1);

// 处理：sha256Hex的具体业务逻辑。
function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// 创建/初始化：createAuthNonce的具体业务逻辑。
function createAuthNonce() {
    return crypto.randomBytes(16).toString('hex');
}

// 格式化/规范化：normalizeAuthToken的具体业务逻辑。
function normalizeAuthToken(value) {
    const raw = String(value || '').trim();
    return raw || AUTH_SHARED_SECRET;
}

// 获取/读取/解析：getAuthWindow的具体业务逻辑。
function getAuthWindow(timestampMs = Date.now()) {
    const numeric = Number(timestampMs);
    const safeMs = Number.isFinite(numeric) ? numeric : Date.now();
    return Math.floor(safeMs / AUTH_TIME_WINDOW_MS);
}

// 创建/初始化：buildAuthSignature的具体业务逻辑。
function buildAuthSignature({ secret, role, timeWindow, nonce, peerNonce = '' }) {
    return sha256Hex([normalizeAuthToken(secret), role, String(timeWindow), String(nonce || ''), String(peerNonce || '')].join('|'));
}

// 处理：encodeMessage的具体业务逻辑。
function encodeMessage(msgId, msgType, payload) {
    const dataBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(10);
    header.writeUInt32BE(msgId, 0);
    header.writeUInt16BE(msgType, 4);
    header.writeUInt32BE(dataBuffer.length, 6);
    return Buffer.concat([header, dataBuffer]);
}

// 获取/读取/解析：parseMessageFrames的具体业务逻辑。
function parseMessageFrames(buffer) {
    const frames = [];
    let remaining = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);

    while (remaining.length >= 10) {
        const msgId = remaining.readUInt32BE(0);
        const msgType = remaining.readUInt16BE(4);
        const dataLen = remaining.readUInt32BE(6);
        if (remaining.length < 10 + dataLen) {
            break;
        }

        const payloadBuffer = remaining.subarray(10, 10 + dataLen);
        frames.push({
            msgId,
            msgType,
            payloadBuffer,
            payloadText: payloadBuffer.toString('utf8'),
            payload: (() => {
                try {
                    return JSON.parse(payloadBuffer.toString('utf8'));
                } catch (_) {
                    return null;
                }
            })(),
        });
        remaining = remaining.subarray(10 + dataLen);
    }

    return { frames, remaining };
}

// TCP服务器配置（从配置文件导入）
class TcpClient {
    constructor(options = {}) {
        // 支持向后兼容：如果传入的是mainWindow，直接使用；否则从options中获取
        const hasMainWindow =
            typeof options === 'object'
            && options !== null
            && Object.prototype.hasOwnProperty.call(options, 'mainWindow');
        const mainWindow = hasMainWindow ? options.mainWindow : options;
        const onConnectionStatusChange =
            (options && typeof options === 'object') ? options.onConnectionStatusChange : undefined;
        const onServerMessage =
            (options && typeof options === 'object') ? options.onServerMessage : undefined;

        this.socket = null;
        this.connectPromise = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.connected = false;
        this.transportMode = 'disconnected';
        this.authenticated = false;
        this.authState = 'disconnected';
        this.authWindow = 0;
        this.clientNonce = '';
        this.serverNonce = '';
        this.heartbeatTimer = null;
        // 数据缓冲区，用于处理TCP流式数据
        this.receiveBuffer = Buffer.alloc(0);
        // 主窗口引用，用于IPC通信
        this.mainWindow = mainWindow;
        // 连接状态变更回调
        this.onConnectionStatusChange = onConnectionStatusChange;
        // 服务器消息回调
        this.onServerMessage = onServerMessage;
        // 最后已知的服务器状态
        this.lastKnownStatus = null;
        // HTTP降级状态
        this.httpFallbackActive = false;
        this.lastHttpFallbackAt = 0;
        this.httpFallbackTimer = null;
        this.runtimeServerBase = '';
    }

    _getAuthConfig() {
        const tcp = getTcpConfig() || {};
        const transport = tcp.transport || {};
        const authConfig = transport.auth || {};
        const windowMs = Math.max(
            1000,
            Number(authConfig.windowMs || authConfig.window_ms || process.env.TCP_AUTH_WINDOW_MS || AUTH_TIME_WINDOW_MS) || AUTH_TIME_WINDOW_MS
        );
        return {
            secret: normalizeAuthToken(authConfig.secret || authConfig.sharedSecret || process.env.TCP_SHARED_SECRET || AUTH_SHARED_SECRET),
            windowMs,
            skewWindows: Math.max(
                0,
                Number(authConfig.skewWindows || authConfig.skew_windows || process.env.TCP_AUTH_TIME_SKEW_WINDOWS || AUTH_TIME_SKEW_WINDOWS) || AUTH_TIME_SKEW_WINDOWS
            ),
        };
    }

    _buildAuthPayload({ role, localNonce, peerNonce, timeWindow, timestampMs }) {
        const authConfig = this._getAuthConfig();
        return {
            protocol: 'plain-shared-secret-v1',
            auth_mode: 'plaintext_shared_secret',
            role,
            secret_name: 'shared-secret',
            time_window: timeWindow,
            timestamp_ms: timestampMs,
            client_nonce: role === 'client' ? localNonce : peerNonce,
            server_nonce: role === 'server' ? localNonce : peerNonce,
            proof: buildAuthSignature({
                secret: authConfig.secret,
                role,
                timeWindow,
                nonce: localNonce,
                peerNonce,
            }),
        };
    }

    _verifyAuthPayload({ role, payload, expectedPeerNonce }) {
        if (!payload || typeof payload !== 'object') {
            return { ok: false, message: '暗号验证响应格式错误' };
        }

        const authConfig = this._getAuthConfig();
        const timeWindow = Number(payload.time_window);
        const localNonce = role === 'client' ? payload.client_nonce : payload.server_nonce;
        const peerNonce = role === 'client' ? payload.server_nonce : expectedPeerNonce;
        if (!Number.isFinite(timeWindow)) {
            return { ok: false, message: '暗号验证缺少时间窗口' };
        }

        const windows = [];
        const currentWindow = getAuthWindow();
        const skew = Math.max(0, Number(authConfig.skewWindows) || 0);
        for (let offset = -skew; offset <= skew; offset += 1) {
            windows.push(currentWindow + offset);
        }
        if (!windows.includes(timeWindow)) {
            return { ok: false, message: '暗号时间窗口不匹配' };
        }

        const expectedProof = buildAuthSignature({
            secret: authConfig.secret,
            role,
            timeWindow,
            nonce: localNonce,
            peerNonce,
        });

        if (String(payload.proof || '') !== expectedProof) {
            return { ok: false, message: '暗号校验失败' };
        }

        return { ok: true };
    }

    async _authenticateSocket(socket, { host, port }) {
        const authConfig = this._getAuthConfig();
        const msgId = ++this.messageId;
        const clientNonce = createAuthNonce();
        const clientTimeWindow = getAuthWindow();
        const requestPayload = this._buildAuthPayload({
            role: 'client',
            localNonce: clientNonce,
            peerNonce: '',
            timeWindow: clientTimeWindow,
            timestampMs: Date.now(),
        });

        console.log(`[TCP] 正在执行明文暗号验证: ${host}:${port}`);
        const responsePromise = this._waitForAuthResponse(socket, msgId, authConfig.windowMs + 3000);
        socket.write(encodeMessage(msgId, MSG_TYPE_AUTH_HELLO_REQ, requestPayload), (err) => {
            if (err) {
                console.error('[TCP] 暗号请求发送失败:', err.message);
            }
        });

        const response = await responsePromise;
        const validation = this._verifyAuthPayload({
            role: 'server',
            payload: response,
            expectedPeerNonce: clientNonce,
        });
        if (!validation.ok) {
            throw new Error(validation.message || '服务器暗号校验失败');
        }

        this.authenticated = true;
        this.authState = 'authenticated';
        this.clientNonce = clientNonce;
        this.serverNonce = String(response.server_nonce || '');
        this.authWindow = Number(response.time_window) || clientTimeWindow;
        console.log('[TCP] 明文暗号验证通过');
    }

    _waitForAuthResponse(socket, requestMsgId, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let buffer = Buffer.alloc(0);
            const timeoutHandle = setTimeout(() => {
                cleanup();
                reject(new Error(`暗号验证超时 (${timeoutMs}ms)`));
            }, timeoutMs);

// 停止/关闭/清理：cleanup的具体业务逻辑。
            const cleanup = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutHandle);
                socket.off('data', onData);
                socket.off('error', onError);
                socket.off('close', onClose);
            };

// 处理：finish的具体业务逻辑。
            const finish = (err, payload) => {
                if (settled) return;
                cleanup();
                if (err) {
                    reject(err);
                } else {
                    resolve(payload);
                }
            };

// 监听/绑定：onData的具体业务逻辑。
            const onData = (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                const { frames, remaining } = parseMessageFrames(buffer);
                buffer = remaining;
                for (const frame of frames) {
                    if (frame.msgId !== requestMsgId || frame.msgType !== MSG_TYPE_AUTH_HELLO_RESP) {
                        finish(new Error(`收到非暗号响应消息: ${frame.msgType}`));
                        return;
                    }
                    if (!frame.payload || typeof frame.payload !== 'object') {
                        finish(new Error('暗号响应格式错误'));
                        return;
                    }
                    if (frame.payload.ok === false) {
                        finish(new Error(frame.payload.message || '暗号验证失败'));
                        return;
                    }
                    finish(null, frame.payload);
                    return;
                }
            };

// 监听/绑定：onError的具体业务逻辑。
            const onError = (err) => {
                finish(err || new Error('暗号验证连接失败'));
            };

// 监听/绑定：onClose的具体业务逻辑。
            const onClose = () => {
                finish(new Error('暗号验证期间连接已关闭'));
            };

            socket.on('data', onData);
            socket.once('error', onError);
            socket.once('close', onClose);
        });
    }

    /**
     * 网络连接诊断
     * @returns {Promise<Object>} 诊断结果
     */
    async diagnoseConnection() {
        if (this._isHttpCompatMode()) {
            console.log('[诊断] 当前处于网络兼容模式，跳过TCP连接诊断');
            return {
                tcpConnection: false,
                tcpConnectionTime: 0,
                tcpError: null,
                serverResponse: false,
                serverResponseTime: 0,
                serverError: null,
                recommendations: ['当前处于网络兼容模式，已跳过TCP连接诊断'],
                transportMode: 'http',
                compatMode: true,
            };
        }

        const results = {
            tcpConnection: false,
            tcpConnectionTime: 0,
            tcpError: null,
            serverResponse: false,
            serverResponseTime: 0,
            serverError: null,
            recommendations: []
        };

        console.log('[诊断] 开始网络连接诊断...');

        // 1. 测试明文暗号连接
        let diagnosticSocket = null;
        try {
            const startTime = Date.now();
            const tcp = getTcpConfig();
            diagnosticSocket = await this._connectPlainOnce({
                host: tcp.host,
                port: tcp.port,
            });
            await this._authenticateSocket(diagnosticSocket, {
                host: tcp.host,
                port: tcp.port,
            });
            results.tcpConnection = true;
            results.tcpConnectionTime = Date.now() - startTime;
            console.log(`[诊断] 明文暗号连接成功，耗时: ${results.tcpConnectionTime}ms`);
            try { diagnosticSocket?.destroy(); } catch (_) {}
            this._resetConnectionAuthState();
        } catch (error) {
            try { diagnosticSocket?.destroy(); } catch (_) {}
            results.tcpError = error.message;
            results.recommendations.push('TCP明文暗号连接失败，可能的原因：暗号不一致、时间不同步、防火墙阻止、服务器宕机');
        }

        // 2. 如果连接成功，测试服务器响应
        if (results.tcpConnection) {
            diagnosticSocket = null;
            try {
                const startTime = Date.now();
                const tcp = getTcpConfig();
                diagnosticSocket = await this._connectPlainOnce({
                    host: tcp.host,
                    port: tcp.port,
                });
                await this._authenticateSocket(diagnosticSocket, {
                    host: tcp.host,
                    port: tcp.port,
                });
                results.serverResponse = true;
                results.serverResponseTime = Date.now() - startTime;
                console.log(`[诊断] 服务器明文暗号响应正常，耗时: ${results.serverResponseTime}ms`);
                try { diagnosticSocket?.destroy(); } catch (_) {}
                this._resetConnectionAuthState();
            } catch (error) {
                try { diagnosticSocket?.destroy(); } catch (_) {}
                results.serverError = error.message;
                results.recommendations.push('服务器暗号响应超时，可能的原因：网络延迟高、时间窗不同步、服务器负载重');
            }
        }

        // 生成建议
        if (results.tcpConnectionTime > 3000) {
            results.recommendations.push('TCP明文暗号连接耗时较长，建议检查网络质量');
        }

        if (results.tcpError && results.tcpError.includes('ECONNREFUSED')) {
            results.recommendations.push('连接被拒绝，可能是服务器未启动或端口被防火墙阻止');
        }

        if (results.tcpError && results.tcpError.includes('ENOTFOUND')) {
            results.recommendations.push('域名解析失败，请检查DNS设置或网络连接');
        }

        if (results.tcpError && results.tcpError.includes('ETIMEDOUT')) {
            results.recommendations.push('连接超时，建议尝试更换网络环境或联系技术支持');
        }

        console.log('[诊断] 网络连接诊断完成');
        return results;
    }

    /**
     * 连接到TCP服务器
     */
    connect() {
        if (this.connected) {
            return Promise.resolve();
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        if (this._isHttpCompatMode()) {
            this.connectPromise = Promise.resolve(true).then(() => {
                this.transportMode = 'http';
                this.connected = false;
                this.authenticated = false;
                this._markHttpFallback('网络兼容模式已启用');
                return true;
            }).finally(() => {
                this.connectPromise = null;
            });
            return this.connectPromise;
        }

        this.connectPromise = this._connectWithFallback().finally(() => {
            this.connectPromise = null;
        });
        return this.connectPromise;
    }

    _getConnectionConfig() {
        const tcp = getTcpConfig() || {};
        const transport = tcp.transport || {};
        return {
            host: tcp.host || '127.0.0.1',
            port: Number(tcp.port) || 58113,
            transport,
        };
    }

    _isHttpCompatMode() {
        return isHttpCompatModeEnabled() || String(this._getConnectionConfig().transport?.preferred || '').toLowerCase() === 'http';
    }

    _clearSocketState(socket = this.socket) {
        if (!socket) return;
        try {
            socket.removeAllListeners('data');
            socket.removeAllListeners('close');
            socket.removeAllListeners('error');
        } catch (_) {}
    }

    _resetConnectionAuthState() {
        this.authenticated = false;
        this.authState = 'disconnected';
        this.clientNonce = '';
        this.serverNonce = '';
        this.authWindow = 0;
    }

    _destroySocket(socket = this.socket) {
        if (!socket) return;
        try {
            this._clearSocketState(socket);
            socket.destroy();
        } catch (_) {}
    }

    _bindActiveSocket(socket, mode) {
        this.socket = socket;
        this.connected = true;
        this.transportMode = mode;
        this.authenticated = true;
        this.authState = 'authenticated';
        this._clearHttpFallback();
        this.startHeartbeat();
        this.lastKnownStatus = null;

        socket.on('data', (data) => {
            if (this.socket === socket) {
                this.handleIncomingData(data);
            }
        });

        socket.on('close', () => {
            if (this.socket !== socket) return;
            console.log(`[TCP:${mode.toUpperCase()}] 连接已断开`);
            this.connected = false;
            this.stopHeartbeat();
            this.receiveBuffer = Buffer.alloc(0);
            this._rejectAllPendingRequests('TCP连接已断开');
            this.socket = null;
            this.transportMode = 'disconnected';
            this._resetConnectionAuthState();
            this._markHttpFallback();
        });

        socket.on('error', (err) => {
            if (this.socket !== socket) return;
            console.error(`[TCP:${mode.toUpperCase()}] 连接错误:`, err.message);
            this.connected = false;
            this.stopHeartbeat();
            this._rejectAllPendingRequests(`TCP连接错误: ${err.message}`);
            this.socket = null;
            this.transportMode = 'disconnected';
            this._resetConnectionAuthState();
            this._markHttpFallback();
        });
    }

    _connectPlainOnce({ host, port }) {
        return new Promise((resolve, reject) => {
            const timeoutMs = NETWORK_DIAG_CONFIG.CONNECTION_TIMEOUT;
            let socket = null;
            let settled = false;
            let timeoutHandle = null;

// 处理：finish的具体业务逻辑。
            const finish = (err) => {
                if (settled) return;
                settled = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = null;
                }
                if (err) {
                    this._clearSocketState(socket);
                    try { socket?.destroy(); } catch (_) {}
                    reject(err);
                } else {
                    resolve(socket);
                }
            };

            const connectOptions = {
                host,
                port,
            };

            console.log(`[TCP] 尝试明文TCP连接: ${host}:${port}`);
            socket = net.createConnection(connectOptions, () => finish());

            socket.setNoDelay(true);
            socket.setKeepAlive(true, 30000);

            socket.once('error', (err) => {
                finish(err || new Error('TCP连接失败'));
            });

            socket.once('close', () => {
                if (!settled) {
                    finish(new Error('TCP连接已关闭'));
                }
            });

            timeoutHandle = setTimeout(() => {
                finish(new Error(`连接超时 (${timeoutMs}ms)`));
            }, timeoutMs);
        });
    }

    async _connectWithFallback() {
        if (this.onConnectionStatusChange) {
            this.onConnectionStatusChange('connecting', '服务器连接中...');
        }

        const { host, port } = this._getConnectionConfig();
        console.log(`[TCP] 连接目标地址: ${host}:${port}`);

        let lastError = null;
        console.log('[TCP] 传输层使用明文TCP，先执行暗号验证');

        try {
            const socket = await this._connectPlainOnce({ host, port });
            await this._authenticateSocket(socket, { host, port });
            const localAddress = socket?.localAddress || 'unknown';
            const localPort = socket?.localPort || 'unknown';
            const remoteAddress = socket?.remoteAddress || host || 'unknown';
            const remotePort = socket?.remotePort || port || 'unknown';
            console.log('[TCP] 已连接到服务器 (TCP明文+暗号)');
            console.log(`[TCP] 连接详情: 本地 ${localAddress}:${localPort} -> 远端 ${remoteAddress}:${remotePort}`);
            this._bindActiveSocket(socket, 'tcp');

            if (this.onConnectionStatusChange) {
                this.onConnectionStatusChange('connected', '网络状态良好（明文暗号）');
            }
            return;
        } catch (err) {
            lastError = err;
            console.warn('[TCP] 明文暗号连接失败:', err?.message || err);
            this._destroySocket();
        }

        this.transportMode = 'http';
        this._markHttpFallback(lastError?.message || '');
        throw lastError || new Error('连接失败');
    }

    _markHttpFallback(_reason = '') {
        try {
            this.lastHttpFallbackAt = Date.now();
            this.httpFallbackActive = true;
            if (this.httpFallbackTimer) {
                clearTimeout(this.httpFallbackTimer);
            }
            // 15秒内保持“HTTP模式”状态，若持续发生会自动续期
            this.httpFallbackTimer = setTimeout(() => {
                this.httpFallbackActive = false;
                this.httpFallbackTimer = null;
            }, 15000);

            if (this.onConnectionStatusChange) {
                this.onConnectionStatusChange('http', '网络兼容模式');
            }
        } catch (_) {}
    }

    _clearHttpFallback() {
        this.httpFallbackActive = false;
        if (this.httpFallbackTimer) {
            clearTimeout(this.httpFallbackTimer);
            this.httpFallbackTimer = null;
        }
    }

    _shouldPreferHttpFallback() {
        return !!(
            this._isHttpCompatMode()
            || this.httpFallbackActive
        );
    }

    _normalizeRuntimeServerBase(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        try {
            const url = new URL(text.includes('://') ? text : `http://${text}`);
            return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
        } catch (_) {
            return text.replace(/\/+$/, '');
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
            source.address,
            source.result?.serverBase,
            source.result?.server_base,
            source.result?.address_HTTP,
            source.result?.addressHttp,
            source.result?.address_http,
            source.result?.address,
            source.data?.serverBase,
            source.data?.server_base,
            source.data?.address_HTTP,
            source.data?.addressHttp,
            source.data?.address_http,
            source.data?.address,
            source.payload?.serverBase,
            source.payload?.server_base,
            source.payload?.address_HTTP,
            source.payload?.addressHttp,
            source.payload?.address_http,
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

    _rejectAllPendingRequests(errorMessage = '连接已断开') {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(errorMessage));
        }
        this.pendingRequests.clear();
    }


    /**
     * 发送消息到服务器
     */
    sendMessage(msgType, data, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                console.error('[TCP] 未连接到服务器，无法发送消息');
                reject(new Error('未连接到服务器'));
                return;
            }
            if (!this.authenticated) {
                console.error('[TCP] 尚未完成明文暗号验证，无法发送消息');
                reject(new Error('尚未完成暗号验证'));
                return;
            }

            const timeoutMs = Number(options.timeoutMs) > 0
                ? Number(options.timeoutMs)
                : NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT;
            const msgId = ++this.messageId;
            const message = encodeMessage(msgId, msgType, data);

            // 设置请求超时
            const timeout = setTimeout(() => {
                console.error(`[TCP] 请求超时 - msgId:${msgId}, msgType:${msgType.toString(16)}`);
                this.pendingRequests.delete(msgId);
                reject(new Error(`请求超时 (${timeoutMs}ms)`));
            }, timeoutMs);

            // 存储待处理的请求
            this.pendingRequests.set(msgId, { resolve, reject, timeout });

            // 发送消息
            this.socket.write(message, (err) => {
                if (err) {
                    console.error(`[TCP] 发送消息失败:`, err.message);
                    clearTimeout(timeout);
                    this.pendingRequests.delete(msgId);
                    reject(err);
                }
            });
        });
    }

    /**
     * 处理接收到的TCP数据
     */
    handleIncomingData(data) {
        return dispatchIncomingData(this, data, {
            serverMessageType: MSG_TYPE_SERVER_MESSAGE,
            proxyStatusRespType: MSG_TYPE_GET_PROXY_STATUS_RESP,
            deps: { app, fs, path, getCoreDir, getStorePath },
        });
    }

    /**
     * 处理缓冲区中的数据，解析完整的消息
     */
    processBuffer() {
        return dispatchProcessBuffer(this, {
            serverMessageType: MSG_TYPE_SERVER_MESSAGE,
            proxyStatusRespType: MSG_TYPE_GET_PROXY_STATUS_RESP,
            deps: { app, fs, path, getCoreDir, getStorePath },
        });
    }

    /**
     * 处理完整的消息
     */
    handleCompleteMessage(data) {
        return dispatchCompleteMessage(this, data, {
            serverMessageType: MSG_TYPE_SERVER_MESSAGE,
            proxyStatusRespType: MSG_TYPE_GET_PROXY_STATUS_RESP,
            deps: { app, fs, path, getCoreDir, getStorePath },
        });
    }

    /**
     * 处理服务器推送的消息
     */
    handleServerMessage(messageData) {
        return dispatchServerMessage(this, messageData, {
            serverMessageType: MSG_TYPE_SERVER_MESSAGE,
            proxyStatusRespType: MSG_TYPE_GET_PROXY_STATUS_RESP,
            deps: { app, fs, path, getCoreDir, getStorePath },
        });
    }

    /**
     * 处理获取代理状态的请求
     */
    async handleGetProxyStatusRequest(messageData) {
        return dispatchProxyStatusRequest(this, messageData, {
            proxyStatusRespType: MSG_TYPE_GET_PROXY_STATUS_RESP,
            deps: { app, fs, path, getCoreDir, getStorePath },
        });
    }

    /**
     * 处理服务器推送账号cookie信息
     */
    async handleAccountCookiePush(messageData) {
        return dispatchAccountCookiePush(this, messageData);
    }

    /**
     * 从文件系统获取真实的代理状态信息
     */
    async getRealProxyStatus() {
        return dispatchGetRealProxyStatus({ app, fs, path, getCoreDir, getStorePath });
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

    async _executeTransportRequest({
        actionLabel,
        msgType,
        tcpData = {},
        tcpOptions = {},
        httpPath,
        httpMethod = 'POST',
        httpData = tcpData,
        httpTimeoutMs = NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT,
    }) {
        if (this._shouldPreferHttpFallback()) {
            this._markHttpFallback('HTTP降级期内直接使用HTTP');
            const httpResult = await this._executeHttpRequest({
                path: httpPath,
                method: httpMethod,
                data: httpData,
                timeoutMs: httpTimeoutMs,
            });
            this._syncRuntimeServerBase(httpResult);
            if (httpResult && typeof httpResult === 'object') {
                return {
                    ...httpResult,
                    transportMode: 'http',
                    transportFallbackReason: this.httpFallbackActive
                        ? 'TCP失败后的HTTP降级冷却期'
                        : '网络兼容模式已启用',
                };
            }
            return httpResult;
        }

        return executeWithFallback({
            actionLabel,
            tcpRequest: async () => {
                await this.connect();
                const tcpResult = await this.sendMessage(msgType, tcpData, tcpOptions);
                this._syncRuntimeServerBase(tcpResult);
                return tcpResult;
            },
            httpRequest: async () => {
                const httpResult = await this._executeHttpRequest({
                    path: httpPath,
                    method: httpMethod,
                    data: httpData,
                    timeoutMs: httpTimeoutMs,
                });
                this._syncRuntimeServerBase(httpResult);
                return httpResult;
            },
            onFallback: (error) => {
                console.warn(`[TCP] ${actionLabel} TCP失败，尝试HTTP降级:`, error?.message || error);
                this._markHttpFallback(error?.message || '');
            },
        });
    }

    /**
     * 验证卡密
     */
    async validateKey(key, deviceId) {
        return this._executeTransportRequest({
            actionLabel: 'validateKey',
            msgType: MSG_TYPE_VALIDATE_KEY_REQ,
            tcpData: { key, device_id: deviceId },
            httpPath: '/api/validate_key'
        });
    }

    /**
     * 获取Cookie
     */
    async fetchCookie(key, platform, deviceId) {
        return this._executeTransportRequest({
            actionLabel: 'fetchCookie',
            msgType: MSG_TYPE_FETCH_COOKIE_REQ,
            tcpData: { key, platform, device_id: deviceId },
            httpPath: '/api/fetch_cookie'
        });
    }

    /**
     * 自助解绑设备
     */
    async unbindDevice(key, deviceId) {
        const payload = {
            key,
            device_id: deviceId,
            deviceId,
        };
        return this._executeTransportRequest({
            actionLabel: 'unbindDevice',
            msgType: MSG_TYPE_UNBIND_DEVICE_REQ,
            tcpData: payload,
            httpPath: '/api/unbind_device'
        });
    }

    /**
     * 获取客户端配置
     * @param {string} key - 卡密
     * @param {string} deviceId - 设备号
     */
    async getClientConfig(key, deviceId) {
        const tcpData = { key, device_id: deviceId };
        const qs = new URLSearchParams({
            key: String(key || ''),
            device_id: String(deviceId || ''),
        }).toString();

        const requestTimeoutMs = Math.max(NETWORK_DIAG_CONFIG.REQUEST_TIMEOUT * 4, 20000);
        const httpTimeoutMs = requestTimeoutMs;
// 处理：executeHttpFallback的具体业务逻辑。
        const executeHttpFallback = async () => {
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
                    data: tcpData,
                },
            ];

            let lastError = null;
            for (const attempt of attempts) {
                try {
                    console.log(`[TCP] getClientConfig 尝试${attempt.label}: ${attempt.path}`);
                    return await this._executeHttpRequest({
                        path: attempt.path,
                        method: attempt.method,
                        data: attempt.data,
                        timeoutMs: httpTimeoutMs,
                    });
                } catch (error) {
                    lastError = error;
                    console.warn(`[TCP] getClientConfig ${attempt.label}失败:`, error?.message || error);
                }
            }

            throw lastError || new Error('HTTP获取客户端配置失败');
        };

        if (this._shouldPreferHttpFallback()) {
            this._markHttpFallback('HTTP降级期内直接使用HTTP');
            const result = await executeHttpFallback().catch((error) => ({
                ok: false,
                status: 0,
                error: error?.message || String(error),
            }));
            return {
                ...result,
                transportMode: 'http',
                transportFallbackReason: this.httpFallbackActive
                    ? 'TCP失败后的HTTP降级冷却期'
                    : '网络兼容模式已启用',
            };
        }

        const result = await (async () => {
            try {
                await this.connect();
                return await this.sendMessage(MSG_TYPE_CLIENT_CONFIG_REQ, tcpData, {
                    timeoutMs: requestTimeoutMs,
                });
            } catch (error) {
                console.warn('[TCP] getClientConfig TCP失败，尝试HTTP降级:', error?.message || error);
                this._markHttpFallback(error?.message || '');
                return executeHttpFallback();
            }
        })().catch((error) => ({
            ok: false,
            status: 0,
            error: error?.message || String(error),
        }));

        console.log('[TCP] getClientConfig 结果摘要:', JSON.stringify({
            ok: !!result?.ok,
            status: result?.status || '',
            state: result?.state || '',
            message: result?.message || '',
            error: result?.error || '',
            keys: result && typeof result === 'object' ? Object.keys(result).slice(0, 16) : [],
        }, null, 2));

        if (!result || result.ok !== true) {
            console.warn('[TCP] getClientConfig 返回失败对象:', JSON.stringify(result || {}, null, 2));
        }

        return result;
    }

    /**
     * 获取代理状态和流量信息
     */
    async getProxyStatus() {
        return this._executeTransportRequest({
            actionLabel: 'getProxyStatus',
            msgType: MSG_TYPE_GET_PROXY_STATUS_REQ,
            tcpData: {},
            httpPath: '/api/get_proxy_status',
            httpMethod: 'GET'
        });
    }

    async getPacConfig(key, deviceId) {
        return this._executeTransportRequest({
            actionLabel: 'getPacConfig',
            msgType: MSG_TYPE_GET_PAC_CONFIG_REQ,
            tcpData: { key, device_id: deviceId },
            httpPath: '/api/get_pac_config'
        });
    }

    async controlProxy(key, deviceId, action) {
        return this._executeTransportRequest({
            actionLabel: 'controlProxy',
            msgType: MSG_TYPE_CONTROL_PROXY_REQ,
            tcpData: { key, device_id: deviceId, action },
            httpPath: '/api/control_proxy'
        });
    }

    /**
     * 上报账号积分
     * @param {string} account - 账号邮箱
     * @param {number} score - 积分数量
     */
    async reportAccountScore(account, score) {
        try {
            console.log('[TCP] reportAccountScore: 开始上报积分');
            console.log('[TCP] reportAccountScore: 账号:', account, '积分:', score);

            if (this._isHttpCompatMode()) {
                console.warn('[TCP] reportAccountScore 在网络兼容模式下跳过TCP上报');
                return {
                    ok: false,
                    status: 0,
                    transportMode: 'http',
                    message: '网络兼容模式下不使用TCP连接，积分上报未执行',
                };
            }

            // 构建请求数据
            const requestData = {
                type: 'report_score',
                data: {
                    account: account,
                    score: score
                }
            };

            await this.connect();
            const result = await this.sendMessage(MSG_TYPE_REPORT_SCORE_REQ, requestData);

            console.log('[TCP] reportAccountScore: 服务器响应:', result);
            return result;

        } catch (error) {
            console.error('[TCP] reportAccountScore: 上报积分失败:', error.message);
            throw new Error(`上报积分失败: ${error.message}`);
        }
    }

    /**
     * 启动心跳
     */
    startHeartbeat() {
        this.stopHeartbeat(); // 确保没有重复的心跳
        this.heartbeatTimer = setInterval(async () => {
            try {
                await this.sendMessage(MSG_TYPE_HEARTBEAT, {});
            } catch (err) {
                console.warn('[TCP] 心跳失败:', err.message);
            }
        }, 30000); // 每30秒发送一次心跳
    }

    /**
     * 停止心跳
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * 关闭连接
     */
    close() {
        this.stopHeartbeat();
        this._clearHttpFallback();
        this.connectPromise = null;
        this.transportMode = 'disconnected';
        if (this.socket) {
            const socket = this.socket;
            this.socket = null;
            this._clearSocketState(socket);
            try { socket.destroy(); } catch (_) {}
        }
        this.connected = false;
        // 清空接收缓冲区
        this.receiveBuffer = Buffer.alloc(0);

        // 取消所有待处理的请求
        this._rejectAllPendingRequests('连接已关闭');
    }
}

// 创建全局TCP客户端实例
let globalTcpClient = null;
let globalCleanupRegistered = false;

// 监听/绑定：registerGlobalCleanupHandlers的具体业务逻辑。
function registerGlobalCleanupHandlers() {
    if (globalCleanupRegistered) {
        return;
    }

    process.on('exit', () => {
        if (globalTcpClient) {
            globalTcpClient.close();
        }
    });

    process.on('uncaughtException', () => {
        if (globalTcpClient) {
            globalTcpClient.close();
        }
    });

    globalCleanupRegistered = true;
}

// 设置/更新/持久化：updateGlobalTcpClientOptions的具体业务逻辑。
function updateGlobalTcpClientOptions(opts = {}) {
    if (!globalTcpClient || !opts || typeof opts !== 'object') {
        return;
    }

    if (opts.onConnectionStatusChange) {
        globalTcpClient.onConnectionStatusChange = opts.onConnectionStatusChange;
    }
    if (opts.onServerMessage) {
        globalTcpClient.onServerMessage = opts.onServerMessage;
    }
    if (Object.prototype.hasOwnProperty.call(opts, 'mainWindow')) {
        globalTcpClient.mainWindow = opts.mainWindow;
    }
}

// 校验/保护：ensureGlobalTcpClient的具体业务逻辑。
function ensureGlobalTcpClient(options = {}) {
// 处理：opts的具体业务逻辑。
    const opts = (options && typeof options === 'object') ? options : { mainWindow: options };
    if (!globalTcpClient) {
        globalTcpClient = new TcpClient(opts);
        registerGlobalCleanupHandlers();
    }

    updateGlobalTcpClientOptions(opts);
    return globalTcpClient;
}

// 创建/初始化：createTcpClient的具体业务逻辑。
function createTcpClient(options = {}) {
    return ensureGlobalTcpClient(options);
}

// 处理：markGlobalHttpFallback的具体业务逻辑。
function markGlobalHttpFallback(_reason = '') {
    if (!globalTcpClient) return;
    if (typeof globalTcpClient._markHttpFallback === 'function') {
        globalTcpClient._markHttpFallback();
    } else {
        // 兜底：仅标记状态
        globalTcpClient.httpFallbackActive = true;
        globalTcpClient.lastHttpFallbackAt = Date.now();
        if (globalTcpClient.onConnectionStatusChange) {
            globalTcpClient.onConnectionStatusChange('http', '网络兼容模式');
        }
    }
}

// 设置/更新/持久化：writeStoreValue的具体业务逻辑。
async function writeStoreValue(key, value) {
    // 兼容旧调用点：当前改为只在运行时使用，不再写入本地。
    return { key, value };
}

/**
 * 初始化并连接到TCP服务器（像微信一样建立持久连接）
 * @param {function} onConnectionStatusChange - 连接状态变更回调函数
 * @param {function} onServerMessage - 服务器消息处理回调函数
 * @returns {Promise<boolean>} 连接是否成功
 */
function initializeTcpConnection(onConnectionStatusChange = null, onServerMessage = null) {
    return new Promise(async (resolve) => {
        try {
            globalTcpClient = ensureGlobalTcpClient({
                onConnectionStatusChange,
                onServerMessage
            });

            const isHttpCompatMode = !!(globalTcpClient && (
                globalTcpClient.httpFallbackActive
                || String(globalTcpClient.transportMode || '').toLowerCase() === 'http'
                || globalTcpClient._isHttpCompatMode?.()
            ));

            if (isHttpCompatMode) {
                console.log('[TCP] 当前处于网络兼容模式，未建立TCP持久连接');
                globalTcpClient.transportMode = 'http';
                globalTcpClient.connected = false;
                globalTcpClient.authenticated = false;
                if (typeof globalTcpClient._markHttpFallback === 'function') {
                    globalTcpClient._markHttpFallback('网络兼容模式已启用');
                } else if (onConnectionStatusChange) {
                    onConnectionStatusChange('http', '网络兼容模式');
                }
                resolve(true);
                return;
            }

            // 如果已经连接，直接返回成功
            if (globalTcpClient.connected) {
                console.log('[TCP] 连接已存在，跳过连接步骤');
                // 通知连接状态：已连接
                if (onConnectionStatusChange) {
                    onConnectionStatusChange('connected', '网络状态良好');
                }
                resolve(true);
                return;
            }

            // 建立连接
            console.log('[TCP] 正在连接到服务器...');
            await globalTcpClient.connect();
            console.log('[TCP] 成功连接到服务器，保持持久连接');
            resolve(true);

        } catch (error) {
            console.error('[TCP] 连接服务器失败:', error.message);
            resolve(false);
        }
    });
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

    const serverBase = String(
        input.address_HTTP
        ?? input.addressHttp
        ?? input.address_http
        ?? input.serverBase
        ?? input.server_base
        ?? input.address
        ?? ''
    ).trim();

    const tcpAddress = String(
        input.address_TCP
        ?? input.addressTcp
        ?? input.address_tcp
        ?? ''
    ).trim();

    return {
        platformName,
        platform_name: platformName,
        allowedPlatforms: resolvedAllowedPlatforms,
        allowed_platforms: resolvedAllowedPlatforms,
        targetUrl: String(input.targetUrl ?? input.target_url ?? '').trim(),
        tutorialUrl: String(input.tutorialUrl ?? input.tutorial_url ?? '').trim(),
        serverBase,
        server_base: serverBase,
        address_HTTP: serverBase,
        addressHttp: serverBase,
        address_TCP: tcpAddress,
        addressTcp: tcpAddress,
    };
}

module.exports = {
    createTcpClient,
    initializeTcpConnection,
    normalizeValidationRuntimeConfig,
};
