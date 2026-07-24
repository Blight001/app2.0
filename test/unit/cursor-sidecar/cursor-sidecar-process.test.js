'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  verifyRuntime,
} = require('../../../src/app/main/features/cursor-sidecar/cursor-sidecar-process');

test('cursor runtime rejects a manifest whose executable hash changed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-cursor-runtime-'));
  try {
    const executable = Buffer.from('first executable');
    fs.writeFileSync(path.join(directory, 'ai-free-cursor-host.exe'), executable);
    fs.writeFileSync(path.join(directory, 'cursor-runtime-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      protocolVersion: '2',
      executable: 'ai-free-cursor-host.exe',
      sha256: crypto.createHash('sha256').update(executable).digest('hex'),
    }));
    assert.equal(verifyRuntime(directory).manifest.protocolVersion, '2');
    fs.writeFileSync(path.join(directory, 'ai-free-cursor-host.exe'), 'tampered');
    assert.throws(() => verifyRuntime(directory), {
      code: 'CURSOR_SIDECAR_INTEGRITY_FAILED',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
