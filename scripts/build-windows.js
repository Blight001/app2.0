const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');

const projectDir = path.resolve(__dirname, '..');
const extensionsDir = path.join(projectDir, 'src', 'assets', 'extensions');
const configPath = path.join(projectDir, 'docs', 'config', 'platforms-config.json');
const packagePath = path.join(projectDir, 'package.json');
const alwaysPackagedExtensions = new Set(['clash-mini']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isTransientFileLock(error) {
  const code = error && error.code;
  const message = String(error && error.message ? error.message : error);
  return code === 'EBUSY' || code === 'EPERM' || /\b(?:EBUSY|EPERM)\b/.test(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePackagedExtensions() {
  const appConfig = readJson(configPath);
  const configured = appConfig.packagedExtensions;

  if (!Array.isArray(configured)) {
    throw new Error(`packagedExtensions 必须在 ${configPath} 中配置为字符串数组`);
  }

  const available = fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const selectable = available.filter((name) => !alwaysPackagedExtensions.has(name));
  const selected = new Set();

  for (const name of configured) {
    if (typeof name !== 'string' || !name || path.basename(name) !== name) {
      throw new Error(`packagedExtensions 中包含无效插件名称: ${JSON.stringify(name)}`);
    }
    if (alwaysPackagedExtensions.has(name)) {
      throw new Error(`${name} 无需配置，它始终会被打包`);
    }
    if (!selectable.includes(name)) {
      throw new Error(`packagedExtensions 中的插件不存在: ${name}`);
    }
    if (!selected.add(name)) {
      throw new Error(`packagedExtensions 中存在重复插件: ${name}`);
    }
  }

  return {
    selected: [...selected],
    excluded: selectable.filter((name) => !selected.has(name)),
  };
}

async function main() {
  const packageJson = readJson(packagePath);
  const builderConfig = packageJson.build || {};
  const { selected, excluded } = resolvePackagedExtensions();
  const configuredFiles = Array.isArray(builderConfig.files) ? builderConfig.files : [];

  builderConfig.files = [
    ...configuredFiles,
    ...excluded.map((name) => `!src/assets/extensions/${name}/**/*`),
  ];

  console.log(`[extensions] 本次配置打包: ${selected.join(', ') || '(无)'}`);
  console.log('[extensions] clash-mini 始终打包');
  if (excluded.length) {
    console.log(`[extensions] 本次排除: ${excluded.join(', ')}`);
  }

  if (process.argv.includes('--check')) {
    return;
  }

  const buildOptions = {
    projectDir,
    targets: Platform.WINDOWS.createTarget(),
    config: builderConfig,
  };

  try {
    await build(buildOptions);
  } catch (error) {
    if (!isTransientFileLock(error)) throw error;

    console.warn('[build:win] 检测到临时文件占用，等待 2 秒后自动重试一次...');
    await delay(2000);
    await build(buildOptions);
  }
}

main().catch((error) => {
  console.error(`[build:win] ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
