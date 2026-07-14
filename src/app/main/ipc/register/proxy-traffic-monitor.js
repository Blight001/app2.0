const crypto = require('crypto');

const SAMPLE_INTERVAL_MS = 2000;
const DEFAULT_REPORT_INTERVAL_MS = 30000;
const EARLY_REPORT_BYTES = 8 * 1024 * 1024;

function normalizeCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function signReport(secret, fields) {
  const message = [
    fields.session_id,
    fields.sequence,
    fields.reported_at,
    fields.upload_bytes,
    fields.download_bytes,
  ].join('\n');
  return crypto.createHmac('sha256', String(secret || '')).update(message, 'utf8').digest('hex');
}

function createProxyTrafficMonitor({ httpClient, ui, readCredentials, readTotals, onExhausted, logger = console } = {}) {
  let timer = null;
  let session = null;
  let previous = null;
  let pendingUpload = 0;
  let pendingDownload = 0;
  let sequence = 0;
  let reporting = null;
  let lastReportAt = 0;

  const emitQuota = (quota) => {
    if (!quota) return;
    try { ui?.sendToSide?.('proxy-traffic-quota', quota); } catch (_) {}
  };

  const authorize = async () => {
    const credentials = typeof readCredentials === 'function' ? readCredentials() : {};
    const key = String(credentials?.key || '').trim();
    const deviceId = String(credentials?.deviceId || '').trim();
    if (!key || !deviceId) return { ok: false, message: '请先在个人中心登录账号' };
    const result = await httpClient.createProxyTrafficSession(key, deviceId);
    if (!result?.ok) return result || { ok: false, message: '无法初始化流量计量会话' };
    if (!result.session_id || !result.report_secret) {
      return { ok: false, message: '服务器未返回安全流量计量会话' };
    }
    session = {
      id: String(result.session_id),
      secret: String(result.report_secret),
      expiresAt: Number(result.expires_at || 0),
      reportIntervalMs: Math.max(10000, Number(result.report_interval_seconds || 30) * 1000),
    };
    sequence = 0;
    previous = null;
    pendingUpload = 0;
    pendingDownload = 0;
    lastReportAt = Date.now();
    emitQuota(result.quota);
    return result;
  };

  const flush = async ({ force = false } = {}) => {
    if (reporting) return reporting;
    if (!session) return { ok: false, skipped: true };
    const total = pendingUpload + pendingDownload;
    if (!force && total <= 0) return { ok: true, skipped: true };
    if (total <= 0) return { ok: true, skipped: true };
    const upload = pendingUpload;
    const download = pendingDownload;
    const nextSequence = sequence + 1;
    const reportedAt = Math.floor(Date.now() / 1000);
    const payload = {
      session_id: session.id,
      sequence: nextSequence,
      reported_at: reportedAt,
      upload_bytes: upload,
      download_bytes: download,
    };
    payload.signature = signReport(session.secret, payload);
    reporting = (async () => {
      const result = await httpClient.reportProxyTraffic(payload);
      if (!result?.ok) {
        if (result?.session_expired) session = null;
        throw new Error(result?.message || result?.error || '流量上报失败');
      }
      pendingUpload = Math.max(0, pendingUpload - upload);
      pendingDownload = Math.max(0, pendingDownload - download);
      sequence = nextSequence;
      lastReportAt = Date.now();
      emitQuota(result.quota);
      if (result.stop_required === true || result.quota?.exhausted === true) {
        clearInterval(timer);
        timer = null;
        await Promise.resolve(onExhausted?.(result.quota)).catch(() => {});
      }
      return result;
    })().catch((error) => {
      logger.warn?.('[流量计量] 安全上报失败，将保留增量稍后重试:', error?.message || error);
      return { ok: false, message: error?.message || String(error) };
    }).finally(() => {
      reporting = null;
    });
    return reporting;
  };

  const sample = async () => {
    if (!session || typeof readTotals !== 'function') return;
    try {
      const totals = await readTotals();
      const current = {
        upload: normalizeCounter(totals?.uploadTotal ?? totals?.upload_total),
        download: normalizeCounter(totals?.downloadTotal ?? totals?.download_total),
      };
      if (previous) {
        pendingUpload += current.upload >= previous.upload ? current.upload - previous.upload : current.upload;
        pendingDownload += current.download >= previous.download ? current.download - previous.download : current.download;
      }
      previous = current;
      const due = Date.now() - lastReportAt >= (session.reportIntervalMs || DEFAULT_REPORT_INTERVAL_MS);
      if (due || pendingUpload + pendingDownload >= EARLY_REPORT_BYTES) await flush();
    } catch (error) {
      logger.debug?.('[流量计量] 暂时无法读取 Mihomo 累计流量:', error?.message || error);
    }
  };

  const start = () => {
    if (!session) return false;
    if (timer) clearInterval(timer);
    timer = setInterval(() => { sample().catch(() => {}); }, SAMPLE_INTERVAL_MS);
    setTimeout(() => { sample().catch(() => {}); }, 800);
    return true;
  };

  const stop = async () => {
    if (timer) clearInterval(timer);
    timer = null;
    await sample().catch(() => {});
    await flush({ force: true }).catch(() => {});
    previous = null;
    session = null;
  };

  return { authorize, start, stop, flush, sample, signReport };
}

module.exports = { createProxyTrafficMonitor, signReport };
