'use strict';

function runKey(event, requestId, domain = '') {
  return [
    String(domain || 'shared'),
    event?.sender?.id || 0,
    String(requestId || '').trim(),
  ].join(':');
}

function createChatRunRegistry(options = {}) {
  const runs = new Map();
  const domain = String(options.domain || 'shared');

  function begin(event, requestId) {
    const key = runKey(event, requestId, domain);
    const previous = runs.get(key);
    if (previous) {
      previous.stopped = true;
      previous.controller.abort();
    }
    const run = { controller: new AbortController(), insertedMessages: [], stopped: false };
    runs.set(key, run);
    return { key, run };
  }

  function insert(event, requestId, content) {
    const run = runs.get(runKey(event, requestId, domain));
    if (!run || run.stopped) return { ok: false, message: '当前 AI 回复已经结束' };
    run.insertedMessages.push({ role: 'user', content });
    return { ok: true, queued: run.insertedMessages.length };
  }

  function stop(event, requestId) {
    const run = runs.get(runKey(event, requestId, domain));
    if (!run) return { ok: true, stopped: false };
    run.stopped = true;
    run.controller.abort();
    return { ok: true, stopped: true };
  }

  function finish(key, run) {
    if (key && runs.get(key) === run) runs.delete(key);
  }

  function cancelAll() {
    for (const run of runs.values()) {
      run.stopped = true;
      run.controller.abort();
    }
    const cancelled = runs.size;
    runs.clear();
    return cancelled;
  }

  return {
    begin,
    cancelAll,
    finish,
    get: (event, requestId) => runs.get(runKey(event, requestId, domain)),
    insert,
    stop,
  };
}

module.exports = { createChatRunRegistry, runKey };
