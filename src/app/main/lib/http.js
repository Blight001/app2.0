// 基础 HTTP 辅助（主进程使用）
// 说明：为了兼容部分环境，HTTPS 默认放宽证书校验（rejectUnauthorized:false）

const https = require('https');
const http = require('http');

// 处理：requestJson的具体业务逻辑。
function requestJson(method, url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const timeoutMs = Number(options.timeoutMs) || 15000;
      const headers = options.headers && typeof options.headers === 'object'
        ? { ...options.headers }
        : {};
      const upperMethod = String(method || 'GET').toUpperCase();
      const payload = ['GET', 'HEAD'].includes(upperMethod)
        ? null
        : Buffer.from(JSON.stringify(options.data ?? {}));
      const opts = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: upperMethod,
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: false } : {}),
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(payload ? { 'Content-Length': payload.length } : {}),
        }
      };
      const lib = isHttps ? https : http;
      const req = lib.request(opts, (res) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: json, raw: body });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} reject(new Error(`请求超时（${timeoutMs/1000|0}秒）`)); });
      if (payload) {
        req.write(payload);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// 处理：postJson的具体业务逻辑。
function postJson(url, data, timeoutMs = 15000, options = {}) {
  return requestJson('POST', url, { ...options, data, timeoutMs });
}

// 获取/读取/解析：getJson的具体业务逻辑。
function getJson(url, timeoutMs = 15000, options = {}) {
  if (timeoutMs && typeof timeoutMs === 'object') {
    options = timeoutMs || {};
    timeoutMs = Number(options.timeoutMs || 15000);
  }
  return requestJson('GET', url, { ...options, timeoutMs });
}

// 处理：httpGetUniversal的具体业务逻辑。
function httpGetUniversal(urlStr, timeoutMs = 10000) {
  return requestJson('GET', urlStr, {
    timeoutMs,
    headers: { Accept: 'application/json' },
  });
}

module.exports = { postJson, getJson, httpGetUniversal };

