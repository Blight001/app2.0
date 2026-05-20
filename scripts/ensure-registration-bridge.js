const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.resolve(projectRoot, '..', '账号处理', '注册账号2.0', 'Electron');
const targetDir = path.resolve(projectRoot, 'src', 'assets', 'extensions', 'registration');
const useColor = Boolean(process.stdout && process.stdout.isTTY);
const ANSI = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};
const ROOT_ALLOWLIST = new Set([
  'main.js',
  'package.json',
  'package-lock.json',
  'core',
  'src',
  'ui',
  'resource',
]);

function hasRegistrationApp(dir) {
  return fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'main.js'));
}

function shouldCopyRootEntry(name) {
  return ROOT_ALLOWLIST.has(name);
}

function copyRecursive(src, dest) {
  const stat = fs.lstatSync(src);

  if (stat.isSymbolicLink()) {
    const realPath = fs.realpathSync(src);
    return copyRecursive(realPath, dest);
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function ensureRegistrationBridge() {
  if (!hasRegistrationApp(sourceDir)) {
    return {
      changed: false,
      message: `注册器后端已移除，跳过同步: ${sourceDir}`,
      copiedEntries: [],
    };
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  let resetSucceeded = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    resetSucceeded = true;
  } catch (error) {
    console.warn(`[bridge] 重建注册器桥接目录失败，改为就地覆盖: ${error.message}`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const copiedEntries = [];
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!shouldCopyRootEntry(entry.name)) {
      continue;
    }
    copyRecursive(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    copiedEntries.push(entry.name);
  }

  return {
    changed: true,
    message: resetSucceeded
      ? `已同步注册器桥接 -> ${targetDir}`
      : `已就地覆盖注册器桥接 -> ${targetDir}`,
    copiedEntries,
  };
}

try {
  const result = ensureRegistrationBridge();
  console.log(useColor ? `${ANSI.cyan}[bridge] ${result.message}${ANSI.reset}` : `[bridge] ${result.message}`);
  if (Array.isArray(result.copiedEntries)) {
    console.log(useColor ? `${ANSI.green}[bridge] 已同步条目: ${result.copiedEntries.join(', ')}${ANSI.reset}` : `[bridge] 已同步条目: ${result.copiedEntries.join(', ')}`);
  }
} catch (error) {
  console.error(useColor ? `${ANSI.red}[bridge] 创建注册器桥接失败: ${error.message}${ANSI.reset}` : '[bridge] 创建注册器桥接失败:', error.message);
  process.exitCode = 1;
}
