// 侧边栏公告、设备号、版本号与动画事件

let updateWidgetState = {
  visible: false,
  shownVersion: '',
  lastPhase: '',
  activated: false,
};
let cachedAppVersion = '';

// 格式化/规范化：stripVersionPrefix的具体业务逻辑。
function stripVersionPrefix(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

// 格式化/规范化：normalizeVersion的具体业务逻辑。
function normalizeVersion(value) {
  const text = stripVersionPrefix(value);
  if (!text) return { parts: [0], preRelease: '' };

  const [mainPart, preRelease = ''] = text.split('-', 2);
  const parts = mainPart
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));

  while (parts.length > 1 && parts[parts.length - 1] === 0) {
    parts.pop();
  }

  return { parts, preRelease };
}

// 比较/匹配：compareVersions的具体业务逻辑。
function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const maxLen = Math.max(a.parts.length, b.parts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const av = a.parts[i] || 0;
    const bv = b.parts[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  if (a.preRelease && !b.preRelease) return -1;
  if (!a.preRelease && b.preRelease) return 1;
  if (a.preRelease && b.preRelease && a.preRelease !== b.preRelease) {
    return a.preRelease > b.preRelease ? 1 : -1;
  }

  return 0;
}

// 获取/读取/解析：toTextLines的具体业务逻辑。
function toTextLines(value) {
  const lines = [];

  const pushLine = (input) => {
    const text = String(input ?? '').trim();
    if (text) {
      if (text.includes('\n')) {
        text.split(/\r?\n+/).forEach((line) => {
          const item = String(line || '').trim();
          if (item) {
            lines.push(item);
          }
        });
        return;
      }
      lines.push(text);
    }
  };

  const walk = (input) => {
    if (input === null || input === undefined) {
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(walk);
      return;
    }

    if (typeof input === 'object') {
      const preferred = input.text
        || input.message
        || input.content
        || input.title
        || input.name
        || '';

      if (preferred) {
        pushLine(preferred);
        return;
      }

      Object.values(input).forEach(walk);
      return;
    }

    const text = String(input).trim();
    if (!text) {
      return;
    }

    if (text.includes('\n')) {
      text.split(/\r?\n+/).forEach(pushLine);
      return;
    }

    pushLine(text);
  };

  walk(value);
  return lines.filter((line, index) => lines.indexOf(line) === index);
}

// 获取/读取/解析：collectUpdateFeatureLines的具体业务逻辑。
function collectUpdateFeatureLines(payload = {}) {
  const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const featureSources = [
    payload.features,
    payload.feature,
    payload.featureList,
    payload.feature_list,
    payload.functions,
    payload.function,
    payload.functionList,
    payload.function_list,
    payload.highlights,
    payload.highlight,
    payload.releaseNotes,
    payload.release_notes,
    payload.notes,
    payload.updateNotes,
    payload.update_notes,
    raw.features,
    raw.feature,
    raw.featureList,
    raw.feature_list,
    raw.functions,
    raw.function,
    raw.functionList,
    raw.function_list,
    raw.highlights,
    raw.highlight,
    raw.releaseNotes,
    raw.release_notes,
    raw.notes,
    raw.updateNotes,
    raw.update_notes,
  ];

  const lines = [];
  featureSources.forEach((source) => {
    toTextLines(source).forEach((line) => {
      if (!lines.includes(line)) {
        lines.push(line);
      }
    });
  });
  return lines;
}

// 处理：buildAnnouncementHtml的具体业务逻辑。
function buildAnnouncementHtml(payload = {}) {
  const baseText = String(
    payload.content
    || payload.message
    || payload.announcement
    || payload.description
    || payload.detail
    || payload.title
    || ''
  ).trim();
  const baseLines = toTextLines(baseText);
  const featureLines = collectUpdateFeatureLines(payload);
  const htmlParts = [];

  baseLines.forEach((line) => {
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  });

  featureLines.forEach((line) => {
    htmlParts.push(`<p>功能：${escapeHtml(line)}</p>`);
  });

  return htmlParts.join('');
}

// 获取/读取/解析：getCurrentAppVersion的具体业务逻辑。
async function getCurrentAppVersion() {
  const domVersion = stripVersionPrefix(safeGetEl('app-version')?.textContent || '');
  if (domVersion) {
    cachedAppVersion = domVersion;
    return domVersion;
  }

  if (cachedAppVersion) {
    return cachedAppVersion;
  }

  if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    try {
      const resp = await window.electronAPI.invoke('get-app-version');
      const version = stripVersionPrefix(resp?.version || '');
      if (version) {
        cachedAppVersion = version;
        return version;
      }
    } catch (e) {
      console.warn('[侧边栏] 获取当前版本失败:', e?.message || e);
    }
  }

  return '';
}

