// Clash 配置归一化：把服务器返回的直配 YAML 或机场订阅（base64 / vmess:// 列表）
// 统一转换成可被 verge-mihomo 启动的 config.yaml 文本。
// 逻辑移植自软件端 src/app/main/ipc/register/clash-mini-core.js，去掉 fs/electron 依赖。

const YAML = require('yaml');

function extractDirectClashConfigContent(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.replace(/^﻿/, '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('---')) return trimmed;
    if (/^(proxies|proxy-groups|rules|port|mixed-port|external-controller)\s*:/m.test(trimmed)) {
      return trimmed;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.config === 'string') return parsed.config;
        if (typeof parsed.data === 'string') return parsed.data;
        if (typeof parsed.content === 'string') return parsed.content;
      }
    } catch (_) {}
    return trimmed;
  }
  if (typeof value === 'object') {
    if (typeof value.clashConfig === 'string') return value.clashConfig;
    if (typeof value.clash_config === 'string') return value.clash_config;
    if (typeof value.config === 'string') return value.config;
    if (typeof value.data === 'string') return value.data;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.configContent === 'string') return value.configContent;
    if (typeof value.yaml_content === 'string') return value.yaml_content;
    if (typeof value.yamlContent === 'string') return value.yamlContent;
    if (typeof value.profiles_yaml_content === 'string') return value.profiles_yaml_content;
    if (typeof value.red_yaml_content === 'string') return value.red_yaml_content;
  }
  return '';
}

function tryDecodeBase64Text(text) {
  const raw = String(text || '').replace(/\s+/g, '');
  if (!raw || raw.length < 32 || raw.length % 4 !== 0) return '';
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return '';
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/^﻿/, '').trim();
    if (!decoded || /[�]/.test(decoded)) return '';
    return decoded;
  } catch (_) {
    return '';
  }
}

function safeBase64UrlDecode(input) {
  const raw = String(input || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!raw) return '';
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8').replace(/^﻿/, '').trim();
  } catch (_) {
    return '';
  }
}

function looksLikeSubscriptionPayload(text) {
  return /^(vmess|vless|trojan|ss|ssr):\/\//im.test(String(text || '').trim());
}

function decodeSubscriptionItemName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch (_) {
    return raw;
  }
}

function sanitizeProxyName(name, fallback) {
  const value = decodeSubscriptionItemName(name || fallback || '').replace(/\s+/g, ' ').trim();
  return value || String(fallback || 'proxy').trim() || 'proxy';
}

