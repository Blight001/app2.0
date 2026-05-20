// 格式化/规范化：normalizeHttpResult的具体业务逻辑。
function normalizeHttpResult(resp) {
  if (!resp) return { ok: false, message: 'HTTP请求失败' };
  const body = resp.body;
  if (body && typeof body === 'object') {
    return { ok: resp.ok, status: resp.status, ...body };
  }
  return { ok: resp.ok, status: resp.status, raw: resp.raw };
}

// 创建/初始化：buildHttpUrl的具体业务逻辑。
function buildHttpUrl(getServerBase, pathname) {
  const base = typeof getServerBase === 'function' ? getServerBase() : '';
  if (!base) return '';
  return base.replace(/\/+$/, '') + pathname;
}

// 处理：executeHttpRequest的具体业务逻辑。
async function executeHttpRequest({
  getServerBase,
  getJson,
  postJson,
  path,
  method = 'POST',
  data,
  timeoutMs,
}) {
  const url = buildHttpUrl(getServerBase, path);
  if (!url) {
    throw new Error('HTTP服务器地址未配置');
  }

  const upperMethod = String(method || 'POST').toUpperCase();
  console.log(`[HTTP] 请求地址: ${upperMethod} ${url}`);
  const response = upperMethod === 'GET'
    ? await getJson(url, timeoutMs)
    : await postJson(url, data, timeoutMs);
  return {
    ...normalizeHttpResult(response),
    requestUrl: url,
    requestMethod: upperMethod,
    requestPath: path,
  };
}

// 处理：executeWithFallback的具体业务逻辑。
async function executeWithFallback({
  actionLabel,
  tcpRequest,
  httpRequest,
  onFallback,
}) {
  try {
    const tcpResult = await tcpRequest();
    if (tcpResult && typeof tcpResult === 'object') {
      return {
        ...tcpResult,
        transportMode: 'tcp',
      };
    }
    return tcpResult;
  } catch (error) {
    if (typeof onFallback === 'function') {
      onFallback(error);
    } else if (actionLabel) {
      console.warn(`[TCP] ${actionLabel} TCP失败，尝试HTTP降级:`, error?.message || error);
    }
    const httpResult = await httpRequest();
    if (httpResult && typeof httpResult === 'object') {
      return {
        ...httpResult,
        transportMode: 'http',
        transportFallbackReason: error?.message || String(error || ''),
      };
    }
    return httpResult;
  }
}

module.exports = {
  buildHttpUrl,
  executeHttpRequest,
  executeWithFallback,
  normalizeHttpResult,
};
