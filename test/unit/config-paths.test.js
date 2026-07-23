'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  AUTOMATION_CURSOR_FILE_NAME,
  resolveAutomationCursorPath,
  resolveChromiumResourcesPath,
} = require('../../src/app/main/config/paths');

test('staged development app resolves Chromium resources from the project root', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const stagedAppRoot = path.join(projectRoot, '.generated', 'app');
  const resourcesPath = resolveChromiumResourcesPath({
    isPackaged: false,
    getAppPath: () => stagedAppRoot,
  }, {
    workingDirectory: projectRoot,
    moduleDirectory: path.join(stagedAppRoot, 'src', 'app', 'main', 'config'),
  });

  assert.equal(resourcesPath, path.join(projectRoot, 'resources'));
});

test('automation cursor resolves from source and packaged resource layouts', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  assert.equal(
    resolveAutomationCursorPath({
      resourcesPath: path.join(projectRoot, 'node_modules', 'electron', 'dist', 'resources'),
      workingDirectory: projectRoot,
    }),
    path.join(projectRoot, 'resources', 'cursors', AUTOMATION_CURSOR_FILE_NAME),
  );
  assert.equal(
    resolveAutomationCursorPath({
      resourcesPath: path.join(projectRoot, 'resources'),
      workingDirectory: path.join(projectRoot, 'missing'),
    }),
    path.join(projectRoot, 'resources', 'cursors', AUTOMATION_CURSOR_FILE_NAME),
  );
});
