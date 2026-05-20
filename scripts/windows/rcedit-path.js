const fs = require('fs');
const path = require('path');

function findRceditUnder(dir, preferredNames) {
  if (!dir || !fs.existsSync(dir)) {
    return null;
  }

  const queue = [dir];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries = [];

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const preferredName of preferredNames) {
      const directMatch = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === preferredName.toLowerCase());
      if (directMatch) {
        return path.join(current, directMatch.name);
      }
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return null;
}

function resolveRceditPath() {
  const candidates = [];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign'));
  }

  candidates.push(
    path.join(__dirname, '..', '..', 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe')
  );

  for (const candidate of candidates) {
    const resolved = findRceditUnder(candidate, ['rcedit-x64.exe', 'rcedit-ia32.exe']);
    if (resolved) {
      return resolved;
    }

    if (candidate.endsWith('.exe') && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

module.exports = {
  resolveRceditPath,
};
