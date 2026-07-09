(() => {
  // src/popup/state.ts
  var state = {
    currentTheme: "dark",
    currentStatus: "disconnected",
    // Server-side bound AI for this device (from device:registered). null = none
    // assigned yet → status indicator shows yellow instead of green.
    boundAiConfigId: null,
    hasAiKey: false,
    // Assigned in initPort(); listeners that read it only fire after init.
    port: void 0,
    serverUrl: "",
    offlineMode: false,
    localModel: "",
    auth: { token: "", account: "", password: "", rememberLogin: false, userId: null, userName: "", avatar: "" },
    // Cached data URL for the current account's avatar (hydrated from storage).
    avatarDataUrl: "",
    members: [],
    // ── Tool-call statistics (this popup session) ──
    stats: { total: 0, running: 0, success: 0, failed: 0 },
    // ── MCP tool page view state ──
    // Currently opened tool name in the detail view, or null for the list.
    openToolName: null,
    // Pending mcp:test requestId → resolver, so the detail view can await a run.
    pendingTests: /* @__PURE__ */ new Map()
  };

  // src/popup/dom.ts
  var $ = (id) => document.getElementById(id);
  var statusDot = $("status-dot");
  var statusLabel = $("status-label");
  var statusPill = $("status-pill");
  var themeToggle = $("theme-toggle");
  var settingsBtn = $("settings-btn");
  var offlineChatBtn = $("offline-chat-btn");
  var userChip = $("user-chip");
  var userAva = $("user-ava");
  var userName = $("user-name");
  var mcpListPane = $("mcp-list-pane");
  var mcpDetailPane = $("mcp-detail-pane");
  var mcpList = $("mcp-list");
  var mcpCount = $("mcp-count");
  var mcpDetail = $("mcp-detail");
  var mcpBack = $("mcp-back");
  var settingsModal = $("settings-modal");
  var settingsClose = $("settings-close");
  var cfgServer = $("cfg-server");
  var cfgAiKey = $("cfg-ai-key");
  var cfgAiBase = $("cfg-ai-base");
  var cfgAiModel = $("cfg-ai-model");
  var cfgOfflineMode = $("cfg-offline-mode");
  var offlineModelConfig = $("offline-model-config");
  var cfgAiProvider = $("cfg-ai-provider");
  var cfgMouseFx = $("cfg-mouse-fx");
  var saveBtn = $("save-btn");
  var saveFeedback = $("save-feedback");
  var statTotal = $("stat-total");
  var statRunning = $("stat-running");
  var statSuccess = $("stat-success");
  var statFailed = $("stat-failed");
  var membersModal = $("members-modal");
  var membersModalClose = $("members-modal-close");
  var connectionStatusV = $("connection-status-v");
  var aiStatusV = $("ai-status-v");
  var serverStatusV = $("server-status-v");
  var connectBtn = $("connect-btn");
  var disconnectBtn = $("disconnect-btn");
  var loginModal = $("login-modal");
  var loginModalClose = $("login-modal-close");
  var loginGate = $("login-gate");
  var accountCard = $("account-card");
  var accountStatusV = $("account-status-v");
  var loginAccount = $("login-account");
  var loginPassword = $("login-password");
  var loginRemember = $("login-remember");
  var loginBtn = $("login-btn");
  var loginFeedback = $("login-feedback");
  var logoutBtn = $("logout-btn");

  // src/lib/types.ts
  var SETTING_DEFAULTS = {
    serverUrl: "http://localhost:3000",
    agentSocketUrl: "",
    agentToken: "",
    deviceId: "",
    agentName: "\u6D4F\u89C8\u5668\u63D2\u4EF6",
    agentGroup: "",
    aiKey: "",
    aiBaseUrl: "https://api.anthropic.com",
    aiModel: "claude-sonnet-4-5",
    offlineMode: false,
    offlinePrompt: "\u4F60\u662F HeySure AI\uFF0C\u8FD0\u884C\u5728\u6D4F\u89C8\u5668\u63D2\u4EF6\u7684\u672C\u5730\u5BF9\u8BDD\u7A97\u53E3\u4E2D\u3002\u4F60\u53EF\u4EE5\u76F4\u63A5\u56DE\u7B54\u7528\u6237\uFF0C\u4E5F\u53EF\u4EE5\u8C03\u7528\u672C\u673A\u6D4F\u89C8\u5668 MCP \u5DE5\u5177\u5B8C\u6210\u7F51\u9875\u6D4F\u89C8\u3001\u70B9\u51FB\u3001\u8F93\u5165\u3001\u622A\u56FE\u3001\u63D0\u53D6\u6570\u636E\u3001\u7BA1\u7406\u6807\u7B7E\u9875\u7B49\u4EFB\u52A1\u3002\u9700\u8981\u64CD\u4F5C\u6D4F\u89C8\u5668\u65F6\u4F18\u5148\u4F7F\u7528\u5DE5\u5177\uFF0C\u5E76\u7528\u548C\u7528\u6237\u76F8\u540C\u7684\u8BED\u8A00\u56DE\u590D\u3002",
    mouseFx: true,
    theme: "dark",
    selectedAiConfigId: null
  };

  // src/lib/storage.ts
  async function getSettings() {
    const keys = Object.keys(SETTING_DEFAULTS);
    const stored = await chrome.storage.local.get(keys);
    return { ...SETTING_DEFAULTS, ...stored };
  }
  async function saveSettings(partial) {
    await chrome.storage.local.set(partial);
  }
  var AUTH_KEY = "_auth_state";
  var AUTH_DEFAULT = {
    token: "",
    account: "",
    password: "",
    rememberLogin: false,
    userId: null,
    userName: "",
    avatar: ""
  };
  async function getAuth() {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return { ...AUTH_DEFAULT, ...r[AUTH_KEY] || {} };
  }
  async function saveAuth(state2) {
    const current = await getAuth();
    await chrome.storage.local.set({ [AUTH_KEY]: { ...current, ...state2 } });
  }
  async function clearAuth() {
    const current = await getAuth();
    const remembered = !!current.rememberLogin;
    await chrome.storage.local.set({
      [AUTH_KEY]: {
        ...AUTH_DEFAULT,
        account: remembered ? current.account : "",
        password: remembered ? current.password : "",
        rememberLogin: remembered
      }
    });
  }
  var AVATAR_CACHE_KEY = "_avatar_cache";
  async function getAvatarCache() {
    const r = await chrome.storage.local.get(AVATAR_CACHE_KEY);
    const c = r[AVATAR_CACHE_KEY];
    return c && typeof c.src === "string" && typeof c.dataUrl === "string" ? c : null;
  }
  async function setAvatarCache(cache) {
    await chrome.storage.local.set({ [AVATAR_CACHE_KEY]: cache });
  }
  async function clearAvatarCache() {
    await chrome.storage.local.remove(AVATAR_CACHE_KEY);
  }
  var TOOL_DESC_KEY = "_tool_desc_overrides";
  async function getToolDescOverrides() {
    const r = await chrome.storage.local.get(TOOL_DESC_KEY);
    const v = r[TOOL_DESC_KEY];
    return v && typeof v === "object" ? v : {};
  }
  async function setToolDescOverride(tool, override) {
    const all = await getToolDescOverrides();
    const name = String(tool || "").trim();
    if (!name)
      return;
    const desc = String(override.description || "").trim();
    const params = {};
    for (const [k, v] of Object.entries(override.parameters || {})) {
      const pn = String(k || "").trim();
      const pv = String(v || "").trim();
      if (pn && pv)
        params[pn] = pv;
    }
    if (!desc && Object.keys(params).length === 0) {
      delete all[name];
    } else {
      all[name] = { description: desc, parameters: params };
    }
    await chrome.storage.local.set({ [TOOL_DESC_KEY]: all });
  }

  // src/lib/client.ts
  var trimUrl = (u) => String(u || "").replace(/\/+$/, "");
  var authHeaders = (token, withJson = false) => {
    const h = { Authorization: `Bearer ${token}` };
    if (withJson)
      h["Content-Type"] = "application/json";
    return h;
  };
  var ApiError = class extends Error {
    status;
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  };
  function isAuthError(err) {
    if (err && typeof err.status === "number")
      return err.status === 401 || err.status === 403;
    return /\b(401|403)\b|令牌|凭证|credential|unauthor/i.test(String(err?.message || err));
  }
  async function parseError(res, fallback) {
    try {
      const data = await res.json();
      return String(data?.detail || data?.error || fallback);
    } catch {
      return `${fallback} (HTTP ${res.status})`;
    }
  }
  async function requestJson(url, init2, fallback) {
    const res = await fetch(url, { ...init2, signal: init2.signal ?? AbortSignal.timeout(2e4) });
    if (!res.ok)
      throw new ApiError(await parseError(res, fallback), res.status);
    return await res.json();
  }
  async function login(serverUrl, account, password) {
    const base = trimUrl(serverUrl);
    const data = await requestJson(
      `${base}/api/auth/login`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, password }) },
      "\u767B\u5F55\u5931\u8D25"
    );
    if (!data.access_token)
      throw new Error("\u767B\u5F55\u54CD\u5E94\u7F3A\u5C11\u4EE4\u724C");
    const agentSocketUrl = trimUrl(data.agent_socket_url || "");
    if (!agentSocketUrl)
      throw new Error("\u767B\u5F55\u54CD\u5E94\u7F3A\u5C11 Agent \u8FDE\u63A5\u5730\u5740");
    return { token: data.access_token, user: data.user, agentSocketUrl };
  }
  async function getMe(serverUrl, token) {
    return requestJson(`${trimUrl(serverUrl)}/api/auth/me`, { headers: authHeaders(token) }, "\u83B7\u53D6\u7528\u6237\u4FE1\u606F\u5931\u8D25");
  }
  async function getAgentEndpoint(serverUrl, token) {
    const data = await requestJson(
      `${trimUrl(serverUrl)}/api/auth/agent-endpoint`,
      { headers: authHeaders(token) },
      "\u83B7\u53D6 Agent \u8FDE\u63A5\u5730\u5740\u5931\u8D25"
    );
    const agentSocketUrl = trimUrl(data.agent_socket_url || "");
    if (!agentSocketUrl)
      throw new Error("\u670D\u52A1\u5668\u672A\u8FD4\u56DE Agent \u8FDE\u63A5\u5730\u5740");
    return agentSocketUrl;
  }

  // src/popup/markdown.ts
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/popup/helpers.ts
  function normalizeAvatarUrl(avatar) {
    const raw = String(avatar || "").trim();
    if (!raw)
      return "";
    const base = state.serverUrl.replace(/\/+$/, "");
    const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i);
    if (preset)
      return base ? `${base}/avatars/avatars${preset[1]}.png` : "";
    if (/^(https?:|data:|blob:|chrome-extension:)/i.test(raw))
      return raw;
    if (raw.startsWith("/"))
      return base ? `${base}${raw}` : raw;
    return raw;
  }
  function avatarHtml(src, fallback) {
    const safeSrc = normalizeAvatarUrl(src);
    return safeSrc ? `<img src="${esc(safeSrc)}" alt="" />` : esc(fallback);
  }
  function fetchAsDataUrl(url) {
    return fetch(url).then((resp) => {
      if (!resp.ok)
        throw new Error(`HTTP ${resp.status}`);
      return resp.blob();
    }).then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }));
  }
  async function refreshAvatarCache() {
    const resolved = normalizeAvatarUrl(state.auth.avatar);
    if (!resolved) {
      state.avatarDataUrl = "";
      await clearAvatarCache();
      return;
    }
    if (resolved.startsWith("data:")) {
      state.avatarDataUrl = resolved;
      await setAvatarCache({ src: resolved, dataUrl: resolved });
      return;
    }
    const cached = await getAvatarCache();
    if (cached && cached.src === resolved) {
      state.avatarDataUrl = cached.dataUrl;
      return;
    }
    try {
      const dataUrl = await fetchAsDataUrl(resolved);
      state.avatarDataUrl = dataUrl;
      await setAvatarCache({ src: resolved, dataUrl });
    } catch (err) {
      console.warn("avatar cache fetch failed, falling back to live URL", err);
      state.avatarDataUrl = "";
    }
  }
  function currentAvatarHtml(fallback) {
    return avatarHtml(state.avatarDataUrl || state.auth.avatar, fallback);
  }

  // src/popup/transport.ts
  var currentPort = null;
  var messageHandler = null;
  var reconnectTimer = null;
  var pendingMessages = [];
  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }
  function scheduleReconnect() {
    if (!messageHandler || reconnectTimer)
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectPort();
    }, 1e3);
  }
  function flushPendingMessages() {
    if (!currentPort || !messageHandler)
      return;
    while (pendingMessages.length) {
      const msg = pendingMessages.shift();
      try {
        currentPort.postMessage(msg);
      } catch {
        pendingMessages.unshift(msg);
        currentPort = null;
        scheduleReconnect();
        return;
      }
    }
  }
  function connectPort() {
    if (!messageHandler)
      return;
    if (currentPort)
      return currentPort;
    const port = chrome.runtime.connect({ name: "popup" });
    currentPort = port;
    state.port = port;
    port.onMessage.addListener(messageHandler);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (currentPort !== port)
        return;
      currentPort = null;
      scheduleReconnect();
    });
    flushPendingMessages();
    return port;
  }
  function initPopupPort(onMessage) {
    messageHandler = onMessage;
    clearReconnectTimer();
    connectPort();
  }
  function sendToBackground(msg) {
    if (!currentPort) {
      pendingMessages.push(msg);
      scheduleReconnect();
      connectPort();
      return false;
    }
    try {
      currentPort.postMessage(msg);
      return true;
    } catch {
      pendingMessages.push(msg);
      currentPort = null;
      scheduleReconnect();
      connectPort();
      return false;
    }
  }

  // src/popup/members.ts
  function renderConnectionInfo() {
    const connected = state.currentStatus === "registered" || state.currentStatus === "connected";
    connectionStatusV.textContent = connected ? "\u5DF2\u8FDE\u63A5\u5230\u670D\u52A1\u5668" : "\u672A\u8FDE\u63A5\u5230\u670D\u52A1\u5668";
    aiStatusV.textContent = state.boundAiConfigId == null ? "\u672A\u5206\u914D" : "\u5DF2\u5206\u914D AI";
    serverStatusV.textContent = state.serverUrl || "-";
    renderStatus();
  }
  async function doLogin() {
    const configuredServerUrl = cfgServer.value.trim();
    if (configuredServerUrl && configuredServerUrl !== state.serverUrl) {
      state.serverUrl = configuredServerUrl;
      await saveSettings({ serverUrl: state.serverUrl });
      sendToBackground({ type: "settings:save", payload: { serverUrl: state.serverUrl } });
    }
    const account = loginAccount.value.trim();
    const password = loginPassword.value;
    if (!account || !password) {
      loginFeedback.textContent = "\u8BF7\u8F93\u5165\u8D26\u53F7\u548C\u5BC6\u7801";
      loginFeedback.style.color = "var(--error)";
      return;
    }
    if (!state.serverUrl) {
      loginFeedback.textContent = "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u670D\u52A1\u5668 URL";
      loginFeedback.style.color = "var(--error)";
      return;
    }
    loginBtn.disabled = true;
    loginFeedback.textContent = "\u767B\u5F55\u4E2D\u2026";
    loginFeedback.style.color = "var(--muted)";
    try {
      const { token, user, agentSocketUrl } = await login(state.serverUrl, account, password);
      const rememberLogin = loginRemember.checked;
      state.auth = {
        token,
        account: rememberLogin ? account : "",
        password: rememberLogin ? password : "",
        rememberLogin,
        userId: user?.id ?? null,
        userName: user?.name || account,
        avatar: user?.avatar || ""
      };
      await saveSettings({ agentSocketUrl });
      await saveAuth(state.auth);
      if (!rememberLogin) {
        loginAccount.value = "";
        loginPassword.value = "";
      }
      loginFeedback.textContent = "\u767B\u5F55\u6210\u529F \u2713";
      loginFeedback.style.color = "var(--success)";
      updateUserChip();
      await refreshAvatarCache();
      updateUserChip();
      sendToBackground({ type: "device:connect" });
      closeLoginModal();
      openMembersModal();
    } catch (err) {
      loginFeedback.textContent = `\u767B\u5F55\u5931\u8D25\uFF1A${err?.message || err}`;
      loginFeedback.style.color = "var(--error)";
      sendToBackground({ type: "device:connect" });
    } finally {
      loginBtn.disabled = false;
    }
  }
  async function doLogout() {
    await clearAuth();
    sendToBackground({ type: "auth:logout" });
    state.auth = await getAuth();
    loginAccount.value = state.auth.account || "";
    loginPassword.value = state.auth.password || "";
    loginRemember.checked = !!state.auth.rememberLogin;
    state.avatarDataUrl = "";
    await clearAvatarCache();
    closeMembersModal();
    updateUserChip();
    renderConnectionInfo();
  }
  function renderMembers() {
    renderConnectionInfo();
  }
  function wireMembers() {
    loginBtn.addEventListener("click", () => void doLogin());
    loginPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        void doLogin();
    });
    userChip.addEventListener("click", () => openLoginModal());
    userChip.addEventListener("keydown", (e) => {
      const key = e.key;
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        openLoginModal();
      }
    });
    loginModal.addEventListener("click", (e) => {
      if (e.target === loginModal)
        closeLoginModal();
    });
    loginModalClose.addEventListener("click", () => closeLoginModal());
    membersModal.addEventListener("click", (e) => {
      if (e.target === membersModal)
        closeMembersModal();
    });
    membersModalClose.addEventListener("click", () => closeMembersModal());
    logoutBtn.addEventListener("click", () => void doLogout());
    connectBtn.addEventListener("click", () => sendToBackground({ type: "device:connect" }));
    disconnectBtn.addEventListener("click", () => sendToBackground({ type: "device:disconnect" }));
  }

  // src/popup/ui.ts
  function renderStatus() {
    const connected = state.currentStatus === "registered" || state.currentStatus === "connected";
    let color;
    let label;
    if (state.offlineMode) {
      color = "red";
      label = "\u79BB\u7EBF\u6A21\u5F0F";
    } else if (!connected) {
      color = "red";
      label = "\u672A\u8FDE\u63A5";
    } else if (state.boundAiConfigId == null) {
      color = "yellow";
      label = "\u672A\u5206\u914D";
    } else {
      color = "green";
      label = "\u5DF2\u8FDE\u63A5";
    }
    statusDot.className = `status-dot ${color}`;
    statusLabel.textContent = label;
  }
  function setStatus(status) {
    state.currentStatus = status;
    if (status !== "registered" && status !== "connected")
      state.boundAiConfigId = null;
    renderStatus();
    renderMembers();
  }
  function setBoundAi(aiConfigId) {
    state.boundAiConfigId = aiConfigId;
    renderStatus();
    renderMembers();
  }
  function applyTheme(theme, persist = true) {
    state.currentTheme = theme;
    document.body.className = theme;
    themeToggle.textContent = theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}";
    if (persist)
      sendToBackground({ type: "settings:save", payload: { theme } });
  }
  function renderStats() {
    statTotal.textContent = String(state.stats.total);
    statRunning.textContent = String(state.stats.running);
    statSuccess.textContent = String(state.stats.success);
    statFailed.textContent = String(state.stats.failed);
  }
  function openSettingsModal() {
    settingsModal.classList.remove("hidden");
  }
  function closeSettingsModal() {
    settingsModal.classList.add("hidden");
  }
  function openLoginModal() {
    loginModal.classList.remove("hidden");
    updateUserChip();
    loginAccount.value = state.auth.account || "";
    loginPassword.value = state.auth.password || "";
    loginRemember.checked = !!state.auth.rememberLogin;
    setTimeout(() => {
      if (!state.auth.token)
        loginAccount.focus();
    }, 0);
  }
  function closeLoginModal() {
    loginModal.classList.add("hidden");
  }
  function openMembersModal() {
    membersModal.classList.remove("hidden");
    renderMembers();
  }
  function closeMembersModal() {
    membersModal.classList.add("hidden");
  }
  function updateUserChip() {
    const auth = state.auth;
    if (auth.token) {
      userChip.classList.remove("guest");
      userAva.innerHTML = currentAvatarHtml((auth.userName || auth.account || "?").slice(0, 1).toUpperCase());
      userName.textContent = auth.userName || auth.account || "\u5DF2\u767B\u5F55";
    } else {
      userChip.classList.add("guest");
      userAva.textContent = "\xB7";
      userName.textContent = "\u672A\u767B\u5F55";
    }
    accountCard.style.display = auth.token ? "block" : "none";
    loginGate.classList.toggle("hidden", !!auth.token);
    accountStatusV.textContent = auth.token ? `\u5DF2\u767B\u5F55\uFF1A${auth.userName || auth.account}` : "\u672A\u767B\u5F55";
  }
  function updateOfflineUi() {
    offlineModelConfig.classList.toggle("hidden", !state.offlineMode);
    renderStatus();
    renderMembers();
  }
  function wireUi() {
    themeToggle.addEventListener("click", () => applyTheme(state.currentTheme === "dark" ? "light" : "dark"));
    settingsBtn.addEventListener("click", () => openSettingsModal());
    offlineChatBtn.addEventListener("click", () => {
      chrome.windows.create({
        url: chrome.runtime.getURL("offline-chat.html"),
        type: "popup",
        width: 920,
        height: 720
      });
    });
    settingsClose.addEventListener("click", () => closeSettingsModal());
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal)
        closeSettingsModal();
    });
    statusPill.addEventListener("click", () => openMembersModal());
  }

  // src/popup/settings.ts
  function loadSettings(s) {
    state.serverUrl = s.serverUrl || "";
    cfgServer.value = s.serverUrl || "";
    cfgAiKey.value = s.aiKey || "";
    cfgAiBase.value = s.aiBaseUrl || "";
    cfgAiModel.value = s.aiModel || "";
    state.offlineMode = !!s.offlineMode;
    cfgOfflineMode.checked = state.offlineMode;
    cfgMouseFx.checked = s.mouseFx !== false;
    state.localModel = s.aiModel || "";
    state.hasAiKey = !!s.aiKey?.trim();
    updateOfflineUi();
    applyTheme(s.theme || "dark", false);
  }
  var PROVIDER_PRESETS = {
    anthropic: { base: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
    openai: { base: "https://api.openai.com", model: "gpt-4o" },
    deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
    openrouter: { base: "https://openrouter.ai/api", model: "anthropic/claude-3.5-sonnet" },
    ollama: { base: "http://localhost:11434", model: "llama3.1" }
  };
  function wireSettings() {
    cfgAiProvider.addEventListener("change", () => {
      const p = PROVIDER_PRESETS[cfgAiProvider.value];
      if (p) {
        cfgAiBase.value = p.base;
        cfgAiModel.value = p.model;
      }
      cfgAiProvider.value = "";
    });
    cfgOfflineMode.addEventListener("change", () => {
      state.offlineMode = cfgOfflineMode.checked;
      updateOfflineUi();
      sendToBackground({ type: "settings:save", payload: { offlineMode: state.offlineMode } });
    });
    cfgMouseFx.addEventListener("change", () => {
      sendToBackground({ type: "settings:save", payload: { mouseFx: cfgMouseFx.checked } });
    });
    saveBtn.addEventListener("click", () => {
      const payload = {
        serverUrl: cfgServer.value.trim(),
        aiKey: cfgAiKey.value.trim(),
        aiBaseUrl: cfgAiBase.value.trim() || "https://api.anthropic.com",
        aiModel: cfgAiModel.value.trim() || "claude-sonnet-4-5",
        offlineMode: cfgOfflineMode.checked,
        mouseFx: cfgMouseFx.checked
      };
      state.serverUrl = payload.serverUrl || "";
      state.offlineMode = !!payload.offlineMode;
      state.localModel = payload.aiModel || "";
      state.hasAiKey = !!payload.aiKey;
      sendToBackground({ type: "settings:save", payload });
      updateOfflineUi();
      saveFeedback.textContent = "\u5DF2\u4FDD\u5B58 \u2713";
      saveFeedback.style.color = "var(--success)";
      setTimeout(() => {
        saveFeedback.textContent = "";
      }, 2e3);
    });
  }

  // src/lib/tools/definitions.ts
  var BROWSER_TOOLS = [
    // ───── 页面观察 ───────────────────────────────────────────────────────
    {
      name: "browser_observe",
      description: '\u611F\u77E5\u5F53\u524D\u89C6\u53E3\u91CC\u7528\u6237\u80FD\u770B\u5230\u7684\u5185\u5BB9\uFF0C\u533A\u5206\u666E\u901A\u53EF\u89C1\u6587\u672C\u3001\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\u3001iframe \u8FB9\u754C\u4E0E\u53EF\u4EA4\u4E92\u5143\u7D20\uFF1A\u8FD4\u56DE\u5355\u4E00 items \u6DF7\u6392\u5217\u8868\uFF08\u5DF2\u53BB\u91CD\uFF0C\u4E0D\u518D\u53E6\u9644 texts/elements/frames \u6570\u7EC4\uFF0C\u5168\u90E8\u5185\u5BB9\u90FD\u5728 items \u91CC\u7528 kind \u533A\u5206\uFF09\uFF0C\u5176\u4E2D kind=text \u662F\u9875\u9762\u6587\u5B57\uFF08\u4E0D\u53EF\u70B9\u51FB\uFF09\uFF0Ckind=media \u662F\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\uFF08category=image/video/audio\uFF09\uFF0Ckind=frame \u662F\u9875\u9762\u5185 iframe \u8FB9\u754C\uFF08accessible=true \u8868\u793A\u540C\u6E90\u5DF2\u626B\u63CF\uFF0C\u5B50\u63A7\u4EF6\u89C1 inFrame=true \u7684 interactive\uFF1Baccessible=false \u4E3A\u8DE8\u57DF\u4E0D\u53EF\u7528\u5750\u6807\u70B9\u51FB\uFF09\uFF0Ckind=interactive \u662F\u6700\u9876\u5C42\u3001\u672A\u88AB\u906E\u6321\u7684\u6309\u94AE/\u94FE\u63A5/\u8F93\u5165\u6846/\u4E0B\u62C9/\u83DC\u5355\u9879\u7B49\uFF0C\u6BCF\u4E2A interactive \u90FD\u5E26\u72EC\u7ACB id\u3002\u4E3A\u8282\u7701\u4E0A\u4E0B\u6587\uFF0C\u6BCF\u6761\u5DF2\u7701\u7565 selector/rect/tag\uFF0C\u4EC5\u4FDD\u7559 id/role/category/text/center\u2014\u2014\u8BF7\u7528 ref:id \u70B9\u51FB\uFF0C\u4E0D\u8981\u4F9D\u8D56 selector\u3002\u540C\u6E90 iframe \u5185\u7684\u5143\u7D20\u4F1A\u4E00\u5E76\u626B\u63CF\uFF0CinFrame=true \u4E14 center/rect \u5DF2\u6362\u7B97\u4E3A\u9875\u9762\u89C6\u53E3\u5750\u6807\uFF0CframeSelector \u6307\u5411\u6240\u5C5E iframe\uFF0C\u70B9\u51FB\u4ECD\u7528 browser_action {action:"click", ref:id}\u3002\u8DE8\u57DF iframe \u5185\u5BB9\u73B0\u4E5F\u4F1A\u88AB\u626B\u63CF\u5E76\u5408\u5E76\u8FDB\u6765\uFF1A\u8FD9\u4E9B items \u5E26 crossOrigin=true\u3001frameId \u548C\u5F62\u5982 "3:5" \u7684 id\uFF0C\u5176 center/rect \u662F\u8BE5 iframe \u5185\u90E8\u5750\u6807\uFF08coordsLocalToFrame=true\uFF0C\u52FF\u4E0E\u4E3B\u9875\u9762\u5750\u6807\u6216\u622A\u56FE\u5750\u6807\u6DF7\u7528\uFF09\uFF0C\u70B9\u51FB/\u8F93\u5165\u76F4\u63A5\u628A\u8BE5 id \u5F53 ref \u56DE\u4F20\u5373\u53EF\u3002\u82E5\u5339\u914D\u6761\u76EE\u8D85\u8FC7 limit/max_items\uFF0C\u9ED8\u8BA4\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u8FD4\u56DE tooMany=true \u4E0E categoryCounts\uFF0C\u63D0\u793A\u7EE7\u7EED\u7528 filter/tag/keyword \u7F29\u5C0F\u8303\u56F4\u3002\u7528\u9014\uFF1A\u65E2\u80FD\u8BFB\u53D6\u9875\u9762\u6587\u5B57\uFF0C\u53C8\u80FD\u4F5C\u4E3A\u70B9\u51FB/\u8F93\u5165\u524D\u7684\u9996\u9009\u89C2\u5BDF\u624B\u6BB5\uFF0C\u914D\u5408 browser_screenshot \u5F62\u6210\u300C\u770B\u56FE\u2014\u6309 id \u70B9\u51FB\u300D\u95ED\u73AF\u3002\u573A\u666F\uFF1A\u5148 observe \u7406\u89E3\u9875\u9762\uFF0C\u518D browser_action {action:"click", ref:id} \u7CBE\u786E\u70B9\u51FB\uFF1B\u5143\u7D20\u592A\u591A\u65F6\u7528 filter \u53EA\u770B\u67D0\u7C7B\uFF08\u5982 filter:"button" \u6216 filter:"image"\uFF09\u3001tag \u6307\u5B9A HTML \u6807\u7B7E\u3001keyword \u67E5\u5173\u952E\u8BCD\uFF1B\u9875\u9762\u53D8\u5316\u540E\u91CD\u65B0 observe \u4EE5\u5237\u65B0 id\u3002\u52FF\u7528 Playwright \u8BED\u6CD5\uFF08\u5982 button:has-text\uFF09\uFF1B\u7528 text \u53C2\u6570\u6216 observe \u8FD4\u56DE\u7684 ref/selector\u3002',
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u53EF\u4EA4\u4E92\u5143\u7D20\u6761\u76EE\u6570\uFF1B\u8D85\u8FC7\u65F6\u9ED8\u8BA4\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u8FD4\u56DE tooMany/categoryCounts\uFF0C\u63D0\u793A\u7EE7\u7EED\u7B5B\u9009\u3002\u9ED8\u8BA4 120\uFF0C\u6700\u5927 200\u3002" },
          max_items: { type: "number", description: "\u6700\u7EC8 items \u6DF7\u6392\u5217\u8868\u5141\u8BB8\u8FD4\u56DE\u7684\u6700\u5927\u603B\u6761\u6570\uFF1B\u8D85\u8FC7\u65F6\u9ED8\u8BA4\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u8FD4\u56DE categoryCounts\u3002\u9ED8\u8BA4\u7EA6\u7B49\u4E8E limit + text_limit + 40\uFF0C\u6700\u5927 500\u3002" },
          filter: {
            type: ["string", "array"],
            items: { type: "string" },
            description: '\u6309\u7C7B\u522B\u7B5B\u9009\u53EA\u8FD4\u56DE\u60F3\u770B\u7684\u5143\u7D20\uFF0C\u7F29\u5C0F\u566A\u97F3\u3002\u53EF\u4F20\u5355\u4E2A\u5B57\u7B26\u4E32\u3001\u9017\u53F7\u5206\u9694\u5B57\u7B26\u4E32\u6216\u5B57\u7B26\u4E32\u6570\u7EC4\u3002\u53EF\u9009\u7C7B\u522B\uFF1Abutton\uFF08\u6309\u94AE\uFF09\u3001link\uFF08\u94FE\u63A5\uFF09\u3001input\uFF08\u8F93\u5165\u6846/\u6587\u672C\u57DF/\u53EF\u7F16\u8F91\u533A\uFF09\u3001select\uFF08\u4E0B\u62C9\u6846\uFF09\u3001checkbox\uFF08\u590D\u9009/\u5F00\u5173\uFF09\u3001radio\uFF08\u5355\u9009\uFF09\u3001tab\uFF08\u6807\u7B7E\u9875\uFF09\u3001menuitem\uFF08\u83DC\u5355\u9879\uFF09\u3001option\uFF08\u9009\u9879\uFF09\u3001label\uFF08\u6807\u7B7E\u5143\u7D20\uFF09\u3001image/img\uFF08\u56FE\u7247\uFF09\u3001video\uFF08\u89C6\u9891\uFF09\u3001audio\uFF08\u97F3\u9891\uFF09\u3001media\uFF08\u5168\u90E8\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\uFF09\u3001text\uFF08\u666E\u901A\u53EF\u89C1\u6587\u672C\uFF09\u3001frame\uFF08iframe \u8FB9\u754C\uFF09\u3001interactive\uFF08\u6240\u6709\u53EF\u4EA4\u4E92\u5143\u7D20\uFF0C\u4E0D\u542B\u7EAF\u6587\u672C/\u5A92\u4F53\uFF09\u3002\u4F8B\uFF1Afilter:"button" \u53EA\u770B\u6309\u94AE\uFF1Bfilter:["input","select"] \u53EA\u770B\u8F93\u5165\u6846\u548C\u4E0B\u62C9\u6846\uFF1Bfilter:"image" \u53EA\u770B\u56FE\u7247\uFF1Bfilter:"text" \u53EA\u770B\u5168\u90E8\u6587\u5B57\u5143\u7D20\uFF1B\u4E0D\u4F20\u6216\u4F20 "all" \u5219\u8FD4\u56DE\u5168\u90E8\u3002\u8FD4\u56DE\u7684\u6BCF\u4E2A interactive \u9879\u90FD\u5E26 category \u5B57\u6BB5\u6807\u660E\u5176\u7C7B\u522B\u3002'
          },
          tag: { type: ["string", "array"], items: { type: "string" }, description: '\u6309 HTML \u6807\u7B7E\u540D\u8FDB\u4E00\u6B65\u7B5B\u9009\uFF0C\u53EF\u4F20 "img"\u3001"video"\u3001"button"\u3001"a"\u3001"input"\u3001"label"\u3001"iframe" \u7B49\uFF0C\u4E5F\u53EF\u4F20\u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694\u5B57\u7B26\u4E32\u3002' },
          tags: { type: ["string", "array"], items: { type: "string" }, description: "tag \u7684\u522B\u540D\u3002" },
          keyword: { type: "string", description: "\u6309\u5173\u952E\u8BCD\u7B5B\u9009\uFF0C\u5339\u914D\u53EF\u89C1\u6587\u672C\u3001alt/title/aria-label\u3001name/id\u3001src/href \u7B49\u5E38\u7528\u5B57\u6BB5\uFF1B\u4E5F\u517C\u5BB9 query/text_filter\u3002" },
          query: { type: "string", description: "keyword \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          text_filter: { type: "string", description: "keyword \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          include_text: { type: "boolean", description: "\u662F\u5426\u540C\u65F6\u5305\u542B\u666E\u901A\u53EF\u89C1\u6587\u672C\uFF08items \u4E2D kind=text \u7684\u6761\u76EE\uFF09\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u53EF\u4EA4\u4E92\u5143\u7D20\u3002" },
          text_limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u666E\u901A\u53EF\u89C1\u6587\u672C\u6761\u6570\u3002\u9ED8\u8BA4 200\uFF0C\u6700\u5927 500\u3002" },
          allow_truncate: { type: "boolean", description: "\u4E3A true \u65F6\u5373\u4F7F\u8D85\u8FC7 limit/max_items \u4E5F\u622A\u65AD\u8FD4\u56DE\uFF1B\u9ED8\u8BA4 false\uFF0C\u5373\u8D85\u91CF\u65F6\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u7ED9 categoryCounts \u548C\u7B5B\u9009\u63D0\u793A\u3002" },
          frame: { type: "string", description: "\u53EA\u89C2\u5BDF\u6307\u5B9A\u540C\u6E90 iframe \u5185\u90E8\uFF08\u542B\u5176\u5B50 iframe\uFF09\uFF1A\u4F20\u8BE5 iframe \u7684 CSS selector\uFF0C\u5373\u4E0A\u6B21 observe \u4E2D kind=frame \u6761\u76EE\u7684 frameSelector\u3002\u9875\u9762\u5143\u7D20\u592A\u591A\u3001\u8FD4\u56DE\u5185\u5BB9\u88AB\u622A\u65AD\u65F6\uFF0C\u7528\u5B83\u4E0B\u94BB\u5230\u76EE\u6807 iframe\uFF08\u5982\u5D4C\u5165\u7684\u5BCC\u6587\u672C\u7F16\u8F91\u5668\uFF09\uFF0C\u5355\u72EC\u62FF\u5B83\u5185\u90E8\u7684\u5B8C\u6574\u5143\u7D20\u5217\u8868\u3002" },
          frame_path: { type: "array", items: { type: "string" }, description: "\u5D4C\u5957 iframe \u7684\u9010\u5C42 selector \u8DEF\u5F84\uFF08\u5373 observe \u8FD4\u56DE\u7684 framePath\uFF09\uFF0C\u4ECE\u9876\u5C42\u6587\u6863\u5230\u76EE\u6807 iframe\u3002\u4E0E frame \u4E8C\u9009\u4E00\uFF0C\u5D4C\u5957\u591A\u5C42\u65F6\u7528\u5B83\u3002" },
          mark: { type: "boolean", description: "\u662F\u5426\u5728\u9875\u9762\u4E0A\u7ED8\u5236\u65E0\u5E8F\u53F7\u72B6\u6001\u8272\u6807\u8BB0\uFF0C\u4FBF\u4E8E\u968F\u540E\u622A\u56FE\u67E5\u770B\u3002\u9ED8\u8BA4 true\uFF1B\u7EFF\u8272=\u53EF\u70B9\u51FB\uFF0C\u7EA2\u8272=\u4E0D\u53EF\u70B9\u51FB/\u88AB\u7981\u7528/\u88AB\u906E\u6321\uFF1B\u4F20 false \u4EC5\u8FD4\u56DE\u5217\u8868\u5E76\u6E05\u9664\u5DF2\u6709\u6807\u8BB0\u3002\u6807\u8BB0\u4EC5\u4E3A\u89C6\u89C9\u53E0\u52A0\uFF0C\u4E0D\u5F71\u54CD\u5176\u4ED6\u53D6\u6570\u5DE5\u5177\u6216\u622A\u56FE\uFF0C\u4E5F\u4E0D\u62E6\u622A\u70B9\u51FB\u3002" },
          observe_timeout_ms: { type: "number", description: "\u672C\u6B21 observe \u7B49\u5F85/\u626B\u63CF\u7684\u6700\u5927\u65F6\u957F\uFF08\u6BEB\u79D2\uFF0C\u9ED8\u8BA4 8000\uFF0C\u4E0A\u9650 30000\uFF09\uFF1B\u5305\u62EC\u9876\u5C42\u9875\u9762\u4E0E\u8DE8\u57DF iframe \u7684\u89C2\u5BDF\uFF0C\u8D85\u65F6\u5219\u7ED3\u675F\u672C\u6B21\u8C03\u7528\u3002" },
          wait_timeout_ms: { type: "number", description: "observe_timeout_ms \u7684\u901A\u7528\u522B\u540D\uFF1A\u672C\u6B21 observe \u6700\u591A\u7B49\u5F85\u591A\u4E45\u3002" },
          max_wait_ms: { type: "number", description: "wait_timeout_ms \u7684\u517C\u5BB9\u522B\u540D\u3002" }
        }
      }
    },
    {
      name: "browser_screenshot",
      description: "\u5BF9\u5F53\u524D\u6807\u7B7E\u9875\u622A\u56FE\uFF1A\u53EF\u622A\u53EF\u89C6\u533A\u3001\u6574\u9875\u3001\u67D0\u4E2A CSS/\u6587\u672C\u5339\u914D\u7684\u5143\u7D20\uFF0C\u6216\u4E00\u5757\u77E9\u5F62\u533A\u57DF\uFF0C\u9ED8\u8BA4\u8FD4\u56DE\u5B8C\u6574 base64 \u56FE\u7247 dataUrl\uFF0C\u5E76\u4FDD\u5B58\u5230\u670D\u52A1\u5668\u7528\u4E8E\u53D1\u9001\u7ED9\u7528\u6237\uFF1B\u4F20 send_to_user:false \u53EF\u53EA\u7ED9 AI \u4F7F\u7528\uFF08\u622A\u56FE\u88AB\u7981\u7528\u6216\u65E0\u6743\u9650\u65F6\u8FD4\u56DE\u53EF\u8BFB\u7684\u9519\u8BEF\u8BF4\u660E\uFF09\u3002\u7528\u9014\uFF1A\u8BA9 AI\u300C\u770B\u89C1\u300D\u9875\u9762\u3002\u573A\u666F\uFF1A\u6838\u5BF9\u9875\u9762\u72B6\u6001\u3001\u5728\u65E0\u6CD5\u8BFB\u53D6\u6587\u672C\u65F6\u6539\u7528\u89C6\u89C9\u7406\u89E3\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u622A\u56FE\u7684\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u5F53\u4E0D\u4F20 selector \u65F6\uFF0C\u7528\u53EF\u89C1\u6587\u672C\u5B9A\u4F4D\u8981\u622A\u56FE\u7684\u5143\u7D20\u3002" },
          full_page: { type: "boolean", description: "\u622A\u53D6\u6574\u4E2A\u53EF\u6EDA\u52A8\u9875\u9762\u3002" },
          x: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 X \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          y: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 Y \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          width: { type: "number", description: "\u533A\u57DF\u5BBD\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          height: { type: "number", description: "\u533A\u57DF\u9AD8\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          clip: { type: "object", description: "\u533A\u57DF\u5BF9\u8C61\u5199\u6CD5\uFF1A{x,y,width,height,coordinate_space?}\uFF0C\u4E0E x/y/width/height \u4E8C\u9009\u4E00\u3002" },
          coordinate_space: { type: "string", enum: ["viewport", "page"], description: "x/y/clip \u7684\u5750\u6807\u7CFB\uFF1Aviewport \u89C6\u53E3\u6216 page \u6574\u9875\u3002\u9ED8\u8BA4 viewport\u3002" },
          margin: { type: "number", description: "\u6309 selector/text \u622A\u5143\u7D20\u65F6\uFF0C\u5411\u56DB\u5468\u6269\u5C55\u7684\u989D\u5916 CSS \u50CF\u7D20\u3002" },
          scroll_into_view: { type: "boolean", description: "\u6D4B\u91CF\u524D\u5148\u628A\u76EE\u6807\u5143\u7D20\u6EDA\u52A8\u8FDB\u89C6\u53E3\u3002\u9ED8\u8BA4 true\u3002" },
          format: { type: "string", enum: ["png", "jpeg", "webp"], description: "\u56FE\u7247\u683C\u5F0F\u3002\u9ED8\u8BA4 png\u3002" },
          quality: { type: "number", description: "JPEG/WebP \u8D28\u91CF\uFF0C0-100\u3002" },
          scale: { type: "number", description: "CDP \u622A\u56FE\u7684\u7F29\u653E\u6BD4\u4F8B\u3002\u9ED8\u8BA4 1\u3002" },
          max_area: { type: "number", description: "\u5141\u8BB8\u7684\u6700\u5927\u622A\u56FE\u9762\u79EF\uFF08CSS \u50CF\u7D20\uFF09\u3002\u9ED8\u8BA4 25000000\u3002" },
          retries: { type: "number", description: "\u53EF\u89C6\u533A\u622A\u56FE\u9047\u5230\u6D3B\u52A8\u6807\u7B7E/\u9650\u6D41\u7B49\u4E34\u65F6\u5931\u8D25\u65F6\u7684\u91CD\u8BD5\u6B21\u6570\u3002\u9ED8\u8BA4 1\u3002" },
          timeout_ms: { type: "number", description: "\u5355\u9636\u6BB5\u622A\u56FE\u603B\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u53EF\u89C6\u622A\u56FE\u9ED8\u8BA4 8000\uFF0CCDP \u9ED8\u8BA4 12000\u3002" },
          visible_timeout_ms: { type: "number", description: "chrome.tabs.captureVisibleTab \u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 8000\u3002" },
          cdp_timeout_ms: { type: "number", description: "\u6BCF\u6761 Chrome DevTools Protocol \u622A\u56FE\u547D\u4EE4\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 12000\u3002" },
          content_timeout_ms: { type: "number", description: "\u5728\u9875\u9762\u4E2D\u6D4B\u91CF selector/text \u76EE\u6807\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 5000\u3002" },
          max_data_url_chars: { type: "number", description: "\u7ECF Socket.IO \u8FD4\u56DE\u7684 data URL \u6700\u5927\u957F\u5EA6\u3002\u9ED8\u8BA4 8000000\u3002" },
          allow_large_data_url: { type: "boolean", description: "\u5141\u8BB8\u8FD4\u56DE\u8D85\u8FC7 max_data_url_chars \u7684\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" },
          send_to_user: { type: "boolean", description: "\u662F\u5426\u628A\u622A\u56FE\u901A\u8FC7\u5F53\u524D AI \u7684\u673A\u5668\u4EBA\u53D1\u9001\u7ED9\u7528\u6237\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u7ED9 AI\uFF0C\u4E0D\u4E3B\u52A8\u53D1\u9001\u3002" },
          bot_send_to_user: { type: "boolean", description: "send_to_user \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4 true\u3002" },
          deliver_to_user: { type: "boolean", description: "send_to_user \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4 true\u3002" },
          save_to_server: { type: "boolean", description: "\u662F\u5426\u628A\u622A\u56FE\u4FDD\u5B58\u5230\u670D\u52A1\u5668\u5E76\u8FD4\u56DE\u670D\u52A1\u5668\u8DEF\u5F84/URL\u3002\u9ED8\u8BA4\u8DDF\u968F send_to_user\uFF1Bsend_to_user:true \u65F6\u4F1A\u81EA\u52A8\u4FDD\u5B58\u3002" },
          upload_to_server: { type: "boolean", description: "save_to_server \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4\u8DDF\u968F send_to_user\u3002" },
          task_timeout_ms: { type: "number", description: "\u672C\u6B21\u622A\u56FE\u4EFB\u52A1\u5728\u7AEF\u70B9 agent \u4E0A\u7684\u786C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 35000\u3002" },
          fallback_visible: { type: "boolean", description: "\u5143\u7D20/\u533A\u57DF/\u6574\u9875\u622A\u56FE\u65F6\uFF0C\u82E5\u7CBE\u786E CDP \u622A\u56FE\u5931\u8D25\u5219\u56DE\u9000\u4E3A\u53EF\u89C6\u533A\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" }
        }
      }
    },
    // ───── 页面交互 ───────────────────────────────────────────────────────
    {
      name: "browser_action",
      description: '\u9875\u9762\u4EA4\u4E92\u805A\u5408\u5DE5\u5177\uFF1A\u7528 action \u6307\u5B9A\u8981\u505A\u7684\u52A8\u4F5C\u2014\u2014\u70B9\u51FB click\uFF08\u5355\u51FB\uFF09\u3001\u53CC\u51FB double_click\u3001\u53F3\u952E right_click\u3001\u6EDA\u52A8 scroll\u3001\u8F93\u5165\u6587\u672C type\u3001\u952E\u76D8\u6309\u952E press_key\u3002\u5404\u52A8\u4F5C\u7684\u53C2\u6570\u4E0E\u539F browser_click/double_click/right_click/scroll/type/press_key \u4E00\u81F4\uFF0C\u6309 action \u53D6\u7528\u5BF9\u5E94\u5B57\u6BB5\u5373\u53EF\u3002\n\xB7 click\uFF1A\u6D3E\u53D1\u5B8C\u6574\u6307\u9488+\u9F20\u6807\u4E8B\u4EF6\u5E8F\u5217\uFF0C\u517C\u5BB9\u81EA\u5B9A\u4E49\u7EC4\u4EF6\uFF1B\u5B9A\u4F4D\u4F18\u5148\u7EA7 ref\uFF08browser_observe \u7F16\u53F7\uFF0C\u6700\u7A33\uFF09> selector > text > \u5750\u6807\uFF1B\u975E\u5750\u6807\u70B9\u51FB\u4F1A\u5148\u505A\u906E\u6321\u68C0\u6D4B\uFF0C\u88AB\u5F39\u7A97/\u906E\u7F69\u76D6\u4F4F\u65F6\u8FD4\u56DE occluded \u8BCA\u65AD\uFF08\u9700\u7A7F\u900F\u70B9\u51FB\u4F20 force:true\uFF09\u3002\n\xB7 double_click / right_click\uFF1A\u53CC\u51FB\u3001\u53F3\u952E\uFF08\u4E0A\u4E0B\u6587\u83DC\u5355\uFF09\uFF0C\u7528 selector / text / \u5750\u6807\u5B9A\u4F4D\u3002\n\xB7 scroll\uFF1A\u6EDA\u52A8\u9875\u9762\uFF0C\u8FD4\u56DE\u6EDA\u52A8\u540E\u7684\u4F4D\u7F6E\u3001\u79FB\u52A8\u50CF\u7D20\u6570\u4E0E\u8FDB\u5165\u89C6\u91CE\u7684\u5C0F\u8282/\u6807\u9898\u3002\n\xB7 type\uFF1A\u5411 input/textarea \u8F93\u5165\u6587\u672C\uFF08\u5355\u5B57\u6BB5\uFF1B\u591A\u5B57\u6BB5\u8BF7\u591A\u6B21 type \u6216\u914D\u5408 observe \u9010\u5B57\u6BB5\u64CD\u4F5C\uFF09\u3002\n\xB7 press_key\uFF1A\u5728\u7126\u70B9\u5143\u7D20\u6216\u6307\u5B9A selector \u4E0A\u6309\u952E\uFF0C\u53EF\u5E26 Ctrl/Shift/Alt/Meta \u4FEE\u9970\u952E\u3002\n\xB7 \u81EA\u52A8 observe\uFF1Aclick/double_click/right_click/type/press_key \u6267\u884C\u540E\u4F1A\u81EA\u52A8\u68C0\u6D4B\u9875\u9762\u662F\u5426\u53D8\u5316\u5E76\u7B49\u5F85\u52A0\u8F7D\u5B8C\u6BD5\uFF1B\u82E5\u53D8\u5316\uFF0C\u7ED3\u679C\u91CC\u9644\u5E26\u589E\u91CF observe\uFF08observe.delta=true\uFF09\uFF0C\u53EA\u8FD4\u56DE\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u65B0\u589E/\u53D8\u5316/\u6D88\u5931\u7684\u5143\u7D20\uFF0C\u5B8C\u6574\u5FEB\u7167\u4E0D\u518D\u91CD\u590D\u8FD4\u56DE\uFF1B\u672A\u53D8\u5316\u5219 page_changed:false\u3002\u4E0D\u9700\u8981\u65F6\u4F20 observe_after:false \u5173\u95ED\u3002\n\u7528\u9014\uFF1A\u7EDF\u4E00\u7684\u70B9\u51FB/\u6EDA\u52A8/\u8F93\u5165/\u952E\u76D8\u5165\u53E3\u3002\u573A\u666F\uFF1A\u5148 browser_observe \u62FF\u5230\u7F16\u53F7\uFF0C\u518D browser_action {action:"click", ref:id} \u70B9\u51FB\uFF1B\u70B9\u51FB\u540E\u82E5\u9875\u9762\u53D8\u4E86\uFF0C\u76F4\u63A5\u8BFB observe.items / addedItems / changedItems / removedItems \u91CC\u7684\u53D8\u5316\u5143\u7D20\u7EE7\u7EED\u64CD\u4F5C\uFF1B\u9700\u8981\u5168\u91CF\u65F6\u518D\u8C03\u7528 browser_observe\u3002',
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["click", "double_click", "right_click", "scroll", "type", "press_key"], description: "\u8981\u6267\u884C\u7684\u4EA4\u4E92\u52A8\u4F5C\u3002" },
          // 通用定位（click/double_click/right_click 用；type/press_key 可用 selector 聚焦）
          ref: { type: ["number", "string"], description: 'browser_observe \u8FD4\u56DE\u7684\u5143\u7D20\u7F16\u53F7 id\uFF08click/double_click/right_click/type \u5747\u53EF\u7528\uFF09\uFF0C\u6700\u7A33\u7684\u5B9A\u4F4D\u65B9\u5F0F\uFF0C\u4F18\u5148\u4F7F\u7528\u3002\u4E3B\u9875\u9762\u5143\u7D20\u662F\u6570\u5B57\uFF1B\u8DE8\u57DF iframe \u5185\u7684\u5143\u7D20 id \u5F62\u5982 "3:5"\uFF08frameId:\u672C\u5730\u7F16\u53F7\uFF09\uFF0C\u539F\u6837\u56DE\u4F20\u5373\u53EF\uFF0C\u4F1A\u81EA\u52A8\u8DEF\u7531\u5230\u5BF9\u5E94\u6846\u67B6\u3002' },
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\uFF08click/double_click/right_click \u5B9A\u4F4D\uFF1Btype \u6307\u5B9A\u8F93\u5165\u6846\uFF1Bpress_key \u6307\u5B9A\u5148\u805A\u7126\u7684\u5143\u7D20\uFF1Bscroll \u53EF\u6307\u5B9A\u6EDA\u52A8\u8FDB\u89C6\u53E3\u7684\u5143\u7D20\uFF09\u3002" },
          text: { type: "string", description: "action=click/double_click/right_click \u65F6\u7528\u53EF\u89C1\u6587\u672C\u5B9A\u4F4D\u5143\u7D20\uFF1Baction=type \u65F6\u4E3A\u300C\u8981\u8F93\u5165\u7684\u6587\u672C\u300D\u3002" },
          x: { type: "number", description: "click/double_click/right_click \u7684 X \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002" },
          y: { type: "number", description: "click/double_click/right_click \u7684 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002" },
          force: { type: "boolean", description: "action=click \u65F6\u4E3A true \u5373\u4F7F\u88AB\u906E\u6321\u4E5F\u5F3A\u5236\u70B9\u51FB\uFF1B\u9ED8\u8BA4 false\uFF1A\u88AB\u906E\u6321\u8FD4\u56DE occluded \u8BCA\u65AD\u3002" },
          // scroll
          direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "action=scroll \u7684\u65B9\u5411\uFF1Aup \u4E0A\u3001down \u4E0B\u3001top \u5230\u9876\u3001bottom \u5230\u5E95\u3002" },
          amount: { type: "number", description: "action=scroll \u7684\u6EDA\u52A8\u50CF\u7D20\u6570\u3002\u9ED8\u8BA4 400\u3002" },
          // type
          clear_first: { type: "boolean", description: "action=type \u65F6\u8F93\u5165\u524D\u5148\u6E05\u7A7A\u5B57\u6BB5\u3002\u9ED8\u8BA4 true\u3002" },
          submit: { type: "boolean", description: "action=type \u65F6\u8F93\u5165\u540E\u6309\u56DE\u8F66\u63D0\u4EA4\u3002" },
          // press_key
          key: { type: "string", description: 'action=press_key \u7684\u952E\u540D\uFF0C\u5982 "Enter"\u3001"Escape"\u3001"Tab"\u3001"ArrowDown"\u3001"a"\u3002' },
          ctrl: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Ctrl\u3002" },
          shift: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Shift\u3002" },
          alt: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Alt\u3002" },
          meta: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Meta/Cmd\u3002" },
          // 自动 observe（click/double_click/right_click/type/press_key 生效）
          observe_after: { type: "boolean", description: "\u70B9\u51FB/\u8F93\u5165/\u6309\u952E\u540E\u82E5\u9875\u9762\u53D8\u5316\uFF0C\u662F\u5426\u81EA\u52A8\u7B49\u5F85\u52A0\u8F7D\u5E76\u5728\u7ED3\u679C\u91CC\u9644\u5E26\u589E\u91CF observe\uFF08\u53EA\u663E\u793A\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u7684\u53D8\u5316\u5143\u7D20\uFF09\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u5173\u95ED\u3002" },
          settle_timeout: { type: "number", description: "\u81EA\u52A8 observe\uFF1A\u7B49\u5F85\u9875\u9762\u53D8\u5316\u7A33\u5B9A\u7684\u6700\u957F\u65F6\u95F4\uFF08\u6BEB\u79D2\uFF0C\u9ED8\u8BA4 3000\uFF0C\u4E0A\u9650 8000\uFF09\uFF1B\u9047\u5230\u6301\u7EED\u52A0\u8F7D/\u52A8\u753B\u65F6\u5230\u6B64\u4E0A\u9650\u5373\u6536\u5C3E\u5E76 observe\u3002" },
          wait_timeout_ms: { type: "number", description: "\u672C\u6B21 action \u540E\u7F6E\u7B49\u5F85\u7684\u6700\u5927\u65F6\u957F\uFF08\u6BEB\u79D2\uFF0C\u9ED8\u8BA4 3000\uFF0C\u4E0A\u9650 8000\uFF09\uFF1B\u7528\u4E8E\u7B49\u5F85\u9875\u9762\u53D8\u5316\u7A33\u5B9A\u5E76\u9650\u5236\u81EA\u52A8 observe \u7684\u7B49\u5F85\u3002" },
          max_wait_ms: { type: "number", description: "wait_timeout_ms \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          observe_timeout_ms: { type: "number", description: "action \u540E\u89E6\u53D1\u81EA\u52A8 observe \u65F6\uFF0Cobserve \u672C\u8EAB\u7684\u6700\u5927\u7B49\u5F85/\u626B\u63CF\u65F6\u957F\uFF08\u6BEB\u79D2\uFF09\uFF1B\u4E0D\u4F20\u65F6\u8DDF\u968F wait_timeout_ms / settle_timeout\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_wait",
      description: "\u7B49\u5F85\u67D0\u4E2A CSS selector \u51FA\u73B0\uFF0C\u6216\u56FA\u5B9A\u7B49\u5F85\u4E00\u6BB5\u65F6\u95F4\u3002\u7528\u9014\uFF1A\u7B49\u5F85\u9875\u9762/\u5143\u7D20\u5C31\u7EEA\u540E\u518D\u64CD\u4F5C\u3002\u573A\u666F\uFF1A\u7B49\u5F02\u6B65\u52A0\u8F7D\u7684\u6309\u94AE\u51FA\u73B0\u3001\u7B49\u52A8\u753B\u7ED3\u675F\u3001\u7ED9\u9875\u9762\u7559\u51FA\u6E32\u67D3\u65F6\u95F4\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u7B49\u5F85\u51FA\u73B0\u7684 CSS \u5143\u7D20\u3002" },
          ms: { type: "number", description: "\u56FA\u5B9A\u7B49\u5F85\u7684\u6BEB\u79D2\u6570\u3002" }
        }
      }
    },
    {
      name: "browser_drag",
      description: "\u4ECE\u6E90\u5143\u7D20/\u70B9\u62D6\u62FD drag \u5230\u76EE\u6807\u5143\u7D20/\u70B9\u5E76\u653E\u4E0B\uFF0C\u89E6\u53D1 HTML5\u3001pointer \u548C mouse \u4E8B\u4EF6\uFF0C\u5E76\u8FD4\u56DE\u6E90\u662F\u5426\u660E\u663E\u79FB\u52A8\u7684\u8BCA\u65AD\u4FE1\u606F\u3002\u7528\u9014\uFF1A\u62D6\u653E\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u62D6\u52A8\u6392\u5E8F\u3001\u628A\u5143\u7D20\u62D6\u5165\u6295\u653E\u533A\u3001\u6ED1\u5757\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6E90\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u6E90\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "\u6E90\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "\u6E90\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20 CSS selector\u3002" },
          to_text: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          to_x: { type: "number", description: "\u76EE\u6807\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_y: { type: "number", description: "\u76EE\u6807\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    // ───── 数据与脚本 ─────────────────────────────────────────────────────
    {
      name: "browser_evaluate",
      description: "\u5728\u9875\u9762\u4E0A\u4E0B\u6587\u4E2D\u6267\u884C\u4EFB\u610F JavaScript \u5E76\u8FD4\u56DE\u7ED3\u679C\uFF1B\u53EF\u7528\u65F6\u8D70 Chrome DevTools Protocol\uFF0C\u56E0\u6B64\u5728 CSP \u53D7\u9650\u9875\u9762\u4E0A\u4E5F\u80FD\u8FD0\u884C\u3002\u7528\u9014\uFF1A\u9AD8\u7EA7\u53D6\u6570/\u64CD\u4F5C\u7684\u515C\u5E95\u624B\u6BB5\u3002\u573A\u666F\uFF1A\u5185\u7F6E\u5DE5\u5177\u65E0\u6CD5\u6EE1\u8DB3\u65F6\u8BFB\u53D6\u590D\u6742\u6570\u636E\u6216\u89E6\u53D1\u7279\u6B8A\u884C\u4E3A\uFF08\u8BF7\u8C28\u614E\u4F7F\u7528\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "\u8981\u6267\u884C\u7684 JavaScript \u8868\u8FBE\u5F0F\u6216\u8BED\u53E5\u3002" },
          function: { type: "string", description: "code \u7684\u522B\u540D\uFF0C\u4FDD\u7559\u517C\u5BB9\u3002" },
          fn: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          expression: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          trace: { type: "boolean", description: "\u5931\u8D25\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7684 {error, code, suggestion, trace}\u3002" }
        }
      }
    },
    {
      name: "browser_extract",
      description: "\u4ECE\u5339\u914D selector \u7684\u5143\u7D20\u4E2D\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E\uFF0C\u8FD4\u56DE\u5E26 tag\u3001selector\u3001\u6587\u672C\u3001\u5C5E\u6027\u53CA\u5E38\u7528\u5C5E\u6027\u522B\u540D\u7684\u5F52\u4E00\u5316\u6761\u76EE\u3002\u7528\u9014\uFF1A\u6279\u91CF\u6293\u53D6\u5217\u8868/\u8868\u683C\u3002\u573A\u666F\uFF1A\u6293\u53D6\u641C\u7D22\u7ED3\u679C\u3001\u5546\u54C1\u5217\u8868\u3001\u8868\u683C\u884C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u67E5\u8BE2\u7684 CSS selector\u3002" },
          attributes: { type: "array", items: { type: "string" }, description: "\u6BCF\u4E2A\u5143\u7D20\u9700\u8981\u91C7\u96C6\u7684\u5C5E\u6027\u540D\u5217\u8868\u3002" },
          limit: { type: "number", description: "\u6700\u591A\u63D0\u53D6\u7684\u5143\u7D20\u6570\u3002\u9ED8\u8BA4 50\u3002" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_clipboard_write",
      description: "\u628A\u6587\u672C\u5199\u5165\u7CFB\u7EDF\u526A\u8D34\u677F\u3002\u7528\u9014\uFF1A\u590D\u5236\u5185\u5BB9\u4F9B\u5176\u4ED6\u7A0B\u5E8F\u7C98\u8D34\u3002\u573A\u666F\uFF1A\u590D\u5236\u63D0\u53D6\u5230\u7684\u7ED3\u679C\u3001\u590D\u5236\u751F\u6210\u7684\u94FE\u63A5\u3002",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "\u8981\u590D\u5236\u5230\u526A\u8D34\u677F\u7684\u6587\u672C\u3002" } },
        required: ["text"]
      }
    },
    {
      name: "browser_file_upload",
      description: "\u7528\u5185\u5B58\u4E2D\u7684\u6587\u4EF6\u5185\u5BB9\u586B\u5145 <input type=file>\u3002\u6CE8\u610F\uFF1A\u6269\u5C55\u65E0\u6CD5\u8BFB\u53D6\u672C\u673A\u6587\u4EF6\u7CFB\u7EDF\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F4\u63A5\u63D0\u4F9B\u5185\u5BB9\u3002\u7528\u9014\uFF1A\u4E0A\u4F20\u6587\u4EF6\u3002\u573A\u666F\uFF1A\u628A\u4E00\u6BB5\u6587\u672C/base64 \u5185\u5BB9\u4F5C\u4E3A\u6587\u4EF6\u4E0A\u4F20\u5230\u7F51\u9875\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6587\u4EF6\u8F93\u5165\u6846\u7684 CSS selector\u3002\u9ED8\u8BA4 input[type=file]\u3002" },
          files: {
            type: "array",
            description: '\u8981\u5408\u6210\u7684\u6587\u4EF6\uFF0C\u4F8B\u5982 [{name:"a.txt", content:"hello", type:"text/plain"}]\uFF0C\u6216\u8BBE\u7F6E encoding:"base64"\u3002',
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "\u6587\u4EF6\u540D\u3002" },
                content: { type: "string", description: "\u6587\u4EF6\u5185\u5BB9\uFF08\u6309 encoding \u89E3\u91CA\uFF09\u3002" },
                type: { type: "string", description: "MIME \u7C7B\u578B\uFF0C\u5982 text/plain\u3002" },
                encoding: { type: "string", enum: ["text", "base64"], description: "content \u7684\u7F16\u7801\uFF1Atext \u7EAF\u6587\u672C\u6216 base64\u3002" }
              },
              required: ["name", "content"]
            }
          }
        },
        required: ["files"]
      }
    },
    {
      name: "browser_download",
      description: "\u901A\u8FC7 chrome.downloads \u4ECE\u67D0\u4E2A URL \u53D1\u8D77\u6D4F\u89C8\u5668\u4E0B\u8F7D\u3002\u7528\u9014\uFF1A\u4FDD\u5B58\u6587\u4EF6\u5230\u672C\u5730\u4E0B\u8F7D\u76EE\u5F55\u3002\u573A\u666F\uFF1A\u4E0B\u8F7D\u5BFC\u51FA\u6587\u4EF6\u3001\u56FE\u7247\u3001\u9644\u4EF6\u3002",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "\u8981\u4E0B\u8F7D\u7684 URL\u3002" },
          filename: { type: "string", description: "\u53EF\u9009\uFF1A\u4E0B\u8F7D\u76EE\u5F55\u4E0B\u7684\u76F8\u5BF9\u6587\u4EF6\u540D\u3002" },
          save_as: { type: "boolean", description: "\u663E\u793A\u300C\u53E6\u5B58\u4E3A\u300D\u5BF9\u8BDD\u6846\u3002" }
        },
        required: ["url"]
      }
    },
    // ───── 浏览器状态（资源 + action）────────────────────────────────────
    {
      name: "browser_tab",
      description: "\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\u7BA1\u7406\uFF1A\u5217\u51FA\u5DF2\u6253\u5F00\u9875\u9762\u3001\u5207\u6362\u6807\u7B7E\u3001\u5728\u5F53\u524D\u9875\u8986\u76D6\u8DF3\u8F6C\u3001\u65B0\u6807\u7B7E\u6253\u5F00\u94FE\u63A5\u3001\u5173\u95ED\u6807\u7B7E\u3001\u524D\u8FDB\u540E\u9000\u3002\u52A8\u4F5C\u4EC5 7 \u79CD\uFF1Alist \u83B7\u53D6\u5168\u90E8\u9875\u9762\u53CA\u5F53\u524D\u6FC0\u6D3B\u9875\uFF1Bswitch \u5207\u6362\u5230\u5DF2\u6709 tab_id\uFF1Breplace \u5728\u5F53\u524D\u9875\uFF08\u6216 tab_id\uFF09\u8986\u76D6\u8DF3\u8F6C\u5230 url\uFF1Bnavigate \u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00 url\uFF1Bclose \u5173\u95ED\u6807\u7B7E\uFF1Bback/forward \u5386\u53F2\u5BFC\u822A\u3002\u6D41\u7A0B\uFF1A\u5148 list\uFF0C\u76EE\u6807\u9875\u5DF2\u5F00\u5219 switch\uFF0C\u8981\u5728\u5F53\u524D\u9875\u6539\u5730\u5740\u7528 replace\uFF0C\u5E76\u884C\u4EFB\u52A1\u7528 navigate\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "switch", "replace", "navigate", "close", "back", "forward"], description: "list \u5217\u51FA\u5168\u90E8\u6807\u7B7E\u5E76\u8FD4\u56DE activeTab\uFF1Bswitch \u5207\u6362\u5230 tab_id\uFF08\u4E0D\u6539 URL\uFF09\uFF1Breplace \u5728\u5F53\u524D/\u6307\u5B9A\u6807\u7B7E\u8986\u76D6\u8DF3\u8F6C\u5230 url\uFF1Bnavigate \u5728\u65B0\u6807\u7B7E\u6253\u5F00 url\uFF1Bclose \u5173\u95ED tab_id\uFF08\u9ED8\u8BA4\u5F53\u524D\u6807\u7B7E\uFF09\uFF1Bback/forward \u540E\u9000/\u524D\u8FDB\u4E00\u6B65\u3002" },
          url: { type: "string", description: "action=replace / navigate \u65F6\u8981\u6253\u5F00\u7684 URL\uFF08\u7F3A\u534F\u8BAE\u65F6\u6309 https \u8865\u5168\uFF09\u3002" },
          tab_id: { type: "number", description: "action=switch \u5FC5\u586B\uFF1Baction=close/replace/back/forward \u53EF\u9009\uFF0C\u6307\u5B9A\u76EE\u6807\u6807\u7B7E\uFF0C\u9ED8\u8BA4\u5F53\u524D\u6D3B\u52A8\u6807\u7B7E\u3002" },
          tabId: { type: "number", description: "tab_id \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          id: { type: "number", description: "tab_id \u7684\u517C\u5BB9\u522B\u540D\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_cookie",
      description: "\u7BA1\u7406\u5F53\u524D\u6807\u7B7E\u9875 URL \u6216\u6307\u5B9A URL/\u57DF\u540D\u7684 cookie\uFF1A\u5217\u51FA\u3001\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u4F1A\u8BDD\u72B6\u6001\u3002\u573A\u666F\uFF1A\u68C0\u67E5\u767B\u5F55\u6001\uFF08list/get\uFF09\u3001\u6CE8\u5165\u767B\u5F55/\u504F\u597D cookie\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u9000\u51FA\u767B\u5F55\uFF08delete\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "set", "delete"], description: "\u52A8\u4F5C\uFF1Alist \u5217\u51FA\u3001get \u6309 name \u53D6\u5355\u4E2A\u3001set \u5199\u5165\u3001delete \u5220\u9664\u3002" },
          url: { type: "string", description: "cookie \u6240\u5C5E URL\u3002\u9ED8\u8BA4\u5F53\u524D\u6807\u7B7E\u9875 URL\u3002" },
          domain: { type: "string", description: "action=list \u65F6\u53EF\u6309\u57DF\u540D\u8FC7\u6EE4\u3002" },
          name: { type: "string", description: "cookie \u540D\u79F0\uFF08get/set/delete \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u7684 cookie \u503C\u3002" },
          path: { type: "string", description: "action=set \u65F6\u7684 cookie \u8DEF\u5F84\u3002" },
          secure: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u4EC5 HTTPS \u4F20\u8F93\u3002" },
          http_only: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u6807\u8BB0 HttpOnly\u3002" },
          expiration_date: { type: "number", description: "action=set \u65F6\u7684\u8FC7\u671F\u65F6\u95F4\uFF08Unix \u79D2\uFF09\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_storage",
      description: "\u8BFB\u5199\u5F53\u524D\u9875\u9762\u7684 localStorage / sessionStorage\uFF1A\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3001\u5217\u51FA key\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u524D\u7AEF\u5B58\u50A8\u72B6\u6001\u3002\u573A\u666F\uFF1A\u8BFB\u53D6 token/\u504F\u597D\uFF08get/list\uFF09\u3001\u6CE8\u5165\u6807\u8BB0\u4F4D\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u6E05\u9664\u7F13\u5B58\u9879\uFF08remove\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "remove", "list"], description: "\u52A8\u4F5C\uFF1Aget \u8BFB\u53D6 key\u3001set \u5199\u5165 key\u3001remove \u5220\u9664 key\u3001list \u5217\u51FA key\u3002" },
          type: { type: "string", enum: ["local", "session"], description: "\u5B58\u50A8\u7C7B\u578B\uFF1Alocal \u6216 session\u3002\u9ED8\u8BA4 local\u3002" },
          key: { type: "string", description: "\u5B58\u50A8\u952E\u540D\uFF08get/set/remove \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u8981\u5B58\u50A8\u7684\u503C\u3002" },
          prefix: { type: "string", description: "action=list \u65F6\u6309\u952E\u540D\u524D\u7F00\u8FC7\u6EE4\u3002" },
          include_values: { type: "boolean", description: "action=list \u65F6\u5728\u7ED3\u679C\u4E2D\u5305\u542B value\u3002" },
          limit: { type: "number", description: "action=list \u65F6\u6700\u591A\u8FD4\u56DE\u7684 key/\u6761\u76EE\u6570\u3002\u9ED8\u8BA4 100\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_session",
      description: "\u7BA1\u7406\u8F7B\u91CF\u6D4F\u89C8\u5668\u4E0A\u4E0B\u6587\u5FEB\u7167\uFF08\u5F53\u524D URL/\u6807\u9898 + \u8BE5\u9875 localStorage/sessionStorage\uFF09\uFF1A\u4FDD\u5B58\u3001\u5217\u51FA\u3001\u6062\u590D\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u7559\u5B58\u5E76\u56DE\u5230\u6B64\u524D\u7684\u4F1A\u8BDD\u73B0\u573A\u3002\u573A\u666F\uFF1A\u4FDD\u5B58\u767B\u5F55\u6001\u7A0D\u540E\u6062\u590D\uFF08save/restore\uFF09\u3001\u67E5\u770B\u53EF\u6062\u590D\u4F1A\u8BDD\uFF08list\uFF09\u3001\u6E05\u7406\u8FC7\u671F\u5FEB\u7167\uFF08delete\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "list", "restore", "delete"], description: "\u52A8\u4F5C\uFF1Asave \u4FDD\u5B58\u5F53\u524D\u73B0\u573A\u3001list \u5217\u51FA\u5FEB\u7167\u3001restore \u6062\u590D\u5FEB\u7167\u3001delete \u5220\u9664\u5FEB\u7167\u3002" },
          id: { type: "string", description: "\u4F1A\u8BDD id\uFF08restore/delete \u7528\uFF0Csave \u53EF\u9009\uFF09\u3002" },
          name: { type: "string", description: "\u4FBF\u4E8E\u8BC6\u522B\u7684\u4F1A\u8BDD\u540D\u79F0\uFF08restore/delete \u4E5F\u53EF\u6309 name \u5B9A\u4F4D\uFF09\u3002" },
          new_tab: { type: "boolean", description: "action=restore \u65F6\u5728\u65B0\u6807\u7B7E\u9875\u4E2D\u6062\u590D\u3002" }
        },
        required: ["action"]
      }
    }
  ];
  var BROWSER_CAPABILITIES = BROWSER_TOOLS.map((t) => t.name);
  var BROWSER_TOOL_KIND_LABELS = {
    basic: "\u57FA\u7840\u7C7B",
    special: "\u7279\u6B8A\u7C7B"
  };
  var BROWSER_TOOL_CATEGORIES = [
    {
      title: "\u5BFC\u822A\u4E0E\u641C\u7D22",
      kind: "basic",
      // browser_tab 现已涵盖跳转 URL / 前进后退 / 列出标签等页面级导航，归入此类。
      tools: ["browser_tab"]
    },
    {
      title: "\u9875\u9762\u89C2\u5BDF",
      kind: "basic",
      tools: ["browser_observe", "browser_screenshot"]
    },
    {
      title: "\u9875\u9762\u4EA4\u4E92",
      kind: "basic",
      // browser_action 聚合了点击/双击/右键/滚动/输入/键盘按键。
      tools: ["browser_action", "browser_wait", "browser_drag"]
    },
    {
      title: "\u6570\u636E\u4E0E\u811A\u672C",
      kind: "special",
      tools: [
        "browser_evaluate",
        "browser_extract",
        "browser_clipboard_write",
        "browser_file_upload",
        "browser_download"
      ]
    },
    {
      title: "\u6D4F\u89C8\u5668\u72B6\u6001",
      kind: "special",
      tools: ["browser_cookie", "browser_storage", "browser_session"]
    }
  ];
  function browserToolKind(name) {
    const tool = String(name || "").trim();
    for (const cat of BROWSER_TOOL_CATEGORIES) {
      if (cat.tools.includes(tool))
        return cat.kind;
    }
    return "basic";
  }

  // src/lib/tools/browser.ts
  var SPECIAL_KEY_INFO = {
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    Return: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
    Insert: { key: "Insert", code: "Insert", windowsVirtualKeyCode: 45 },
    Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
    End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
    PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
    PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
    Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
    " ": { key: " ", code: "Space", windowsVirtualKeyCode: 32 }
  };
  for (let i = 1; i <= 12; i++) {
    SPECIAL_KEY_INFO[`F${i}`] = { key: `F${i}`, code: `F${i}`, windowsVirtualKeyCode: 111 + i };
  }

  // src/lib/tools/dynamic.ts
  var DYNAMIC_MCP_STORAGE_KEY = "_dynamic_mcp_tools";
  var DYNAMIC_MCP_SERVER_STORAGE_KEY = "_dynamic_mcp_server_tools";
  var DYNAMIC_MCP_SERVER_SESSION_KEY = "_dynamic_mcp_server_session";
  var DYNAMIC_MCP_MANAGER_NAME = "mcp.manage_dynamic_tool";
  var BROWSER_DYNAMIC_MCP_MANAGER_NAME = "browser_mcp.manage_dynamic_tool";
  var NAME_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
  function isManagerName(name) {
    return name === DYNAMIC_MCP_MANAGER_NAME || name === BROWSER_DYNAMIC_MCP_MANAGER_NAME;
  }
  function validate(raw) {
    const name = String(raw?.name || "").trim();
    if (!NAME_RE.test(name))
      throw new Error(`Invalid dynamic MCP name: ${name || "(empty)"}`);
    if (isManagerName(name))
      throw new Error(`${name} is reserved`);
    const description = String(raw?.description || "").trim();
    if (!description)
      throw new Error(`Dynamic MCP ${name} requires description`);
    const inputSchema = raw?.input_schema ?? raw?.inputSchema;
    if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema))
      throw new Error(`Dynamic MCP ${name} requires input_schema`);
    const code = typeof raw?.code === "string" ? JSON.parse(raw.code) : raw?.code;
    if (!Array.isArray(code) || !code.length || code.length > 32)
      throw new Error(`Dynamic MCP ${name} code must contain 1-32 instructions`);
    for (const step of code) {
      if (!step || !["call", "set", "return"].includes(step.op))
        throw new Error(`Invalid instruction in ${name}`);
      if (step.op === "call" && !String(step.tool || "").trim())
        throw new Error(`call instruction in ${name} requires tool`);
      if (step.op === "set" && !String(step.name || "").trim())
        throw new Error(`set instruction in ${name} requires name`);
    }
    return { name, description, input_schema: inputSchema, code };
  }
  async function getDynamicMcpDefinitions() {
    const stored = (await chrome.storage.local.get(DYNAMIC_MCP_STORAGE_KEY))[DYNAMIC_MCP_STORAGE_KEY];
    const list = Array.isArray(stored) ? stored : stored?.tools;
    if (list == null)
      return [];
    if (!Array.isArray(list))
      throw new Error("Dynamic MCP storage must contain a tools array");
    const tools = list.map(validate);
    if (new Set(tools.map((item) => item.name)).size !== tools.length)
      throw new Error("Duplicate dynamic MCP name");
    return tools;
  }
  async function readServerSession() {
    try {
      const stored = (await chrome.storage.session.get(DYNAMIC_MCP_SERVER_SESSION_KEY))[DYNAMIC_MCP_SERVER_SESSION_KEY];
      const tools = Array.isArray(stored?.tools) ? stored.tools : [];
      const rev = typeof stored?.revision === "string" ? stored.revision : "";
      return { revision: rev, tools };
    } catch {
      return { revision: "", tools: [] };
    }
  }
  async function getServerDynamicMcpDefinitions() {
    return (await readServerSession()).tools;
  }
  async function purgeLegacyServerCache() {
    await chrome.storage.local.remove(DYNAMIC_MCP_SERVER_STORAGE_KEY);
  }
  void purgeLegacyServerCache();
  async function getMergedDynamicMcpDefinitions() {
    const [local, server] = await Promise.all([getDynamicMcpDefinitions(), getServerDynamicMcpDefinitions()]);
    const serverNames = new Set(server.map((item) => item.name));
    const byName = /* @__PURE__ */ new Map();
    for (const def of local)
      byName.set(def.name, def);
    for (const def of server)
      byName.set(def.name, def);
    return { merged: Array.from(byName.values()), serverNames };
  }
  var DYNAMIC_MCP_MANAGER_DEF = {
    name: DYNAMIC_MCP_MANAGER_NAME,
    description: "\u52A8\u6001\u7BA1\u7406\u672C\u6D4F\u89C8\u5668\u8BBE\u5907\u7684\u4F20\u627F MCP \u4EE3\u7801\u3002\u53EF\u8BFB\u53D6\u3001\u521B\u5EFA\u3001\u66F4\u65B0\u3001\u5220\u9664\u5E76\u70ED\u52A0\u8F7D JSON \u7A0B\u5E8F\u5DE5\u5177\uFF1B\u4F7F\u7528\u73B0\u6709\u5DE5\u5177\u540D\u53EF\u8986\u76D6\u5185\u7F6E\u5B9E\u73B0\uFF0C\u5220\u9664\u540E\u6062\u590D\u5185\u7F6E\u7248\u672C\uFF1B\u4FDD\u5B58\u540E\u4F1A\u7ACB\u5373\u5411\u670D\u52A1\u5668\u91CD\u65B0\u4E0A\u62A5\u5DE5\u5177\u76EE\u5F55\u3002",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "inspect", "get_source", "upsert", "delete", "reload"], description: "\u7BA1\u7406\u52A8\u4F5C\u3002inspect \u9ED8\u8BA4\u8FD4\u56DE\u5B9E\u73B0\u6E90\u7801\uFF1Bget_source \u53EF\u6309\u5DE5\u5177\u540D\u8BFB\u53D6\u5168\u90E8\u76F8\u5173\u6E90\u7801\u3002" },
        name: { type: "string", description: "MCP \u540D\u79F0\uFF0C\u5982 browser_action \u6216 custom.collect_page\u3002get_source \u53EA\u4F20\u540D\u79F0\u5373\u53EF\u8BFB\u53D6\u6E90\u7801\u3002" },
        source_path: { type: "string", description: "\u53EF\u9009\u76F8\u5BF9\u6E90\u7801\u8DEF\u5F84\uFF1B\u8BFB\u53D6\u5931\u8D25\u4F46\u63D0\u4F9B name \u65F6\u4F1A\u81EA\u52A8\u6309\u5DE5\u5177\u540D\u67E5\u627E\u3002" },
        include_source: { type: "boolean", description: "inspect \u662F\u5426\u9644\u5E26\u5B8C\u6574\u6E90\u7801\uFF0C\u9ED8\u8BA4 true\u3002" },
        expected_revision: { type: "string", description: "get \u8FD4\u56DE\u7684\u4FEE\u8BA2\u54C8\u5E0C\uFF1B\u66F4\u65B0/\u5220\u9664\u65F6\u7528\u4E8E\u9632\u6B62\u8986\u76D6\u5E76\u53D1\u4FEE\u6539\u3002" },
        definition: {
          type: "object",
          description: "upsert \u4F7F\u7528\u7684\u5B8C\u6574\u52A8\u6001 MCP \u5B9A\u4E49\u3002",
          properties: {
            name: { type: "string", description: "\u5DE5\u5177\u540D\uFF1B\u4E0E\u5185\u7F6E\u5DE5\u5177\u540C\u540D\u65F6\u8986\u76D6\u5185\u7F6E\u5B9E\u73B0\u3002" },
            description: { type: "string", description: "\u5411 AI \u5C55\u793A\u7684\u5DE5\u5177\u8BF4\u660E\u3002" },
            input_schema: { type: "object", description: "JSON Schema \u5165\u53C2\u5B9A\u4E49\u3002" },
            code: { type: "array", minItems: 1, maxItems: 32, description: "call/set/return \u6307\u4EE4\uFF1B\u6A21\u677F\u652F\u6301 ${args.x}\u3001${vars.x}\u3001${last.x}\u3002", items: { type: "object" } }
          },
          required: ["name", "description", "input_schema", "code"]
        }
      },
      required: ["action"]
    },
    implementation: {
      kind: "builtin_manager",
      source_files: ["src/lib/tools/dynamic.ts", "dist/background.js"],
      editable_via: DYNAMIC_MCP_MANAGER_NAME
    }
  };
  var BROWSER_DYNAMIC_MCP_MANAGER_DEF = {
    ...DYNAMIC_MCP_MANAGER_DEF,
    name: BROWSER_DYNAMIC_MCP_MANAGER_NAME,
    description: "\u52A8\u6001\u7BA1\u7406\u672C\u6D4F\u89C8\u5668\u8BBE\u5907\u7684\u4F20\u627F MCP \u4EE3\u7801\u3002\u53EF\u8BFB\u53D6\u6D4F\u89C8\u5668\u5DE5\u5177\u6E90\u7801\u3001\u521B\u5EFA\u6216\u8986\u76D6\u5DE5\u5177\uFF0C\u5E76\u5728\u4FDD\u5B58\u540E\u7ACB\u5373\u70ED\u52A0\u8F7D\u548C\u91CD\u65B0\u4E0A\u62A5\u3002",
    implementation: {
      ...DYNAMIC_MCP_MANAGER_DEF.implementation,
      editable_via: BROWSER_DYNAMIC_MCP_MANAGER_NAME
    }
  };
  function isServerManagedToolDef(tool) {
    const impl = tool.implementation;
    if (!impl || typeof impl !== "object")
      return false;
    return impl.source === "server" || impl.storage_key === "memory:server";
  }
  async function dynamicMcpToolDefs() {
    const { merged, serverNames } = await getMergedDynamicMcpDefinitions();
    return [BROWSER_DYNAMIC_MCP_MANAGER_DEF, ...merged.map((def) => {
      const fromServer = serverNames.has(def.name);
      return {
        name: def.name,
        description: def.description,
        input_schema: def.input_schema,
        implementation: {
          kind: "dynamic",
          definition: def,
          code: def.code,
          storage_key: fromServer ? "memory:server" : DYNAMIC_MCP_STORAGE_KEY,
          source: fromServer ? "server" : "local",
          editable_via: BROWSER_DYNAMIC_MCP_MANAGER_NAME
        }
      };
    })];
  }

  // src/lib/tools/overrides.ts
  async function allToolDefs() {
    return await dynamicMcpToolDefs();
  }

  // src/popup/mcp-demos.ts
  var DEMOS = {
    browser_screenshot: {
      label: "\u622A\u56FE\u65F6\u5148\u9AD8\u4EAE\u53D6\u666F\u6846\u5E76\u626B\u63CF\uFF0C\u5B8C\u6210\u540E\u95EA\u767D\u5FEB\u95E8\u53CD\u9988",
      scene: `
      <div class="mcp-demo-scene shot">
        <div class="demo-page"></div>
        <div class="demo-shot-frame"><div class="demo-shot-scan"></div></div>
        <div class="demo-shot-flash"></div>
      </div>`
    },
    browser_observe: {
      label: "\u626B\u63CF\u53EF\u4EA4\u4E92\u5143\u7D20\u5E76\u4F9D\u6B21\u6807\u6CE8\u7F16\u53F7\uFF0C\u4FBF\u4E8E\u622A\u56FE\u5BF9\u7167",
      scene: `
      <div class="mcp-demo-scene observe">
        <div class="demo-page"></div>
        <div class="demo-mark m1"><span>1</span></div>
        <div class="demo-mark m2"><span>2</span></div>
        <div class="demo-mark m3"><span>3</span></div>
      </div>`
    },
    browser_action: {
      label: "\u70B9\u51FB/\u8F93\u5165/\u6EDA\u52A8/\u6309\u952E\u65F6\uFF1A\u5149\u6807\u79FB\u52A8\u3001\u70B9\u51FB\u5149\u6655\u3001\u62D6\u62FD\u8F68\u8FF9\u7B49\u89C6\u89C9\u53CD\u9988",
      scene: `
      <div class="mcp-demo-scene click">
        <div class="demo-page"></div>
        <div class="demo-target"></div>
        <div class="demo-cursor"></div>
        <div class="demo-ripple r1"></div>
        <div class="demo-ripple r2"></div>
      </div>`
    },
    browser_drag: {
      label: "\u4ECE\u8D77\u70B9\u62D6\u5230\u7EC8\u70B9\uFF0C\u8DEF\u5F84\u4E0A\u7559\u4E0B\u6E10\u53D8\u62D6\u5C3E",
      scene: `
      <div class="mcp-demo-scene drag">
        <div class="demo-page"></div>
        <div class="demo-drag-from"></div>
        <div class="demo-drag-to"></div>
        <div class="demo-drag-line"></div>
        <div class="demo-cursor drag-cursor"></div>
      </div>`
    },
    browser_wait: {
      label: "\u7B49\u5F85\u9875\u9762\u52A0\u8F7D\u6216\u5143\u7D20\u51FA\u73B0\u65F6\u7684\u547C\u5438\u6307\u793A",
      scene: `
      <div class="mcp-demo-scene wait">
        <div class="demo-page"></div>
        <div class="demo-wait-ring"></div>
        <div class="demo-wait-dot"></div>
      </div>`
    }
  };
  function renderToolDemo(name) {
    const demo = DEMOS[name];
    if (!demo)
      return "";
    return `
    <div class="card mcp-demo-card">
      <div class="card-title">\u6548\u679C\u9884\u89C8</div>
      <div class="mcp-demo-wrap">
        ${demo.scene}
      </div>
      <div class="mcp-demo-caption">${demo.label}</div>
    </div>`;
  }

  // src/popup/mcp.ts
  var overrides = {};
  var currentToolDefs = [];
  var currentCategories = BROWSER_TOOL_CATEGORIES;
  var expandedKinds = /* @__PURE__ */ new Set();
  var KIND_META = {
    basic: { zh: "\u57FA\u7840\u7C7B", en: "BASIC" },
    special: { zh: "\u7279\u6B8A\u7C7B", en: "SPECIAL" }
  };
  var CATEGORY_META = {
    "\u5BFC\u822A\u4E0E\u641C\u7D22": { zh: "\u5BFC\u822A\u4E0E\u641C\u7D22", en: "NAVIGATION" },
    "\u9875\u9762\u89C2\u5BDF": { zh: "\u9875\u9762\u89C2\u5BDF", en: "OBSERVATION" },
    "\u9875\u9762\u4EA4\u4E92": { zh: "\u9875\u9762\u4EA4\u4E92", en: "INTERACTION" },
    "\u6570\u636E\u4E0E\u811A\u672C": { zh: "\u6570\u636E\u4E0E\u811A\u672C", en: "DATA & SCRIPT" },
    "\u6D4F\u89C8\u5668\u72B6\u6001": { zh: "\u6D4F\u89C8\u5668\u72B6\u6001", en: "BROWSER STATE" },
    "MCP \u52A8\u6001\u7BA1\u7406": { zh: "MCP \u52A8\u6001\u7BA1\u7406", en: "DYNAMIC MCP" }
  };
  var TOOL_LABELS = {
    browser_observe: { zh: "\u9875\u9762\u89C2\u5BDF", en: "Observe" },
    browser_screenshot: { zh: "\u9875\u9762\u622A\u56FE", en: "Screenshot" },
    browser_action: { zh: "\u9875\u9762\u4EA4\u4E92\uFF08\u70B9\u51FB/\u6EDA\u52A8/\u8F93\u5165/\u6309\u952E\uFF09", en: "Page Action" },
    browser_wait: { zh: "\u7B49\u5F85\u9875\u9762", en: "Wait" },
    browser_drag: { zh: "\u62D6\u62FD\u5143\u7D20", en: "Drag" },
    browser_evaluate: { zh: "\u6267\u884C\u811A\u672C", en: "Evaluate Script" },
    browser_extract: { zh: "\u63D0\u53D6\u6570\u636E", en: "Extract Data" },
    browser_clipboard_write: { zh: "\u5199\u5165\u526A\u8D34\u677F", en: "Write Clipboard" },
    browser_file_upload: { zh: "\u4E0A\u4F20\u6587\u4EF6", en: "File Upload" },
    browser_download: { zh: "\u4E0B\u8F7D\u6587\u4EF6", en: "Download" },
    browser_tab: { zh: "\u6807\u7B7E\u9875\uFF08list/switch/replace/navigate\uFF09", en: "Tab Management" },
    browser_cookie: { zh: "\u7BA1\u7406 Cookie", en: "Cookie Manager" },
    browser_storage: { zh: "\u7BA1\u7406\u5B58\u50A8", en: "Storage Manager" },
    browser_session: { zh: "\u7BA1\u7406\u4F1A\u8BDD", en: "Session Manager" },
    "browser_mcp.manage_dynamic_tool": { zh: "\u7BA1\u7406\u52A8\u6001 MCP", en: "Dynamic MCP Manager" }
  };
  function esc2(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function toTitleCase(value) {
    return String(value).replace(/^browser[_-]?/i, "").replace(/[._-]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }
  function toolMeta(name) {
    const fallback = toTitleCase(name);
    return TOOL_LABELS[name] || { zh: fallback, en: fallback };
  }
  function categoryMeta(title) {
    return CATEGORY_META[title] || { zh: title, en: toTitleCase(title).toUpperCase() };
  }
  function isEdited(tool) {
    if (isServerManagedToolDef(tool))
      return false;
    const o = overrides[tool.name];
    return !!(o && (o.description || o.parameters && Object.keys(o.parameters).length));
  }
  function effDescription(t) {
    if (isServerManagedToolDef(t))
      return t.description || "";
    return overrides[t.name]?.description?.trim() || t.description || "";
  }
  function effParamDesc(tool, param, raw) {
    if (isServerManagedToolDef(tool))
      return raw || "";
    return overrides[tool.name]?.parameters?.[param]?.trim() || raw || "";
  }
  function paramEntries(t) {
    const props = t.input_schema?.properties || {};
    const required = new Set(t.input_schema?.required || []);
    return Object.keys(props).map((p) => {
      const cfg = props[p] || {};
      const ty = Array.isArray(cfg.type) ? cfg.type.join("|") : cfg.type || "any";
      return { name: p, type: String(ty), required: required.has(p), desc: String(cfg.description || "") };
    });
  }
  async function renderMcpList() {
    state.openToolName = null;
    mcpDetailPane.classList.add("hidden");
    mcpListPane.classList.remove("hidden");
    overrides = await getToolDescOverrides();
    currentToolDefs = await allToolDefs();
    const categorized = new Set(BROWSER_TOOL_CATEGORIES.flatMap((category) => category.tools));
    const dynamicTools = currentToolDefs.map((tool) => tool.name).filter((name) => !categorized.has(name));
    currentCategories = dynamicTools.length ? [...BROWSER_TOOL_CATEGORIES, { title: "MCP \u52A8\u6001\u7BA1\u7406", kind: "special", tools: dynamicTools }] : BROWSER_TOOL_CATEGORIES;
    mcpCount.textContent = `${currentToolDefs.length} \u4E2A \xB7 ${currentCategories.length} \u7EC4`;
    mcpList.innerHTML = "";
    const byName = new Map(currentToolDefs.map((t) => [t.name, t]));
    const kinds = ["basic", "special"];
    for (const kind of kinds) {
      const cats = currentCategories.filter((c) => c.kind === kind);
      if (!cats.length)
        continue;
      const kindTools = cats.flatMap((c) => c.tools).filter((n) => byName.has(n));
      if (!kindTools.length)
        continue;
      const expanded = expandedKinds.has(kind);
      const meta = KIND_META[kind];
      const parent = document.createElement("details");
      parent.className = "mcp-parent";
      parent.dataset.kind = kind;
      parent.open = expanded;
      parent.innerHTML = `
      <summary>
        <span class="mcp-parent-summary-left">
          <span class="mcp-chevron"></span>
          <span class="mcp-parent-labels">
            <span class="mcp-parent-zh">${esc2(meta.zh)}</span>
            <span class="mcp-parent-en">${esc2(meta.en)}</span>
          </span>
        </span>
        <span class="mcp-parent-count">${kindTools.length} \u4E2A</span>
      </summary>
      <div class="mcp-parent-body"></div>`;
      parent.addEventListener("toggle", () => {
        parent.open ? expandedKinds.add(kind) : expandedKinds.delete(kind);
      });
      const body = parent.querySelector(".mcp-parent-body");
      for (const cat of cats) {
        const tools = cat.tools.map((n) => byName.get(n)).filter((t) => !!t);
        if (!tools.length)
          continue;
        const cMeta = categoryMeta(cat.title);
        const group = document.createElement("section");
        group.className = "mcp-group";
        group.innerHTML = `
        <div class="mcp-group-title">
          <span class="mcp-group-zh">${esc2(cMeta.zh)}</span>
          <span class="mcp-group-en">${esc2(cMeta.en)}</span>
          <span class="mcp-group-count">${tools.length} \u4E2A</span>
        </div>
        <div class="mcp-group-items"></div>`;
        const items = group.querySelector(".mcp-group-items");
        for (const t of tools) {
          const tMeta = toolMeta(t.name);
          const el = document.createElement("div");
          el.className = "tool-item";
          el.innerHTML = `
          <div class="tool-item-top">
            <div class="tool-title">
              <span class="tool-name">${esc2(tMeta.zh)}</span>
              <span class="tool-name-sub">${esc2(tMeta.en)}</span>
            </div>
            ${isServerManagedToolDef(t) ? '<span class="tool-edited">\u670D\u52A1\u5668</span>' : ""}
            ${isEdited(t) ? '<span class="tool-edited">\u5DF2\u81EA\u5B9A\u4E49</span>' : ""}
          </div>
          <div class="tool-desc">${esc2((effDescription(t) || "\uFF08\u65E0\u63CF\u8FF0\uFF09").slice(0, 110))}</div>`;
          el.addEventListener("click", () => void openTool(t.name));
          items.appendChild(el);
        }
        body.appendChild(group);
      }
      mcpList.appendChild(parent);
    }
  }
  async function openTool(name) {
    const tool = currentToolDefs.find((t) => t.name === name) || (await allToolDefs()).find((t) => t.name === name);
    if (!tool)
      return;
    state.openToolName = name;
    mcpListPane.classList.add("hidden");
    mcpDetailPane.classList.remove("hidden");
    mcpDetail.scrollTop = 0;
    await renderDetail(tool);
  }
  async function renderDetail(tool) {
    overrides = await getToolDescOverrides();
    const category = currentCategories.find((item) => item.tools.includes(tool.name));
    const kind = category?.kind || browserToolKind(tool.name);
    const meta = toolMeta(tool.name);
    const params = paramEntries(tool);
    const serverManaged = isServerManagedToolDef(tool);
    const paramHtml = params.length ? params.map((p) => `
        <div class="param-row">
          <div class="param-head">
            <span class="param-name">${esc2(p.name)}</span>
            <span class="param-type">${esc2(p.type)}</span>
            ${p.required ? '<span class="param-req">\u5FC5\u586B</span>' : ""}
          </div>
          <div class="tool-desc">${esc2(effParamDesc(tool, p.name, p.desc) || "\uFF08\u65E0\u8BF4\u660E\uFF09")}</div>
          ${serverManaged ? "" : `<input type="text" data-param="${esc2(p.name)}" class="edit-param" placeholder="\u81EA\u5B9A\u4E49\u53C2\u6570\u8BF4\u660E\uFF08\u7559\u7A7A\u7528\u9ED8\u8BA4\uFF09" value="${esc2(overrides[tool.name]?.parameters?.[p.name] || "")}" style="margin-top:5px;"/>`}
        </div>`).join("") : '<div class="empty-note">\u8BE5\u5DE5\u5177\u65E0\u53C2\u6570</div>';
    const editCard = serverManaged ? `<div class="card">
      <div class="card-title">\u670D\u52A1\u5668\u7BA1\u7406</div>
      <div class="login-hint">\u6B64\u5DE5\u5177\u7684 schema \u7531\u670D\u52A1\u5668\u5DE5\u4F5C\u533A <code>device_tools/browser/</code> \u4E0B\u53D1\uFF0C\u4E0E Windows \u684C\u9762\u4E00\u81F4\u3002\u8BF7\u5728 Web \u63A7\u5236\u53F0\u6216\u5DE5\u4F5C\u533A\u6587\u4EF6\u4E2D\u4FEE\u6539\u63CF\u8FF0\u4E0E\u53C2\u6570\u8BF4\u660E\u3002</div>
    </div>` : `<div class="card">
      <div class="card-title">\u7F16\u8F91\u63CF\u8FF0\uFF08\u672C\u5730\u4FDD\u5B58\uFF0C\u968F\u4E0A\u62A5\u540C\u6B65\u7ED9\u670D\u52A1\u5668\uFF09</div>
      <div class="fg"><label>\u5DE5\u5177\u63CF\u8FF0\uFF08\u7528\u9014 + \u4F7F\u7528\u573A\u666F\uFF09</label>
        <textarea class="ta" id="edit-desc" placeholder="\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u63CF\u8FF0">${esc2(overrides[tool.name]?.description || "")}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save">\u4FDD\u5B58\u63CF\u8FF0</button>
      <button class="btn btn-secondary" id="edit-reset">\u6062\u590D\u9ED8\u8BA4</button>
      <div class="save-feedback" id="edit-feedback"></div>
    </div>`;
    const argTemplate = JSON.stringify(Object.fromEntries(params.filter((p) => p.required).map((p) => [p.name, ""])), null, 2);
    mcpDetail.innerHTML = `
    <div class="card">
      <div class="tool-title-row">
        <div class="tool-title-stack">
          <div class="tool-title-main">${esc2(meta.zh)}</div>
          <div class="tool-title-sub">${esc2(meta.en)}</div>
        </div>
        <div class="tool-title-id">${esc2(tool.name)}</div>
      </div>
      <div class="tool-desc" style="font-size:11px;">${esc2(effDescription(tool) || "\uFF08\u65E0\u63CF\u8FF0\uFF09")}</div>
      <span class="tool-kind-tag ${kind}">${esc2(BROWSER_TOOL_KIND_LABELS[kind])} \xB7 ${esc2(category?.title || "\u672A\u5206\u7C7B")}</span>
    </div>
    ${renderToolDemo(tool.name)}
    <div class="card">
      <div class="card-title">\u53C2\u6570\u8BF4\u660E</div>
      ${paramHtml}
    </div>
    ${editCard}
    <div class="card">
      <div class="card-title">\u6D4B\u8BD5\u8C03\u7528 (mcp.test)</div>
      <div class="login-hint">\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u73AF\u5883\u76F4\u63A5\u6267\u884C\u8BE5\u5DE5\u5177\u5E76\u8FD4\u56DE\u539F\u59CB\u7ED3\u679C\u3002</div>
      <div class="fg"><label>\u53C2\u6570 (JSON)</label>
        <textarea class="ta" id="test-args" style="min-height:70px;font-family:'Cascadia Code',Consolas,monospace;">${esc2(argTemplate)}</textarea>
      </div>
      <button class="btn btn-primary" id="test-run">\u6D4B\u8BD5</button>
      <div class="test-result" id="test-result" style="display:none;"></div>
    </div>`;
    if (!serverManaged) {
      mcpDetail.querySelector("#edit-save").addEventListener("click", async () => {
        const description = mcpDetail.querySelector("#edit-desc").value;
        const parameters = {};
        mcpDetail.querySelectorAll(".edit-param").forEach((inp) => {
          parameters[inp.dataset.param] = inp.value;
        });
        await setToolDescOverride(tool.name, { description, parameters });
        sendToBackground({ type: "device:connect" });
        const fb = mcpDetail.querySelector("#edit-feedback");
        fb.textContent = "\u5DF2\u4FDD\u5B58\uFF0C\u7A0D\u540E\u540C\u6B65\u7ED9\u670D\u52A1\u5668";
        fb.style.color = "var(--success)";
        await renderDetail(tool);
      });
      mcpDetail.querySelector("#edit-reset").addEventListener("click", async () => {
        await setToolDescOverride(tool.name, { description: "", parameters: {} });
        sendToBackground({ type: "device:connect" });
        await renderDetail(tool);
      });
    }
    mcpDetail.querySelector("#test-run").addEventListener("click", () => {
      const out = mcpDetail.querySelector("#test-result");
      let args = {};
      const raw = mcpDetail.querySelector("#test-args").value.trim();
      if (raw) {
        try {
          args = JSON.parse(raw);
        } catch (e) {
          out.style.display = "block";
          out.className = "test-result fail";
          out.textContent = `\u53C2\u6570 JSON \u89E3\u6790\u5931\u8D25\uFF1A${e?.message || e}`;
          return;
        }
      }
      out.style.display = "block";
      out.className = "test-result";
      out.textContent = "\u6267\u884C\u4E2D\u2026";
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      state.pendingTests.set(requestId, (r) => {
        if (r.ok) {
          out.className = "test-result ok";
          out.textContent = "\u6210\u529F\n" + safeStringify(r.result);
        } else {
          out.className = "test-result fail";
          out.textContent = "\u5931\u8D25\uFF1A" + (r.error || "\u672A\u77E5\u9519\u8BEF");
        }
      });
      sendToBackground({ type: "mcp:test", requestId, tool: tool.name, args });
    });
  }
  function safeStringify(v) {
    try {
      return typeof v === "string" ? v : JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  function resolveTest(requestId, r) {
    const fn = state.pendingTests.get(requestId);
    if (!fn)
      return;
    state.pendingTests.delete(requestId);
    fn(r);
  }
  function wireMcp() {
    mcpBack.addEventListener("click", () => void renderMcpList());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes[DYNAMIC_MCP_SERVER_SESSION_KEY] && state.openToolName === null) {
        void renderMcpList();
      }
    });
  }

  // src/popup/index.ts
  function handleBackgroundMessage(msg) {
    switch (msg.type) {
      case "device:status":
        setStatus(msg.status);
        if (typeof msg.aiConfigId !== "undefined")
          setBoundAi(msg.aiConfigId ?? null);
        break;
      case "task:start":
        state.stats.total += 1;
        state.stats.running += 1;
        renderStats();
        break;
      case "task:result":
        state.stats.running = Math.max(0, state.stats.running - 1);
        if (msg.data?.success)
          state.stats.success += 1;
        else
          state.stats.failed += 1;
        renderStats();
        break;
      case "settings:data":
        loadSettings(msg.settings);
        break;
      case "mcp:test:result":
        resolveTest(msg.requestId, { ok: msg.ok, result: msg.result, error: msg.error });
        break;
    }
  }
  async function init() {
    initPopupPort(handleBackgroundMessage);
    sendToBackground({ type: "settings:get" });
    renderStats();
    void renderMcpList();
    const s = await getSettings();
    state.serverUrl = s.serverUrl || "";
    state.offlineMode = !!s.offlineMode;
    state.localModel = s.aiModel || "";
    state.auth = await getAuth();
    loginAccount.value = state.auth.account || "";
    loginPassword.value = state.auth.password || "";
    loginRemember.checked = !!state.auth.rememberLogin;
    updateUserChip();
    updateOfflineUi();
    void refreshAvatarCache().then(updateUserChip);
    if (state.auth.token) {
      void (async () => {
        try {
          const me = await getMe(state.serverUrl, state.auth.token);
          const agentSocketUrl = await getAgentEndpoint(state.serverUrl, state.auth.token);
          state.auth.userName = me?.name || state.auth.userName;
          state.auth.avatar = me?.avatar || "";
          await saveAuth({ userName: state.auth.userName, avatar: state.auth.avatar });
          await saveSettings({ agentSocketUrl });
          await refreshAvatarCache();
          updateUserChip();
        } catch (err) {
          if (isAuthError(err)) {
            await doLogout();
          } else {
            console.warn("getMe failed (transient), keeping session", err);
          }
        }
      })();
    }
  }
  wireUi();
  wireMembers();
  wireSettings();
  wireMcp();
  void init();
})();
