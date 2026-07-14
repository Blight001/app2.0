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

async function main() {

const legacy = normalizeAccountSession({ key: 'LEGACY-CARD' });
assert.equal(legacy.authenticated, false, '旧卡密不能被当作账号会话恢复');
assert.deepEqual(serializeAccountSession({ key: 'LEGACY-CARD' }), {});

const stored = buildStoredAccountSession({
  username: 'alice',
  key: 'INTERNAL-CREDENTIAL',
  deviceId: 'device-1',
  tenantId: 'tenant-a',
  platformName: '平台 A',
  serverBase: 'http://127.0.0.1:58111/t/tenant-a/',
  account: { id: 7, username: 'alice' },
  validation: { valid: true, targetUrl: 'https://example.com/', remaining_usage_times: 3 },
  authenticatedAt: '2026-07-14T00:00:00.000Z',
});

assert.equal(stored.authType, ACCOUNT_AUTH_TYPE);
assert.equal(stored.serverBase, 'http://127.0.0.1:58111/t/tenant-a');
assert.equal(Object.hasOwn(stored, 'authenticated'), false, '派生状态不应写入磁盘');

const restored = normalizeAccountSession(stored);
assert.equal(restored.authenticated, true);
assert.equal(restored.username, 'alice');
assert.equal(restored.validation.remaining_usage_times, 3);

stored.validation.remaining_usage_times = 0;
assert.equal(restored.validation.remaining_usage_times, 3, '会话快照必须隔离可变引用');

for (const field of ['username', 'key', 'deviceId', 'serverBase']) {
  const incomplete = { ...stored, [field]: '' };
  assert.equal(normalizeAccountSession(incomplete).authenticated, false, `缺少 ${field} 时不得恢复登录`);
}

const previousResolverUrl = process.env.SERVER_MAIN_CARD_STATUS_SEARCH_URL;
process.env.SERVER_MAIN_CARD_STATUS_SEARCH_URL = 'http://127.0.0.1:59000/api/server_main/card-status/search';
const requests = [];
const resolver = createServerResolver({
  fs: { existsSync: () => false },
  path,
  getServerBase: () => 'http://127.0.0.1:59000',
  postJson: async (url, body) => {
    requests.push({ url, body });
    return { ok: true, status: 200, body: { ok: true, platforms: [] } };
  },
  extractValidationState: () => '',
  getValidationFailureMessage: (_source, fallback) => fallback,
  readStoreConfigSafe: () => ({}),
  writeStoreConfigSafe: () => true,
});

await resolver.authenticateAccount({ username: 'alice', password: 'secret-1' });
await resolver.getAccountPlatforms();
assert.equal(requests[0].url, 'http://127.0.0.1:59000/api/client-accounts/login');
assert.equal(requests[1].url, 'http://127.0.0.1:59000/api/client-accounts/platforms');
if (previousResolverUrl === undefined) delete process.env.SERVER_MAIN_CARD_STATUS_SEARCH_URL;
else process.env.SERVER_MAIN_CARD_STATUS_SEARCH_URL = previousResolverUrl;

const authControllerSource = fs.readFileSync(
  path.join(__dirname, '../src/app/sidebar/client/app/side/controllers/pages/side-panel/modules/account-auth.js'),
  'utf8',
);
const rendererContext = vm.createContext({
  window: {
    electronAPI: {
      invoke: async () => new Promise(() => {}),
    },
  },
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