// 处理：shouldSkipUpdateAnnouncement的具体业务逻辑。
async function shouldSkipUpdateAnnouncement(payload = {}) {
  const targetVersion = stripVersionPrefix(
    payload.targetVersion
    || payload.version
    || payload.latestVersion
    || payload.latest_version
    || ''
  );
  if (!targetVersion) {
    return false;
  }

  const currentVersion = await getCurrentAppVersion();
  if (!currentVersion) {
    return false;
  }

  return compareVersions(currentVersion, targetVersion) >= 0;
}

// 处理：normalizeUpdateAnnouncementPayload的具体业务逻辑。
function normalizeUpdateAnnouncementPayload(messageData = {}) {
  const version = stripVersionPrefix(
    messageData.targetVersion
    || messageData.version
    || messageData.latestVersion
    || messageData.latest_version
    || messageData.raw?.targetVersion
    || messageData.raw?.version
    || messageData.raw?.latestVersion
    || messageData.raw?.latest_version
    || ''
  );
  const content = buildAnnouncementHtml(messageData)
    || `<p>${escapeHtml(String(messageData.content || messageData.message || '发现新版本').trim())}</p>`;

  return {
    ...messageData,
    __htmlContent: true,
    type: 'announcement',
    message_type: 'update',
    announcement_id: String(
      messageData.announcement_id
      || messageData.announcementId
      || messageData.id
      || version
      || ''
    ).trim() || undefined,
    content,
    message: content,
    targetVersion: version || messageData.targetVersion || messageData.version || messageData.latestVersion || messageData.latest_version || '',
  };
}

// 右侧公告区的更新进度组件是“按需显示”的：
// 1. 收到更新通知时只更新公告文案，不展示进度
// 2. 只有用户确认下载后，主进程发出 app-update-activated，才开始显示进度
// 3. 下载完成后提示用户关闭软件完成更新，关闭后由主进程启动安装器
function safeUpdateWidgetEl(id) {
  return safeGetEl(id);
}

// 设置/更新/持久化：setUpdateWidgetVisible的具体业务逻辑。
function setUpdateWidgetVisible(visible) {
  const widget = safeUpdateWidgetEl('update-widget');
  if (widget) {
    widget.hidden = !visible;
  }
  updateWidgetState.visible = !!visible;
}

// 渲染/刷新：renderUpdateWidget的具体业务逻辑。
function renderUpdateWidget(payload = {}) {
  const percentValue = Number(payload.percent);
  const clampedPercent = Number.isFinite(percentValue)
    ? Math.max(0, Math.min(100, Math.round(percentValue)))
    : null;
  const version = String(payload.version || payload.targetVersion || payload.latest_version || payload.latestVersion || '').trim();
  const phase = String(payload.phase || '').trim().toLowerCase();
  const message = String(payload.message || payload.content || '').trim();
  const isActivated = updateWidgetState.activated === true;

  if (version && updateWidgetState.shownVersion && updateWidgetState.shownVersion !== version && phase !== 'opening') {
    return;
  }

  if (phase === 'error' || phase === 'failed' || phase === 'skip') {
    setUpdateWidgetVisible(false);
    updateWidgetState.activated = false;
    updateWidgetState.lastPhase = phase;
    return;
  }

  if (!isActivated && phase !== 'confirmed' && phase !== 'downloading' && phase !== 'opening') {
    return;
  }

  if (!updateWidgetState.visible) {
    setUpdateWidgetVisible(true);
  }

  if (version) {
    updateWidgetState.shownVersion = version;
  }
  updateWidgetState.lastPhase = phase || updateWidgetState.lastPhase;

  const ring = safeUpdateWidgetEl('update-widget-ring');
  const percentEl = safeUpdateWidgetEl('update-widget-percent');
  const labelEl = safeUpdateWidgetEl('update-widget-label');
  const textEl = safeUpdateWidgetEl('update-widget-text');

  if (ring && clampedPercent !== null) {
    ring.style.setProperty('--update-progress', `${clampedPercent}%`);
  }
  if (percentEl) {
    percentEl.textContent = clampedPercent !== null ? `${clampedPercent}%` : '…';
  }
  if (labelEl) {
    labelEl.textContent = version ? `更新中 v${version}` : '更新中';
  }
  if (textEl) {
    textEl.textContent = message || '正在下载更新...';
  }
}

