'use strict';

const path = require('path');
const {
  accountScope,
  createAiChatHistoryRepository,
} = require('../../lib/ai-chat-history');
const { readJsonFileSafe, writeJsonFileSafe } = require('../../utils/json-store');
const { createDomainHistoryRepository } = require('./history-repository');

function emptyStore() {
  return { version: 1, sessions: [], currentId: '' };
}

function createTargetRepository(directory) {
  const filePath = (scope) => path.join(directory, `${scope}.json`);
  return createDomainHistoryRepository(
    createAiChatHistoryRepository({
      readStore: (scope) => readJsonFileSafe(filePath(scope), {
        fallback: emptyStore(),
        logPrefix: 'SoftwareAIHistory',
      }),
      writeStore: (scope, store) => writeJsonFileSafe(
        filePath(scope),
        store,
        { logPrefix: 'SoftwareAIHistory' },
      ),
    }),
    'software',
  );
}

function createSoftwareHistoryRepository(options = {}) {
  const target = createTargetRepository(options.directory);
  const legacy = createDomainHistoryRepository(
    options.legacyRepository,
    'software',
  );
  const markerPath = (credentials) => path.join(
    options.directory,
    `${accountScope(credentials)}.migration-v1.json`,
  );
  const targetPath = (credentials) => path.join(
    options.directory,
    `${accountScope(credentials)}.json`,
  );

  function hasReadableTarget(credentials) {
    const filePath = targetPath(credentials);
    if (!options.fs.existsSync(filePath)) return false;
    try {
      const parsed = JSON.parse(options.fs.readFileSync(filePath, 'utf8'));
      return Boolean(parsed && typeof parsed === 'object' && Array.isArray(parsed.sessions));
    } catch (_) {
      return false;
    }
  }

  function ensureMigrated(credentials) {
    const marker = markerPath(credentials);
    if (options.fs.existsSync(marker) && hasReadableTarget(credentials)) return;
    const listed = legacy.listSessions(credentials);
    const migratedIds = [];
    let migrationComplete = listed?.ok === true;
    if (listed?.ok) {
      for (const summary of listed.sessions) {
        const result = legacy.getSession(credentials, summary.id);
        if (!result?.ok) {
          migrationComplete = false;
          continue;
        }
        const saved = target.saveSession(credentials, result.session, {
          setCurrent: summary.id === listed.currentId,
        });
        if (saved?.ok) migratedIds.push(summary.id);
        else migrationComplete = false;
      }
    }
    if (!migrationComplete) return;
    writeJsonFileSafe(marker, {
      schemaVersion: 1,
      migratedAt: new Date().toISOString(),
      migratedIds,
    }, { logPrefix: 'SoftwareAIHistoryMigration' });
  }

  const call = (method) => (credentials, ...args) => {
    ensureMigrated(credentials);
    return target[method](credentials, ...args);
  };
  return Object.freeze({
    createSession: call('createSession'),
    deleteSession: call('deleteSession'),
    getSession: call('getSession'),
    listSessions: call('listSessions'),
    renameSession: call('renameSession'),
    saveSession: call('saveSession'),
  });
}

module.exports = {
  createSoftwareHistoryRepository,
  createTargetRepository,
};
