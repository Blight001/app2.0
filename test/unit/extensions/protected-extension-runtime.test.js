'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createProtectedExtensionRuntime } = require('../../../src/app/main/features/extensions/protected-extension-runtime');

test('failed extension copy never publishes a partial runtime directory', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-extension-atomic-test-'));
  const sourcePath = path.join(tempDir, 'browser_automation');
  const userData = path.join(tempDir, 'user-data');
  fs.mkdirSync(sourcePath, { recursive: true });
  fs.writeFileSync(path.join(sourcePath, 'manifest.json'), '{"manifest_version":3}', 'utf8');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const errors = [];
  const runtime = createProtectedExtensionRuntime({
    app: { getPath: () => userData },
    browserAutomationDirName: 'browser_automation',
    browserAutomationEnvFile: 'environment.js',
    copyDirectoryRecursive: (_source, target) => {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'partial.js'), 'partial', 'utf8');
      throw new Error('simulated interrupted copy');
    },
    fs,
    getBrowserAutomationAccessToken: () => 'session-token',
    hashId: (value) => require('node:crypto').createHash('sha1').update(value).digest('hex').slice(0, 16),
    isPathInside: (parent, child) => !path.relative(parent, child).startsWith('..'),
    logger: { log() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
    normalizeAbsolutePath: (value) => path.resolve(value),
    path,
    protectedRuntimeDirName: 'protected-extension-runtime',
  });

  const result = runtime.prepareProtectedBrowserAutomationPath({
    builtin: true,
    path: sourcePath,
    runtimeSignature: 'source-v1',
  });
  assert.equal(result, '');
  const runtimeRoot = path.join(userData, 'protected-extension-runtime');
  assert.deepEqual(fs.existsSync(runtimeRoot) ? fs.readdirSync(runtimeRoot) : [], []);
  assert.match(errors.join('\n'), /simulated interrupted copy/);
});
