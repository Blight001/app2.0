(() => {
  // src/offline-chat.ts
  var q = (id) => document.getElementById(id);
  var messagesEl = q("messages");
  var inputEl = q("input");
  var sendBtn = q("send-btn");
  var recallBtn = q("recall-btn");
  var modelBtn = q("model-btn");
  var promptBtn = q("prompt-btn");
  var toolsBtn = q("tools-btn");
  var modelPanel = q("model-panel");
  var promptPanel = q("prompt-panel");
  var toolPanel = q("tool-panel");
  var cfgProvider = q("cfg-ai-provider");
  var cfgAiKey = q("cfg-ai-key");
  var cfgAiBase = q("cfg-ai-base");
  var cfgAiModel = q("cfg-ai-model");
  var modelSave = q("model-save");
  var modelFeedback = q("model-feedback");
  var promptInput = q("prompt-input");
  var promptSave = q("prompt-save");
  var promptFeedback = q("prompt-feedback");
  var modelMeta = q("model-meta");
  var toolSearch = q("tool-search");
  var toolListEl = q("tool-list");
  var toolCount = q("tool-count");
  var tokenStatsEl = q("token-stats");
  var toolsAllBtn = q("tools-all");
  var toolsNoneBtn = q("tools-none");
  var port = null;
  var messages = [];
  var segments = [];
  var offlineToolDefs = [];
  var allowedTools = /* @__PURE__ */ new Set();
  var sending = false;
  var activeRequestId = "";
  var cancelRequested = false;
  var tokenTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  var pending = /* @__PURE__ */ new Map();
  var PROVIDER_PRESETS = {
    anthropic: { base: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
    openai: { base: "https://api.openai.com", model: "gpt-4o" },
    deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
    openrouter: { base: "https://openrouter.ai/api", model: "anthropic/claude-3.5-sonnet" },
    ollama: { base: "http://localhost:11434", model: "llama3.1" }
  };
  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function requestId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function sendRequest(msg, match) {
    if (!port)
      connectPort();
    const id = msg.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("\u8BF7\u6C42\u8D85\u65F6"));
      }, 12e4);
      pending.set(id, (reply) => {
        if (!match(reply))
          return;
        clearTimeout(timer);
        pending.delete(id);
        resolve(reply);
      });
      port.postMessage(msg);
    });
  }
  function connectPort() {
    port = chrome.runtime.connect({ name: "offline-chat" });
    port.onMessage.addListener((msg) => {
      if (msg.type === "offline-chat:progress") {
        applyProgress(msg.event);
        return;
      }
      if (msg.requestId && pending.has(msg.requestId)) {
        pending.get(msg.requestId)(msg);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
  }
  function safeStringify(value) {
    if (typeof value === "string")
      return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  function isImageDataUrl(value) {
    return typeof value === "string" && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value.trim());
  }
  function collectToolImages(value, path = "result", seen = /* @__PURE__ */ new Set()) {
    if (value == null)
      return [];
    if (typeof value === "object") {
      if (seen.has(value))
        return [];
      seen.add(value);
    }
    if (isImageDataUrl(value))
      return [{ label: /screenshot|dataUrl|image/i.test(path) ? "\u622A\u56FE" : "\u56FE\u7247", url: String(value).trim() }];
    if (Array.isArray(value))
      return value.flatMap((item, index) => collectToolImages(item, `${path}[${index}]`, seen));
    if (typeof value !== "object")
      return [];
    return Object.entries(value).flatMap(([key, item]) => collectToolImages(item, `${path}.${key}`, seen));
  }
  function redactImages(value, seen = /* @__PURE__ */ new Set()) {
    if (value == null)
      return value;
    if (isImageDataUrl(value))
      return "[\u56FE\u7247\u5DF2\u5728\u4E0B\u65B9\u663E\u793A]";
    if (typeof value !== "object")
      return value;
    if (seen.has(value))
      return "[\u5FAA\u73AF\u5F15\u7528]";
    seen.add(value);
    if (Array.isArray(value))
      return value.map((item) => redactImages(item, seen));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactImages(item, seen)]));
  }
  function detailsSegment(item, status) {
    const body = [
      `\u5DE5\u5177: ${item.tool}`,
      `\u72B6\u6001: ${status}`,
      "",
      "\u53C2\u6570:",
      safeStringify(item.arguments),
      "",
      "\u7ED3\u679C:",
      safeStringify(redactImages(item.result ?? item.summary))
    ].join("\n");
    const el = document.createElement("details");
    el.className = "segment";
    el.innerHTML = `
    <summary>
      <span>MCP \u5DE5\u5177 \xB7 ${escapeHtml(item.tool)}</span>
      <span class="seg-status ${item.success ? "" : "fail"}">${escapeHtml(status)}</span>
    </summary>
    <div class="segment-body">${escapeHtml(body)}</div>`;
    const images = collectToolImages(item.result);
    const bodyEl = el.querySelector(".segment-body");
    if (images.length && bodyEl) {
      const strip = document.createElement("div");
      strip.className = "tool-images";
      for (const image of images) {
        const card = document.createElement("figure");
        card.className = "tool-image";
        card.innerHTML = `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label)}"/><figcaption>${escapeHtml(image.label)}</figcaption>`;
        strip.appendChild(card);
      }
      bodyEl.appendChild(strip);
    }
    return el;
  }
  function formatTokenUsage() {
    const suffix = tokenTotals.estimated ? "\uFF08\u542B\u4F30\u7B97\uFF09" : "";
    return `\u672C\u6B21\u4F1A\u8BDD\u7D2F\u8BA1 Token\uFF1A\u8F93\u5165 ${tokenTotals.inputTokens} / \u8F93\u51FA ${tokenTotals.outputTokens} / \u603B\u8BA1 ${tokenTotals.totalTokens}${suffix}`;
  }
  function addTokenUsage(usage) {
    if (!usage)
      return;
    tokenTotals.inputTokens += Number(usage.inputTokens || 0);
    tokenTotals.outputTokens += Number(usage.outputTokens || 0);
    tokenTotals.totalTokens += Number(usage.totalTokens || 0);
    tokenTotals.estimated = tokenTotals.estimated || !!usage.estimated;
  }
  function syncSendButton() {
    sendBtn.textContent = sending ? "\u505C\u6B62" : "\u53D1\u9001";
    sendBtn.classList.toggle("stop", sending);
    sendBtn.classList.toggle("primary", !sending);
    sendBtn.disabled = !sending && !inputEl.value.trim();
  }
  function render() {
    messagesEl.innerHTML = "";
    if (!segments.length) {
      const empty = document.createElement("div");
      empty.className = "msg system";
      empty.textContent = "\u8F93\u5165\u6D88\u606F\u540E\uFF0CAI \u4F1A\u76F4\u63A5\u4F7F\u7528\u672C\u673A\u6A21\u578B\u914D\u7F6E\uFF0C\u5E76\u53EF\u8C03\u7528\u6D4F\u89C8\u5668 MCP \u5DE5\u5177\u3002";
      messagesEl.appendChild(empty);
    }
    for (const item of segments) {
      if (item.type === "message") {
        const el = document.createElement("div");
        el.className = `msg ${item.role}`;
        el.innerHTML = escapeHtml(item.content);
        messagesEl.appendChild(el);
      } else {
        const status = item.summary === "\u6267\u884C\u4E2D..." ? "\u6267\u884C\u4E2D" : item.success ? "\u6210\u529F" : "\u5931\u8D25";
        messagesEl.appendChild(detailsSegment(item, status));
      }
    }
    tokenStatsEl.textContent = formatTokenUsage();
    recallBtn.disabled = sending || segments.length === 0;
    syncSendButton();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function renderTools() {
    const keyword = toolSearch.value.trim().toLowerCase();
    const visible = offlineToolDefs.filter((t) => !keyword || t.name.toLowerCase().includes(keyword) || String(t.description || "").toLowerCase().includes(keyword));
    toolCount.textContent = `\u672C\u6B21\u5BF9\u8BDD\u53EF\u7528 ${allowedTools.size}/${offlineToolDefs.length} \u4E2A MCP \u5DE5\u5177`;
    toolListEl.innerHTML = "";
    for (const tool of visible) {
      const label = document.createElement("label");
      label.className = "tool-item";
      label.title = tool.description || tool.name;
      label.innerHTML = `<input type="checkbox" ${allowedTools.has(tool.name) ? "checked" : ""}/><span>${escapeHtml(tool.name)}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        const checked = e.target.checked;
        checked ? allowedTools.add(tool.name) : allowedTools.delete(tool.name);
        renderTools();
      });
      toolListEl.appendChild(label);
    }
  }
  function renderModelMeta(settings) {
    const model = String(settings.aiModel || "").trim() || "\u672A\u914D\u7F6E\u6A21\u578B";
    const base = String(settings.aiBaseUrl || "").trim() || "\u672A\u914D\u7F6E Base URL";
    const keySuffix = settings.aiKey ? "" : " \xB7 \u672A\u914D\u7F6E AI Key";
    modelMeta.textContent = `${model} \xB7 ${base}${keySuffix}`;
  }
  function applyProgress(event) {
    if (!activeRequestId)
      return;
    if (event.type === "tool_start") {
      segments.push({ type: "mcp", tool: event.tool || "unknown", success: true, arguments: event.arguments || {}, result: null, summary: "\u6267\u884C\u4E2D..." });
      render();
    } else if (event.type === "tool_result" && event.event) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        if (seg.type === "mcp" && seg.tool === event.event.tool && seg.summary === "\u6267\u884C\u4E2D...") {
          segments[i] = { type: "mcp", ...event.event };
          render();
          return;
        }
      }
      segments.push({ type: "mcp", ...event.event });
      render();
    }
  }
  async function loadConfig() {
    const id = requestId("cfg");
    const cfg = await sendRequest({ type: "offline-chat:get-config", requestId: id }, (m) => m.type === "offline-chat:config" && m.requestId === id);
    cfgAiKey.value = cfg.settings.aiKey || "";
    cfgAiBase.value = cfg.settings.aiBaseUrl || "";
    cfgAiModel.value = cfg.settings.aiModel || "";
    promptInput.value = cfg.settings.offlinePrompt || "";
    renderModelMeta(cfg.settings);
  }
  async function loadTools() {
    const id = requestId("tools");
    const reply = await sendRequest({ type: "offline-chat:list-tools", requestId: id }, (m) => m.type === "offline-chat:tools" && m.requestId === id);
    offlineToolDefs = reply.tools || [];
    allowedTools = new Set(offlineToolDefs.map((t) => t.name));
    renderTools();
  }
  async function saveModel() {
    const id = requestId("model");
    const reply = await sendRequest({
      type: "offline-chat:save-model",
      requestId: id,
      payload: {
        aiKey: cfgAiKey.value.trim(),
        aiBaseUrl: cfgAiBase.value.trim() || "https://api.anthropic.com",
        aiModel: cfgAiModel.value.trim() || "claude-sonnet-4-5"
      }
    }, (m) => m.type === "offline-chat:model-saved" && m.requestId === id);
    if (!reply.ok || !reply.settings) {
      modelFeedback.textContent = reply.error || "\u4FDD\u5B58\u5931\u8D25";
      return;
    }
    cfgAiKey.value = reply.settings.aiKey || "";
    cfgAiBase.value = reply.settings.aiBaseUrl || "";
    cfgAiModel.value = reply.settings.aiModel || "";
    renderModelMeta(reply.settings);
    modelFeedback.textContent = "\u5DF2\u4FDD\u5B58";
    setTimeout(() => {
      modelFeedback.textContent = "";
    }, 1600);
  }
  async function savePrompt() {
    const id = requestId("prompt");
    await sendRequest({ type: "offline-chat:save-prompt", requestId: id, prompt: promptInput.value }, (m) => m.type === "offline-chat:prompt-saved" && m.requestId === id);
    promptFeedback.textContent = "\u5DF2\u4FDD\u5B58";
    setTimeout(() => {
      promptFeedback.textContent = "";
    }, 1600);
  }
  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending)
      return;
    inputEl.value = "";
    messages.push({ role: "user", content: text });
    segments.push({ type: "message", role: "user", content: text });
    sending = true;
    cancelRequested = false;
    activeRequestId = requestId("offline");
    render();
    try {
      const result = await sendRequest({ type: "offline-chat:send", requestId: activeRequestId, messages, prompt: promptInput.value.trim(), allowedTools: Array.from(allowedTools) }, (m) => (m.type === "offline-chat:response" || m.type === "offline-chat:error") && m.requestId === activeRequestId);
      if (result.type === "offline-chat:error") {
        if (!cancelRequested) {
          messages.push({ role: "assistant", content: `\u5931\u8D25\uFF1A${result.error}` });
          segments.push({ type: "message", role: "assistant", content: `\u5931\u8D25\uFF1A${result.error}` });
        }
      } else {
        addTokenUsage(result.usage);
        messages.push({ role: "assistant", content: result.text || "\u5B8C\u6210" });
        segments.push({ type: "message", role: "assistant", content: result.text || "\u5B8C\u6210" });
        for (const ev of result.toolEvents || []) {
          const exists = segments.some((s) => s.type === "mcp" && s.tool === ev.tool && safeStringify(s.arguments) === safeStringify(ev.arguments));
          if (!exists)
            segments.splice(Math.max(0, segments.length - 1), 0, { type: "mcp", ...ev });
        }
      }
    } finally {
      sending = false;
      activeRequestId = "";
      cancelRequested = false;
      render();
      inputEl.focus();
    }
  }
  async function stopSending() {
    if (!sending || !activeRequestId || !port)
      return;
    cancelRequested = true;
    port.postMessage({ type: "offline-chat:cancel", requestId: activeRequestId });
  }
  function recall() {
    if (sending || !messages.length)
      return;
    if (messages[messages.length - 1]?.role === "assistant")
      messages.pop();
    if (messages[messages.length - 1]?.role === "user")
      messages.pop();
    const lastUser = segments.map((s, i) => s.type === "message" && s.role === "user" ? i : -1).filter((i) => i >= 0).pop();
    if (typeof lastUser === "number")
      segments = segments.slice(0, lastUser);
    render();
  }
  sendBtn.addEventListener("click", () => {
    sending ? void stopSending() : void send();
  });
  recallBtn.addEventListener("click", recall);
  modelBtn.addEventListener("click", () => modelPanel.classList.toggle("open"));
  promptBtn.addEventListener("click", () => promptPanel.classList.toggle("open"));
  toolsBtn.addEventListener("click", () => toolPanel.classList.toggle("open"));
  inputEl.addEventListener("input", () => {
    if (!sending)
      syncSendButton();
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });
  cfgProvider.addEventListener("change", () => {
    const p = PROVIDER_PRESETS[cfgProvider.value];
    if (p) {
      cfgAiBase.value = p.base;
      cfgAiModel.value = p.model;
    }
    cfgProvider.value = "";
  });
  modelSave.addEventListener("click", () => void saveModel());
  promptSave.addEventListener("click", () => void savePrompt());
  toolSearch.addEventListener("input", renderTools);
  toolsAllBtn.addEventListener("click", () => {
    allowedTools = new Set(offlineToolDefs.map((t) => t.name));
    renderTools();
  });
  toolsNoneBtn.addEventListener("click", () => {
    allowedTools.clear();
    renderTools();
  });
  connectPort();
  void Promise.all([loadConfig(), loadTools()]).then(() => {
    render();
    inputEl.focus();
  }).catch((err) => {
    modelMeta.textContent = err?.message || String(err);
    render();
  });
})();
