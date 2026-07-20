'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const { installEarlyCrashReporter } = require('../../../src/app/main/runtime/crash-reporter');

test('crash reporter persists, redacts and uploads the complete run log', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-crash-test-'));
  const logPath = path.join(tempDir, 'run.log');
  fs.writeFileSync(logPath, 'startup line\nAuthorization: Bearer top-secret\npassword=hunter2\nlast line', 'utf8');
  const oldLogPath = path.join(tempDir, 'previous-run.log');
  fs.writeFileSync(oldLogPath, 'previous startup stopped without before-quit', 'utf8');
  const sessionsDir = path.join(tempDir, 'crash-reports', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, 'old-session.json'), JSON.stringify({
    sessionId: 'old-session',
    installationId: 'old-installation',
    startedAt: '2026-07-19T00:00:00.000Z',
    lastSeenAt: '2026-07-19T00:00:15.000Z',
    cleanExit: false,
    reportedCrash: false,
    startupPhase: 'bootstrap-main-app',
    pid: 1234,
    logFilePath: oldLogPath,
  }), 'utf8');

  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const compressed = Buffer.concat(chunks);
      received.push(JSON.parse(zlib.gunzipSync(compressed).toString('utf8')));
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end('{"success":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const app = new EventEmitter();
  app.getPath = () => tempDir;
  app.getName = () => 'AI-FREE';
  app.getVersion = () => 'test-version';
  app.setPath = () => {};
  app.isPackaged = true;
  const reporter = installEarlyCrashReporter({
    app,
    crashReporter: { start() {} },
    ipcMain: new EventEmitter(),
  });
  reporter.attachRunLog(logPath);
  reporter.capture('test-crash', new Error('boom'), { phase: 'test' }, { severity: 'error' });
  const address = server.address();
  const result = await reporter.configure({ serverBase: `http://127.0.0.1:${address.port}` });

  assert.equal(result.uploaded, 2);
  const recovered = received.find((report) => report.type === 'abnormal-exit');
  const captured = received.find((report) => report.type === 'test-crash');
  assert.equal(recovered.sessionId, 'old-session');
  assert.match(recovered.logs[0].content, /previous startup stopped/);
  assert.match(captured.stack, /Error: boom/);
  assert.match(captured.logs[0].content, /startup line/);
  assert.match(captured.logs[0].content, /last line/);
  assert.doesNotMatch(captured.logs[0].content, /top-secret|hunter2/);
  assert.match(captured.logs[0].content, /\[REDACTED\]/);
  assert.equal(fs.readdirSync(path.join(reporter.rootDir, 'pending')).length, 0);

  reporter.markCleanExit();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});
