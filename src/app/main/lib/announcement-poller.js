// 公告轮询器：TCP 推送移除后，客户端主动定时拉取服务器公告。
// 通过 HTTP GET /api/user_announcement 获取活跃公告，并把新公告
// 以 'server-message' 事件转发到侧边栏（复用既有 updateAnnouncement 展示逻辑）。

const DEFAULT_INTERVAL_MS = 60000; // 服务器公告调度器每分钟检查一次，对齐 60s

// 创建/初始化：createAnnouncementPoller 的具体业务逻辑。
function createAnnouncementPoller({
  getJson,
  getServerBase,
  shouldPoll,
  sendToSide,
  logger = console,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = 8000,
} = {}) {
  let timer = null;
  let inFlight = false;
  let pendingDeliveryReset = false;
  let lastServerBase = '';
  // 每个平台分别记录上次成功下发的内容指纹，避免相同数字 ID 在租户间互相抑制。
  const seenByServer = new Map();

  // 获取/读取/解析：resolveAnnouncementId 的具体业务逻辑。
  function resolveAnnouncementId(ann) {
    if (!ann || typeof ann !== 'object') return '';
    const id = ann.announcement_id ?? ann.announcementId ?? ann.id;
    if (id !== undefined && id !== null && String(id).trim()) {
      return String(id).trim();
    }
    // 无 id 时退化为按内容摘要去重。
    return String(ann.content || ann.message || '').trim().slice(0, 160);
  }

  function resolveAnnouncementFingerprint(ann) {
    const id = resolveAnnouncementId(ann);
    if (!id) return '';
    return JSON.stringify([
      id,
      ann.message ?? ann.content ?? '',
      ann.message_type ?? ann.announcement_type ?? '',
      ann.latest_version ?? ann.latestVersion ?? ann.version ?? '',
      ann.update_link ?? ann.downloadUrl ?? ann.download_url ?? '',
    ]);
  }

  function resolveDeliveryChannel(ann) {
    const messageType = String(
      ann?.message_type ?? ann?.messageType ?? ann?.announcement_type ?? ann?.type ?? ''
    ).trim().toLowerCase();
    const hasUpdateMetadata = Boolean(
      (ann?.latest_version ?? ann?.latestVersion ?? ann?.version)
      && (ann?.update_link ?? ann?.downloadUrl ?? ann?.download_url ?? ann?.url)
    );
    return ['update', 'upgrade', 'app_update', 'software_update'].includes(messageType) || hasUpdateMetadata
      ? 'app-update-notice'
      : 'server-message';
  }

  // 处理/分发：pollOnce 的具体业务逻辑。
  async function pollOnce({ resetDelivery = false } = {}) {
    if (inFlight) {
      pendingDeliveryReset = pendingDeliveryReset || resetDelivery;
      return;
    }
    inFlight = true;
    try {
      if (typeof shouldPoll === 'function' && shouldPoll() !== true) {
        return;
      }
      const base = String((typeof getServerBase === 'function' ? getServerBase() : '') || '').replace(/\/+$/, '');
      if (!base) {
        // 尚未拿到服务器地址（未验证卡密），静默跳过。
        return;
      }

      if (base !== lastServerBase) {
        lastServerBase = base;
        // 平台切换后先清空侧边栏，避免继续展示上一个租户的公告。
        sendToSide('server-announcements-reset', { serverBase: base });
      }

      const url = `${base}/api/user_announcement`;
      const resp = await getJson(url, timeoutMs);
      const body = resp && typeof resp === 'object' && resp.body !== undefined ? resp.body : resp;
      if (!body || body.success === false) {
        throw new Error(body?.message || '公告接口返回失败');
      }
      const list = body && Array.isArray(body.data) ? body.data : [];
      if (resetDelivery) {
        seenByServer.delete(base);
      }
      const previous = seenByServer.get(base) || new Map();
      const current = new Map();

      for (const ann of list) {
        const id = resolveAnnouncementId(ann);
        const fingerprint = resolveAnnouncementFingerprint(ann);
        if (!id || !fingerprint) continue;
        current.set(id, fingerprint);
        if (previous.get(id) === fingerprint) continue;
        try {
          const delivered = sendToSide(resolveDeliveryChannel(ann), ann);
          if (delivered === false) {
            current.delete(id);
            logger.warn?.('[公告轮询] 侧边栏尚未就绪，公告将在下次轮询重试:', id);
          } else {
            logger.log?.('[公告轮询] 公告已交给软件界面:', id);
          }
        } catch (e) {
          current.delete(id);
          logger.warn?.('[公告轮询] 下发公告到侧边栏失败:', e?.message || e);
        }
      }
      // 只保留本次接口仍然返回的公告。公告被禁用后再启用时会重新展示。
      seenByServer.set(base, current);
    } catch (e) {
      logger.warn?.('[公告轮询] 拉取公告失败:', e?.message || e);
    } finally {
      inFlight = false;
      if (pendingDeliveryReset) {
        pendingDeliveryReset = false;
        void pollOnce({ resetDelivery: true });
      }
    }
  }

  // 启动/打开/显示：start 的具体业务逻辑。
  function start() {
    if (timer) return;
    void pollOnce();
    timer = setInterval(() => { void pollOnce(); }, intervalMs);
  }

  // 停止/关闭/清理：stop 的具体业务逻辑。
  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 渲染/刷新：refreshNow 的具体业务逻辑（如卡密验证成功后立即拉取一次）。
  function refreshNow(options = {}) {
    return pollOnce(options);
  }

  return { start, stop, refreshNow };
}

module.exports = { createAnnouncementPoller };
