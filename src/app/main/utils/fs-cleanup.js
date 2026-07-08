function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDirectoryWithRetries(fs, dirPath, options = {}) {
  const {
    attempts = 3,
    delayMs = 200,
    logger = null,
    failureMessage = '删除目录失败:',
  } = options;

  if (!fs || !dirPath) return false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (fs.promises.rm) {
        await fs.promises.rm(dirPath, { recursive: true, force: true });
      } else {
        await fs.promises.rmdir(dirPath, { recursive: true });
      }
      return true;
    } catch (error) {
      if (attempt >= attempts) {
        logger?.warn?.(failureMessage, dirPath, error?.message || error);
        return false;
      }
      await delay(delayMs);
    }
  }

  return false;
}

module.exports = {
  removeDirectoryWithRetries,
};
