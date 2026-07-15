const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');
const { verifyPackagedRuntime } = require('./verify-packaged-runtime');

const projectDir = path.resolve(__dirname, '..');
const extensionsDir = path.join(projectDir, 'src', 'assets', 'extensions');
const configPath = path.join(projectDir, 'platforms-config.json');
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

async function buildWithRetry(options, label, { beforeRetry } = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await build(options);
      return;
    } catch (error) {
      if (!isTransientFileLock(error) || attempt === maxAttempts) {
        if (isTransientFileLock(error)) {
          error.message = `${error.message}\n${label}连续 ${maxAttempts} 次遇到文件占用。请完全退出正在运行的 AI-FREE 后重试；不要直接结束其他 Clash 软件的进程。`;
        }
        throw error;
      }

      console.warn(`[build:win] ${label}遇到临时文件占用，等待 5 秒后进行第 ${attempt}/${maxAttempts - 1} 次重试...`);
      await delay(5000);
      if (typeof beforeRetry === 'function') {
        await beforeRetry();
      }
    }
  }
}

function isChromiumExtraResource(entry) {
  return entry
    && String(entry.from || '').replace(/\\/g, '/') === 'resources/chromium';
}

function syncChromiumRuntime(appOutDir) {
  const sourceDir = path.join(projectDir, 'resources', 'chromium');
  const targetDir = path.join(appOutDir, 'resources', 'chromium');
  if (!fs.existsSync(path.join(sourceDir, 'ai-free-browser.exe'))) {
    throw new Error(`未找到内置 Chromium: ${sourceDir}`);
  }

  const resolvedOutput = path.resolve(appOutDir);
  const resolvedBuildRoot = path.resolve(projectDir, 'appbuild');
  if (resolvedOutput !== path.join(resolvedBuildRoot, 'win-unpacked')) {
    throw new Error(`拒绝同步 Chromium 到非预期目录: ${resolvedOutput}`);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
  console.log(`[build:win] Chromium 已独立同步到: ${targetDir}`);
}

function cleanAppOutput(appOutDir) {
  const resolvedOutput = path.resolve(appOutDir);
  const expectedOutput = path.resolve(projectDir, 'appbuild', 'win-unpacked');
  if (resolvedOutput !== expectedOutput) {
    throw new Error(`拒绝清理非预期构建目录: ${resolvedOutput}`);
  }
  fs.rmSync(resolvedOutput, { recursive: true, force: true });
}

async function cleanAppOutputForRetry(appOutDir) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      cleanAppOutput(appOutDir);
      return;
    } catch (error) {
      if (!isTransientFileLock(error) || attempt === maxAttempts) throw error;
      console.warn(`[build:win] 半成品目录仍被占用，等待 2 秒后再次清理 (${attempt}/${maxAttempts - 1})...`);
      await delay(2000);
    }
  }
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

  const outputDir = path.resolve(projectDir, builderConfig.directories?.output || 'dist');
  const appOutDir = path.join(outputDir, 'win-unpacked');
  const extraResources = Array.isArray(builderConfig.extraResources)
    ? builderConfig.extraResources
    : [];
  if (!extraResources.some(isChromiumExtraResource)) {
    throw new Error('build.extraResources 缺少 resources/chromium');
  }

  // Chromium 的 chrome.dll 体积很大。electron-builder 在复制它的同时会并行
  // 处理/签名同目录可执行文件，Windows 偶发返回 EBUSY。先在不包含 Chromium
  // 的情况下生成完整应用，再独立同步 Chromium，最后由预打包目录生成 NSIS。
  const stageConfig = {
    ...builderConfig,
    extraResources: extraResources.filter((entry) => !isChromiumExtraResource(entry)),
  };
  const stageOptions = {
    projectDir,
    targets: Platform.WINDOWS.createTarget('dir'),
    config: stageConfig,
  };

  cleanAppOutput(appOutDir);
  await buildWithRetry(stageOptions, '应用预打包阶段', {
    // 首次失败会留下半成品。重试前清掉它，避免刚生成的 exe 被扫描器
    // 短暂占用后，下一轮继续复制到同一个目标文件而再次触发 EBUSY。
    beforeRetry: () => cleanAppOutputForRetry(appOutDir),
  });
  syncChromiumRuntime(appOutDir);
  verifyPackagedRuntime({ projectDir, appOutDir });

  const installerOptions = {
    projectDir,
    targets: Platform.WINDOWS.createTarget('nsis'),
    config: builderConfig,
    prepackaged: appOutDir,
  };
  await buildWithRetry(installerOptions, 'NSIS 安装包阶段');
}

main().catch((error) => {
  console.error(`[build:win] ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
