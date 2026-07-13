const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  assertSafeChromiumArgs,
  buildChromiumArgs,
  buildChromiumEnvironment,
  getSystemChromiumCandidates,
  resolveChromiumExecutable,
} = require('../src/app/main/browser-runtime/chromium-launcher');
const { encodeFrame, MAX_MESSAGE_BYTES, PROTOCOL_VERSION } = require('../src/app/main/browser-runtime/chromium-command-client');
const { ProfileRuntimeStore } = require('../src/app/main/browser-runtime/profile-runtime-store');
const { RUNTIME_STATUS } = require('../src/app/main/browser-runtime/runtime-types');
const { prepareSessionImport } = require('../src/app/main/browser-runtime/session-import');
const { ChromiumRuntime } = require('../src/app/main/browser-runtime/chromium-runtime');
const { resolveChromiumExtensionPaths } = require('../src/app/main/services/tab-manager');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-runtime-test-'));
(async () => {
try {
  const store = new ProfileRuntimeStore({ rootDir: root, logger: { warn() {} } });
  const paths = store.ensureProfile({ profileId: 'profile_001', runtimeType: 'chromium' });
  assert(fs.existsSync(paths.chromiumData));
  assert(fs.existsSync(paths.downloads));
  store.createState('profile_001', 'chromium');
  store.transition('profile_001', RUNTIME_STATUS.STARTING);
  store.transition('profile_001', RUNTIME_STATUS.WAITING_PIPE);
  assert.throws(() => store.transition('profile_001', RUNTIME_STATUS.READY), /非法运行时状态迁移/);
  store.acquireLock('profile_001');
  assert.throws(() => new ProfileRuntimeStore({ rootDir: root }).acquireLock('profile_001'), /已被进程/);
  store.releaseLock('profile_001');
  assert.equal(store.deleteProfile('profile_001'), true);
  assert.equal(fs.existsSync(paths.root), false);

  const rebuiltPaths = store.ensureProfile({ profileId: 'profile_001', runtimeType: 'chromium' });

  const args = buildChromiumArgs({
    profile: { profileId: 'profile_001', initialUrl: 'https://example.com' }, paths: rebuiltPaths,
    pipeName: '\\\\.\\pipe\\test', launchToken: 'one-time', hostHwnd: '123', bounds: { width: 800, height: 600 },
  });
  assert(args.some((arg) => arg.startsWith('--user-data-dir=')));
  assert(args.includes('--hs-profile-id=profile_001'));
  const managedExtension = path.join(root, 'managed-extension');
  const configuredExtension = path.join(root, 'configured-extension');
  fs.mkdirSync(managedExtension);
  fs.mkdirSync(configuredExtension);
  const extensionPaths = resolveChromiumExtensionPaths({
    chromiumExtensionPaths: [configuredExtension, managedExtension, ''],
  }, {
    getEnabledExtensionPaths: () => [managedExtension],
  });
  assert.deepEqual(extensionPaths, [managedExtension, configuredExtension]);
  const extensionArgs = buildChromiumArgs({
    profile: { profileId: 'profile_001', extensionPaths },
    paths: rebuiltPaths,
    pipeName: '\\\\.\\pipe\\test',
    launchToken: 'one-time',
  });
  assert(extensionArgs.includes(`--load-extension=${managedExtension},${configuredExtension}`));
  const googleEnvironment = buildChromiumEnvironment({}, {
    AI_FREE_GOOGLE_API_KEY: 'ai-free-api-key',
    AI_FREE_GOOGLE_CLIENT_ID: 'ai-free-client-id',
    AI_FREE_GOOGLE_CLIENT_SECRET: 'ai-free-client-secret',
  });
  assert.equal(googleEnvironment.GOOGLE_API_KEY, 'ai-free-api-key');
  assert.equal(googleEnvironment.GOOGLE_DEFAULT_CLIENT_ID, 'ai-free-client-id');
  assert.equal(googleEnvironment.GOOGLE_DEFAULT_CLIENT_SECRET, 'ai-free-client-secret');
  assert.equal(buildChromiumEnvironment({
    GOOGLE_API_KEY: 'native-key',
    AI_FREE_GOOGLE_API_KEY: 'branded-key',
  }).GOOGLE_API_KEY, 'native-key');
  assert(getSystemChromiumCandidates({
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
  }).some((candidate) => candidate.endsWith('Google\\Chrome\\Application\\chrome.exe')));
  assert.throws(() => assertSafeChromiumArgs(['--no-sandbox']), /禁止使用/);
  assert.throws(() => assertSafeChromiumArgs(['--remote-debugging-address=0.0.0.0']), /回环/);
  const packagedRoot = path.join(root, 'packaged-resources');
  const packagedBrowser = path.join(packagedRoot, 'chromium', 'ai-free-browser.exe');
  fs.mkdirSync(path.dirname(packagedBrowser), { recursive: true });
  fs.writeFileSync(packagedBrowser, 'test');
  assert.equal(resolveChromiumExecutable({ resourcesPath: packagedRoot, profile: {} }), packagedBrowser);
  // Development bootstrap must pass the application's resources directory,
  // not Electron's own node_modules/electron/dist/resources directory.
  const developmentResources = path.resolve(__dirname, '..', 'resources');
  if (fs.existsSync(path.join(developmentResources, 'chromium', 'ai-free-browser.exe'))) {
    assert.equal(
      resolveChromiumExecutable({ resourcesPath: developmentResources, profile: {} }),
      path.join(developmentResources, 'chromium', 'ai-free-browser.exe'),
    );
  }
  const legacyRoot = path.join(root, 'legacy-resources');
  const legacyChrome = path.join(legacyRoot, 'chromium', 'chrome.exe');
  fs.mkdirSync(path.dirname(legacyChrome), { recursive: true });
  fs.writeFileSync(legacyChrome, 'test');
  assert.throws(() => resolveChromiumExecutable({ resourcesPath: legacyRoot, profile: {} }), /正式模式禁止/);
  const previousHandshakeMode = process.env.AI_FREE_CHROMIUM_HANDSHAKE;
  process.env.AI_FREE_CHROMIUM_HANDSHAKE = 'prototype';
  assert.equal(resolveChromiumExecutable({
    resourcesPath: path.join(root, 'missing-resources'),
    executablePath: packagedBrowser,
    profile: {},
  }), packagedBrowser);
  if (previousHandshakeMode === undefined) delete process.env.AI_FREE_CHROMIUM_HANDSHAKE;
  else process.env.AI_FREE_CHROMIUM_HANDSHAKE = previousHandshakeMode;
  assert.throws(() => resolveChromiumExecutable({
    resourcesPath: path.join(root, 'missing-resources'),
    executablePath: packagedBrowser,
    profile: {},
  }), /正式模式禁止/);
  const frame = encodeFrame({ type: 'heartbeat', protocolVersion: PROTOCOL_VERSION });
  assert.equal(frame.readUInt32LE(0), frame.length - 4);
  assert.equal(JSON.parse(frame.subarray(4).toString('utf8')).type, 'heartbeat');
  assert.throws(() => encodeFrame({ payload: 'x'.repeat(MAX_MESSAGE_BYTES + 1) }), /消息过大/);
  const sessionImport = prepareSessionImport({
    targetUrl: 'https://app.example.com/work',
    cookies: [{
      name: 'auth', value: 'token', domain: '.example.com', path: '/work',
      secure: true, httpOnly: true, sameSite: 'None', expirationDate: 2_000_000_000,
    }],
    browserStorage: [{
      origin: 'https://app.example.com',
      localStorage: { local_key: 'local_value' },
      sessionStorage: { session_key: 'session_value' },
    }],
  });
  assert.deepEqual(sessionImport.cookies[0], {
    name: 'auth', value: 'token', url: 'https://app.example.com/work',
    domain: '.example.com', path: '/work', secure: true, httpOnly: true,
    sameSite: 'no_restriction', expires: 2_000_000_000,
  });
  assert.equal(sessionImport.browserStorage[0].origin, 'https://app.example.com');
  const mixedDomainImport = prepareSessionImport({
    targetUrl: 'https://app.example.com/',
    cookies: [
      { name: 'auth', value: 'valid', domain: '.example.com' },
      { name: 'NID', value: 'unrelated', url: 'https://www.google.com/', domain: '.google.com' },
    ],
    browserStorage: [
      { origin: 'https://app.example.com', localStorage: { valid: '1' } },
      { origin: 'https://unrelated.test', localStorage: { ignored: '1' } },
    ],
  });
  assert.deepEqual(mixedDomainImport.cookies.map((cookie) => cookie.name), ['auth']);
  assert.deepEqual(mixedDomainImport.browserStorage.map((entry) => entry.origin), ['https://app.example.com']);
  assert.equal(mixedDomainImport.skippedCookies, 1);
  assert.equal(mixedDomainImport.skippedStorageOrigins, 1);
  assert.throws(() => prepareSessionImport({
    targetUrl: 'https://app.example.com/',
    browserStorage: [{
      origin: 'https://app.example.com',
      localStorage: { huge: 'x'.repeat(3 * 1024 * 1024) },
    }],
  }), (error) => ['SESSION_STORAGE_LIMIT', 'SESSION_IMPORT_TOO_LARGE'].includes(error.code));
  const navigationTimeoutRuntime = new ChromiumRuntime({
    logger: { info() {}, warn() {} },
  });
  const navigationTimeoutCodes = ['NAVIGATION_TIMEOUT', 'RUNTIME_COMMAND_TIMEOUT'];
  navigationTimeoutRuntime.getReadyInstance = () => ({
    commandClient: {
      async send(command) {
        if (command === 'navigate') {
          const error = new Error('Runtime Bridge 命令超时: navigate');
          error.code = navigationTimeoutCodes.shift();
          throw error;
        }
        return { result: { imported: 0 } };
      },
    },
  });
  const pendingNavigationImport = await navigationTimeoutRuntime.importSession('slow-profile', {
    targetUrl: 'https://slow.example.com/',
  });
  assert.equal(pendingNavigationImport.ok, true);
  assert.equal(pendingNavigationImport.navigation.pending, true);
  assert.equal(pendingNavigationImport.navigation.timedOut, true);
  const bridgeTimeoutImport = await navigationTimeoutRuntime.importSession('bridge-timeout-profile', {
    targetUrl: 'https://slow.example.com/',
  });
  assert.equal(bridgeTimeoutImport.ok, true);
  assert.equal(bridgeTimeoutImport.navigation.pending, true);
  assert.equal(bridgeTimeoutImport.navigation.timedOut, true);
  console.log('browser runtime checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
