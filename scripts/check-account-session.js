const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  ACCOUNT_AUTH_TYPE,
  buildStoredAccountSession,
  normalizeAccountSession,
  serializeAccountSession,
} = require('../src/app/main/utils/account-session');
const { createServerResolver } = require('../src/app/main/services/server-resolver');
const { normalizeValidationRuntimeConfig } = require('../src/app/main/lib/http-client');
const {
  getServerMode,
  isServerBaseAllowedForMode,
} = require('../src/app/main/utils/server-mode');

async function main() {

const legacy = normalizeAccountSession({ key: 'LEGACY-CARD' });
assert.equal(legacy.authenticated, false, '旧卡密不能被当作账号会话恢复');
assert.deepEqual(serializeAccountSession({ key: 'LEGACY-CARD' }), {});
assert.equal(normalizeAccountSession({
  authType: ACCOUNT_AUTH_TYPE,
  username: 'legacy-user',
  key: 'LEGACY-CREDENTIAL',
  deviceId: 'legacy-device',
  tenantId: 'default',
  serverBase: 'http://127.0.0.1:58111/t/default',
}).authenticated, false, '旧多平台会话必须重新登录到单平台服务');

const stored = buildStoredAccountSession({
  username: 'alice',
  key: 'INTERNAL-CREDENTIAL',
  deviceId: 'device-1',
  platformName: '平台 A',
  serverBase: 'http://127.0.0.1:58111/',
  account: { id: 7, username: 'alice' },
  validation: { valid: true, targetUrl: 'https://example.com/', remaining_usage_times: 3 },
  authenticatedAt: '2026-07-14T00:00:00.000Z',
});

assert.equal(stored.authType, ACCOUNT_AUTH_TYPE);
assert.equal(stored.serverBase, 'http://127.0.0.1:58111');
assert.equal(stored.serverMode, 'local');
assert.equal(Object.hasOwn(stored, 'authenticated'), false, '派生状态不应写入磁盘');

const restored = normalizeAccountSession(stored);
assert.equal(restored.authenticated, true);
assert.equal(restored.username, 'alice');
assert.equal(restored.validation.remaining_usage_times, 3);
assert.equal(restored.serverMode, 'local', '旧会话应按回环地址识别为本地模式');

stored.validation.remaining_usage_times = 0;
assert.equal(restored.validation.remaining_usage_times, 3, '会话快照必须隔离可变引用');

for (const field of ['username', 'key', 'deviceId', 'serverBase']) {
  const incomplete = { ...stored, [field]: '' };
  assert.equal(normalizeAccountSession(incomplete).authenticated, false, `缺少 ${field} 时不得恢复登录`);
}

const previousAccountServiceUrl = process.env.ACCOUNT_SERVICE_URL;
const previousServerMode = process.env.AI_FREE_SERVER_MODE;
process.env.AI_FREE_SERVER_MODE = 'local';
process.env.ACCOUNT_SERVICE_URL = 'http://127.0.0.1:58111/api/account';
const requests = [];
const resolver = createServerResolver({
  fs: { existsSync: () => false },
  path,
  getServerBase: () => 'http://127.0.0.1:59000',
  postJson: async (url, body) => {
    requests.push({ url, body });
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        credential: 'INTERNAL-CREDENTIAL',
        validation: { platformName: '平台 A' },
      },
    };
  },
  extractValidationState: () => '',
  getValidationFailureMessage: (_source, fallback) => fallback,
  readStoreConfigSafe: () => ({}),
  writeStoreConfigSafe: () => true,
});

await resolver.authenticateAccount({ username: 'alice', password: 'secret-1' });
assert.equal(requests[0].url, 'http://127.0.0.1:58111/api/account/login');
assert.equal(requests[0].body.tenant_id, undefined, '单平台登录不得发送租户 ID');

process.env.AI_FREE_SERVER_MODE = 'remote';
process.env.ACCOUNT_SERVICE_URL = 'http://account.example:58111/api/account';
const remoteResolver = createServerResolver({
  fs: { existsSync: () => false },
  path,
  getServerBase: () => '',
  postJson: async () => ({
    ok: true,
    status: 200,
    body: {
      ok: true,
      credential: 'INTERNAL-CREDENTIAL',
      client_address: 'http://127.0.0.1:58111/t/tenant-a',
      validation: {
        platformName: '平台 A',
        clientAddress: 'http://localhost:58111/t/tenant-a',
      },
    },
  }),
  extractValidationState: () => '',
  getValidationFailureMessage: (_source, fallback) => fallback,
  readStoreConfigSafe: () => ({}),
  writeStoreConfigSafe: () => true,
});
const remoteAuth = await remoteResolver.authenticateAccount({ username: 'alice', password: 'secret-1' });
assert.equal(remoteAuth.serverBase, 'http://account.example:58111/t/tenant-a');
assert.equal(remoteAuth.server_base, 'http://account.example:58111/t/tenant-a');
assert.equal(remoteAuth.client_address, 'http://account.example:58111/t/tenant-a');
assert.equal(remoteAuth.validation.clientAddress, 'http://account.example:58111/t/tenant-a');
assert.equal(normalizeValidationRuntimeConfig({
  address_HTTP: '',
  client_address: remoteAuth.client_address,
}).serverBase, 'http://account.example:58111/t/tenant-a');
assert.equal(getServerMode(), 'remote');
assert.equal(isServerBaseAllowedForMode(remoteAuth.serverBase), true);
assert.equal(isServerBaseAllowedForMode('http://127.0.0.1:58111'), false);
process.env.AI_FREE_SERVER_MODE = 'local';
assert.equal(isServerBaseAllowedForMode('http://127.0.0.1:58111'), true);
assert.equal(isServerBaseAllowedForMode('http://account.example:58111'), false);

if (previousAccountServiceUrl === undefined) delete process.env.ACCOUNT_SERVICE_URL;
else process.env.ACCOUNT_SERVICE_URL = previousAccountServiceUrl;
if (previousServerMode === undefined) delete process.env.AI_FREE_SERVER_MODE;
else process.env.AI_FREE_SERVER_MODE = previousServerMode;

const authControllerSource = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js'),
  'utf8',
);
const appLifecycleSource = fs.readFileSync(
  path.join(__dirname, '../src/app/main/services/app-lifecycle.js'),
  'utf8',
);
const logoutHandlerSource = appLifecycleSource.slice(
  appLifecycleSource.indexOf("ipcMain.handle('account-logout'"),
  appLifecycleSource.indexOf("ipcMain.handle('license-get-saved-key'"),
);
assert.ok(logoutHandlerSource.includes('stopClashMiniProcess'), '退出账号仍应清理账号代理会话');
assert.equal(
  logoutHandlerSource.includes('browserRuntimeManager?.stopAll'),
  false,
  '退出账号不得关闭已打开的 Chromium 浏览器页面',
);
const rendererContext = vm.createContext({
  window: {
    location: { search: '' },
    electronAPI: {
      invoke: async () => new Promise(() => {}),
    },
  },
  URLSearchParams,
  setTimeout,
  clearTimeout,
  Promise,
  Error,
});
vm.runInContext(authControllerSource, rendererContext);
await assert.rejects(
  rendererContext.invokeSidebarAccountAuth({ username: 'alice' }, 10),
  /登录请求超时/,
  '主进程无响应时登录按钮必须退出等待状态',
);

console.log('Account session checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
