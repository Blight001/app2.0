const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  applyChromiumSessionStartupPolicy,
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
const { createTabManager, resolveChromiumExtensionPaths } = require('../src/app/main/services/tab-manager');

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
  assert(args.includes('https://example.com'));
  assert(args.includes('--window-position=-32000,-32000'));
  const localizedArgs = buildChromiumArgs({
    profile: {
      profileId: 'localized-profile',
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    },
    paths: rebuiltPaths,
    pipeName: '\\\\.\\pipe\\localized-profile-test',
    launchToken: 'one-time',
  });
  assert(localizedArgs.includes('--lang=ja-JP'));
  assert(localizedArgs.includes('--hs-timezone-id=Asia/Tokyo'));
  const unicodeProfilePaths = store.ensureProfile({ profileId: '豆包::account@example.com', runtimeType: 'chromium' });
  assert.match(unicodeProfilePaths.id, /^[\x21-\x7e]+$/, '握手 Profile ID 必须是可见 ASCII');
  const unicodeProfileArgs = buildChromiumArgs({
    profile: { profileId: '豆包::account@example.com' },
    runtimeProfileId: unicodeProfilePaths.id,
    paths: unicodeProfilePaths,
    pipeName: '\\\\.\\pipe\\unicode-profile-test',
    launchToken: 'one-time',
    hostHwnd: '123',
  });
  assert(unicodeProfileArgs.includes(`--hs-profile-id=${unicodeProfilePaths.id}`));
  assert(!unicodeProfileArgs.includes('--hs-profile-id=豆包::account@example.com'));
  const restoreArgs = buildChromiumArgs({
    profile: { profileId: 'profile_001', initialUrl: '', restoreLastSession: true },
    paths: rebuiltPaths,
    pipeName: '\\\\.\\pipe\\test',
    launchToken: 'one-time',
  });
  assert(restoreArgs.includes('--restore-last-session'));
  assert(!restoreArgs.includes('https://example.com'));
  const preferencesPath = path.join(rebuiltPaths.chromiumData, 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(preferencesPath, JSON.stringify({ session: { restore_on_startup: 1 }, preserved: { value: true } }));
  assert.equal(applyChromiumSessionStartupPolicy(rebuiltPaths, { warn() {} }, {
    locale: 'en-SG',
    acceptLanguage: 'en-SG,en;q=0.9,en-US;q=0.8',
  }), true);
  const preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
  assert.equal(preferences.session.restore_on_startup, 5);
  assert.deepEqual(preferences.session.startup_urls, []);
  assert.equal(preferences.profile.exit_type, 'Normal');
  assert.equal(preferences.profile.exited_cleanly, true);
  assert.equal(preferences.intl.accept_languages, 'en-SG,en,en-US');
  assert.equal(preferences.intl.selected_languages, 'en-SG,en,en-US');
  assert.equal(preferences.preserved.value, true);
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
  assert.equal(buildChromiumEnvironment({}, { TZ: 'Asia/Tokyo' }).TZ, 'Asia/Tokyo');
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
  const navigationTimeoutCodes = ['NAVIGATION_TIMEOUT', 'RUNTIME_COMMAND_TIMEOUT', 'NAVIGATION_FAILED'];
  navigationTimeoutRuntime.getReadyInstance = () => ({
    commandClient: {
      async send(command) {
        if (command === 'navigate') {
          const errorCode = navigationTimeoutCodes.shift();
          const error = new Error(errorCode === 'NAVIGATION_FAILED'
            ? '页面加载失败: -3 https://www.dola.com/chat/'
            : 'Runtime Bridge 命令超时: navigate');
          error.code = errorCode;
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
  const redirectedNavigationImport = await navigationTimeoutRuntime.importSession('redirected-profile', {
    targetUrl: 'https://www.dola.com/chat/',
  });
  assert.equal(redirectedNavigationImport.ok, true);
  assert.equal(redirectedNavigationImport.navigation.pending, true);
  assert.equal(redirectedNavigationImport.navigation.interrupted, true);
  assert.equal(redirectedNavigationImport.navigation.timedOut, false);
  const restartRuntime = new ChromiumRuntime({ logger: { info() {}, warn() {} } });
  const originalProfile = { profileId: 'restart-profile', initialUrl: 'https://example.com/work', extensionPaths: ['extension-a'] };
  restartRuntime.store = { getState: () => ({ bounds: { x: 0, y: 0, width: 800, height: 600 } }) };
  restartRuntime.instances.set('restart-profile', { profile: originalProfile });
  restartRuntime.stop = async () => {};
  let relaunchedProfile = null;
  restartRuntime.launchProfile = async (profile) => {
    relaunchedProfile = { ...profile };
    restartRuntime.instances.set('restart-profile', { profile: { ...profile } });
    return { status: 'ready' };
  };
  await restartRuntime.restart('restart-profile');
  assert.equal(relaunchedProfile.initialUrl, '');
  assert.equal(relaunchedProfile.restoreLastSession, true);
  assert.equal(restartRuntime.instances.get('restart-profile').profile.initialUrl, 'https://example.com/work');
  assert.equal(restartRuntime.instances.get('restart-profile').profile.restoreLastSession, false);

  const tutorialStorePath = path.join(root, 'tutorial-store.json');
  fs.writeFileSync(tutorialStorePath, JSON.stringify({
    browserHistory: [{
      id: 'tutorial-history',
      name: '使用教程[AI-FREE]',
      url: 'https://history.example.com/tutorial',
      partition: 'persist:tutorial-history',
      settings: {},
      lastOpenedAt: 10,
    }],
  }));
  const tutorialTabs = new Map();
  let tutorialActiveTabId = null;
  const tutorialLaunches = [];
  const tutorialNavigations = [];
  let tutorialFocusCalls = 0;
  let tutorialSideFocused = false;
  let tutorialSideFocusCalls = 0;
  const tutorialRuntimeManager = {
    chromium: { on() {} },
    async launchProfile(profile) {
      tutorialLaunches.push(profile);
      return { status: 'ready' };
    },
    async navigate(profileId, _type, url) { tutorialNavigations.push({ profileId, url }); },
    async show() {},
    async hide() {},
    async focus() { tutorialFocusCalls += 1; },
    async stop() {},
  };
  const tutorialTabManager = createTabManager({
    browserRuntimeManager: tutorialRuntimeManager,
    fs,
    getStorePath: () => tutorialStorePath,
    getTabs: () => tutorialTabs,
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1200, 800], emit() {} }),
    getSideView: () => ({
      webContents: {
        isDestroyed: () => false,
        isFocused: () => tutorialSideFocused,
        focus: () => {
          tutorialSideFocused = true;
          tutorialSideFocusCalls += 1;
        },
      },
    }),
    getActiveTabId: () => tutorialActiveTabId,
    setActiveTabId: (tabId) => { tutorialActiveTabId = tabId; },
    getIsSidebarVisible: () => true,
    updateTabs() {},
    sendToSide() {},
    logger: { warn() {}, error() {} },
  });
  const [firstTutorialId, duplicateTutorialId] = await Promise.all([
    tutorialTabManager.openTutorialTab('https://server.example.com/tutorial', {
      focusBrowser: false,
      restoreSideFocus: true,
    }),
    tutorialTabManager.openTutorialTab('https://server.example.com/tutorial', {
      focusBrowser: false,
      restoreSideFocus: true,
    }),
  ]);
  assert.equal(firstTutorialId, duplicateTutorialId);
  assert.equal(tutorialTabs.size, 1);
  assert.equal(tutorialLaunches.length, 1);
  assert.equal(tutorialLaunches[0].initialUrl, 'https://server.example.com/tutorial');
  assert.equal(tutorialTabs.get(firstTutorialId).browserHistoryId, 'tutorial-history');
  assert.equal(tutorialTabs.get(firstTutorialId).isTutorialTab, true);
  assert.equal(tutorialFocusCalls, 0);
  assert.ok(tutorialSideFocusCalls >= 1);
  const reopenedTutorialId = await tutorialTabManager.openTutorialTab(
    'https://server.example.com/tutorial-v2',
    { focusBrowser: false },
  );
  assert.equal(reopenedTutorialId, firstTutorialId);
  assert.deepEqual(tutorialNavigations.at(-1), {
    profileId: firstTutorialId,
    url: 'https://server.example.com/tutorial-v2',
  });
  assert.equal(tutorialFocusCalls, 0);
  tutorialTabManager.switchTab(firstTutorialId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tutorialFocusCalls, 1);

  const magicTabs = new Map([
    ['magic-direct', {
      id: 'magic-direct',
      browserProxyMode: 'direct',
      browserSettings: { proxy: { mode: 'none' } },
    }],
    ['magic-custom', {
      id: 'magic-custom',
      browserProxyMode: 'proxy',
      browserSettings: { proxy: { mode: 'custom', protocol: 'http', host: '10.0.0.2', port: 8888 } },
    }],
  ]);
  const magicInstances = new Map(Array.from(magicTabs.keys()).map((id) => [id, { profile: {} }]));
  const magicGeoLookups = [];
  const magicRestarts = [];
  const magicManager = createTabManager({
    browserRuntimeManager: {
      chromium: { instances: magicInstances, on() {} },
      async restart(id) {
        magicRestarts.push({ id, proxyServer: magicInstances.get(id).profile.proxyServer });
        return { status: 'ready' };
      },
    },
    getTabs: () => magicTabs,
    updateTabs() {},
    resolveTabBrowserProfile: async (options) => {
      magicGeoLookups.push(options.geoProxyServer);
      return {
        locale: 'ja-JP',
        acceptLanguage: 'ja-JP,ja;q=0.9',
        timezoneId: 'Asia/Tokyo',
        userAgent: 'AI-FREE-Test-UA',
      };
    },
    logger: { warn() {}, error() {} },
  });
  const magicEnabled = await magicManager.applyClashMiniBrowserProxy(true);
  assert.equal(magicEnabled.updated, 2);
  const enabledProxyServers = Array.from(magicInstances.values()).map((instance) => instance.profile.proxyServer);
  assert.ok(enabledProxyServers.every((server) => /^http:\/\/127\.0\.0\.1:\d+$/.test(server)));
  assert.equal(new Set(enabledProxyServers).size, 1);
  assert.ok(magicGeoLookups.slice(0, 2).every((server) => server === enabledProxyServers[0]));
  const magicDisabled = await magicManager.applyClashMiniBrowserProxy(false);
  assert.equal(magicDisabled.updated, 2);
  assert.ok(Array.from(magicInstances.values()).every((instance) => instance.profile.proxyServer === ''));
  assert.ok(magicGeoLookups.slice(2).every((server) => server === ''));
  assert.deepEqual(magicRestarts.map((item) => item.proxyServer), [
    enabledProxyServers[0], enabledProxyServers[0], '', '',
  ]);
  console.log('browser runtime checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