function parseVmessSubscriptionLine(line, index) {
  const raw = String(line || '').trim();
  if (!raw.startsWith('vmess://')) return null;
  const payload = safeBase64UrlDecode(raw.slice('vmess://'.length));
  if (!payload) return null;
  let json = null;
  try {
    json = JSON.parse(payload);
  } catch (_) {
    return null;
  }
  const server = String(json.add || json.server || '').trim();
  const port = Number(json.port);
  const uuid = String(json.id || json.uuid || '').trim();
  if (!server || !Number.isFinite(port) || port <= 0 || !uuid) return null;

  const proxyName = sanitizeProxyName(json.ps, `${server}:${port}-${index + 1}`);
  const network = String(json.net || 'tcp').trim().toLowerCase();
  const hostHeader = String(json.host || json.headers?.Host || '').trim();
  const pathValue = String(json.path || '').trim();
  const tlsEnabled = ['1', 'true', 'tls', 'on', 'yes'].includes(String(json.tls || '').trim().toLowerCase());
  const servername = String(json.sni || json.servername || hostHeader || server).trim();
  const proxy = {
    name: proxyName,
    type: 'vmess',
    server,
    port,
    uuid,
    alterId: Number.isFinite(Number(json.aid)) ? Number(json.aid) : 0,
    cipher: String(json.cipher || 'auto').trim() || 'auto',
    udp: json.udp !== false,
    tls: tlsEnabled,
  };
  if (tlsEnabled && servername) proxy.servername = servername;
  if (String(json.skip_cert_verify || '').toLowerCase() === 'true' || json.skipCertVerify === true) {
    proxy['skip-cert-verify'] = true;
  }
  if (network === 'ws') {
    proxy.network = 'ws';
    proxy['ws-opts'] = { path: pathValue || '/' };
    if (hostHeader) proxy['ws-opts'].headers = { Host: hostHeader };
  } else if (network === 'h2' || network === 'http') {
    proxy.network = 'http';
    proxy['http-opts'] = { path: pathValue ? [pathValue] : ['/'] };
    if (hostHeader) proxy['http-opts'].headers = { Host: hostHeader };
  } else if (network === 'grpc') {
    proxy.network = 'grpc';
    proxy['grpc-opts'] = { 'grpc-service-name': pathValue.replace(/^\//, '') };
  } else if (network && network !== 'tcp') {
    proxy.network = network;
  }
  return proxy;
}

function parseSubscriptionProxyList(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && !line.startsWith('#'));
  const proxies = [];
  lines.forEach((line, index) => {
    const proxy = parseVmessSubscriptionLine(line, index);
    if (proxy) proxies.push(proxy);
  });
  return proxies;
}

function buildClashRuntimeConfigFromSubscription(text) {
  const content = String(text || '').trim();
  const decodedBase64 = tryDecodeBase64Text(content);
  const subscriptionText = looksLikeSubscriptionPayload(content)
    ? content
    : (looksLikeSubscriptionPayload(decodedBase64) ? decodedBase64 : '');
  if (!subscriptionText) return null;
  const proxies = parseSubscriptionProxyList(subscriptionText);
  if (!proxies.length) return null;
  const proxyNames = proxies.map((item) => item.name).filter(Boolean);
  return {
    port: 7890,
    'socks-port': 7891,
    'mixed-port': 7890,
    mode: 'rule',
    'log-level': 'info',
    'allow-lan': true,
    'external-controller': '127.0.0.1:9090',
    proxies,
    'proxy-groups': [
      {
        name: '节点选择',
        type: 'select',
        proxies: [...proxyNames, 'DIRECT'],
      },
    ],
    rules: ['MATCH,节点选择'],
  };
}

function ensureClashMiniControlFields(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const next = { ...config };
  if (!String(next['external-controller'] || next.external_controller || '').trim()) {
    next['external-controller'] = '127.0.0.1:9090';
  }
  return next;
}

// 输入：服务器返回的任意配置载体（字符串/对象/base64/订阅）。
// 输出：{ ok, content(YAML字符串), rawContent } 或 { ok:false, error }
function normalizeDirectClashRuntimeConfig(rawContent) {
  const text = extractDirectClashConfigContent(rawContent);
  if (!text) return { ok: false, error: '空的 Clash 配置内容', rawContent: '' };

  try {
    const parsed = YAML.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, content: YAML.stringify(ensureClashMiniControlFields(parsed)), rawContent: text };
    }
    if (typeof parsed === 'string') {
      const stringConverted = buildClashRuntimeConfigFromSubscription(parsed);
      if (stringConverted) {
        return { ok: true, content: YAML.stringify(stringConverted), rawContent: parsed };
      }
    }
  } catch (_) {}

  const decodedBase64 = tryDecodeBase64Text(text);
  if (decodedBase64) {
    try {
      const parsed = YAML.parse(decodedBase64);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, content: YAML.stringify(ensureClashMiniControlFields(parsed)), rawContent: decodedBase64 };
      }
    } catch (_) {}
    const converted = buildClashRuntimeConfigFromSubscription(decodedBase64);
    if (converted) {
      return { ok: true, content: YAML.stringify(converted), rawContent: decodedBase64 };
    }
  }

  const converted = buildClashRuntimeConfigFromSubscription(text);
  if (converted) {
    return { ok: true, content: YAML.stringify(converted), rawContent: text };
  }

  return { ok: false, error: 'Clash 配置解析失败', rawContent: text };
}

module.exports = {
  extractDirectClashConfigContent,
  tryDecodeBase64Text,
  buildClashRuntimeConfigFromSubscription,
  ensureClashMiniControlFields,
  normalizeDirectClashRuntimeConfig,
};
