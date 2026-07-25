'use strict';

const {
  createAiChatHistoryRepository,
  normalizeSession,
  provisionalTitleFromText,
} = require('../../lib/ai-chat-history');

function isDomainSession(session, domain) {
  const softwareProfileId = String(session?.softwareProfileId || '').trim();
  return domain === 'software' ? Boolean(softwareProfileId) : !softwareProfileId;
}

function createDomainHistoryRepository(repository, domain) {
  if (!domain) return repository;

  function listSessions(credentials) {
    const result = repository.listSessions(credentials);
    if (!result?.ok) return result;
    const sessions = result.sessions.filter((session) => isDomainSession(session, domain));
    const currentId = sessions.some((session) => session.id === result.currentId)
      ? result.currentId
      : (sessions[0]?.id || '');
    return { ...result, sessions, currentId };
  }

  function authorizeSession(credentials, id) {
    const allowed = listSessions(credentials).sessions
      .some((session) => String(session.id) === String(id || ''));
    if (!allowed) return { ok: false, message: '对话不存在于当前工作域' };
    return null;
  }

  return Object.freeze({
    listSessions,
    createSession: (credentials, input = {}) => repository.createSession(
      credentials,
      {
        ...input,
        softwareProfileId: domain === 'software'
          ? (input.softwareProfileId || 'software-workspace')
          : '',
      },
    ),
    getSession: (credentials, id) => (
      authorizeSession(credentials, id)
      || repository.getSession(credentials, id)
    ),
    saveSession: (credentials, session = {}, options) => {
      if (!isDomainSession(session, domain)) {
        return { ok: false, message: '对话目标不属于当前工作域' };
      }
      return repository.saveSession(credentials, session, options);
    },
    deleteSession: (credentials, id) => (
      authorizeSession(credentials, id)
      || repository.deleteSession(credentials, id)
    ),
    renameSession: (credentials, id, title) => (
      authorizeSession(credentials, id)
      || repository.renameSession(credentials, id, title)
    ),
  });
}

module.exports = {
  createAiChatHistoryRepository,
  createDomainHistoryRepository,
  normalizeSession,
  provisionalTitleFromText,
};