// 不同于公告列表，这里只控制“下载进度卡片”的状态。
// 重置时要清空版本和激活标记，避免下一次更新沿用上一次状态。
function resetUpdateWidget() {
  updateWidgetState = {
    visible: false,
    shownVersion: '',
    lastPhase: '',
    activated: false,
  };
  setUpdateWidgetVisible(false);
  const ring = safeUpdateWidgetEl('update-widget-ring');
  const percentEl = safeUpdateWidgetEl('update-widget-percent');
  const labelEl = safeUpdateWidgetEl('update-widget-label');
  const textEl = safeUpdateWidgetEl('update-widget-text');
  if (ring) ring.style.setProperty('--update-progress', '0%');
  if (percentEl) percentEl.textContent = '0%';
  if (labelEl) labelEl.textContent = '更新中';
  if (textEl) textEl.textContent = '准备更新...';
}

// 创建/初始化：initAnnouncementListener的具体业务逻辑。
function initAnnouncementListener() {
  if (window.electronAPI && window.electronAPI.on) {
    // 普通公告只进公告栏，不进入更新弹窗逻辑。
    window.electronAPI.on('server-message', (messageData) => {
      const messageType = String(
        messageData.message_type
        || messageData.messageType
        || messageData.data?.message_type
        || messageData.data?.messageType
        || messageData.announcement?.message_type
        || messageData.announcement?.messageType
        || messageData.payload?.message_type
        || messageData.payload?.messageType
        || ''
      ).toLowerCase();
      const messageText = String(
        messageData.message
        || messageData.content
        || messageData.data?.message
        || messageData.data?.content
        || messageData.announcement?.message
        || messageData.announcement?.content
        || ''
      );

      // 服务器返回的普通公告、成功公告都写入公告栏；
      // 只有停用/更新类公告继续交给其它专门流程处理。
      if (messageData.type === 'announcement' && !['shutdown', 'update', 'upgrade', 'app_update', 'software_update'].includes(messageType) && !messageText.includes('软件暂时无法使用') && !messageText.includes('停用')) {
        updateAnnouncement(messageData);
      }
    });

    // 更新通知只显示“发现新版本”的文案，不展示进度。
    // 进度显示由 app-update-activated / app-update-progress 单独驱动。
    window.electronAPI.on('app-update-notice', (messageData) => {
      void (async () => {
        try {
          if (await shouldSkipUpdateAnnouncement(messageData || {})) {
            return;
          }
          updateAnnouncement(normalizeUpdateAnnouncementPayload(messageData || {}));
        } catch (e) {
          console.warn('[侧边栏] 处理更新公告失败:', e?.message || e);
        }
      })();
    });

    // 主进程确认进入更新流程后才会发这个事件。
    window.electronAPI.on('app-update-progress', (payload) => {
      renderUpdateWidget(payload || {});
    });

    // 用户点了“确认下载”后，才允许进度卡片显示。
    window.electronAPI.on('app-update-activated', (payload) => {
      updateWidgetState.activated = true;
      renderUpdateWidget({
        ...(payload || {}),
        phase: 'confirmed',
      });
    });

    // 完成态要保留提示，避免用户看到 100% 后没有任何明确反馈。
    window.electronAPI.on('app-update-complete', (payload) => {
      renderUpdateWidget({
        ...(payload || {}),
        phase: 'completed',
      });
      const version = String(payload?.version || payload?.targetVersion || '').trim();
      const text = version
        ? `更新包已下载完成，请关闭软件后继续安装 v${version}`
        : '更新包已下载完成，请关闭软件后继续安装';
      if (window.MessageModal && typeof window.MessageModal.showInfoMessage === 'function') {
        window.MessageModal.showInfoMessage(text);
      }
      const ring = safeUpdateWidgetEl('update-widget-ring');
      const percentEl = safeUpdateWidgetEl('update-widget-percent');
      const labelEl = safeUpdateWidgetEl('update-widget-label');
      const textEl = safeUpdateWidgetEl('update-widget-text');
      if (ring) ring.style.setProperty('--update-progress', '100%');
      if (percentEl) percentEl.textContent = '100%';
      if (labelEl) labelEl.textContent = version ? `已下载 v${version}` : '已下载完成';
      if (textEl) textEl.textContent = text;
      setUpdateWidgetVisible(true);
    });

    window.electronAPI.on('app-update-error', (payload) => {
      renderUpdateWidget({
        ...(payload || {}),
        phase: 'error',
      });
      resetUpdateWidget();
    });

    window.electronAPI.on('app-update-skip', () => {
      resetUpdateWidget();
    });
  }
}

