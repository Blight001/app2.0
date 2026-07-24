'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createMsvcEnvironment, findVsRoot } = require('./msvc-toolchain');

const root = path.resolve(__dirname, '..');
const nativeRoot = path.join(root, 'native', 'browser-host');
const electronVersion = String(require(path.join(root, 'node_modules', 'electron', 'package.json')).version || '').trim();
const outputDir = path.join(nativeRoot, 'build', 'Release');
const outputFile = path.join(outputDir, 'browser_host.node');
const dpiTestFile = path.join(outputDir, 'dpi_scaling_test.exe');

function quote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function findElectronSdk() {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'node-gyp', 'Cache', electronVersion);
  const includeDir = path.join(base, 'include', 'node');
  const nodeLib = path.join(base, 'x64', 'node.lib');
  if (fs.existsSync(path.join(includeDir, 'node_api.h')) && fs.existsSync(nodeLib)) {
    return { includeDir, nodeLib };
  }
  return null;
}

function runNodeGyp() {
  const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  const result = spawnSync(process.execPath, [
    nodeGyp,
    'rebuild',
    `--target=${electronVersion}`,
    '--dist-url=https://electronjs.org/headers',
  ], { cwd: nativeRoot, stdio: 'inherit' });
  return result.status === 0 && fs.existsSync(outputFile);
}

function runManualMsvcBuild() {
  const vsRoot = findVsRoot();
  const sdk = findElectronSdk();
  if (!vsRoot || !sdk) {
    throw new Error(!vsRoot
      ? '未找到可用的 Visual Studio 2022 C++ Build Tools'
      : `未找到 Electron ${electronVersion} 的 node_api.h/node.lib 缓存`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const sources = [
    'src/addon.cc',
    'src/browser_host_window.cc',
    'src/child_window_manager.cc',
    'src/dpi_manager.cc',
    'src/external_window_dock.cc',
    'src/focus_manager.cc',
    'src/process_monitor.cc',
    'src/software_action_bridge.cc',
    'src/software_input.cc',
    'src/window_capture.cc',
    'src/win_delay_load_hook.cc',
  ].map((item) => path.join(nativeRoot, item));

  const msvcEnv = createMsvcEnvironment(vsRoot, nativeRoot);

  const compileArgs = [
    // 原生宿主会被安装到可能没有 VC++ Redistributable 的 Win10 机器。
    // 它不在 DLL 边界传递 C++ 对象，因此静态 CRT 既安全，也能避免
    // require(.node) 因 VCRUNTIME140_1.dll 缺失而报 ERROR_MOD_NOT_FOUND。
    '/nologo', '/LD', '/O2', '/EHsc', '/std:c++17', '/MT', '/utf-8',
    '/DNAPI_VERSION=9', '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX',
    `/I${sdk.includeDir}`,
    ...sources,
    '/link', `/OUT:${outputFile}`, '/DELAYLOAD:node.exe', sdk.nodeLib,
    'delayimp.lib', 'user32.lib', 'gdi32.lib', 'dwmapi.lib',
    'ole32.lib', 'oleaut32.lib',
    'd3d11.lib', 'dxgi.lib', 'windowsapp.lib',
  ];
  const testResult = spawnSync('cl.exe', [
    '/nologo', '/O2', '/EHsc', '/std:c++17', '/MT', '/utf-8',
    '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX',
    path.join(nativeRoot, 'test', 'dpi_scaling_test.cc'),
    '/link', `/OUT:${dpiTestFile}`, 'user32.lib',
  ], { cwd: nativeRoot, env: msvcEnv, stdio: 'inherit' });
  if (testResult.status !== 0 || !fs.existsSync(dpiTestFile)) {
    throw new Error(`DPI 换算测试构建失败，退出码 ${testResult.status}`);
  }

  const result = spawnSync('cl.exe', compileArgs, {
    cwd: nativeRoot,
    env: msvcEnv,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !fs.existsSync(outputFile)) {
    throw new Error(`MSVC 手动构建失败，退出码 ${result.status}`);
  }
}

function buildNativeHost() {
  console.log(`[native-host] Electron target: ${electronVersion}`);
  if (findVsRoot() && findElectronSdk()) {
    runManualMsvcBuild();
  } else if (!runNodeGyp()) {
    throw new Error('Native Host 构建失败：未找到可用的 node-gyp 或 MSVC/Electron SDK 组合');
  }
  console.log(`[native-host] 构建完成: ${outputFile}`);
}

if (require.main === module) {
  buildNativeHost();
}

module.exports = { buildNativeHost };
