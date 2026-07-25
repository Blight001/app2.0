'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDomainHistoryRepository,
} = require('../../../src/app/main/features/ai-chat/history-repository');

function fixtureRepository() {
  const sessions = [
    { id: 'browser-1', softwareProfileId: '' },
    { id: 'software-1', softwareProfileId: 'notepad' },
  ];
  return {
    listSessions: () => ({ ok: true, sessions, currentId: 'software-1' }),
    getSession: (_credentials, id) => ({ ok: true, session: sessions.find((item) => item.id === id) }),
    saveSession: (_credentials, session) => ({ ok: true, session }),
    createSession: (_credentials, session) => ({ ok: true, session }),
    deleteSession: (_credentials, id) => ({ ok: true, deletedId: id }),
    renameSession: (_credentials, id, title) => ({ ok: true, id, title }),
  };
}

test('Browser 历史仓库隐藏并拒绝软件会话', () => {
  const repository = createDomainHistoryRepository(fixtureRepository(), 'browser');

  assert.deepEqual(
    repository.listSessions({}).sessions.map((session) => session.id),
    ['browser-1'],
  );
  assert.equal(repository.listSessions({}).currentId, 'browser-1');
  assert.equal(repository.getSession({}, 'software-1').ok, false);
  assert.equal(repository.deleteSession({}, 'software-1').ok, false);
  assert.equal(repository.saveSession({}, {
    id: 'software-1',
    softwareProfileId: 'notepad',
  }).ok, false);
  assert.equal(repository.saveSession({}, {
    id: 'browser-1',
    softwareProfileId: '',
  }).ok, true);
});
