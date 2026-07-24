const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  cleanupStaleSourceSnapshots,
  createPackagedSourceSnapshot,
  isChromiumExtraResource,
  isClashCoreExtraResource,
  isDeferredExtraResource,
  replaceGeneratedSourceMapping,
} = require('../../scripts/build-windows');

test('Windows build defers Chromium and Clash Mini Core resources', () => {
  const chromium = { from: 'resources\\chromium', to: 'chromium' };
  const clashCore = { from: 'resources/clash-mini/core', to: 'clash-mini/core' };
  const nativeHost = { from: 'native/browser-host/build/Release/browser_host.node' };

  assert.equal(isChromiumExtraResource(chromium), true);
  assert.equal(isClashCoreExtraResource(clashCore), true);
  assert.equal(isDeferredExtraResource(chromium), true);
  assert.equal(isDeferredExtraResource(clashCore), true);
  assert.equal(isDeferredExtraResource(nativeHost), false);
});

test('staging uses a standalone config so electron-builder cannot append deferred resources', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/build-windows.js'), 'utf8');

  assert.match(source, /const stageConfigPath = writeStageConfigFile\(appOutDir, stageConfig\)/);
  assert.match(source, /config:\s*stageConfigPath/);
  assert.match(source, /finally\s*{\s*fs\.rmSync\(stageConfigPath,\s*{ force: true }\)/);
  assert.doesNotMatch(source, /config:\s*stageConfig[,\s]/);
});

test('Windows build packages an immutable generated-source snapshot', () => {
  const testRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ai-free-source-snapshot-test-'));
  const generatedSource = path.join(testRoot, 'generated-src');
  fs.mkdirSync(path.join(generatedSource, 'app', 'main'), { recursive: true });
  fs.writeFileSync(path.join(generatedSource, 'app', 'main', 'main.js'), 'module.exports = true;\n');

  const snapshot = createPackagedSourceSnapshot(generatedSource, testRoot);
  try {
    fs.rmSync(generatedSource, { recursive: true, force: true });
    assert.equal(
      fs.readFileSync(path.join(snapshot.sourceDir, 'app', 'main', 'main.js'), 'utf8'),
      'module.exports = true;\n',
    );
    assert.deepEqual(
      replaceGeneratedSourceMapping(
        { from: '.generated/app/src', to: 'src', filter: ['**/*'] },
        snapshot.sourceDir,
      ),
      { from: snapshot.sourceDir, to: 'src', filter: ['**/*'] },
    );
  } finally {
    snapshot.dispose();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(snapshot.rootDir), false);
});

test('snapshot recovery removes only owned snapshots whose process has exited', () => {
  const testRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ai-free-snapshot-recovery-test-'));
  const stale = path.join(testRoot, 'ai-free-package-source-stale');
  const active = path.join(testRoot, 'ai-free-package-source-active');
  const unknown = path.join(testRoot, 'ai-free-package-source-unknown');
  for (const directory of [stale, active, unknown]) fs.mkdirSync(directory);
  const owner = 'ai-free-build-windows';
  fs.writeFileSync(path.join(stale, '.owner.json'), JSON.stringify({ owner, pid: 101 }));
  fs.writeFileSync(path.join(active, '.owner.json'), JSON.stringify({ owner, pid: 202 }));

  try {
    assert.deepEqual(cleanupStaleSourceSnapshots(testRoot, (pid) => pid === 202), [stale]);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(active), true);
    assert.equal(fs.existsSync(unknown), true);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});
