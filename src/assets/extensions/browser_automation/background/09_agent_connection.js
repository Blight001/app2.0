// AI-FREE 本机桥接会话状态机。
// 只有软件端返回受认证的 connectionId/token 后才进入 connected；
// 同一个 poll 同时承担心跳与任务拉取，失效后由上层统一重建会话。

class AgentBridgeRequestError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.name = 'AgentBridgeRequestError';
        this.status = Number(status || 0);
    }
}

class LocalAutomationBridgeSocket {
    constructor(baseUrl) {
        this.baseUrl = trimUrl(baseUrl);
        this.connected = false;
        this.active = false;
        this.connectionId = '';
        this.token = '';
        this.sessionId = crypto.randomUUID();
        this.listeners = new Map();
        this.pollTimer = null;
        this.pollIntervalMs = 650;
        this.io = { reconnection() {} };
    }

    on(event, handler) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(handler);
    }

    fire(event, payload) {
        for (const handler of this.listeners.get(event) || []) {
            try { handler(payload); } catch (_error) {}
        }
    }

    removeAllListeners() {
        this.listeners.clear();
    }

    async request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        headers[APP_BROWSER_PID_HEADER] = String(await getAgentBrowserProcessId());
        if (this.token) headers['X-Bridge-Token'] = this.token;
        if (options.body != null) headers['Content-Type'] = 'application/json';
        const suffix = this.connectionId
            ? `${path.includes('?') ? '&' : '?'}connection_id=${encodeURIComponent(this.connectionId)}`
            : '';
        const response = await fetch(`${this.baseUrl}${path}${suffix}`, {
            ...options,
            headers,
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
                ? AbortSignal.timeout(10000)
                : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
            throw new AgentBridgeRequestError(
                data.message || `本机桥接 HTTP ${response.status}`,
                response.status
            );
        }
        return data;
    }

    async connect(enrollment) {
        if (this.connected || this.active) return;
        this.active = true;
        this.clearSession();
        try {
            const response = await this.request('/v1/register', {
                method: 'POST',
                body: JSON.stringify({
                    ...enrollment,
                    instanceId: enrollment.id,
                    sessionId: this.sessionId,
                    protocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION
                })
            });
            this.acceptRegistration(response);
            this.fire('connect');
            this.fire(DEVICE_ENROLLED, { id: this.connectionId, aiConfigId: null });
            this.schedulePoll(0);
        } catch (error) {
            this.clearSession();
            this.fire('connect_error', error);
            throw error;
        } finally {
            this.active = false;
        }
    }

    acceptRegistration(response) {
        const protocolVersion = Number(response?.protocolVersion || AGENT_BRIDGE_PROTOCOL_VERSION);
        if (protocolVersion !== AGENT_BRIDGE_PROTOCOL_VERSION) {
            throw new AgentBridgeRequestError(`软件桥接协议版本不兼容: ${protocolVersion}`);
        }
        const connectionId = String(response?.connectionId || '');
        const token = String(response?.token || '');
        if (!connectionId || !token) {
            throw new AgentBridgeRequestError('软件桥接注册响应缺少会话凭据');
        }
        this.connectionId = connectionId;
        this.token = token;
        this.pollIntervalMs = Math.max(250, Number(response.pollIntervalMs) || 650);
        this.connected = true;
    }

    clearSession() {
        this.connected = false;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.connectionId = '';
        this.token = '';
    }

    schedulePoll(delay = this.pollIntervalMs) {
        if (!this.connected) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => { void this.poll(); }, delay);
    }

    async poll() {
        if (!this.connected || !this.connectionId) return;
        try {
            const response = await this.requestPoll();
            for (const task of response.tasks || []) this.fire('task:dispatch', task);
            this.schedulePoll(Number(response.nextPollMs) || this.pollIntervalMs);
        } catch (error) {
            const reason = error?.status === 401
                ? '软件桥接会话已失效，正在重新注册'
                : (error?.message || '本机桥接已断开');
            this.clearSession();
            this.fire('disconnect', reason);
        }
    }

    async requestPoll() {
        try {
            return await this.request('/v1/poll', { method: 'POST' });
        } catch (error) {
            if (error?.status !== 404) throw error;
            return this.request('/v1/tasks');
        }
    }

    disconnect() {
        const wasConnected = this.connected;
        const connectionId = this.connectionId;
        const token = this.token;
        this.clearSession();
        if (connectionId && token) this.notifyDisconnect(connectionId, token);
        if (wasConnected) this.fire('disconnect', 'client disconnect');
    }

    notifyDisconnect(connectionId, token) {
        const url = `${this.baseUrl}/v1/disconnect?connection_id=${encodeURIComponent(connectionId)}`;
        void fetch(url, {
            method: 'POST',
            headers: {
                'X-Bridge-Token': token,
                [APP_BROWSER_PID_HEADER]: String(agentBrowserProcessId || 0)
            },
            keepalive: true
        }).catch(() => {});
    }

    emit(event, payload) {
        if (event === 'task:result') {
            void this.sendOutcome({ ...payload, success: payload?.success !== false });
        } else if (event === 'task:error') {
            void this.sendOutcome({ ...payload, success: false });
        } else if (event === 'task:progress') {
            void this.postProgress(payload);
        }
    }

    async sendOutcome(payload) {
        if (!this.connectionId) return;
        await this.request('/v1/task-result', {
            method: 'POST',
            body: JSON.stringify(payload)
        }).catch(() => {});
    }

    async postProgress(payload) {
        if (!this.connectionId) return;
        await this.request('/v1/task-progress', {
            method: 'POST',
            body: JSON.stringify(payload)
        }).catch(() => {});
    }
}
