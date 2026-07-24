'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  CURSOR_ASSET_FILE_NAME,
  resolveCursorAssetPath,
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

test('Sidecar cursor asset resolves from source and packaged resource layouts', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  assert.equal(
    resolveCursorAssetPath({
      resourcesPath: path.join(projectRoot, 'node_modules', 'electron', 'dist', 'resources'),
      workingDirectory: projectRoot,
    }),
    path.join(projectRoot, 'resources', 'cursors', CURSOR_ASSET_FILE_NAME),
  );
  assert.equal(
    resolveCursorAssetPath({
      resourcesPath: path.join(projectRoot, 'resources'),
      workingDirectory: path.join(projectRoot, 'missing'),
    }),
    path.join(projectRoot, 'resources', 'cursors', CURSOR_ASSET_FILE_NAME),
  );
});
