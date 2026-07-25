'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const {
  accountScope,
} = require(path.join(projectRoot, 'src/app/main/lib/ai-chat-history.js'));
const {
  createSoftwareHistoryRepository,
} = require(path.join(
  projectRoot,
  'src/app/main/features/ai-chat/software-history-repository.js',
));

function legacyFixture() {
  const session = {
    id: 'software-old',
    title: '旧软件会话',
    softwareProfileId: 'software-1',
    messages: [{ role: 'user', content: '继续操作' }],
  };
  return {
    listSessions: () => ({
      ok: true,
      currentId: session.id,
      sessions: [{ id: session.id, softwareProfileId: 'software-1' }],
    }),
    getSession: () => ({ ok: true, session }),
  };
}

test('旧 Software 历史幂等迁入独立目录，删除后不会重复导入', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-software-history-'));
  const credentials = { key: 'fixture' };
  try {
    const repository = createSoftwareHistoryRepository({
      directory,
      fs,
      legacyRepository: legacyFixture(),
    });
    assert.equal(repository.listSessions(credentials).sessions.length, 1);
    assert.equal(repository.deleteSession(credentials, 'software-old').ok, true);

    const restarted = createSoftwareHistoryRepository({
      directory,
      fs,
      legacyRepository: legacyFixture(),
    });
    assert.deepEqual(restarted.listSessions(credentials).sessions, []);
    assert.equal(
      fs.existsSync(path.join(directory, `${accountScope(credentials)}.migration-v1.json`)),
      true,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Software 历史文件损坏时从只读旧数据恢复且不覆盖旧文件', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-software-history-bad-'));
  const credentials = { key: 'fixture' };
  const filePath = path.join(directory, `${accountScope(credentials)}.json`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(filePath, '{broken', 'utf8');
    const repository = createSoftwareHistoryRepository({
      directory,
      fs,
      legacyRepository: legacyFixture(),
    });
    assert.equal(repository.listSessions(credentials).sessions[0].id, 'software-old');
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
