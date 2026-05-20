const fs = require('fs');
const path = require('path');

const LOCAL_SIDE_URL = 'http://127.0.0.1:8787/control-panel/';
const REMOTE_SIDE_URL = 'http://49.234.181.190:8787/';

function parseArgs(argv) {
  const result = {};
  for (const item of argv) {
    const text = String(item || '').trim();
    if (!text.startsWith('--')) continue;
    const eqIndex = text.indexOf('=');
    if (eqIndex === -1) {
      result[text.slice(2)] = 'true';
      continue;
    }
    const key = text.slice(2, eqIndex);
    const value = text.slice(eqIndex + 1);
    result[key] = value;
  }
  return result;
}

function resolveSideUrl(options = {}) {
  const explicit = String(options.url || '').trim();
  if (explicit) {
    return explicit;
  }

  const mode = String(options.mode || '').trim().toLowerCase();
  if (mode === 'local' || mode === 'debug') {
    return LOCAL_SIDE_URL;
  }
  if (mode === 'remote' || mode === 'release' || mode === 'build' || mode === 'packaged') {
    return REMOTE_SIDE_URL;
  }

  const envMode = String(process.env.SIDE_URL_MODE || process.env.SIDE_URL_PROFILE || '').trim().toLowerCase();
  if (envMode === 'local' || envMode === 'debug') {
    return LOCAL_SIDE_URL;
  }
  if (envMode === 'remote' || envMode === 'release' || envMode === 'build' || envMode === 'packaged') {
    return REMOTE_SIDE_URL;
  }

  const envUrl = String(process.env.SIDE_URL || process.env.SIDEBAR_URL || '').trim();
  if (envUrl) {
    return envUrl;
  }

  return REMOTE_SIDE_URL;
}

function updateConfigFile(sideUrl) {
  const configPath = path.resolve(process.cwd(), 'config', 'platforms-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw || '{}');
  const platformConfigs = cfg.platformConfigs && typeof cfg.platformConfigs === 'object'
    ? cfg.platformConfigs
    : {};
  const defaultPlatform = String(cfg.defaultPlatform || '').trim() || 'default';
  const baseConfig = platformConfigs[defaultPlatform] && typeof platformConfigs[defaultPlatform] === 'object'
    ? platformConfigs[defaultPlatform]
    : {};

  const nextPlatformConfig = {
    ...baseConfig,
    sideUrl,
    sidebarUrl: sideUrl,
  };

  const nextConfig = {
    ...cfg,
    sideUrl,
    sidebarUrl: sideUrl,
    platformConfigs: {
      ...platformConfigs,
      [defaultPlatform]: nextPlatformConfig,
    },
  };

  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
  return configPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sideUrl = resolveSideUrl(args);
  const configPath = updateConfigFile(sideUrl);
  console.log(`[side-url] updated ${configPath} -> ${sideUrl}`);
}

main();
