// 基础 HTTP 辅助（主进程使用）
// 说明：为了兼容部分环境，HTTPS 默认放宽证书校验（rejectUnauthorized:false）

const https = require('https');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

function getProxyAuthorization(proxyUrl) {
  if (!proxyUrl?.username && !proxyUrl?.password) return '';
  return `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`;
}

function requestJsonOverHttpProxy(method, targetUrl, proxyUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(options.timeoutMs) || 15000;
    const upperMethod = String(method || 'GET').toUpperCase();
    const payload = ['GET', 'HEAD'].includes(upperMethod)
      ? null
      : Buffer.from(JSON.stringify(options.data ?? {}));
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
      ...(payload ? { 'Content-Length': payload.length } : {}),
    };
    const proxyAuthorization = getProxyAuthorization(proxyUrl);
    const proxyLib = proxyUrl.protocol === 'https:' ? https : http;

    const readResponse = (res, request) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body, raw });
      });
      res.on('aborted', () => reject(new Error('代理响应连接已中断')));
      res.on('error', reject);
      request?.on?.('error', reject);
    };
    const handleTimeout = (request) => {
      try { request.destroy(); } catch (_) {}
      reject(new Error(`请求超时（${timeoutMs / 1000 | 0}秒）`));
    };

    if (targetUrl.protocol === 'http:') {
      const request = proxyLib.request({
        hostname: proxyUrl.hostname,
        port: proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.href,
        method: upperMethod,
        timeout: timeoutMs,
        ...(proxyUrl.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
        headers: {
          ...headers,
          Host: targetUrl.host,
          ...(proxyAuthorization ? { 'Proxy-Authorization': proxyAuthorization } : {}),
        },
      }, (res) => readResponse(res, request));
      request.on('error', reject);
      request.on('timeout', () => handleTimeout(request));
      if (payload) request.write(payload);
      request.end();
      return;
    }

    // 必须由标准 Agent 持有并复用 CONNECT 返回的 socket。旧实现先手动
    // CONNECT，再给 agent:false 的 https.request 传 createConnection；Node
    // 实际忽略了该回调并另开直连 TLS，造成“浏览器是 JP、检测却是 CN”。
    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false,
      headers: proxyAuthorization ? { 'Proxy-Authorization': proxyAuthorization } : {},
    });
    const request = https.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + (targetUrl.search || ''),
      method: upperMethod,
      timeout: timeoutMs,
      rejectUnauthorized: false,
      agent,
      headers,
    }, (response) => readResponse(response, request));
    request.on('error', reject);
    request.on('timeout', () => handleTimeout(request));
    if (payload) request.write(payload);
    request.end();
  });
}

// 处理：requestJson的具体业务逻辑。
function requestJson(method, url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const proxyServer = String(options.proxyServer || '').trim();
      if (proxyServer) {
        const proxyUrl = new URL(proxyServer);
        if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
          throw new Error(`IP 探测暂不支持此代理协议: ${proxyUrl.protocol}`);
        }
        requestJsonOverHttpProxy(method, u, proxyUrl, options).then(resolve, reject);
        return;
      }
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
        // 连接可能在响应头已经到达后才被对端重置。此时错误由响应流而不是
        // ClientRequest 发出；若不监听，会变成主进程里的裸 ECONNRESET。
        res.on('aborted', () => reject(new Error('响应连接已中断')));
        res.on('error', reject);
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

// 发送：postEventStream。逐事件解析 SSE，供 AI 思考、工具调用和正文实时转发。
function postEventStream(url, data, onEvent, timeoutMs = 180000, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const signal = options?.signal;
      if (signal?.aborted) {
        const error = new Error('AI 输出已停止');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const payload = Buffer.from(JSON.stringify(data ?? {}));
      const lib = isHttps ? https : http;
      const req = lib.request({
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'POST',
        timeout: Number(timeoutMs) || 180000,
        ...(isHttps ? { rejectUnauthorized: false } : {}),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Content-Length': payload.length,
        },
      }, (res) => {
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        if (res.statusCode < 200 || res.statusCode >= 300 || !contentType.includes('text/event-stream')) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body = null;
            try { body = JSON.parse(raw); } catch (_) {}
            resolve({
              ok: false,
              status: res.statusCode,
              message: body?.message || body?.error || raw || `HTTP ${res.statusCode}`,
              ...(body && typeof body === 'object' ? body : {}),
            });
          });
          return;
        }

        let buffer = '';
        let finalResult = null;
        let streamError = null;
        const dispatchBlock = (block) => {
          let eventName = 'message';
          const dataLines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message';
            if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) return;
          const rawData = dataLines.join('\n');
          if (rawData === '[DONE]') return;
          let eventData = rawData;
          try { eventData = JSON.parse(rawData); } catch (_) {}
          if (eventName === 'result') finalResult = eventData;
          if (eventName === 'error') streamError = eventData;
          try { onEvent?.({ type: eventName, ...(eventData && typeof eventData === 'object' ? eventData : { data: eventData }) }); } catch (_) {}
        };

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer = `${buffer}${chunk}`.replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (block.trim()) dispatchBlock(block);
            boundary = buffer.indexOf('\n\n');
          }
        });
        res.on('end', () => {
          if (buffer.trim()) dispatchBlock(buffer);
          resolve(finalResult || streamError || { ok: false, message: '流式响应意外结束' });
        });
        res.on('aborted', () => reject(new Error('流式响应连接已中断')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        try { req.destroy(); } catch (_) {}
        reject(new Error(`请求超时（${Math.round((Number(timeoutMs) || 180000) / 1000)}秒）`));
      });
      signal?.addEventListener?.('abort', () => {
        const error = new Error('AI 输出已停止');
        error.name = 'AbortError';
        try { req.destroy(error); } catch (_) {}
      }, { once: true });
      req.write(payload);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

// 处理：httpGetUniversal的具体业务逻辑。
function httpGetUniversal(urlStr, timeoutMs = 10000, options = {}) {
  return requestJson('GET', urlStr, {
    ...options,
    timeoutMs,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
}

module.exports = { postJson, postEventStream, getJson, httpGetUniversal };