// 设置/更新/持久化：updateAnnouncement的具体业务逻辑。
function updateAnnouncement(announcementData) {
  try {
    const announcementContent = safeGetEl('announcement-content');
    if (!announcementContent) {
      return;
    }

    const content = announcementData.__htmlContent === true
      ? String(announcementData.content || announcementData.message || '<p>暂无公告内容</p>').trim()
      : (buildAnnouncementHtml(announcementData)
        || `<p>${escapeHtml(String(announcementData.content || announcementData.message || announcementData.announcement || '暂无公告内容').trim())}</p>`);
    const announcementId = announcementData.announcement_id;
    const existingIndex = announcements.findIndex((ann) => ann.id === announcementId);

    if (existingIndex >= 0) {
      announcements[existingIndex].content = content;
      announcements[existingIndex].timestamp = announcementData.timestamp || Date.now();
    } else {
      announcements.unshift({
        id: announcementId,
        content,
        timestamp: announcementData.timestamp || Date.now()
      });

      if (announcements.length > MAX_ANNOUNCEMENTS) {
        announcements = announcements.slice(0, MAX_ANNOUNCEMENTS);
      }
    }

    const announcementIcon = safeGetEl('announcement-icon');
    if (announcementIcon) {
      announcementIcon.textContent = '📢';
      announcementIcon.style.color = '#409eff';
    }

    const announcementTitle = safeGetEl('announcement-title');
    if (announcementTitle) {
      announcementTitle.textContent = '公告';
      announcementTitle.style.color = '#409eff';
    }

    const contentHtml = announcements.map((ann) => String(ann.content || '')).join('');
    announcementContent.innerHTML = contentHtml || '<p>暂无公告内容</p>';
  } catch (e) {
    console.error('[侧边栏] 更新公告栏失败:', e);
  }
}

// 创建/初始化：initSidebarUiListeners的具体业务逻辑。
function initSidebarUiListeners() {
  if (!window.electronAPI || !window.electronAPI.on) return;

  window.electronAPI.on('update-device-id', (deviceId) => {
    try {
      const deviceIdInput = document.getElementById('device-id');
      if (deviceIdInput) {
        deviceIdInput.value = deviceId || '';
      }
    } catch (e) {
      console.warn('更新设备号失败:', e);
    }
  });

  window.electronAPI.on('license-usage-updated', (usage) => {
    try {
      const usageEl = safeGetEl('usage-times');
      if (!usageEl) return;
      const usageText = formatUsageTimesText(usage);
      if (usageText) {
        usageEl.textContent = usageText;
        usageEl.style.color = '#409eff';
      }
    } catch (e) {
      console.warn('更新本地试用次数显示失败:', e);
    }
  });

  window.electronAPI.on('app-version', (version) => {
    try {
      cachedAppVersion = stripVersionPrefix(version || '') || cachedAppVersion;
      const el = document.getElementById('app-version');
      if (el) {
        const v = String(version || '').trim();
        el.textContent = v ? `v${v}` : '';
      }
    } catch (e) {
      console.warn('更新版本号失败:', e);
    }
  });
}

// 创建/初始化：initSidebarAnimationListener的具体业务逻辑。
function initSidebarAnimationListener() {
  if (!window.electronAPI || !window.electronAPI.on) return;

  window.electronAPI.on('sidebar-collapse', () => {
    document.body.classList.add('collapsing');
    document.body.classList.remove('expanding');
    setTimeout(() => {
      document.body.classList.remove('collapsing');
    }, 400);
  });

  window.electronAPI.on('sidebar-expand', () => {
    document.body.classList.add('expanding');
    document.body.classList.remove('collapsing');
    setTimeout(() => {
      document.body.classList.remove('expanding');
    }, 200);
  });
}
