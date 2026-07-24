'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createMsvcEnvironment, findVsRoot } = require('./msvc-toolchain');

const projectRoot = path.resolve(__dirname, '..');
const nativeRoot = path.join(projectRoot, 'native', 'cursor-host');
const outputDir = path.join(nativeRoot, 'build', 'Release');
const outputFile = path.join(outputDir, 'ai-free-cursor-host.exe');
const testFile = path.join(outputDir, 'cursor-host-tests.exe');
const runtimeDir = path.join(projectRoot, 'resources', 'cursor-runtime');
const cursorAssetFile = path.join(
  projectRoot,
  'resources',
  'cursors',
  '[CC] Handwrite v1.ani',
);

function sourceFiles() {
  return [
    'arguments.cc',
    'cursor_state_store.cc',
    'cursor_asset_cache.cc',
    'dcomp_renderer.cc',
    'frame_metrics.cc',
    'input_sampler.cc',
    'main.cc',
    'pipe_security.cc',
    'pipe_server.cc',
    'protocol.cc',
    'recovery_watchdog.cc',
    'system_cursor_lease.cc',
    'target_window_resolver.cc',
  ].map((name) => path.join(nativeRoot, 'src', name));
}

function buildCursorHost() {
  const vsRoot = findVsRoot();
  if (!vsRoot) throw new Error('未找到可用的 Visual Studio 2022 C++ Build Tools');
  fs.mkdirSync(outputDir, { recursive: true });
  const environment = createMsvcEnvironment(vsRoot, nativeRoot);
  const result = spawnSync('cl.exe', [
    '/nologo', '/O2', '/EHsc', '/std:c++20', '/MT', '/utf-8',
    '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX',
    ...sourceFiles(),
    '/link', `/OUT:${outputFile}`, '/SUBSYSTEM:WINDOWS',
    'advapi32.lib', 'd2d1.lib', 'd3d11.lib', 'dcomp.lib', 'dwmapi.lib',
    'dxgi.lib', 'ole32.lib', 'shell32.lib', 'user32.lib', 'windowscodecs.lib',
  ], {
    cwd: nativeRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !fs.existsSync(outputFile)) {
    throw new Error(`Cursor Host 构建失败，退出码 ${result.status}`);
  }
  const testBuild = spawnSync('cl.exe', [
    '/nologo', '/O2', '/EHsc', '/std:c++20', '/MT', '/utf-8',
    '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX',
    path.join(nativeRoot, 'test', 'protocol_test.cc'),
    path.join(nativeRoot, 'src', 'cursor_state_store.cc'),
    path.join(nativeRoot, 'src', 'cursor_asset_cache.cc'),
    path.join(nativeRoot, 'src', 'frame_metrics.cc'),
    path.join(nativeRoot, 'src', 'protocol.cc'),
    '/link', `/OUT:${testFile}`, '/SUBSYSTEM:CONSOLE',
    'ole32.lib', 'windowscodecs.lib',
  ], { cwd: nativeRoot, env: environment, stdio: 'inherit' });
  const testRun = testBuild.status === 0
    ? spawnSync(
      testFile,
      [cursorAssetFile],
      { cwd: nativeRoot, stdio: 'inherit' },
    )
    : testBuild;
  if (testBuild.status !== 0 || testRun.status !== 0) {
    throw new Error(`Cursor Host 单元测试失败，退出码 ${testRun.status}`);
  }
  stageCursorRuntime();
  console.log(`[cursor-host] 构建和测试完成: ${outputFile}`);
  return outputFile;
}

function createRuntimeManifest(executable) {
  const crypto = require('crypto');
  return {
    schemaVersion: 1,
    protocolVersion: '1',
    executable: 'ai-free-cursor-host.exe',
    sha256: crypto.createHash('sha256').update(executable).digest('hex'),
  };
}

function stageCursorRuntime() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const executable = fs.readFileSync(outputFile);
  fs.copyFileSync(outputFile, path.join(runtimeDir, 'ai-free-cursor-host.exe'));
  const manifest = createRuntimeManifest(executable);
  fs.writeFileSync(
    path.join(runtimeDir, 'cursor-runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

if (require.main === module) buildCursorHost();

module.exports = {
  buildCursorHost,
  createRuntimeManifest,
  outputFile,
  stageCursorRuntime,
};
