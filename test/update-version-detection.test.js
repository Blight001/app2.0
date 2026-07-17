const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { compareVersions } = require('../src/app/shared/version-utils');
const { createAnnouncementPoller } = require('../src/app/main/lib/announcement-poller');
const { createAppUpdater } = require('../src/app/main/services/app-updater');

test('版本比较按数字段处理，并忽略 v 前缀与构建元数据', () => {
  assert.equal(compareVersions('v2.6.3', '2.6.3+build.9'), 0);
  assert.equal(compareVersions('2.6.3', '2.6.4'), -1);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
});

test('预发布版本按 SemVer 标识符比较', () => {
  assert.equal(compareVersions('2.6.3-beta.2', '2.6.3-beta.10'), -1);
  assert.equal(compareVersions('2.6.3-beta', '2.6.3'), -1);
  assert.equal(compareVersions('2.6.3', '2.6.3-rc.1'), 1);
});

test('更新公告交给主进程统一检测，不直接发送到界面', async () => {
  const sideEvents = [];
  const updateNotices = [];
  const poller = createAnnouncementPoller({
    getJson: async () => ({
      success: true,
      data: [{
        id: 7,
        message_type: 'update',
        app_version: '2.6.4',
        package_url: 'https://example.test/app.zip',
      }],
    }),
    getServerBase: () => 'https://example.test',
    shouldPoll: () => true,
    sendToSide: (channel, payload) => {
      sideEvents.push([channel, payload]);
      return true;
    },
    sendUpdateNotice: async (payload) => {
      updateNotices.push(payload);
      return true;
    },
    logger: { log() {}, warn() {} },
  });

  await poller.refreshNow();

  assert.equal(updateNotices.length, 1);
  assert.equal(updateNotices[0].app_version, '2.6.4');
  assert.equal(sideEvents.some(([channel]) => channel === 'app-update-notice'), false);
});

test('公告请求和展示不等待登录心跳完成', async () => {
  const calls = [];
  let finishHeartbeat;
  const heartbeatPending = new Promise((resolve) => { finishHeartbeat = resolve; });
  const poller = createAnnouncementPoller({
    getJson: async () => {
      calls.push('announcement-request');
      return { success: true, data: [{ id: 8, content: '登录公告' }] };
    },
    postJson: async () => {
      calls.push('heartbeat-request');
      await heartbeatPending;
      return { success: true };
    },
    getServerBase: () => 'https://example.test',
    getClientIdentity: () => ({ key: 'key', deviceId: 'device' }),
    shouldPoll: () => true,
    sendToSide: (channel) => {
      if (channel === 'server-message') calls.push('announcement-delivered');
      return true;
    },
    logger: { log() {}, warn() {} },
  });

  const refresh = poller.refreshNow();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    'announcement-request',
    'heartbeat-request',
    'announcement-delivered',
  ]);

  finishHeartbeat();
  await refresh;
});

test('登录刷新遇到正在进行的轮询时会立即排队补拉', async () => {
  let requestCount = 0;
  let finishFirstRequest;
  const firstRequestPending = new Promise((resolve) => { finishFirstRequest = resolve; });
  const poller = createAnnouncementPoller({
    getJson: async () => {
      requestCount += 1;
      if (requestCount === 1) return firstRequestPending;
      return { success: true, data: [] };
    },
    getServerBase: () => 'https://example.test',
    shouldPoll: () => true,
    sendToSide: () => true,
    logger: { log() {}, warn() {} },
  });

  const currentPoll = poller.refreshNow();
  await poller.refreshNow();
  assert.equal(requestCount, 1);

  finishFirstRequest({ success: true, data: [] });
  await currentPoll;
  assert.equal(requestCount, 2);
});

test('卡密登录态写入后先刷新公告，再执行其它登录后任务', () => {
  const licenseSource = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/ipc/register/license.js',
  ), 'utf8');
  const handlerStart = licenseSource.indexOf("ipcMain.handle('validate-key'");
  const handlerEnd = licenseSource.indexOf("ipcMain.handle('unbind-device'", handlerStart);
  const handler = licenseSource.slice(handlerStart, handlerEnd);
  const cacheReady = handler.indexOf("console.log('[验证] 卡密状态已写入运行时缓存')");
  const announcementRefresh = handler.indexOf('refreshAnnouncements()', cacheReady);
  const cleanup = handler.indexOf('await initializeAccountCleanup', cacheReady);

  assert.ok(cacheReady >= 0);
  assert.ok(announcementRefresh > cacheReady);
  assert.ok(cleanup > announcementRefresh);
});

test('账号登录成功后立即刷新公告且启动层已接通刷新能力', () => {
  const lifecycleSource = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/services/app-lifecycle.js',
  ), 'utf8');
  const handlerStart = lifecycleSource.indexOf("ipcMain.handle('account-authenticate'");
  const handlerEnd = lifecycleSource.indexOf("ipcMain.handle('account-logout'", handlerStart);
  const handler = lifecycleSource.slice(handlerStart, handlerEnd);
  const serverReady = handler.indexOf('httpClient.runtimeServerBase =');
  const announcementRefresh = handler.indexOf('deps.refreshAnnouncements?.()', serverReady);
  const deferredPlatformRefresh = handler.indexOf('setImmediate(() =>', serverReady);
  assert.ok(serverReady >= 0);
  assert.ok(announcementRefresh > serverReady);
  assert.ok(deferredPlatformRefresh > announcementRefresh);

  const shellSource = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/services/app-shell.js',
  ), 'utf8');
  assert.match(shellSource, /refreshAnnouncements: \(options = \{\}\) => ensureAnnouncementPoller\(\)\.refreshNow\(options\)/);

  const bootstrapSource = fs.readFileSync(path.join(
    __dirname,
    '../src/app/main/bootstrap.js',
  ), 'utf8');
  assert.match(bootstrapSource, /const \{[\s\S]*?refreshAnnouncements,[\s\S]*?\} = appShell;/);
  assert.match(bootstrapSource, /registerAppLifecycle\(\{[\s\S]*?refreshAnnouncements,[\s\S]*?refreshAllowedPlatformsAndNotify,/);
});

test('主进程仅对高于当前版本的公告发出更新提醒', async () => {
  const events = [];
  const updater = createAppUpdater({
    app: { getVersion: () => '2.6.3' },
    sendToSide: (channel, payload) => events.push([channel, payload]),
    logger: { warn() {} },
  });
  const base = {
    message_type: 'update',
    package_url: 'https://example.test/app.zip',
  };

  await updater.handleServerUpdateCommand({ ...base, app_version: '2.6.3' });
  await updater.handleServerUpdateCommand({ ...base, app_version: '2.6.2' });
  assert.equal(events.filter(([channel]) => channel === 'app-update-notice').length, 0);

  await updater.handleServerUpdateCommand({ ...base, app_version: '2.6.4' });
  const notices = events.filter(([channel]) => channel === 'app-update-notice');
  assert.equal(notices.length, 1);
  assert.equal(notices[0][1].currentVersion, '2.6.3');
  assert.equal(notices[0][1].targetVersion, '2.6.4');
});
