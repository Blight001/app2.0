'use strict';

const crypto = require('crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function buildBrowserProfileCacheKey(browserSettings = {}, proxyServer = '') {
  const input = JSON.stringify(stableValue({ browserSettings, proxyServer: String(proxyServer || '') }));
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

module.exports = { buildBrowserProfileCacheKey };
