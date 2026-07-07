// 公告轮询器：TCP 推送移除后，客户端主动定时拉取服务器公告。
// 通过 HTTP GET /api/user_announcement 获取活跃公告，并把新公告
// 以 'server-message' 事件转发到侧边栏（复用既有 updateAnnouncement 展示逻辑）。

const DEFAULT_INTERVAL_MS = 60000; // 服务器公告调度器每分钟检查一次，对齐 60s

// 创建/初始化：createAnnouncementPoller 的具体业务逻辑。
function createAnnouncementPoller({
  getJson,
  getServerBase,
  sendToSide,
  logger = console,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = 8000,
} = {}) {
  let timer = null;
  let inFlight = false;
  // 记录已下发过的公告 id，避免每次轮询重复推送（侧边栏本身也按 id 去重，这里减少无谓 IPC）。
  const seen = new Set();

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

  // 处理/分发：pollOnce 的具体业务逻辑。
  async function pollOnce() {
    if (inFlight) return;
    inFlight = true;
    try {
      const base = String((typeof getServerBase === 'function' ? getServerBase() : '') || '').replace(/\/+$/, '');
      if (!base) {
        // 尚未拿到服务器地址（未验证卡密），静默跳过。
        return;
      }

      const url = `${base}/api/user_announcement`;
      const resp = await getJson(url, timeoutMs);
      const body = resp && typeof resp === 'object' && resp.body !== undefined ? resp.body : resp;
      const list = body && Array.isArray(body.data) ? body.data : [];

      for (const ann of list) {
        const key = resolveAnnouncementId(ann);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        try {
          sendToSide('server-message', ann);
        } catch (e) {
          logger.warn?.('[公告轮询] 下发公告到侧边栏失败:', e?.message || e);
        }
      }
    } catch (e) {
      logger.warn?.('[公告轮询] 拉取公告失败:', e?.message || e);
    } finally {
      inFlight = false;
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
  function refreshNow() {
    return pollOnce();
  }

  return { start, stop, refreshNow };
}

module.exports = { createAnnouncementPoller };
