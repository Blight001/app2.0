const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-session-storage-'));
app.setPath('userData', testRoot);

app.whenReady().then(() => {
  const sessionStorage = require('../src/app/main/lib/session-storage');
  const accountId = '豆包::7-8-19-11=38@self.com';

  assert.equal(sessionStorage.saveSession(accountId, {
    key: 'JD27-TEST',
    account: '7-8-19-11=38@self.com',
    platform: '豆包',
    cookies: [{ name: 'sessionid', value: 'test-cookie', domain: '.example.com', path: '/' }],
  }), true, '包含 Windows 非法文件名字符的账号 ID 应能保存');

  const files = fs.readdirSync(sessionStorage.getSessionsDir(), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile());
  assert.equal(files.length, 1);
  assert.equal(files.some((entry) => entry.name.includes(':')), false, '落盘文件名不得包含冒号');

  assert.equal(sessionStorage.getAllSessionIds().includes(accountId), true, '账号列表应返回原始业务 ID');
  const loaded = sessionStorage.loadSession(accountId);
  assert.equal(loaded?.id, accountId);
  assert.equal(loaded?.account, '7-8-19-11=38@self.com');
  assert.equal(loaded?.cookies?.[0]?.value, 'test-cookie');

  assert.equal(sessionStorage.deleteSession(accountId), true, '应能使用原始业务 ID 删除哈希文件');
  assert.equal(sessionStorage.getAllSessionIds().includes(accountId), false);

  console.log('Session storage checks passed.');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('quit', () => {
  try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch (_) {}
});
